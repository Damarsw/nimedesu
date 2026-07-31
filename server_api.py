import time
import hmac
import hashlib
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client

app = Flask(__name__)
CORS(app)

SUPABASE_URL = "https://yezdnsgypbjcgzoftgmz.supabase.co"
SUPABASE_KEY = "sb_publishable_6zAs4KTrqGhcHf2fvcAlWw_IO7gkLsw"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Kunci rahasia bersama antara frontend dan backend untuk validasi token
SECRET_SERVER_KEY = "NimeDesuSecretKey2026"

@app.before_request
def security_validation():
    # Lewatkan request OPTIONS untuk CORS preflight
    if request.method == "OPTIONS":
        return
        
    # Hanya amankan path yang berawalan /api/
    if request.path.startswith("/api/"):
        client_time = request.headers.get("X-Client-Time")
        client_token = request.headers.get("X-Client-Token")
        user_agent = request.headers.get("User-Agent", "").lower()

        # 1. Blokir jika User-Agent kosong atau mencurigakan (headless browser/bot)
        if not user_agent or any(bot in user_agent for bot in ["python-requests", "scrapy", "curl", "wget", "axios", "headless"]):
            return jsonify({"error": "Access Denied: Invalid Agent"}), 403

        if not client_time or not client_token:
            return jsonify({"error": "Access Denied: Missing Security Headers"}), 403

        try:
            req_time = int(client_time)
            current_time = int(time.time())
            
            # 2. Validasi Jendela Waktu (Maksimal selisih 30 detik untuk mencegah Replay Attack)
            if abs(current_time - req_time) > 30:
                return jsonify({"error": "Access Denied: Token Expired"}), 403

            # 3. Validasi Keabsahan Token (HMAC-SHA256 sederhana berdasarkan timestamp)
            expected_payload = f"{req_time}_{SECRET_SERVER_KEY}"
            expected_token = hashlib.sha256(expected_payload.encode('utf-8')).hexdigest()

            if not hmac.compare_digest(expected_token, client_token):
                return jsonify({"error": "Access Denied: Invalid Signature"}), 403

        except ValueError:
            return jsonify({"error": "Access Denied: Malformed Request"}), 403

@app.route("/")
def home():
    return "NimeDesu Server API is Active!"

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
        if genre_filter:
            query = query.ilike("genre", f"%{genre_filter}%")
        if status_filter:
            query = query.ilike("status", f"%{status_filter}%")

        response = query.order("id").range(start, end).execute()

        total_records = response.count if response.count is not None else 0
        total_pages = -(-total_records // per_page) if total_records > 0 else 1

        data = response.data or []
        for item in data:
            item["image_url"] = item.get("img_url")

        return jsonify({
            "data": data,
            "total": total_records,
            "page": page,
            "total_pages": total_pages
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/anime-detail", methods=["GET"])
def api_anime_detail():
    anime_url = request.args.get("url", "").strip()
    if not anime_url:
        return jsonify({"error": "URL tidak valid"}), 400

    try:
        anime_res = supabase.table("anime").select("*").ilike("url", f"%{anime_url}%").execute()

        if not anime_res.data or len(anime_res.data) == 0:
            return jsonify({"episodes": []})

        anime_item = anime_res.data[0]
        anime_id = anime_item.get("id")

        ep_res = supabase.table("episode").select("*").eq("anime_id", anime_id).order("id").execute()
        episodes_data = ep_res.data or []

        episodes_list = []
        for ep in episodes_data:
            video_servers = []
            raw_servers = ep.get("video_servers", [])
            
            if isinstance(raw_servers, list):
                for srv in raw_servers:
                    original_url = srv.get("url") or srv.get("video_url", "")
                    encoded_url = ""
                    if original_url:
                        encoded_url = base64.b64encode(original_url.encode('utf-8')).decode('utf-8')
                    
                    server_val = srv.get("server") or srv.get("server_name") or "1"
                    
                    video_servers.append({
                        "resolution": srv.get("resolution", "Mirror 360p"),
                        "server": str(server_val),
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
