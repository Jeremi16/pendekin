// Package server assembles pendekin's HTTP router. It lives in its own package
// so both the standalone binary (main.go) and the Vercel function (api/index.go)
// can mount the exact same routes and middleware.
package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"pendekin/auth"
	"pendekin/config"
	"pendekin/link"
	mw "pendekin/middleware"
)

// New builds the full chi router. pool may be nil (health-only mode).
func New(cfg *config.Config, pool *pgxpool.Pool) http.Handler {
	// Vercel functions are only reachable through the platform's edge proxy.
	mw.SetTrustProxy(cfg.TrustProxy)
	if cfg.UpstashURL != "" && cfg.UpstashToken != "" {
		mw.SetCounterStore(mw.NewUpstashStore(cfg.UpstashURL, cfg.UpstashToken))
	}

	r := chi.NewRouter()
	// Client IP is resolved by mw.ClientIP (proxy-aware); chi's RealIP trusts spoofable headers.
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(mw.CORS(cfg.CorsOrigins))

	// Body limit
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req.Body = http.MaxBytesReader(w, req.Body, 16*1024) // 16kb for public create
			next.ServeHTTP(w, req)
		})
	})

	lh := &link.Handler{Pool: pool, Cfg: cfg}
	as := &auth.Service{Pool: pool}
	ns := &auth.Nodryx{Pool: pool, Cfg: cfg}
	as.Nodryx = ns
	r.Use(as.Middleware)

	// Public API under /api prefix (handled explicitly, no strip middleware)
	r.Route("/api", func(r chi.Router) {
		r.Get("/health", lh.Health)
		r.Get("/ready", lh.Ready)
		// Quota on link creation: anonymous by IP, logged-in by account (higher limits)
		anonTier := mw.NewTier("anonymous", cfg.LinksPerMin, cfg.LinksPerDay)
		userTier := mw.NewTier("account", cfg.UserPerMin, cfg.UserPerDay)
		pickTier := func(req *http.Request) (*mw.Tier, string) {
			if a := auth.FromContext(req.Context()); a != nil {
				return userTier, "account:" + strconv.FormatInt(a.ID, 10)
			}
			return anonTier, mw.ClientIP(req)
		}
		limit := mw.Limit(pickTier)
		r.With(limit).Post("/links", lh.CreateLink)
		r.With(limit).Post("/shorten", lh.CreateLink)
		// Read-only view of the caller's remaining quota (does not consume)
		r.Get("/quota", func(w http.ResponseWriter, req *http.Request) {
			tier, key := pickTier(req)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tier":   tier.Name,
				"minute": tier.Minute.Peek(key),
				"day":    tier.Day.Peek(key),
			})
		})

		// Accounts. Login is exclusively via Nodryx SSO.
		// Brute-force guard on the OAuth endpoints: 10/min, 100/day per IP.
		authTier := mw.NewTier("auth", 10, 100)
		authLimit := mw.Limit(func(req *http.Request) (*mw.Tier, string) { return authTier, mw.ClientIP(req) })
		r.With(authLimit).Get("/auth/nodryx/start", ns.Start)
		r.With(authLimit).Get("/auth/callback/nodryx", ns.Callback)
		r.With(authLimit).Get("/auth/nodryx/callback", ns.Callback) // legacy path
		r.Post("/auth/logout", as.Logout)
		r.Get("/auth/me", as.Me)
		r.With(auth.Require, authLimit).Get("/auth/nodryx/verify", ns.Verify)
		r.With(auth.Require, authLimit).Delete("/auth/account", as.DeleteAccount)

		// Dashboard (logged-in only). State-changing calls must be JSON (CSRF guard with SameSite=Lax).
		r.Route("/dashboard", func(r chi.Router) {
			r.Use(auth.Require, auth.RequireJSON)
			r.Get("/summary", lh.DashSummary)
			r.Get("/links", lh.DashLinks)
			r.Patch("/links/{id}", lh.PatchLink)
			r.Delete("/links/{id}", lh.DeleteLink)
			r.Post("/links/bulk", lh.BulkLinks)
			r.Get("/links/{id}/analytics", lh.LinkAnalytics)
			r.Post("/claim", lh.ClaimLinks)
		})
		r.Get("/links", lh.ListLinks)
		r.Get("/links/{code}/stats", lh.LinkStats)
	})

	// Also mount without /api for direct health checks
	r.Get("/health", lh.Health)
	r.Get("/ready", lh.Ready)

	// Redirect catch-all must be last (single segment)
	r.Get("/{code}", lh.Redirect)
	// Password-protected link unlock form (brute-force guard per IP)
	unlockTier := mw.NewTier("unlock", 10, 100)
	r.With(mw.Limit(func(req *http.Request) (*mw.Tier, string) { return unlockTier, mw.ClientIP(req) })).Post("/{code}", lh.Unlock)

	return r
}
