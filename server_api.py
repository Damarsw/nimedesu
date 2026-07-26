import base64
import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client

app = Flask(__name__)
CORS(app)

SUPABASE_URL = "https://yezdnsgypbjcgzoftgmz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllemRuc2d5cGJqY2d6b2Z0Z216Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg4Nzg5NSwiZXhwIjoyMTAwNDYzODk1fQ.RV8xeE4YMwEJrkq04y3hScKIkSEduOJLABtCPykdZf8"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

@app.route("/")
def home():
    return "NimeDesu Server API is Active!"

# 1. Endpoint anime dengan Pagination & Search di Server
@app.route("/api/anime", methods=["GET"])
def api_anime():
    try:
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 12))
        search_query = request.args.get("q", "").strip()
        status_filter = request.args.get("status", "").strip()
        genre_filter = request.args.get("genre", "").strip()

        start = (page - 1) * per_page
        end = start + per_page - 1

        query = supabase.table("anime").select("*", count="exact")

        if search_query:
            query = query.ilike("title", f"%{search_query}%")
        if status_filter:
            query = query.ilike("status", f"%{status_filter}%")
        if genre_filter:
            query = query.ilike("genre", f"%{genre_filter}%")

        response = query.range(start, end).execute()

        total_records = response.count if response.count is not None else 0
        total_pages = -(-total_records // per_page) if total_records > 0 else 1

        return jsonify({
            "data": response.data,
            "total": total_records,
            "page": page,
            "total_pages": total_pages
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 2. Endpoint detail streaming (Menggunakan 2 tabel: anime & episodes dengan JSONB video_servers)
@app.route("/api/anime-detail", methods=["GET"])
def api_anime_detail():
    anime_url = request.args.get("url", "").strip()
    if not anime_url:
        return jsonify({"error": "URL tidak valid"}), 400

    try:
        # Cari data anime berdasarkan URL
        anime_res = supabase.table("anime").select("*").ilike("url", f"%{anime_url}%").execute()

        if not anime_res.data or len(anime_res.data) == 0:
            return jsonify({"episodes": []})

        anime_item = anime_res.data[0]
        anime_id = anime_item.get("id")

        # Ambil data episodes berdasarkan anime_id
        ep_res = supabase.table("episodes").select("*").eq("anime_id", anime_id).execute()
        episodes_data = ep_res.data or []

        episodes_list = []
        for ep in episodes_data:
            video_servers = []
            raw_servers = ep.get("video_servers", [])
            
            if isinstance(raw_servers, list):
                for srv in raw_servers:
                    original_url = srv.get("video_url", "")
                    encoded_url = ""
                    if original_url:
                        encoded_url = base64.b64encode(original_url.encode('utf-8')).decode('utf-8')
                    
                    video_servers.append({
                        "resolution": srv.get("resolution", "Mirror 360p"),
                        "server": str(srv.get("server", srv.get("server_name", "1"))),
                        "video_url": encoded_url
                    })

            episodes_list.append({
                "episode_title": ep.get("episode_title", ""),
                "episode_url": ep.get("episode_url", ""),
                "video_servers": video_servers
            })

        result_payload = {
            "title": anime_item.get("title", ""),
            "url": anime_item.get("url", ""),
            "episodes": episodes_list
        }

        return jsonify(result_payload)

    except Exception as e:
        print(f"Error fetching anime detail: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
