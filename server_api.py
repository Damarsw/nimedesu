@app.route("/api/ranking", methods=["GET"])
def api_ranking():
    category = request.args.get("type", "bypopularity").strip()
    page = int(request.args.get("page", 1))

    cache_key = f"{category}_{page}"
    current_time = time.time()

    if cache_key in RANKING_CACHE:
        cached_entry = RANKING_CACHE[cache_key]
        if current_time - cached_entry["timestamp"] < CACHE_TTL_RANKING:
            resp = jsonify(cached_entry["data"])
            resp.headers["Cache-Control"] = "public, s-maxage=3600, stale-while-revalidate=7200"
            return resp

    # =========================================================
    # OPTION 1: UTAMA - ANILIST GRAPHQL API
    # =========================================================
    sort_query = "POPULARITY_DESC"
    status_query = ""

    if category == "upcoming":
        status_query = ", status: NOT_YET_RELEASED"
        sort_query = "POPULARITY_DESC"
    elif category == "favorite":
        sort_query = "SCORE_DESC"

    # PERHITUNGAN OFFSET/HALAMAN BARU AGAR PAGE 1 DAPAT 12 ITEM (#4 - #15)
    # Page 1: PerPage 15, buang 3 pertama -> dapat 12 item (#4 - #15)
    # Page 2 dst: Ambil offset AniList yang pas
    if page == 1:
        fetch_page = 1
        fetch_per_page = 15
    else:
        fetch_page = page
        fetch_per_page = 12

    query_str = f"""
    query {{
        top3: Page(page: 1, perPage: 3) {{
            media(type: ANIME, sort: {sort_query}{status_query}) {{
                id title {{ romaji english userPreferred }}
                coverImage {{ extraLarge large }}
                averageScore popularity
            }}
        }}
        listData: Page(page: {fetch_page}, perPage: {fetch_per_page}) {{
            pageInfo {{ total currentPage lastPage hasNextPage }}
            media(type: ANIME, sort: {sort_query}{status_query}) {{
                id title {{ romaji english userPreferred }}
                coverImage {{ extraLarge large }}
                averageScore popularity
            }}
        }}
    }}
    """

    try:
        resp = requests.post(
            "https://graphql.anilist.co",
            json={"query": query_str},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=4
        )
        
        if resp.status_code == 200:
            json_data = resp.json()
            if "data" in json_data and json_data["data"]:
                top3 = json_data.get("data", {}).get("top3", {}).get("media", [])
                list_obj = json_data.get("data", {}).get("listData", {})
                raw_list_media = list_obj.get("media", [])
                page_info = list_obj.get("pageInfo", {})

                # Jika di Page 1: buang 3 item teratas (podium) agar tersisa 12 item (#4 s/d #15)
                if page == 1:
                    list_media = raw_list_media[3:]
                else:
                    list_media = raw_list_media

                payload = {
                    "top3": top3,  # SELALU MENGIRIM TOP 3 PODIUM DI PAGE MANAPUN
                    "list": list_media,
                    "last_page": page_info.get("lastPage", 1),
                    "source": "anilist"
                }

                RANKING_CACHE[cache_key] = {"timestamp": current_time, "data": payload}
                return jsonify(payload), 200
    except Exception:
        pass

    return jsonify({"top3": [], "list": [], "last_page": 1, "error": "All anime APIs unavailable"}), 200
