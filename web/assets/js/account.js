document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

function timtit() {
    return "timtit";
}

function hashAnilistID(rawId) {
    if (!rawId) return "";
    return CryptoJS.SHA256(String(rawId).toLowerCase().trim()).toString(CryptoJS.enc.Hex);
}

function encryptCookiesData(cookiesObj) {
    try {
        const jsonStr = JSON.stringify(cookiesObj);
        return CryptoJS.AES.encrypt(jsonStr, timtit()).toString();
    } catch (e) {
        return "";
    }
}

function decryptCookiesData(ciphertext) {
    if (!ciphertext) return { history: [], bookmarks: [] };
    if (typeof ciphertext === 'object') return ciphertext;

    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, timtit());
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedStr) return { history: [], bookmarks: [] };
        return JSON.parse(decryptedStr);
    } catch (e) {
        return { history: [], bookmarks: [] };
    }
}

function getOrCreateSessionID() {
    let sid = localStorage.getItem('nimedesu_session_id');
    if (!sid) {
        sid = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('nimedesu_session_id', sid);
    }
    return sid;
}

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
    const hashedID = hashAnilistID(identifier);
    const sessionID = getOrCreateSessionID();

    try {
        const sec = generateSecurityToken();
        const initialPayload = encryptCookiesData({
            history: [],
            bookmarks: [],
            user_info: { id: user.id, name: user.name, avatar: user.avatar?.medium || "" }
        });

        const res = await fetch(`${RENDER_API_URL}/user-sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time,
                "X-Turnstile-Token": getTurnstileToken()
            },
            body: JSON.stringify({
                anilist_id: hashedID,
                session_id: sessionID,
                cookies_encrypted: initialPayload
            })
        });

        const result = await res.json();
        if (result && result.cookies_encrypted) {
            const decrypted = decryptCookiesData(result.cookies_encrypted);
            userBookmarksCache = decrypted.bookmarks || [];
            return decrypted;
        }
        return null;
    } catch (err) {
        console.error("Gagal sync user:", err);
        return null;
    }
}

function handleInvalidSession() {
    alert("Sesi tidak valid / Anda telah di-logout dari perangkat lain. Silakan login kembali.");
    localStorage.removeItem('anilist_token');
    localStorage.removeItem('anilist_user');
    localStorage.removeItem('nimedesu_session_id');
    localStorage.removeItem('nimedesu_scores_cache');
    window.location.reload();
}

async function getSupabaseUserData(user) {
    if (!user) return { history: [], bookmarks: [] };
    const hashedID = hashAnilistID(getUserIdentifier(user));
    const sessionID = getOrCreateSessionID();

    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/user-data?anilist_id=${encodeURIComponent(hashedID)}&session_id=${encodeURIComponent(sessionID)}`, {
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });

        if (res.status === 401) {
            handleInvalidSession();
            return { history: [], bookmarks: [] };
        }

        const result = await res.json();
        const decryptedCookies = decryptCookiesData(result.cookies_encrypted);
        userBookmarksCache = Array.isArray(decryptedCookies.bookmarks) ? decryptedCookies.bookmarks : [];
        return decryptedCookies;
    } catch (err) {
        console.error("Gagal mengambil data user:", err);
        return { history: [], bookmarks: [] };
    }
}

async function saveSupabaseUserData(user, payload) {
    if (!user) return false;
    const hashedID = hashAnilistID(getUserIdentifier(user));
    const sessionID = getOrCreateSessionID();
    const encryptedPayload = encryptCookiesData(payload);

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
                anilist_id: hashedID,
                session_id: sessionID,
                cookies_encrypted: encryptedPayload
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

async function logoutOtherDevices() {
    const user = getLoggedInUser();
    if (!user) return;

    if (!confirm("Apakah Anda yakin ingin mengeluarkan akun dari semua perangkat lain?")) return;

    const hashedID = hashAnilistID(getUserIdentifier(user));
    const sessionID = getOrCreateSessionID();

    try {
        const sec = generateSecurityToken();
        const res = await fetch(`${RENDER_API_URL}/user-logout-others`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            },
            body: JSON.stringify({
                anilist_id: hashedID,
                current_session_id: sessionID
            })
        });

        const result = await res.json();
        if (res.ok && result.status === "success") {
            alert("Berhasil keluar dari semua perangkat lain!");
        } else {
            alert(result.message || "Gagal memproses logout perangkat lain.");
        }
    } catch (err) {
        alert("Terjadi kesalahan koneksi.");
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
    localStorage.removeItem('nimedesu_scores_cache');
    localStorage.removeItem('nimedesu_session_id');

    userBookmarksCache = [];
    currentData = [];

    alert("Berhasil logout! Silakan login kembali untuk mengakses data Anda.");
    window.location.href = window.location.pathname;
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

            // Validasi keberadaan sesi di Supabase
            const userData = await getSupabaseUserData(user);

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

                userWelcomeBanner.classList.remove('hidden');
            }

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
