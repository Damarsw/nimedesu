import concurrent.futures
import threading
import time
from bs4 import BeautifulSoup
from supabase import Client, create_client
import requests

# Konfigurasi Supabase
SUPABASE_URL = "https://yezdnsgypbjcgzoftgmz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllemRuc2d5cGJqY2d6b2Z0Z216Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg4Nzg5NSwiZXhwIjoyMTAwNDYzODk1fQ.RV8xeE4YMwEJrkq04y3hScKIkSEduOJLABtCPykdZf8"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Variabel Global, Lock, & Proxy Management
print_lock = threading.Lock()
proxy_lock = threading.Lock()

# Daftar Proxy yang bisa Anda sesuaikan/tambahkan (Format: "ip:port" atau dengan protokol)
PROXY_LIST = [
    # "http://123.45.67.89:8080",
]
last_proxy_rotation = time.time()
current_proxy_index = 0

def get_current_proxy():
    """Mengambil proxy dan merotasi setiap 1 detik sekali secara thread-safe"""
    global last_proxy_rotation, current_proxy_index
    if not PROXY_LIST:
        return None
    
    with proxy_lock:
        now = time.time()
        if now - last_proxy_rotation >= 1.0:
            current_proxy_index = (current_proxy_index + 1) % len(PROXY_LIST)
            last_proxy_rotation = now
        
        proxy_url = PROXY_LIST[current_proxy_index]
        return {"http": proxy_url, "https": proxy_url}

def make_request_with_proxy(url, headers, timeout=15):
    """Helper untuk melakukan request dengan rotasi proxy otomatis"""
    proxies = get_current_proxy()
    try:
        return requests.get(url, headers=headers, proxies=proxies, timeout=timeout)
    except Exception:
        return requests.get(url, headers=headers, timeout=timeout)


# ==========================================
# TAHAP 1: SCRAPE LIST ANIME
# ==========================================
def step_1_scrape_anime_list():
    print("\n[TAHAP 1/4] Memulai Scraping Daftar Anime...")
    url = "https://anime-indo.lol/anime-list/"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    response = make_request_with_proxy(url, headers)
    if response.status_code != 200:
        print(f"Gagal mengakses website utama. Status code: {response.status_code}")
        return

    soup = BeautifulSoup(response.text, "html.parser")
    anime_links = soup.select("div.anime-list a")
    total_elements = len(anime_links)
    print(f"Ditemukan {total_elements} elemen anime. Memeriksa database...")

    new_entries_count = 0
    for index, tag in enumerate(anime_links, start=1):
        title = tag.text.strip()
        href = tag.get("href")

        if index % 100 == 0:
            print(f"Proses list anime: item ke-{index} dari {total_elements}...")

        if not title or not href or href == "#" or href.startswith("#"):
            continue

        anime_url = f"https://anime-indo.lol{href}" if not href.startswith("http") else href

        existing = supabase.table("anime").select("id").eq("title", title).execute()
        if not existing.data:
            supabase.table("anime").insert({"title": title, "url": anime_url}).execute()
            new_entries_count += 1

    print(f"[TAHAP 1 SELESAI] Berhasil menambahkan {new_entries_count} anime baru.")


# ==========================================
# TAHAP 2: SCRAPE INFO / DETAIL ANIME
# ==========================================
def process_anime_info_with_retry(item, headers, max_retries=20):
    anime_id = item["id"]
    url = item["url"]

    if item.get("img_url") and item.get("genre") and item.get("sinopsis"):
        return

    if not url:
        return

    for attempt in range(1, max_retries + 1):
        try:
            res = make_request_with_proxy(url, headers, timeout=10)
            if res.status_code != 200:
                if attempt == max_retries: return
                time.sleep(1)
                continue

            soup = BeautifulSoup(res.text, "html.parser")
            detail_div = soup.select_one("div.detail")
            
            if not detail_div:
                return

            img_tag = detail_div.select_one("img")
            img_url = None
            if img_tag and img_tag.get("src"):
                src = img_tag.get("src")
                img_url = f"https://anime-indo.lol{src}" if not src.startswith("http") else src

            genre_tags = detail_div.select("li > a[rel='tag']")
            genres = [g.text.strip() for g in genre_tags if g.text.strip()]
            genre_str = ", ".join(genres) if genres else None

            p_tag = detail_div.select_one("p")
            sinopsis = p_tag.text.strip() if p_tag else None

            update_data = {}
            if img_url and not item.get("img_url"): update_data["img_url"] = img_url
            if genre_str and not item.get("genre"): update_data["genre"] = genre_str
            if sinopsis and not item.get("sinopsis"): update_data["sinopsis"] = sinopsis

            if update_data:
                supabase.table("anime").update(update_data).eq("id", anime_id).execute()
            return

        except Exception:
            if attempt == max_retries: return
            time.sleep(1)

def step_2_update_anime_details():
    print("\n[TAHAP 2/4] Memperbarui Info/Detail Anime (100 Thread Paralel)...")
    anime_list = []
    batch_size, start = 1000, 0
    while True:
        response = supabase.table("anime").select("id, title, url, img_url, genre, sinopsis").range(start, start + batch_size - 1).execute()
        if not response.data: break
        anime_list.extend(response.data)
        if len(response.data) < batch_size: break
        start += batch_size

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = [executor.submit(process_anime_info_with_retry, item, headers) for item in anime_list]
        concurrent.futures.wait(futures)
    print("[TAHAP 2 SELESAI] Info anime diperbarui.")


# ==========================================
# TAHAP 3: SCRAPE EPISODE
# ==========================================
def process_anime_episodes_with_retry(item, headers, max_retries=20):
    anime_id = item["id"]
    anime_url = item["url"]

    try:
        check_ep = supabase.table("episode").select("id").eq("anime_id", anime_id).limit(1).execute()
        if check_ep.data:
            return
    except Exception:
        pass

    if not anime_url:
        return

    for attempt in range(1, max_retries + 1):
        try:
            res = make_request_with_proxy(anime_url, headers, timeout=15)
            if res.status_code != 200:
                if attempt == max_retries: return
                time.sleep(1)
                continue

            soup = BeautifulSoup(res.text, "html.parser")
            ep_links = soup.select("div.ep a")
            
            if not ep_links:
                return

            episodes_data_to_insert = []
            for ep in ep_links:
                ep_title = ep.text.strip()
                href = ep.get("href")
                full_url = f"https://anime-indo.lol{href}" if (href and not href.startswith("http")) else href

                episodes_data_to_insert.append({
                    "anime_id": anime_id,
                    "episode_title": ep_title,
                    "episode_url": full_url,
                })

            if episodes_data_to_insert:
                supabase.table("episode").insert(episodes_data_to_insert).execute()
            return

        except Exception:
            if attempt == max_retries: return
            time.sleep(1)

def step_3_scrape_episodes():
    print("\n[TAHAP 3/4] Mengambil Data Episode Anime (100 Thread Paralel)...")
    anime_list = []
    batch_size, start = 1000, 0
    while True:
        response = supabase.table("anime").select("id, title, url").range(start, start + batch_size - 1).execute()
        if not response.data: break
        anime_list.extend(response.data)
        if len(response.data) < batch_size: break
        start += batch_size

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = [executor.submit(process_anime_episodes_with_retry, item, headers) for item in anime_list]
        concurrent.futures.wait(futures)
    print("[TAHAP 3 SELESAI] Data episode berhasil dimasukkan.")


# ==========================================
# TAHAP 4: SCRAPE VIDEO SERVERS
# ==========================================
def process_video_servers_with_retry(item, headers, max_retries=20):
    anime_id = item["id"]
    anime_url = item["url"]

    if not anime_url:
        return

    for attempt in range(1, max_retries + 1):
        try:
            res = make_request_with_proxy(anime_url, headers, timeout=15)
            if res.status_code != 200:
                if attempt == max_retries: return
                time.sleep(1)
                continue

            soup = BeautifulSoup(res.text, "html.parser")
            ep_links = soup.select("div.ep a")
            if not ep_links:
                return

            for ep in ep_links:
                ep_href = ep.get("href")
                ep_url = f"https://anime-indo.lol{ep_href}" if (ep_href and not ep_href.startswith("http")) else ep_href

                try:
                    existing_ep = supabase.table("episode").select("video_servers").eq("anime_id", anime_id).eq("episode_url", ep_url).execute()
                    old_servers = existing_ep.data[0].get("video_servers") if (existing_ep.data and existing_ep.data[0].get("video_servers")) else []

                    ep_res = make_request_with_proxy(ep_url, headers, timeout=10)
                    if ep_res.status_code != 200:
                        continue

                    ep_soup = BeautifulSoup(ep_res.text, "html.parser")
                    server_tags = ep_soup.select("div.servers a")
                    
                    if not server_tags:
                        continue

                    video_servers_list = []
                    for s_tag in server_tags:
                        data_video = s_tag.get("data-video")
                        if data_video:
                            if not data_video.startswith("http"):
                                server_url = f"https://anime-indo.lol{data_video}" if data_video.startswith("/") else f"https://anime-indo.lol/{data_video}"
                            else:
                                server_url = data_video
                            video_servers_list.append({"url": server_url})

                    if video_servers_list == old_servers:
                        continue

                    if video_servers_list:
                        supabase.table("episode").update({"video_servers": video_servers_list}).eq("anime_id", anime_id).eq("episode_url", ep_url).execute()

                except Exception:
                    continue
            return

        except Exception:
            if attempt == max_retries: return
            time.sleep(1)

def step_4_scrape_video_servers():
    print("\n[TAHAP 4/4] Mengambil Data Video Servers (100 Thread Paralel)...")
    anime_list = []
    batch_size, start = 1000, 0
    while True:
        response = supabase.table("anime").select("id, title, url").range(start, start + batch_size - 1).execute()
        if not response.data: break
        anime_list.extend(response.data)
        if len(response.data) < batch_size: break
        start += batch_size

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = [executor.submit(process_video_servers_with_retry, item, headers) for item in anime_list]
        concurrent.futures.wait(futures)
    print("[TAHAP 4 SELESAI] Data video servers berhasil diperbarui.")


# ==========================================
# MAIN BOT CONTROLLER
# ==========================================
if __name__ == "__main__":
    print("=" * 60)
    print("BOT SCRAPER UTAMA (ANIME -> INFO -> EPISODE -> VIDEO) DIMULAI")
    print("=" * 60)
    
    step_1_scrape_anime_list()
    step_2_update_anime_details()
    step_3_scrape_episodes()
    step_4_scrape_video_servers()

    print("\n" + "=" * 60)
    print("SELURUH RANGKAIAN PROSES SCRAPING TELAH SELESAI!")
    print("=" * 60)