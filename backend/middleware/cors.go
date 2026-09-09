package middleware

import (
	"net/http"
	"net/url"
	"strings"
)

// Exact host match, not substring. Supports patterns like "localhost", "example.com", "*.example.com"
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			if isAllowed(origin, allowedOrigins) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(204)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isAllowed(origin string, allowed []string) bool {
	if len(allowed) == 0 {
		// Default: allow all in public mode? keep permissive for shortener
		// But for safety allow only if origin parses; public create should be allowed from any site
		// For now allow all when no config
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, pat := range allowed {
		p := strings.ToLower(strings.TrimSpace(pat))
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "*.") {
			suffix := p[2:]
			if host == suffix || strings.HasSuffix(host, "."+suffix) {
				return true
			}
		} else if host == p {
			return true
		}
	}
	return false
}
