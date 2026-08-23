package dto

import "sync"

type TurnstileResponse struct {
	Success     bool     `json:"success"`
	ErrorCodes  []string `json:"error-codes"`
	ChallengeTS string   `json:"challenge_ts"`
	Hostname    string   `json:"hostname"`
}

type BatchStore struct {
	sync.RWMutex
	ByPopularity       []RankMedia `json:"bypopularity"`
	Upcoming           []RankMedia `json:"upcoming"`
	Favorite           []RankMedia `json:"favorite"`
	LastUpdated        int64       `json:"last_updated"`
	SourceByPopularity string      `json:"-"`
	SourceUpcoming     string      `json:"-"`
	SourceFavorite     string      `json:"-"`
}

type RankMedia struct {
	ID           int       `json:"id"`
	Title        RankTitle `json:"title"`
	CoverImage   RankCover `json:"coverImage"`
	AverageScore float64   `json:"averageScore"`
	Popularity   int       `json:"popularity"`
}

type RankTitle struct {
	Romaji        string `json:"romaji"`
	English       string `json:"english"`
	UserPreferred string `json:"userPreferred"`
}

type RankCover struct {
	ExtraLarge string `json:"extraLarge"`
	Large      string `json:"large"`
}

type LocalCache struct {
	sync.RWMutex
	AnimeList map[string]CacheItem
	ScoreMap  map[string]string
	DetailMap map[string]CacheItem
}

type CacheItem struct {
	Timestamp int64
	Data      interface{}
}

type ExternalAnimeMetadata struct {
	Synopsis    string `json:"synopsis"`
	Japanese    string `json:"japanese"`
	Score       string `json:"score"`
	Status      string `json:"status"`
	TotalEp     string `json:"total_episodes"`
	Duration    string `json:"duration"`
	ReleaseDate string `json:"release_date"`
	Studio      string `json:"studio"`
	CoverImg    string `json:"cover_img"`
}

type UserSyncRequest struct {
	AnilistID        string `json:"anilist_id"`
	SessionID        string `json:"session_id"`
	CookiesEncrypted string `json:"cookies_encrypted"`
}

type LogoutOthersRequest struct {
	AnilistID        string `json:"anilist_id"`
	CurrentSessionID string `json:"current_session_id"`
}
