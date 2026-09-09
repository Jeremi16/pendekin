package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

type bucket struct {
	count   int
	resetAt time.Time
}

type Limiter struct {
	mu         sync.Mutex
	buckets    map[string]*bucket
	window     time.Duration
	max        int
	maxEntries int
}

func NewLimiter(window time.Duration, max int) *Limiter {
	return &Limiter{
		buckets:    make(map[string]*bucket),
		window:     window,
		max:        max,
		maxEntries: 5000,
	}
}

func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := clientIP(r)
		now := time.Now()

		l.mu.Lock()
		// periodic cleanup: delete expired every 200 requests worth
		if len(l.buckets) > l.maxEntries {
			for k, b := range l.buckets {
				if now.After(b.resetAt) {
					delete(l.buckets, k)
				}
			}
			// if still over, evict oldest
			if len(l.buckets) > l.maxEntries {
				// simple truncate
				i := 0
				for k := range l.buckets {
					if i >= l.maxEntries {
						delete(l.buckets, k)
					}
					i++
				}
			}
		}

		b, ok := l.buckets[key]
		if !ok || now.After(b.resetAt) {
			b = &bucket{count: 0, resetAt: now.Add(l.window)}
			l.buckets[key] = b
		}
		retryAfter := int(time.Until(b.resetAt).Seconds()) + 1
		if retryAfter < 1 {
			retryAfter = 1
		}
		w.Header().Set("X-RateLimit-Limit", itoa(l.max))
		w.Header().Set("X-RateLimit-Reset", itoa(int(b.resetAt.Unix())))

		if b.count >= l.max {
			w.Header().Set("Retry-After", itoa(retryAfter))
			w.Header().Set("X-RateLimit-Remaining", "0")
			l.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(429)
			_, _ = w.Write([]byte(`{"error":"Too many requests"}`))
			return
		}
		b.count++
		w.Header().Set("X-RateLimit-Remaining", itoa(l.max-b.count))
		l.mu.Unlock()
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	host := r.RemoteAddr
	if idx := strings.LastIndex(host, ":"); idx != -1 {
		return host[:idx]
	}
	return host
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	buf := make([]byte, 0, 10)
	for i > 0 {
		buf = append([]byte{byte('0' + i%10)}, buf...)
		i /= 10
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}
