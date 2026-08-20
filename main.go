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
	turnstileSecret = os.Getenv("TURNSTILE_SECRET_KEY")
	secretServerKey = getEnvOrDefault("SECRET_SERVER_KEY", "NimeDesuSecretKey2026")
	port            = getEnvOrDefault("PORT", "10000")
)

// Structural Cache RAM & Limits
type visitorRate struct {
	count    int
	lastSeen time.Time
}

var (
	visitors     = make(map[string]*visitorRate)
	visitorMutex sync.Mutex
)

// Rate Limiter Sederhana (Pure Go Standard Library)
func isAllowed(ip string) bool {
	visitorMutex.Lock()
	defer visitorMutex.Unlock()

	v, exists := visitors[ip]
	now := time.Now()

	if !exists || now.Sub(v.lastSeen) > 1*time.Second {
		visitors[ip] = &visitorRate{count: 1, lastSeen: now}
		return true
	}

	// Batasi maksimal 10 request per detik per IP
	if v.count >= 10 {
		return false
	}

	v.count++
	return true
}

func cleanupVisitors() {
	for {
		time.Sleep(5 * time.Minute)
		visitorMutex.Lock()
		for ip, v := range visitors {
			if time.Since(v.lastSeen) > 5*time.Minute {
				delete(visitors, ip)
			}
		}
		visitorMutex.Unlock()
	}
}

// Verifikasi Token Turnstile ke Cloudflare Server
func verifyTurnstileToken(token string) bool {
	if turnstileSecret == "" {
		return true // Fallback jika belum di-set di env
	}

	resp, err := http.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify",
		url.Values{
			"secret":   {turnstileSecret},
			"response": {token},
		})
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	var result struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		return result.Success
	}
	return false
}

// Rate Limiting Middleware
func rateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !isAllowed(ip) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Akses terlalu cepat! Silakan tunggu beberapa detik.",
			})
			return
		}
		c.Next()
	}
}

// Updated Security Middleware
func securityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/" || path == "/health" || path == "/api/clear-cache" {
			c.Next()
			return
		}

		if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/proxy-stream") {
			turnstileToken := c.GetHeader("X-Turnstile-Token")
			if turnstileToken != "" {
				if !verifyTurnstileToken(turnstileToken) {
					c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Verifikasi Bot (Turnstile) Gagal!"})
					return
				}
			}

			origin := c.GetHeader("Origin")
			referer := c.GetHeader("Referer")
			allowedDomain := "nimedesu.vercel.app"

			if origin != "" && !strings.Contains(origin, allowedDomain) && !strings.Contains(referer, allowedDomain) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Direct access is forbidden"})
				return
			}

			userAgent := strings.ToLower(c.GetHeader("User-Agent"))
			bots := []string{"python-requests", "scrapy", "curl", "wget", "axios", "headless"}
			for _, bot := range bots {
				if strings.Contains(userAgent, bot) || userAgent == "" {
					c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Invalid Agent"})
					return
				}
			}
		}
		c.Next()
	}
}

func main() {
	if supabaseURL == "" || supabaseKey == "" {
		log.Fatal("SUPABASE_URL and SUPABASE_KEY must be set!")
	}

	go cleanupVisitors()
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

	r.Use(rateLimitMiddleware())
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

	r.GET("/api/clear-cache", func(c *gin.Context) {
		localCache.Lock()
		localCache.AnimeList = make(map[string]CacheItem)
		localCache.Unlock()
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Cache RAM 24 jam berhasil dibersihkan!"})
	})

	log.Printf("Server running on port %s", port)
	r.Run(":" + port)
}
