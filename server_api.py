import os
import time
import hmac
import hashlib
import base64
import codecs
import zlib
from flask import Flask, jsonify, request
from flask_cors import CORS
from supabase import create_client

app = Flask(__name__)

CORS(app, resources={r"/api/*": {"origins": "https://nimedesu.vercel.app"}})

V1 = 0x5A
V2 = 3

def p1(x):
    return base64.b64decode(x.encode('utf-8')).decode('utf-8')

def p2(x):
    return bytes.fromhex(x).decode('utf-8')

def p3(x):
    return "".join([chr(ord(c) - V2) for c in x])

def p4(x):
    try:
        return zlib.decompress(base64.b64decode(x.encode('utf-8'))).decode('utf-8')
    except:
        return x

def p5(x):
    return "".join([chr(ord(c) ^ V1) for c in x])

def p6(x):
    return codecs.encode(x, 'rot_13')

def p7(x):
    return x[::-1]

def p8(x):
    return base64.b64decode(x.encode('utf-8')).decode('utf-8')

def p9(x):
    return "".join([chr(ord(c) - 2) for c in x])

def p10(x):
    return base64.b64decode(x.encode('utf-8')).decode('utf-8')

def process_token(s):
    w1 = p1(s)
    w2 = p2(w1)
    w3 = p3(w2)
    w4 = p4(w3)
    w5 = p5(w4)
    w6 = p6(w5)
    w7 = p7(w6)
    w8 = p8(w7)
    w9 = p9(w8)
    return p10(w9)

H_URL = "TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="
H_KEY = "TWpZd016VXdNakkzTURJd01qSTRNREEwTURnMU5qTTNNRFl3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREFzPQ=="

URL_CONN = process_token(H_URL)
KEY_CONN = process_token(H_KEY)

client_obj = create_client(URL_CONN, KEY_CONN)
SECRET_SERVER_KEY = "NimeDesuSecretKey2026"

X1 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
X2 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")

Y1 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y2 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y3 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y4 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y5 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y6 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y7 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y8 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y9 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y10 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
Y11 = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")

K_URL = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
K_VURL = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
K_SRV = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
K_SRVNAME = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")
K_RES = process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS==")

@app.before_request
def security_validation():
    if request.method == "OPTIONS":
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

        query = client_obj.table(X1).select("*", count="exact")

        if search_query:
            query = query.ilike(Y2, f"%{search_query}%")
        if genre_filter:
            query = query.ilike(Y5, f"%{genre_filter}%")
        if status_filter:
            query = query.ilike(Y4, f"%{status_filter}%")

        response = query.order(Y1).range(start, end).execute()

        total_records = response.count if response.count is not None else 0
        total_pages = -(-total_records // per_page) if total_records > 0 else 1

        data = response.data or []
        for item in data:
            item["image_url"] = item.get(Y7)

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
        anime_res = client_obj.table(X1).select("*").ilike(Y3, f"%{anime_url}%").execute()

        if not anime_res.data or len(anime_res.data) == 0:
            return jsonify({"episodes": []})

        anime_item = anime_res.data[0]
        anime_id = anime_item.get(Y1)

        ep_res = client_obj.table(X2).select("*").eq(Y8, anime_id).order(Y1).execute()
        episodes_data = ep_res.data or []

        episodes_list = []
        for ep in episodes_data:
            video_servers = []
            raw_servers = ep.get(Y11, [])
            
            if isinstance(raw_servers, list):
                for srv in raw_servers:
                    original_url = srv.get(K_URL) or srv.get(K_VURL, "")
                    encoded_url = ""
                    if original_url:
                        encoded_url = base64.b64encode(original_url.encode('utf-8')).decode('utf-8')
                    
                    server_val = srv.get(K_SRV) or srv.get(K_SRVNAME) or "1"
                    
                    video_servers.append({
                        process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): srv.get(K_RES, "Mirror 360p"),
                        process_token("TWpZd016VXdNakkzTURJd01qSTRNREEwTURnMU5qTTNNRFl3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREFzPQ=="): str(server_val),
                        process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): encoded_url
                    })

            episodes_list.append({
                process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): ep.get(Y9, ""),
                process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): ep.get(Y10, ""),
                process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): video_servers
            })

        result_payload = {
            process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): anime_item.get(Y2, ""),
            process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): anime_item.get(Y3, ""),
            process_token("TVRrNU1EQTVNVEl5TURBNE1URXlNRFEwTWpZNU5qa3dNREF3TURFd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBPS=="): episodes_list
        }

        return jsonify(result_payload)

    except Exception as e:
        print(f"Error fetching data: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
