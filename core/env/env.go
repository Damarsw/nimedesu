package env

import (
	"os"
	"time"
)

var (
	Core                 = os.Getenv("CORE")
	Token                = os.Getenv("TOKEN")
	Hash                 = os.Getenv("HASH")
	Port                 = getEnvOrDefault("PORT", "10000")
	Auth                 = os.Getenv("AUTH")
	MinCallInterval      = 2000 * time.Millisecond
	MinJikanCallInterval = 1200 * time.Millisecond
	CacheTTLAnime        = int64(86400)
)

func getEnvOrDefault(key, defaultValue string) string {
	val := os.Getenv(key)
	if val == "" {
		return defaultValue
	}
	return val
}
