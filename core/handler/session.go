package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"nimedesu/core/dto"
	"nimedesu/core/provider"

	"github.com/gin-gonic/gin"
)

func UserSyncHandler(c *gin.Context) {
	var body dto.UserSyncRequest
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := provider.DataRequest("GET", fmt.Sprintf("login?anilist_id=eq.%s", url.QueryEscape(body.AnilistID)), nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}
