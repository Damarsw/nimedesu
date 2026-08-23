package handler

import (
	"math"
	"net/http"
	"nimedesu/core/dto"
	"nimedesu/core/provider"
	"strconv"

	"github.com/gin-gonic/gin"
)

var BatchStoreInstance = &dto.BatchStore{}

func RankingHandler(c *gin.Context) {
	category := c.DefaultQuery("type", "bypopularity")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))

	BatchStoreInstance.RLock()
	var allMedia []dto.RankMedia
	switch category {
	case "upcoming":
		allMedia = BatchStoreInstance.Upcoming
	case "favorite":
		allMedia = BatchStoreInstance.Favorite
	default:
		allMedia = BatchStoreInstance.ByPopularity
	}
	BatchStoreInstance.RUnlock()

	if len(allMedia) == 0 {
		fetched, _ := provider.FetchAniListBatch(category)
		allMedia = fetched
	}

	top3 := make([]dto.RankMedia, 0)
	if len(allMedia) >= 3 {
		top3 = allMedia[:3]
	} else {
		top3 = allMedia
	}

	var pageMedia []dto.RankMedia
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
		pageMedia = []dto.RankMedia{}
	}

	totalItems := len(allMedia) - 3
	if totalItems < 1 {
		totalItems = 1
	}
	lastPage := int(math.Ceil(float64(totalItems) / 12.0))

	c.JSON(http.StatusOK, gin.H{
		"top3":      top3,
		"list":      pageMedia,
		"last_page": lastPage,
	})
}
