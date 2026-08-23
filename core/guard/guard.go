package guard

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"nimedesu/core/env"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func SecurityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		if path == "/" || path == "/health" || strings.HasPrefix(path, "/api/proxy-stream") {
			c.Next()
			return
		}

		if strings.HasPrefix(path, "/api/") {
			clientTimeStr := c.GetHeader("X-Client-Time")
			clientToken := c.GetHeader("X-Client-Token")

			if clientTimeStr == "" || clientToken == "" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Missing Security Headers"})
				return
			}

			reqTime, err := strconv.ParseInt(clientTimeStr, 10, 64)
			if err != nil || math.Abs(float64(time.Now().Unix()-reqTime)) > 30 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Token Expired"})
				return
			}

			expectedPayload := fmt.Sprintf("%d_%s", reqTime, env.Hash)
			hash := sha256.Sum256([]byte(expectedPayload))
			expectedToken := hex.EncodeToString(hash[:])

			if subtle.ConstantTimeCompare([]byte(expectedToken), []byte(clientToken)) != 1 {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied: Invalid Signature"})
				return
			}
		}
		c.Next()
	}
}
