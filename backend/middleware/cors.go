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
			// Session cookies are only shared with explicitly allowlisted origins;
			// the unconfigured wildcard never allows credentials.
			if len(allowedOrigins) == 0 {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if isAllowed(origin, allowedOrigins) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After")
			if r.Method == http.MethodOptions {
				w.WriteHeader(204)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isAllowed(origin string, allowed []string) bool {
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
