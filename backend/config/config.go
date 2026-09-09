package config

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port         string
	DatabaseURL  string
	AppBaseURL   string
	AppSecret    string
	CorsOrigins  []string
	MaxTTL_Days  int
}

func Load() *Config {
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	port := envOr("PORT", "5000")
	dbURL := os.Getenv("DATABASE_URL")
	baseURL := strings.TrimRight(os.Getenv("APP_BASE_URL"), "/")
	secret := os.Getenv("APP_SECRET")
	corsRaw := os.Getenv("CORS_ORIGINS")

	if secret == "" || secret == "replace_with_a_long_random_secret" || secret == "qr-shortener" || len(secret) < 16 {
		// Generate ephemeral secret if not set, but warn. In production APP_SECRET must be set.
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		secret = hex.EncodeToString(b)
		log.Println("[WARN] APP_SECRET not set or too weak — generated ephemeral secret. Set APP_SECRET=32+ hex chars in .env for persistent IP hashing.")
	}

	var origins []string
	if corsRaw != "" {
		for _, p := range strings.Split(corsRaw, ",") {
			if s := strings.TrimSpace(p); s != "" {
				origins = append(origins, s)
			}
		}
	}

	return &Config{
		Port:        port,
		DatabaseURL: dbURL,
		AppBaseURL:  baseURL,
		AppSecret:   secret,
		CorsOrigins: origins,
		MaxTTL_Days: 90,
	}
}

func envOr(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
