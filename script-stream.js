document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

const RENDER_API_URL = "/api-backend";
let activeEpisodes = [];
let activeEpisodeIndex = 0;
let globalAnimeTitle = "Anime";
let allAnimeList = [];
let currentAnimeThumbnail = "";

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

function encryptTripleLayer(data) {
    const jsonString = JSON.stringify(data);
    const layer1 = CryptoJS.AES.encrypt(jsonString, KEY_X).toString();
    const layer2 = CryptoJS.Rabbit.encrypt(layer1, KEY_Y).toString();
    const layer3 = CryptoJS.TripleDES.encrypt(layer2, KEY_Z).toString();
    return layer3;
}

function decryptTripleLayer(ciphertext) {
    try {
        const bytesZ = CryptoJS.TripleDES.decrypt(ciphertext, KEY_Z);
        const layer2 = bytesZ.toString(CryptoJS.enc.Utf8);
        if (!layer2) return null;
        const bytesY = CryptoJS.Rabbit.decrypt(layer2, KEY_Y);
        const layer1 = bytesY.toString(CryptoJS.enc.Utf8);
        if (!layer1) return null;
        const bytesX = CryptoJS.AES.decrypt(layer1, KEY_X);
        const decryptedString = bytesX.toString(CryptoJS.enc.Utf8);
        if (!decryptedString) return null;
        return JSON.parse(decryptedString);
    } catch (e) {
        return null;
    }
}

function saveStreamToHistory(animeTitle, animeUrl, episodeTitle, episodeIndex, thumbnailImg) {
    let encryptedData = localStorage.getItem('nimedesu_history_triple');
    let history = encryptedData ? decryptTripleLayer(encryptedData) || [] : [];

    const animeItem = {
        id: animeUrl,
        title: animeTitle,
        url: animeUrl,
        thumbnail: thumbnailImg || "https://placehold.co/400x600?text=No+Image",
        lastWatchedEpisode: episodeTitle,
        lastEpisodeIndex: episodeIndex
    };

    history = history.filter(item => item.url != animeUrl);
    history.unshift(animeItem);
    if (history.length > 6) history.pop();

    localStorage.setItem('nimedesu_history_triple', encryptTripleLayer(history));
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
                if (currentAnimeInfo) {
                    renderRecommendations(currentAnimeInfo);
                } else {
                    document.getElementById('recommendationSlider').innerHTML = '<p class="text-xs text-zinc-500">Tidak ada anime serupa ditemukan.</p>';
                }
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
    return match ? parseInt(match[1]) : 0;
}

function scrollSlider(direction) {
    const slider = document.getElementById('recommendationSlider');
    const scrollAmount = 220; 
    slider.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
}

function renderRecommendations(currentAnime) {
    const recSlider = document.getElementById('recommendationSlider');
    const rawGenre = currentAnime.genre || currentAnime.Genre;
    if (!rawGenre) {
        recSlider.innerHTML = '<p class="text-xs text-zinc-500">Tidak ada rekomendasi tersedia.</p>';
        return;
    }

    const currentGenres = rawGenre.split(',').map(g => g.trim().toLowerCase());
    
    const recommendations = allAnimeList.filter(a => {
        const aUrl = a.url ? a.url.trim() : "";
        const currentUrl = currentAnime.url ? currentAnime.url.trim() : "";
        const itemGenre = a.genre || a.Genre;
        if (aUrl === currentUrl || !itemGenre) return false;

        const aGenres = itemGenre.split(',').map(g => g.trim().toLowerCase());
        return currentGenres.some(g => aGenres.includes(g));
    }).slice(0, 10);

    if (recommendations.length === 0) {
        recSlider.innerHTML = '<p class="text-xs text-zinc-500">Tidak ada anime serupa ditemukan.</p>';
        return;
    }

    recSlider.innerHTML = recommendations.map(rec => {
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
    initStream();
};
