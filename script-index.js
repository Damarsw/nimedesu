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

function switchView(viewName) {
    document.getElementById('homeView').classList.add('hidden');
    document.getElementById('detailView').classList.add('hidden');
    document.getElementById('dmcaView').classList.add('hidden');
    document.getElementById('cookieLoginView').classList.add('hidden');

    if (viewName === 'home') {
        document.getElementById('homeView').classList.remove('hidden');
        renderHistory();
    } else if (viewName === 'detail') {
        document.getElementById('detailView').classList.remove('hidden');
    } else if (viewName === 'dmca') {
        document.getElementById('dmcaView').classList.remove('hidden');
    } else if (viewName === 'cookieLogin') {
        document.getElementById('cookieLoginView').classList.remove('hidden');
        loadCookiesIntoTextarea();
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
            thumbnail: item.image_url || "https://placehold.co/400x600?text=No+Image",
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
        document.getElementById('animeDisplayGrid').innerHTML = `<p class="text-zinc-600 dark:text-zinc-400 col-span-full text-center py-10 font-medium">Gagal memuat data dari API server Render. Pastikan server aktif.</p>`;
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

    container.innerHTML = currentData.map(item => `
        <div class="group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer" onclick="viewDetails('${item.id}')">
            <div class="relative aspect-[3/4] overflow-hidden bg-zinc-200 dark:bg-zinc-800 poster-hover-container">
                <img src="${item.thumbnail}" alt="${item.title}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300">
                <div class="play-overlay absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center">
                    <div class="w-12 h-12 rounded-full bg-neon-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition duration-300">
                        <i class="fa-solid fa-circle-info ml-0.5 text-base"></i>
                    </div>
                </div>
                <span class="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white dark:text-neon-yellow text-[10px] font-semibold px-2 py-0.5 rounded-full z-10">${item.status}</span>
            </div>
            <div class="p-3">
                <h4 class="font-semibold text-xs sm:text-sm line-clamp-2 text-black dark:text-white">${item.title}</h4>
            </div>
        </div>
    `).join('');

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
            const img = anime.image_url || "https://placehold.co/100x150?text=No+Image";
            
            const animeData = JSON.stringify({
                id: anime.id,
                title: anime.title || "Tanpa Judul",
                url: anime.url ? anime.url.trim() : "",
                status: anime.status || "Ongoing",
                genres: anime.genre ? anime.genre.split(',').map(g => g.trim()) : [],
                synopsis: anime.sinopsis || "Sinopsis belum tersedia.",
                thumbnail: anime.image_url || "https://placehold.co/400x600?text=No+Image",
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

function renderHistory() {
    const historySection = document.getElementById('historySection');
    const historyGrid = document.getElementById('historyGrid');
    
    let encryptedData = localStorage.getItem('nimedesu_history_triple');
    let history = encryptedData ? decryptTripleLayer(encryptedData) || [] : [];

    if (history.length === 0) {
        historySection.classList.add('hidden');
        return;
    }

    historySection.classList.remove('hidden');

    historyGrid.innerHTML = history.map(item => {
        const targetEpsIndex = item.lastEpisodeIndex !== undefined ? item.lastEpisodeIndex : 0;
        
        return `
            <div class="min-w-[140px] sm:min-w-[160px] w-[140px] sm:w-[160px] group bg-neon-lightCard dark:bg-neon-darkCard rounded-xl overflow-hidden border border-neon-yellow dark:border-neon-yellow/60 hover:border-neon-yellow transition-all duration-200 shadow-sm flex flex-col cursor-pointer shrink-0" onclick="window.location.href='stream.html?url=${encodeURIComponent(item.url)}&eps=${targetEpsIndex}'">
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
        `;
    }).join('');
}

function clearHistory() {
    localStorage.removeItem('nimedesu_history_triple');
    document.getElementById('historySection').classList.add('hidden');
}

function loadCookiesIntoTextarea() {
    let encryptedData = localStorage.getItem('nimedesu_history_triple');
    let history = encryptedData ? decryptTripleLayer(encryptedData) || [] : [];
    
    const cookieData = {
        site: "NimeDesu",
        version: "1.0",
        payload: encryptTripleLayer(history)
    };
    document.getElementById('cookieInputArea').value = JSON.stringify(cookieData, null, 2);
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const content = e.target.result;
            document.getElementById('cookieInputArea').value = content;
            
            const parsed = JSON.parse(content);
            const targetPayload = parsed.payload || parsed.triple_encrypted_payload;
            if (targetPayload) {
                const decryptedCheck = decryptTripleLayer(targetPayload);
                if (decryptedCheck && Array.isArray(decryptedCheck)) {
                    localStorage.setItem('nimedesu_history_triple', targetPayload);
                    alert("File cookies berhasil dimuat!");
                    switchView('home');
                    return;
                }
            }
            alert("Format struktur file JSON cookies tidak valid.");
        } catch (err) {
            alert("Gagal membaca file JSON.");
        }
    };
    reader.readAsText(file);
}

function saveCookiesFromInput() {
    try {
        const text = document.getElementById('cookieInputArea').value;
        const parsed = JSON.parse(text);
        
        const targetPayload = parsed.payload || parsed.triple_encrypted_payload;
        if (targetPayload) {
            const decryptedCheck = decryptTripleLayer(targetPayload);
            if (decryptedCheck && Array.isArray(decryptedCheck)) {
                localStorage.setItem('nimedesu_history_triple', targetPayload);
                alert("Cookies berhasil diterapkan!");
                switchView('home');
                return;
            }
        }
        alert("Format JSON tidak valid.");
    } catch (e) {
        alert("Gagal membaca teks JSON. Pastikan formatnya benar.");
    }
}

function downloadCookiesJson() {
    const btn = document.getElementById('btnDownloadCookies');
    btn.className = "px-5 py-2.5 bg-neon-yellow text-black font-bold rounded-xl transition text-xs shadow-glow-yellow";
    setTimeout(() => {
        btn.className = "px-5 py-2.5 bg-neon-lightBg dark:bg-neon-darkBg text-black dark:text-white border border-neon-yellow hover:bg-neon-yellow hover:text-black font-semibold rounded-xl transition text-xs shadow-xs";
    }, 600);

    let encryptedData = localStorage.getItem('nimedesu_history_triple') || encryptTripleLayer([]);

    const cookieData = {
        site: "NimeDesu",
        timestamp: new Date().toISOString(),
        payload: encryptedData
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cookieData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "nimedesu_cookies.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
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

async function loadDynamicGenres() {
    try {
        const perPage = 1000;
        let page = 1;
        let allGenres = new Set();
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
            const data = result.data || [];
            
            data.forEach(anime => {
                if (anime.genre) {
                    anime.genre.split(',').forEach(g => {
                        const cleanGenre = g.trim();
                        if (cleanGenre) allGenres.add(cleanGenre);
                    });
                }
            });

            totalPages = result.total_pages || 1;
            page++;
        } while (page <= totalPages);

        const sortedGenres = Array.from(allGenres).sort();
        const dropdown = document.getElementById('genreDropdown');
        
        if (dropdown && sortedGenres.length > 0) {
            dropdown.innerHTML = sortedGenres.map(genre => `
                <button class="text-left text-xs font-semibold text-black dark:text-white hover:text-black hover:bg-neon-yellow p-1.5 rounded transition" onclick="filterGenre('${genre}')">${genre}</button>
            `).join('');
        } else if (dropdown) {
            dropdown.innerHTML = `<p class="text-xs text-center text-zinc-500 p-2">Tidak ada genre</p>`;
        }
    } catch (e) {
        console.error("Gagal memuat daftar genre dinamis:", e);
    }
}

window.onload = function() {
    const defaultBtn = document.getElementById('btnSemua');
    if(defaultBtn) {
        defaultBtn.classList.remove('bg-neon-lightCard', 'dark:bg-neon-darkCard', 'text-black', 'dark:text-white');
        defaultBtn.classList.add('bg-neon-yellow', 'text-black', 'font-bold', 'border-neon-yellow', 'shadow-glow-yellow');
    }
    
    renderHistory();
    loadAnimeDatabase(1);
    loadDynamicGenres();
};
