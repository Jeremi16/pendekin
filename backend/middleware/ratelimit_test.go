package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.9:1234"
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	r.Header.Set("X-Real-IP", "1.2.3.4")
	if got := ClientIP(r); got != "203.0.113.9" {
		t.Errorf("public peer: spoofed header honored, got %s", got)
	}

	r.RemoteAddr = "172.18.0.3:5555" // docker nginx
	if got := ClientIP(r); got != "1.2.3.4" {
		t.Errorf("trusted proxy: got %s", got)
	}
}

func TestLimitChain(t *testing.T) {
	tier := NewTier("anon", 3, 4)
	perDay := tier.Day
	pick := func(r *http.Request) (*Tier, string) { return tier, ClientIP(r) }
	h := Limit(pick)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	codes := []int{}
	for i := 0; i < 4; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/", nil)
		req.RemoteAddr = "203.0.113.9:1"
		h.ServeHTTP(rec, req)
		codes = append(codes, rec.Code)
	}
	if codes[2] != 200 || codes[3] != 429 {
		t.Fatalf("codes %v", codes)
	}
	// The rejected request must not consume the daily quota.
	if q := perDay.Peek("203.0.113.9"); q.Remaining != 1 {
		t.Errorf("day remaining = %d, want 1", q.Remaining)
	}
}
