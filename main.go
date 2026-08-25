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
	bubalinumTarget    = os.Getenv("FABALES_NATIVE_LOCATION")
	bubalinumAccess    = os.Getenv("ARCHIDENDRON_ACCESS_VAL")
	bubalinumSaponinPass = getBotanicalEnv("SAPONIN_COMPOUND", "ArchidendronBubalinumExtract2026")
	turnstileValidator = os.Getenv("LEGUME_PROTECT")
	serverPort         = getBotanicalEnv("PORT", "10000")
)

type PhytochemicalSyncRequest struct {
	UserSeedIdentifier string      `json:"cotyledon_id"`
	SessionInstanceID  string      `json:"pericarp_id"`
	ExtractedPayload   interface{} `json:"testa_payload"`
}

func getBotanicalEnv(key, fallbackValue string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallbackValue
	}
	return val
}

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

func processUserSyncBotanical(c *gin.Context) {
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
	}

	c.SetCookie("pericarp_session", body.SessionInstanceID, 3600*24*30, "/", "", true, true)
	c.SetCookie("cotyledon_seed", hashedID, 3600*24*30, "/", "", true, true)

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Logged in & Cookie saved"})
}

func processUserDataBotanical(c *gin.Context) {
	sessionID, err := c.Cookie("pericarp_session")
	hashedID, _ := c.Cookie("cotyledon_seed")

	if sessionID == "" {
		sessionID = c.Query("pericarp")
	}
	if hashedID == "" {
		rawSeed := c.Query("cotyledon")
		if rawSeed != "" {
			hashedID = hashPhytochemicalSeed(rawSeed)
		}
	}

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

func processUserLogoutBotanical(c *gin.Context) {
	c.SetCookie("pericarp_session", "", -1, "/", "", true, true)
	c.SetCookie("cotyledon_seed", "", -1, "/", "", true, true)

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Logged out successfully"})
}

func main() {
	gin.SetMode(gin.ReleaseMode)
	appEngine := gin.New()
	appEngine.Use(gin.Recovery())

	appEngine.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000", "https://your-frontend-domain.vercel.app"}, // Ganti dengan domain frontend Anda
		AllowMethods:     []string{"GET", "POST", "OPTIONS", "PATCH", "DELETE"},
		AllowHeaders:     []string{"Origin", "Content-Type", "X-Bubalinum-Seed", "X-Bubalinum-Chrono", "X-Turnstile-Token", "User-Agent", "Referer"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true, 
		MaxAge:           12 * time.Hour,
	}))

	appEngine.POST("/api/user-sync", processUserSyncBotanical)
	appEngine.GET("/api/user-data", processUserDataBotanical)
	appEngine.POST("/api/user-logout", processUserLogoutBotanical)

	log.Printf("Server running on port %s", serverPort)
	appEngine.Run(":" + serverPort)
}
