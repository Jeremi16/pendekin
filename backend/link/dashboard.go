package link

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"pendekin/auth"
)

// All dashboard handlers are mounted behind auth.Require, so an account is always
// present; every query is additionally scoped by owner_id.

func ownerID(r *http.Request) int64 {
	return auth.FromContext(r.Context()).ID
}

func linkID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	return id, err == nil && id > 0
}

func GetOwnedLink(ctx context.Context, pool *pgxpool.Pool, id, owner int64) (*Link, error) {
	return scanLink(pool.QueryRow(ctx, `SELECT `+linkColumns+` FROM links WHERE id=$1 AND owner_id=$2`, id, owner))
}

func (h *Handler) DashLinks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	owner := ownerID(r)
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	links, total, err := ListLinks(r.Context(), h.Pool, Scope{OwnerID: &owner},
		strings.TrimSpace(q.Get("search")), NormalizeStatus(q.Get("status")), strings.ToLower(strings.TrimSpace(q.Get("tag"))), q.Get("sort"), page, limit)
	if err != nil {
		internalError(w, "dashboard list", err)
		return
	}
	if links == nil {
		links = []*Link{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"links": links, "total": total})
}

func (h *Handler) DashTags(w http.ResponseWriter, r *http.Request) {
	tags, err := ListTags(r.Context(), h.Pool, ownerID(r))
	if err != nil {
		internalError(w, "dashboard tags", err)
		return
	}
	if tags == nil {
		tags = []TagCount{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

type dayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// clickSeries returns one row per UTC day for the last `days` days. linkFilter is a
// trusted SQL fragment over alias l; its argument is $2.
func clickSeries(ctx context.Context, pool *pgxpool.Pool, days int, linkFilter string, arg any) ([]dayCount, error) {
	rows, err := pool.Query(ctx, `
		SELECT to_char(d, 'YYYY-MM-DD'), COUNT(ce.id)
		FROM generate_series((NOW() AT TIME ZONE 'UTC')::date - ($1::int - 1), (NOW() AT TIME ZONE 'UTC')::date, interval '1 day') d
		LEFT JOIN (
			SELECT ce.id, ce.clicked_at FROM click_events ce JOIN links l ON l.id = ce.link_id WHERE `+linkFilter+`
		) ce ON (ce.clicked_at AT TIME ZONE 'UTC')::date = d::date
		GROUP BY d ORDER BY d`, days, arg)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (dayCount, error) {
		var dc dayCount
		err := row.Scan(&dc.Date, &dc.Count)
		return dc, err
	})
	return out, err
}

func (h *Handler) DashSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner := ownerID(r)
	var total, active, clicks, clicks7d int
	err := h.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE is_active AND (expires_at IS NULL OR expires_at > NOW())),
		       COALESCE(SUM(click_count), 0)
		FROM links WHERE owner_id = $1`, owner).Scan(&total, &active, &clicks)
	if err == nil {
		err = h.Pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM click_events ce JOIN links l ON l.id = ce.link_id
			WHERE l.owner_id = $1 AND ce.clicked_at > NOW() - interval '7 days'`, owner).Scan(&clicks7d)
	}
	if err != nil {
		internalError(w, "dashboard summary", err)
		return
	}
	series, err := clickSeries(ctx, h.Pool, 14, "l.owner_id = $2", owner)
	if err != nil {
		internalError(w, "dashboard series", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"links": total, "active": active, "clicks": clicks, "clicks7d": clicks7d, "series": series,
	})
}

// patchLink applies a partial update. Fields are optional; for expiresAt and
// password, null or "" clears the value.
func (h *Handler) PatchLink(w http.ResponseWriter, r *http.Request) {
	id, ok := linkID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid link id"})
		return
	}
	var body map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid JSON"})
		return
	}

	sets := []string{}
	args := []any{}
	set := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+strconv.Itoa(len(args)))
	}
	isNull := func(raw json.RawMessage) bool { return string(raw) == "null" }
	bad := func(msg string) { writeJSON(w, http.StatusBadRequest, map[string]any{"error": msg}) }

	for key, raw := range body {
		switch key {
		case "url":
			var s string
			if json.Unmarshal(raw, &s) != nil {
				bad("url must be a string")
				return
			}
			u, ok := NormalizeURL(s)
			if !ok {
				bad("A valid URL is required (no localhost/private IP)")
				return
			}
			if h.isUnsafe(r, u) {
				bad("This URL is flagged as unsafe (malware or phishing)")
				return
			}
			set("original_url", u)
		case "title":
			var s string
			if !isNull(raw) && json.Unmarshal(raw, &s) != nil {
				bad("title must be a string")
				return
			}
			set("title", NormalizeTitle(s))
		case "isActive":
			var b bool
			if json.Unmarshal(raw, &b) != nil {
				bad("isActive must be a boolean")
				return
			}
			set("is_active", b)
		case "expiresAt":
			var s string
			if !isNull(raw) && json.Unmarshal(raw, &s) != nil {
				bad("expiresAt must be a string or null")
				return
			}
			if s == "" {
				set("expires_at", nil)
				continue
			}
			t, errStr := NormalizeExpiry(s, h.Cfg.MaxTTL_Days)
			if errStr != "" {
				bad(errStr)
				return
			}
			set("expires_at", t)
		case "password":
			var s string
			if !isNull(raw) && json.Unmarshal(raw, &s) != nil {
				bad("password must be a string or null")
				return
			}
			if s == "" {
				set("password_hash", nil)
				continue
			}
			if len(s) < 4 || len(s) > 128 {
				bad("Link password must be 4–128 characters")
				return
			}
			hash, err := auth.HashPassword(s)
			if err != nil {
				internalError(w, "hash link password", err)
				return
			}
			set("password_hash", hash)
		case "maxClicks":
			var n *int
			if json.Unmarshal(raw, &n) != nil {
				bad("maxClicks must be a number or null")
				return
			}
			n, errStr := NormalizeMaxClicks(n)
			if errStr != "" {
				bad(errStr)
				return
			}
			set("max_clicks", n)
		case "tags":
			var in []string
			if json.Unmarshal(raw, &in) != nil {
				bad("tags must be an array of strings")
				return
			}
			tags, errStr := NormalizeTags(in)
			if errStr != "" {
				bad(errStr)
				return
			}
			set("tags", tags)
		case "ogTitle", "ogDescription", "ogImage":
			var s string
			if !isNull(raw) && json.Unmarshal(raw, &s) != nil {
				bad(key + " must be a string or null")
				return
			}
			switch key {
			case "ogTitle":
				set("og_title", NormalizeText(s, 120))
			case "ogDescription":
				set("og_description", NormalizeText(s, 300))
			case "ogImage":
				if strings.TrimSpace(s) == "" {
					set("og_image", nil)
					continue
				}
				u, ok := NormalizeURL(s)
				if !ok {
					bad("OG image must be a valid public URL")
					return
				}
				set("og_image", u)
			}
		case "qrConfig":
			var m map[string]any
			if json.Unmarshal(raw, &m) != nil {
				bad("qrConfig must be an object")
				return
			}
			qc, _ := json.Marshal(NormalizeQrConfig(m))
			args = append(args, string(qc))
			sets = append(sets, "qr_config = $"+strconv.Itoa(len(args))+"::jsonb")
		default:
			bad("Unknown field: " + key)
			return
		}
	}
	if len(sets) == 0 {
		bad("Nothing to update")
		return
	}
	args = append(args, id, ownerID(r))
	n := len(args)
	l, err := scanLink(h.Pool.QueryRow(r.Context(),
		`UPDATE links SET `+strings.Join(sets, ", ")+`, updated_at = NOW()
		 WHERE id = $`+strconv.Itoa(n-1)+` AND owner_id = $`+strconv.Itoa(n)+` RETURNING `+linkColumns, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Link not found"})
		return
	}
	if err != nil {
		internalError(w, "patch link", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"link": l})
}

func (h *Handler) DeleteLink(w http.ResponseWriter, r *http.Request) {
	id, ok := linkID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid link id"})
		return
	}
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM links WHERE id = $1 AND owner_id = $2`, id, ownerID(r))
	if err != nil {
		internalError(w, "delete link", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Link not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type bulkReq struct {
	IDs    []int64 `json:"ids"`
	Action string  `json:"action"`
}

// validateBulk returns an error message, or "" when the request is acceptable.
func validateBulk(b bulkReq) string {
	if len(b.IDs) == 0 || len(b.IDs) > 500 {
		return "Select between 1 and 500 links"
	}
	switch b.Action {
	case "activate", "deactivate", "delete":
		return ""
	}
	return "action must be activate, deactivate or delete"
}

func (h *Handler) BulkLinks(w http.ResponseWriter, r *http.Request) {
	var b bulkReq
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid JSON"})
		return
	}
	if msg := validateBulk(b); msg != "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": msg})
		return
	}
	var sql string
	switch b.Action {
	case "activate":
		sql = `UPDATE links SET is_active = TRUE, updated_at = NOW() WHERE id = ANY($1) AND owner_id = $2`
	case "deactivate":
		sql = `UPDATE links SET is_active = FALSE, updated_at = NOW() WHERE id = ANY($1) AND owner_id = $2`
	case "delete":
		sql = `DELETE FROM links WHERE id = ANY($1) AND owner_id = $2`
	}
	tag, err := h.Pool.Exec(r.Context(), sql, b.IDs, ownerID(r))
	if err != nil {
		internalError(w, "bulk "+b.Action, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"affected": tag.RowsAffected()})
}

type labelCount struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

func (h *Handler) LinkAnalytics(w http.ResponseWriter, r *http.Request) {
	id, ok := linkID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid link id"})
		return
	}
	ctx := r.Context()
	l, err := GetOwnedLink(ctx, h.Pool, id, ownerID(r))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Link not found"})
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 7 || days > 90 {
		days = 30
	}
	series, err := clickSeries(ctx, h.Pool, days, "l.id = $2", id)
	if err != nil {
		internalError(w, "analytics series", err)
		return
	}
	since := time.Now().AddDate(0, 0, -days)
	group := func(expr string, limit int) ([]labelCount, error) {
		rows, err := h.Pool.Query(ctx, `SELECT `+expr+` AS k, COUNT(*) FROM click_events
			WHERE link_id = $1 AND clicked_at >= $2 GROUP BY k ORDER BY 2 DESC LIMIT `+strconv.Itoa(limit), id, since)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(row pgx.CollectableRow) (labelCount, error) {
			var lc labelCount
			err := row.Scan(&lc.Label, &lc.Count)
			return lc, err
		})
	}
	devices, err1 := group(`COALESCE(device, 'Unknown')`, 10)
	browsers, err2 := group(`COALESCE(browser, 'Unknown')`, 10)
	rawRefs, err3 := group(`COALESCE(referrer, '')`, 500)
	countries, err4 := group(`COALESCE(country, '')`, 15)
	oses, err5 := group(`COALESCE(os, 'Unknown')`, 10)
	if err := errors.Join(err1, err2, err3, err4, err5); err != nil {
		internalError(w, "analytics breakdown", err)
		return
	}
	// Collapse full referrer URLs to hosts, then keep the top 10.
	byHost := map[string]int{}
	for _, rc := range rawRefs {
		byHost[ReferrerHost(rc.Label)] += rc.Count
	}
	referrers := make([]labelCount, 0, len(byHost))
	for k, v := range byHost {
		referrers = append(referrers, labelCount{k, v})
	}
	sort.Slice(referrers, func(i, j int) bool {
		if referrers[i].Count != referrers[j].Count {
			return referrers[i].Count > referrers[j].Count
		}
		return referrers[i].Label < referrers[j].Label
	})
	if len(referrers) > 10 {
		referrers = referrers[:10]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"link": l, "days": days, "series": series,
		"referrers": referrers, "devices": devices, "browsers": browsers,
		"countries": countries, "os": oses,
	})
}

// ClaimLinks attaches anonymous links created from the caller's IP to the account.
func (h *Handler) ClaimLinks(w http.ResponseWriter, r *http.Request) {
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE links SET owner_id = $1, updated_at = NOW() WHERE creator_ip_hash = $2 AND owner_id IS NULL`,
		ownerID(r), h.creatorHash(r))
	if err != nil {
		internalError(w, "claim links", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"claimed": tag.RowsAffected()})
}
