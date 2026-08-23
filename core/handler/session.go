package handler

import (
	"net/http"
	"github.com/gin-gonic/gin"
)

type SyncRequest struct {
	AnilistID        string `json:"anilist_id"`
	SessionID        string `json:"session_id"`
	CookiesEncrypted string `json:"cookies_encrypted"`
}

func GetUserDataHandler(c *gin.Context) {
    anilistID := c.Query("anilist_id")
    sessionID := c.Query("session_id")

    cookiesData, err := fetchCookiesFromSupabase(anilistID, sessionID)

    if err != nil || cookiesData == "" {
        c.JSON(http.StatusUnauthorized, gin.H{
            "status":  "session_invalid",
            "message": "Sesi tidak ditemukan atau telah di-logout.",
        })
        return
    }

    c.JSON(http.StatusOK, gin.H{"cookies_encrypted": cookiesData})
}

func LogoutOtherDevicesHandler(c *gin.Context) {
	var body struct {
		AnilistID        string `json:"anilist_id"`
		CurrentSessionID string `json:"current_session_id"`
	}

	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := deleteOtherSessionsFromSupabase(body.AnilistID, body.CurrentSessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menghapus sesi lain."})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Perangkat lain berhasil di-logout."})
}
