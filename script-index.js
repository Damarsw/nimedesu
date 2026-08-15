document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

let currentData = [];
let currentPage = 1;
let totalPages = 1;
let activeAnime = null;
const itemsPerPage = 12;

let activeSearchQuery = "";
let activeStatusFilter = "";
let activeGenreFilter = "";

const RENDER_API_URL = "/api-backend";

/* =========================================================
   KONFIGURASI SUPABASE DATABASE
   ========================================================= */
const SUPABASE_URL = "https://yezdnsgypbjogzoftgmz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllemRuc2d5cGJqY2d6b2Z0Z216Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4ODc4OTUsImV4cCI6MjEwMDQ2Mzg5NX0.oTp6v4ahm0Ta654CuB7a13l9apBtUrD-Wyn-YTKYl7I";

const supabaseClient = (typeof window.supabase !== 'undefined' && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const KEY_X = "LayerX_Secret2026";
const KEY_Y = "LayerY_Secret2026";
const KEY_Z = "LayerZ_Secret2026";

function generateSecurityToken() {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawPayload = `${timestamp}_NimeDesuSecretKey2026`;
    const token = CryptoJS.SHA256(rawPayload).toString(CryptoJS.enc.Hex);
    return {
        token: token,
        time: timestamp.toString()
    };
}

/* =========================================================
   HELPER SUPABASE: REGISTRASI & AKSES COOKIES JSONB
   ========================================================= */
function getUserIdentifier(user) {
    if (!user) return null;
    return user.name || String(user.id);
}

// FUNGSI INI AKAN MENGECEK DAN MENAMBAHKAN USER KE DB JIKA BELUM ADA
async function syncUserWithSupabase(user) {
    if (!supabaseClient || !user) return null;
    const identifier = getUserIdentifier(user);

    try {
        // Cek apakah user (misal 'ninitesda') sudah ada di tabel login
        const { data: existingRow, error: selectErr } = await supabaseClient
            .from('login')
            .select('*')
            .or(`anilist_id.eq.${identifier},anilist_id.eq.${user.id}`)
            .maybeSingle();

        if (selectErr) {
            console.error("Error cek user di Supabase:", selectErr);
        }

        if (!existingRow) {
            // JIKA BELUM ADA -> TAMBAHKAN BARIS BARU KE TABEL LOGIN
            const initialCookies = {
                history: [],
                bookmarks: [],
                user_info: {
                    id: user.id,
                    name: user.name,
                    avatar: user.avatar?.medium || "",
                    first_login: new Date().toISOString()
                }
            };

            const { data: newRow, error: insertErr } = await supabaseClient
                .from('login')
                .insert({
                    anilist_id: identifier,
                    cookies: initialCookies
                })
                .select()
                .single();

            if (insertErr) {
                console.error("Gagal menambahkan user ke Supabase:", insertErr);
                return initialCookies;
            }
            console.log(`User ${identifier} berhasil didaftarkan ke database Supabase!`);
            return initialCookies;
        } else {
            // JIKA SUDAH ADA -> AMBIL AKSES KE COOKIES JSONB
            let cookiesData = existingRow.cookies || {};
            if (typeof cookiesData === 'string') {
                try { cookiesData = JSON.parse(cookiesData); } catch (e) { cookiesData = {}; }
            }
            return {
                history: Array.isArray(cookiesData.history) ? cookiesData.history : [],
                bookmarks: Array.isArray(cookiesData.bookmarks) ? cookiesData.bookmarks : [],
                user_info: cookiesData.user_info || {}
            };
        }
    } catch (err) {
        console.error("Gagal sinkronisasi akun dengan Supabase:", err);
        return null;
    }
}

async function getSupabaseUserData(user) {
    if (!supabaseClient || !user) return { history: [], bookmarks: [] };
    const identifier = getUserIdentifier(user);

    try {
        const { data, error } = await supabaseClient
            .from('login')
            .select('cookies')
            .or(`anilist_id.eq.${identifier},anilist_id.eq.${user.id}`)
            .maybeSingle();

        if (error || !data || !data.cookies) {
            return { history: [], bookmarks: [] };
        }

        let parsed = data.cookies;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (e) { parsed = {}; }
        }
        return {
            history: Array.isArray(parsed.history) ? parsed.history : [],
            bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
            user_info: parsed.user_info || {}
        };
    } catch (err) {
        console.error("Gagal membaca cookies JSONB dari Supabase:", err);
        return { history: [], bookmarks: [] };
    }
}

async function saveSupabaseUserData(user, payload) {
    if (!supabaseClient || !user) return false;
    const identifier = getUserIdentifier(user);

    try {
        const { data: existing } = await supabaseClient
            .from('login')
            .select('id, cookies')
            .or(`anilist_id.eq.${identifier},anilist_id.eq.${user.id}`)
            .maybeSingle();

        if (!payload.user_info) {
            payload.user_info = {
                id: user.id,
                name: user.name,
                avatar: user.avatar?.medium || "",
                last_updated: new Date().toISOString()
            };
        }

        if (existing && existing.id) {
            const { error } = await supabaseClient
                .from('login')
                .update({ cookies: payload })
                .eq('id', existing.id);
            if (error) throw error;
        } else {
            const { error } = await supabaseClient
                .from('login')
                .insert({
                    anilist_id: identifier,
                    cookies: payload
                });
            if (error) throw error;
        }
        return true;
    } catch (err) {
        console.error("Gagal menyimpan cookies JSONB ke Supabase:", err);
        return false;
    }
}

/* =========================================================
   INTEGRASI ANILIST OAUTH2 LOGIN
   ========================================================= */
const ANILIST_CLIENT_ID = "48567";

function getLoggedInUser() {
    const userStr = localStorage.getItem('anilist_user');
    const token = localStorage.getItem('anilist_token');
    if (!token || !userStr) return null;
    try {
        return JSON.parse(userStr);
    } catch (e) {
        return null;
    }
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
    alert("Berhasil logout! Sesi lokal ditutup.");
    location.reload();
}

async function checkAniListAuthStatus() {
    const token = localStorage.getItem('anilist_token');
    const headerAuthContainer = document.getElementById('headerAuthContainer');
    const sidebarAuthBtn = document.getElementById('sidebarAuthBtn');

    if (!token) return;

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
                    <div class="flex items-center gap-2 bg-white dark:bg-zinc-800/90 p-1 pr-3 rounded-full border border-neon-yellow shadow-xs">
                        <img src="${user.avatar.medium}" class="w-6 h-6 rounded-full object-cover">
                        <span class="text-xs font-bold text-black dark:text-neon-yellow max-w-[80px] truncate">${user.name}</span>
                        <button onclick="logoutAniList()" class="ml-1 text-[11px] text-black dark:text-zinc-400 hover:text-red-500 transition" title="Logout"><i class="fa-solid fa-right-from-bracket"></i></button>
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

            // EKSEKUSI PENAMBAHAN / SINKRONISASI KE SUPABASE
            await syncUserWithSupabase(user);

            // Render riwayat tontonan dari database
            renderHistory();
        }
    } catch (err) {
        console.error("Auth check failed:", err);
    }
}

/* =========================================================
   BOOKMARK SINKRONISASI SUPABASE (HANYA AKTIF JIKA LOGIN)
   ========================================================= */
async function addAniListBookmark(animeOrMediaId, buttonEl) {
    const user = getLoggedInUser();
    if (!user) {
        alert("Silakan login dengan akun AniList terlebih dahulu untuk menyimpan bookmark ke database!");
        loginAniList();
        return;
    }

    try {
        const userData = await getSupabaseUserData(user);
        let bookmarks = userData.bookmarks || [];

        let animeObj = null;
        if (typeof animeOrMediaId === 'object') {
            animeObj = animeOrMediaId;
        } else {
            animeObj = currentData.find(a => a.id == animeOrMediaId);
        }

        const bookmarkItem = {
            id: animeObj ? animeObj.id : animeOrMediaId,
            title: animeObj ? (animeObj.title?.userPreferred || animeObj.title || "Anime") : "Anime",
            thumbnail: animeObj ? (animeObj.coverImage?.extraLarge || animeObj.thumbnail || "https://placehold.co/150x200") : "https://placehold.co/150x200",
            score: animeObj ? (animeObj.averageScore ? (animeObj.averageScore / 10).toFixed(1) : animeObj.skor || "-") : "-",
            popularity: animeObj ? (animeObj.popularity ? formatNumberShort(animeObj.popularity) : "-") : "-",
            addedAt: new Date().toISOString()
        };

        const existsIndex = bookmarks.findIndex(b => String(b.id) === String(bookmarkItem.id));
        if (existsIndex > -1) {
            bookmarks.splice(existsIndex, 1);
            alert("Dihapus dari Bookmark!");
            if (buttonEl) {
                const icon = buttonEl.querySelector('i');
                if (icon) icon.className = 'fa-regular fa-bookmark';
            }
        } else {
            bookmarks.unshift(bookmarkItem);
            alert("Berhasil disimpan ke Bookmark di Database!");
            if (buttonEl) {
                const icon = buttonEl.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-bookmark text-neon-yellow';
            }
        }

        userData.bookmarks = bookmarks;
        await saveSupabaseUserData(user, userData);

        if (currentInfoType === 'bookmark') {
            openInformation('bookmark', currentInfoPage);
        }
    } catch (err) {
        console.error("Gagal sinkron bookmark ke Supabase:", err);
        alert("Terjadi kesalahan saat menyinkronkan bookmark.");
    }
}

async function fetchAniListBookmarks(page, loadingEl, podiumEl, gridEl, paginationEl) {
    const user = getLoggedInUser();

    if (!user) {
        loadingEl.classList.add('hidden');
        gridEl.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 space-y-4 text-center">
                <i class="fa-regular fa-bookmark text-3xl text-neon-yellow"></i>
                <p class="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300 max-w-xs">Fitur Bookmark terkunci. Silakan login terlebih dahulu untuk mengakses bookmark tersimpan Anda di database.</p>
                <button onclick="loginAniList()" class="px-4 py-2 rounded-full bg-neon-yellow text-black text-xs font-bold shadow-glow-yellow transition hover:opacity-90">Login AniList</button>
            </div>`;
        return;
    }

    try {
        const userData = await getSupabaseUserData(user);
        const entries = userData.bookmarks || [];

        loadingEl.classList.add('hidden');

        if (entries.length === 0) {
            gridEl.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Belum ada anime yang Anda bookmark di database. Tekan ikon <i class="fa-regular fa-bookmark"></i> pada poster anime untuk menambahkan.</p>`;
            return;
        }

        const perPage = 12;
        const totalPageCount = Math.max(1, Math.ceil(entries.length / perPage));
        const pageEntries = entries.slice((page - 1) * perPage, page * perPage);

        gridEl.innerHTML = pageEntries.map((bItem, idx) => {
            const rankNum = (page - 1) * perPage + idx + 1;
            const escapedTitle = bItem.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `
                <div class="bg-neon-lightCard dark:bg-neon-darkCard border border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow rounded-xl p-3 flex items-center gap-3.5 transition shadow-xs">
                    <span class="font-extrabold text-sm sm:text-base text-zinc-400 dark:text-zinc-500 w-7 text-center shrink-0">#${rankNum}</span>
                    <div onclick="openDetailFromAniListTitle('${escapedTitle}')" class="flex items-center gap-3.5 flex-grow min-w-0 cursor-pointer group">
                        <img src="${bItem.thumbnail}" alt="${bItem.title}" class="w-12 h-16 object-cover rounded-lg shrink-0 bg-zinc-800 group-hover:scale-105 transition duration-200">
                        <div class="flex-grow min-w-0">
                            <h4 class="font-bold text-black dark:text-white text-xs sm:text-sm truncate group-hover:text-neon-yellow transition">${bItem.title}</h4>
                            <div class="flex items-center gap-2 mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                <span class="flex items-center gap-1 text-neon-yellow font-semibold"><i class="fa-solid fa-star text-[10px]"></i> ${bItem.score}</span>
                                <span>•</span>
                                <span><i class="fa-solid fa-bookmark text-[10px]"></i> ${bItem.popularity}</span>
                            </div>
                        </div>
                    </div>
                    <button onclick="addAniListBookmark('${bItem.id}', this)" title="Hapus dari Bookmark" class="p-2 text-neon-yellow hover:text-red-500 transition shrink-0">
                        <i class="fa-solid fa-bookmark"></i>
                    </button>
                </div>
            `;
        }).join('');

        renderInfoPagination('bookmark', page, totalPageCount, paginationEl);

    } catch (err) {
        console.error("Gagal memuat bookmark Supabase:", err);
        loadingEl.classList.add('hidden');
        gridEl.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Gagal memuat bookmark dari database.</p>`;
    }
}

/* =========================================================
   RIWAYAT TONTONAN DARI SUPABASE (WAJIB LOGIN)
   ========================================================= */
async function renderHistory() {
    const historySection = document.getElementById('historySection');
    const historyGrid = document.getElementById('historyGrid');

    const user = getLoggedInUser();

    if (!user) {
        historySection.classList.add('hidden');
        return;
    }

    try {
        const userData = await getSupabaseUserData(user);
        const history = userData.history || [];

        if (history.length === 0) {
            historySection.classList.add('hidden');
            return;
        }

        historySection.classList.remove('hidden');
        historyGrid.innerHTML = history.map(item => `
            <div class="min-w-[140px] sm:min-w-[160px] w-[140px] sm:w-[160px] group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer shrink-0" onclick="window.location.href='stream.html?url=${encodeURIComponent(item.url)}&eps=${item.lastEpisodeIndex || 0}'">
                <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                    <img src="${item.thumbnail}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
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
        `).join('');
    } catch (err) {
        console.error("Gagal mengambil riwayat dari Supabase:", err);
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
        console.error("Gagal menghapus riwayat di Supabase:", err);
    }
}

/* =========================================================
   SKOR ANILIST, PENCARIAN & DETAIL VIEW
   ========================================================= */
async function fetchAniListScoreForCard(animeTitle, elementId) {
    if (!animeTitle) return;
    let cleanTitle = animeTitle.replace(/([a-zA-Z0-9])x([a-zA-Z0-9])/gi, '$1 x $2').trim();

    const query = `
    query ($search: String) {
        Media (search: $search, type: ANIME) {
            averageScore
        }
    }`;

    try {
        const response = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ query: query, variables: { search: cleanTitle } })
        });
        const result = await response.json();
        const score = result?.data?.Media?.averageScore;
        const targetEl = document.getElementById(elementId);
        if (score && targetEl) {
            targetEl.innerHTML = `⭐ ${(score / 10).toFixed(1)}`;
        }
    } catch (err) {}
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

            const animeObj = {
                id: matchedItem.id,
                title: matchedItem.title || title,
                url: matchedItem.url ? matchedItem.url.trim() : "",
                status: matchedItem.status || "Ongoing",
                genres: matchedItem.genre ? matchedItem.genre.split(',').map(g => g.trim()) : [],
                synopsis: matchedItem.sinopsis || "Sinopsis belum tersedia.",
                thumbnail: matchedItem.img_url || matchedItem.image_url || "https://placehold.co/400x600?text=No+Image",
                japanese: matchedItem.japanese || "-",
                skor: matchedItem.score || "-",
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

function switchView(viewName) {
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
            synopsis: item.sinopsis || "Sinopsis belum tersedia.",
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
        setTimeout(() => { fetchAniListScoreForCard(item.title, scoreBadgeId); }, 100);

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
                    <span id="${scoreBadgeId}" class="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md text-neon-yellow text-[10px] font-bold px-2 py-0.5 rounded-full shadow z-10">⭐ ${item.skor && item.skor !== '-' ? item.skor : 'N/A'}</span>
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

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'bg-neon-yellow text-black font-bold border-neon-yellow shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder shadow-xs';
        paginationHTML += `<button class="w-9 h-9 rounded-lg text-xs font-semibold border ${activeClass} transition" onclick="goToPage(${i})">${i}</button>`;
    }

    paginationHTML += `<button class="${currentPage < totalPages ? baseBtnClass : disabledBtnClass}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">&rsaquo;</button>`;
    paginationHTML += `<button class="${currentPage < totalPages ? baseBtnClass : disabledBtnClass}" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${totalPages})">&raquo;</button>`;

    paginationBox.innerHTML = paginationHTML;
}

function goToPage(pageNumber) {
    loadAnimeDatabase(pageNumber);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleSearchInput(event) {
    if(event) event.stopPropagation();
    const container = document.getElementById('searchContainer');
    const field = document.getElementById('searchField');
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        field.focus();
    } else {
        container.classList.add('hidden');
        document.getElementById('searchSuggestions').classList.add('hidden');
    }
}

async function liveSearchAnime() {
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
}

function selectLiveSearchItem(anime) {
    document.getElementById('searchContainer').classList.add('hidden');
    document.getElementById('searchSuggestions').classList.add('hidden');
    document.getElementById('searchField').value = '';

    const exists = currentData.some(a => a.id == anime.id);
    if (!exists) currentData.push(anime);

    viewDetails(anime.id);
}

function resetTabActiveStyles() {
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
        b.classList.remove('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
        b.classList.add('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
    });
}

function changeTab(type, element) {
    resetTabActiveStyles();
    if(element) {
        element.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        element.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    }
    const dropdown = document.getElementById('genreDropdown');
    if(dropdown) dropdown.style.display = 'none';

    activeSearchQuery = "";
    activeGenreFilter = "";

    if(type === 'all') {
        activeStatusFilter = "";
        document.getElementById('sectionHeader').innerText = "Semua Daftar Anime";
    } else if(type === 'ongoing') {
        activeStatusFilter = "Ongoing";
        document.getElementById('sectionHeader').innerText = "Anime Ongoing Terbaru";
    } else if(type === 'completed') {
        activeStatusFilter = "Completed";
        document.getElementById('sectionHeader').innerText = "Anime Completed";
    }
    loadAnimeDatabase(1);
}

function toggleDropdown(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('genreDropdown');
    dropdown.style.display = dropdown.style.display === 'flex' ? 'none' : 'flex';
}

function filterGenre(genre) {
    switchView('home');
    const dropdown = document.getElementById('genreDropdown');
    if(dropdown) dropdown.style.display = 'none';
    
    resetTabActiveStyles();
    const genreBtn = document.getElementById('btnGenre');
    if(genreBtn) {
        genreBtn.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        genreBtn.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    }

    activeSearchQuery = "";
    activeStatusFilter = "";
    activeGenreFilter = genre;
    document.getElementById('sectionHeader').innerText = `Genre: ${genre}`;
    loadAnimeDatabase(1);
}

function searchAnime() {
    const query = document.getElementById('searchField').value.trim();
    document.getElementById('searchSuggestions').classList.add('hidden');

    activeSearchQuery = query;
    activeGenreFilter = "";
    document.getElementById('sectionHeader').innerText = query ? `Hasil Pencarian: "${query}"` : "Semua Daftar Anime";
    
    switchView('home');
    loadAnimeDatabase(1);
}

function viewDetails(id) {
    const anime = currentData.find(a => a.id == id);
    if(!anime) return;
    activeAnime = anime;

    switchView('detail');

    document.getElementById('detTitle').innerText = anime.title;
    document.getElementById('detThumbnail').src = anime.thumbnail;
    document.getElementById('detStatusBadge').innerText = anime.status;
    document.getElementById('synopsisText').innerText = anime.synopsis;

    document.getElementById('detJapanese').innerText = anime.japanese;
    document.getElementById('detSkor').innerText = anime.skor;
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
    if (!activeAnime || !activeAnime.url) return;
    window.open(`stream.html?url=${encodeURIComponent(activeAnime.url)}&eps=0`, '_blank');
}

window.onclick = function(e) {
    const dropdown = document.getElementById('genreDropdown');
    if(dropdown && !e.target.closest('#btnGenre')) { dropdown.style.display = 'none'; }
}

function toggleTheme() {
    const html = document.documentElement;
    const icon = document.getElementById('themeIcon');
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        icon.classList.replace('fa-moon', 'fa-sun');
    } else {
        html.classList.add('dark');
        icon.classList.replace('fa-sun', 'fa-moon');
    }
}

/* =========================================================
   INFORMASI & PODIUM ANILIST
   ========================================================= */
let currentInfoType = 'bypopularity';
let currentInfoPage = 1;

function openInformation(type, page = 1) {
    currentInfoType = type;
    currentInfoPage = page;
    
    switchView('information');
    
    document.querySelectorAll('.info-tab-btn').forEach(b => {
        b.className = 'info-tab-btn px-4 py-2 rounded-full bg-neon-lightCard dark:bg-neon-darkCard text-xs font-semibold border border-neon-yellow/60 dark:border-neon-darkBorder transition text-black dark:text-white shadow-xs';
        const icon = b.querySelector('i');
        if (icon) {
            icon.classList.remove('text-black');
            icon.classList.add('text-neon-yellow');
        }
    });
    
    let activeBtnId = 'infoBtnPopularity';
    if (type === 'upcoming') activeBtnId = 'infoBtnUpcoming';
    if (type === 'favorite') activeBtnId = 'infoBtnFavorite';
    if (type === 'bookmark') activeBtnId = 'infoBtnBookmark';
    
    const activeBtn = document.getElementById(activeBtnId);
    if (activeBtn) {
        activeBtn.className = 'info-tab-btn px-4 py-2 rounded-full bg-neon-yellow text-black text-xs font-bold shadow-glow-yellow transition';
        const activeIcon = activeBtn.querySelector('i');
        if (activeIcon) {
            activeIcon.classList.remove('text-neon-yellow');
            activeIcon.classList.add('text-black');
        }
    }
    
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
    } else if (type === 'bookmark') {
        headerEl.innerText = 'Bookmark Kamu';
        descEl.innerText = 'Daftar anime tersimpan di database akun Anda.';
    }
    
    const loadingEl = document.getElementById('informationLoading');
    const podiumEl = document.getElementById('podiumSection');
    const gridEl = document.getElementById('informationGrid');
    const paginationEl = document.getElementById('informationPagination');
    
    loadingEl.classList.remove('hidden');
    podiumEl.classList.add('hidden');
    gridEl.innerHTML = '';
    paginationEl.innerHTML = '';
    
    if (type === 'bookmark') {
        fetchAniListBookmarks(page, loadingEl, podiumEl, gridEl, paginationEl);
    } else {
        fetchAniListData(type, page, loadingEl, podiumEl, gridEl, paginationEl);
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatNumberShort(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return num.toString();
}

async function fetchAniListData(type, page, loadingEl, podiumEl, gridEl, paginationEl) {
    let sortQuery = 'POPULARITY_DESC';
    let statusQuery = '';

    if (type === 'upcoming') {
        statusQuery = ', status: NOT_YET_RELEASED';
        sortQuery = 'POPULARITY_DESC';
    } else if (type === 'favorite') {
        sortQuery = 'SCORE_DESC';
    }

    try {
        let top3Data = [];
        
        if (page === 1) {
            const queryPage1 = `
            query {
                Page(page: 1, perPage: 15) {
                    pageInfo { total currentPage lastPage hasNextPage }
                    media(type: ANIME, sort: ${sortQuery}${statusQuery}) {
                        id title { romaji english userPreferred }
                        coverImage { extraLarge large }
                        averageScore popularity favourites status
                    }
                }
            }`;
            const res = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query: queryPage1 })
            });
            const json = await res.json();
            const rawData = json?.data?.Page?.media || [];
            const pageInfo = json?.data?.Page?.pageInfo || {};

            loadingEl.classList.add('hidden');

            if (rawData.length < 3) {
                gridEl.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Data tidak cukup.</p>`;
                return;
            }

            top3Data = rawData.slice(0, 3);
            renderPodiumData(top3Data);
            podiumEl.classList.remove('hidden');

            const listData = rawData.slice(3);
            gridEl.innerHTML = listData.map((anime, idx) => renderRankListItem(anime, idx + 4)).join('');

            renderInfoPagination(type, page, pageInfo.lastPage || 1, paginationEl);

        } else {
            const queryPageN = `
            query {
                top3: Page(page: 1, perPage: 3) {
                    media(type: ANIME, sort: ${sortQuery}${statusQuery}) {
                        id title { romaji english userPreferred }
                        coverImage { extraLarge large }
                        averageScore popularity favourites status
                    }
                }
                listData: Page(page: ${page}, perPage: 12) {
                    pageInfo { total currentPage lastPage hasNextPage }
                    media(type: ANIME, sort: ${sortQuery}${statusQuery}) {
                        id title { romaji english userPreferred }
                        coverImage { extraLarge large }
                        averageScore popularity favourites status
                    }
                }
            }`;

            const res = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query: queryPageN })
            });
            const json = await res.json();
            
            top3Data = json?.data?.top3?.media || [];
            const rawListData = json?.data?.listData?.media || [];
            const pageInfo = json?.data?.listData?.pageInfo || {};

            loadingEl.classList.add('hidden');

            if (top3Data.length >= 3) {
                renderPodiumData(top3Data);
                podiumEl.classList.remove('hidden');
            }

            const startRankOffset = 15 + ((page - 2) * 12);
            gridEl.innerHTML = rawListData.map((anime, idx) => renderRankListItem(anime, startRankOffset + idx + 1)).join('');

            renderInfoPagination(type, page, pageInfo.lastPage || 1, paginationEl);
        }

    } catch (err) {
        console.error("AniList Error:", err);
        loadingEl.classList.add('hidden');
        gridEl.innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Gagal memuat data.</p>`;
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

        if (btn) {
            btn.onclick = function(e) {
                e.stopPropagation();
                addAniListBookmark(r, this);
            };
        }
    });
}

function renderRankListItem(anime, rankNumber) {
    const title = anime.title?.userPreferred || anime.title?.romaji || anime.title?.english || 'Tanpa Judul';
    const img = anime.coverImage?.extraLarge || anime.coverImage?.large || 'https://placehold.co/150x200?text=No+Image';
    const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : 'N/A';
    const pop = formatNumberShort(anime.popularity);
    const escapedTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `
        <div class="bg-neon-lightCard dark:bg-neon-darkCard border border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow rounded-xl p-3 flex items-center gap-3.5 transition shadow-xs">
            <span class="font-extrabold text-sm sm:text-base text-zinc-400 dark:text-zinc-500 w-7 text-center shrink-0">#${rankNumber}</span>
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
            <button onclick="addAniListBookmark(${anime.id}, this)" title="Simpan ke Bookmark" class="p-2 text-zinc-400 hover:text-neon-yellow transition shrink-0">
                <i class="fa-regular fa-bookmark"></i>
            </button>
        </div>
    `;
}

function renderInfoPagination(type, page, totalPageCount, paginationEl) {
    let pagHTML = '';
    const baseBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder hover:border-neon-yellow transition shadow-xs';
    const disBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-not-allowed';
    
    pagHTML += `<button class="${page > 1 ? baseBtn : disBtn}" ${page <= 1 ? 'disabled' : ''} onclick="openInformation('${type}', ${page - 1})">&lsaquo;</button>`;
    
    let sPage = Math.max(1, page - 2);
    let ePage = Math.min(totalPageCount, page + 2);
    
    for (let i = sPage; i <= ePage; i++) {
        let actClass = i === page ? 'bg-neon-yellow text-black font-bold border-neon-yellow shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border-neon-yellow dark:border-neon-darkBorder shadow-xs';
        pagHTML += `<button class="w-9 h-9 rounded-lg text-xs font-semibold border ${actClass} transition" onclick="openInformation('${type}', ${i})">${i}</button>`;
    }
    
    pagHTML += `<button class="${page < totalPageCount ? baseBtn : disBtn}" ${page >= totalPageCount ? 'disabled' : ''} onclick="openInformation('${type}', ${page + 1})">&rsaquo;</button>`;
    
    paginationEl.innerHTML = pagHTML;
}

window.onload = function() {
    handleAniListOAuthCallback();
    checkAniListAuthStatus();

    const defaultBtn = document.getElementById('btnSemua');
    if(defaultBtn) {
        defaultBtn.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        defaultBtn.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    }
    
    activeSearchQuery = "";
    activeGenreFilter = "";
    activeStatusFilter = "";

    renderHistory();
    loadAnimeDatabase(1);
};
