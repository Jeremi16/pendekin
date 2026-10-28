package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	CookieName = "pk_session"
	sessionTTL = 30 * 24 * time.Hour
)

type Account struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}

type ctxKey struct{}

// FromContext returns the logged-in account, or nil for anonymous requests.
func FromContext(ctx context.Context) *Account {
	a, _ := ctx.Value(ctxKey{}).(*Account)
	return a
}

type Service struct {
	Pool *pgxpool.Pool
	// Nodryx revokes refresh tokens on logout/account deletion. May be nil in
	// health-only mode; Revoke* handle nil pools themselves.
	Nodryx *Nodryx
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// Middleware attaches the session's account (if any) to the request context.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(CookieName)
		if err != nil || c.Value == "" || s.Pool == nil {
			next.ServeHTTP(w, r)
			return
		}
		var a Account
		err = s.Pool.QueryRow(r.Context(),
			`SELECT a.id, a.email, a.created_at FROM account_sessions s JOIN accounts a ON a.id = s.account_id
			 WHERE s.token_hash = $1 AND s.expires_at > NOW()`, hashToken(c.Value)).Scan(&a.ID, &a.Email, &a.CreatedAt)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				log.Printf("[WARN] session lookup: %v", err)
			}
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, &a)))
	})
}

// decodeJSON enforces an application/json body; cross-site HTML forms can't
// send one without a CORS preflight, which together with SameSite=Lax blocks CSRF.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
		return false
	}
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return false
	}
	return true
}

// RequireJSON rejects state-changing requests that aren't application/json.
func RequireJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
				writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Require rejects anonymous requests with 401.
func Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if FromContext(r.Context()) == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please log in"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// DeleteAccount permanently removes the account and all of its links. The
// session cookie is the proof of identity (SSO logins have no local password);
// the JSON-only body guard keeps cross-site forms out.
func (s *Service) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	a := FromContext(r.Context())
	var body struct{}
	if !decodeJSON(w, r, &body) {
		return
	}
	if s.Nodryx != nil {
		s.Nodryx.RevokeForAccount(r.Context(), a.ID)
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		serverError(w, "begin", err)
		return
	}
	defer tx.Rollback(r.Context())
	// Delete owned links explicitly; the FK would otherwise orphan them (SET NULL).
	if _, err := tx.Exec(r.Context(), `DELETE FROM links WHERE owner_id = $1`, a.ID); err != nil {
		serverError(w, "delete links", err)
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM accounts WHERE id = $1`, a.ID); err != nil {
		serverError(w, "delete account", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, "commit", err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: isSecure(r), SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieName); err == nil && s.Pool != nil {
		sessionHash := hashToken(c.Value)
		if _, err := s.Pool.Exec(r.Context(), `DELETE FROM account_sessions WHERE token_hash = $1`, sessionHash); err != nil {
			log.Printf("[WARN] delete session: %v", err)
		}
		if s.Nodryx != nil {
			s.Nodryx.RevokeForSession(r.Context(), sessionHash)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: isSecure(r), SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"account": FromContext(r.Context())})
}

// startSession creates a session row and sets the session cookie. It returns
// the raw token (which also exists only in the cookie).
func startSession(pool *pgxpool.Pool, w http.ResponseWriter, r *http.Request, accountID int64) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	expires := time.Now().Add(sessionTTL)
	ctx := r.Context()
	// Housekeeping: drop this account's expired sessions.
	_, _ = pool.Exec(ctx, `DELETE FROM account_sessions WHERE account_id = $1 AND expires_at <= NOW()`, accountID)
	if _, err := pool.Exec(ctx,
		`INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)`,
		hashToken(token), accountID, expires); err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   isSecure(r),
		SameSite: http.SameSiteLaxMode,
	})
	return token, nil
}

func isSecure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func serverError(w http.ResponseWriter, op string, err error) {
	log.Printf("[ERROR] %s: %v", op, err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
}
