package provider

import (
	"bytes"
	"fmt"
	"net/http"
	"nimedesu/core/env"
	"strings"
	"time"
)

func SupabaseRequest(method, endpoint string, body []byte, headers map[string]string) (*http.Response, error) {
	reqURL := fmt.Sprintf("%s/rest/v1/%s", strings.TrimRight(env.SupabaseURL, "/"), endpoint)
	req, err := http.NewRequest(method, reqURL, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("apikey", env.SupabaseKey)
	req.Header.Set("Authorization", "Bearer "+env.SupabaseKey)
	req.Header.Set("Content-Type", "application/json")

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	return client.Do(req)
}
