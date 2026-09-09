# pendekin — public URL shortener (no login)

Standalone shortener: **Go + Vite + Bun + React + Tailwind v4 + Neon Postgres**. No Short.io, no admin.

```
pendekin/
├── backend/   # Go (chi + pgx)  — port 5000, endpoints /api/health, /api/links, /{code}
└── frontend/  # Vite + React + TS + Tailwind — port 5173 dev, /api proxied to :5000
```

## Quick start

1. Copy env:
   ```bash
   cp .env.example .env
   # edit DATABASE_URL, APP_BASE_URL=http://localhost:5173, APP_SECRET=openssl rand -hex 32
   ```
2. Backend:
   ```bash
   cd backend && go run .
   ```
3. Frontend:
   ```bash
   cd frontend && bun install && bun run dev
   ```
4. Open http://localhost:5173 — paste URL → Shorten → copy + QR PNG/SVG. Stats: paste short URL/code → View.

## API

- `POST /api/links` `{url, title?, customSlug? (4-32), expiresAt? (max 90d), qrConfig?}` → `201 {shortURL, link}` — rate 5/min/IP
- `GET  /api/links?search=&status=all|active|inactive|expired&page=&limit=`
- `GET  /api/links/{code}/stats` → `{link}`
- `GET  /{code}` → 302 `Location: original` + `recordClick` (hash IP with APP_SECRET)
- `GET  /health` (no DB) / `GET /ready` (ping DB) / `GET /api/health` / `GET /api/ready`

## Deploy

- Coolify mini PC: set `APP_BASE_URL=https://lynk.example.com`, `CORS_ORIGINS=lynk.example.com,localhost`, `PORT=5000`, `VITE_API_BASE_URL=/api` (rebuild frontend). Traefik `PathPrefix(/api) → api:5000`.
- Docker: `docker compose up --build`

## Stack notes

- `go.mod` lives in `backend/` (Opsi A). `bun.lockb` in `frontend/`.
- DB `ensureSchema` creates `links` + `click_events` and drops legacy `users/sessions/shortio_*` from pendekin-v2.
- No auth/session/cookies — public. Recent links stored in `localStorage` only.
