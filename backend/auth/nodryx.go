package auth

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"pendekin/config"
)

// Nodryx SSO login: OAuth2 authorization code + PKCE S256 with a confidential
// client. Nodryx exposes no discovery document and no id_token, so the flow is
// configured manually against these fixed endpoints:
//
//	GET  {AUTH}/api/oauth/authorize   (browser redirect)
//	POST {AUTH}/api/oauth/token       (code exchange / refresh, server-side only)
//	GET  {AUTH}/api/oauth/userinfo    (profile, Bearer access token)
//	POST {AUTH}/api/logout            (revokes a refresh token)
//
// The client secret lives only in env on the server; nothing here is reachable
// from the browser bundle.
const (
	nodryxScope   = "openid email profile"
	nodryxFlowTTL = 10 * time.Minute
)

// Nodryx handles the SSO flow. Both fields are wired in server.New.
type Nodryx struct {
	Pool *pgxpool.Pool
	Cfg  *config.Config

	// HTTP defaults to a client with a 10s timeout. Tests may swap it.
	HTTP *http.Client
}

func (n *Nodryx) client() *http.Client {
	if n.HTTP != nil {
		return n.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second}
}

// ready reports whether the flow can run: configured credentials and a database.
func (n *Nodryx) ready() bool {
	return n.Pool != nil && n.Cfg != nil && n.Cfg.NodryxEnabled()
}

func (n *Nodryx) redirectURI() string {
	return n.Cfg.AppBaseURL + "/api/auth/callback/nodryx"
}

// ---------------------------------------------------------------------------
// PKCE (S256) and state helpers
// ---------------------------------------------------------------------------

// newPKCE returns a verifier (86 base64url chars — inside the required 43–128
// range and [A-Za-z0-9\-._~] alphabet) and its S256 challenge:
// BASE64URL(SHA256(verifier)) without padding.
func newPKCE() (verifier, challenge string, err error) {
	b := make([]byte, 64)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// sanitizeRedirect keeps only in-app hash routes (e.g. "#/dashboard") so the
// login flow can't be used as an open redirect.
func sanitizeRedirect(v string) string {
	if v == "" || len(v) > 256 {
		return ""
	}
	if strings.HasPrefix(v, "#/") && !strings.Contains(v, "//") {
		return v
	}
	return ""
}

func (n *Nodryx) authorizeURL(state, challenge string) string {
	q := url.Values{}
	q.Set("client_id", n.Cfg.NodryxClientID)
	q.Set("redirect_uri", n.redirectURI())
	q.Set("response_type", "code")
	q.Set("state", state)
	q.Set("scope", nodryxScope)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	return n.Cfg.NodryxAuthURL + "/api/oauth/authorize?" + q.Encode()
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Start begins the login flow: store state+verifier server-side, then redirect
// the browser to Nodryx's authorize endpoint.
func (n *Nodryx) Start(w http.ResponseWriter, r *http.Request) {
	if !n.ready() {
		n.errorPage(w, r, http.StatusServiceUnavailable, "Login unavailable", "Single sign-on is not configured on this deployment.")
		return
	}
	state, err := randomHex(32)
	if err != nil {
		n.errorPage(w, r, http.StatusInternalServerError, "Something went wrong", "Could not create the login session. Please try again.")
		return
	}
	verifier, challenge, err := newPKCE()
	if err != nil {
		n.errorPage(w, r, http.StatusInternalServerError, "Something went wrong", "Could not create the login session. Please try again.")
		return
	}
	redirectTo := sanitizeRedirect(r.URL.Query().Get("redirect_to"))
	// Housekeeping: drop expired flows.
	_, _ = n.Pool.Exec(r.Context(), `DELETE FROM oauth_flows WHERE expires_at <= NOW()`)
	if _, err := n.Pool.Exec(r.Context(),
		`INSERT INTO oauth_flows (state, code_verifier, redirect_to, expires_at) VALUES ($1, $2, $3, $4)`,
		state, verifier, redirectTo, time.Now().Add(nodryxFlowTTL)); err != nil {
		log.Printf("[ERROR] nodryx start: %v", err)
		n.errorPage(w, r, http.StatusInternalServerError, "Something went wrong", "Could not create the login session. Please try again.")
		return
	}
	http.Redirect(w, r, n.authorizeURL(state, challenge), http.StatusFound)
}

var errEmailNotVerified = errors.New("nodryx email not verified")

// Callback finishes the login flow: validate state (single-use), exchange the
// code server-side, resolve the account, issue the session cookie and store the
// Nodryx token chain.
func (n *Nodryx) Callback(w http.ResponseWriter, r *http.Request) {
	if !n.ready() {
		n.errorPage(w, r, http.StatusServiceUnavailable, "Login unavailable", "Single sign-on is not configured on this deployment.")
		return
	}
	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		desc := q.Get("error_description")
		if desc == "" {
			desc = "The login was cancelled or rejected by Nodryx."
		}
		n.errorPage(w, r, http.StatusBadRequest, "Login was not completed", desc)
		return
	}
	code, state := q.Get("code"), q.Get("state")
	if code == "" || state == "" {
		n.errorPage(w, r, http.StatusBadRequest, "Invalid login callback", "The login response was missing required parameters. Please log in again.")
		return
	}
	// State must match a stored flow; the row is consumed immediately so a
	// state (and its code) can only ever be used once.
	var verifier, redirectTo string
	err := n.Pool.QueryRow(r.Context(),
		`DELETE FROM oauth_flows WHERE state = $1 AND expires_at > NOW() RETURNING code_verifier, redirect_to`,
		state).Scan(&verifier, &redirectTo)
	if errors.Is(err, pgx.ErrNoRows) {
		n.errorPage(w, r, http.StatusBadRequest, "Login session expired", "This login attempt is no longer valid — it may have expired or already been used. Please log in again.")
		return
	}
	if err != nil {
		log.Printf("[ERROR] nodryx callback state lookup: %v", err)
		n.errorPage(w, r, http.StatusInternalServerError, "Something went wrong", "Please try logging in again.")
		return
	}

	tokens, err := n.exchangeCode(r.Context(), code, verifier)
	if err != nil {
		var oe *oauthError
		if errors.As(err, &oe) {
			// The code is single-use: never retry, start a fresh authorize.
			log.Printf("[WARN] nodryx token exchange: %s", oe.Code)
			n.errorPage(w, r, http.StatusBadRequest, "Login failed", "Nodryx rejected this login attempt ("+oe.Code+"). The code may have expired or already been used — please log in again.")
			return
		}
		log.Printf("[ERROR] nodryx token exchange: %v", err)
		n.errorPage(w, r, http.StatusBadGateway, "Could not reach Nodryx", "The login service did not respond correctly. Please try again in a moment.")
		return
	}
	user, err := n.userinfo(r.Context(), tokens.AccessToken)
	if err != nil {
		log.Printf("[ERROR] nodryx userinfo: %v", err)
		n.errorPage(w, r, http.StatusBadGateway, "Could not reach Nodryx", "Your profile could not be loaded. Please try logging in again.")
		return
	}
	if user.Sub == "" || !validEmail(user.Email) {
		n.errorPage(w, r, http.StatusBadRequest, "Incomplete profile", "Your Nodryx account does not expose a usable email address. Please check your Nodryx account settings.")
		return
	}
	accountID, err := n.upsertIdentity(r.Context(), user)
	if err != nil {
		if errors.Is(err, errEmailNotVerified) {
			n.errorPage(w, r, http.StatusForbidden, "Email not verified", "Verify your email address in Nodryx first, then log in again.")
			return
		}
		log.Printf("[ERROR] nodryx upsert identity: %v", err)
		n.errorPage(w, r, http.StatusInternalServerError, "Something went wrong", "Your account could not be prepared. Please try logging in again.")
		return
	}
	if name := strings.TrimSpace(user.Name); name != "" {
		if _, err := n.Pool.Exec(r.Context(), `UPDATE accounts SET name = $2 WHERE id = $1`, accountID, name); err != nil {
			log.Printf("[WARN] update account name: %v", err)
		}
	}
	token, err := startSession(n.Pool, w, r, accountID)
	if err != nil {
		log.Printf("[ERROR] nodryx start session: %v", err)
		n.errorPage(w, r, http.StatusInternalServerError, "Something went wrong", "Your session could not be created. Please try logging in again.")
		return
	}
	// Persist the token chain against the fresh session; a failure here must
	// not break the login — the local session already works.
	if err := n.storeTokens(r.Context(), hashToken(token), accountID, tokens); err != nil {
		log.Printf("[WARN] store nodryx tokens: %v", err)
	}
	http.Redirect(w, r, n.Cfg.AppBaseURL+"/"+redirectTo, http.StatusSeeOther)
}

// Verify refreshes the session's Nodryx token chain if needed (with mandatory
// rotation) and returns the user data from Nodryx's userinfo endpoint.
func (n *Nodryx) Verify(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	c, err := r.Cookie(CookieName)
	if err != nil || c.Value == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please log in"})
		return
	}
	accessToken, err := n.accessToken(r.Context(), hashToken(c.Value))
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]bool{"linked": false})
		return
	}
	if err != nil {
		var oe *oauthError
		if errors.As(err, &oe) && oe.Code == "invalid_grant" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Session expired — please log in again"})
			return
		}
		log.Printf("[WARN] nodryx verify: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Could not reach Nodryx"})
		return
	}
	u, err := n.userinfo(r.Context(), accessToken)
	if err != nil {
		log.Printf("[WARN] nodryx verify userinfo: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Could not load your Nodryx profile"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"linked": true, "user": u})
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

type nodryxUser struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Provider     string `json:"provider"`
}

// validEmail mirrors the check previously shared with password login.
func validEmail(e string) bool {
	if len(e) > 254 {
		return false
	}
	addr, err := mail.ParseAddress(e)
	return err == nil && addr.Address == e && strings.Contains(e, "@")
}

// upsertIdentity resolves the Nodryx user to an account: reuse the known
// identity, else link a same-email account (verified emails only), else
// provision a new one. The stable subject — never the email — keys the identity.
func (n *Nodryx) upsertIdentity(ctx context.Context, u *nodryxUser) (int64, error) {
	var accountID int64
	err := n.Pool.QueryRow(ctx,
		`SELECT account_id FROM auth_identities WHERE provider = 'nodryx' AND subject = $1`, u.Sub).
		Scan(&accountID)
	if err == nil {
		_, _ = n.Pool.Exec(ctx,
			`UPDATE auth_identities SET email = $2, updated_at = NOW() WHERE provider = 'nodryx' AND subject = $1`,
			u.Sub, u.Email)
		return accountID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	if !u.EmailVerified {
		// An unverified email must never claim an existing account.
		return 0, errEmailNotVerified
	}
	err = n.Pool.QueryRow(ctx, `SELECT id FROM accounts WHERE LOWER(email) = LOWER($1)`, u.Email).Scan(&accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = n.Pool.QueryRow(ctx,
			`INSERT INTO accounts (email, password_hash) VALUES ($1, NULL) RETURNING id`, u.Email).Scan(&accountID)
		if errors.Is(err, pgx.ErrNoRows) {
			err = nil
		}
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// Raced with a concurrent signup for the same email: reuse it.
			err = n.Pool.QueryRow(ctx, `SELECT id FROM accounts WHERE LOWER(email) = LOWER($1)`, u.Email).Scan(&accountID)
		}
		if err != nil {
			return 0, err
		}
	}
	_, err = n.Pool.Exec(ctx,
		`INSERT INTO auth_identities (provider, subject, account_id, email) VALUES ('nodryx', $1, $2, $3)
		 ON CONFLICT (provider, subject) DO UPDATE SET account_id = EXCLUDED.account_id, email = EXCLUDED.email, updated_at = NOW()`,
		u.Sub, accountID, u.Email)
	if err != nil {
		return 0, err
	}
	return accountID, nil
}

// ---------------------------------------------------------------------------
// Token endpoint client
// ---------------------------------------------------------------------------

type oauthError struct {
	Code string // e.g. invalid_grant, invalid_client, invalid_request
}

func (e *oauthError) Error() string { return "nodryx oauth error: " + e.Code }

type tokenSet struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

func (n *Nodryx) exchangeCode(ctx context.Context, code, verifier string) (*tokenSet, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", n.redirectURI())
	form.Set("client_id", n.Cfg.NodryxClientID)
	form.Set("client_secret", n.Cfg.NodryxClientSecret)
	form.Set("code_verifier", verifier)
	return n.tokenRequest(ctx, form)
}

func (n *Nodryx) refresh(ctx context.Context, refreshToken string) (*tokenSet, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	form.Set("client_id", n.Cfg.NodryxClientID)
	form.Set("client_secret", n.Cfg.NodryxClientSecret)
	return n.tokenRequest(ctx, form)
}

// tokenRequest POSTs a form to the token endpoint and maps OAuth errors
// ({"error": "invalid_grant", ...}) onto *oauthError.
func (n *Nodryx) tokenRequest(ctx context.Context, form url.Values) (*tokenSet, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		n.Cfg.NodryxAuthURL+"/api/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := n.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("call token endpoint: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		var ts tokenSet
		if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&ts); err != nil {
			return nil, fmt.Errorf("decode token response: %w", err)
		}
		if ts.AccessToken == "" {
			return nil, errors.New("token response missing access_token")
		}
		return &ts, nil
	}
	var oe struct {
		Error string `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&oe)
	if oe.Error == "" {
		return nil, fmt.Errorf("token endpoint returned %d", res.StatusCode)
	}
	return nil, &oauthError{Code: oe.Error}
}

func (n *Nodryx) userinfo(ctx context.Context, accessToken string) (*nodryxUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, n.Cfg.NodryxAuthURL+"/api/oauth/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := n.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("call userinfo: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		var oe struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&oe)
		if oe.Error != "" {
			return nil, &oauthError{Code: oe.Error}
		}
		return nil, fmt.Errorf("userinfo returned %d", res.StatusCode)
	}
	var u nodryxUser
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&u); err != nil {
		return nil, fmt.Errorf("decode userinfo: %w", err)
	}
	return &u, nil
}

// ---------------------------------------------------------------------------
// Token chain storage (encrypted at rest) + rotation
// ---------------------------------------------------------------------------

// seal encrypts plaintext with AES-256-GCM. Refresh tokens must be recoverable
// verbatim (refresh and logout need them), so unlike session tokens they cannot
// be stored hashed — encryption keeps them useless to a database-only leak.
func seal(key []byte, plaintext string) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func open(key, sealed []byte) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	if len(sealed) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	pt, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// key derives the 32-byte AES key from APP_SECRET (domain-separated).
func (n *Nodryx) key() []byte {
	sum := sha256.Sum256([]byte("pendekin:nodryx-tokens:" + n.Cfg.AppSecret))
	return sum[:]
}

func (n *Nodryx) storeTokens(ctx context.Context, sessionHash string, accountID int64, ts *tokenSet) error {
	key := n.key()
	rtEnc, err := seal(key, ts.RefreshToken)
	if err != nil {
		return err
	}
	atEnc, err := seal(key, ts.AccessToken)
	if err != nil {
		return err
	}
	ttl := time.Duration(ts.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	_, err = n.Pool.Exec(ctx, `
		INSERT INTO nodryx_tokens (session_token_hash, account_id, refresh_token_enc, access_token_enc, access_expires_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (session_token_hash) DO UPDATE SET
			refresh_token_enc = EXCLUDED.refresh_token_enc,
			access_token_enc = EXCLUDED.access_token_enc,
			access_expires_at = EXCLUDED.access_expires_at,
			updated_at = NOW()`,
		sessionHash, accountID, rtEnc, atEnc, time.Now().Add(ttl))
	return err
}

// accessToken returns a valid Nodryx access token for the session, refreshing
// it (with mandatory rotation: the new pair is stored, the old one discarded)
// when the stored token is about to expire. On invalid_grant the whole chain
// is considered revoked per Nodryx policy: the token row and the local session
// are deleted, forcing a fresh login.
func (n *Nodryx) accessToken(ctx context.Context, sessionHash string) (string, error) {
	var accountID int64
	var rtEnc, atEnc []byte
	var expires time.Time
	err := n.Pool.QueryRow(ctx,
		`SELECT account_id, refresh_token_enc, access_token_enc, access_expires_at FROM nodryx_tokens WHERE session_token_hash = $1`,
		sessionHash).Scan(&accountID, &rtEnc, &atEnc, &expires)
	if err != nil {
		return "", err // includes ErrNoRows: session not linked to Nodryx
	}
	key := n.key()
	if time.Until(expires) > time.Minute {
		return open(key, atEnc)
	}
	refreshToken, err := open(key, rtEnc)
	if err != nil {
		return "", err
	}
	ts, err := n.refresh(ctx, refreshToken)
	if err != nil {
		var oe *oauthError
		if errors.As(err, &oe) && oe.Code == "invalid_grant" {
			_, _ = n.Pool.Exec(ctx, `DELETE FROM nodryx_tokens WHERE session_token_hash = $1`, sessionHash)
			_, _ = n.Pool.Exec(ctx, `DELETE FROM account_sessions WHERE token_hash = $1`, sessionHash)
		}
		return "", err
	}
	if ts.RefreshToken == "" {
		ts.RefreshToken = refreshToken // defensive: Nodryx always rotates, but never drop the chain
	}
	if err := n.storeTokens(ctx, sessionHash, accountID, ts); err != nil {
		return "", err
	}
	return ts.AccessToken, nil
}

// ---------------------------------------------------------------------------
// Revocation (logout / account deletion)
// ---------------------------------------------------------------------------

// RevokeForSession revokes the session's Nodryx refresh token and removes the
// stored chain. Failures are logged and swallowed: a local logout must always
// succeed.
func (n *Nodryx) RevokeForSession(ctx context.Context, sessionHash string) {
	if n.Pool == nil || !n.Cfg.NodryxEnabled() {
		return
	}
	var rtEnc []byte
	err := n.Pool.QueryRow(ctx,
		`SELECT refresh_token_enc FROM nodryx_tokens WHERE session_token_hash = $1`, sessionHash).Scan(&rtEnc)
	if err != nil {
		return // nothing stored for this session
	}
	if refreshToken, err := open(n.key(), rtEnc); err == nil {
		body, _ := json.Marshal(map[string]string{"refresh_token": refreshToken})
		if req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.Cfg.NodryxAuthURL+"/api/logout", bytes.NewReader(body)); err == nil {
			req.Header.Set("Content-Type", "application/json")
			if res, err := n.client().Do(req); err == nil {
				res.Body.Close()
			}
		}
	} else {
		log.Printf("[WARN] decrypt nodryx refresh token: %v", err)
	}
	if _, err := n.Pool.Exec(ctx, `DELETE FROM nodryx_tokens WHERE session_token_hash = $1`, sessionHash); err != nil {
		log.Printf("[WARN] delete nodryx tokens: %v", err)
	}
}

// RevokeForAccount revokes every Nodryx chain stored for the account.
func (n *Nodryx) RevokeForAccount(ctx context.Context, accountID int64) {
	if n.Pool == nil || !n.Cfg.NodryxEnabled() {
		return
	}
	rows, err := n.Pool.Query(ctx, `SELECT session_token_hash FROM nodryx_tokens WHERE account_id = $1`, accountID)
	if err != nil {
		return
	}
	var hashes []string
	for rows.Next() {
		var h string
		if rows.Scan(&h) == nil {
			hashes = append(hashes, h)
		}
	}
	rows.Close()
	for _, h := range hashes {
		n.RevokeForSession(ctx, h)
	}
}

// ---------------------------------------------------------------------------
// Error page (graceful, in-app style — never a bare 500)
// ---------------------------------------------------------------------------

func (n *Nodryx) errorPage(w http.ResponseWriter, r *http.Request, code int, title, detail string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	back := n.Cfg.AppBaseURL
	if back == "" {
		back = "/"
	}
	fmt.Fprintf(w, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s · pendekin</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;
       font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px;box-sizing:border-box}
  .card{max-width:420px;width:100%%;border:1px solid #262626;border-radius:24px;background:#0d0d0d;padding:40px;text-align:center}
  .brand{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:700;letter-spacing:.35em;color:#a3a3a3;text-decoration:none}
  h1{font-size:24px;font-weight:500;margin:20px 0 8px}
  p{font-size:14px;line-height:1.6;color:#a3a3a3;margin:0 0 28px}
  a.btn{display:inline-block;background:#fff;color:#000;font-size:13px;font-weight:600;padding:10px 22px;border-radius:999px;text-decoration:none}
</style>
</head>
<body><div class="card">
  <a class="brand" href="%s">PENDEKIN</a>
  <h1>%s</h1>
  <p>%s</p>
  <a class="btn" href="%s">Back to pendekin</a>
</div></body>
</html>`, html.EscapeString(title), html.EscapeString(back), html.EscapeString(title), html.EscapeString(detail), html.EscapeString(back))
}
