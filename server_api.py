import base64
import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client

app = Flask(__name__)
CORS(app)

# Konfigurasi Supabase Client
SUPABASE_URL = "https://yezdnsgypbjcgzoftgmz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllemRuc2d5cGJqY2d6b2Z0Z216Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg4Nzg5NSwiZXhwIjoyMTAwNDYzODk1fQ.RV8xeE4YMwEJrkq04y3hScKIkSEduOJLABtCPykdZf8"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

@app.route("/")
def home():
    return "NimeDesu Server API is Active!"

# 1. Endpoint mengambil semua daftar anime dari tabel 'anime'
@app.route("/api/anime", methods=["GET"])
def api_anime():
    try:
        response = supabase.table("anime").select("*").execute()
        return jsonify(response.data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 2. Endpoint detail streaming yang JOIN dari tabel anime -> episodes -> servers
@app.route("/api/anime-detail", methods=["GET"])
def api_anime_detail():
    anime_url = request.args.get("url", "").strip()
    if not anime_url:
        return jsonify({"error": "URL tidak valid"}), 400

    try:
        # Query ke tabel 'anime' sekaligus JOIN ke tabel 'episodes' dan 'servers'
        response = supabase.table("anime") \
            .select("*, episodes(*, servers(*))") \
            .eq("url", anime_url) \
            .execute()

        if not response.data or len(response.data) == 0:
            return jsonify({"episodes": []})

        anime_item = response.data[0]
        episodes_list = []

        # Format struktur data agar sesuai dengan yang dibutuhkan oleh stream.html
        for ep in anime_item.get("episodes", []):
            video_servers = []
            for srv in ep.get("servers", []):
                original_url = srv.get("video_url", "")
                encoded_url = ""
                if original_url:
                    encoded_url = base64.b64encode(original_url.encode('utf-8')).decode('utf-8')
                
                video_servers.append({
                    "resolution": srv.get("resolution", "Mirror 360p"),
                    "server": str(srv.get("server_name", "1")),
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
