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
	ByPopularity       []RankMedia `json:"bypopularity"`
	Upcoming           []RankMedia `json:"upcoming"`
	Favorite           []RankMedia `json:"favorite"`
	LastUpdated        int64       `json:"last_updated"`
	SourceByPopularity string      `json:"-"`
	SourceUpcoming     string      `json:"-"`
	SourceFavorite     string      `json:"-"`
}

type RankMedia struct {
	ID           int       `json:"id"`
	Title        RankTitle `json:"title"`
	CoverImage   RankCover `json:"coverImage"`
	AverageScore float64   `json:"averageScore"`
	Popularity   int       `json:"popularity"`
}

type RankTitle struct {
	Romaji        string `json:"romaji"`
	English       string `json:"english"`
	UserPreferred string `json:"userPreferred"`
}

type RankCover struct {
	ExtraLarge string `json:"extraLarge"`
	Large      string `json:"large"`
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
	minCallInterval = 2000 * time.Millisecond

	lastJikanCallTime    time.Time
	jikanCallMutex       sync.Mutex
	minJikanCallInterval = 1200 * time.Millisecond

	CACHE_TTL_ANIME = int64(86400)
)

func throttleJikanCall() {
	jikanCallMutex.Lock()
	elapsed := time.Since(lastJikanCallTime)
	if elapsed < minJikanCallInterval {
		time.Sleep(minJikanCallInterval - elapsed)
	}
	lastJikanCallTime = time.Now()
	jikanCallMutex.Unlock()
}

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
	cleanText := strings.TrimSpace(text)
	if cleanText == "" {
		return ""
	}

	if len(cleanText) > 1200 {
		cleanText = cleanText[:1200]
	}

	translateURL := fmt.Sprintf("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=id&dt=t&q=%s", url.QueryEscape(cleanText))

	req, err := http.NewRequest("GET", translateURL, nil)
	if err != nil {
		return text
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return text
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return text
	}

	var result []interface{}
	if err := json.Unmarshal(bodyBytes, &result); err != nil || len(result) == 0 {
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

	translated := strings.TrimSpace(translatedBuilder.String())
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
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
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

func fetchAniListBatch(category string) ([]RankMedia, error) {
	apiCallMutex.Lock()
	elapsed := time.Since(lastAPICallTime)
	if elapsed < minCallInterval {
		time.Sleep(minCallInterval - elapsed)
	}
	lastAPICallTime = time.Now()
	apiCallMutex.Unlock()

	var graphqlQuery string
	if category == "upcoming" {
		graphqlQuery = `{
			Page(page: 1, perPage: 100) {
				media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) {
					id title { romaji english userPreferred }
					coverImage { extraLarge large }
					averageScore popularity
				}
			}
		}`
	} else if category == "favorite" {
		graphqlQuery = `{
			Page(page: 1, perPage: 100) {
				media(type: ANIME, sort: SCORE_DESC) {
					id title { romaji english userPreferred }
					coverImage { extraLarge large }
					averageScore popularity
				}
			}
		}`
	} else {
		graphqlQuery = `{
			Page(page: 1, perPage: 100) {
				media(type: ANIME, sort: POPULARITY_DESC) {
					id title { romaji english userPreferred }
					coverImage { extraLarge large }
					averageScore popularity
				}
			}
		}`
	}

	reqBody, _ := json.Marshal(map[string]string{"query": graphqlQuery})
	req, _ := http.NewRequest("POST", "https://graphql.anilist.co", bytes.NewBuffer(reqBody))
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", "https://anilist.co")
	req.Header.Set("Referer", "https://anilist.co/")

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("anilist request error: %w", err)
	}

	if resp.StatusCode == 429 {
		resp.Body.Close()
		time.Sleep(2500 * time.Millisecond)
		resp, err = client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("anilist retry request error: %w", err)
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("anilist request failed: status %d - body: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Data struct {
			Page struct {
				Media []RankMedia `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("anilist decode error: %w", err)
	}
	if len(result.Data.Page.Media) == 0 {
		return nil, fmt.Errorf("anilist mengembalikan data kosong")
	}
	return result.Data.Page.Media, nil
}

func fetchJikanBatch(category string) ([]RankMedia, error) {
	filter := category
	if filter != "upcoming" && filter != "favorite" {
		filter = "bypopularity"
	}

	client := &http.Client{Timeout: 6 * time.Second}
	var combined []RankMedia
	var lastErr error

	for page := 1; page <= 2; page++ {
		throttleJikanCall()

		jikanURL := fmt.Sprintf("https://api.jikan.moe/v4/top/anime?filter=%s&page=%d&limit=25", filter, page)
		req, _ := http.NewRequest("GET", jikanURL, nil)

		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("jikan request error (page %d): %w", page, err)
			break
		}

		if resp.StatusCode == 429 && page == 1 {
			resp.Body.Close()
			time.Sleep(1500 * time.Millisecond)
			throttleJikanCall()
			resp, err = client.Do(req)
			if err != nil {
				lastErr = fmt.Errorf("jikan retry request error (page %d): %w", page, err)
				break
			}
		}

		if resp.StatusCode != 200 {
			lastErr = fmt.Errorf("jikan request failed (page %d): status %d", page, resp.StatusCode)
			resp.Body.Close()
			break
		}

		var res struct {
			Data []struct {
				MalID   int    `json:"mal_id"`
				Title   string `json:"title"`
				TitleEn string `json:"title_english"`
				Images  struct {
					JPG struct {
						LargeImageURL string `json:"large_image_url"`
					} `json:"jpg"`
				} `json:"images"`
				Score   float64 `json:"score"`
				Members int     `json:"members"`
			} `json:"data"`
			Pagination struct {
				HasNextPage bool `json:"has_next_page"`
			} `json:"pagination"`
		}

		decodeErr := json.NewDecoder(resp.Body).Decode(&res)
		resp.Body.Close()
		if decodeErr != nil {
			lastErr = fmt.Errorf("jikan decode error (page %d): %w", page, decodeErr)
			break
		}
		if len(res.Data) == 0 {
			lastErr = fmt.Errorf("jikan mengembalikan data kosong (page %d)", page)
			break
		}

		for _, item := range res.Data {
			english := item.TitleEn
			if english == "" {
				english = item.Title
			}
			combined = append(combined, RankMedia{
				ID: item.MalID,
				Title: RankTitle{
					Romaji:        item.Title,
					English:       english,
					UserPreferred: english,
				},
				CoverImage: RankCover{
					ExtraLarge: item.Images.JPG.LargeImageURL,
					Large:      item.Images.JPG.LargeImageURL,
				},
				AverageScore: item.Score * 10,
				Popularity:   item.Members,
			})
		}

		if !res.Pagination.HasNextPage {
			break
		}
	}

	if len(combined) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("jikan mengembalikan data kosong")
		}
		return nil, lastErr
	}
	return combined, nil
}

func saveRankingCacheToSupabase(category string, data []RankMedia) {
	if supabaseURL == "" || supabaseKey == "" || len(data) == 0 {
		return
	}
	payload, err := json.Marshal(map[string]interface{}{
		"category":   category,
		"data":       data,
		"updated_at": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return
	}

	go func() {
		resp, err := supabaseRequest("POST", "ranking_cache?on_conflict=category", payload, map[string]string{
			"Prefer": "resolution=merge-duplicates",
		})
		if err != nil {
			log.Printf("[Ranking Cache] Gagal menyimpan cache Supabase untuk %s: %v", category, err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			log.Printf("[Ranking Cache] Upsert Supabase '%s' gagal (status %d): %s", category, resp.StatusCode, string(body))
		}
	}()
}

func fetchRankingCacheFromSupabase(category string) ([]RankMedia, error) {
	if supabaseURL == "" || supabaseKey == "" {
		return nil, fmt.Errorf("supabase belum dikonfigurasi")
	}

	query := fmt.Sprintf("ranking_cache?category=eq.%s&select=data&limit=1", url.QueryEscape(category))
	resp, err := supabaseRequest("GET", query, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("supabase request error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("supabase request failed: status %d", resp.StatusCode)
	}

	var rows []struct {
		Data []RankMedia `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, fmt.Errorf("supabase decode error: %w", err)
	}
	if len(rows) == 0 || len(rows[0].Data) == 0 {
		return nil, fmt.Errorf("cache supabase kosong untuk kategori %s", category)
	}
	return rows[0].Data, nil
}

func fetchBatchWithFallback(category string) ([]RankMedia, string) {
	if data, err := fetchAniListBatch(category); err == nil && len(data) > 0 {
		saveRankingCacheToSupabase(category, data)
		return data, "anilist"
	} else {
		log.Printf("[Ranking Fallback] AniList gagal untuk '%s': %v -- mencoba Jikan...", category, err)
	}

	if data, err := fetchJikanBatch(category); err == nil && len(data) > 0 {
		saveRankingCacheToSupabase(category, data)
		return data, "jikan"
	} else {
		log.Printf("[Ranking Fallback] Jikan gagal untuk '%s': %v -- mencoba cache Supabase...", category, err)
	}

	if data, err := fetchRankingCacheFromSupabase(category); err == nil && len(data) > 0 {
		log.Printf("[Ranking Fallback] Memakai cache Supabase untuk '%s'", category)
		return data, "supabase_cache"
	} else {
		log.Printf("[Ranking Fallback] Cache Supabase juga gagal untuk '%s': %v", category, err)
	}

	return nil, "unavailable"
}

func startCronWorker() {
	ticker := time.NewTicker(5 * time.Minute)
	go func() {
		for {
			log.Println("[Cron Worker] Refreshing batch ranking (AniList -> Jikan -> Supabase)...")
			pop, popSrc := fetchBatchWithFallback("bypopularity")
			time.Sleep(1 * time.Second)
			upc, upcSrc := fetchBatchWithFallback("upcoming")
			time.Sleep(1 * time.Second)
			fav, favSrc := fetchBatchWithFallback("favorite")

			batchStore.Lock()
			if len(pop) > 0 {
				batchStore.ByPopularity = pop
				batchStore.SourceByPopularity = popSrc
			}
			if len(upc) > 0 {
				batchStore.Upcoming = upc
				batchStore.SourceUpcoming = upcSrc
			}
			if len(fav) > 0 {
				batchStore.Favorite = fav
				batchStore.SourceFavorite = favSrc
			}
			batchStore.LastUpdated = time.Now().Unix()
			batchStore.Unlock()

			log.Printf("[Cron Worker] Batch ranking update selesai! (pop:%s, upcoming:%s, favorite:%s)", popSrc, upcSrc, favSrc)
			<-ticker.C
		}
	}()
}

func securityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		if path == "/" || path == "/health" || path == "/sitemap.xml" || path == "/robots.txt" || path == "/api/clear-cache" || path == "/api/test-apis" || strings.HasPrefix(path, "/api/proxy-stream") || strings.HasPrefix(path, "/proxy-stream") {
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

	r.GET("/api/test-apis", testAPIsHandler)

	log.Printf("Server running on port %s", port)
	r.Run(":" + port)
}

func testAPIsHandler(c *gin.Context) {
	anilistData, anilistErr := fetchAniListBatch("bypopularity")
	jikanData, jikanErr := fetchJikanBatch("bypopularity")

	c.JSON(http.StatusOK, gin.H{
		"anilist": gin.H{
			"status":      anilistErr == nil,
			"items_count": len(anilistData),
			"error":       fmt.Sprintf("%v", anilistErr),
		},
		"jikan": gin.H{
			"status":      jikanErr == nil,
			"items_count": len(jikanData),
			"error":       fmt.Sprintf("%v", jikanErr),
		},
	})
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

	// FIXED: Menambahkan kolom 'score' agar skor tidak terbawa N/A di beranda
	query := fmt.Sprintf("select=id,title,url,status,genre,img_url,score&order=id.asc&offset=%d&limit=%d", offset, limit)
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

	// FIXED: Sanitasi string "<nil>" dari Supabase agar tidak bocor ke frontend
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
	if japaneseVal == "<nil>" { japaneseVal = "-" }
	if extMeta != nil && extMeta.Japanese != "" {
		japaneseVal = extMeta.Japanese
	}

	scoreVal := fmt.Sprintf("%v", animeItem["score"])
	if scoreVal == "<nil>" { scoreVal = "-" }
	if extMeta != nil && extMeta.Score != "" {
		scoreVal = extMeta.Score
	}

	statusVal := fmt.Sprintf("%v", animeItem["status"])
	if statusVal == "<nil>" { statusVal = "-" }
	if extMeta != nil && extMeta.Status != "" {
		statusVal = extMeta.Status
	}

	totalEpVal := fmt.Sprintf("%v", animeItem["total_episodes"])
	if totalEpVal == "<nil>" { totalEpVal = "-" }
	if extMeta != nil && extMeta.TotalEp != "" {
		totalEpVal = extMeta.TotalEp
	}

	durationVal := fmt.Sprintf("%v", animeItem["duration"])
	if durationVal == "<nil>" { durationVal = "-" }
	if extMeta != nil && extMeta.Duration != "" {
		durationVal = extMeta.Duration
	}

	releaseDateVal := fmt.Sprintf("%v", animeItem["release_date"])
	if releaseDateVal == "<nil>" { releaseDateVal = "-" }
	if extMeta != nil && extMeta.ReleaseDate != "" {
		releaseDateVal = extMeta.ReleaseDate
	}

	studioVal := fmt.Sprintf("%v", animeItem["studio"])
	if studioVal == "<nil>" { studioVal = "-" }
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
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
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
	var allMedia []RankMedia
	var source string
	switch category {
	case "upcoming":
		allMedia = batchStore.Upcoming
		source = batchStore.SourceUpcoming
	case "favorite":
		allMedia = batchStore.Favorite
		source = batchStore.SourceFavorite
	default:
		allMedia = batchStore.ByPopularity
		source = batchStore.SourceByPopularity
	}
	batchStore.RUnlock()

	if len(allMedia) == 0 {
		fetched, src := fetchBatchWithFallback(category)
		if len(fetched) > 0 {
			allMedia = fetched
			source = src

			batchStore.Lock()
			switch category {
			case "upcoming":
				batchStore.Upcoming = fetched
				batchStore.SourceUpcoming = src
			case "favorite":
				batchStore.Favorite = fetched
				batchStore.SourceFavorite = src
			default:
				batchStore.ByPopularity = fetched
				batchStore.SourceByPopularity = src
			}
			batchStore.LastUpdated = time.Now().Unix()
			batchStore.Unlock()
		}
	}

	if len(allMedia) == 0 {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{
			"top3":      []RankMedia{},
			"list":      []RankMedia{},
			"last_page": 1,
			"source":    "unavailable",
			"error":     "Data belum siap",
		})
		return
	}

	top3 := make([]RankMedia, 0)
	if len(allMedia) >= 3 {
		top3 = allMedia[:3]
	} else {
		top3 = allMedia
	}

	var pageMedia []RankMedia
	startIdx := 3
	if page > 1 {
		startIdx = (page-1)*12 + 3
	}

	if startIdx < len(allMedia) {
		endIdx := startIdx + 12
		if endIdx > len(allMedia) {
			endIdx = len(allMedia)
		}
		pageMedia = allMedia[startIdx:endIdx]
	} else {
		pageMedia = []RankMedia{}
	}

	totalItems := len(allMedia) - 3
	if totalItems < 1 {
		totalItems = 1
	}
	lastPage := int(math.Ceil(float64(totalItems) / 12.0))

	c.Header("Cache-Control", "public, s-maxage=300")
	c.JSON(http.StatusOK, gin.H{
		"top3":      top3,
		"list":      pageMedia,
		"last_page": lastPage,
		"source":    source,
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
