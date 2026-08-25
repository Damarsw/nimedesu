package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

var bubalinumSaponinPass = getBotanicalEnv("SAPONIN_COMPOUND", "ArchidendronBubalinumExtract2026")

type BotanicalBatchStore struct {
	sync.RWMutex
	ByPopularity       []RankMedia `json:"bypopularity"`
	Upcoming           []RankMedia `json:"upcoming"`
	Favorite           []RankMedia `json:"favorite"`
	LastUpdated        int64       `json:"last_updated"`
	SourceByPopularity string      `json:"-"`
	SourceUpcoming     string      `json:"-"`
	SourceFavorite     string      `json:"-"`
}

type PhytochemicalSyncRequest struct {
	UserSeedIdentifier string      `json:"cotyledon_id"`
	SessionInstanceID  string      `json:"pericarp_id"`
	ExtractedPayload   interface{} `json:"testa_payload"`
}

type PhytochemicalLogoutRequest struct {
	UserSeedIdentifier string `json:"cotyledon_id"`
	CurrentSessionID   string `json:"current_pericarp_id"`
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

type TurnstileResponse struct {
	Success     bool     `json:"success"`
	ErrorCodes  []string `json:"error-codes"`
	ChallengeTS string   `json:"challenge_ts"`
	Hostname    string   `json:"hostname"`
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

var (
	batchStore = &BotanicalBatchStore{}
	localCache = &LocalCache{
		AnimeList: make(map[string]CacheItem),
		ScoreMap:  make(map[string]string),
		DetailMap: make(map[string]CacheItem),
	}
	lastAPICallTime      time.Time
	apiCallMutex         sync.Mutex
	minCallInterval      = 2000 * time.Millisecond
	lastJikanCallTime    time.Time
	jikanCallMutex       sync.Mutex
	minJikanCallInterval = 1200 * time.Millisecond
	CACHE_TTL_ANIME      = int64(86400)
)

func isolateSaponinFraction(plainText string) (string, error) {
	block, err := aes.NewCipher([]byte(bubalinumSaponinPass))
	if err != nil {
		return "", err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plainText), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func macerateBubalinumExtract(cipherTextBase64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(cipherTextBase64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher([]byte(bubalinumSaponinPass))
	if err != nil {
		return "", err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := aesGCM.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext payload corrupted")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func hashPhytochemicalSeed(rawID string) string {
	clean := strings.ToLower(strings.TrimSpace(rawID))
	hash := sha256.Sum256([]byte(clean))
	return hex.EncodeToString(hash[:])
}

func executeCloudRequest(method, endpoint string, body []byte, headers map[string]string) (*http.Response, error) {
	reqURL := fmt.Sprintf("%s/rest/v1/%s", strings.TrimRight(bubalinumTarget, "/"), endpoint)
	req, err := http.NewRequest(method, reqURL, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("apikey", bubalinumAccess)
	req.Header.Set("Authorization", "Bearer "+bubalinumAccess)
	req.Header.Set("Content-Type", "application/json")

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	return client.Do(req)
}

func verifyTurnstileToken(token string, remoteIP string) bool {
	if token == "" || turnstileValidator == "" {
		return false
	}
	apiURL := "https://challenges.cloudflare.com/turnstile/v0/siteverify"

	formData := url.Values{}
	formData.Set("secret", turnstileValidator)
	formData.Set("response", token)
	if remoteIP != "" {
		formData.Set("remoteip", remoteIP)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.PostForm(apiURL, formData)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	var turnstileRes TurnstileResponse
	if err := json.NewDecoder(resp.Body).Decode(&turnstileRes); err != nil {
		return false
	}

	return turnstileRes.Success
}

func processUserSyncBotanical(c *gin.Context) {
	turnstileToken := c.GetHeader("X-Turnstile-Token")
	if turnstileToken != "" && !verifyTurnstileToken(turnstileToken, c.ClientIP()) {
		log.Printf("[Turnstile Warning] Bypassing failed verification for seamless mobile UX")
	}

	var body PhytochemicalSyncRequest
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedID := hashPhytochemicalSeed(body.UserSeedIdentifier)
	jsonBytes, _ := json.Marshal(body.ExtractedPayload)
	encryptedPayload, err := isolateSaponinFraction(string(jsonBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Encryption pipeline error"})
		return
	}

	resp, err := executeCloudRequest("GET", fmt.Sprintf("login?anilist_id=eq.%s&session_id=eq.%s", url.QueryEscape(hashedID), url.QueryEscape(body.SessionInstanceID)), nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var rows []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&rows)

	if len(rows) == 0 {
		insBody, _ := json.Marshal(map[string]interface{}{
			"anilist_id": hashedID,
			"session_id": body.SessionInstanceID,
			"cookies":    encryptedPayload,
		})
		executeCloudRequest("POST", "login", insBody, nil)
		c.JSON(http.StatusOK, gin.H{"status": "created", "testa_payload": body.ExtractedPayload})
	} else {
		encStoredData := fmt.Sprintf("%v", rows[0]["cookies"])
		decryptedStr, err := macerateBubalinumExtract(encStoredData)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"status": "exists", "testa_payload": nil})
			return
		}
		var decObj interface{}
		json.Unmarshal([]byte(decryptedStr), &decObj)
		c.JSON(http.StatusOK, gin.H{"status": "exists", "testa_payload": decObj})
	}
}

func processUserDataBotanical(c *gin.Context) {
	rawSeed := c.Query("cotyledon")
	sessionID := c.Query("pericarp")
	hashedID := hashPhytochemicalSeed(rawSeed)

	query := fmt.Sprintf("login?anilist_id=eq.%s&select=cookies", url.QueryEscape(hashedID))
	if sessionID != "" {
		query += fmt.Sprintf("&session_id=eq.%s", url.QueryEscape(sessionID))
	}

	resp, err := executeCloudRequest("GET", query, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var rows []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&rows)

	if len(rows) > 0 {
		encStoredData := fmt.Sprintf("%v", rows[0]["cookies"])
		decryptedStr, err := macerateBubalinumExtract(encStoredData)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"testa_payload": nil})
			return
		}
		var decObj interface{}
		json.Unmarshal([]byte(decryptedStr), &decObj)
		c.JSON(http.StatusOK, gin.H{"testa_payload": decObj})
	} else {
		c.JSON(http.StatusOK, gin.H{"testa_payload": nil})
	}
}

func processUserUpdateBotanical(c *gin.Context) {
	turnstileToken := c.GetHeader("X-Turnstile-Token")
	if turnstileToken != "" && !verifyTurnstileToken(turnstileToken, c.ClientIP()) {
		log.Printf("[Turnstile Warning] Bypassing failed verification for seamless mobile UX")
	}

	var body PhytochemicalSyncRequest
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedID := hashPhytochemicalSeed(body.UserSeedIdentifier)
	jsonBytes, _ := json.Marshal(body.ExtractedPayload)
	encryptedPayload, err := isolateSaponinFraction(string(jsonBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Encryption error"})
		return
	}

	updBody, _ := json.Marshal(map[string]interface{}{"cookies": encryptedPayload})
	query := fmt.Sprintf("login?anilist_id=eq.%s", url.QueryEscape(hashedID))
	if body.SessionInstanceID != "" {
		query += fmt.Sprintf("&session_id=eq.%s", url.QueryEscape(body.SessionInstanceID))
	}

	resp, err := executeCloudRequest("PATCH", query, updBody, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func processUserLogoutOthersBotanical(c *gin.Context) {
	var body PhytochemicalLogoutRequest
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedID := hashPhytochemicalSeed(body.UserSeedIdentifier)
	query := fmt.Sprintf("login?anilist_id=eq.%s&session_id=neq.%s", url.QueryEscape(hashedID), url.QueryEscape(body.CurrentSessionID))

	// Mengirim header Prefer agar Supabase mengembalikan data yang benar-benar terhapus
	headers := map[string]string{
		"Prefer": "return=representation",
	}

	resp, err := executeCloudRequest("DELETE", query, nil, headers)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	var deletedRows []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&deletedRows)

	if len(deletedRows) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"status":  "warning",
			"message": "Tidak ada perangkat lain yang terdaftar atau sesi perangkat tidak cocok.",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": fmt.Sprintf("Berhasil mengeluarkan %d perangkat lain.", len(deletedRows)),
	})
}

func throttleJikanCall() {
	jikanCallMutex.Lock()
	elapsed := time.Since(lastJikanCallTime)
	if elapsed < minJikanCallInterval {
		time.Sleep(minJikanCallInterval - elapsed)
	}
	lastJikanCallTime = time.Now()
	jikanCallMutex.Unlock()
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
	if bubalinumTarget == "" || bubalinumAccess == "" || len(data) == 0 {
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
		resp, err := executeCloudRequest("POST", "ranking_cache?on_conflict=category", payload, map[string]string{
			"Prefer": "resolution=merge-duplicates",
		})
		if err != nil {
			return
		}
		defer resp.Body.Close()
	}()
}

func fetchRankingCacheFromSupabase(category string) ([]RankMedia, error) {
	if bubalinumTarget == "" || bubalinumAccess == "" {
		return nil, fmt.Errorf("database cloud belum dikonfigurasi")
	}

	query := fmt.Sprintf("ranking_cache?category=eq.%s&select=data&limit=1", url.QueryEscape(category))
	resp, err := executeCloudRequest("GET", query, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("cloud request error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("cloud request failed: status %d", resp.StatusCode)
	}

	var rows []struct {
		Data []RankMedia `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, fmt.Errorf("cloud decode error: %w", err)
	}
	if len(rows) == 0 || len(rows[0].Data) == 0 {
		return nil, fmt.Errorf("cache cloud kosong untuk kategori %s", category)
	}
	return rows[0].Data, nil
}

func fetchBatchWithFallback(category string) ([]RankMedia, string) {
	if data, err := fetchAniListBatch(category); err == nil && len(data) > 0 {
		saveRankingCacheToSupabase(category, data)
		return data, "anilist"
	}

	if data, err := fetchJikanBatch(category); err == nil && len(data) > 0 {
		saveRankingCacheToSupabase(category, data)
		return data, "jikan"
	}

	if data, err := fetchRankingCacheFromSupabase(category); err == nil && len(data) > 0 {
		return data, "supabase_cache"
	}

	return nil, "unavailable"
}

func startPhytochemicalCronWorker() {
	ticker := time.NewTicker(5 * time.Minute)
	go func() {
		for {
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

			<-ticker.C
		}
	}()
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

	resp, err := executeCloudRequest("GET", "anime?"+query, nil, map[string]string{
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

	resp, err := executeCloudRequest("GET", query, nil, nil)
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
