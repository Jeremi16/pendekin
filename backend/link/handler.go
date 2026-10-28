package link

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"pendekin/auth"
	"pendekin/config"
	mw "pendekin/middleware"
)

type Handler struct {
	Pool *pgxpool.Pool
	Cfg  *config.Config
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":       true,
		"database": h.Cfg.DatabaseURL != "",
		"baseUrl":  h.Cfg.AppBaseURL,
	})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{"ok": false, "error": "DATABASE_URL not set"})
		return
	}
	if err := h.Pool.Ping(r.Context()); err != nil {
		log.Printf("[ERROR] ready ping: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{"ok": false, "error": "database unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func (h *Handler) creatorHash(r *http.Request) string {
	return HashIP(h.Cfg.AppSecret, mw.ClientIP(r))
}

// scope limits list/stats to the logged-in account, or to the anonymous creator's IP.
func (h *Handler) scope(r *http.Request) Scope {
	if a := auth.FromContext(r.Context()); a != nil {
		return Scope{OwnerID: &a.ID}
	}
	return Scope{CreatorHash: h.creatorHash(r)}
}

// ListLinks returns the caller's links (by account when logged in, else by IP).
func (h *Handler) ListLinks(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		writeJSON(w, 500, map[string]interface{}{"error": "DATABASE_URL not set"})
		return
	}
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("search"))
	status := NormalizeStatus(q.Get("status"))
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	links, total, err := ListLinks(r.Context(), h.Pool, h.scope(r), search, status, "", page, limit)
	if err != nil {
		internalError(w, "list links", err)
		return
	}
	if links == nil {
		links = []*Link{}
	}
	writeJSON(w, 200, map[string]interface{}{"links": links, "total": total, "page": page, "limit": limit})
}

// LinkStats returns stats only to the link's owner/creator.
func (h *Handler) LinkStats(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		writeJSON(w, 500, map[string]interface{}{"error": "DATABASE_URL not set"})
		return
	}
	code := chi.URLParam(r, "code")
	l, err := GetScopedLinkByCode(r.Context(), h.Pool, code, h.scope(r))
	if err != nil {
		writeJSON(w, 404, map[string]interface{}{"error": "Not found"})
		return
	}
	writeJSON(w, 200, map[string]interface{}{"link": l})
}

type createReq struct {
	URL        string                 `json:"url"`
	Title      string                 `json:"title"`
	CustomSlug string                 `json:"customSlug"`
	ExpiresAt  string                 `json:"expiresAt"`
	QrConfig   map[string]interface{} `json:"qrConfig"`
}

func (h *Handler) CreateLink(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		writeJSON(w, 500, map[string]interface{}{"error": "DATABASE_URL is required"})
		return
	}
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	normalized, ok := NormalizeURL(req.URL)
	if !ok {
		writeJSON(w, 400, map[string]interface{}{"error": "A valid URL is required (no localhost/private IP)"})
		return
	}

	title := NormalizeTitle(req.Title)
	slug, slugErr := NormalizeCustomSlug(req.CustomSlug)
	if slugErr != "" {
		writeJSON(w, 400, map[string]interface{}{"error": slugErr})
		return
	}
	var expiresAt *time.Time
	if req.ExpiresAt != "" {
		var errStr string
		expiresAt, errStr = NormalizeExpiry(req.ExpiresAt, h.Cfg.MaxTTL_Days)
		if errStr != "" {
			writeJSON(w, 400, map[string]interface{}{"error": errStr})
			return
		}
	}
	qr := NormalizeQrConfig(req.QrConfig)

	// Determine base URL: APP_BASE_URL or request host
	proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	baseURL := GetBaseURL(h.Cfg.AppBaseURL, proto, r.Host)

	// Generate or use custom slug; the unique index is the final arbiter on races.
	var shortCode string
	if slug != "" {
		shortCode = slug
		if existing, _ := GetLinkByCode(r.Context(), h.Pool, shortCode); existing != nil {
			writeJSON(w, 409, map[string]interface{}{"error": "Custom slug is already in use"})
			return
		}
	} else {
		for attempt := 0; attempt < 8; attempt++ {
			cand := GenerateShortCode(7)
			if IsReserved(cand) {
				continue
			}
			if existing, _ := GetLinkByCode(r.Context(), h.Pool, cand); existing == nil {
				shortCode = cand
				break
			}
		}
		if shortCode == "" {
			writeJSON(w, 500, map[string]interface{}{"error": "Failed to generate short code"})
			return
		}
	}

	var ownerID *int64
	if a := auth.FromContext(r.Context()); a != nil {
		ownerID = &a.ID
	}
	var customSlugPtr *string
	if slug != "" {
		customSlugPtr = &slug
	}

	lnk, err := CreateLink(r.Context(), h.Pool, title, normalized, baseURL+"/"+shortCode, shortCode, customSlugPtr, expiresAt, qr, h.creatorHash(r), ownerID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, 409, map[string]interface{}{"error": "Slug already in use"})
			return
		}
		internalError(w, "create link", err)
		return
	}

	writeJSON(w, 201, map[string]interface{}{
		"link":     lnk,
		"shortURL": lnk.Short,
	})
}

// resolve picks the live link for a short code, or writes an error page.
func (h *Handler) resolve(w http.ResponseWriter, r *http.Request) *Link {
	if h.Pool == nil {
		renderPage(w, http.StatusServiceUnavailable, page{Title: "Unavailable", Message: "The service is temporarily unavailable."})
		return nil
	}
	code := chi.URLParam(r, "code")
	if IsReserved(code) {
		renderPage(w, http.StatusNotFound, page{Title: "Link not found", Message: "This short link doesn't exist."})
		return nil
	}
	cands, err := ListRedirectCandidates(r.Context(), h.Pool, code)
	if err != nil || len(cands) == 0 {
		renderPage(w, http.StatusNotFound, page{Title: "Link not found", Message: "This short link doesn't exist."})
		return nil
	}
	now := time.Now()
	for _, c := range cands {
		if c.IsActive && !IsExpired(c.ExpiresAt, now) {
			return c
		}
	}
	if fb := cands[0]; !fb.IsActive {
		renderPage(w, http.StatusGone, page{Title: "Link inactive", Message: "The owner has turned this link off."})
	} else {
		renderPage(w, http.StatusGone, page{Title: "Link expired", Message: "This short link has expired."})
	}
	return nil
}

func (h *Handler) follow(w http.ResponseWriter, r *http.Request, l *Link) {
	if err := RecordClick(r.Context(), h.Pool, l.ID, r.Referer(), r.UserAgent(), h.creatorHash(r)); err != nil {
		log.Printf("[WARN] record click: %v", err)
	}
	http.Redirect(w, r, l.Original, http.StatusFound)
}

// Redirect sends visitors to the destination, or shows the unlock form for
// password-protected links.
func (h *Handler) Redirect(w http.ResponseWriter, r *http.Request) {
	l := h.resolve(w, r)
	if l == nil {
		return
	}
	if l.HasPassword {
		renderPage(w, http.StatusOK, page{Title: "Protected link", Message: "Enter the password to continue.", Form: true})
		return
	}
	h.follow(w, r, l)
}

// Unlock handles the password form POSTed to /{code}.
func (h *Handler) Unlock(w http.ResponseWriter, r *http.Request) {
	l := h.resolve(w, r)
	if l == nil {
		return
	}
	if !l.HasPassword {
		h.follow(w, r, l)
		return
	}
	if !auth.VerifyPassword(r.PostFormValue("password"), l.passwordHash) {
		renderPage(w, http.StatusUnauthorized, page{Title: "Protected link", Message: "Enter the password to continue.", Form: true, Error: "Incorrect password"})
		return
	}
	// 303 so the browser follows with GET and doesn't resubmit the form.
	if err := RecordClick(r.Context(), h.Pool, l.ID, r.Referer(), r.UserAgent(), h.creatorHash(r)); err != nil {
		log.Printf("[WARN] record click: %v", err)
	}
	http.Redirect(w, r, l.Original, http.StatusSeeOther)
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func internalError(w http.ResponseWriter, op string, err error) {
	log.Printf("[ERROR] %s: %v", op, err)
	var connErr *pgconn.ConnectError
	if errors.As(err, &connErr) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{"error": "Database unavailable — please try again later"})
		return
	}
	writeJSON(w, 500, map[string]interface{}{"error": "Internal server error"})
}
