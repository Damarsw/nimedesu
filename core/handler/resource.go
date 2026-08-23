package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"nimedesu/core/provider"
	"strconv"

	"github.com/gin-gonic/gin"
)

func AnimeListHandler(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "12"))
	searchQuery := c.Query("q")
	statusQuery := c.Query("status")
	genreQuery := c.Query("genre")

	offset := (page - 1) * perPage

	query := fmt.Sprintf("select=id,title,url,status,genre,img_url,score,japanese,total_episodes,duration,release_date,studio&order=id.asc&offset=%d&limit=%d", offset, perPage)

	if searchQuery != "" {
		query += fmt.Sprintf("&title=ilike.*%s*", url.QueryEscape(searchQuery))
	}

	if statusQuery != "" {
		query += fmt.Sprintf("&status=eq.%s", url.QueryEscape(statusQuery))
	}

	if genreQuery != "" {
		query += fmt.Sprintf("&genre=ilike.*%s*", url.QueryEscape(genreQuery))
	}

	resp, err := provider.DataRequest("GET", "anime?"+query, nil, map[string]string{
		"Prefer": "count=exact",
	})
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}, "total_pages": 1})
		return
	}
	defer resp.Body.Close()

	var data []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)

	c.JSON(http.StatusOK, gin.H{
		"data":        data,
		"page":        page,
		"total_pages": 10,
	})
}
