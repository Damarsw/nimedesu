import base64
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
from supabase import create_client

app = Flask(__name__)
CORS(app)

# Konfigurasi Supabase Client
SUPABASE_URL = "https://yezdnsgypbjcgzoftgmz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllemRuc2d5cGJqY2d6b2Z0Z216Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg4Nzg5NSwiZXhwIjoyMTAwNDYzODk1fQ.RV8xeE4YMwEJrkq04y3hScKIkSEduOJLABtCPykdZf8" # Dapatkan di Supabase Settings > API

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Masih mengambil data episode streaming dari storage/JSON jika diperlukan
STORAGE_EPISODE_URL = "https://yezdnsgypbjcqzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_anime_super_lengkap.json"

cache_episodes = None

def fetch_episode_data():
    global cache_episodes
    if cache_episodes:
        return cache_episodes
    try:
        response = requests.get(STORAGE_EPISODE_URL, timeout=30)
        if response.status_code == 200:
            cache_episodes = response.json()
            return cache_episodes
    except Exception as e:
        print(f"Error fetching episodes: {e}")
    return []

@app.route("/")
def home():
    return "NimeDesu Server API is Active!"

# Endpoint /api/anime membaca langsung dari TABEL 'anime'
@app.route("/api/anime", methods=["GET"])
def api_anime():
    try:
        # Mengambil seluruh baris dari tabel 'anime'
        response = supabase.table("anime").select("*").execute()
        return jsonify(response.data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/anime-detail", methods=["GET"])
def api_anime_detail():
    anime_url = request.args.get("url", "").strip()
    if not anime_url:
        return jsonify({"error": "URL tidak valid"}), 400

    super_data = fetch_episode_data()
    matched = next((item for item in super_data if str(item.get("url", "")).strip() == anime_url or str(item.get("link", "")).strip() == anime_url), None)
    
    if matched:
        import copy
        safe_data = copy.deepcopy(matched)
        for ep in safe_data.get("episodes", []):
            for srv in ep.get("video_servers", []):
                original_url = srv.get("video_url", "")
                if original_url:
                    encoded_url = base64.b64encode(original_url.encode('utf-8')).decode('utf-8')
                    srv["video_url"] = encoded_url 
        return jsonify(safe_data)
    return jsonify({"episodes": []})

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
