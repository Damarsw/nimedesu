package main

import (
	"log"
	"nimedesu/core/env"
	"nimedesu/core/guard"
	"nimedesu/core/handler"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	if env.SupabaseURL == "" || env.SupabaseKey == "" {
		log.Fatal("FATAL: SUPABASE_URL & SUPABASE_KEY must be set!")
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"https://nimedesu.vercel.app"},
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "X-Client-Token", "X-Client-Time", "X-Turnstile-Token"},
		AllowCredentials: true,
	}))

	r.Use(guard.SecurityMiddleware())

	r.GET("/api/anime", handler.AnimeListHandler)
	r.GET("/api/ranking", handler.RankingHandler)
	r.POST("/api/user-sync", handler.UserSyncHandler)

	log.Printf("Server running on port %s", env.Port)
	r.Run(":" + env.Port)
}
