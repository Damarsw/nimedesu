package provider

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"nimedesu/core/dto"
	"nimedesu/core/env"
	"sync"
	"time"
)

var (
	LastAPICallTime      time.Time
	APICallMutex         sync.Mutex
	LastJikanCallTime    time.Time
	JikanCallMutex       sync.Mutex
	LocalCacheStore      = &dto.LocalCache{
		AnimeList: make(map[string]dto.CacheItem),
		ScoreMap:  make(map[string]string),
		DetailMap: make(map[string]dto.CacheItem),
	}
)

func ThrottleJikanCall() {
	JikanCallMutex.Lock()
	elapsed := time.Since(LastJikanCallTime)
	if elapsed < env.MinJikanCallInterval {
		time.Sleep(env.MinJikanCallInterval - elapsed)
	}
	LastJikanCallTime = time.Now()
	JikanCallMutex.Unlock()
}

func FetchAniListBatch(category string) ([]dto.RankMedia, error) {
	APICallMutex.Lock()
	elapsed := time.Since(LastAPICallTime)
	if elapsed < env.MinCallInterval {
		time.Sleep(env.MinCallInterval - elapsed)
	}
	LastAPICallTime = time.Now()
	APICallMutex.Unlock()

	var graphqlQuery string
	if category == "upcoming" {
		graphqlQuery = `{
			Page(page: 1, perPage: 100) {
				media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) {
					id title { romaji english userPreferred }
					coverImage { extraLarge large }
					averageScore popularity
				}
			}
		}`
	} else if category == "favorite" {
		graphqlQuery = `{
			Page(page: 1, perPage: 100) {
				media(type: ANIME, sort: SCORE_DESC) {
					id title { romaji english userPreferred }
					coverImage { extraLarge large }
					averageScore popularity
				}
			}
		}`
	} else {
		graphqlQuery = `{
			Page(page: 1, perPage: 100) {
				media(type: ANIME, sort: POPULARITY_DESC) {
					id title { romaji english userPreferred }
					coverImage { extraLarge large }
					averageScore popularity
				}
			}
		}`
	}

	reqBody, _ := json.Marshal(map[string]string{"query": graphqlQuery})
	req, _ := http.NewRequest("POST", "https://graphql.anilist.co", bytes.NewBuffer(reqBody))
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("anilist request error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data struct {
			Page struct {
				Media []dto.RankMedia `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("anilist decode error: %w", err)
	}
	return result.Data.Page.Media, nil
}

func FetchJikanBatch(category string) ([]dto.RankMedia, error) {
	filter := category
	if filter != "upcoming" && filter != "favorite" {
		filter = "bypopularity"
	}

	client := &http.Client{Timeout: 6 * time.Second}
	var combined []dto.RankMedia
	var lastErr error

	for page := 1; page <= 2; page++ {
		ThrottleJikanCall()

		jikanURL := fmt.Sprintf("https://api.jikan.moe/v4/top/anime?filter=%s&page=%d&limit=25", filter, page)
		req, _ := http.NewRequest("GET", jikanURL, nil)

		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("jikan request error (page %d): %w", page, err)
			break
		}

		if resp.StatusCode != 200 {
			lastErr = fmt.Errorf("jikan request failed (page %d): status %d", page, resp.StatusCode)
			resp.Body.Close()
			break
		}

		var res struct {
			Data []struct {
				MalID   int    `json:"mal_id"`
				Title   string `json:"title"`
				TitleEn string `json:"title_english"`
				Images  struct {
					JPG struct {
						LargeImageURL string `json:"large_image_url"`
					} `json:"jpg"`
				} `json:"images"`
				Score   float64 `json:"score"`
				Members int     `json:"members"`
			} `json:"data"`
		}

		decodeErr := json.NewDecoder(resp.Body).Decode(&res)
		resp.Body.Close()
		if decodeErr != nil {
			lastErr = fmt.Errorf("jikan decode error: %w", decodeErr)
			break
		}

		for _, item := range res.Data {
			english := item.TitleEn
			if english == "" {
				english = item.Title
			}
			combined = append(combined, dto.RankMedia{
				ID: item.MalID,
				Title: dto.RankTitle{
					Romaji:        item.Title,
					English:       english,
					UserPreferred: english,
				},
				CoverImage: dto.RankCover{
					ExtraLarge: item.Images.JPG.LargeImageURL,
					Large:      item.Images.JPG.LargeImageURL,
				},
				AverageScore: item.Score * 10,
				Popularity:   item.Members,
			})
		}
	}

	if len(combined) == 0 {
		return nil, lastErr
	}
	return combined, nil
}
