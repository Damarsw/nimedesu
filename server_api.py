import os
import time
import hmac
import hashlib
import requests
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from supabase import create_client

app = Flask(__name__)

CORS(app, resources={r"/api/*": {"origins": "https://nimedesu.vercel.app"}})

# ---------------------------------------------------------------------------
# CONFIG - all secrets come from environment variables (set these in Render:
# Dashboard -> your service -> Environment)
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("https://yezdnsgypbjcgzoftgmz.supabase.co")
SUPABASE_KEY = os.environ.get("sb_publishable_6zAs4KTrqGhcHf2fvcAlWw_IO7gkLsw")
SECRET_SERVER_KEY = os.environ.get("sb_secret_9ACHbL2iiT_WO4uwdih0TA_2s0vyCSd", "NimeDesuSecretKey2026")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "Missing SUPABASE_URL / SUPABASE_KEY environment variables. "
        "Set them in Render -> Environment before deploying."
    )

client_obj = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# TABLE / COLUMN NAMES - plain strings, not secrets, so no need to obfuscate.
# >>> FILL THESE IN with your real column names from Supabase <<<
# ---------------------------------------------------------------------------
TABLE_ANIME = "anime"
TABLE_EPISODE = "episode"

# anime table columns (confirmed from Supabase table editor)
COL_ANIME_ID = "id"
COL_ANIME_TITLE = "title"
COL_ANIME_URL = "url"
COL_ANIME_STATUS = "status"
COL_ANIME_GENRE = "genre"
COL_ANIME_IMAGE = "img_url"

# episode table columns (confirmed from Supabase table editor)
COL_EP_ID = "id"
COL_EP_ANIME_ID = "anime_id"
COL_EP_TITLE = "episode_title"
COL_EP_URL = "episode_url"
COL_EP_VIDEO_SERVERS = "video_servers"  # jsonb

# keys inside each object in the video_servers jsonb array
SRV_KEY_URL = "url"                # confirmed from your data
SRV_KEY_VURL = "vurl"              # alt key, may not exist - harmless if absent
SRV_KEY_LABEL = "keterangan"       # confirmed from your data (e.g. "MP4", "B-TUBE")
SRV_KEY_SERVER_NAME = "server"     # alt key, may not exist - harmless if absent


@app.before_request
def security_validation():
    if request.method == "OPTIONS":
        return

    # proxy-stream is allowed through without the HMAC headers, since <video>/<iframe>
    # tags can't attach custom headers to their requests.
    if request.path.startswith("/api/proxy-stream") or request.path.startswith("/proxy-stream"):
        return

    if request.path.startswith("/api/"):
        origin = request.headers.get("Origin", "")
        referer = request.headers.get("Referer", "")

        allowed_domain = "nimedesu.vercel.app"
        if allowed_domain not in origin and allowed_domain not in referer:
            return jsonify({"error": "Access Denied: Direct access is forbidden"}), 403

        client_time = request.headers.get("X-Client-Time")
        client_token = request.headers.get("X-Client-Token")
        user_agent = request.headers.get("User-Agent", "").lower()

        if not user_agent or any(bot in user_agent for bot in ["python-requests", "scrapy", "curl", "wget", "axios", "headless"]):
            return jsonify({"error": "Access Denied: Invalid Agent"}), 403

        if not client_time or not client_token:
            return jsonify({"error": "Access Denied: Missing Security Headers"}), 403

        try:
            req_time = int(client_time)
            current_time = int(time.time())

            if abs(current_time - req_time) > 30:
                return jsonify({"error": "Access Denied: Token Expired"}), 403

            expected_payload = f"{req_time}_{SECRET_SERVER_KEY}"
            expected_token = hashlib.sha256(expected_payload.encode("utf-8")).hexdigest()

            if not hmac.compare_digest(expected_token, client_token):
                return jsonify({"error": "Access Denied: Invalid Signature"}), 403

        except ValueError:
            return jsonify({"error": "Access Denied: Malformed Request"}), 403


@app.route("/")
def home():
    return "NimeDesu Server API is Active!"


@app.route("/api/proxy-stream", methods=["GET"])
@app.route("/proxy-stream", methods=["GET"])
def proxy_stream():
    target_url = request.args.get("target", "").strip()
    if not target_url:
        return "URL target tidak valid", 400

    if target_url.startswith("http://"):
        target_url = "https://" + target_url[7:]

    # Optional explicit Referer (e.g. the original source site like
    # https://anime-indo.lol/anime/xxx/), for hosts that only allow requests
    # coming from that specific referrer. Falls back to self-referral if absent.
    custom_referer = request.args.get("ref", "").strip()
    referer_value = custom_referer if custom_referer else target_url

    try:
        req_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": referer_value,
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Connection": "keep-alive",
        }

        range_header = request.headers.get("Range")
        if range_header:
            req_headers["Range"] = range_header

        upstream_response = requests.get(target_url, headers=req_headers, stream=True, timeout=20, allow_redirects=True)

        excluded_headers = ["content-encoding", "content-length", "transfer-encoding", "connection"]
        response_headers = [
            (name, value) for name, value in upstream_response.raw.headers.items()
            if name.lower() not in excluded_headers
        ]

        def generate():
            for chunk in upstream_response.iter_content(chunk_size=16384):
                if chunk:
                    yield chunk

        return Response(
            generate(),
            status=upstream_response.status_code,
            headers=response_headers,
            direct_passthrough=True,
        )
    except Exception as e:
        return f"Proxy Error: {str(e)}", 500


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

        query = client_obj.table(TABLE_ANIME).select("*", count="exact")

        if search_query:
            query = query.ilike(COL_ANIME_TITLE, f"%{search_query}%")
        if genre_filter:
            query = query.ilike(COL_ANIME_GENRE, f"%{genre_filter}%")
        if status_filter:
            query = query.ilike(COL_ANIME_STATUS, f"%{status_filter}%")

        response = query.order(COL_ANIME_ID).range(start, end).execute()

        total_records = response.count if response.count is not None else 0
        total_pages = -(-total_records // per_page) if total_records > 0 else 1

        data = response.data or []
        for item in data:
            item["image_url"] = item.get(COL_ANIME_IMAGE)

        return jsonify({
            "data": data,
            "total": total_records,
            "page": page,
            "total_pages": total_pages,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/anime-detail", methods=["GET"])
def api_anime_detail():
    anime_url = request.args.get("url", "").strip()
    if not anime_url:
        return jsonify({"error": "URL tidak valid"}), 400

    try:
        anime_res = client_obj.table(TABLE_ANIME).select("*").ilike(COL_ANIME_URL, f"%{anime_url}%").execute()

        if not anime_res.data or len(anime_res.data) == 0:
            return jsonify({"episodes": []})

        anime_item = anime_res.data[0]
        anime_id = anime_item.get(COL_ANIME_ID)

        ep_res = client_obj.table(TABLE_EPISODE).select("*").eq(COL_EP_ANIME_ID, anime_id).order(COL_EP_ID).execute()
        episodes_data = ep_res.data or []

        episodes_list = []
        for ep in episodes_data:
            video_servers = []
            raw_servers = ep.get(COL_EP_VIDEO_SERVERS, [])

            if isinstance(raw_servers, list):
                for srv in raw_servers:
                    original_url = srv.get(SRV_KEY_URL) or srv.get(SRV_KEY_VURL, "")
                    encoded_url = ""
                    if original_url:
                        import base64
                        encoded_url = base64.b64encode(original_url.encode("utf-8")).decode("utf-8")

                    server_val = srv.get(SRV_KEY_SERVER_NAME) or srv.get(SRV_KEY_LABEL) or "1"

                    video_servers.append({
                        "resolution": srv.get(SRV_KEY_LABEL, "Mirror 360p"),
                        "server": str(server_val),
                        "url": encoded_url,
                    })

            episodes_list.append({
                "title": ep.get(COL_EP_TITLE, ""),
                "url": ep.get(COL_EP_URL, ""),
                "video_servers": video_servers,
            })

        result_payload = {
            "title": anime_item.get(COL_ANIME_TITLE, ""),
            "url": anime_item.get(COL_ANIME_URL, ""),
            "episodes": episodes_list,
        }

        return jsonify(result_payload)

    except Exception as e:
        print(f"Error fetching data: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
