package env

import (
	"os"
	"time"
)

var (
	SupabaseURL          = os.Getenv("SUPABASE_URL")
	SupabaseKey          = os.Getenv("SUPABASE_KEY")
	SecretServerKey      = os.Getenv("SECRET_SERVER_KEY")
	Port                 = getEnvOrDefault("PORT", "10000")
	TurnstileSecret      = os.Getenv("TURNSTILE_SECRET_KEY")
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
