document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

const ARCHIDENDRON_BRIDGE = "/api-backend";
const JACK_SPECIMEN_REF = "NDg1Njc=";

let activeEpisodes = [];
let activeEpisodeIndex = 0;
let globalAnimeTitle = "Anime";
let currentAnimeThumbnail = "";
let currentAnimeGenres = []; 
let currentAnimeId = null;
let searchDebounceTimer = null;

function fractionateSeedEssence(rawString) {
    try { return btoa(rawString).replace(/=/g, ''); } catch(e) { return ""; }
}

function recombineSeedEssence(encodedString) {
    try { return atob(encodedString); } catch(e) { return ""; }
}

function getTurnstileToken() {
    return document.querySelector('[name="cf-turnstile-response"]')?.value || "";
}

function onTurnstileSuccess(token) {
    const turnstileContainer = document.getElementById('turnstileContainer');
    if (turnstileContainer) {
        turnstileContainer.style.display = 'none';
    }
}

function getOrCreatePhytoSessionID() {
    let sid = localStorage.getItem('pericarp_id');
    if (!sid) {
        sid = 'pe_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('pericarp_id', sid);
    }
    return sid;
}

function generateBubalinumHeaderSignature() {
    const timestamp = Math.floor(Date.now() / 1000);
    return {
        chrono: timestamp.toString(),
        seed: fractionateSeedEssence(timestamp + "_bubalinum_extract")
    };
}

function getUserCotyledonIdentifier(user) {
    if (!user) return null;
    return user.name || String(user.id);
}

async function syncUserWithSupabase(user) {
    if (!user) return null;
    const identifier = getUserCotyledonIdentifier(user);
    const sessionID = getOrCreatePhytoSessionID();

    try {
        const sec = generateBubalinumHeaderSignature();
        const res = await fetch(`${ARCHIDENDRON_BRIDGE}/user-sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Bubalinum-Seed": sec.seed,
                "X-Bubalinum-Chrono": sec.chrono,
                "X-Turnstile-Token": getTurnstileToken()
            },
            body: JSON.stringify({
                cotyledon_id: identifier,
                pericarp_id: sessionID,
                testa_payload: {
                    history: [],
                    bookmarks: [],
                    user_info: { id: user.id, name: user.name, avatar: user.avatar?.medium || "" }
                }
            })
        });

        const result = await res.json();
        if (result && result.testa_payload) {
            return result.testa_payload;
        }
        return null;
    } catch (err) {
        console.error("Gagal sync user di stream:", err);
        return null;
    }
}

async function getSupabaseUserData(user) {
    if (!user) return { history: [], bookmarks: [] };
    const identifier = getUserCotyledonIdentifier(user);
    const sessionID = getOrCreatePhytoSessionID();

    try {
        const sec = generateBubalinumHeaderSignature();
        const res = await fetch(`${ARCHIDENDRON_BRIDGE}/user-data?cotyledon=${encodeURIComponent(identifier)}&pericarp=${encodeURIComponent(sessionID)}`, {
            headers: {
                "X-Bubalinum-Seed": sec.seed,
                "X-Bubalinum-Chrono": sec.chrono
            }
        });
        const result = await res.json();
        return result.testa_payload || { history: [], bookmarks: [] };
    } catch (err) {
        console.error("Gagal membaca user data:", err);
        return { history: [], bookmarks: [] };
    }
}

async function saveSupabaseUserData(user, payloadData) {
    if (!user) return false;
    const identifier = getUserCotyledonIdentifier(user);
    const sessionID = getOrCreatePhytoSessionID();

    try {
        const sec = generateBubalinumHeaderSignature();
        const res = await fetch(`${ARCHIDENDRON_BRIDGE}/user-update`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Bubalinum-Seed": sec.seed,
                "X-Bubalinum-Chrono": sec.chrono,
                "X-Turnstile-Token": getTurnstileToken()
            },
            body: JSON.stringify({
                cotyledon_id: identifier,
                pericarp_id: sessionID,
                testa_payload: payloadData
            })
        });
        const result = await res.json();
        return result.status === "success";
    } catch (err) {
        console.error("Gagal update user data:", err);
        return false;
    }
}

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
    const resolvedClientId = recombineSeedEssence(JACK_SPECIMEN_REF);
    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${resolvedClientId}&response_type=token`;
    window.location.href = authUrl;
}

function logoutAniList() {
    localStorage.removeItem('anilist_token');
    localStorage.removeItem('anilist_user');

    alert("Berhasil logout! Silakan login kembali.");
    window.location.reload();
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
                    <div class="flex items-center bg-white dark:bg-zinc-800/90 p-0.5 rounded-full border border-neon-yellow shadow-xs">
                        <img src="${user.avatar.medium}" class="w-7 h-7 rounded-full object-cover">
                    </div>
                `;
            }
            await syncUserWithSupabase(user);
        }
    } catch (err) {
        console.error("Auth check failed:", err);
    }
}

async function saveStreamToHistory(animeTitle, animeUrl, episodeTitle, episodeIndex, thumbnailImg) {
    const user = getLoggedInUser();
    if (!user) return;

    try {
        const userData = await getSupabaseUserData(user);
        let history = userData.history || [];

        const animeItem = {
            id: currentAnimeId || animeUrl,
            title: animeTitle,
            url: animeUrl,
            thumbnail: thumbnailImg || "https://placehold.co/400x600?text=No+Image",
            lastWatchedEpisode: episodeTitle,
            lastEpisodeIndex: episodeIndex,
            updatedAt: new Date().toISOString()
        };

        history = history.filter(item => item.url !== animeUrl && String(item.id) !== String(currentAnimeId));
        history.unshift(animeItem);
        if (history.length > 8) history.pop();

        userData.history = history;
        await saveSupabaseUserData(user, userData);
    } catch (e) {
        console.error("Gagal menyimpan riwayat:", e);
    }
}

function toggleSearchInput(event) {
    if(event) event.stopPropagation();
    const container = document.getElementById('searchContainer');
    const field = document.getElementById('searchField');
    const suggestions = document.getElementById('searchSuggestions');

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        field.focus();
        
        const len = field.value.length;
        field.setSelectionRange(len, len);

        if(field.value.trim() !== '') liveSearchAnime();
    } else {
        container.classList.add('hidden');
        if (suggestions) suggestions.classList.add('hidden');
    }
}

document.addEventListener('click', function(e) {
    const container = document.getElementById('searchContainer');
    const searchBoxWrapper = document.getElementById('searchBoxWrapper');
    const searchSuggestions = document.getElementById('searchSuggestions');
    const btnToggle = document.getElementById('btnSearchToggle');

    if (container && !container.classList.contains('hidden')) {
        const isClickInside = (searchBoxWrapper && searchBoxWrapper.contains(e.target)) ||
                              (searchSuggestions && searchSuggestions.contains(e.target)) ||
                              (btnToggle && btnToggle.contains(e.target));
        
        if (!isClickInside) {
            container.classList.add('hidden');
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
            const sec = generateBubalinumHeaderSignature();
            const res = await fetch(`${ARCHIDENDRON_BRIDGE}/anime?q=${encodeURIComponent(query)}&per_page=6`, {
                headers: {
                    "X-Bubalinum-Seed": sec.seed,
                    "X-Bubalinum-Chrono": sec.chrono
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
                const title = anime.title || "Tanpa Judul";
                const thumb = anime.image_url || anime.img_url || anime.thumbnail || "https://placehold.co/100x150?text=No+Image";
                const animeUrl = anime.url ? anime.url.trim() : "";
                const animeId = anime.id || "";
                const rawGenre = anime.genre || "";
                const genres = rawGenre ? rawGenre.split(',').map(g => g.trim()).join(', ') : '-';

                return `
                    <div onclick="window.location.href='stream.html?id=${animeId}&url=${encodeURIComponent(animeUrl)}&eps=0'" class="flex items-center gap-3 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl cursor-pointer transition">
                        <img src="${thumb}" class="w-10 h-14 object-cover rounded-lg shrink-0">
                        <div class="overflow-hidden">
                            <h4 class="text-xs font-semibold text-black dark:text-white truncate">${title}</h4>
                            <span class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate block">${genres}</span>
                        </div>
                    </div>
                `;
            }).join('');
            suggestionsBox.classList.remove('hidden');
        } catch (e) {
            console.error(e);
        }
    }, 300);
}

function executeSearch() {
    const query = document.getElementById('searchField').value.trim();
    if (query) {
        window.location.href = `index.html?q=${encodeURIComponent(query)}`;
    }
}

async function initStream() {
    const urlParams = new URLSearchParams(window.location.search);
    const animeId = urlParams.get('id') || urlParams.get('anime_id');
    const animeUrl = urlParams.get('url');
    const targetEps = parseInt(urlParams.get('eps')) || 0; 

    if (!animeId && !animeUrl) {
        document.getElementById('streamTitle').innerText = "URL Anime Tidak Ditemukan!";
        return;
    }

    try {
        const sec = generateBubalinumHeaderSignature();
        let apiEndpoint = `${ARCHIDENDRON_BRIDGE}/anime-detail?`;
        if (animeId) {
            apiEndpoint += `id=${encodeURIComponent(animeId)}`;
        } else {
            apiEndpoint += `url=${encodeURIComponent(animeUrl)}`;
        }

        const response = await fetch(apiEndpoint, {
            headers: {
                "X-Bubalinum-Seed": sec.seed,
                "X-Bubalinum-Chrono": sec.chrono
            }
        });
        const data = await response.json();

        currentAnimeId = data.id || animeId;
        currentAnimeThumbnail = data.img_url || data.image_url || data.thumbnail || "";

        if (data.genre) {
            if (Array.isArray(data.genre)) {
                currentAnimeGenres = data.genre;
            } else if (typeof data.genre === 'string') {
                currentAnimeGenres = data.genre.split(',').map(g => g.trim()).filter(Boolean);
            }
        }

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

            globalAnimeTitle = data.title;
            if (!globalAnimeTitle && animeUrl) {
                const segments = animeUrl.split('/').filter(Boolean);
                globalAnimeTitle = segments[segments.length - 1].replace(/-/g, ' ');
            }

            document.getElementById('episodeNavContainer').classList.remove('hidden');
            renderDynamicEpisodes();
            renderMixedGenreRecommendations();
        } else {
            document.getElementById('streamTitle').innerText = "Data Episode Tidak Tersedia.";
        }
    } catch (error) {
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

async function renderMixedGenreRecommendations() {
    const recSlider = document.getElementById('recommendationSlider');
    if (!recSlider) return;

    try {
        const sec = generateBubalinumHeaderSignature();
        let targetGenres = currentAnimeGenres.slice(0, 3);
        if (targetGenres.length === 0) targetGenres = ['Action', 'Drama'];

        const fetchPromises = targetGenres.map(genre =>
            fetch(`${ARCHIDENDRON_BRIDGE}/anime?genre=${encodeURIComponent(genre)}&per_page=10`, {
                headers: {
                    "X-Bubalinum-Seed": sec.seed,
                    "X-Bubalinum-Chrono": sec.chrono
                }
            }).then(res => res.json()).catch(() => ({ data: [] }))
        );

        const results = await Promise.all(fetchPromises);
        let recommendedAnimeList = results.flatMap(r => r.data || []);

        const uniqueMap = new Map();
        recommendedAnimeList.forEach(item => {
            if (String(item.id) !== String(currentAnimeId)) {
                uniqueMap.set(item.id || item.url, item);
            }
        });

        recommendedAnimeList = Array.from(uniqueMap.values())
            .sort(() => 0.5 - Math.random())
            .slice(0, 12);

        if (recommendedAnimeList.length === 0) {
            recSlider.innerHTML = '<p class="text-xs text-zinc-500">Tidak ada rekomendasi anime serupa.</p>';
            return;
        }

        recSlider.innerHTML = recommendedAnimeList.map(rec => {
            const title = rec.title || "Tanpa Judul";
            const thumb = rec.image_url || rec.img_url || rec.thumbnail || "https://placehold.co/300x400?text=No+Image";
            const recUrl = rec.url ? rec.url.trim() : "";
            const recId = rec.id || "";
            const status = rec.status || "Ongoing";

            return `
                <div class="min-w-[140px] sm:min-w-[160px] w-[140px] sm:w-[160px] group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow/60 dark:border-neon-darkBorder hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer shrink-0" onclick="window.location.href='stream.html?id=${recId}&url=${encodeURIComponent(recUrl)}&eps=0'">
                    <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                        <img src="${thumb}" alt="${title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                        <div class="play-overlay absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center">
                            <div class="w-10 h-10 rounded-full bg-neon-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition duration-300">
                                <i class="fa-solid fa-play text-xs ml-0.5"></i>
                            </div>
                        </div>
                        <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${status}</span>
                    </div>
                    <div class="p-2.5">
                        <h4 class="font-semibold text-xs line-clamp-2 text-black dark:text-white">${title}</h4>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        recSlider.innerHTML = '<p class="text-xs text-zinc-500">Gagal memuat rekomendasi.</p>';
    }
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
        const activeClass = index === activeEpisodeIndex ? 'bg-neon-yellow text-black font-bold shadow-glow-yellow' : 'bg-neon-lightCard dark:bg-neon-darkCard text-black dark:text-white border border-neon-yellow/60 dark:border-neon-darkBorder hover:border-neon-yellow';
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
            <button onclick="selectServer(this, '${resolution}', '${serverName}', '${videoUrl}')" class="server-btn w-full text-left px-3.5 py-2.5 rounded-xl text-xs bg-neon-lightCard dark:bg-neon-darkCard hover:bg-neon-yellow hover:text-black transition flex justify-between items-center text-black dark:text-white border border-neon-yellow/60 dark:border-neon-darkBorder">
                <span><i class="fa-solid fa-play text-black dark:text-neon-yellow mr-2"></i> ${serverName}</span>
                <span class="text-[9px] px-2 py-0.5 rounded-full bg-neon-yellow text-black font-bold">HD</span>
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

function formatEmbedUrl(url) {
    if (!url) return "about:blank";

    let finalUrl = url;
    try {
        let decoded = recombineSeedEssence(url);
        if (decoded && decoded.startsWith('http')) {
            finalUrl = decoded;
        }
    } catch (e) {
        finalUrl = url;
    }

    if (finalUrl.includes('drive.google.com')) {
        return finalUrl.replace('/view?usp=drivesdk', '/preview').replace('/view', '/preview');
    }

    if (finalUrl.includes('mega.nz')) {
        return finalUrl.replace('/file/', '/embed/');
    }

    return finalUrl;
}

function selectServer(element, resolution, serverNum, videoUrl) {
    document.getElementById('currentServerLabel').innerText = `${resolution} (${serverNum})`;
    document.querySelectorAll('.server-btn').forEach(btn => {
        btn.className = "server-btn w-full text-left px-3.5 py-2.5 rounded-xl text-xs bg-neon-lightCard dark:bg-neon-darkCard hover:bg-neon-yellow hover:text-black transition flex justify-between items-center text-black dark:text-white border border-neon-yellow/60 dark:border-neon-darkBorder";
    });
    if(element) {
        element.className = "server-btn w-full text-left px-3.5 py-2.5 rounded-xl text-xs bg-neon-yellow text-black font-bold shadow-glow-yellow transition flex justify-between items-center";
    }
    document.getElementById('mainServerContainer').classList.add('hidden');
    document.getElementById('mainServerArrow').style.transform = 'rotate(-90deg)';

    const iframe = document.getElementById('videoIframe');
    
    if (!videoUrl || videoUrl === 'undefined' || videoUrl === 'null') {
        iframe.src = "about:blank";
        return;
    }

    iframe.src = "about:blank";
    requestAnimationFrame(() => {
        iframe.src = formatEmbedUrl(videoUrl);
    });
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

window.onload = function() {
    handleAniListOAuthCallback();
    checkAniListAuthStatus();
    initStream();
};
