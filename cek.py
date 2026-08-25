import os
import re
import random
import asyncio
import aiohttp
from bs4 import BeautifulSoup
from tqdm.asyncio import tqdm
from supabase import create_client

# ================= 1. KONFIGURASI =================
BASE_URL = "https://anime-indo.lol"
PAGE_TARGET = f"{BASE_URL}/page/1/"  # Halaman target update terbaru

CONCURRENCY_LIMIT = 20
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

# ================= 3. AMBIL SELURUH TITLE DARI SUPABASE =================
def get_all_title_status_map_from_supabase():
    """
    Mengambil SELURUH 'title' dan 'status' dari Supabase dengan Pagination.
    Return: { "Judul Anime": "STATUS" }
    """
    title_map = {}
    start = 0
    step = 1000

    while True:
        res = (
            supabase.table("anime")
            .select("title, status")
            .range(start, start + step - 1)
            .execute()
        )
        data = res.data or []
        if not data:
            break

        for row in data:
            if row.get("title"):
                # Normalisasi string judul agar aman dari whitespace berlebih
                norm_title = row["title"].strip()
                title_map[norm_title] = row.get("status", "FINISHED")

        if len(data) < step:
            break

        start += step

    return title_map

# ================= 4. SCRAPE METADATA ANIME BARU =================
async def scrape_new_anime_metadata(session, ep_url, title_from_list, proxies):
    """
    Membuka halaman episode untuk mengambil:
    1. img_url & synopsis
    2. Link 'Semua Episode' -> /anime/slug/ (untuk mengambil URL Induk & Genre)
    """
    html_ep = await fetch_html_loop(session, ep_url, proxies)
    if not html_ep:
        return None

    soup_ep = BeautifulSoup(html_ep, 'html.parser')
    detail_div = soup_ep.find('div', class_='detail')
    
    img_url = ""
    synopsis = ""
    
    if detail_div:
        # Ambil Gambar
        img_tag = detail_div.find('img')
        if img_tag and img_tag.get('src'):
            src = img_tag.get('src')
            img_url = src if src.startswith('http') else BASE_URL + src

        # Ambil Sinopsis
        p_tag = detail_div.find('p')
        synopsis = p_tag.text.strip() if p_tag else ""

    # Cari link ke halaman induk anime "Semua Episode"
    anime_main_url = ""
    nav_div = soup_ep.find('div', class_='navi') or soup_ep.find('div', class_='nav')
    if nav_div:
        for a_tag in nav_div.find_all('a'):
            if "Semua Episode" in a_tag.text:
                href = a_tag.get('href', '').strip()
                if href:
                    anime_main_url = href if href.startswith('http') else BASE_URL + href
                break

    # Jika link induk tidak ketemu, jadikan episode_url sebagai fallback
    if not anime_main_url:
        anime_main_url = ep_ep_url if 'ep_url' in locals() else ep_url

    # Buka halaman induk anime untuk mengambil Genre
    genre_str = ""
    if anime_main_url and anime_main_url != ep_url:
        html_main = await fetch_html_loop(session, anime_main_url, proxies)
        if html_main:
            soup_main = BeautifulSoup(html_main, 'html.parser')
            detail_main = soup_main.find('div', class_='detail')
            if detail_main:
                genre_tags = detail_main.find_all('a', rel='tag')
                genres = [g.text.strip() for g in genre_tags]
                genre_str = ", ".join(genres)

    return {
        "title": title_from_list,
        "url": anime_main_url,
        "img_url": img_url,
        "synopsis": synopsis,
        "genre": genre_str,
        "status": "ONGOING"
    }

# ================= 5. PROSES ANIME ITEM =================
async def process_anime_item(session, item, title_map, proxies, semaphore, pbar):
    async with semaphore:
        title = item["title"]
        ep_url = item["ep_url"]

        # ----------------------------------------------------
        # SKENARIO 1: TITLE BELUM ADA DI SUPABASE
        # -> Scrape Metadata & Insert Baru
        # ----------------------------------------------------
        if title not in title_map:
            anime_data = await scrape_new_anime_metadata(session, ep_url, title, proxies)
            if anime_data:
                try:
                    supabase.table("anime").insert(anime_data).execute()
                    print(f"\n[+] [ANIME BARU INGESTED] {title} -> Status: ONGOING")
                except Exception as e:
                    print(f"\n[ERROR] Gagal insert anime {title}: {e}")

        # ----------------------------------------------------
        # SKENARIO 2: TITLE SUDAH ADA, TAPI STATUSNYA FINISHED
        # -> Update Status ke ONGOING menggunakan Upsert
        # ----------------------------------------------------
        elif title_map.get(title) != "ONGOING":
            try:
                # Update status berdasarkan title
                supabase.table("anime").upsert({
                    "title": title,
                    "status": "ONGOING"
                }, on_conflict="title").execute()
                print(f"\n[↺] [UPDATE STATUS] {title} -> Status diubah dari FINISHED ke ONGOING")
            except Exception as e:
                print(f"\n[ERROR] Gagal update status {title}: {e}")

        # ----------------------------------------------------
        # SKENARIO 3: TITLE SUDAH ADA & STATUS SUDAH ONGOING
        # -> Skip
        # ----------------------------------------------------
        else:
            pass

        pbar.update(1)

# ================= 6. MAIN EXECUTION =================
async def main():
    connector = aiohttp.TCPConnector(limit=1000)

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        proxies = await fetch_proxy_list(session)

        # 1. Tarik seluruh Title & Status dari Supabase
        print("\n[*] Mengambil seluruh judul anime dari Supabase...")
        title_map = get_all_title_status_map_from_supabase()
        print(f"[+] Ditemukan {len(title_map)} judul anime di database Supabase.")

        # 2. Scrape Halaman Update Terbaru (/page/1/)
        print(f"\n[=== MENGAMBIL ANIME UPDATE TERBARU DARI {PAGE_TARGET} ===]")
        html_data = await fetch_html_loop(session, PAGE_TARGET, proxies)
        if not html_data:
            print("[ERROR] Gagal membuka halaman update terbaru.")
            return

        soup = BeautifulSoup(html_data, 'html.parser')

        # Ambil daftar anime dari grid "Update Terbaru"
        # Elemen: <a href="..."><div class="list-anime">...<p>Judul</p></div></a>
        anime_items = []
        seen_titles = set()

        for a_tag in soup.select("div.ngiri div.menu a"):
            ep_url = a_tag.get("href", "").strip()
            p_tag = a_tag.find("p")
            
            if ep_url and p_tag:
                title = p_tag.text.strip()
                if not ep_url.startswith("http"):
                    ep_url = BASE_URL + ep_url if ep_url.startswith("/") else f"{BASE_URL}/{ep_url}"

                if title not in seen_titles:
                    seen_titles.add(title)
                    anime_items.append({
                        "title": title,
                        "ep_url": ep_url
                    })

        print(f"[+] Ditemukan {len(anime_items)} anime pada halaman update terbaru.")

        # 3. Eksekusi Pencocokan & Penambahan/Update Status
        if anime_items:
            semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
            pbar = tqdm(total=len(anime_items), desc="Pencocokan Judul", unit="anime", leave=True)

            tasks = [
                process_anime_item(session, item, title_map, proxies, semaphore, pbar)
                for item in anime_items
            ]
            await asyncio.gather(*tasks)
            pbar.close()

            print("\n[✔] Proses pencocokan berdasarkan judul selesai!")
        else:
            print("\n[INFO] Tidak ada item anime yang ditemukan pada halaman tersebut.")

if __name__ == "__main__":
    asyncio.run(main())
