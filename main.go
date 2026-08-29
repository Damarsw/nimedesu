package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

var (
	bubalinumTarget    = os.Getenv("FABALES_NATIVE_LOCATION")
	bubalinumAccess    = os.Getenv("ARCHIDENDRON_ACCESS_VAL")
	bubalinumSignature = getBotanicalEnv("BUBALINUM_SIG", "ArchidendronSeed2026")
	bubalinumDomain    = getBotanicalEnv("FABACEAE_ORIGIN", "vercel.app")
	turnstileValidator = os.Getenv("LEGUME_PROTECT")
	serverPort         = getBotanicalEnv("PORT", "10000")
)

func getBotanicalEnv(key, fallbackValue string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallbackValue
	}
	return val
}

func generatePlayerTokenHandler(c *gin.Context) {
	referer := c.GetHeader("Referer")
	origin := c.GetHeader("Origin")
	isLocal := strings.Contains(referer, "localhost") || strings.Contains(referer, "127.0.0.1") ||
		strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1")
	isDomainValid := strings.Contains(referer, bubalinumDomain) || strings.Contains(origin, bubalinumDomain)

	if !isDomainValid && !isLocal {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access Denied: Invalid Origin"})
		return
	}

	rawUrl := c.Query("url")
	if rawUrl == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "URL parameter required"})
		return
	}

	expires := time.Now().Add(10 * time.Minute).Unix()

	mac := hmac.New(sha256.New, []byte(bubalinumSignature))
	mac.Write([]byte(fmt.Sprintf("%s:%d", rawUrl, expires)))
	signature := hex.EncodeToString(mac.Sum(nil))

	encodedTarget := base64.StdEncoding.EncodeToString([]byte(rawUrl))

	c.JSON(http.StatusOK, gin.H{
		"token": fmt.Sprintf("t=%s&e=%d&s=%s", url.QueryEscape(encodedTarget), expires, signature),
	})
}

func embeddedPlayerHandler(c *gin.Context) {
	referer := c.GetHeader("Referer")
	isLocal := strings.Contains(referer, "localhost") || strings.Contains(referer, "127.0.0.1")
	isDomainValid := strings.Contains(referer, bubalinumDomain)

	if referer == "" || (!isDomainValid && !isLocal) {
		c.String(http.StatusForbidden, "Access Denied: Direct Access Not Allowed")
		return
	}

	tokenParam := c.Query("t")
	expiresParam := c.Query("e")
	sigParam := c.Query("s")

	if tokenParam == "" && c.Query("v") != "" {
		tokenParam = c.Query("v")
	}

	if tokenParam == "" {
		c.String(http.StatusBadRequest, "Invalid Security Token")
		return
	}

	if expiresParam != "" && sigParam != "" {
		expTime, err := strconv.ParseInt(expiresParam, 10, 64)
		if err != nil || time.Now().Unix() > expTime {
			c.String(http.StatusUnauthorized, "Security Token Expired. Please refresh page.")
			return
		}

		decodedTarget, err := base64.StdEncoding.DecodeString(tokenParam)
		if err == nil {
			rawVideoURL := string(decodedTarget)
			mac := hmac.New(sha256.New, []byte(bubalinumSignature))
			mac.Write([]byte(fmt.Sprintf("%s:%d", rawVideoURL, expTime)))
			expectedSig := hex.EncodeToString(mac.Sum(nil))

			if !hmac.Equal([]byte(sigParam), []byte(expectedSig)) {
				c.String(http.StatusForbidden, "Signature Tampering Detected!")
				return
			}
		}
	}

	unescapedTarget, _ := url.QueryUnescape(tokenParam)
	decodedBytes, err := base64.StdEncoding.DecodeString(unescapedTarget)
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid Payload Token")
		return
	}
	rawVideoURL := string(decodedBytes)

	// =============================================================
	// KHUSUS LINK GOOGLE DRIVE: REDIRECT LANGSUNG (TANPA PEMBUNGKUS HTML)
	// =============================================================
	if strings.Contains(rawVideoURL, "drive.google.com") {
		c.Redirect(http.StatusFound, rawVideoURL)
		return
	}

	// UNTUK LINK NON-GDRIVE (.mp4, .m3u8, dll): MENGGUNAKAN HTML PLAYER ORDINARIS
	xorKey := byte(0x5A)
	var byteArray []string
	for i := 0; i < len(rawVideoURL); i++ {
		byteArray = append(byteArray, fmt.Sprintf("%d", rawVideoURL[i]^xorKey))
	}
	encryptedData := strings.Join(byteArray, ",")

	htmlTemplate := fmt.Sprintf(`<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { width: 100%%; height: 100%%; background: #000; overflow: hidden; display: flex; justify-content: center; align-items: center; }
        #v-app { width: 100%%; height: 100%%; display: flex; justify-content: center; align-items: center; position: relative; }
        iframe, video { width: 100%% !important; height: 100%% !important; border: 0 !important; outline: none; display: block; object-fit: contain; }
    </style>
</head>
<body oncontextmenu="return false;">
    <div id="v-app"></div>
    <script>
        (function(){
            try {
                var payload = [%s];
                var k = 0x5A;
                var res = "";
                for(var i=0; i<payload.length; i++) {
                    res += String.fromCharCode(payload[i] ^ k);
                }
                
                var container = document.getElementById('v-app');

                if (res.endsWith('.mp4') || res.endsWith('.m3u8')) {
                    var v = document.createElement('video');
                    v.controls = true; 
                    v.autoplay = true; 
                    v.playsInline = true;
                    v.controlsList = "nodownload";
                    v.src = res;
                    container.appendChild(v);
                } else {
                    var f = document.createElement('iframe');
                    f.allow = "autoplay; encrypted-media; fullscreen";
                    f.allowFullscreen = true;
                    f.src = res;
                    container.appendChild(f);
                }
            } catch(e) {}
        })();
    </script>
</body>
</html>`, encryptedData)

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("X-Frame-Options", "SAMEORIGIN")
	c.String(http.StatusOK, htmlTemplate)
}

func botanicalSecurityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqPath := c.Request.URL.Path

		if reqPath == "/" || reqPath == "/health" || reqPath == "/sitemap.xml" || reqPath == "/robots.txt" ||
			reqPath == "/api/clear-cache" || reqPath == "/api/test-apis" ||
			reqPath == "/player" || strings.HasPrefix(reqPath, "/api/player") || strings.HasPrefix(reqPath, "/api-backend/player") ||
			strings.HasPrefix(reqPath, "/get-token") || strings.HasPrefix(reqPath, "/get-player-token") ||
			strings.HasPrefix(reqPath, "/api/get-token") || strings.HasPrefix(reqPath, "/api/get-player-token") ||
			strings.HasPrefix(reqPath, "/api-backend/get-token") || strings.HasPrefix(reqPath, "/api-backend/get-player-token") ||
			strings.HasPrefix(reqPath, "/api/proxy-stream") || strings.HasPrefix(reqPath, "/proxy-stream") {
			c.Next()
			return
		}

		if strings.HasPrefix(reqPath, "/api/") {
			clientTimeStr := c.GetHeader("X-Bubalinum-Chrono")
			clientPass := c.GetHeader("X-Bubalinum-Seed")

			if clientTimeStr == "" || clientPass == "" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Missing Security Signature"})
				return
			}

			reqTime, err := strconv.ParseInt(clientTimeStr, 10, 64)
			if err != nil || math.Abs(float64(time.Now().Unix()-reqTime)) > 900 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Signature Expired"})
				return
			}

			expectedRaw := fmt.Sprintf("%d_bubalinum_extract", reqTime)
			expectedPass := strings.TrimRight(base64.StdEncoding.EncodeToString([]byte(expectedRaw)), "=")

			if subtle.ConstantTimeCompare([]byte(expectedPass), []byte(clientPass)) != 1 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Invalid Token Signature"})
				return
			}
		}
		c.Next()
	}
}

func main() {
	if bubalinumTarget == "" || bubalinumAccess == "" {
		log.Fatal("FABALES_NATIVE_LOCATION and ARCHIDENDRON_ACCESS_VAL environment variables must be configured!")
	}

	startPhytochemicalCronWorker()

	gin.SetMode(gin.ReleaseMode)
	appEngine := gin.New()
	appEngine.Use(gin.Recovery())

	appEngine.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "X-Bubalinum-Seed", "X-Bubalinum-Chrono", "X-Turnstile-Token", "User-Agent", "Referer"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	appEngine.Use(botanicalSecurityMiddleware())

	appEngine.GET("/", botanicalHealthHandler)
	appEngine.GET("/health", botanicalHealthHandler)

	appEngine.GET("/get-token", generatePlayerTokenHandler)
	appEngine.GET("/get-player-token", generatePlayerTokenHandler)
	appEngine.GET("/api/get-player-token", generatePlayerTokenHandler)
	appEngine.GET("/api-backend/get-token", generatePlayerTokenHandler)
	appEngine.GET("/api-backend/get-player-token", generatePlayerTokenHandler)

	appEngine.GET("/player", embeddedPlayerHandler)
	appEngine.GET("/api/player", embeddedPlayerHandler)
	appEngine.GET("/api-backend/player", embeddedPlayerHandler)

	appEngine.GET("/api/proxy-stream", proxyStreamHandler)
	appEngine.GET("/proxy-stream", proxyStreamHandler)

	appEngine.GET("/api/anime", animeListHandler)
	appEngine.GET("/api/anime-detail", animeDetailHandler)
	appEngine.GET("/api/anilist-score", anilistScoreHandler)
	appEngine.GET("/api/ranking", rankingHandler)

	appEngine.POST("/api/user-sync", processUserSyncBotanical)
	appEngine.GET("/api/user-data", processUserDataBotanical)
	appEngine.POST("/api/user-update", processUserUpdateBotanical)
	appEngine.POST("/api/user-logout-others", processUserLogoutOthersBotanical)

	appEngine.GET("/api/clear-cache", func(c *gin.Context) {
		localCache.Lock()
		localCache.AnimeList = make(map[string]CacheItem)
		localCache.ScoreMap = make(map[string]string)
		localCache.DetailMap = make(map[string]CacheItem)
		localCache.Unlock()
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Cache RAM 24 jam berhasil dibersihkan!"})
	})

	appEngine.GET("/api/test-apis", testAPIsHandler)

	log.Printf("Server initialised on port %s", serverPort)
	appEngine.Run(":" + serverPort)
}

func botanicalHealthHandler(c *gin.Context) {
	batchStore.RLock()
	count := len(batchStore.ByPopularity)
	batchStore.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"status":             "online",
		"service":            "Phytochemical Processing Engine",
		"max_api_rate_limit": "80 calls/min",
		"batch_items_loaded": count,
		"timestamp":          time.Now().Unix(),
	})
}
