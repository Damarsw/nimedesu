document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

function onTurnstileSuccess(token) {
    const turnstileContainer = document.getElementById('turnstileContainer');
    if (turnstileContainer) {
        turnstileContainer.style.display = 'none';
    }

    document.getElementById('mainHeader')?.classList.remove('hidden');
    document.getElementById('mainContent')?.classList.remove('hidden');
    document.getElementById('mainFooter')?.classList.remove('hidden');
}

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
let searchDebounceTimer = null;

let currentInfoType = 'bypopularity';
let currentInfoPage = 1;

let userBookmarksCache = [];
let scoreLocalCache = {};
try {
    scoreLocalCache = JSON.parse(localStorage.getItem('nimedesu_scores_cache') || '{}');
} catch (e) {
    scoreLocalCache = {};
}

const RENDER_API_URL = "/api-backend";

function getTurnstileToken() {
    return document.querySelector('[name="cf-turnstile-response"]')?.value || "";
}

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
    
    if (daysUntilSunday === 0) {
        daysUntilSunday = 7;
    }
    
    result.setDate(now.getDate() + daysUntilSunday);
    result.setHours(0, 0, 0, 0);
    return result.getTime();
}

function getCachedScore(title, defaultScore) {
    if (defaultScore && defaultScore !== '-' && defaultScore !== 'N/A') {
        return defaultScore;
    }
    if (!title) return 'N/A';
    
    const cleanTitle = title.replace(/([a-zA-Z0-9])x([a-zA-Z0-9])/gi, '$1 x $2').toLowerCase().trim();
    const cachedData = scoreLocalCache[cleanTitle];

    if (cachedData) {
        if (typeof cachedData === 'string') return cachedData;

        const now = Date.now();
        if (cachedData.expiresAt && now < cachedData.expiresAt) {
            return cachedData.score;
        }
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
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });
        const result = await response.json();
        const score = result?.score;
        const targetEl = document.getElementById(elementId);

        if (score && score !== 'N/A') {
            scoreLocalCache[cacheKey] = {
                score: score,
                expiresAt: getNextSundayMidnightTimestamp()
            };

            try {
                localStorage.setItem('nimedesu_scores_cache', JSON.stringify(scoreLocalCache));
            } catch (e) {}

            if (targetEl) {
                targetEl.innerHTML = `★ ${score}`;
            }
        }
    } catch (err) {}
}

function isAnimeBookmarked(anime) {
    if (!userBookmarksCache || userBookmarksCache.length === 0 || !anime) return false;
    
    const targetId = String(anime.id || anime.anime_id || "");
    const titleUser = (anime.title?.userPreferred || anime.title?.romaji || anime.title?.english || anime.title || "").toLowerCase().trim();
    const titleRomaji = (anime.title?.romaji || "").toLowerCase().trim();
    const titleEnglish = (anime.title?.english || "").toLowerCase().trim();

    return userBookmarksCache.some(b => {
        const bId = String(b.id || b.anime_id || "");
        const bTitle = (b.title || "").toLowerCase().trim();

        if (targetId && bId && targetId === bId) return true;
        if (bTitle) {
            if (bTitle === titleUser) return true;
            if (titleRomaji && bTitle === titleRomaji) return true;
            if (titleEnglish && bTitle === titleEnglish) return true;
        }
        return false;
    });
}

function getUserIdentifier(user) {
    if (!user) return null;
    return user.name || String(user.id);
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
                "X-Client-Time": sec.time,
                "X-Turnstile-Token": getTurnstileToken()
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
            return result.cookies;
        }
        return null;
    } catch (err) {
        console.error("Gagal sync user:", err);
        return null;
    }
}

async function getSupabaseUserData(user) {
    if (!user) return { history: [], bookmarks: [] };
    const identifier = getUserIdentifier(user);

    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/user-data?anilist_id=${encodeURIComponent(identifier)}`, {
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });
        const result = await res.json();
        const cookies = result.cookies || {};
        userBookmarksCache = Array.isArray(cookies.bookmarks) ? cookies.bookmarks : [];
        return {
            history: Array.isArray(cookies.history) ? cookies.history : [],
            bookmarks: userBookmarksCache,
            user_info: cookies.user_info || {}
        };
    } catch (err) {
        console.error("Gagal mengambil data user:", err);
        return { history: [], bookmarks: [] };
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
                "X-Client-Time": sec.time,
                "X-Turnstile-Token": getTurnstileToken()
            },
            body: JSON.stringify({
                anilist_id: identifier,
                cookies: payload
            })
        });
        const result = await res.json();
        userBookmarksCache = payload.bookmarks || [];
        return result.status === "success";
    } catch (err) {
        console.error("Gagal update data user:", err);
        return false;
    }
}

async function toggleBookmarkAnime(animeObjOrId, buttonEl) {
    const user = getLoggedInUser();
    if (!user) {
        alert("Silakan login dengan akun AniList terlebih dahulu untuk menyimpan bookmark!");
        loginAniList();
        return;
    }

    let animeObj = null;
    if (typeof animeObjOrId === 'object' && animeObjOrId !== null) {
        animeObj = animeObjOrId;
    } else {
        animeObj = currentData.find(a => String(a.id) === String(animeObjOrId));
    }

    if (!animeObj) return;

    try {
        const userData = await getSupabaseUserData(user);
        let bookmarks = userData.bookmarks || [];

        const bookmarkItem = {
            id: animeObj.id,
            anime_id: animeObj.id,
            title: animeObj.title?.userPreferred || animeObj.title?.romaji || animeObj.title?.english || animeObj.title || "Anime",
            url: animeObj.url || "",
            thumbnail: animeObj.coverImage?.extraLarge || animeObj.coverImage?.large || animeObj.thumbnail || "https://placehold.co/400x600?text=No+Image",
            status: animeObj.status || "Ongoing",
            skor: animeObj.skor || animeObj.score || "-",
            genres: animeObj.genres || [],
            synopsis: animeObj.synopsis || "Sinopsis belum tersedia.",
            addedAt: new Date().toISOString()
        };

        const existsIndex = bookmarks.findIndex(b => {
            if (String(b.id || b.anime_id) === String(bookmarkItem.id)) return true;
            if (b.title?.toLowerCase() === bookmarkItem.title?.toLowerCase()) return true;
            return false;
        });

        if (existsIndex > -1) {
            bookmarks.splice(existsIndex, 1);
            alert(`"${bookmarkItem.title}" dihapus dari Bookmark!`);
            if (buttonEl) {
                const icon = buttonEl.querySelector('i');
                if (icon) icon.className = 'fa-regular fa-bookmark text-xs text-zinc-300';
            }
        } else {
            bookmarks.unshift(bookmarkItem);
            alert(`"${bookmarkItem.title}" berhasil disimpan ke Bookmark!`);
            if (buttonEl) {
                const icon = buttonEl.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-bookmark text-xs text-neon-yellow';
            }
        }

        userData.bookmarks = bookmarks;
        await saveSupabaseUserData(user, userData);

        if (isBookmarkViewActive) {
            loadBookmarkTab(currentPage);
        }

    } catch (err) {
        console.error("Gagal toggle bookmark:", err);
        alert("Terjadi kesalahan saat memproses bookmark.");
    }
}

function addAniListBookmark(animeOrMediaId, buttonEl) {
    toggleBookmarkAnime(animeOrMediaId, buttonEl);
}

async function loadBookmarkTab(page = 1) {
    isBookmarkViewActive = true;
    currentPage = page;

    const user = getLoggedInUser();
    const container = document.getElementById('animeDisplayGrid');
    const paginationBox = document.getElementById('paginationBox');

    if (!user) {
        container.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 space-y-4 text-center">
                <i class="fa-regular fa-bookmark text-4xl text-neon-yellow"></i>
                <p class="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300 max-w-sm">Fitur Bookmark terkunci. Silakan login terlebih dahulu untuk mengakses daftar bookmark Anda.</p>
                <button onclick="loginAniList()" class="px-5 py-2.5 rounded-full bg-neon-yellow text-black text-xs font-bold shadow-glow-yellow transition hover:opacity-90">Login AniList</button>
            </div>
        `;
        paginationBox.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-16 space-y-3">
            <i class="fa-solid fa-spinner fa-spin text-2xl text-black dark:text-neon-yellow"></i>
            <p class="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300">Memuat data bookmark dari database...</p>
        </div>
    `;

    const userData = await getSupabaseUserData(user);
    const bookmarks = userData.bookmarks || [];

    if (bookmarks.length === 0) {
        container.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 space-y-3 text-center">
                <i class="fa-regular fa-bookmark text-3xl text-zinc-400"></i>
                <p class="text-zinc-600 dark:text-zinc-400 text-xs sm:text-sm font-medium">Belum ada anime yang Anda bookmark. Klik ikon <i class="fa-regular fa-bookmark"></i> pada poster anime untuk menyimpan.</p>
            </div>
        `;
        paginationBox.innerHTML = '';
        return;
    }

    currentData = bookmarks.map((b, idx) => ({
        id: b.id || b.anime_id || (idx + 1),
        title: b.title || "Tanpa Judul",
        url: b.url || "",
        status: b.status || "Ongoing",
        genres: b.genres || [],
        synopsis: b.synopsis || "Sinopsis belum tersedia.",
        thumbnail: b.thumbnail || "https://placehold.co/400x600?text=No+Image",
        japanese: b.japanese || "-",
        skor: b.skor || b.score || "-",
        statusText: b.status || "-",
        totalEpisode: b.totalEpisode || "-",
        durasi: b.durasi || "-",
        tanggalRilis: b.tanggalRilis || "-",
        studio: b.studio || "-"
    }));

    totalPages = Math.max(1, Math.ceil(currentData.length / itemsPerPage));
    const startIdx = (page - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const pageItems = currentData.slice(startIdx, endIdx);

    renderBookmarkGrid(pageItems);
}

function renderBookmarkGrid(items) {
    const container = document.getElementById('animeDisplayGrid');
    const paginationBox = document.getElementById('paginationBox');

    container.innerHTML = items.map(item => {
        const scoreBadgeId = `homeScore_${item.id}`;
        setTimeout(() => { fetchAniListScoreForCard(item.title, scoreBadgeId, item.skor); }, 50);

        const cachedScore = getCachedScore(item.title, item.skor);

        return `
            <div class="group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer" onclick="viewDetails('${item.id}')">
                <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                    <img src="${item.thumbnail}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                    <div class="play-overlay absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center">
                        <div class="w-12 h-12 rounded-full bg-neon-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition duration-300">
                            <i class="fa-solid fa-circle-info ml-0.5 text-base"></i>
                        </div>
                    </div>
                    <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${item.status}</span>
                    <span id="${scoreBadgeId}" class="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md text-neon-yellow text-[10px] font-bold px-2 py-0.5 rounded-full shadow z-10">★ ${cachedScore}</span>
                    
                    <button onclick="event.stopPropagation(); toggleBookmarkAnime('${item.id}', this)" title="Hapus dari Bookmark" class="absolute top-2 right-2 p-2 rounded-full bg-black/70 backdrop-blur-md text-neon-yellow hover:scale-110 transition z-20 shadow-md">
                        <i class="fa-solid fa-bookmark text-xs"></i>
                    </button>
                </div>
                <div class="p-3">
                    <h4 class="font-semibold text-xs sm:text-sm line-clamp-2 text-black dark:text-white">${item.title}</h4>
                </div>
            </div>
        `;
    }).join('');

    let paginationHTML = '';
    const baseBtnClass = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow transition shadow-xs';
    const disabledBtnClass = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-not-allowed';

    paginationHTML += `<button class="${currentPage > 1 ? baseBtnClass : disabledBtnClass}" ${currentPage <= 1 ? 'disabled' : ''} onclick="loadBookmarkTab(1)">&laquo;</button>`;
    paginationHTML += `<button class="${currentPage > 1 ? baseBtnClass : disabledBtnClass}" ${currentPage <= 1 ? 'disabled' : ''} onclick="loadBookmarkTab(${currentPage - 1})">&lsaquo;</button>`;

    const isMobile = window.innerWidth < 640;
    const maxVisibleRange = isMobile ? 1 : 2;

    let startPage = Math.max(1, currentPage - maxVisibleRange);
    let endPage = Math.min(totalPages, currentPage + maxVisibleRange);

    if (isMobile) {
        if (currentPage === 1) {
            endPage = Math.min(totalPages, 3);
        } else if (currentPage === totalPages) {
            startPage = Math.max(1, totalPages - 2);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'bg-neon-yellow text-black font-bold border-neon-yellow shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder shadow-xs';
        paginationHTML += `<button class="w-9 h-9 rounded-lg text-xs font-semibold border ${activeClass} transition" onclick="loadBookmarkTab(${i})">${i}</button>`;
    }

    paginationHTML += `<button class="${currentPage < totalPages ? baseBtnClass : disabledBtnClass}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="loadBookmarkTab(${currentPage + 1})">&rsaquo;</button>`;
    paginationHTML += `<button class="${currentPage < totalPages ? baseBtnClass : disabledBtnClass}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="loadBookmarkTab(${totalPages})">&raquo;</button>`;

    paginationBox.innerHTML = paginationHTML;
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
    if (!ANILIST_CLIENT_ID || ANILIST_CLIENT_ID === "YOUR_ANILIST_CLIENT_ID") {
        alert("Client ID AniList belum diatur.");
        return;
    }
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

    if (!token) {
        if (userWelcomeBanner) userWelcomeBanner.classList.add('hidden');
        return;
    }

    const query = `query { Viewer { id name avatar { medium } } }`;
    try {
        const response = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ query: query })
        });
        const result = await response.json();
        const user = result?.data?.Viewer;

        if (user) {
            localStorage.setItem('anilist_user', JSON.stringify(user));

            if (headerAuthContainer) {
                headerAuthContainer.innerHTML = `
                    <div class="flex items-center bg-white dark:bg-zinc-800/90 p-0.5 rounded-full border border-neon-yellow shadow-xs">
                        <img src="${user.avatar.medium}" class="w-7 h-7 rounded-full object-cover">
                    </div>
                `;
            }

            if (sidebarAuthBtn) {
                sidebarAuthBtn.innerHTML = `
                    <button onclick="logoutAniList()" class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-500/20 text-red-500 transition text-left">
                        <i class="fa-solid fa-right-from-bracket w-5 text-center"></i> Logout (${user.name})
                    </button>
                `;
            }

            if (userWelcomeBanner && userWelcomeName) {
                userWelcomeName.innerText = user.name;
                if (userWelcomeAvatarContainer) {
                    userWelcomeAvatarContainer.innerHTML = `<img src="${user.avatar.medium}" class="w-10 h-10 rounded-full border border-neon-yellow object-cover shadow-sm">`;
                }
                
                const bannerLogoutBtn = userWelcomeBanner.querySelector('button');
                if (bannerLogoutBtn) bannerLogoutBtn.style.display = 'none';

                userWelcomeBanner.classList.remove('hidden');
            }

            await syncUserWithSupabase(user);
            renderHistory();
        }
    } catch (err) {
        console.error("Auth check failed:", err);
    }
}

/* =========================================================
   RIWAYAT TONTONAN (MENGGUNAKAN ANIME_ID)
   ========================================================= */
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
                const uniqueImgId = `histImg_${idx}_${Date.now()}`;
                const isNoImage = !item.thumbnail || item.thumbnail.includes('placehold.co') || item.thumbnail === '';

                if (isNoImage && (item.anime_id || item.id)) {
                    setTimeout(async () => {
                        try {
                            const sec = generateSecurityToken();
                            const targetId = item.anime_id || item.id;
                            const res = await fetch(`${RENDER_API_URL}/anime-detail?id=${encodeURIComponent(targetId)}`, {
                                headers: {
                                    "X-Client-Token": sec.token,
                                    "X-Client-Time": sec.time
                                }
                            });
                            const data = await res.json();
                            const realImg = data.img_url || data.image_url || data.thumbnail;
                            if (realImg) {
                                const el = document.getElementById(uniqueImgId);
                                if (el) el.src = realImg;
                            }
                        } catch (e) {}
                    }, 50);
                }

                const displayImg = isNoImage ? "https://placehold.co/400x600?text=Memuat..." : item.thumbnail;
                const targetAnimeId = item.anime_id || item.id;

                return `
                    <div class="min-w-[140px] sm:min-w-[160px] w-[140px] sm:w-[160px] group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer shrink-0" onclick="window.location.href='stream.html?anime_id=${encodeURIComponent(targetAnimeId)}&eps=${item.lastEpisodeIndex || 0}'">
                        <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                            <img id="${uniqueImgId}" src="${displayImg}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                            <div class="play-overlay absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center">
                                <div class="w-12 h-12 rounded-full bg-neon-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition duration-300">
                                    <i class="fa-solid fa-play ml-0.5 text-base"></i>
                                </div>
                            </div>
                            <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">
                                ${item.lastWatchedEpisode || 'Eps 1'}
                            </span>
                        </div>
                        <div class="p-3">
                            <h4 class="font-semibold text-xs sm:text-sm line-clamp-2 text-black dark:text-white">${item.title}</h4>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.error("Gagal mengambil riwayat:", err);
    }
}

async function clearHistory() {
    const user = getLoggedInUser();
    if (!user) return;

    if (!confirm("Apakah Anda yakin ingin menghapus seluruh riwayat tontonan di database?")) return;

    try {
        const userData = await getSupabaseUserData(user);
        userData.history = [];
        await saveSupabaseUserData(user, userData);
        document.getElementById('historySection').classList.add('hidden');
    } catch (err) {
        console.error("Gagal menghapus riwayat:", err);
    }
}

function scrollToSearchResults() {
    const target = document.getElementById('btnBookmarkTab')?.parentElement || 
                   document.getElementById('btnSemua')?.parentElement || 
                   document.getElementById('sectionHeader') || 
                   document.getElementById('animeDisplayGrid');

    if (target) {
        const navbarOffset = 70;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navbarOffset;

        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    }
}

async function openDetailFromAniListTitle(title) {
    if (!title) return;
    try {
        const sec = generateSecurityToken();
        let searchQuery = title.replace(/([a-zA-Z0-9])x([a-zA-Z0-9])/gi, '$1 x $2').trim();
        const fetchUrl = `${RENDER_API_URL}/anime?q=${encodeURIComponent(searchQuery)}&per_page=10`;
        
        const res = await fetch(fetchUrl, {
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });
        const result = await res.json();
        const matchedList = result.data || [];

        if (matchedList.length > 0) {
            let matchedItem = null;
            const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanTarget = normalize(title);

            matchedItem = matchedList.find(item => normalize(item.title) === cleanTarget);
            if (!matchedItem) {
                matchedItem = matchedList.find(item => {
                    const itemTitleClean = normalize(item.title);
                    if (cleanTarget === "naruto" && itemTitleClean.includes("boruto")) return false;
                    return true;
                });
            }
            if (!matchedItem) matchedItem = matchedList[0];

            const cachedScore = getCachedScore(matchedItem.title, matchedItem.score);

            const animeObj = {
                id: matchedItem.id,
                title: matchedItem.title || title,
                url: matchedItem.url ? matchedItem.url.trim() : "",
                status: matchedItem.status || "Ongoing",
                genres: matchedItem.genre ? matchedItem.genre.split(',').map(g => g.trim()) : [],
                synopsis: matchedItem.synopsis || "Sinopsis belum tersedia.",
                thumbnail: matchedItem.img_url || matchedItem.image_url || "https://placehold.co/400x600?text=No+Image",
                japanese: matchedItem.japanese || "-",
                skor: cachedScore,
                statusText: matchedItem.status || "-",
                totalEpisode: matchedItem.total_episodes || "-",
                durasi: matchedItem.duration || "-",
                tanggalRilis: matchedItem.release_date || "-",
                studio: matchedItem.studio || "-"
            };

            const exists = currentData.some(a => a.id == animeObj.id);
            if (!exists) currentData.push(animeObj);

            viewDetails(animeObj.id);
        } else {
            alert(`Anime "${title}" belum tersedia di database NimeDesu.`);
        }
    } catch (err) {
        console.error("Gagal mencocokkan judul:", err);
        alert("Gagal menghubungkan ke server.");
    }
}

function switchView(viewName, shouldScrollToTop = true) {
    currentView = viewName;
    const views = ['homeView', 'detailView', 'dmcaView', 'informationView'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    if (viewName === 'home') {
        const home = document.getElementById('homeView');
        if (home) home.classList.remove('hidden');
        renderHistory();
    } else if (viewName === 'detail') {
        const detail = document.getElementById('detailView');
        if (detail) detail.classList.remove('hidden');
    } else if (viewName === 'dmca') {
        const dmca = document.getElementById('dmcaView');
        if (dmca) dmca.classList.remove('hidden');
    } else if (viewName === 'information') {
        const information = document.getElementById('informationView');
        if (information) information.classList.remove('hidden');
    }
    
    if (shouldScrollToTop) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebarMenu');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
}

function toggleInformationSubmenu(e) {
    if(e) e.stopPropagation();
    const submenu = document.getElementById('informationSubmenu');
    const icon = document.getElementById('informationMenuIcon');
    if (submenu.classList.contains('hidden')) {
        submenu.classList.remove('hidden');
        icon.classList.add('rotate-180');
    } else {
        submenu.classList.add('hidden');
        icon.classList.remove('rotate-180');
    }
}

async function loadAnimeDatabase(page = 1) {
    try {
        isBookmarkViewActive = false;
        currentPage = page;
        let fetchUrl = `${RENDER_API_URL}/anime?page=${page}&per_page=${itemsPerPage}`;
        
        if (activeSearchQuery) fetchUrl += `&q=${encodeURIComponent(activeSearchQuery)}`;
        if (activeStatusFilter) fetchUrl += `&status=${encodeURIComponent(activeStatusFilter)}`;
        if (activeGenreFilter) fetchUrl += `&genre=${encodeURIComponent(activeGenreFilter)}`;

        const sec = generateSecurityToken();
        const response = await fetch(fetchUrl, {
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });
        const result = await response.json();

        currentData = (result.data || []).map((item, index) => ({
            id: item.id || (index + 1),
            title: item.title || "Tanpa Judul",
            url: item.url ? item.url.trim() : "",
            status: item.status || "Ongoing",
            genres: item.genre ? item.genre.split(',').map(g => g.trim()) : [],
            synopsis: item.synopsis || "Sinopsis belum tersedia.",
            thumbnail: item.img_url || item.image_url || "https://placehold.co/400x600?text=No+Image",
            japanese: item.japanese || "-",
            skor: item.score || "-",
            statusText: item.status || "-",
            totalEpisode: item.total_episodes || "-",
            durasi: item.duration || "-",
            tanggalRilis: item.release_date || "-",
            studio: item.studio || "-"
        }));

        totalPages = result.total_pages || 1;
        displayAnimeWithPagination();

    } catch (error) {
        console.error("Gagal memuat API server:", error);
        document.getElementById('animeDisplayGrid').innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Gagal memuat data anime dari database.</p>`;
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
        const cachedScore = getCachedScore(item.title, item.skor);

        return `
            <div class="group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer" onclick="viewDetails('${item.id}')">
                <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                    <img src="${item.thumbnail}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                    <div class="play-overlay absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center">
                        <div class="w-12 h-12 rounded-full bg-neon-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition duration-300">
                            <i class="fa-solid fa-circle-info ml-0.5 text-base"></i>
                        </div>
                    </div>
                    <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${item.status}</span>
                    <span id="${scoreBadgeId}" class="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md text-neon-yellow text-[10px] font-bold px-2 py-0.5 rounded-full shadow z-10">★ ${cachedScore}</span>
                    
                    <button onclick="event.stopPropagation(); toggleBookmarkAnime('${item.id}', this)" title="Simpan Bookmark" class="absolute top-2 right-2 p-2 rounded-full bg-black/70 backdrop-blur-md hover:scale-110 transition z-20 shadow-md">
                        <i class="${isBookmarked ? 'fa-solid fa-bookmark text-neon-yellow' : 'fa-regular fa-bookmark text-zinc-300'} text-xs"></i>
                    </button>
                </div>
                <div class="p-3">
                    <h4 class="font-semibold text-xs sm:text-sm line-clamp-2 text-black dark:text-white">${item.title}</h4>
                </div>
            </div>
        `;
    }).join('');

    let paginationHTML = '';
    const baseBtnClass = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow transition shadow-xs';
    const disabledBtnClass = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-not-allowed';

    paginationHTML += `<button class="${currentPage > 1 ? baseBtnClass : disabledBtnClass}" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(1)">&laquo;</button>`;
    paginationHTML += `<button class="${currentPage > 1 ? baseBtnClass : disabledBtnClass}" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">&lsaquo;</button>`;

    const isMobile = window.innerWidth < 640;
    const maxVisibleRange = isMobile ? 1 : 2;

    let startPage = Math.max(1, currentPage - maxVisibleRange);
    let endPage = Math.min(totalPages, currentPage + maxVisibleRange);

    if (isMobile) {
        if (currentPage === 1) {
            endPage = Math.min(totalPages, 3);
        } else if (currentPage === totalPages) {
            startPage = Math.max(1, totalPages - 2);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'bg-neon-yellow text-black font-bold border-neon-yellow shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder shadow-xs';
        paginationHTML += `<button class="w-9 h-9 rounded-lg text-xs font-semibold border ${activeClass} transition" onclick="goToPage(${i})">${i}</button>`;
    }

    paginationHTML += `<button class="${currentPage < totalPages ? baseBtnClass : disabledBtnClass}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">&rsaquo;</button>`;
    paginationHTML += `<button class="${currentPage < totalPages ? baseBtnClass : disabledBtnClass}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${totalPages})">&raquo;</button>`;

    paginationBox.innerHTML = paginationHTML;
}

function goToPage(pageNumber) {
    if (isBookmarkViewActive) {
        loadBookmarkTab(pageNumber);
    } else {
        loadAnimeDatabase(pageNumber);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleSearchInput(event) {
    if(event) event.stopPropagation();
    const container = document.getElementById('searchContainer');
    const field = document.getElementById('searchField');
    const suggestions = document.getElementById('searchSuggestions');

    if (!container || !field) return;

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        field.focus();
        
        const len = field.value.length;
        field.setSelectionRange(len, len);

        if (field.value.trim() !== '') {
            liveSearchAnime();
        }
    } else {
        container.classList.add('hidden');
        if (suggestions) suggestions.classList.add('hidden');
    }
}

document.addEventListener('click', function(e) {
    const container = document.getElementById('searchContainer');
    const searchBoxWrapper = document.getElementById('searchBoxWrapper');
    const btnToggle = document.getElementById('btnSearchToggle');

    if (container && !container.classList.contains('hidden')) {
        const isClickInside = (searchBoxWrapper && searchBoxWrapper.contains(e.target)) ||
                              (btnToggle && btnToggle.contains(e.target));
        
        if (!isClickInside) {
            container.classList.add('hidden');
            const searchSuggestions = document.getElementById('searchSuggestions');
            if (searchSuggestions) searchSuggestions.classList.add('hidden');
        }
    }
});

function liveSearchAnime() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(async () => {
        const query = document.getElementById('searchField').value.trim();
        const suggestionsBox = document.getElementById('searchSuggestions');

        if (!query) {
            suggestionsBox.classList.add('hidden');
            suggestionsBox.innerHTML = '';
            return;
        }

        try {
            const sec = generateSecurityToken();
            const res = await fetch(`${RENDER_API_URL}/anime?q=${encodeURIComponent(query)}&per_page=6`, {
                headers: {
                    "X-Client-Token": sec.token,
                    "X-Client-Time": sec.time
                }
            });
            const result = await res.json();
            const matched = result.data || [];

            if (matched.length === 0) {
                suggestionsBox.innerHTML = `<p class="text-xs text-center text-zinc-500 py-3">Anime tidak ditemukan</p>`;
                suggestionsBox.classList.remove('hidden');
                return;
            }

            suggestionsBox.innerHTML = matched.map(anime => {
                const genres = anime.genre ? anime.genre.split(',').map(g => g.trim()).join(', ') : '-';
                const img = anime.img_url || anime.image_url || "https://placehold.co/100x150?text=No+Image";
                
                const animeData = JSON.stringify({
                    id: anime.id,
                    title: anime.title || "Tanpa Judul",
                    url: anime.url ? anime.url.trim() : "",
                    status: anime.status || "Ongoing",
                    genres: anime.genre ? anime.genre.split(',').map(g => g.trim()) : [],
                    synopsis: anime.sinopsis || "Sinopsis belum tersedia.",
                    thumbnail: img,
                    japanese: anime.japanese || "-",
                    skor: anime.score || "-",
                    statusText: anime.status || "-",
                    totalEpisode: anime.total_episodes || "-",
                    durasi: anime.duration || "-",
                    tanggalRilis: anime.release_date || "-",
                    studio: anime.studio || "-"
                }).replace(/'/g, "&apos;").replace(/"/g, '&quot;');

                return `
                    <div onclick="selectLiveSearchItem(${animeData})" class="flex items-center gap-3 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl cursor-pointer transition">
                        <img src="${img}" class="w-10 h-14 object-cover rounded-lg shrink-0">
                        <div class="overflow-hidden">
                            <h4 class="text-xs font-semibold text-black dark:text-white truncate">${anime.title}</h4>
                            <span class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate block">${genres}</span>
                        </div>
                    </div>
                `;
            }).join('');
            suggestionsBox.classList.remove('hidden');
        } catch (e) { console.error(e); }
    }, 300);
}

function selectLiveSearchItem(anime) {
    const searchContainer = document.getElementById('searchContainer');
    const searchSuggestions = document.getElementById('searchSuggestions');
    const searchField = document.getElementById('searchField');

    if (searchContainer) searchContainer.classList.add('hidden');
    if (searchSuggestions) searchSuggestions.classList.add('hidden');
    if (searchField) searchField.value = '';

    const exists = currentData.some(a => a.id == anime.id);
    if (!exists) currentData.push(anime);

    viewDetails(anime.id);
}

function resetTabActiveStyles() {
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
        b.classList.remove('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
        b.classList.add('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        const icon = b.querySelector('i');
        if (icon && icon.id !== 'genreArrow') {
            icon.classList.remove('text-black');
            icon.classList.add('dark:text-neon-yellow');
        }
    });
}

function toggleGenreContainer(e) {
    if (e) e.stopPropagation();
    const container = document.getElementById('genreContainer');
    const arrow = document.getElementById('genreArrow');
    const genreBtn = document.getElementById('btnGenre');

    if (!container) return;

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        if (arrow) arrow.style.transform = 'rotate(180deg)';

        resetTabActiveStyles();
        if (genreBtn) {
            genreBtn.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
            genreBtn.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
            
            const icon = genreBtn.querySelector('i');
            if (icon && icon.id !== 'genreArrow') icon.classList.remove('text-neon-yellow');
        }

        setTimeout(() => {
            const navbarOffset = 80;
            const targetPosition = container.getBoundingClientRect().top + window.pageYOffset - navbarOffset;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }, 50);

    } else {
        container.classList.add('hidden');
        if (arrow) arrow.style.transform = 'rotate(0deg)';

        if (!activeGenreFilter && genreBtn) {
            genreBtn.classList.remove('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
            genreBtn.classList.add('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        }
    }
}

function changeTab(type, element) {
    switchView('home');
    resetTabActiveStyles();

    const genreContainer = document.getElementById('genreContainer');
    const arrow = document.getElementById('genreArrow');
    if (genreContainer) genreContainer.classList.add('hidden');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
    if (element) {
        element.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        element.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    
        const icon = element.querySelector('i');
        if (icon) {
            icon.classList.remove('text-neon-yellow', 'dark:text-neon-yellow');
            icon.classList.add('text-black');
        }
}
    activeSearchQuery = "";
    activeGenreFilter = "";

    if (type === 'bookmark') {
        activeStatusFilter = "";
        document.getElementById('sectionHeader').innerText = "Daftar Bookmark Tersimpan";
        loadBookmarkTab(1);
        return;
    }

    if (type === 'all') {
        activeStatusFilter = "";
        document.getElementById('sectionHeader').innerText = "Semua Daftar Anime";
    } else if (type === 'ongoing') {
        activeStatusFilter = "Ongoing";
        document.getElementById('sectionHeader').innerText = "Anime Ongoing Terbaru";
    } else if (type === 'finished' || type === 'completed') {
        activeStatusFilter = "Finished";
        document.getElementById('sectionHeader').innerText = "Anime Finished";
    }
    loadAnimeDatabase(1);
}

function filterGenre(genre) {
    switchView('home');
    const genreContainer = document.getElementById('genreContainer');
    const arrow = document.getElementById('genreArrow');
    if (genreContainer) genreContainer.classList.add('hidden');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
    
    resetTabActiveStyles();
    const genreBtn = document.getElementById('btnGenre');
    if (genreBtn) {
        genreBtn.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        genreBtn.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    }

    activeSearchQuery = "";
    activeStatusFilter = "";
    activeGenreFilter = genre;
    document.getElementById('sectionHeader').innerText = `Genre: ${genre}`;
    loadAnimeDatabase(1);

    scrollToSearchResults();
}

function searchAnime() {
    const searchField = document.getElementById('searchField');
    const searchContainer = document.getElementById('searchContainer');
    const suggestionsBox = document.getElementById('searchSuggestions');
    
    const query = searchField ? searchField.value.trim() : "";

    if (searchContainer) searchContainer.classList.add('hidden');
    if (suggestionsBox) suggestionsBox.classList.add('hidden');

    if (searchField) {
        searchField.value = '';
        searchField.blur();
    }

    if (currentView === 'information') {
        activeInfoSearchQuery = query;
        const targetType = currentInfoType || 'bypopularity';
        if (!query) {
            openInformation(targetType, 1);
            return;
        }
        searchInformationRanking(query, targetType, 1);
        return;
    }

    activeSearchQuery = query;
    activeGenreFilter = "";
    const sectionHeader = document.getElementById('sectionHeader');
    if (sectionHeader) {
        sectionHeader.innerText = query ? `Hasil Pencarian: "${query}"` : "Semua Daftar Anime";
    }
    
    switchView('home', false);
    loadAnimeDatabase(1).then(() => {
        scrollToSearchResults();
    });
    scrollToSearchResults();
}

function viewDetails(id) {
    const anime = currentData.find(a => a.id == id);
    if(!anime) return;
    activeAnime = anime;

    switchView('detail');

    const cachedScore = getCachedScore(anime.title, anime.skor);

    document.getElementById('detTitle').innerText = anime.title;
    document.getElementById('detThumbnail').src = anime.thumbnail;
    document.getElementById('detStatusBadge').innerText = anime.status;
    document.getElementById('synopsisText').innerText = anime.sinopsis;

    document.getElementById('detJapanese').innerText = anime.japanese;
    document.getElementById('detSkor').innerText = cachedScore;
    document.getElementById('detStatus').innerText = anime.statusText;
    document.getElementById('detTotalEpisode').innerText = anime.totalEpisode;
    document.getElementById('detDurasi').innerText = anime.durasi;
    document.getElementById('detTanggalRilis').innerText = anime.tanggalRilis;
    document.getElementById('detStudio').innerText = anime.studio;

    const genreLinksContainer = document.getElementById('detGenreLinks');
    if (anime.genres && anime.genres.length > 0) {
        genreLinksContainer.innerHTML = anime.genres.map(genre => `
            <button onclick="filterGenre('${genre}')" class="bg-zinc-100 text-black dark:bg-neon-darkBg dark:text-neon-yellow border border-neon-yellow/40 hover:border-neon-yellow text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition shadow-xs">${genre}</button>
        `).join('');
    } else {
        genreLinksContainer.innerHTML = '<span class="text-xs text-zinc-500">-</span>';
    }
}

function openStreamingTab() {
    if (!activeAnime || !activeAnime.id) return;
    window.open(`stream.html?anime_id=${encodeURIComponent(activeAnime.id)}&eps=0`, '_blank');
}

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    
    const floatingIcon = document.getElementById('floatingThemeIcon');

    if (isDark) {
        html.classList.remove('dark');
        if (floatingIcon) floatingIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
        html.classList.add('dark');
        if (floatingIcon) floatingIcon.classList.replace('fa-moon', 'fa-sun');
    }
}

function setInfoTabActive(type) {
    document.querySelectorAll('.info-tab-btn').forEach(b => {
        b.className = 'info-tab-btn px-4 py-2 rounded-full bg-neon-lightCard dark:bg-neon-darkCard text-xs font-semibold border border-neon-yellow/60 dark:border-neon-darkBorder transition text-black dark:text-white shadow-xs';
        
        const icon = b.querySelector('i');
        if (icon) {
            icon.className = icon.className.replace(/text-\S+/g, '');
            icon.classList.add('text-black', 'dark:text-neon-yellow');
        }
    });
    
    let activeBtnId = 'infoBtnPopularity';
    if (type === 'upcoming') activeBtnId = 'infoBtnUpcoming';
    if (type === 'favorite') activeBtnId = 'infoBtnFavorite';
    
    const activeBtn = document.getElementById(activeBtnId);
    if (activeBtn) {
        activeBtn.className = 'info-tab-btn px-4 py-2 rounded-full bg-neon-yellow text-black text-xs font-bold shadow-glow-yellow transition';
        
        const activeIcon = activeBtn.querySelector('i');
        if (activeIcon) {
            activeIcon.className = activeIcon.className.replace(/text-\S+/g, '');
            activeIcon.classList.add('text-black');
        }
    }
}

function openInformation(type, page = 1) {
    activeInfoSearchQuery = "";
    currentInfoType = type;
    currentInfoPage = page;
    
    switchView('information');
    setInfoTabActive(type);
    
    const headerEl = document.getElementById('informationHeader');
    const descEl = document.getElementById('informationDescription');
    if (type === 'upcoming') {
        headerEl.innerText = 'Upcoming Anime';
        descEl.innerText = 'Daftar anime yang paling ditunggu-tunggu.';
    } else if (type === 'bypopularity') {
        headerEl.innerText = 'Peringkat Popularitas (Top Trending)';
        descEl.innerText = 'Daftar anime terpopuler.';
    } else if (type === 'favorite') {
        headerEl.innerText = 'Highest Rated Anime';
        descEl.innerText = 'Daftar anime dengan skor evaluasi tertinggi.';
    }
    
    const loadingEl = document.getElementById('informationLoading');
    const podiumEl = document.getElementById('podiumSection');
    const gridEl = document.getElementById('informationGrid');
    const paginationEl = document.getElementById('informationPagination');
    
    loadingEl.classList.remove('hidden');
    podiumEl.classList.add('hidden');
    gridEl.innerHTML = '';
    paginationEl.innerHTML = '';
    
    fetchRankingFromBackend(type, page, loadingEl, podiumEl, gridEl, paginationEl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function searchInformationRanking(query, type = (currentInfoType || 'bypopularity'), page = 1) {
    activeInfoSearchQuery = query;
    currentInfoType = type;
    currentInfoPage = page;
    
    switchView('information');
    setInfoTabActive(type);

    const headerEl = document.getElementById('informationHeader');
    const descEl = document.getElementById('informationDescription');
    
    if (type === 'upcoming') {
        if (headerEl) headerEl.innerText = `Hasil Pencarian Upcoming: "${query}"`;
        if (descEl) descEl.innerText = `Menampilkan anime mendatang untuk pencarian "${query}".`;
    } else if (type === 'favorite') {
        if (headerEl) headerEl.innerText = `Hasil Pencarian Highest Rated: "${query}"`;
        if (descEl) descEl.innerText = `Menampilkan peringkat evaluasi tertinggi untuk pencarian "${query}".`;
    } else {
        if (headerEl) headerEl.innerText = `Hasil Pencarian Top Trending: "${query}"`;
        if (descEl) descEl.innerText = `Menampilkan peringkat popularitas anime untuk pencarian "${query}".`;
    }

    const loadingEl = document.getElementById('informationLoading');
    const podiumEl = document.getElementById('podiumSection');
    const gridEl = document.getElementById('informationGrid');
    const paginationEl = document.getElementById('informationPagination');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (podiumEl) podiumEl.classList.add('hidden');
    if (gridEl) gridEl.innerHTML = '';
    if (paginationEl) paginationEl.innerHTML = '';

    const perPage = 12;

    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/anime?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`, {
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });
        const json = await res.json();
        const items = json.data || [];
        const lastPage = json.total_pages || 1;

        if (loadingEl) loadingEl.classList.add('hidden');

        if (items.length === 0) {
            if (gridEl) gridEl.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Anime "${query}" tidak ditemukan.</p>`;
            return;
        }

        if (gridEl) {
            gridEl.innerHTML = items.map(anime => {
                const realRank = anime.score ? `★ ${anime.score}` : '-';
                return renderRankListItem(anime, realRank);
            }).join('');
        }
        renderSearchInfoPagination(query, type, page, lastPage, paginationEl);
    } catch (fallbackErr) {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (gridEl) gridEl.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Gagal memuat hasil pencarian peringkat.</p>`;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSearchInfoPagination(query, type, page, totalPageCount, paginationEl) {
    if (!paginationEl || totalPageCount <= 1) {
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }
    let pagHTML = '';
    const baseBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow transition shadow-xs';
    const disBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-not-allowed';
    const escapedQuery = query.replace(/'/g, "\\'");

    pagHTML += `<button class="${page > 1 ? baseBtn : disBtn}" ${page <= 1 ? 'disabled' : ''} onclick="openInformation('${type}', ${page - 1})">&lsaquo;</button>`;
    
    const isMobile = window.innerWidth < 640;
    const maxVisibleRange = isMobile ? 1 : 2;

    let sPage = Math.max(1, page - maxVisibleRange);
    let ePage = Math.min(totalPageCount, page + maxVisibleRange);

    if (isMobile) {
        if (page === 1) {
            ePage = Math.min(totalPageCount, 3);
        } else if (page === totalPageCount) {
            sPage = Math.max(1, totalPageCount - 2);
        }
    }
    
    for (let i = sPage; i <= ePage; i++) {
        let actClass = i === page ? 'bg-neon-yellow text-black font-bold border-neon-yellow shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder shadow-xs';
        pagHTML += `<button class="w-9 h-9 rounded-lg text-xs font-semibold border ${actClass} transition" onclick="searchInformationRanking('${escapedQuery}', '${type}', ${i})">${i}</button>`;
    }
    
    pagHTML += `<button class="${page < totalPageCount ? baseBtn : disBtn}" ${page >= totalPageCount ? 'disabled' : ''} onclick="openInformation('${type}', ${page + 1})">&rsaquo;</button>`;
    
    paginationEl.innerHTML = pagHTML;
}

function formatNumberShort(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return num.toString();
}

async function fetchRankingFromBackend(type, page, loadingEl, podiumEl, gridEl, paginationEl) {
    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/ranking?type=${encodeURIComponent(type)}&page=${page}`, {
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });
        const json = await res.json();
        
        loadingEl.classList.add('hidden');

        const top3Data = json.top3 || [];
        const listData = json.list || [];
        const lastPage = json.last_page || 1;

        if (top3Data.length >= 3) {
            renderPodiumData(top3Data);
            podiumEl.classList.remove('hidden');
        }

        const startRankOffset = page === 1 ? 4 : ((page - 1) * 12 + 4);
        gridEl.innerHTML = listData.map((anime, idx) => renderRankListItem(anime, startRankOffset + idx)).join('');

        renderInfoPagination(type, page, lastPage, paginationEl);

    } catch (err) {
        console.error("Gagal memuat ranking:", err);
        loadingEl.classList.add('hidden');
        gridEl.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Gagal memuat data peringkat.</p>`;
    }
}

function renderPodiumData(top3) {
    top3.forEach((r, index) => {
        const rankIdx = index + 1;
        const title = r.title?.userPreferred || r.title?.romaji || r.title?.english || 'Tanpa Judul';
        const imgEl = document.getElementById(`podium${rankIdx}Img`);
        const titleEl = document.getElementById(`podium${rankIdx}Title`);
        const scoreEl = document.getElementById(`podium${rankIdx}Score`);
        const popEl = document.getElementById(`podium${rankIdx}Pop`);
        const clickArea = document.getElementById(`podium${rankIdx}ClickArea`);
        const btn = document.getElementById(`podium${rankIdx}BookmarkBtn`);

        if (imgEl) imgEl.src = r.coverImage?.extraLarge || r.coverImage?.large;
        if (titleEl) titleEl.innerText = title;
        if (scoreEl) scoreEl.innerHTML = `<i class="fa-solid fa-star text-[10px]"></i> ${r.averageScore ? (r.averageScore / 10).toFixed(1) : 'N/A'}`;
        if (popEl) popEl.innerHTML = `<i class="fa-solid fa-bookmark text-[10px]"></i> ${formatNumberShort(r.popularity)}`;

        if (clickArea) clickArea.onclick = () => openDetailFromAniListTitle(title);
        if (titleEl) titleEl.onclick = () => openDetailFromAniListTitle(title);

        const isBookmarked = isAnimeBookmarked(r);
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = isBookmarked ? 'fa-solid fa-bookmark text-xs text-neon-yellow' : 'fa-regular fa-bookmark text-xs text-zinc-300';
            }
            btn.onclick = function(e) {
                e.stopPropagation();
                toggleBookmarkAnime(r, this);
            };
        }
    });
}

function renderRankListItem(anime, rankNumber) {
    const title = anime.title?.userPreferred || anime.title?.romaji || anime.title?.english || anime.title || 'Tanpa Judul';
    const img = anime.coverImage?.extraLarge || anime.coverImage?.large || anime.img_url || anime.image_url || anime.thumbnail || 'https://placehold.co/150x200?text=No+Image';
    const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : (anime.score || anime.skor || 'N/A');
    const pop = formatNumberShort(anime.popularity || 0);
    const escapedTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    const isBookmarked = isAnimeBookmarked(anime);

    let rankDisplay = "";
    if (typeof rankNumber === 'number') {
        rankDisplay = `#${rankNumber}`;
    } else if (typeof rankNumber === 'string') {
        rankDisplay = rankNumber.startsWith('#') ? rankNumber : (rankNumber === '-' || rankNumber === 'N/A' ? '#-' : `#${rankNumber}`);
    } else {
        rankDisplay = '#-';
    }

    return `
        <div class="bg-neon-lightCard dark:bg-neon-darkCard border border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow rounded-xl p-3 flex items-center gap-3.5 transition shadow-xs">
            <span class="font-extrabold text-xs sm:text-sm text-zinc-400 dark:text-zinc-500 w-9 text-center shrink-0">${rankDisplay}</span>
            <div onclick="openDetailFromAniListTitle('${escapedTitle}')" class="flex items-center gap-3.5 flex-grow min-w-0 cursor-pointer group">
                <img src="${img}" alt="${title}" class="w-12 h-16 object-cover rounded-lg shrink-0 bg-zinc-800 group-hover:scale-105 transition duration-200">
                <div class="flex-grow min-w-0">
                    <h4 class="font-bold text-black dark:text-white text-xs sm:text-sm truncate group-hover:text-neon-yellow transition">${title}</h4>
                    <div class="flex items-center gap-2 mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span class="flex items-center gap-1 text-neon-yellow font-semibold"><i class="fa-solid fa-star text-[10px]"></i> ${score}</span>
                        <span>•</span>
                        <span><i class="fa-solid fa-bookmark text-[10px]"></i> ${pop}</span>
                    </div>
                </div>
            </div>
            <button onclick="toggleBookmarkAnime(${JSON.stringify({ id: anime.id, anime_id: anime.id, title: title, thumbnail: img, score: score, popularity: pop }).replace(/"/g, '&quot;')}, this)" title="Simpan Bookmark" class="p-2 text-zinc-400 hover:text-neon-yellow transition shrink-0">
                <i class="${isBookmarked ? 'fa-solid fa-bookmark text-neon-yellow' : 'fa-regular fa-bookmark'} text-sm"></i>
            </button>
        </div>
    `;
}

function renderInfoPagination(type, page, totalPageCount, paginationEl) {
    if (!paginationEl || totalPageCount <= 1) {
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }
    let pagHTML = '';
    const baseBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow transition shadow-xs';
    const disBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-not-allowed';

    pagHTML += `<button class="${page > 1 ? baseBtn : disBtn}" ${page <= 1 ? 'disabled' : ''} onclick="openInformation('${type}', ${page - 1})">&lsaquo;</button>`;
    
    const isMobile = window.innerWidth < 640;
    const maxVisibleRange = isMobile ? 1 : 2;

    let sPage = Math.max(1, page - maxVisibleRange);
    let ePage = Math.min(totalPageCount, page + maxVisibleRange);

    if (isMobile) {
        if (page === 1) {
            ePage = Math.min(totalPageCount, 3);
        } else if (page === totalPageCount) {
            sPage = Math.max(1, totalPageCount - 2);
        }
    }
    
    for (let i = sPage; i <= ePage; i++) {
        let actClass = i === page ? 'bg-neon-yellow text-black font-bold border-neon-yellow shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder shadow-xs';
        pagHTML += `<button class="w-9 h-9 rounded-lg text-xs font-semibold border ${actClass} transition" onclick="openInformation('${type}', ${i})">${i}</button>`;
    }
    
    pagHTML += `<button class="${page < totalPageCount ? baseBtn : disBtn}" ${page >= totalPageCount ? 'disabled' : ''} onclick="openInformation('${type}', ${page + 1})">&rsaquo;</button>`;
    
    paginationEl.innerHTML = pagHTML;
}

window.onload = async function() {
    handleAniListOAuthCallback();
    await checkAniListAuthStatus();

    const defaultBtn = document.getElementById('btnSemua');
    if(defaultBtn) {
        defaultBtn.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        defaultBtn.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    }
    
    activeSearchQuery = "";
    activeGenreFilter = "";
    activeStatusFilter = "";

    const urlParams = new URLSearchParams(window.location.search);
    const queryParam = urlParams.get('q');
    if (queryParam) {
        activeSearchQuery = queryParam;
        const sectionHeader = document.getElementById('sectionHeader');
        if (sectionHeader) {
            sectionHeader.innerText = `Hasil Pencarian: "${queryParam}"`;
        }
    }

    renderHistory();
    await loadAnimeDatabase(1);

    if (queryParam) {
        scrollToSearchResults();
    }
};
