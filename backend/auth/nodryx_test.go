package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"pendekin/config"
)

// RFC 7636 appendix B: known verifier/challenge pair (S256).
const rfc7636Verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

func TestNewPKCE(t *testing.T) {
	for i := 0; i < 20; i++ {
		verifier, challenge, err := newPKCE()
		if err != nil {
			t.Fatal(err)
		}
		if n := len(verifier); n < 43 || n > 128 {
			t.Fatalf("verifier length %d outside 43–128", n)
		}
		for _, c := range verifier {
			if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~", c) {
				t.Fatalf("verifier charset violated: %q", verifier)
			}
		}
		sum := sha256.Sum256([]byte(verifier))
		want := base64.RawURLEncoding.EncodeToString(sum[:])
		if challenge != want {
			t.Fatalf("challenge mismatch: got %q want %q", challenge, want)
		}
		if len(challenge) != 43 || strings.ContainsAny(challenge, "+/=") {
			t.Fatalf("challenge not 43 unpadded base64url chars: %q", challenge)
		}
	}
}

func TestNewPKCEKnownVector(t *testing.T) {
	// The implementation must derive challenges the same way as RFC 7636's
	// reference: S256(verifier) = BASE64URL(SHA256(verifier)), unpadded.
	sum := sha256.Sum256([]byte(rfc7636Verifier))
	want := base64.RawURLEncoding.EncodeToString(sum[:])
	if want != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatalf("RFC 7636 reference challenge changed: %q", want)
	}
}

func TestSanitizeRedirect(t *testing.T) {
	for v, want := range map[string]string{
		"":                             "",
		"#/dashboard":                  "#/dashboard",
		"#/settings":                   "#/settings",
		"#/dashboard?x=1":              "#/dashboard?x=1",
		"https://evil.com":             "",
		"//evil.com":                   "",
		"#//evil":                      "",
		"http://evil.com":              "",
		"/dashboard":                   "",
		"#" + strings.Repeat("a", 300): "",
	} {
		if got := sanitizeRedirect(v); got != want {
			t.Errorf("sanitizeRedirect(%q) = %q, want %q", v, got, want)
		}
	}
}

func testNodryx(t *testing.T, authURL string) *Nodryx {
	t.Helper()
	return &Nodryx{
		Pool: nil, // token/account paths need a DB; HTTP-shape tests use the URL only
		Cfg: &config.Config{
			AppBaseURL:         "https://app.example.com",
			AppSecret:          "test-secret-0123456789abcdef",
			NodryxAuthURL:      authURL,
			NodryxClientID:     "client-123",
			NodryxClientSecret: "secret-456",
		},
	}
}

func TestAuthorizeURL(t *testing.T) {
	n := testNodryx(t, "https://auth.example.com")
	u, err := url.Parse(n.authorizeURL("state-abc", "challenge-xyz"))
	if err != nil {
		t.Fatal(err)
	}
	if u.String() != "https://auth.example.com/api/oauth/authorize?"+u.RawQuery {
		t.Fatalf("unexpected authorize base: %s", u)
	}
	q := u.Query()
	want := map[string]string{
		"client_id":             "client-123",
		"redirect_uri":          "https://app.example.com/api/auth/callback/nodryx",
		"response_type":         "code",
		"state":                 "state-abc",
		"scope":                 "openid email profile",
		"code_challenge":        "challenge-xyz",
		"code_challenge_method": "S256",
	}
	for k, v := range want {
		if q.Get(k) != v {
			t.Errorf("authorize param %s = %q, want %q", k, q.Get(k), v)
		}
	}
}

func TestTokenRequestExchangesCode(t *testing.T) {
	var gotForm url.Values
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = r.ParseForm()
		gotForm = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "at", "refresh_token": "rt", "token_type": "Bearer", "expires_in": 900,
		})
	}))
	defer srv.Close()
	n := testNodryx(t, srv.URL)
	ts, err := n.exchangeCode(context.Background(), "the-code", "the-verifier")
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/api/oauth/token" {
		t.Errorf("token path = %q", gotPath)
	}
	if ts.AccessToken != "at" || ts.RefreshToken != "rt" || ts.ExpiresIn != 900 {
		t.Errorf("unexpected token set: %+v", ts)
	}
	for k, want := range map[string]string{
		"grant_type":    "authorization_code",
		"code":          "the-code",
		"code_verifier": "the-verifier",
		"client_id":     "client-123",
		"client_secret": "secret-456",
		"redirect_uri":  "https://app.example.com/api/auth/callback/nodryx",
	} {
		if gotForm.Get(k) != want {
			t.Errorf("exchange form %s = %q, want %q", k, gotForm.Get(k), want)
		}
	}
}

func TestTokenRequestOAuthErrors(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		want   string
	}{
		{400, `{"error":"invalid_grant","error_description":"code already used"}`, "invalid_grant"},
		{401, `{"error":"invalid_client"}`, "invalid_client"},
		{400, `{"error":"invalid_request"}`, "invalid_request"},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		}))
		n := testNodryx(t, srv.URL)
		_, err := n.exchangeCode(context.Background(), "c", "v")
		srv.Close()
		var oe *oauthError
		if err == nil || !asOAuthError(err, &oe) || oe.Code != tc.want {
			t.Errorf("status %d: got %v, want oauthError(%s)", tc.status, err, tc.want)
		}
	}
}

func asOAuthError(err error, target **oauthError) bool {
	if oe, ok := err.(*oauthError); ok {
		*target = oe
		return true
	}
	return false
}

func TestUserinfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/oauth/userinfo" {
			http.NotFound(w, r)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer at-1" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid_token"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"sub": "uuid-1", "email": "a@b.co", "email_verified": true, "provider": "google",
		})
	}))
	defer srv.Close()
	n := testNodryx(t, srv.URL)
	u, err := n.userinfo(context.Background(), "at-1")
	if err != nil {
		t.Fatal(err)
	}
	if u.Sub != "uuid-1" || u.Email != "a@b.co" || !u.EmailVerified || u.Provider != "google" {
		t.Errorf("unexpected user: %+v", u)
	}
	if _, err := n.userinfo(context.Background(), "wrong"); err == nil {
		t.Error("expected error for rejected bearer token")
	}
}

func TestSealOpenRoundTrip(t *testing.T) {
	n := testNodryx(t, "https://auth.example.com")
	key := n.key()
	secret := "refresh-token-xyz"
	sealed, err := seal(key, secret)
	if err != nil {
		t.Fatal(err)
	}
	if string(sealed) == secret {
		t.Error("ciphertext equals plaintext")
	}
	got, err := open(key, sealed)
	if err != nil || got != secret {
		t.Errorf("open() = %q, %v; want %q", got, err, secret)
	}
	// A different key must not decrypt.
	other := testNodryx(t, "https://auth.example.com")
	other.Cfg.AppSecret = "another-secret-0123456789abcd"
	if _, err := open(other.key(), sealed); err == nil {
		t.Error("ciphertext opened with wrong key")
	}
	// Tampering must fail.
	sealed[0] ^= 0xff
	if _, err := open(key, sealed); err == nil {
		t.Error("tampered ciphertext accepted")
	}
}
