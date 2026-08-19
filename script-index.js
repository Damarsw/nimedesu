document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

let currentData = [];
let currentPage = 1;
let totalPages = 1;
let activeAnime = null;
const itemsPerPage = 12;

let currentView = 'home';
let activeSearchQuery = "";
let activeInfoSearchQuery = "";
let activeStatusFilter = "";
let activeGenreFilter = "";
let isBookmarkViewActive = false;
let isFavoriteViewActive = false;
let searchDebounceTimer = null;

let currentInfoType = 'bypopularity';
let currentInfoPage = 1;

let userBookmarksCache = [];
let userFavoritesCache = [];
let scoreLocalCache = {};
try {
    scoreLocalCache = JSON.parse(localStorage.getItem('nimedesu_scores_cache') || '{}');
} catch (e) {
    scoreLocalCache = {};
}

const RENDER_API_URL = "/api-backend";

function generateSecurityToken() {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawPayload = `${timestamp}_NimeDesuSecretKey2026`;
    const token = CryptoJS.SHA256(rawPayload).toString(CryptoJS.enc.Hex);
    return {
        token: token,
        time: timestamp.toString()
    };
}

function getNextSundayMidnightTimestamp() {
    const now = new Date();
    const result = new Date(now);
    const dayOfWeek = now.getDay();
    let daysUntilSunday = (7 - dayOfWeek) % 7;
    if (daysUntilSunday === 0) daysUntilSunday = 7;
    result.setDate(now.getDate() + daysUntilSunday);
    result.setHours(0, 0, 0, 0);
    return result.getTime();
}

function getCachedScore(title, defaultScore) {
    if (defaultScore && defaultScore !== '-' && defaultScore !== 'N/A') return defaultScore;
    if (!title) return 'N/A';
    
    const cleanTitle = title.replace(/([a-zA-Z0-9])x([a-zA-Z0-9])/gi, '$1 x $2').toLowerCase().trim();
    const cachedData = scoreLocalCache[cleanTitle];

    if (cachedData) {
        if (typeof cachedData === 'string') return cachedData;
        const now = Date.now();
        if (cachedData.expiresAt && now < cachedData.expiresAt) return cachedData.score;
    }
    return 'N/A';
}

async function fetchAniListScoreForCard(animeTitle, elementId, defaultScore) {
    if (defaultScore && defaultScore !== '-' && defaultScore !== 'N/A') {
        const targetEl = document.getElementById(elementId);
        if (targetEl) targetEl.innerHTML = `★ ${defaultScore}`;
        return;
    }
    if (!animeTitle) return;

    let cleanTitle = animeTitle.replace(/([a-zA-Z0-9])x([a-zA-Z0-9])/gi, '$1 x $2').trim();
    const cacheKey = cleanTitle.toLowerCase();

    const cachedScore = getCachedScore(cleanTitle, defaultScore);
    if (cachedScore !== 'N/A') {
        const targetEl = document.getElementById(elementId);
        if (targetEl) targetEl.innerHTML = `★ ${cachedScore}`;
        return;
    }

    try {
        const sec = generateSecurityToken();
        const response = await fetch(`${RENDER_API_URL}/anilist-score?title=${encodeURIComponent(cleanTitle)}`, {
            headers: { "X-Client-Token": sec.token, "X-Client-Time": sec.time }
        });
        const result = await response.json();
        const score = result?.score;
        const targetEl = document.getElementById(elementId);

        if (score && score !== 'N/A') {
            scoreLocalCache[cacheKey] = {
                score: score,
                expiresAt: getNextSundayMidnightTimestamp()
            };
            try { localStorage.setItem('nimedesu_scores_cache', JSON.stringify(scoreLocalCache)); } catch (e) {}
            if (targetEl) targetEl.innerHTML = `★ ${score}`;
        }
    } catch (err) {}
}

function isAnimeBookmarked(anime) {
    if (!userBookmarksCache || userBookmarksCache.length === 0 || !anime) return false;
    const targetId = String(anime.id || anime.anime_id || "");
    const titleUser = (anime.title?.userPreferred || anime.title?.romaji || anime.title?.english || anime.title || "").toLowerCase().trim();

    return userBookmarksCache.some(b => {
        const bId = String(b.id || b.anime_id || "");
        const bTitle = (b.title || "").toLowerCase().trim();
        return (targetId && bId && targetId === bId) || (bTitle && bTitle === titleUser);
    });
}

function isAnimeFavorited(anime) {
    if (!userFavoritesCache || userFavoritesCache.length === 0 || !anime) return false;
    const targetId = String(anime.id || anime.anime_id || "");
    const titleUser = (anime.title?.userPreferred || anime.title?.romaji || anime.title?.english || anime.title || "").toLowerCase().trim();

    return userFavoritesCache.some(f => {
        const fId = String(f.id || f.anime_id || "");
        const fTitle = (f.title || "").toLowerCase().trim();
        return (targetId && fId && targetId === fId) || (fTitle && fTitle === titleUser);
    });
}

function getUserIdentifier(user) {
    if (!user) return null;
    return user.name || String(user.id);
}

// SINKRONISASI KE ANILIST GRAPHQL
async function syncAniListMedia(animeObj, statusType) {
    const token = localStorage.getItem('anilist_token');
    if (!token) return;

    const searchTitle = animeObj.title?.userPreferred || animeObj.title?.romaji || animeObj.title || "";
    const mediaQuery = `query ($search: String) { Media (search: $search, type: ANIME) { id } }`;

    try {
        const resMedia = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: mediaQuery, variables: { search: searchTitle } })
        });
        const mediaData = await resMedia.json();
        const mediaId = mediaData?.data?.Media?.id;
        if (!mediaId) return;

        if (statusType === 'PLANNING') {
            const mutation = `mutation ($mediaId: Int) { SaveMediaListEntry (mediaId: $mediaId, status: PLANNING) { id status } }`;
            await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: mutation, variables: { mediaId } })
            });
        } else if (statusType === 'FAVORITE') {
            const mutation = `mutation ($animeId: Int) { ToggleFavorite (animeId: $animeId) { anime { nodes { id } } } }`;
            await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: mutation, variables: { animeId: mediaId } })
            });
        }
    } catch (e) {
        console.error("Gagal sinkronisasi AniList:", e);
    }
}

async function syncUserWithSupabase(user) {
    if (!user) return null;
    const identifier = getUserIdentifier(user);

    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/user-sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            },
            body: JSON.stringify({
                anilist_id: identifier,
                user_info: {
                    id: user.id,
                    name: user.name,
                    avatar: user.avatar?.medium || "",
                    login_at: new Date().toISOString()
                }
            })
        });

        const result = await res.json();
        if (result && result.cookies) {
            userBookmarksCache = result.cookies.bookmarks || [];
            userFavoritesCache = result.cookies.favorites || [];
            return result.cookies;
        }
        return null;
    } catch (err) {
        console.error("Gagal sync user:", err);
        return null;
    }
}

async function getSupabaseUserData(user) {
    if (!user) return { history: [], bookmarks: [], favorites: [] };
    const identifier = getUserIdentifier(user);

    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/user-data?anilist_id=${encodeURIComponent(identifier)}`, {
            headers: { "X-Client-Token": sec.token, "X-Client-Time": sec.time }
        });
        const result = await res.json();
        const cookies = result.cookies || {};
        userBookmarksCache = Array.isArray(cookies.bookmarks) ? cookies.bookmarks : [];
        userFavoritesCache = Array.isArray(cookies.favorites) ? cookies.favorites : [];
        return {
            history: Array.isArray(cookies.history) ? cookies.history : [],
            bookmarks: userBookmarksCache,
            favorites: userFavoritesCache,
            user_info: cookies.user_info || {}
        };
    } catch (err) {
        console.error("Gagal mengambil data user:", err);
        return { history: [], bookmarks: [], favorites: [] };
    }
}

async function saveSupabaseUserData(user, payload) {
    if (!user) return false;
    const identifier = getUserIdentifier(user);

    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/user-update`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            },
            body: JSON.stringify({
                anilist_id: identifier,
                cookies: payload
            })
        });
        const result = await res.json();
        userBookmarksCache = payload.bookmarks || [];
        userFavoritesCache = payload.favorites || [];
        return result.status === "success";
    } catch (err) {
        console.error("Gagal update data user:", err);
        return false;
    }
}

// TOGGLE BOOKMARK (PLANNING)
async function toggleBookmarkAnime(animeObjOrId, buttonEl) {
    const user = getLoggedInUser();
    if (!user) {
        alert("Silakan login dengan akun AniList terlebih dahulu!");
        loginAniList();
        return;
    }

    let animeObj = typeof animeObjOrId === 'object' ? animeObjOrId : currentData.find(a => String(a.id) === String(animeObjOrId));
    if (!animeObj) return;

    try {
        const userData = await getSupabaseUserData(user);
        let bookmarks = userData.bookmarks || [];

        const bookmarkItem = {
            id: animeObj.id,
            anime_id: animeObj.id,
            title: animeObj.title?.userPreferred || animeObj.title?.romaji || animeObj.title || "Anime",
            url: animeObj.url || "",
            thumbnail: animeObj.coverImage?.extraLarge || animeObj.thumbnail || "https://placehold.co/400x600?text=No+Image",
            status: animeObj.status || "Ongoing",
            skor: animeObj.skor || animeObj.score || "-",
            addedAt: new Date().toISOString()
        };

        const existsIndex = bookmarks.findIndex(b => String(b.id || b.anime_id) === String(bookmarkItem.id) || b.title?.toLowerCase() === bookmarkItem.title?.toLowerCase());

        if (existsIndex > -1) {
            bookmarks.splice(existsIndex, 1);
            alert(`"${bookmarkItem.title}" dihapus dari Bookmark!`);
        } else {
            bookmarks.unshift(bookmarkItem);
            alert(`"${bookmarkItem.title}" disimpan ke Bookmark (Planning AniList)!`);
            await syncAniListMedia(bookmarkItem, 'PLANNING');
        }

        userData.bookmarks = bookmarks;
        await saveSupabaseUserData(user, userData);

        if (isBookmarkViewActive) loadBookmarkTab(currentPage);
        else displayAnimeWithPagination();

    } catch (err) {
        console.error("Gagal toggle bookmark:", err);
    }
}

// TOGGLE FAVORITE
async function toggleFavoriteAnime(animeObjOrId, buttonEl) {
    const user = getLoggedInUser();
    if (!user) {
        alert("Silakan login dengan akun AniList terlebih dahulu!");
        loginAniList();
        return;
    }

    let animeObj = typeof animeObjOrId === 'object' ? animeObjOrId : currentData.find(a => String(a.id) === String(animeObjOrId));
    if (!animeObj) return;

    try {
        const userData = await getSupabaseUserData(user);
        let favorites = userData.favorites || [];

        const favItem = {
            id: animeObj.id,
            anime_id: animeObj.id,
            title: animeObj.title?.userPreferred || animeObj.title?.romaji || animeObj.title || "Anime",
            url: animeObj.url || "",
            thumbnail: animeObj.coverImage?.extraLarge || animeObj.thumbnail || "https://placehold.co/400x600?text=No+Image",
            status: animeObj.status || "Ongoing",
            skor: animeObj.skor || animeObj.score || "-",
            addedAt: new Date().toISOString()
        };

        const existsIdx = favorites.findIndex(f => String(f.id || f.anime_id) === String(favItem.id) || f.title?.toLowerCase() === favItem.title?.toLowerCase());

        if (existsIdx > -1) {
            favorites.splice(existsIdx, 1);
            alert(`"${favItem.title}" dihapus dari Favorit!`);
        } else {
            favorites.unshift(favItem);
            alert(`"${favItem.title}" ditambahkan ke Favorit AniList!`);
            await syncAniListMedia(favItem, 'FAVORITE');
        }

        userData.favorites = favorites;
        await saveSupabaseUserData(user, userData);

        if (isFavoriteViewActive) loadFavoriteTab(currentPage);
        else displayAnimeWithPagination();

    } catch (err) {
        console.error("Error Favorite:", err);
    }
}

async function loadBookmarkTab(page = 1) {
    isBookmarkViewActive = true;
    isFavoriteViewActive = false;
    currentPage = page;

    const user = getLoggedInUser();
    const container = document.getElementById('animeDisplayGrid');
    const paginationBox = document.getElementById('paginationBox');

    if (!user) {
        container.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 space-y-4 text-center">
                <i class="fa-regular fa-bookmark text-4xl text-neon-yellow"></i>
                <p class="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300 max-w-sm">Fitur Bookmark terkunci. Silakan login terlebih dahulu.</p>
                <button onclick="loginAniList()" class="px-5 py-2.5 rounded-full bg-neon-yellow text-black text-xs font-bold shadow-glow-yellow transition hover:opacity-90">Login AniList</button>
            </div>`;
        paginationBox.innerHTML = '';
        return;
    }

    const userData = await getSupabaseUserData(user);
    const bookmarks = userData.bookmarks || [];

    if (bookmarks.length === 0) {
        container.innerHTML = `<p class="col-span-full text-center py-16 text-xs text-zinc-500">Belum ada anime yang Anda bookmark.</p>`;
        paginationBox.innerHTML = '';
        return;
    }

    currentData = bookmarks;
    totalPages = Math.max(1, Math.ceil(currentData.length / itemsPerPage));
    const pageItems = currentData.slice((page - 1) * itemsPerPage, page * itemsPerPage);
    renderCustomGrid(pageItems);
}

async function loadFavoriteTab(page = 1) {
    isFavoriteViewActive = true;
    isBookmarkViewActive = false;
    currentPage = page;

    const user = getLoggedInUser();
    const container = document.getElementById('animeDisplayGrid');
    const paginationBox = document.getElementById('paginationBox');

    if (!user) {
        container.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 space-y-4 text-center">
                <i class="fa-regular fa-heart text-4xl text-red-500"></i>
                <p class="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300 max-w-sm">Fitur Favorit terkunci. Silakan login terlebih dahulu.</p>
                <button onclick="loginAniList()" class="px-5 py-2.5 rounded-full bg-neon-yellow text-black text-xs font-bold shadow-glow-yellow transition hover:opacity-90">Login AniList</button>
            </div>`;
        paginationBox.innerHTML = '';
        return;
    }

    const userData = await getSupabaseUserData(user);
    const favorites = userData.favorites || [];

    if (favorites.length === 0) {
        container.innerHTML = `<p class="col-span-full text-center py-16 text-xs text-zinc-500">Belum ada anime yang Anda favoritkan.</p>`;
        paginationBox.innerHTML = '';
        return;
    }

    currentData = favorites;
    totalPages = Math.max(1, Math.ceil(currentData.length / itemsPerPage));
    const pageItems = currentData.slice((page - 1) * itemsPerPage, page * itemsPerPage);
    renderCustomGrid(pageItems);
}

function renderCustomGrid(items) {
    const container = document.getElementById('animeDisplayGrid');
    container.innerHTML = items.map(item => {
        const isBookmarked = isAnimeBookmarked(item);
        const isFavorited = isAnimeFavorited(item);

        return `
            <div class="group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer" onclick="viewDetails('${item.id}')">
                <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                    <img src="${item.thumbnail}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                    <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${item.status || 'Ongoing'}</span>
                    
                    <div class="absolute top-2 right-2 flex items-center gap-1.5 z-20">
                        <button onclick="event.stopPropagation(); toggleFavoriteAnime('${item.id}', this)" title="Favorit" class="p-2 rounded-full bg-black/70 backdrop-blur-md hover:scale-110 transition shadow-md">
                            <i class="${isFavorited ? 'fa-solid fa-heart text-red-500' : 'fa-regular fa-heart text-zinc-300'} text-xs"></i>
                        </button>
                        <button onclick="event.stopPropagation(); toggleBookmarkAnime('${item.id}', this)" title="Bookmark (Planning)" class="p-2 rounded-full bg-black/70 backdrop-blur-md hover:scale-110 transition shadow-md">
                            <i class="${isBookmarked ? 'fa-solid fa-bookmark text-neon-yellow' : 'fa-regular fa-bookmark text-zinc-300'} text-xs"></i>
                        </button>
                    </div>
                </div>
                <div class="p-3">
                    <h4 class="font-semibold text-xs sm:text-sm line-clamp-2 text-black dark:text-white">${item.title}</h4>
                </div>
            </div>`;
    }).join('');
}

const ANILIST_CLIENT_ID = "48567";

function getLoggedInUser() {
    const userStr = localStorage.getItem('anilist_user');
    const token = localStorage.getItem('anilist_token');
    if (!token || !userStr) return null;
    try { return JSON.parse(userStr); } catch (e) { return null; }
}

function handleAniListOAuthCallback() {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
        const tokenParams = new URLSearchParams(hash.replace('#', '?'));
        const accessToken = tokenParams.get('access_token');
        if (accessToken) {
            localStorage.setItem('anilist_token', accessToken);
            history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
    }
}

function loginAniList() {
    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=token`;
    window.location.href = authUrl;
}

function logoutAniList() {
    localStorage.removeItem('anilist_token');
    localStorage.removeItem('anilist_user');
    alert("Berhasil logout!");
    location.reload();
}

async function checkAniListAuthStatus() {
    const token = localStorage.getItem('anilist_token');
    const headerAuthContainer = document.getElementById('headerAuthContainer');
    const sidebarAuthBtn = document.getElementById('sidebarAuthBtn');
    const userWelcomeBanner = document.getElementById('userWelcomeBanner');
    const userWelcomeName = document.getElementById('userWelcomeName');
    const userWelcomeAvatarContainer = document.getElementById('userWelcomeAvatarContainer');

    if (!token) return;

    const query = `query { Viewer { id name avatar { medium } } }`;
    try {
        const response = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        const user = result?.data?.Viewer;

        if (user) {
            localStorage.setItem('anilist_user', JSON.stringify(user));
            if (headerAuthContainer) {
                headerAuthContainer.innerHTML = `<div class="flex items-center bg-white dark:bg-zinc-800/90 p-0.5 rounded-full border border-neon-yellow shadow-xs"><img src="${user.avatar.medium}" class="w-7 h-7 rounded-full object-cover"></div>`;
            }
            if (sidebarAuthBtn) {
                sidebarAuthBtn.innerHTML = `<button onclick="logoutAniList()" class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-500/20 text-red-500 transition text-left"><i class="fa-solid fa-right-from-bracket w-5 text-center"></i> Logout (${user.name})</button>`;
            }
            if (userWelcomeBanner && userWelcomeName) {
                userWelcomeName.innerText = user.name;
                if (userWelcomeAvatarContainer) userWelcomeAvatarContainer.innerHTML = `<img src="${user.avatar.medium}" class="w-10 h-10 rounded-full border border-neon-yellow object-cover shadow-sm">`;
                userWelcomeBanner.classList.remove('hidden');
            }
            await syncUserWithSupabase(user);
            renderHistory();
        }
    } catch (err) {
        console.error("Auth check failed:", err);
    }
}

async function renderHistory() {
    const historySection = document.getElementById('historySection');
    const historyGrid = document.getElementById('historyGrid');
    const user = getLoggedInUser();

    if (!user) {
        if (historySection) historySection.classList.add('hidden');
        return;
    }

    try {
        const userData = await getSupabaseUserData(user);
        const history = userData.history || [];

        if (history.length === 0) {
            if (historySection) historySection.classList.add('hidden');
            return;
        }

        if (historySection) historySection.classList.remove('hidden');
        if (historyGrid) {
            historyGrid.innerHTML = history.map((item, idx) => {
                const displayImg = item.thumbnail || "https://placehold.co/400x600?text=No+Image";
                return `
                    <div class="min-w-[140px] sm:min-w-[160px] w-[140px] sm:w-[160px] group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer shrink-0" onclick="window.location.href='stream.html?anime_id=${encodeURIComponent(item.anime_id || item.id)}&eps=${item.lastEpisodeIndex || 0}'">
                        <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                            <img src="${displayImg}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                            <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${item.lastWatchedEpisode || 'Eps 1'}</span>
                        </div>
                        <div class="p-3">
                            <h4 class="font-semibold text-xs sm:text-sm line-clamp-2 text-black dark:text-white">${item.title}</h4>
                        </div>
                    </div>`;
            }).join('');
        }
    } catch (err) {}
}

async function clearHistory() {
    const user = getLoggedInUser();
    if (!user || !confirm("Hapus seluruh riwayat tontonan?")) return;
    try {
        const userData = await getSupabaseUserData(user);
        userData.history = [];
        await saveSupabaseUserData(user, userData);
        document.getElementById('historySection').classList.add('hidden');
    } catch (err) {}
}

function scrollToSearchResults() {
    const target = document.getElementById('btnBookmarkTab')?.parentElement || document.getElementById('animeDisplayGrid');
    if (target) {
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - 70;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
    }
}

function switchView(viewName, shouldScrollToTop = true) {
    currentView = viewName;
    ['homeView', 'detailView', 'dmcaView', 'informationView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const targetEl = document.getElementById(`${viewName}View`);
    if (targetEl) targetEl.classList.remove('hidden');
    if (viewName === 'home') renderHistory();
    if (shouldScrollToTop) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebarMenu');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('hidden');
}

function toggleInformationSubmenu(e) {
    if(e) e.stopPropagation();
    const submenu = document.getElementById('informationSubmenu');
    const icon = document.getElementById('informationMenuIcon');
    submenu.classList.toggle('hidden');
    icon.classList.toggle('rotate-180');
}

async function loadAnimeDatabase(page = 1) {
    try {
        isBookmarkViewActive = false;
        isFavoriteViewActive = false;
        currentPage = page;
        let fetchUrl = `${RENDER_API_URL}/anime?page=${page}&per_page=${itemsPerPage}`;
        
        if (activeSearchQuery) fetchUrl += `&q=${encodeURIComponent(activeSearchQuery)}`;
        if (activeStatusFilter) fetchUrl += `&status=${encodeURIComponent(activeStatusFilter)}`;
        if (activeGenreFilter) fetchUrl += `&genre=${encodeURIComponent(activeGenreFilter)}`;

        const sec = generateSecurityToken();
        const response = await fetch(fetchUrl, {
            headers: { "X-Client-Token": sec.token, "X-Client-Time": sec.time }
        });
        const result = await response.json();

        currentData = (result.data || []).map((item, index) => ({
            id: item.id || (index + 1),
            title: item.title || "Tanpa Judul",
            url: item.url ? item.url.trim() : "",
            status: item.status || "Ongoing",
            genres: item.genre ? item.genre.split(',').map(g => g.trim()) : [],
            synopsis: item.sinopsis || "Sinopsis belum tersedia.",
            thumbnail: item.img_url || item.image_url || "https://placehold.co/400x600?text=No+Image",
            japanese: item.japanese || "-",
            skor: item.score || "-",
            totalEpisode: item.total_episodes || "-",
            durasi: item.duration || "-",
            tanggalRilis: item.release_date || "-",
            studio: item.studio || "-"
        }));

        totalPages = result.total_pages || 1;
        displayAnimeWithPagination();

    } catch (error) {
        document.getElementById('animeDisplayGrid').innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Gagal memuat data anime.</p>`;
    }
}

function displayAnimeWithPagination() {
    const container = document.getElementById('animeDisplayGrid');
    const paginationBox = document.getElementById('paginationBox');

    if (currentData.length === 0) {
        container.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Tidak ada anime ditemukan.</p>`;
        paginationBox.innerHTML = '';
        return;
    }

    container.innerHTML = currentData.map(item => {
        const scoreBadgeId = `homeScore_${item.id}`;
        setTimeout(() => { fetchAniListScoreForCard(item.title, scoreBadgeId, item.skor); }, 50);

        const isBookmarked = isAnimeBookmarked(item);
        const isFavorited = isAnimeFavorited(item);
        const cachedScore = getCachedScore(item.title, item.skor);

        return `
            <div class="group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer" onclick="viewDetails('${item.id}')">
                <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                    <img src="${item.thumbnail}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                    <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${item.status}</span>
                    <span id="${scoreBadgeId}" class="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md text-neon-yellow text-[10px] font-bold px-2 py-0.5 rounded-full shadow z-10">★ ${cachedScore}</span>
                    
                    <div class="absolute top-2 right-2 flex items-center gap-1.5 z-20">
                        <button onclick="event.stopPropagation(); toggleFavoriteAnime('${item.id}', this)" title="Favorit" class="p-2 rounded-full bg-black/70 backdrop-blur-md hover:scale-110 transition shadow-md">
                            <i class="${isFavorited ? 'fa-solid fa-heart text-red-500' : 'fa-regular fa-heart text-zinc-300'} text-xs"></i>
                        </button>
                        <button onclick="event.stopPropagation(); toggleBookmarkAnime('${item.id}', this)" title="Bookmark (Planning)" class="p-2 rounded-full bg-black/70 backdrop-blur-md hover:scale-110 transition shadow-md">
                            <i class="${isBookmarked ? 'fa-solid fa-bookmark text-neon-yellow' : 'fa-regular fa-bookmark text-zinc-300'} text-xs"></i>
                        </button>
                    </div>
                </div>
                <div class="p-3">
                    <h4 class="font-semibold text-xs sm:text-sm line-clamp-2 text-black dark:text-white">${item.title}</h4>
                </div>
            </div>`;
    }).join('');

    renderPaginationControls();
}

function renderPaginationControls() {
    const paginationBox = document.getElementById('paginationBox');
    let paginationHTML = '';
    const baseBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow transition shadow-xs';
    const disBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-not-allowed';

    paginationHTML += `<button class="${currentPage > 1 ? baseBtn : disBtn}" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(1)">&laquo;</button>`;
    paginationHTML += `<button class="${currentPage > 1 ? baseBtn : disBtn}" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">&lsaquo;</button>`;

    for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) {
        const actClass = i === currentPage ? 'bg-neon-yellow text-black font-bold border-neon-yellow shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder shadow-xs';
        paginationHTML += `<button class="w-9 h-9 rounded-lg text-xs font-semibold border ${actClass} transition" onclick="goToPage(${i})">${i}</button>`;
    }

    paginationHTML += `<button class="${currentPage < totalPages ? baseBtn : disBtn}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">&rsaquo;</button>`;
    paginationHTML += `<button class="${currentPage < totalPages ? baseBtn : disBtn}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${totalPages})">&raquo;</button>`;

    paginationBox.innerHTML = paginationHTML;
}

function goToPage(pageNumber) {
    if (isBookmarkViewActive) loadBookmarkTab(pageNumber);
    else if (isFavoriteViewActive) loadFavoriteTab(pageNumber);
    else loadAnimeDatabase(pageNumber);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changeTab(type, element) {
    switchView('home');
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
        b.classList.remove('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
        b.classList.add('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
    });

    if (element) {
        element.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        element.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    }

    activeSearchQuery = "";
    activeGenreFilter = "";

    if (type === 'bookmark') {
        document.getElementById('sectionHeader').innerText = "Daftar Bookmark (Planning AniList)";
        loadBookmarkTab(1);
        return;
    }

    if (type === 'favorite_tab') {
        document.getElementById('sectionHeader').innerText = "Daftar Anime Favorit";
        loadFavoriteTab(1);
        return;
    }

    if (type === 'all') {
        activeStatusFilter = "";
        document.getElementById('sectionHeader').innerText = "Semua Daftar Anime";
    } else if (type === 'ongoing') {
        activeStatusFilter = "Ongoing";
        document.getElementById('sectionHeader').innerText = "Anime Ongoing Terbaru";
    } else if (type === 'finished') {
        activeStatusFilter = "Finished";
        document.getElementById('sectionHeader').innerText = "Anime Finished";
    }
    loadAnimeDatabase(1);
}

function toggleTheme() {
    const html = document.documentElement;
    html.classList.toggle('dark');
    const floatingIcon = document.getElementById('floatingThemeIcon');
    if (floatingIcon) {
        floatingIcon.classList.toggle('fa-sun');
        floatingIcon.classList.toggle('fa-moon');
    }
}

window.onload = async function() {
    handleAniListOAuthCallback();
    await checkAniListAuthStatus();
    renderHistory();
    await loadAnimeDatabase(1);
};
