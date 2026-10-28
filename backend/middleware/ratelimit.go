package middleware

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// CounterStore persists fixed-window counters. Take must be atomic: it
// increments the counter for key and returns the value AFTER the increment
// together with the window's reset time; the window starts at the first
// increment. Peek reads the same state without creating or incrementing.
type CounterStore interface {
	Take(key string, window time.Duration, now time.Time) (count int, resetAt time.Time, err error)
	Peek(key string, window time.Duration, now time.Time) (count int, resetAt time.Time, err error)
}

var (
	storeMu     sync.RWMutex
	globalStore CounterStore = NewMemoryStore()
)

// SetCounterStore swaps the store used by future limiters. Call once at
// startup, before any Limiter is created (server.New does this for Upstash).
func SetCounterStore(s CounterStore) {
	storeMu.Lock()
	globalStore = s
	storeMu.Unlock()
}

func currentStore() CounterStore {
	storeMu.RLock()
	defer storeMu.RUnlock()
	return globalStore
}

// memoryStore is the in-process store used by default (single-binary deploys
// and tests). Buckets are evicted lazily once the map grows too large.
type memoryStore struct {
	mu         sync.Mutex
	buckets    map[string]*bucket
	maxEntries int
}

type bucket struct {
	count   int
	resetAt time.Time
}

// NewMemoryStore returns an in-process CounterStore.
func NewMemoryStore() CounterStore {
	return &memoryStore{buckets: make(map[string]*bucket), maxEntries: 5000}
}

func (m *memoryStore) current(key string, window time.Duration, now time.Time) *bucket {
	if len(m.buckets) > m.maxEntries {
		for k, b := range m.buckets {
			if now.After(b.resetAt) {
				delete(m.buckets, k)
			}
		}
	}
	b, ok := m.buckets[key]
	if !ok || now.After(b.resetAt) {
		b = &bucket{resetAt: now.Add(window)}
		m.buckets[key] = b
	}
	return b
}

func (m *memoryStore) Take(key string, window time.Duration, now time.Time) (int, time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b := m.current(key, window, now)
	b.count++
	return b.count, b.resetAt, nil
}

func (m *memoryStore) Peek(key string, window time.Duration, now time.Time) (int, time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b := m.current(key, window, now)
	return b.count, b.resetAt, nil
}

// Limiter is a fixed-window counter of max units per window, backed by a
// CounterStore. When the store errors (e.g. Redis unreachable) the limiter
// fails open: requests are allowed and the failure is logged.
type Limiter struct {
	ns     string // isolates this limiter's keys from every other limiter's
	store  CounterStore
	window time.Duration
	max    int
}

var limiterSeq uint64

func newLimiter(ns string, window time.Duration, max int) *Limiter {
	return &Limiter{ns: ns, store: currentStore(), window: window, max: max}
}

// NewLimiter creates an isolated limiter with a unique in-process namespace.
func NewLimiter(window time.Duration, max int) *Limiter {
	return newLimiter(fmt.Sprintf("limiter-%d", atomic.AddUint64(&limiterSeq, 1)), window, max)
}

func (l *Limiter) storeKey(key string) string {
	return l.ns + "|" + key
}

// Quota is the state of one window for one client.
type Quota struct {
	Limit     int       `json:"limit"`
	Remaining int       `json:"remaining"`
	ResetAt   time.Time `json:"resetAt"`
}

func (l *Limiter) failOpen() Quota {
	return Quota{Limit: l.max, Remaining: l.max, ResetAt: time.Now().Add(l.window)}
}

// Peek reports the quota for key without consuming it.
func (l *Limiter) Peek(key string) Quota {
	count, resetAt, err := l.store.Peek(l.storeKey(key), l.window, time.Now())
	if err != nil {
		log.Printf("[WARN] rate limit peek failed, allowing: %v", err)
		return l.failOpen()
	}
	return Quota{Limit: l.max, Remaining: max(l.max-count, 0), ResetAt: resetAt}
}

// Take consumes one unit if available.
func (l *Limiter) Take(key string) (Quota, bool) {
	count, resetAt, err := l.store.Take(l.storeKey(key), l.window, time.Now())
	if err != nil {
		log.Printf("[WARN] rate limit take failed, allowing: %v", err)
		return l.failOpen(), true
	}
	if count > l.max {
		return Quota{Limit: l.max, Remaining: 0, ResetAt: resetAt}, false
	}
	return Quota{Limit: l.max, Remaining: l.max - count, ResetAt: resetAt}, true
}

// Tier is a set of windows (e.g. per-minute and per-day) applied to one kind of client.
type Tier struct {
	Name     string
	Minute   *Limiter
	Day      *Limiter
	limiters []*Limiter
}

func NewTier(name string, perMin, perDay int) *Tier {
	// Deterministic namespaces keep buckets separate per tier+window and
	// identical across restarts/instances — required for a shared Redis.
	t := &Tier{Name: name,
		Minute: newLimiter(name+"/minute", time.Minute, perMin),
		Day:    newLimiter(name+"/day", 24*time.Hour, perDay)}
	t.limiters = []*Limiter{t.Minute, t.Day}
	return t
}

// TierPicker chooses the tier and bucket key for a request.
type TierPicker func(r *http.Request) (*Tier, string)

// Limit enforces the picked tier. A request must fit in every window; units are
// only consumed when all windows have room.
func Limit(pick TierPicker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tier, key := pick(r)
			limiters := tier.limiters
			for _, l := range limiters {
				if q := l.Peek(key); q.Remaining == 0 {
					tooMany(w, q)
					return
				}
			}
			var tightest Quota
			for i, l := range limiters {
				q, ok := l.Take(key)
				if !ok { // lost a race with a concurrent request
					tooMany(w, q)
					return
				}
				if i == 0 || q.Remaining < tightest.Remaining {
					tightest = q
				}
			}
			setHeaders(w, tightest)
			next.ServeHTTP(w, r)
		})
	}
}

func setHeaders(w http.ResponseWriter, q Quota) {
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(q.Limit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(q.Remaining))
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(q.ResetAt.Unix(), 10))
}

func tooMany(w http.ResponseWriter, q Quota) {
	retryAfter := int(time.Until(q.ResetAt).Seconds()) + 1
	setHeaders(w, q)
	w.Header().Set("Retry-After", strconv.Itoa(max(retryAfter, 1)))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"error":"Too many requests","retryAfter":` + strconv.Itoa(max(retryAfter, 1)) + `}`))
}

var trustProxyEnabled = false // set once at startup via SetTrustProxy

// SetTrustProxy makes ClientIP honor X-Forwarded-For/X-Real-IP unconditionally.
// Enable only when the server is reachable exclusively through a trusted proxy
// (e.g. Vercel functions) — on direct public exposure the headers are spoofable.
func SetTrustProxy(v bool) {
	trustProxyEnabled = v
}

// ClientIP returns the peer address. By default X-Real-IP is only honored when
// the peer is a private/loopback address (i.e. our own reverse proxy), so
// clients can't spoof it. With SetTrustProxy(true), the proxy headers are
// always honored (X-Forwarded-For first hop, then X-Real-IP).
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if trustProxyEnabled {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if first := strings.TrimSpace(strings.Split(xff, ",")[0]); net.ParseIP(first) != nil {
				return first
			}
		}
		if real := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(real) != nil {
			return real
		}
		return host
	}
	if peer := net.ParseIP(host); peer != nil && (peer.IsLoopback() || peer.IsPrivate()) {
		if real := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(real) != nil {
			return real
		}
	}
	return host
}
