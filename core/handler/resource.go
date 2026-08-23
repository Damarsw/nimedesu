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

	offset := (page - 1) * perPage
	query := fmt.Sprintf("select=id,title,url,status,genre,img_url&order=id.asc&offset=%d&limit=%d", offset, perPage)
	if searchQuery != "" {
		query += fmt.Sprintf("&title=ilike.*%s*", url.QueryEscape(searchQuery))
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
