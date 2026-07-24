from flask import Flask, jsonify, request
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

# URL Public Supabase Storage Anda
SUPABASE_URLS = {
    "infozingle": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/otakudesu_infozingle.json",
    "sinopsis": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_anime_sinopsis.json",
    "super_lengkap": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_anime_super_lengkap.json",
    "episode_baru": "https://yezdnsgypbjcgzoftgmz.supabase.co/storage/v1/object/public/database_anime/data_episode_baru.json"
}

# Cache agar tidak terus-menerus download file besar dari Supabase
cache_data = {}

def fetch_supabase_json(key):
    if key in cache_data:
        return cache_data[key]
    try:
        response = requests.get(SUPABASE_URLS[key], timeout=20)
        if response.status_code == 200:
            data = response.json()
            cache_data[key] = data
            return data
    except Exception as e:
        print(f"Gagal mengambil data dari Supabase ({key}): {e}")
    return []

@app.route("/")
def home():
    return "NimeDesu Fast API Server with Supabase is Active!"

@app.route("/api/anime", methods=["GET"])
def api_anime():
    db_type = request.args.get("db", "infozingle")
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 12))
    
    data = fetch_supabase_json(db_type)
    
    if not isinstance(data, list):
        return jsonify({"total": 0, "page": page, "total_pages": 0, "data": []})

    total_data = len(data)
    start = (page - 1) * limit
    end = start + limit
    
    paginated_data = data[start:end]
    
    return jsonify({
        "total": total_data,
        "page": page,
        "limit": limit,
        "total_pages": (total_data + limit - 1) // limit,
        "data": paginated_data
    })

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
