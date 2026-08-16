from concurrent.futures import ThreadPoolExecutor
import json
import random
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from supabase import create_client

# Konfigurasi Supabase
SUPABASE_URL = "https://yezdnsgypbjcgzoftgmz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllemRuc2d5cGJqY2d6b2Z0Z216Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg4Nzg5NSwiZXhwIjoyMTAwNDYzODk1fQ.RV8xeE4YMwEJrkq04y3hScKIkSEduOJLABtCPykdZf8"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

BASE_URL = "https://anime-indo.lol"

# ==================== KONFIGURASI PROXY ====================
# OPSI A: Jika pakai List Proxy Manual (isi dengan proxy http/https lo)
PROXY_LIST = [
    # "http://ip_proxy:port",
    # "http://username:password@ip_proxy:port",
]

# OPSI B: Jika pakai Rotating Proxy Service (1 endpoint otomatis ganti IP)
ROTATING_PROXY_URL = ""  # Contoh: "http://user:pass@gate.proxyprovider.com:port"
# ============================================================

headers = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
        " like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def get_random_proxy():
  """Mengatur rotasi IP proxy per request."""
  if ROTATING_PROXY_URL:
    return {"http": ROTATING_PROXY_URL, "https": ROTATING_PROXY_URL}

  if PROXY_LIST:
    chosen_proxy = random.choice(PROXY_LIST)
    return {"http": chosen_proxy, "https": chosen_proxy}

  return None  # Tanpa proxy (pakai IP lokal)


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
    # Jeda 0,5 detik sesuai permintaan
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
    # Jeda 0,5 detik sebelum request halaman anime
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
        supabase.table("episode")
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

      supabase.table("episode").insert({
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
      supabase.table("anime").select("id, url, title").eq("status", "ONGOING").execute()
  )
  ongoing_anime = response.data
  print(
      f"[INFO] Total {len(ongoing_anime)} anime ongoing. Menjalankan scraper"
      " dengan rotasi IP & delay 0,5s (max 50 worker)..."
  )

  # Worker diturunkan ke 10 agar delay 0.5 detik dan rotasi IP berjalan efektif tanpa tabrakan socket
  with ThreadPoolExecutor(max_workers=50) as executor:
    executor.map(process_anime, ongoing_anime)

  print("\n[INFO] Proses pengecekan selesai!")


if __name__ == "__main__":
  main()