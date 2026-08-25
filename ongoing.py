from concurrent.futures import ThreadPoolExecutor
import json
import os
import random
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from supabase import create_client

DB_HOST = os.environ.get("KETUMBAR")
DB_SECRET = os.environ.get("LADA_HITAM")
URL = os.environ.get("KUNYIT")

if not DB_HOST or not DB_SECRET:
    raise ValueError("[ERROR] Konfigurasi 'KETUMBAR' atau 'LADA_HITAM' belum diset!")

db = create_client(DB_HOST, DB_SECRET)

BASE_URL = "https://anime-indo.lol"

def fetch_free_proxies():
    """Mengambil daftar proxy dari URL yang di-set di environment."""
    if not URL:
        print("[WARNING] 'KUNYIT' kosong, berjalan tanpa proxy.")
        return []

    try:
        print("[INFO] Mengunduh daftar proxy dari environment URL...")
        res = requests.get(URL, timeout=10)
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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
        " like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def get_random_proxy():
    """Mengatur rotasi IP proxy per request dari list."""
    if PROXY_LIST:
        chosen = random.choice(PROXY_LIST)
        formatted_proxy = chosen if chosen.startswith("http") else f"http://{chosen}"
        return {"http": formatted_proxy, "https": formatted_proxy}

    return None


def create_requests_session():
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


def scrape_video_servers(episode_url):
    """Mengambil link video dengan rotasi IP dan delay 0,5 detik."""
    try:
        time.sleep(0.5)

        current_proxy = get_random_proxy()
        res = http_session.get(
            episode_url, proxies=current_proxy, timeout=15
        )

        if res.status_code != 200:
            return []

        soup = BeautifulSoup(res.text, "html.parser")
        servers = []

        servers_div = soup.find("div", class_="servers")
        if servers_div:
            server_tags = servers_div.find_all("a")
            for tag in server_tags:
                v_link = tag.get("data-video")
                if v_link:
                    if not v_link.startswith("http"):
                        v_link = (
                            BASE_URL + v_link
                            if v_link.startswith("/")
                            else BASE_URL + "/" + v_link
                        )
                    servers.append({"url": v_link})
        return servers
    except requests.exceptions.Timeout:
        print(f"[WARNING] Timeout saat mengakses video servers: {episode_url}")
        return []
    except Exception as e:
        return []


def process_anime(anime):
    """Memproses satu anime dengan rotasi IP dan delay 0,5 detik."""
    anime_id = anime["id"]
    anime_url = anime["url"]
    anime_title = anime["title"]

    try:
        time.sleep(0.5)

        current_proxy = get_random_proxy()
        res = http_session.get(
            anime_url, proxies=current_proxy, timeout=15
        )

        if res.status_code != 200:
            return

        soup = BeautifulSoup(res.text, "html.parser")
        ep_divs = soup.find_all("div", class_="ep")

        existing_res = (
            db.table("episode")
            .select("episode_title")
            .eq("anime_id", anime_id)
            .execute()
        )
        existing_titles = {row["episode_title"] for row in existing_res.data}

        new_episodes = []

        for ep_div in ep_divs:
            a_tags = ep_div.find_all("a")
            for a_tag in a_tags:
                ep_link = a_tag.get("href")
                ep_title = a_tag.text.strip()

                if ep_title in existing_titles:
                    continue

                if ep_link and not ep_link.startswith("http"):
                    ep_link = (
                        BASE_URL + ep_link
                        if ep_link.startswith("/")
                        else BASE_URL + "/" + ep_link
                    )

                new_episodes.append({"title": ep_title, "link": ep_link})

        if not new_episodes:
            return

        print(
            f"[INFO] Ditemukan {len(new_episodes)} episode baru untuk:"
            f" {anime_title}"
        )

        for ep in new_episodes:
            video_servers = scrape_video_servers(ep["link"])

            db.table("episode").insert({
                "anime_id": anime_id,
                "episode_title": ep["title"],
                "episode_url": ep["link"],
                "video_servers": video_servers,
            }).execute()
            print(f"    [+] Berhasil tambah: {anime_title} - Episode {ep['title']}")

    except requests.exceptions.Timeout:
        print(f"[ERROR] Timeout saat memproses anime: {anime_title}")
    except Exception as e:
        print(f"Error memproses {anime_title}: {e}")


def main():
    response = (
        db.table("anime").select("id, url, title").eq("status", "ONGOING").execute()
    )
    ongoing_anime = response.data
    print(
        f"[INFO] Total {len(ongoing_anime)} anime ongoing. Menjalankan scraper"
        " dengan rotasi IP & delay 0,5s..."
    )

    with ThreadPoolExecutor(max_workers=10) as executor:
        executor.map(process_anime, ongoing_anime)

    print("\n[INFO] Proses pengecekan selesai!")


if __name__ == "__main__":
    main()
