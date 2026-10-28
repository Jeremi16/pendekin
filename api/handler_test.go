package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The DB-less code paths must work through the adapter's path restoration.
func TestHandlerPathRestoration(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantBody   string
	}{
		{"api health via __path", "?__path=/api/health", http.StatusOK, `"ok":true`},
		{"root health via __path", "?__path=/health", http.StatusOK, `"ok":true`},
		{"forged path ignored", "?__path=/etc/passwd", http.StatusNotFound, ""},
		{"direct call is 404", "", http.StatusNotFound, ""},
		{"bad code rejected", "?code=..%2Fetc", http.StatusNotFound, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/handler"+tc.query, nil)
			rec := httptest.NewRecorder()
			Handler(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if tc.wantBody != "" && !strings.Contains(rec.Body.String(), tc.wantBody) {
				t.Fatalf("body %q missing %q", rec.Body.String(), tc.wantBody)
			}
		})
	}
}

// With the real DATABASE_URL, a valid-looking unknown code renders the not-found page.
func TestHandlerUnknownCode(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/handler?code=zz9xqq", nil)
	rec := httptest.NewRecorder()
	Handler(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for unknown code", rec.Code)
	}
}
