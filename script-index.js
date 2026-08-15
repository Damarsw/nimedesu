document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

const RENDER_API_URL = "/api-backend";
let activeEpisodes = [];
let activeEpisodeIndex = 0;
let globalAnimeTitle = "Anime";
let allAnimeList = [];
let currentAnimeThumbnail = "";

/* =========================================================
   KONFIGURASI SUPABASE DATABASE (SUDAH TERPASANG)
   ========================================================= */
const SUPABASE_URL = "https://yezdnsgypbjcgzoftgmz.supabase.co";
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
   HELPER SUPABASE DATA
   ========================================================= */
function getUserIdentifier(user) {
    if (!user) return null;
    return user.name || String(user.id);
}

async function syncUserWithSupabase(user) {
    if (!supabaseClient || !user) return null;
    const identifier = getUserIdentifier(user);

    try {
        const { data: existingRow, error: selectErr } = await supabaseClient
            .from('login')
            .select('*')
            .eq('anilist_id', identifier)
            .maybeSingle();

        if (!existingRow) {
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

            await supabaseClient
                .from('login')
                .insert([
                    {
                        anilist_id: identifier,
                        cookies: initialCookies
                    }
                ]);

            return initialCookies;
        } else {
            let cookiesData = existingRow.cookies || {};
            if (typeof cookiesData === 'string') {
                try { cookiesData = JSON.parse(cookiesData); } catch (e) { cookiesData = {}; }
            }
            return cookiesData;
        }
    } catch (err) {
        console.error("Gagal sinkronisasi user di stream:", err);
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
            .eq('anilist_id', identifier)
            .maybeSingle();

        if (error || !data || !data.cookies) return { history: [], bookmarks: [] };
        
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
        console.error("Gagal membaca Supabase:", err);
        return { history: [], bookmarks: [] };
    }
}

async function saveSupabaseUserData(user, payload) {
    if (!supabaseClient || !user) return false;
    const identifier = getUserIdentifier(user);

    try {
        const { data: existing } = await supabaseClient
            .from('login')
            .select('id')
            .eq('anilist_id', identifier)
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
            await supabaseClient
                .from('login')
                .update({ cookies: payload })
                .eq('id', existing.id);
        } else {
            await supabaseClient
                .from('login')
                .insert([
                    {
                        anilist_id: identifier,
                        cookies: payload
                    }
                ]);
        }
        return true;
    } catch (err) {
        console.error("Gagal update Supabase:", err);
        return false;
    }
}

/* =========================================================
   AUTENTIKASI ANILIST DI STREAM.HTML
   ========================================================= */
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
            await syncUserWithSupabase(user);
        }
    } catch (err) {
        console.error("Auth check failed:", err);
    }
}

/* =========================================================
   SIMPAN RIWAYAT STREAM KE SUPABASE DATABASE (HANYA JIKA LOGIN)
   ========================================================= */
async function saveStreamToHistory(animeTitle, animeUrl, episodeTitle, episodeIndex, thumbnailImg) {
    const user = getLoggedInUser();

    if (!user) {
        console.log("User belum login, riwayat tontonan tidak disimpan.");
        return;
    }

    try {
        const userData = await getSupabaseUserData(user);
        let history = userData.history || [];

        const animeItem = {
            id: animeUrl,
            title: animeTitle,
            url: animeUrl,
            thumbnail: thumbnailImg || "https://placehold.co/400x600?text=No+Image",
            lastWatchedEpisode: episodeTitle,
            lastEpisodeIndex: episodeIndex,
            updatedAt: new Date().toISOString()
        };

        history = history.filter(item => item.url !== animeUrl);
        history.unshift(animeItem);
        if (history.length > 8) history.pop();

        userData.history = history;
        await saveSupabaseUserData(user, userData);
    } catch (e) {
        console.error("Gagal menyimpan riwayat ke Supabase:", e);
    }
}

function toggleSearchInput(event) {
    if(event) event.stopPropagation();
    const container = document.getElementById('searchContainer');
    const field = document.getElementById('searchField');
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        field.focus();
        if(allAnimeList.length === 0) fetchAllAnimeForSearch();
    } else {
        container.classList.add('hidden');
        document.getElementById('searchSuggestions').classList.add('hidden');
    }
}

async function fetchAllAnimeForSearch() {
    try {
        const perPage = 1000;
        let page = 1;
        let all = [];
        let totalPages = 1;

        do {
            const sec = generateSecurityToken();
            const res = await fetch(`${RENDER_API_URL}/anime?page=${page}&per_page=${perPage}`, {
                headers: {
                    "X-Client-Token": sec.token,
                    "X-Client-Time": sec.time
                }
            });
            const result = await res.json();
            const pageData = Array.isArray(result) ? result : (result.data || []);
            all = all.concat(pageData);

            totalPages = result.total_pages || 1;
            page++;
        } while (page <= totalPages);

        allAnimeList = all;
    } catch (e) {
        console.error('Gagal memuat daftar lengkap anime:', e);
        allAnimeList = [];
    }
}

function liveSearchAnime() {
    const query = document.getElementById('searchField').value.trim().toLowerCase();
    const suggestionsBox = document.getElementById('searchSuggestions');

    if (!query) {
        suggestionsBox.classList.add('hidden');
        suggestionsBox.innerHTML = '';
        return;
    }

    const matched = (Array.isArray(allAnimeList) ? allAnimeList : []).filter(a => (a.title || a.Judul || "").toLowerCase().includes(query)).slice(0, 6);

    if (matched.length === 0) {
        suggestionsBox.innerHTML = `<p class="text-xs text-center text-zinc-500 py-3">Anime tidak ditemukan</p>`;
        suggestionsBox.classList.remove('hidden');
        return;
    }

    suggestionsBox.innerHTML = matched.map(anime => {
        const title = anime.title || anime.Judul || "Tanpa Judul";
        const thumb = anime.image_url || anime.thumbnail || "https://placehold.co/100x150?text=No+Image";
        const animeUrl = anime.url ? anime.url.trim() : "";
        const rawGenre = anime.genre || anime.Genre || "";
        const genres = rawGenre ? rawGenre.split(',').map(g => g.trim()).join(', ') : '-';
        
        return `
            <div onclick="window.location.href='stream.html?url=${encodeURIComponent(animeUrl)}&eps=0'" class="flex items-center gap-3 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl cursor-pointer transition">
                <img src="${thumb}" class="w-10 h-14 object-cover rounded-lg shrink-0">
                <div class="overflow-hidden">
                    <h4 class="text-xs font-semibold text-zinc-900 dark:text-white truncate">${title}</h4>
                    <span class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate block">${genres}</span>
                </div>
            </div>
        `;
    }).join('');
    suggestionsBox.classList.remove('hidden');
}

function executeSearch() {
    const query = document.getElementById('searchField').value.trim();
    if (query) {
        window.location.href = `index.html?q=${encodeURIComponent(query)}`;
    }
}

document.addEventListener('click', function(e) {
    const container = document.getElementById('searchContainer');
    const searchBoxWrapper = document.getElementById('searchBoxWrapper');
    const searchSuggestions = document.getElementById('searchSuggestions');
    const btnToggle = document.getElementById('btnSearchToggle');

    if (container && !container.classList.contains('hidden')) {
        if (!searchBoxWrapper.contains(e.target) && !searchSuggestions.contains(e.target) && !btnToggle.contains(e.target)) {
            container.classList.add('hidden');
            searchSuggestions.classList.add('hidden');
        }
    }
});

async function initStream() {
    const urlParams = new URLSearchParams(window.location.search);
    const animeUrl = urlParams.get('url');
    const targetEps = parseInt(urlParams.get('eps')) || 0; 

    if (!animeUrl) {
        document.getElementById('streamTitle').innerText = "URL Anime Tidak Ditemukan!";
        return;
    }

    try {
        if(allAnimeList.length === 0) {
            await fetchAllAnimeForSearch();
        }

        const sec = generateSecurityToken();
        const response = await fetch(`${RENDER_API_URL}/anime-detail?url=${encodeURIComponent(animeUrl)}`, {
            headers: {
                "X-Client-Token": sec.token,
                "X-Client-Time": sec.time
            }
        });
        const data = await response.json();

        if (data && data.episodes && data.episodes.length > 0) {
            activeEpisodes = data.episodes.filter(ep => ep && (ep.episode_title || ep.video_servers));
            
            activeEpisodes.sort((a, b) => {
                const titleA = (a.episode_title || "").toLowerCase();
                const titleB = (b.episode_title || "").toLowerCase();
                
                const isOvaSpecialA = titleA.includes('ova') || titleA.includes('special') || titleA.includes('sp');
                const isOvaSpecialB = titleB.includes('ova') || titleB.includes('special') || titleB.includes('sp');
                
                if (isOvaSpecialA && !isOvaSpecialB) return 1;
                if (!isOvaSpecialA && isOvaSpecialB) return -1;

                const numA = extractEpisodeNumber(a.episode_title);
                const numB = extractEpisodeNumber(b.episode_title);
                return numA - numB;
            });

            activeEpisodeIndex = (targetEps >= 0 && targetEps < activeEpisodes.length) ? targetEps : 0;

            globalAnimeTitle = data.title || data.Judul;
            if (!globalAnimeTitle) {
                const segments = animeUrl.split('/').filter(Boolean);
                globalAnimeTitle = segments[segments.length - 1].replace(/-/g, ' ');
            }

            const currentAnimeInfo = allAnimeList.find(a => (a.url && a.url.trim() === animeUrl));
            if (currentAnimeInfo) {
                currentAnimeThumbnail = currentAnimeInfo.image_url || currentAnimeInfo.thumbnail || "";
            }
            
            document.getElementById('episodeNavContainer').classList.remove('hidden');
            renderDynamicEpisodes();

            try {
                renderMixedGenreRecommendations();
            } catch (recError) {
                console.error('Gagal memuat rekomendasi:', recError);
                document.getElementById('recommendationSlider').innerHTML = '<p class="text-xs text-zinc-500">Gagal memuat rekomendasi.</p>';
            }
        } else {
            document.getElementById('streamTitle').innerText = "Data Episode Tidak Tersedia.";
        }
    } catch (error) {
        console.error(error);
        document.getElementById('streamTitle').innerText = "Gagal memuat server streaming.";
    }
}

function extractEpisodeNumber(title) {
    if (!title) return 0;
    const match = title.match(/episode\s*(\d+)/i) || title.match(/eps\.?\s*(\d+)/i) || title.match(/(\d+)/);
    return match ? parseInt(match) : 0;
}

function scrollSlider(direction) {
    const slider = document.getElementById('recommendationSlider');
    const scrollAmount = 220; 
    slider.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
}

function renderMixedGenreRecommendations() {
    const recSlider = document.getElementById('recommendationSlider');
    if (!allAnimeList || allAnimeList.length === 0) {
        recSlider.innerHTML = '<p class="text-xs text-zinc-500">Daftar anime belum dimuat.</p>';
        return;
    }

    const targetGenres = ['horror', 'supernatural', 'mecha'];
    let selectedRecommendations = [];

    targetGenres.forEach(genre => {
        const filtered = allAnimeList.filter(a => {
            const itemGenre = a.genre || a.Genre || "";
            return itemGenre.toLowerCase().includes(genre);
        });

        const shuffled = filtered.sort(() => 0.5 - Math.random());
        selectedRecommendations = selectedRecommendations.concat(shuffled.slice(0, 4));
    });

    selectedRecommendations.sort(() => 0.5 - Math.random());

    if (selectedRecommendations.length === 0) {
        recSlider.innerHTML = '<p class="text-xs text-zinc-500">Tidak ada rekomendasi anime dengan genre tersebut.</p>';
        return;
    }

    recSlider.innerHTML = selectedRecommendations.map(rec => {
        const title = rec.title || rec.Judul || "Tanpa Judul";
        const thumb = rec.image_url || rec.thumbnail || "https://placehold.co/300x400?text=No+Image";
        const recUrl = rec.url ? rec.url.trim() : "";
        const status = rec.status || rec.Status || "Ongoing";

        return `
            <div class="min-w-[140px] sm:min-w-[160px] w-[140px] sm:w-[160px] group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-lightBorder dark:border-neon-darkBorder hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer shrink-0" onclick="window.location.href='stream.html?url=${encodeURIComponent(recUrl)}&eps=0'">
                <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                    <img src="${thumb}" alt="${title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                    <div class="play-overlay absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center">
                        <div class="w-10 h-10 rounded-full bg-neon-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition duration-300">
                            <i class="fa-solid fa-play text-xs"></i>
                        </div>
                    </div>
                    <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${status}</span>
                </div>
                <div class="p-2.5">
                    <h4 class="font-semibold text-xs line-clamp-2 text-zinc-900 dark:text-white">${title}</h4>
                </div>
            </div>
        `;
    }).join('');
}

function renderDynamicEpisodes() {
    const container = document.getElementById('episodeBoxContainer');
    const label = document.getElementById('episodeBoxLabel');

    if(!activeEpisodes || activeEpisodes.length === 0) {
        container.innerHTML = '<p class="text-xs text-zinc-500">Tidak ada episode tersedia.</p>';
        if(label) label.innerText = "Daftar Episode (0)";
        return;
    }

    if(label) label.innerText = `Daftar Episode (${activeEpisodes.length})`;

    const currentEp = activeEpisodes[activeEpisodeIndex];
    const rawEpTitleForHeader = currentEp && currentEp.episode_title ? currentEp.episode_title.replace(/Sub.*$/, '').trim() : `Episode ${activeEpisodeIndex + 1}`;
    document.getElementById('streamTitle').innerText = `Nonton ${globalAnimeTitle} (${rawEpTitleForHeader})`;

    document.getElementById('prevEpBtn').disabled = activeEpisodeIndex <= 0;
    document.getElementById('prevEpBtn').style.opacity = activeEpisodeIndex <= 0 ? '0.5' : '1';
    document.getElementById('nextEpBtn').disabled = activeEpisodeIndex >= activeEpisodes.length - 1;
    document.getElementById('nextEpBtn').style.opacity = activeEpisodeIndex >= activeEpisodes.length - 1 ? '0.5' : '1';

    container.innerHTML = activeEpisodes.map((ep, index) => {
        const activeClass = index === activeEpisodeIndex ? 'bg-neon-yellow text-white font-bold shadow-glow-yellow' : 'bg-neon-lightBg dark:bg-neon-darkBg text-zinc-900 dark:text-white border border-neon-lightBorder dark:border-neon-darkBorder hover:border-neon-yellow';
        let epLabel = ep.episode_title ? ep.episode_title.replace(/Sub.*$/, '').trim() : `Eps ${index + 1}`;
        if (!epLabel || epLabel.toLowerCase() === globalAnimeTitle.toLowerCase()) return '';

        return `<button onclick='selectEpisode(${index})' class="episode-btn ${activeClass} px-3 py-1.5 rounded-lg text-xs font-semibold transition">${epLabel}</button>`;
    }).join('');

    if(activeEpisodes[activeEpisodeIndex] && activeEpisodes[activeEpisodeIndex].video_servers) {
        renderDynamicServers(activeEpisodes[activeEpisodeIndex].video_servers);
    }

    if (currentEp) {
        const epLabelClean = currentEp.episode_title ? currentEp.episode_title.replace(/Sub.*$/, '').trim() : `Eps ${activeEpisodeIndex + 1}`;
        const urlParams = new URLSearchParams(window.location.search);
        const animeUrl = urlParams.get('url');
        saveStreamToHistory(globalAnimeTitle, animeUrl, epLabelClean, activeEpisodeIndex, currentAnimeThumbnail);
    }
}

function selectEpisode(index) {
    activeEpisodeIndex = index;
    renderDynamicEpisodes();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changeEpisodeRelative(direction) {
    const newIndex = activeEpisodeIndex + direction;
    if (newIndex >= 0 && newIndex < activeEpisodes.length) {
        selectEpisode(newIndex);
    }
}

function renderDynamicServers(servers) {
    const mainContainer = document.getElementById('mainServerContainer');
    if (!servers || servers.length === 0) {
        mainContainer.innerHTML = '<p class="text-xs text-zinc-500 p-2">Server tidak ditemukan.</p>';
        document.getElementById('currentServerLabel').innerText = "Tidak ada";
        document.getElementById('videoIframe').src = "";
        return;
    }

    let htmlContent = '';
    let isFirst = true;

    servers.forEach((srv, index) => {
        const videoUrl = srv.url || srv.video_url || "";
        const serverName = `Server ${index + 1}`;
        const resolution = "MP4";

        htmlContent += `
            <button onclick="selectServer(this, '${resolution}', '${serverName}', '${videoUrl}')" class="server-btn w-full text-left px-3 py-2 rounded text-xs bg-neon-lightCard dark:bg-neon-darkCard hover:bg-neon-yellow hover:text-black transition flex justify-between items-center text-zinc-900 dark:text-white border border-neon-lightBorder dark:border-neon-darkBorder">
                <span><i class="fa-solid fa-play text-neon-yellow mr-2"></i> ${serverName}</span>
                <span class="text-[9px] px-1.5 py-0.5 rounded bg-neon-yellow text-black font-bold">HD</span>
            </button>
        `;

        if(isFirst) {
            setTimeout(() => selectServer(null, resolution, serverName, videoUrl), 100);
            isFirst = false;
        }
    });

    mainContainer.innerHTML = htmlContent;
}

function toggleMainServerBox() {
    const container = document.getElementById('mainServerContainer');
    const arrow = document.getElementById('mainServerArrow');
    if(container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        arrow.style.transform = 'rotate(0deg)';
    } else {
        container.classList.add('hidden');
        arrow.style.transform = 'rotate(-90deg)';
    }
}

function toggleEpisodeBox() {
    const container = document.getElementById('episodeBoxContainer');
    const arrow = document.getElementById('episodeBoxArrow');
    if(container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        arrow.style.transform = 'rotate(0deg)';
    } else {
        container.classList.add('hidden');
        arrow.style.transform = 'rotate(-90deg)';
    }
}

function selectServer(element, resolution, serverNum, videoUrl) {
    document.getElementById('currentServerLabel').innerText = `${resolution} (${serverNum})`;
    document.querySelectorAll('.server-btn').forEach(btn => {
        btn.className = "server-btn w-full text-left px-3 py-2 rounded text-xs bg-neon-lightCard dark:bg-neon-darkCard hover:bg-neon-yellow hover:text-black transition flex justify-between items-center text-zinc-900 dark:text-white border border-neon-lightBorder dark:border-neon-darkBorder";
    });
    if(element) {
        element.className = "server-btn w-full text-left px-3 py-2 rounded text-xs bg-neon-yellow text-white font-bold shadow-glow-yellow transition flex justify-between items-center";
    }
    document.getElementById('mainServerContainer').classList.add('hidden');
    document.getElementById('mainServerArrow').style.transform = 'rotate(-90deg)';

    const iframe = document.getElementById('videoIframe');
    
    if (!videoUrl || videoUrl === 'undefined' || videoUrl === 'null') {
        iframe.src = "about:blank";
        return;
    }

    let finalUrl = videoUrl;
    try {
        let decoded = atob(videoUrl);
        if (decoded && decoded.startsWith('http')) {
            finalUrl = decoded;
        }
    } catch (e) {
        finalUrl = videoUrl;
    }

    iframe.src = finalUrl;
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

window.onload = function() {
    handleAniListOAuthCallback();
    checkAniListAuthStatus();
    initStream();
};
