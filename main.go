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
)

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
}

type CacheItem struct {
	Timestamp int64
	Data      interface{}
}

var (
	batchStore      = &BatchStore{}
	localCache      = &LocalCache{AnimeList: make(map[string]CacheItem), ScoreMap: make(map[string]string)}
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

func logSupabaseError(context string, resp *http.Response) {
	if resp == nil || resp.StatusCode < 300 {
		return
	}
	bodyBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
	log.Printf("[Supabase Error] %s -> status=%d body=%s", context, resp.StatusCode, string(bodyBytes))
}

func main() {
	if supabaseURL == "" || supabaseKey == "" {
		log.Fatal("SUPABASE_URL and SUPABASE_KEY must be set!")
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"https://nimedesu.vercel.app"},
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "X-Client-Token", "X-Client-Time"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	r.GET("/", healthHandler)
	r.GET("/health", healthHandler)

	r.GET("/api/anime", animeListHandler)
	r.GET("/api/anime-detail", animeDetailHandler)
	r.GET("/api/anilist-score", anilistScoreHandler)

	r.POST("/api/user-sync", userSyncHandler)
	r.GET("/api/user-data", userDataHandler)
	r.POST("/api/user-update", userUpdateHandler)

	log.Printf("Server running on port %s", port)
	r.Run(":" + port)
}

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "online",
		"service":   "NimeDesu Go API",
		"timestamp": time.Now().Unix(),
	})
}

func animeListHandler(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "12"))
	searchQuery := strings.TrimSpace(c.Query("q"))
	statusFilter := strings.TrimSpace(c.Query("status"))
	genreFilter := strings.TrimSpace(c.Query("genre"))

	offset := (page - 1) * perPage
	query := fmt.Sprintf("select=id,title,url,status,genre,img_url&order=id.asc&offset=%d&limit=%d", offset, perPage)
	if searchQuery != "" {
		query += fmt.Sprintf("&title=ilike.*%s*", url.QueryEscape(searchQuery))
	}
	if genreFilter != "" {
		query += fmt.Sprintf("&genre=ilike.*%s*", url.QueryEscape(genreFilter))
	}
	if statusFilter != "" {
		query += fmt.Sprintf("&status=ilike.*%s*", url.QueryEscape(statusFilter))
	}

	resp, err := supabaseRequest("GET", "anime?"+query, nil, map[string]string{"Prefer": "count=exact"})
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

	c.JSON(http.StatusOK, gin.H{
		"data":        data,
		"total":       totalRecords,
		"page":        page,
		"total_pages": totalPages,
	})
}

func animeDetailHandler(c *gin.Context) {
	animeIDParam := strings.TrimSpace(c.Query("id"))
	if animeIDParam == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID anime tidak valid"})
		return
	}

	idResp, err := supabaseRequest("GET", fmt.Sprintf("anime?id=eq.%s&select=*", url.QueryEscape(animeIDParam)), nil, nil)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"episodes": []interface{}{}})
		return
	}
	defer idResp.Body.Close()

	var animeList []map[string]interface{}
	json.NewDecoder(idResp.Body).Decode(&animeList)

	if len(animeList) == 0 {
		c.JSON(http.StatusOK, gin.H{"episodes": []interface{}{}})
		return
	}

	animeItem := animeList[0]
	animeID := animeItem["id"]

	epResp, _ := supabaseRequest("GET", fmt.Sprintf("episode?anime_id=eq.%v&order=id.asc&select=*", animeID), nil, nil)
	defer epResp.Body.Close()

	var epData []map[string]interface{}
	json.NewDecoder(epResp.Body).Decode(&epData)

	c.JSON(http.StatusOK, gin.H{
		"id":       animeItem["id"],
		"title":    animeItem["title"],
		"img_url":  animeItem["img_url"],
		"genre":    animeItem["genre"],
		"episodes": epData,
	})
}

func anilistScoreHandler(c *gin.Context) {
	title := strings.TrimSpace(c.Query("title"))
	if title == "" {
		c.JSON(http.StatusOK, gin.H{"score": "N/A"})
		return
	}

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
			c.JSON(http.StatusOK, gin.H{"score": formatted})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"score": "N/A"})
}

func userSyncHandler(c *gin.Context) {
	var body map[string]interface{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	anilistID := fmt.Sprintf("%v", body["anilist_id"])
	userInfo := body["user_info"]

	resp, err := supabaseRequest("GET", fmt.Sprintf("login?anilist_id=eq.%s", url.QueryEscape(anilistID)), nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var rows []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&rows)

	if len(rows) == 0 {
		initialCookies := map[string]interface{}{
			"history":   []interface{}{},
			"bookmarks": []interface{}{},
			"favorites": []interface{}{},
			"user_info": userInfo,
		}
		insBody, _ := json.Marshal(map[string]interface{}{
			"anilist_id": anilistID,
			"cookies":    initialCookies,
		})
		supabaseRequest("POST", "login", insBody, nil)
		c.JSON(http.StatusOK, gin.H{"status": "created", "anilist_id": anilistID, "cookies": initialCookies})
	} else {
		cookies := rows[0]["cookies"]
		c.JSON(http.StatusOK, gin.H{"status": "exists", "anilist_id": anilistID, "cookies": cookies})
	}
}

func userDataHandler(c *gin.Context) {
	anilistID := c.Query("anilist_id")
	resp, err := supabaseRequest("GET", fmt.Sprintf("login?anilist_id=eq.%s&select=cookies", url.QueryEscape(anilistID)), nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var rows []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&rows)

	if len(rows) > 0 {
		c.JSON(http.StatusOK, gin.H{"cookies": rows[0]["cookies"]})
	} else {
		c.JSON(http.StatusOK, gin.H{"cookies": gin.H{"history": []interface{}{}, "bookmarks": []interface{}{}, "favorites": []interface{}{}}})
	}
}

func userUpdateHandler(c *gin.Context) {
	var body map[string]interface{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	anilistID := fmt.Sprintf("%v", body["anilist_id"])
	cookies := body["cookies"]

	updBody, _ := json.Marshal(map[string]interface{}{"cookies": cookies})
	resp, err := supabaseRequest("PATCH", fmt.Sprintf("login?anilist_id=eq.%s", url.QueryEscape(anilistID)), updBody, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}
