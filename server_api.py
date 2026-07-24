from flask import Flask, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

# Public URL dari Supabase Storage Anda
SUPABASE_URLS = {
    "infozingle": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/otakudesu_infozingle.json",
    "sinopsis": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_anime_sinopsis.json",
    "super_lengkap": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_anime_super_lengkap.json",
    "episode_baru": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_episode_baru.json"
}

def fetch_supabase_json(key):
    try:
        response = requests.get(SUPABASE_URLS[key], timeout=20)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"Gagal mengambil data dari Supabase ({key}): {e}")
    return []

@app.route("/")
def home():
    return "NimeDesu API Server with Supabase is Active!"

@app.route("/api/anime", methods=["GET"])
def api_anime():
    return jsonify(fetch_supabase_json("infozingle"))

@app.route("/api/sinopsis", methods=["GET"])
def api_sinopsis():
    return jsonify(fetch_supabase_json("sinopsis"))

@app.route("/api/super-lengkap", methods=["GET"])
def api_super_lengkap():
    return jsonify(fetch_supabase_json("super_lengkap"))

@app.route("/api/episode-baru", methods=["GET"])
def api_episode_baru():
    return jsonify(fetch_supabase_json("episode_baru"))

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
