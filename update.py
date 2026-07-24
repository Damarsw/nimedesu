from bs4 import BeautifulSoup
import json
import os
import time
import requests
import subprocess
import threading
from flask import Flask, jsonify
from flask_cors import CORS

# ==========================================
# KONFIGURASI FILE DATABASE LOKAL RENDER
# ==========================================
DB_ANIME_FINAL = "otakudesu_infozingle.json"
DB_EPISODE_BARU = "data_anime_sinopsis.json"
DB_SUPER_LENGKAP = "data_anime_super_lengkap.json"
TARGET_LIST_URL = "https://otakudesu.blog/anime/"

# ==========================================
# SETUP FLASK & API SERVER (CORS ENABLED)
# ==========================================
app = Flask(__name__)
CORS(app)  # Membuka akses agar Vercel bisa mengambil data API ini

@app.route("/")
def home():
    return "NimeDesu Auto-Updater & API Server is Active!"

@app.route("/api/anime", methods=["GET"])
def api_anime():
    return jsonify(load_json(DB_ANIME_FINAL))

@app.route("/api/sinopsis", methods=["GET"])
def api_sinopsis():
    return jsonify(load_json(DB_EPISODE_BARU))

@app.route("/api/super-lengkap", methods=["GET"])
def api_super_lengkap():
    return jsonify(load_json(DB_SUPER_LENGKAP))

def run_flask():
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)


def load_json(filename):
    if not os.path.exists(filename):
        return []
    with open(filename, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []


def save_json(filename, data):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


# ==========================================
# MODUL SELENIUM STREAMING
# ==========================================
def format_servers_data(video_servers):
    formatted_servers = []
    server_counters = {"360": 1, "480": 1, "720": 1, "1080": 1}

    for s in video_servers:
        orig_res = str(s.get("resolution", "")).lower()
        if "360" in orig_res:
            res_key = "360"
            resolution_text = "Mirror 360p"
        elif "480" in orig_res:
            res_key = "480"
            resolution_text = "Mirror 480p"
        elif "720" in orig_res:
            res_key = "720"
            resolution_text = "Mirror 720p"
        elif "1080" in orig_res:
            res_key = "1080"
            resolution_text = "Mirror 1080p"
        else:
            res_key = "360"
            resolution_text = "Mirror 360p"

        current_server_num = str(server_counters[res_key])
        server_counters[res_key] += 1

        formatted_servers.append({
            "resolution": resolution_text,
            "server": current_server_num,
            "video_url": s.get("video_url", "")
        })
    return formatted_servers


def get_iframe_links_with_retry(episode_url, max_retries=2):
    for attempt in range(max_retries + 1):
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait

        options = webdriver.ChromeOptions()
        options.add_argument("--headless")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")

        driver = webdriver.Chrome(options=options)
        raw_video_servers = []
        seen_urls = set()

        try:
            driver.get(episode_url)
            time.sleep(3)

            server_links = driver.find_elements(By.CSS_SELECTOR, "div.mirrorstream ul li a[data-content]")
            if not server_links and attempt < max_retries:
                driver.quit()
                time.sleep(2)
                continue

            for index in range(len(server_links)):
                try:
                    server_links = driver.find_elements(By.CSS_SELECTOR, "div.mirrorstream ul li a[data-content]")
                    if index >= len(server_links):
                        break

                    target_link = server_links[index]
                    parent_ul = target_link.find_element(By.XPATH, "./ancestor::ul")
                    resolution_text = "Unknown"
                    try:
                        resolution_text = parent_ul.text.replace("\n", " ").strip()
                    except:
                        pass

                    driver.execute_script("arguments[0].click();", target_link)
                    WebDriverWait(driver, 10).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, "div.responsive-embed-stream iframe, div#pembed iframe"))
                    )
                    iframe_element = driver.find_element(By.CSS_SELECTOR, "div.responsive-embed-stream iframe, div#pembed iframe")
                    video_src = iframe_element.get_attribute("src")

                    if video_src and video_src not in seen_urls:
                        seen_urls.add(video_src)
                        raw_video_servers.append({"resolution": resolution_text, "video_url": video_src})
                    time.sleep(0.5)
                except:
                    continue

            driver.quit()
            return format_servers_data(raw_video_servers)
        except:
            driver.quit()
            if attempt < max_retries:
                time.sleep(2)
    return []


# ==========================================
# UTILITY SCRAPING DETAIL (SINOPSIS & EPISODE)
# ==========================================
def scrape_anime_details_from_web(anime_url):
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    try:
        response = requests.get(anime_url, headers=headers, timeout=15)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")

            sinopsis_text = ""
            synopsis_section = soup.find("div", class_="sinopc")
            if synopsis_section:
                synopsis_texts = [p.text.strip() for p in synopsis_section.find_all("p") if p.text.strip()]
                sinopsis_text = "\n\n".join(synopsis_texts)

            eps_section = soup.find("div", class_="episodelist")
            episode_list = []
            if eps_section:
                for li in eps_section.find_all("li"):
                    a_tag = li.find("a")
                    if a_tag:
                        ep_title = a_tag.text.strip()
                        ep_url = a_tag["href"]
                        if "batch" not in ep_title.lower() and "batch" not in ep_url.lower():
                            episode_list.append({"episode_title": ep_title, "episode_url": ep_url})

            return {"sinopsis": sinopsis_text, "episodes": episode_list}
    except Exception as e:
        print(f"Gagal mengambil detail anime: {e}")
    return {"sinopsis": "", "episodes": []}


# ==========================================
# LOGIKA UTAMA BOT AUTO-UPDATE
# ==========================================
def run_auto_updater():
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Memulai pengecekan pembaruan otomatis...")

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

    db_final = load_json(DB_ANIME_FINAL)
    db_eps_baru = load_json(DB_EPISODE_BARU)
    db_super_lengkap = load_json(DB_SUPER_LENGKAP)

    existing_final_urls = {item.get("url") for item in db_final if "url" in item}
    has_updates = False

    # TAHAP 1: Cek Anime Baru
    print("[TAHAP 1] Memeriksa anime baru...")
    try:
        response = requests.get(TARGET_LIST_URL, headers=headers, timeout=15)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            for item in soup.select("ul.chivsrc li"):
                a_tag = item.find("a")
                img_tag = item.find("img")
                if a_tag:
                    url = a_tag["href"]
                    title = a_tag.text.strip()
                    img_url = img_tag["src"] if img_tag else ""

                    if url and url not in existing_final_urls:
                        print(f" [+] Ditemukan Anime Baru: {title}")
                        details = scrape_anime_details_from_web(url)

                        new_anime_entry = {
                            "title": title,
                            "url": url,
                            "image_url": img_url,
                            "sinopsis": details["sinopsis"]
                        }
                        db_final.append(new_anime_entry)
                        existing_final_urls.add(url)
                        has_updates = True
                        time.sleep(1)

            if has_updates:
                save_json(DB_ANIME_FINAL, db_final)
    except Exception as e:
        print(f"Error pada Tahap 1: {e}")

    eps_baru_map = {item["url"]: item for item in db_eps_baru if "url" in item}
    super_map = {item.get("url") or item.get("link"): item for item in db_super_lengkap if item.get("url") or item.get("link")}

    # TAHAP 2 & 3: Cek Episode Baru & Streaming
    print("[TAHAP 2 & 3] Memeriksa episode baru & link streaming...")
    for anime in db_final:
        title = anime.get("title") or anime.get("Judul")
        url = anime.get("url")
        status = anime.get("Status", "").lower()

        if not anime.get("sinopsis"):
            details_init = scrape_anime_details_from_web(url)
            if details_init["sinopsis"]:
                anime["sinopsis"] = details_init["sinopsis"]
                has_updates = True

        if "ongoing" in status or not status:
            web_details = scrape_anime_details_from_web(url)
            web_episodes = web_details.get("episodes", [])
            if not web_episodes:
                continue

            stored_eps_entry = eps_baru_map.get(url)
            stored_eps_list = stored_eps_entry.get("episodes", []) if stored_eps_entry else []
            stored_ep_urls = {e["episode_url"] for e in stored_eps_list}

            if len(web_episodes) > len(stored_eps_list):
                print(f"\n [!] Episode baru terdeteksi untuk: {title}")

                new_episodes_to_add = []
                for ep in web_episodes:
                    if ep["episode_url"] not in stored_ep_urls:
                        print(f"  -> Mengambil link streaming via Selenium untuk: {ep['episode_title']}")
                        video_servers = get_iframe_links_with_retry(ep["episode_url"])

                        new_ep_data = {
                            "episode_title": ep["episode_title"],
                            "episode_url": ep["episode_url"],
                            "video_servers": video_servers
                        }
                        new_episodes_to_add.append(new_ep_data)
                        has_updates = True
                        time.sleep(0.5)

                if stored_eps_entry:
                    for ne in reversed(new_episodes_to_add):
                        stored_eps_list.insert(0, ne)
                    stored_eps_entry["episodes"] = stored_eps_list
                else:
                    new_entry_eps = {
                        "title": title,
                        "url": url,
                        "episodes": new_episodes_to_add
                    }
                    db_eps_baru.append(new_entry_eps)
                    eps_baru_map[url] = new_entry_eps

                save_json(DB_EPISODE_BARU, db_eps_baru)

                super_entry = super_map.get(url)
                if super_entry:
                    super_eps_list = super_entry.get("episodes", [])
                    for ne in reversed(new_episodes_to_add):
                        super_eps_list.insert(0, ne)
                    super_entry["episodes"] = super_eps_list
                else:
                    new_super_entry = {
                        "title": title,
                        "url": url,
                        "sinopsis": anime.get("sinopsis", ""),
                        "episodes": new_episodes_to_add
                    }
                    db_super_lengkap.append(new_super_entry)
                    super_map[url] = new_super_entry

                save_json(DB_SUPER_LENGKAP, db_super_lengkap)

    if has_updates:
        save_json(DB_ANIME_FINAL, db_final)
        print("\n[SUKSES] Sinkronisasi bot selesai!")
    else:
        print("\n[-] Tidak ada pembaruan baru.")


if __name__ == "__main__":
    t = threading.Thread(target=run_flask)
    t.daemon = True
    t.start()

    print("=== BOT AUTO-UPDATE & API SERVER DIMULAI ===")
    INTERVAL_DETIK = 86400  # Cek setiap 24 jam sekali
    while True:
        run_auto_updater()
        time.sleep(INTERVAL_DETIK)