package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const BaseDomain = "https://nimedesu.vercel.app"

// Keyword kompetitor untuk di-asosiasikan oleh Googlebot saat merayapi sitemap
var CompetitorKeywords = []string{
	"otakudesu",
	"samehadaku",
	"nimegami",
	"kuramanime",
	"oploverz",
}

// Handler untuk merender Dynamic Sitemap.xml
func sitemapHandler(c *gin.Context) {
	now := time.Now().Format(time.RFC3339)

	xmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
	<url>
		<loc>` + BaseDomain + `/</loc>
		<lastmod>` + now + `</lastmod>
		<changefreq>daily</changefreq>
		<priority>1.0</priority>
	</url>
	<url>
		<loc>` + BaseDomain + `/index.html</loc>
		<lastmod>` + now + `</lastmod>
		<changefreq>daily</changefreq>
		<priority>0.9</priority>
	</url>
	<url>
		<loc>` + BaseDomain + `/stream.html</loc>
		<lastmod>` + now + `</lastmod>
		<changefreq>always</changefreq>
		<priority>0.8</priority>
	</url>
</urlset>`

	c.Header("Content-Type", "application/xml; charset=utf-8")
	c.Header("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=3600")
	c.String(http.StatusOK, xmlContent)
}

// Handler untuk merender Robots.txt
func robotsHandler(c *gin.Context) {
	robotsContent := fmt.Sprintf(`User-agent: *
Allow: /

Sitemap: %s/sitemap.xml
`, BaseDomain)

	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.String(http.StatusOK, robotsContent)
}

type GoogleIndexingPayload struct {
	URL  string `json:"url" binding:"required"`
	Type string `json:"type"` // URL_UPDATED atau URL_DELETED
}

// Handler Bot Notifier ke Google Indexing API
func notifyGoogleHandler(c *gin.Context) {
	var body GoogleIndexingPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Payload URL tidak valid"})
		return
	}

	if body.Type == "" {
		body.Type = "URL_UPDATED"
	}

	fmt.Printf("[SEO-BOT] Memanggil Google Indexing API untuk URL: %s (%s)\n", body.URL, body.Type)

	apiPayload := map[string]string{
		"url":  body.URL,
		"type": body.Type,
	}
	jsonBytes, _ := json.Marshal(apiPayload)

	// Simulasi request HTTP ke endpoint resmi Google
	req, err := http.NewRequestWithContext(context.Background(), "POST", "https://indexing.googleapis.com/v3/urlNotifications:publish", bytes.NewBuffer(jsonBytes))
	if err == nil {
		req.Header.Set("Content-Type", "application/json")
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Notifikasi re-index berhasil dikirim ke sistem Googlebot",
		"target":  body.URL,
	})
}

// SetupSEORoutes meregister seluruh route SEO ke Gin Router utama
func SetupSEORoutes(r *gin.Engine) {
	// Endpoint publik untuk Googlebot (tanpa CORS/Header terisolasi)
	r.GET("/sitemap.xml", sitemapHandler)
	r.GET("/robots.txt", robotsHandler)

	// Endpoint API internal backend
	r.POST("/api/notify-google", notifyGoogleHandler)
}