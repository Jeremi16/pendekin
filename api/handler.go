// pendekin on Vercel: the entire chi router is mounted as one Go serverless
// function. vercel.json rewrites /api/*, /health, /ready and /{code} to this
// function, passing the original path through query params (see Handler).
package main

import (
	"log"
	"net/http"
	"regexp"

	"pendekin/config"
	"pendekin/db"
	"pendekin/server"
)

var handler http.Handler

func init() {
	cfg := config.Load()
	pool := db.Pool(cfg)
	if pool != nil {
		// Idempotent; runs once per cold start.
		if err := db.EnsureSchema(pool); err != nil {
			log.Printf("[ERROR] ensureSchema: %v", err)
		}
	}
	handler = server.New(cfg, pool)
}

var codeRe = regexp.MustCompile(`^[A-Za-z0-9_-]{4,32}$`)

// Handler is the Vercel entrypoint. The original request path arrives via
// query params set by vercel.json rewrites; a user could forge those by
// calling the function route directly, so they are validated before use.
func Handler(w http.ResponseWriter, r *http.Request) {
	if p := r.URL.Query().Get("__path"); p == "/health" || p == "/ready" || (len(p) >= 5 && p[:5] == "/api/") {
		r.URL.Path = p
	} else if c := r.URL.Query().Get("code"); codeRe.MatchString(c) {
		r.URL.Path = "/" + c
	}
	handler.ServeHTTP(w, r)
}
