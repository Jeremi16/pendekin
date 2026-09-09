package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"pendekin/config"
	"pendekin/db"
	"pendekin/link"
	mw "pendekin/middleware"
)

func main() {
	cfg := config.Load()

	pool := db.Pool(cfg)
	if pool != nil {
		defer db.Close()
		if err := db.EnsureSchema(pool); err != nil {
			log.Printf("[ERROR] ensureSchema: %v", err)
		} else {
			log.Println("[schema] ready")
		}
	} else {
		log.Println("[WARN] DATABASE_URL not set — running without DB (health only)")
	}

	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(mw.CORS(cfg.CorsOrigins))

	// Global timeout & body limit via handler
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req.Body = http.MaxBytesReader(w, req.Body, 16*1024) // 16kb for public create
			next.ServeHTTP(w, req)
		})
	})

	lh := &link.Handler{Pool: pool, Cfg: cfg}

	// Public API under /api prefix (handled explicitly, no strip middleware)
	r.Route("/api", func(r chi.Router) {
		r.Get("/health", lh.Health)
		r.Get("/ready", lh.Ready)
		// rate limit create
		limiter := mw.NewLimiter(60*time.Second, 5) // 5/min per IP
		r.With(limiter.Middleware).Post("/links", lh.CreateLink)
		r.With(limiter.Middleware).Post("/shorten", lh.CreateLink)
		r.Get("/links", lh.ListLinks)
		r.Get("/links/{code}/stats", lh.LinkStats)
	})

	// Also mount without /api for direct health checks
	r.Get("/health", lh.Health)
	r.Get("/ready", lh.Ready)

	// Redirect catch-all must be last (single segment)
	r.Get("/{code}", lh.Redirect)

	port := cfg.Port
	if port == "" {
		port = "5000"
	}
	// Allow PORT env to be set by Coolify/Docker
	if envPort := os.Getenv("PORT"); envPort != "" {
		port = envPort
	}
	addr := "0.0.0.0:" + port
	log.Printf("Server listening on %s (baseURL=%s)", addr, cfg.AppBaseURL)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}
