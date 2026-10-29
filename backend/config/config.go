package config

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port        string
	DatabaseURL string
	AppBaseURL  string
	AppSecret   string
	CorsOrigins []string
	MaxTTL_Days int
	LinksPerMin int
	LinksPerDay int
	UserPerMin  int
	UserPerDay  int
	// TrustProxy makes ClientIP honor X-Forwarded-For/X-Real-IP unconditionally.
	// Enable only when the server is reachable exclusively through a trusted
	// proxy (e.g. Vercel functions), never on direct public exposure.
	TrustProxy bool
	// Upstash Redis REST credentials: when both are set, rate-limit counters
	// are stored in Redis instead of in-process memory (required serverless).
	UpstashURL   string
	UpstashToken string
	// DBMaxConns caps the pgx pool. Keep small on serverless (each warm
	// instance holds its own pool against Neon's connection limit).
	DBMaxConns int
	// Nodryx SSO (OAuth2 authorization code + PKCE S256, confidential client).
	// Login is enabled only when all three are set. The secret never leaves the
	// server — it must never be exposed to the browser bundle.
	NodryxAuthURL      string
	NodryxClientID     string
	NodryxClientSecret string

	// Optional Google Safe Browsing API key; when set, destinations are checked
	// for malware/phishing on create and edit.
	SafeBrowsingKey string
}

// NodryxEnabled reports whether SSO login is fully configured.
func (c *Config) NodryxEnabled() bool {
	return c.NodryxAuthURL != "" && c.NodryxClientID != "" && c.NodryxClientSecret != ""
}

func Load() *Config {
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	port := envOr("PORT", "5000")
	dbURL := os.Getenv("DATABASE_URL")
	// APP_URL is the public origin used to build the OAuth redirect_uri
	// (APP_BASE_URL is kept as a fallback for existing deployments).
	baseURL := strings.TrimRight(os.Getenv("APP_URL"), "/")
	if baseURL == "" {
		baseURL = strings.TrimRight(os.Getenv("APP_BASE_URL"), "/")
	}
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
		Port:         port,
		DatabaseURL:  dbURL,
		AppBaseURL:   baseURL,
		AppSecret:    secret,
		CorsOrigins:  origins,
		MaxTTL_Days:  90,
		LinksPerMin:  envInt("RATE_LIMIT_PER_MIN", 5),
		LinksPerDay:  envInt("RATE_LIMIT_PER_DAY", 50),
		UserPerMin:   envInt("USER_RATE_LIMIT_PER_MIN", 20),
		UserPerDay:   envInt("USER_RATE_LIMIT_PER_DAY", 500),
		TrustProxy:   os.Getenv("TRUST_PROXY") == "1" || strings.EqualFold(os.Getenv("TRUST_PROXY"), "true"),
		UpstashURL:   os.Getenv("UPSTASH_REDIS_REST_URL"),
		UpstashToken: os.Getenv("UPSTASH_REDIS_REST_TOKEN"),
		DBMaxConns:   envInt("DB_MAX_CONNS", 8),
		NodryxAuthURL:      strings.TrimRight(os.Getenv("NODRYX_AUTH_URL"), "/"),
		NodryxClientID:     os.Getenv("NODRYX_CLIENT_ID"),
		NodryxClientSecret: os.Getenv("NODRYX_CLIENT_SECRET"),
		SafeBrowsingKey:    os.Getenv("SAFE_BROWSING_API_KEY"),
	}
}

func envOr(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}

func envInt(k string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return fallback
}
