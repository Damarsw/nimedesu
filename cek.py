import os
import json
import random
import asyncio
import aiohttp
from bs4 import BeautifulSoup
from tqdm.asyncio import tqdm
from supabase import create_client

# ================= 1. KONFIGURASI =================
BASE_URL = "https://anime-indo.lol"
ANIME_LIST_URL = f"{BASE_URL}/anime-list/"
TEMP_SLUGS_FILE = "temp_anime_urls.txt"

CONCURRENCY_LIMIT = 50
MAX_RETRIES = 10

DB_HOST = os.environ.get("KETUMBAR")
DB_SECRET = os.environ.get("LADA_HITAM")
URL_PROXY_LIST = os.environ.get("KUNYIT")

if not DB_HOST or not DB_SECRET:
    raise ValueError("[ERROR] Konfigurasi 'KETUMBAR' atau 'LADA_HITAM' belum diset!")

supabase = create_client(DB_HOST, DB_SECRET)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

# ================= 2. HELPER PROXY & FETCH =================
async def fetch_proxy_list(session):
    if not URL_PROXY_LIST:
        print("[WARNING] 'KUNYIT' kosong, berjalan tanpa proxy.")
        return []

    try:
        async with session.get(URL_PROXY_LIST, timeout=10, ssl=False) as resp:
            if resp.status == 200:
                text = await resp.text()
                return [
                    line.strip() if line.strip().startswith("http") else f"http://{line.strip()}"
                    for line in text.splitlines() if line.strip()
                ]
    except Exception as e:
        print(f"[WARNING] Gagal mengambil proxy list: {e}")
    return []

async def try_proxy(session, url, proxy, timeout=10):
    try:
        async with session.get(url, proxy=proxy, timeout=timeout, ssl=False) as resp:
            if resp.status == 200:
                return await resp.text()
    except Exception:
        return None

async def fetch_html_loop(session, url, proxies, batch_size=5, timeout=10):
    for attempt in range(MAX_RETRIES):
        if proxies:
            batch = random.sample(proxies, min(batch_size, len(proxies)))
            tasks = [try_proxy(session, url, p, timeout) for p in batch]
            results = await asyncio.gather(*tasks)

            for html in results:
                if html:
                    return html

        await asyncio.sleep(0.3)

    try:
        async with session.get(url, timeout=15, ssl=False) as resp:
            if resp.status == 200:
                return await resp.text()
    except Exception:
        pass

    return None

# ================= 3. TAHAP 1: SCRAPING ANIME-LIST =================
def extract_anime_links(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    anime_list_div = soup.find('div', class_='anime-list')
    if not anime_list_div:
        return []

    anime_items = []
    for li in anime_list_div.find_all('li'):
        a_tag = li.find('a')
        if a_tag and a_tag.get('href'):
            title = a_tag.text.strip()
            href = a_tag.get('href').strip()
            if not href.startswith("http"):
                href = BASE_URL + href if href.startswith("/") else f"{BASE_URL}/{href}"
            anime_items.append({"title": title, "url": href})
    return anime_items

async def fetch_all_anime_urls(session, proxies):
    print("\n[=== TAHAP 1: MENGAMBIL DAFTAR ANIME DARI ANIME-LIST ===]")
    visited_urls = set()
    
    if os.path.exists(TEMP_SLUGS_FILE):
        with open(TEMP_SLUGS_FILE, "r", encoding="utf-8") as f:
            visited_urls = set(line.strip() for line in f if line.strip())

    html_data = await fetch_html_loop(session, ANIME_LIST_URL, proxies)
    if not html_data:
        print("[ERROR] Gagal membuka halaman anime-list.")
        return []

    anime_items = extract_anime_links(html_data)
    new_count = 0
    with open(TEMP_SLUGS_FILE, "a", encoding="utf-8") as f:
        for item in anime_items:
            if item["url"] not in visited_urls:
                visited_urls.add(item["url"])
                f.write(f"{item['url']}\n")
                new_count += 1

    print(f"[✔] Tahap 1 Selesai! Total {len(anime_items)} anime ditemukan ({new_count} baru).")
    return anime_items

# ================= 4. TAHAP 2: SCRAPE DETAIL & METADATA =================
async def process_single_anime(session, anime_data, proxies, semaphore, pbar):
    """
    Hanya mengambil metadata (Image, Genre, Synopsis) lalu menyimpannya ke Supabase
    dengan status = ONGOING. Tidak mengambil episode di sini agar proses cepat.
    """
    async with semaphore:
        title = anime_data["title"]
        anime_url = anime_data["url"]

        html_data = await fetch_html_loop(session, anime_url, proxies)
        if not html_data:
            pbar.update(1)
            return

        soup = BeautifulSoup(html_data, 'html.parser')
        detail_div = soup.find('div', class_='detail')
        if not detail_div:
            pbar.update(1)
            return

        # 1. Image URL
        img_tag = detail_div.find('img')
        img_url = ""
        if img_tag and img_tag.get('src'):
            src = img_tag.get('src')
            img_url = src if src.startswith('http') else BASE_URL + src

        # 2. Genre
        genre_tags = detail_div.find_all('a', rel='tag')
        genres = [g.text.strip() for g in genre_tags]
        genre_str = ", ".join(genres)

        # 3. Synopsis
        p_tag = detail_div.find('p')
        synopsis = p_tag.text.strip() if p_tag else ""

        # 4. Record Data
        anime_record = {
            "title": title,
            "url": anime_url,
            "img_url": img_url,
            "synopsis": synopsis,
            "genre": genre_str,
            "status": "ONGOING"
        }

        try:
            supabase.table("anime").insert(anime_record).execute()
        except Exception as e:
            print(f"\n[ERROR] Gagal memasukkan data {title}: {e}")

        pbar.update(1)

# ================= 5. MAIN EXECUTION =================
async def main():
    connector = aiohttp.TCPConnector(limit=1000)

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        proxies = await fetch_proxy_list(session)

        # 1. Ambil semua item dari halaman anime-list/
        all_anime_items = await fetch_all_anime_urls(session, proxies)

        # 2. Ambil daftar URL yang SUDAH ADA di Supabase
        print("\n[*] Mengambil daftar anime yang ada di Supabase...")
        existing_res = supabase.table("anime").select("url").execute()
        existing_urls = {row["url"] for row in existing_res.data}
        print(f"[+] Ditemukan {len(existing_urls)} anime di database.")

        # 3. Filter anime BARU
        pending_anime = [a for a in all_anime_items if a["url"] not in existing_urls]

        print(f"\n[=== TAHAP 2: INGEST METADATA ANIME BARU ===]")
        print(f"[+] Total Anime Ditemukan  : {len(all_anime_items)}")
        print(f"[+] Sisa Antrean Anime Baru: {len(pending_anime)}")

        if pending_anime:
            semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
            pbar = tqdm(total=len(pending_anime), desc="Ingest Anime Baru", unit="anime", leave=True)

            tasks = [
                process_single_anime(session, anime, proxies, semaphore, pbar)
                for anime in pending_anime
            ]
            await asyncio.gather(*tasks)
            pbar.close()

            print(f"\n[✔] Selesai! Semua anime baru berhasil ditambahkan ke Supabase dengan status ONGOING.")
        else:
            print("\n[✔] SEMUA ANIME SUDAH TERSEDIA DI DATABASE (TIDAK ADA DATA BARU)!")

if __name__ == "__main__":
    asyncio.run(main())
