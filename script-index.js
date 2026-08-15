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
const SUPABASE_ANON_KEY = "MASUKKAN_ANON_KEY_SUPABASE_DI_SINI";

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
                        <span class="text-xs font-bold text-black
