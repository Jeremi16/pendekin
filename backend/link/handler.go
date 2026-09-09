package link

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"pendekin/config"
)

var reserved = map[string]bool{
	"admin": true, "api": true, "auth": true, "dashboard": true,
	"health": true, "ready": true, "history": true, "links": true,
	"shorten": true, "static": true, "assets": true, "www": true,
	"login": true, "register": true, "public": true,
}

type Handler struct {
	Pool *pgxpool.Pool
	Cfg  *config.Config
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/health", h.Health)
	r.Get("/ready", h.Ready)
	r.Get("/links", h.ListLinks)
	r.Post("/links", h.CreateLink)
	r.Post("/shorten", h.CreateLink)
	r.Get("/links/{code}/stats", h.LinkStats)
	r.Get("/{code}", h.Redirect)
	return r
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"database": h.Cfg.DatabaseURL != "",
		"baseUrl":  h.Cfg.AppBaseURL,
	})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		w.WriteHeader(500)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "DATABASE_URL not set"})
		return
	}
	if err := h.Pool.Ping(r.Context()); err != nil {
		w.WriteHeader(500)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

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
	links, total, err := ListLinks(r.Context(), h.Pool, search, status, page, limit)
	if err != nil {
		writeJSON(w, 500, map[string]interface{}{"error": err.Error()})
		return
	}
	if links == nil {
		links = []*Link{}
	}
	writeJSON(w, 200, map[string]interface{}{"links": links, "total": total, "page": page, "limit": limit})
}

func (h *Handler) LinkStats(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		writeJSON(w, 500, map[string]interface{}{"error": "DATABASE_URL not set"})
		return
	}
	code := chi.URLParam(r, "code")
	l, err := GetLinkByCode(r.Context(), h.Pool, code)
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
	// limit body already via middleware in main.go, but double-check
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
	// Block self-loop
	if h.Cfg.AppBaseURL != "" && strings.HasPrefix(normalized, h.Cfg.AppBaseURL) {
		// allow but warn; check for loop to own short code? For now block exact baseURL loop
		// e.g. https://lynk.pmkitera.com/abc -> would loop, but normalized is full short_url, not code. So allow.
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
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto != "" {
		proto = strings.Split(proto, ",")[0]
		proto = strings.TrimSpace(proto)
	}
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := r.Host
	if host == "" {
		host = r.Header.Get("Host")
	}
	baseURL := GetBaseURL(h.Cfg.AppBaseURL, proto, host)

	// Generate or use custom slug
	var shortCode string
	if slug != "" {
		shortCode = slug
		// check collision globally
		existing, _ := GetLinkByCode(r.Context(), h.Pool, shortCode)
		if existing != nil {
			writeJSON(w, 409, map[string]interface{}{"error": "Custom slug is already in use"})
			return
		}
	} else {
		// generate unique
		for attempt := 0; attempt < 8; attempt++ {
			cand := GenerateShortCode(7)
			if reserved[strings.ToLower(cand)] {
				continue
			}
			existing, _ := GetLinkByCode(r.Context(), h.Pool, cand)
			if existing == nil {
				shortCode = cand
				break
			}
		}
		if shortCode == "" {
			writeJSON(w, 500, map[string]interface{}{"error": "Failed to generate short code"})
			return
		}
	}

	shortURL := baseURL + "/" + shortCode
	var customSlugPtr *string
	if slug != "" {
		customSlugPtr = &slug
	}
	ipHash := HashIP(h.Cfg.AppSecret, clientIP(r))

	lnk, err := CreateLink(r.Context(), h.Pool, title, normalized, shortURL, shortCode, customSlugPtr, expiresAt, qr, ipHash)
	if err != nil {
		// handle unique violation
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "23505") {
			writeJSON(w, 409, map[string]interface{}{"error": "Slug already in use"})
			return
		}
		writeJSON(w, 500, map[string]interface{}{"error": err.Error()})
		return
	}

	writeJSON(w, 201, map[string]interface{}{
		"link":     lnk,
		"shortURL": lnk.Short,
	})
}

func (h *Handler) Redirect(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		writeJSON(w, 500, map[string]interface{}{"error": "DATABASE_URL not set"})
		return
	}
	code := chi.URLParam(r, "code")
	if reserved[strings.ToLower(code)] {
		writeJSON(w, 404, map[string]interface{}{"error": "Not found"})
		return
	}
	cands, err := ListRedirectCandidates(r.Context(), h.Pool, code)
	if err != nil || len(cands) == 0 {
		writeJSON(w, 404, map[string]interface{}{"error": "Short code not found"})
		return
	}
	now := time.Now()
	var chosen *Link
	for _, c := range cands {
		if c.IsActive && !IsExpired(c.ExpiresAt, now) {
			chosen = c
			break
		}
	}
	if chosen == nil {
		fb := cands[0]
		if !fb.IsActive {
			writeJSON(w, 410, map[string]interface{}{"error": "This link is inactive"})
			return
		}
		if IsExpired(fb.ExpiresAt, now) {
			writeJSON(w, 410, map[string]interface{}{"error": "This link has expired"})
			return
		}
		writeJSON(w, 404, map[string]interface{}{"error": "Short code not found"})
		return
	}
	// record click async? do sync for now
	_ = RecordClick(r.Context(), h.Pool, chosen.ID, r.Referer(), r.UserAgent(), HashIP(h.Cfg.AppSecret, clientIP(r)))
	http.Redirect(w, r, chosen.Original, http.StatusFound)
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func clientIP(r *http.Request) string {
	// trust proxy 1: X-Forwarded-For first
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	// RemoteAddr includes port
	host := r.RemoteAddr
	if idx := strings.LastIndex(host, ":"); idx != -1 {
		return host[:idx]
	}
	return host
}
