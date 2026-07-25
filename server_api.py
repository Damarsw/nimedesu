import base64
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

SUPABASE_URLS = {
    "infozingle": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/otakudesu_infozingle.json",
    "sinopsis": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_anime_sinopsis.json",
    "super_lengkap": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_anime_super_lengkap.json",
    "episode_baru": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_episode_baru.json"
}

cache_data = {}

def fetch_supabase_json(key):
    if key in cache_data:
        return cache_data[key]
    try:
        response = requests.get(SUPABASE_URLS[key], timeout=30)
        if response.status_code == 200:
            data = response.json()
            cache_data[key] = data
            return data
    except Exception as e:
        print(f"Error: {e}")
    return []

@app.route("/")
def home():
    return "NimeDesu Server API is Active!"

@app.route("/api/anime", methods=["GET"])
def api_anime():
    return jsonify(fetch_supabase_json("infozingle"))

@app.route("/api/sinopsis", methods=["GET"])
def api_sinopsis():
    return jsonify(fetch_supabase_json("sinopsis"))

@app.route("/api/super-lengkap", methods=["GET"])
def api_super_lengkap():
    return jsonify(fetch_supabase_json("super_lengkap"))

@app.route("/api/anime-detail", methods=["GET"])
def api_anime_detail():
    anime_url = request.args.get("url", "").strip()
    if not anime_url:
        return jsonify({"error": "URL tidak valid"}), 400

    super_data = fetch_supabase_json("super_lengkap")
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
