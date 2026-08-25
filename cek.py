from concurrent.futures import ThreadPoolExecutor
import os
import random
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from supabase import create_client

# ---------------------------------------------------------------------------
# KONFIGURASI ENVIRONMENT & SUPABASE
# ---------------------------------------------------------------------------
DB_HOST = os.environ.get("KETUMBAR")
DB_SECRET = os.environ.get("LADA_HITAM")
URL_PROXY = os.environ.get("KUNYIT")

if not DB_HOST or not DB_SECRET:
    raise ValueError("[ERROR] Konfigurasi 'KETUMBAR' atau 'LADA_HITAM' belum diset!")

supabase = create_client(DB_HOST, DB_SECRET)

BASE_URL = "https://anime-indo.lol"
ANIME_LIST_URL = f"{BASE_URL}/anime-list/"

# ---------------------------------------------------------------------------
# ROTASI PROXY & SESSION
# ---------------------------------------------------------------------------
def fetch_free_proxies():
    """Mengambil daftar proxy dari URL environment (KUNYIT)."""
    if not URL_PROXY:
        print("[WARNING] 'KUNYIT' kosong, berjalan tanpa proxy.")
        return []

    try:
        print("[INFO] Mengunduh daftar proxy...")
        res = requests.get(URL_PROXY, timeout=10)
        if res.status_code == 200:
            proxies = [line.strip() for line in res.text.strip().split("\n") if line.strip()]
            print(f"[INFO] Berhasil mengambil {len(proxies)} proxy.")
            return proxies
    except Exception as e:
        print(f"[WARNING] Gagal mengambil proxy: {e}")
    return []

PROXY_LIST = fetch_free_proxies()

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

def get_random_proxy():
    """Mendapatkan proxy acak jika daftar proxy tersedia."""
    if PROXY_LIST:
        chosen = random.choice(PROXY_LIST)
        formatted_proxy = chosen if chosen.startswith("http") else f"http://{chosen}"
        return {"http": formatted_proxy, "https": formatted_proxy}
    return None

def create_requests_session():
    """Membuat session HTTP dengan strategi retry otomatis."""
    session = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504, 408],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(headers)
    return session

http_session = create_requests_session()

# ---------------------------------------------------------------------------
# HELPER SCRAPING DETAIL
# ---------------------------------------------------------------------------
def scrape_video_servers(episode_url):
    """Mengambil link server streaming video dari halaman episode."""
    try:
        time.sleep(0.5)
        res = http_session.get(
            episode_url, proxies=get_random_proxy(), timeout=15
        )
        if res.status_code != 200:
            return []

        soup = BeautifulSoup(res.text, "html.parser")
        servers = []
        servers_div = soup.find("div", class_="servers")

        if servers_div:
            for tag in servers_div.find_all("a"):
                v_link = tag.get("data-video")
                if v_link:
                    if not v_link.startswith("http"):
                        v_link = BASE_URL + v_link if v_link.startswith("/") else BASE_URL + "/" + v_link
                    servers.append({"url": v_link})
        return servers
    except Exception as e:
        print(f"[WARNING] Gagal mengambil server video ({episode_url}): {e}")
        return []


def process_new_anime(anime_data):
    """
    1. Buka URL detail anime.
    2. Extract: img_url, synopsis, genre.
    3. Simpan anime baru ke tabel 'anime' dengan status='ONGOING'.
    4. Extract seluruh episode & video_servers.
    5. Simpan episode ke tabel 'episode'.
    """
    title = anime_data["title"]
    anime_url = anime_data["url"]

    try:
        time.sleep(0.5)
        res = http_session.get(anime_url, proxies=get_random_proxy(), timeout=15)
        if res.status_code != 200:
            print(f"[WARNING] Gagal membuka detail anime: {title} (Status {res.status_code})")
            return

        soup = BeautifulSoup(res.text, "html.parser")
        detail_div = soup.find("div", class_="detail")

        if not detail_div:
            print(f"[WARNING] Elemen detail tidak ditemukan di: {anime_url}")
            return

        # 1. Image URL
        img_tag = detail_div.find("img")
        img_url = ""
        if img_tag and img_tag.get("src"):
            img_src = img_tag.get("src")
            img_url = img_src if img_src.startswith("http") else BASE_URL + img_src

        # 2. Genre (kumpulan tag <a rel="tag">)
        genre_tags = detail_div.find_all("a", rel="tag")
        genres = [g.text.strip() for g in genre_tags]
        genre_str = ", ".join(genres)

        # 3. Synopsis (tag <p> di dalam detail)
        p_tag = detail_div.find("p")
        synopsis = p_tag.text.strip() if p_tag else ""

        # 4. Insert anime ke tabel 'anime' (Supabase)
        anime_insert_data = {
            "title": title,
            "url": anime_url,
            "img_url": img_url,
            "synopsis": synopsis,
            "genre": genre_str,
            "status": "ONGOING"
        }

        insert_res = supabase.table("anime").insert(anime_insert_data).execute()
        if not insert_res.data:
            print(f"[ERROR] Gagal menyimpan anime {title} ke database.")
            return

        inserted_anime = insert_res.data[0]
        anime_id = inserted_anime["id"]
        print(f"[+] [ANIME BARU] Berhasil ditambahkan: {title} (ID: {anime_id})")

        # 5. Extract & simpan episode beserta server video
        ep_divs = soup.find_all("div", class_="ep")
        episodes_to_process = []

        for ep_div in ep_divs:
            for a_tag in ep_div.find_all("a"):
                ep_link = a_tag.get("href")
                ep_title = a_tag.text.strip()

                if ep_link and not ep_link.startswith("http"):
                    ep_link = BASE_URL + ep_link if ep_link.startswith("/") else BASE_URL + "/" + ep_link

                episodes_to_process.append({"title": ep_title, "link": ep_link})

        print(f"    [INFO] Memproses {len(episodes_to_process)} episode untuk {title}...")

        for ep in episodes_to_process:
            video_servers = scrape_video_servers(ep["link"])

            supabase.table("episode").insert({
                "anime_id": anime_id,
                "episode_title": ep["title"],
                "episode_url": ep["link"],
                "video_servers": video_servers,
            }).execute()
            print(f"    [+] Episode ditambahkan: {title} - Episode {ep['title']}")

    except Exception as e:
        print(f"[ERROR] Gagal memproses anime {title}: {e}")

# ---------------------------------------------------------------------------
# MAIN EXECUTION
# ---------------------------------------------------------------------------
def main():
    print("[INFO] Mengambil daftar URL anime yang sudah ada di Supabase...")
    existing_response = supabase.table("anime").select("url").execute()
    existing_urls = {row["url"] for row in existing_response.data}
    print(f"[INFO] Ditemukan {len(existing_urls)} anime di database.")

    print(f"[INFO] Mengakses halaman Anime List: {ANIME_LIST_URL}")
    try:
        res = http_session.get(ANIME_LIST_URL, proxies=get_random_proxy(), timeout=20)
        if res.status_code != 200:
            print(f"[ERROR] Gagal membuka anime-list/ (HTTP {res.status_code})")
            return
    except Exception as e:
        print(f"[ERROR] Gagal terkoneksi ke halaman anime-list: {e}")
        return

    soup = BeautifulSoup(res.text, "html.parser")
    anime_list_div = soup.find("div", class_="anime-list")

    if not anime_list_div:
        print("[ERROR] Elemen 'anime-list' tidak ditemukan pada halaman.")
        return

    # Extract semua link anime dari elemen <li><a href="...">Title</a></li>
    new_anime_list = []
    for li in anime_list_div.find_all("li"):
        a_tag = li.find("a")
        if a_tag and a_tag.get("href"):
            anime_title = a_tag.text.strip()
            anime_url = a_tag.get("href")

            if not anime_url.startswith("http"):
                anime_url = BASE_URL + anime_url if anime_url.startswith("/") else BASE_URL + "/" + anime_url

            # Cek apakah URL sudah ada di database
            if anime_url not in existing_urls:
                new_anime_list.append({
                    "title": anime_title,
                    "url": anime_url
                })

    print(f"[INFO] Ditemukan {len(new_anime_list)} anime BARU yang belum ada di database.")

    if not new_anime_list:
        print("[INFO] Tidak ada anime baru untuk ditambahkan. Selesai.")
        return

    # Jalankan scraping paralel menggunakan Multithreading (10 Worker)
    with ThreadPoolExecutor(max_workers=10) as executor:
        executor.map(process_new_anime, new_anime_list)

    print("\n[INFO] Proses penambahan anime baru selesai!")


if __name__ == "__main__":
    main()