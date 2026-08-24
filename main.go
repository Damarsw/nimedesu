package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"net/http"
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

func botanicalSecurityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqPath := c.Request.URL.Path

		if reqPath == "/" || reqPath == "/health" || reqPath == "/sitemap.xml" || reqPath == "/robots.txt" || strings.HasPrefix(reqPath, "/api/proxy-stream") || strings.HasPrefix(reqPath, "/proxy-stream") {
			c.Next()
			return
		}

		if strings.HasPrefix(reqPath, "/api/") {
			originHeader := c.GetHeader("Origin")
			refererHeader := c.GetHeader("Referer")

			if !strings.Contains(originHeader, bubalinumDomain) && !strings.Contains(refererHeader, bubalinumDomain) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: 403"})
				return
			}

			clientTimeStr := c.GetHeader("X-Bubalinum-Chrono")
			clientPass := c.GetHeader("X-Bubalinum-Seed")
			userAgent := strings.ToLower(c.GetHeader("User-Agent"))

			automatedTools := []string{"python-requests", "scrapy", "curl", "wget", "axios", "headless"}
			for _, tool := range automatedTools {
				if strings.Contains(userAgent, tool) || userAgent == "" {
					c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Invalid Agent"})
					return
				}
			}

			if clientTimeStr == "" || clientPass == "" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Missing Security Signature"})
				return
			}

			reqTime, err := strconv.ParseInt(clientTimeStr, 10, 64)
			if err != nil || math.Abs(float64(time.Now().Unix()-reqTime)) > 30 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Signature Expired"})
				return
			}

			expectedPayload := fmt.Sprintf("%d_%s", reqTime, bubalinumSignature)
			hashResult := sha256.Sum256([]byte(expectedPayload))
			expectedPass := hex.EncodeToString(hashResult[:])

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
		AllowOrigins:     []string{"https://*" + bubalinumDomain},
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "X-Bubalinum-Seed", "X-Bubalinum-Chrono", "X-Turnstile-Token"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	appEngine.Use(botanicalSecurityMiddleware())

	appEngine.GET("/", botanicalHealthHandler)
	appEngine.GET("/health", botanicalHealthHandler)
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

	SetupSEORoutes(appEngine)

	log.Printf("Server initialised on port %s", serverPort)
	appEngine.Run(":" + serverPort)
}

func botanicalHealthHandler(c *gin.Context) {
	batchStore.RLock()
	itemCount := len(batchStore.ByPopularity)
	batchStore.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"status":    "active",
		"service":   "Phytochemical Processing Engine",
		"items":     itemCount,
		"timestamp": time.Now().Unix(),
	})
}
