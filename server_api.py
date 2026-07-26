@app.route("/api/anime-detail", methods=["GET"])
def api_anime_detail():
    anime_url = request.args.get("url", "").strip()
    if not anime_url:
        return jsonify({"error": "URL tidak valid"}), 400

    try:
        # 1. Cari data anime berdasarkan URL persis atau menggunakan operator like
        anime_res = supabase.table("anime").select("*").ilike("url", f"%{anime_url}%").execute()

        if not anime_res.data or len(anime_res.data) == 0:
            return jsonify({"episodes": []})

        anime_item = anime_res.data[0]
        anime_id = anime_item.get("id")

        # 2. Ambil data episodes berdasarkan anime_id
        ep_res = supabase.table("episodes").select("*").eq("anime_id", anime_id).execute()
        episodes_data = ep_res.data or []

        episodes_list = []
        for ep in episodes_data:
            video_servers = []
            raw_servers = ep.get("video_servers", [])
            
            # Jika video_servers tersimpan sebagai list/array JSONB
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
