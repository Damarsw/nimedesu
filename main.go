package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

var (
	supabaseURL     = os.Getenv("SUPABASE_URL")
	supabaseKey     = os.Getenv("SUPABASE_KEY")
	secretServerKey = getEnvOrDefault("SECRET_SERVER_KEY", "NimeDesuSecretKey2026")
	port            = getEnvOrDefault("PORT", "10000")
	turnstileSecret = "0x4AAAAAAEWna_vJ8Kdd3zB-Y0fTxiXPDc"
)

type TurnstileResponse struct {
	Success     bool     `json:"success"`
	ErrorCodes  []string `json:"error-codes"`
	ChallengeTS string   `json:"challenge_ts"`
	Hostname    string   `json:"hostname"`
}

type BatchStore struct {
	sync.RWMutex
	ByPopularity []interface{} `json:"bypopularity"`
	Upcoming     []interface{} `json:"upcoming"`
	Favorite     []interface{} `json:"favorite"`
	LastUpdated  int64         `json:"last_updated"`
}

type LocalCache struct {
	sync.RWMutex
	AnimeList map[string]CacheItem
	ScoreMap  map[string]string
	DetailMap map[string]CacheItem
}

type CacheItem struct {
	Timestamp int64
	Data      interface{}
}

type ExternalAnimeMetadata struct {
	Synopsis    string `json:"synopsis"`
	Japanese    string `json:"japanese"`
	Score       string `json:"score"`
	Status      string `json:"status"`
	TotalEp     string `json:"total_episodes"`
	Duration    string `json:"duration"`
	ReleaseDate string `json:"release_date"`
	Studio      string `json:"studio"`
	CoverImg    string `json:"cover_img"`
}

type UserSyncRequest struct {
	AnilistID        string `json:"anilist_id"`
	SessionID        string `json:"session_id"`
	CookiesEncrypted string `json:"cookies_encrypted"`
}

type LogoutOthersRequest struct {
	AnilistID        string `json:"anilist_id"`
	CurrentSessionID string `json:"current_session_id"`
}

var (
	batchStore = &BatchStore{}
	localCache = &LocalCache{
		AnimeList: make(map[string]CacheItem),
		ScoreMap:  make(map[string]string),
		DetailMap: make(map[string]CacheItem),
	}
	lastAPICallTime time.Time
	apiCallMutex    sync.Mutex
	minCallInterval = 750 * time.Millisecond

	CACHE_TTL_ANIME = int64(86400)
)

func getEnvOrDefault(key, defaultValue string) string {
	val := os.Getenv(key)
	if val == "" {
		return defaultValue
	}
	return val
}

func verifyTurnstileToken(token string, remoteIP string) bool {
	if token == "" {
		return false
	}
	apiURL := "https://challenges.cloudflare.com/turnstile/v0/siteverify"

	formData := url.Values{}
	formData.Set("secret", turnstileSecret)
	formData.Set("response", token)
	if remoteIP != "" {
		formData.Set("remoteip", remoteIP)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.PostForm(apiURL, formData)
	if err != nil {
		log.Printf("[Turnstile Error] Gagal verifikasi ke Cloudflare: %v", err)
		return false
	}
	defer resp.Body.Close()

	var turnstileRes TurnstileResponse
	if err := json.NewDecoder(resp.Body).Decode(&turnstileRes); err != nil {
		return false
	}

	return turnstileRes.Success
}

func supabaseRequest(method, endpoint string, body []byte, headers map[string]string) (*http.Response, error) {
	reqURL := fmt.Sprintf("%s/rest/v1/%s", strings.TrimRight(supabaseURL, "/"), endpoint)
	req, err := http.NewRequest(method, reqURL, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)
	req.Header.Set("Content-Type", "application/json")

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	return client.Do(req)
}

func stripHTMLTags(s string) string {
	var builder strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			builder.WriteRune(r)
		}
	}
	res := builder.String()
	res = strings.ReplaceAll(res, "&quot;", "\"")
	res = strings.ReplaceAll(res, "&#039;", "'")
	res = strings.ReplaceAll(res, "&amp;", "&")
	return strings.TrimSpace(res)
}

func translateToID(text string) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}

	if len(text) > 1500 {
		text = text[:1500] + "..."
	}

	translateURL := fmt.Sprintf("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=id&dt=t&q=%s", url.QueryEscape(text))

	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get(translateURL)
	if err != nil || resp.StatusCode != 200 {
		return text
	}
	defer resp.Body.Close()

	var result []interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || len(result) == 0 {
		return text
	}

	sentences, ok := result[0].([]interface{})
	if !ok {
		return text
	}

	var translatedBuilder strings.Builder
	for _, sentence := range sentences {
		item, ok := sentence.([]interface{})
		if ok && len(item) > 0 {
			if str, ok := item[0].(string); ok {
				translatedBuilder.WriteString(str)
			}
		}
	}

	translated := translatedBuilder.String()
	if translated == "" {
		return text
	}
	return translated
}

func fetchMetadataFromAniList(title string) (*ExternalAnimeMetadata, error) {
	graphqlQuery := `
	query ($search: String) {
	  Media (search: $search, type: ANIME) {
	    title { romaji native english }
	    description
	    averageScore
	    status
	    episodes
	    duration
	    startDate { year month day }
	    coverImage { extraLarge large }
	    studios(isMain: true) {
	      nodes { name }
	    }
	  }
	}`

	reqBody, _ := json.Marshal(map[string]interface{}{
		"query":     graphqlQuery,
		"variables": map[string]string{"search": title},
	})

	req, _ := http.NewRequest("POST", "https://graphql.anilist.co", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 4 * time.Second}

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return nil, fmt.Errorf("anilist request failed")
	}
	defer resp.Body.Close()

	var res struct {
		Data struct {
			Media struct {
				Title struct {
					Native  string `json:"native"`
					Romaji  string `json:"romaji"`
					English string `json:"english"`
				} `json:"title"`
				Description  string  `json:"description"`
				AverageScore float64 `json:"averageScore"`
				Status       string  `json:"status"`
				Episodes     int     `json:"episodes"`
				Duration     int     `json:"duration"`
				StartDate    struct {
					Year  int `json:"year"`
					Month int `json:"month"`
					Day   int `json:"day"`
				} `json:"startDate"`
				CoverImage struct {
					ExtraLarge string `json:"extraLarge"`
					Large      string `json:"large"`
				} `json:"coverImage"`
				Studios struct {
					Nodes []struct {
						Name string `json:"name"`
					} `json:"nodes"`
				} `json:"studios"`
			} `json:"Media"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil || res.Data.Media.Description == "" {
		return nil, fmt.Errorf("invalid anilist data")
	}

	m := res.Data.Media
	scoreStr := "N/A"
	if m.AverageScore > 0 {
		scoreStr = fmt.Sprintf("%.1f", m.AverageScore/10.0)
	}

	totalEpStr := "N/A"
	if m.Episodes > 0 {
		totalEpStr = fmt.Sprintf("%d Episode", m.Episodes)
	}

	durStr := "N/A"
	if m.Duration > 0 {
		durStr = fmt.Sprintf("%d Menit", m.Duration)
	}

	dateStr := "N/A"
	if m.StartDate.Year > 0 {
		dateStr = fmt.Sprintf("%d-%02d-%02d", m.StartDate.Year, m.StartDate.Month, m.StartDate.Day)
	}

	studioStr := "N/A"
	if len(m.Studios.Nodes) > 0 {
		studioStr = m.Studios.Nodes[0].Name
	}

	img := m.CoverImage.ExtraLarge
	if img == "" {
		img = m.CoverImage.Large
	}

	return &ExternalAnimeMetadata{
		Synopsis:    stripHTMLTags(m.Description),
		Japanese:    m.Title.Native,
		Score:       scoreStr,
		Status:      m.Status,
		TotalEp:     totalEpStr,
		Duration:    durStr,
		ReleaseDate: dateStr,
		Studio:      studioStr,
		CoverImg:    img,
	}, nil
}

func fetchMetadataFromJikan(title string) (*ExternalAnimeMetadata, error) {
	jikanURL := fmt.Sprintf("https://api.jikan.moe/v4/anime?q=%s&limit=1", url.QueryEscape(title))
	req, _ := http.NewRequest("GET", jikanURL, nil)
	client := &http.Client{Timeout: 4 * time.Second}

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return nil, fmt.Errorf("jikan request failed")
	}
	defer resp.Body.Close()

	var res struct {
		Data []struct {
			TitleJapanese string  `json:"title_japanese"`
			Synopsis      string  `json:"synopsis"`
			Score         float64 `json:"score"`
			Status        string  `json:"status"`
			Episodes      int     `json:"episodes"`
			Duration      string  `json:"duration"`
			Aired         struct {
				String string `json:"string"`
			} `json:"aired"`
			Studios []struct {
				Name string `json:"name"`
			} `json:"studios"`
			Images struct {
				JPG struct {
					LargeImageURL string `json:"large_image_url"`
				} `json:"jpg"`
			} `json:"images"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil || len(res.Data) == 0 {
		return nil, fmt.Errorf("invalid jikan data")
	}

	item := res.Data[0]
	scoreStr := "N/A"
	if item.Score > 0 {
		scoreStr = fmt.Sprintf("%.1f", item.Score)
	}

	totalEpStr := "N/A"
	if item.Episodes > 0 {
		totalEpStr = fmt.Sprintf("%d Episode", item.Episodes)
	}

	studioStr := "N/A"
	if len(item.Studios) > 0 {
		studioStr = item.Studios[0].Name
	}

	return &ExternalAnimeMetadata{
		Synopsis:    stripHTMLTags(item.Synopsis),
		Japanese:    item.TitleJapanese,
		Score:       scoreStr,
		Status:      item.Status,
		TotalEp:     totalEpStr,
		Duration:    item.Duration,
		ReleaseDate: item.Aired.String,
		Studio:      studioStr,
		CoverImg:    item.Images.JPG.LargeImageURL,
	}, nil
}

func getOrFetchAnimeMetadata(title string) *ExternalAnimeMetadata {
	cacheKey := strings.ToLower(title)
	now := time.Now().Unix()

	localCache.RLock()
	if item, found := localCache.DetailMap[cacheKey]; found {
		if now-item.Timestamp < CACHE_TTL_ANIME {
			localCache.RUnlock()
			if meta, ok := item.Data.(*ExternalAnimeMetadata); ok {
				return meta
			}
		}
	}
	localCache.RUnlock()

	meta, err := fetchMetadataFromAniList(title)

	if err != nil || meta == nil || meta.Synopsis == "" {
		log.Printf("[Metadata Backup] AniList gagal untuk %s, mencoba Jikan...", title)
		meta, err = fetchMetadataFromJikan(title)
	}

	if meta != nil && meta.Synopsis != "" {
		meta.Synopsis = translateToID(meta.Synopsis)

		localCache.Lock()
		localCache.DetailMap[cacheKey] = CacheItem{
			Timestamp: now,
			Data:      meta,
		}
		localCache.Unlock()
		return meta
	}

	return nil
}

func fetchAniListBatch(category string) []interface{} {
	apiCallMutex.Lock()
	elapsed := time.Since(lastAPICallTime)
	if elapsed < minCallInterval {
		time.Sleep(minCallInterval - elapsed)
	}
	lastAPICallTime = time.Now()
	apiCallMutex.Unlock()

	sortQuery := "POPULARITY_DESC"
	statusQuery := ""
	if category == "upcoming" {
		statusQuery = ", status: NOT_YET_RELEASED"
	} else if category == "favorite" {
		sortQuery = "SCORE_DESC"
	}

	graphqlQuery := fmt.Sprintf(`{
		Page(page: 1, perPage: 100) {
			media(type: ANIME, sort: %s%s) {
				id title { romaji english userPreferred }
				coverImage { extraLarge large }
				averageScore popularity
			}
		}
	}`, sortQuery, statusQuery)

	reqBody, _ := json.Marshal(map[string]string{"query": graphqlQuery})
	req, _ := http.NewRequest("POST", "https://graphql.anilist.co", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return nil
	}
	defer resp.Body.Close()

	var result struct {
		Data struct {
			Page struct {
				Media []interface{} `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		return result.Data.Page.Media
	}
	return nil
}

func startCronWorker() {
	ticker := time.NewTicker(5 * time.Minute)
	go func() {
		for {
			log.Println("[Cron Worker] Refreshing AniList batch ranking...")
			pop := fetchAniListBatch("bypopularity")
			time.Sleep(1 * time.Second)
			upc := fetchAniListBatch("upcoming")
			time.Sleep(1 * time.Second)
			fav := fetchAniListBatch("favorite")

			batchStore.Lock()
			if pop != nil {
				batchStore.ByPopularity = pop
			}
			if upc != nil {
				batchStore.Upcoming = upc
			}
			if fav != nil {
				batchStore.Favorite = fav
			}
			batchStore.LastUpdated = time.Now().Unix()
			batchStore.Unlock()

			log.Println("[Cron Worker] Batch ranking update success!")
			<-ticker.C
		}
	}()
}

func securityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		if path == "/" || path == "/health" || path == "/sitemap.xml" || path == "/robots.txt" || path == "/api/clear-cache" || strings.HasPrefix(path, "/api/proxy-stream") || strings.HasPrefix(path, "/proxy-stream") {
			c.Next()
			return
		}

		if strings.HasPrefix(path, "/api/") {
			origin := c.GetHeader("Origin")
			referer := c.GetHeader("Referer")
			allowedDomain := "nimedesu.vercel.app"

			if !strings.Contains(origin, allowedDomain) && !strings.Contains(referer, allowedDomain) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Direct access is forbidden"})
				return
			}

			clientTimeStr := c.GetHeader("X-Client-Time")
			clientToken := c.GetHeader("X-Client-Token")
			userAgent := strings.ToLower(c.GetHeader("User-Agent"))

			bots := []string{"python-requests", "scrapy", "curl", "wget", "axios", "headless"}
			for _, bot := range bots {
				if strings.Contains(userAgent, bot) || userAgent == "" {
					c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Invalid Agent"})
					return
				}
			}

			if clientTimeStr == "" || clientToken == "" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Missing Security Headers"})
				return
			}

			reqTime, err := strconv.ParseInt(clientTimeStr, 10, 64)
			if err != nil || math.Abs(float64(time.Now().Unix()-reqTime)) > 30 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Token Expired"})
				return
			}

			expectedPayload := fmt.Sprintf("%d_%s", reqTime, secretServerKey)
			hash := sha256.Sum256([]byte(expectedPayload))
			expectedToken := hex.EncodeToString(hash[:])

			if subtle.ConstantTimeCompare([]byte(expectedToken), []byte(clientToken)) != 1 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Invalid Signature"})
				return
			}
		}
		c.Next()
	}
}

func main() {
	if supabaseURL == "" || supabaseKey == "" {
		log.Fatal("SUPABASE_URL and SUPABASE_KEY must be set!")
	}

	startCronWorker()

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"https://nimedesu.vercel.app"},
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "X-Client-Token", "X-Client-Time", "X-Turnstile-Token"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	r.Use(securityMiddleware())

	r.GET("/", healthHandler)
	r.GET("/health", healthHandler)
	r.GET("/api/proxy-stream", proxyStreamHandler)
	r.GET("/proxy-stream", proxyStreamHandler)

	r.GET("/api/anime", animeListHandler)
	r.GET("/api/anime-detail", animeDetailHandler)
	r.GET("/api/anilist-score", anilistScoreHandler)
	r.GET("/api/ranking", rankingHandler)

	r.POST("/api/user-sync", userSyncHandler)
	r.GET("/api/user-data", userDataHandler)
	r.POST("/api/user-update", userUpdateHandler)
	r.POST("/api/user-logout-others", userLogoutOthersHandler)

	SetupSEORoutes(r)
	r.GET("/api/clear-cache", func(c *gin.Context) {
		localCache.Lock()
		localCache.AnimeList = make(map[string]CacheItem)
		localCache.ScoreMap = make(map[string]string)
		localCache.DetailMap = make(map[string]CacheItem)
		localCache.Unlock()
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Cache RAM 24 jam berhasil dibersihkan!"})
	})

	log.Printf("Server running on port %s", port)
	r.Run(":" + port)
}

func healthHandler(c *gin.Context) {
	batchStore.RLock()
	count := len(batchStore.ByPopularity)
	batchStore.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"status":             "online",
		"service":            "NimeDesu Go API",
		"max_api_rate_limit": "80 calls/min",
		"batch_items_loaded": count,
		"timestamp":          time.Now().Unix(),
	})
}

func proxyStreamHandler(c *gin.Context) {
	targetURL := strings.TrimSpace(c.Query("target"))
	if targetURL == "" {
		c.String(http.StatusBadRequest, "URL target tidak valid")
		return
	}

	if strings.HasPrefix(targetURL, "http://") {
		targetURL = "https://" + targetURL[7:]
	}

	customReferer := strings.TrimSpace(c.Query("ref"))
	refererValue := targetURL
	if customReferer != "" {
		refererValue = customReferer
	}

	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		c.String(http.StatusInternalServerError, err.Error())
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Referer", refererValue)
	if rangeHeader := c.GetHeader("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.String(http.StatusInternalServerError, err.Error())
		return
	}
	defer resp.Body.Close()

	for k, v := range resp.Header {
		lk := strings.ToLower(k)
		if lk != "content-encoding" && lk != "content-length" && lk != "transfer-encoding" && lk != "connection" {
			c.Header(k, v[0])
		}
	}

	c.Status(resp.StatusCode)
	io.Copy(c.Writer, resp.Body)
}

func animeListHandler(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "12"))
	searchQuery := strings.TrimSpace(c.Query("q"))
	statusFilter := strings.TrimSpace(c.Query("status"))
	genreFilter := strings.TrimSpace(c.Query("genre"))

	cacheKey := fmt.Sprintf("%d_%d_%s_%s_%s", page, perPage, searchQuery, statusFilter, genreFilter)
	now := time.Now().Unix()

	localCache.RLock()
	if item, found := localCache.AnimeList[cacheKey]; found {
		if now-item.Timestamp < CACHE_TTL_ANIME {
			localCache.RUnlock()
			c.Header("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=3600")
			c.JSON(http.StatusOK, item.Data)
			return
		}
	}
	localCache.RUnlock()

	offset := (page - 1) * perPage
	limit := perPage

	query := fmt.Sprintf("select=id,title,url,status,genre,img_url&order=id.asc&offset=%d&limit=%d", offset, limit)
	if searchQuery != "" {
		query += fmt.Sprintf("&title=ilike.*%s*", url.QueryEscape(searchQuery))
	}
	if genreFilter != "" {
		query += fmt.Sprintf("&genre=ilike.*%s*", url.QueryEscape(genreFilter))
	}
	if statusFilter != "" {
		query += fmt.Sprintf("&status=ilike.*%s*", url.QueryEscape(statusFilter))
	}

	resp, err := supabaseRequest("GET", "anime?"+query, nil, map[string]string{
		"Prefer": "count=exact",
	})
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}, "total": 0, "page": page, "total_pages": 1})
		return
	}
	defer resp.Body.Close()

	var data []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)

	for i := range data {
		data[i]["image_url"] = data[i]["img_url"]
	}

	totalRecords := 0
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		parts := strings.Split(cr, "/")
		if len(parts) == 2 {
			totalRecords, _ = strconv.Atoi(parts[1])
		}
	}

	totalPages := 1
	if totalRecords > 0 {
		totalPages = int(math.Ceil(float64(totalRecords) / float64(perPage)))
	}

	payload := gin.H{
		"data":        data,
		"total":       totalRecords,
		"page":        page,
		"total_pages": totalPages,
	}

	if len(data) > 0 {
		localCache.Lock()
		localCache.AnimeList[cacheKey] = CacheItem{
			Timestamp: now,
			Data:      payload,
		}
		localCache.Unlock()
	}

	c.Header("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=3600")
	c.JSON(http.StatusOK, payload)
}

func animeDetailHandler(c *gin.Context) {
	animeIDParam := strings.TrimSpace(c.Query("id"))
	rawURL := strings.TrimSpace(c.Query("url"))

	if animeIDParam == "" && rawURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID atau URL anime tidak valid"})
		return
	}

	var query string
	if animeIDParam != "" {
		query = fmt.Sprintf("anime?id=eq.%s&select=*,episode(*)", url.QueryEscape(animeIDParam))
	} else {
		decodedURL, _ := url.QueryUnescape(rawURL)
		cleanPath := strings.TrimPrefix(decodedURL, "https://")
		cleanPath = strings.TrimPrefix(cleanPath, "http://")
		cleanPath = strings.Trim(cleanPath, "/")
		parts := strings.Split(cleanPath, "/")
		targetSlug := parts[len(parts)-1]
		query = fmt.Sprintf("anime?url=ilike.*%s*&select=*,episode(*)", url.QueryEscape(targetSlug))
	}

	resp, err := supabaseRequest("GET", query, nil, nil)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"episodes": []interface{}{}})
		return
	}
	defer resp.Body.Close()

	var result []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	if len(result) == 0 {
		c.JSON(http.StatusOK, gin.H{"episodes": []interface{}{}})
		return
	}

	animeItem := result[0]
	animeTitle := fmt.Sprintf("%v", animeItem["title"])

	extMeta := getOrFetchAnimeMetadata(animeTitle)

	dbSynopsis := fmt.Sprintf("%v", animeItem["synopsis"])
	if dbSynopsis == "<nil>" || dbSynopsis == "" {
		dbSynopsis = ""
	}

	synopsisVal := "Sinopsis belum tersedia."
	if extMeta != nil && extMeta.Synopsis != "" {
		synopsisVal = extMeta.Synopsis
	} else if dbSynopsis != "" {
		synopsisVal = dbSynopsis
	}

	japaneseVal := fmt.Sprintf("%v", animeItem["japanese"])
	if extMeta != nil && extMeta.Japanese != "" {
		japaneseVal = extMeta.Japanese
	}

	scoreVal := fmt.Sprintf("%v", animeItem["score"])
	if extMeta != nil && extMeta.Score != "" {
		scoreVal = extMeta.Score
	}

	statusVal := fmt.Sprintf("%v", animeItem["status"])
	if extMeta != nil && extMeta.Status != "" {
		statusVal = extMeta.Status
	}

	totalEpVal := fmt.Sprintf("%v", animeItem["total_episodes"])
	if extMeta != nil && extMeta.TotalEp != "" {
		totalEpVal = extMeta.TotalEp
	}

	durationVal := fmt.Sprintf("%v", animeItem["duration"])
	if extMeta != nil && extMeta.Duration != "" {
		durationVal = extMeta.Duration
	}

	releaseDateVal := fmt.Sprintf("%v", animeItem["release_date"])
	if extMeta != nil && extMeta.ReleaseDate != "" {
		releaseDateVal = extMeta.ReleaseDate
	}

	studioVal := fmt.Sprintf("%v", animeItem["studio"])
	if extMeta != nil && extMeta.Studio != "" {
		studioVal = extMeta.Studio
	}

	imgVal := fmt.Sprintf("%v", animeItem["img_url"])
	if extMeta != nil && extMeta.CoverImg != "" {
		imgVal = extMeta.CoverImg
	}

	rawEpisodes, _ := animeItem["episode"].([]interface{})
	episodesList := make([]map[string]interface{}, 0, len(rawEpisodes))
	for _, epObj := range rawEpisodes {
		ep, ok := epObj.(map[string]interface{})
		if !ok {
			continue
		}

		videoServers := make([]map[string]string, 0)
		if rawServers, ok := ep["video_servers"].([]interface{}); ok {
			for _, srvObj := range rawServers {
				if srvMap, ok := srvObj.(map[string]interface{}); ok {
					origURL := fmt.Sprintf("%v", srvMap["url"])
					if origURL == "<nil>" || origURL == "" {
						origURL = fmt.Sprintf("%v", srvMap["vurl"])
					}

					encodedURL := ""
					if origURL != "" && origURL != "<nil>" {
						encodedURL = base64.StdEncoding.EncodeToString([]byte(origURL))
					}

					label := fmt.Sprintf("%v", srvMap["keterangan"])
					if label == "<nil>" || label == "" {
						label = "Mirror HD"
					}

					videoServers = append(videoServers, map[string]string{
						"resolution": label,
						"server":     label,
						"url":        encodedURL,
					})
				}
			}
		}

		episodesList = append(episodesList, map[string]interface{}{
			"title":         ep["episode_title"],
			"url":           ep["episode_url"],
			"video_servers": videoServers,
		})
	}

	c.Header("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=3600")
	c.JSON(http.StatusOK, gin.H{
		"id":             animeItem["id"],
		"title":          animeItem["title"],
		"url":            animeItem["url"],
		"img_url":        imgVal,
		"image_url":      imgVal,
		"genre":          animeItem["genre"],
		"synopsis":       synopsisVal,
		"japanese":       japaneseVal,
		"score":          scoreVal,
		"status":         statusVal,
		"total_episodes": totalEpVal,
		"duration":       durationVal,
		"release_date":   releaseDateVal,
		"studio":         studioVal,
		"episodes":       episodesList,
	})
}

func anilistScoreHandler(c *gin.Context) {
	title := strings.TrimSpace(c.Query("title"))
	if title == "" {
		c.JSON(http.StatusOK, gin.H{"score": "N/A"})
		return
	}

	cacheKey := strings.ToLower(title)
	localCache.RLock()
	if sc, ok := localCache.ScoreMap[cacheKey]; ok {
		localCache.RUnlock()
		c.JSON(http.StatusOK, gin.H{"score": sc})
		return
	}
	localCache.RUnlock()

	graphqlQuery := `query ($search: String) { Media (search: $search, type: ANIME) { averageScore } }`
	reqBody, _ := json.Marshal(map[string]interface{}{"query": graphqlQuery, "variables": map[string]string{"search": title}})

	req, _ := http.NewRequest("POST", "https://graphql.anilist.co", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 3 * time.Second}

	resp, err := client.Do(req)
	if err == nil && resp.StatusCode == 200 {
		var res struct {
			Data struct {
				Media struct {
					AverageScore float64 `json:"averageScore"`
				} `json:"Media"`
			} `json:"data"`
		}
		if json.NewDecoder(resp.Body).Decode(&res) == nil && res.Data.Media.AverageScore > 0 {
			formatted := fmt.Sprintf("%.1f", res.Data.Media.AverageScore/10.0)
			localCache.Lock()
			localCache.ScoreMap[cacheKey] = formatted
			localCache.Unlock()
			c.JSON(http.StatusOK, gin.H{"score": formatted})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"score": "N/A"})
}

func rankingHandler(c *gin.Context) {
	category := c.DefaultQuery("type", "bypopularity")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))

	batchStore.RLock()
	var allMedia []interface{}
	switch category {
	case "upcoming":
		allMedia = batchStore.Upcoming
	case "favorite":
		allMedia = batchStore.Favorite
	default:
		allMedia = batchStore.ByPopularity
	}
	batchStore.RUnlock()

	if len(allMedia) == 0 {
		allMedia = fetchAniListBatch(category)
	}

	top3 := make([]interface{}, 0)
	if len(allMedia) >= 3 {
		top3 = allMedia[:3]
	}

	startIdx := 3
	endIdx := 15
	if page > 1 {
		startIdx = (page-1)*12 + 3
		endIdx = startIdx + 12
	}

	if startIdx > len(allMedia) {
		startIdx = len(allMedia)
	}
	if endIdx > len(allMedia) {
		endIdx = len(allMedia)
	}

	pageMedia := allMedia[startIdx:endIdx]
	totalItems := int(math.Max(float64(len(allMedia)-3), 1))
	lastPage := int(math.Ceil(float64(totalItems) / 12.0))

	c.Header("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=3600")
	c.JSON(http.StatusOK, gin.H{
		"top3":      top3,
		"list":      pageMedia,
		"last_page": lastPage,
		"source":    "batch_memory_store",
	})
}

func userSyncHandler(c *gin.Context) {
	turnstileToken := c.GetHeader("X-Turnstile-Token")
	if turnstileToken != "" && !verifyTurnstileToken(turnstileToken, c.ClientIP()) {
		log.Printf("[Turnstile Warning] Bypassing failed verification for seamless mobile UX")
	}

	var body UserSyncRequest
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := supabaseRequest("GET", fmt.Sprintf("login?anilist_id=eq.%s&session_id=eq.%s", url.QueryEscape(body.AnilistID), url.QueryEscape(body.SessionID)), nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var rows []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&rows)

	if len(rows) == 0 {
		insBody, _ := json.Marshal(map[string]interface{}{
			"anilist_id": body.AnilistID,
			"session_id": body.SessionID,
			"cookies":    body.CookiesEncrypted,
		})
		supabaseRequest("POST", "login", insBody, nil)
		c.JSON(http.StatusOK, gin.H{"status": "created", "anilist_id": body.AnilistID, "session_id": body.SessionID, "cookies_encrypted": body.CookiesEncrypted})
	} else {
		cookiesData := rows[0]["cookies"]
		c.JSON(http.StatusOK, gin.H{"status": "exists", "anilist_id": body.AnilistID, "session_id": body.SessionID, "cookies_encrypted": cookiesData})
	}
}

func userDataHandler(c *gin.Context) {
	anilistID := c.Query("anilist_id")
	sessionID := c.Query("session_id")

	query := fmt.Sprintf("login?anilist_id=eq.%s&select=cookies", url.QueryEscape(anilistID))
	if sessionID != "" {
		query += fmt.Sprintf("&session_id=eq.%s", url.QueryEscape(sessionID))
	}

	resp, err := supabaseRequest("GET", query, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var rows []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&rows)

	if len(rows) > 0 {
		c.JSON(http.StatusOK, gin.H{"cookies_encrypted": rows[0]["cookies"]})
	} else {
		c.JSON(http.StatusOK, gin.H{"cookies_encrypted": ""})
	}
}

func userUpdateHandler(c *gin.Context) {
	turnstileToken := c.GetHeader("X-Turnstile-Token")
	if turnstileToken != "" && !verifyTurnstileToken(turnstileToken, c.ClientIP()) {
		log.Printf("[Turnstile Warning] Bypassing failed verification for seamless mobile UX")
	}

	var body UserSyncRequest
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updBody, _ := json.Marshal(map[string]interface{}{"cookies": body.CookiesEncrypted})
	query := fmt.Sprintf("login?anilist_id=eq.%s", url.QueryEscape(body.AnilistID))
	if body.SessionID != "" {
		query += fmt.Sprintf("&session_id=eq.%s", url.QueryEscape(body.SessionID))
	}

	resp, err := supabaseRequest("PATCH", query, updBody, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func userLogoutOthersHandler(c *gin.Context) {
	var body LogoutOthersRequest
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := fmt.Sprintf("login?anilist_id=eq.%s&session_id=neq.%s", url.QueryEscape(body.AnilistID), url.QueryEscape(body.CurrentSessionID))
	resp, err := supabaseRequest("DELETE", query, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Berhasil mengeluarkan akun dari perangkat lain."})
}
