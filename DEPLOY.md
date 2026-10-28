# Deploy

pendekin supports two deployment shapes. Both serve the **frontend and backend on one
domain** (no CORS, same-origin cookies):

| Shape | Frontend | Backend | Gateway |
|---|---|---|---|
| **Vercel** (serverless) | static build | Go function (`api/handler.go`) | Vercel edge (`vercel.json` rewrites) |
| **Self-host** (docker compose / Coolify) | nginx container | Go container | nginx or Traefik |

## Vercel (one project, one domain)

Repo layout that makes it work:

```
api/handler.go     → the whole chi router as one Go serverless function
api/go.mod         → thin module with `replace pendekin => ../backend`
vercel.json        → build + rewrites (replaces nginx.conf's role)
frontend/          → Vite build (unchanged)
backend/           → Go server (unchanged; `server.New` is shared by both shapes)
```

### Steps

1. **Upstash Redis** (rate-limit counters must live outside the process on serverless):
   create a free Redis at [upstash.com](https://upstash.com), copy the REST URL and token.
2. **Neon**: use the **pooled** connection string (host contains `-pooler`) — each warm
   serverless instance holds its own pool, and pooled mode protects Neon's connection limit.
3. **Vercel**: import the Git repo (root directory = repo root). `vercel.json` already
   defines the build (`cd frontend && bun install && bun run build` → `frontend/dist`).
4. **Env vars** (Project → Settings → Environment Variables):

   ```
   APP_BASE_URL=https://your-app.vercel.app
   APP_SECRET=<openssl rand -hex 32>
   DATABASE_URL=postgresql://...@ep-xxx-pooler.neon.tech/db?sslmode=require
   TRUST_PROXY=1
   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=xxx
   DB_MAX_CONNS=3
   VITE_API_BASE_URL=/api
   VITE_APP_BASE_URL=https://your-app.vercel.app
   NODRYX_AUTH_URL=https://<nodryx-host>
   NODRYX_CLIENT_ID=<from the Nodryx client>
   NODRYX_CLIENT_SECRET=<from the Nodryx client>
   APP_URL=https://your-app.vercel.app
   ```

   `VITE_*` are build-time — redeploy after changing them. The `NODRYX_CLIENT_SECRET`
   is server-side only; there is no `VITE_` variable for it and it never appears in
   the browser bundle.
5. **Deploy**, then verify (see checklist below).
6. Optional: add a custom domain in Vercel settings and update `APP_BASE_URL` /
   `VITE_APP_BASE_URL`.

Local dry-run of the same shape: `vercel login && vercel dev` (uses `vercel.json`).

### How requests flow on Vercel

```
your-app.vercel.app/            → static React files
your-app.vercel.app/api/*       → rewritten to /api/handler (Go function)
your-app.vercel.app/{code}      → rewritten (regex 4–32 chars, same rule as nginx.conf)
your-app.vercel.app/health|ready → rewritten (function)
```

The function restores the original path from query params (`__path` / `code`) and serves
it with the full chi router — the same router the self-host binary mounts.

## Self-host (docker compose / Coolify)

Unchanged from before:

```bash
cp .env.prod.example .env   # fill in real values
docker compose up --build
```

- nginx (`frontend/nginx.conf`) routes `/api/*` and `/{code}` to the backend; on Coolify
  uncomment the Traefik labels in `docker-compose.yml` instead.
- Rate limiting uses in-process memory by default; the `UPSTASH_*` vars are optional.

## Nodryx SSO

Login is **exclusively via Nodryx SSO** (OAuth2 authorization code + PKCE S256,
confidential client). The backend owns the whole flow; the browser only follows
redirects and carries the `pk_session` cookie.

### Register the client in Nodryx

| Field | Value |
|---|---|
| Redirect URI | `{APP_URL}/api/auth/callback/nodryx` — must match **per character**. Locally: `http://localhost:5173/api/auth/callback/nodryx`. Production: `https://your-domain.com/api/auth/callback/nodryx`. |
| Allowed origins (CORS) | `http://localhost:5173` (dev) and your production origin |

### Env vars

| Var | Purpose |
|---|---|
| `NODRYX_AUTH_URL` | Base URL of the Nodryx server (no trailing slash), e.g. `https://auth.nodryx.example.com` |
| `NODRYX_CLIENT_ID` | Client ID from the Nodryx dashboard |
| `NODRYX_CLIENT_SECRET` | Client secret — **server-side only**, never a `VITE_` var |
| `APP_URL` | Public origin used to build the redirect URI (`APP_BASE_URL` kept as fallback) |

### How the flow works

```
GET /api/auth/nodryx/start     → stores state+PKCE verifier in Postgres (10 min TTL), 302 to Nodryx
GET /api/auth/callback/nodryx  → validates state (single-use), exchanges the code server-side,
                                 loads userinfo, upserts the account, issues the session cookie
GET /api/auth/nodryx/verify    → (logged-in) refreshes the token pair when expired and
                                 returns the Nodryx user data
```

- First login with a new email provisions the account automatically; an existing
  same-email account is linked only when Nodryx reports `email_verified=true`.
- Refresh tokens are stored **encrypted at rest** (AES-256-GCM, key from `APP_SECRET`)
  and rotated on every refresh; logout revokes them at Nodryx.

### Post-deploy SSO checks

- [ ] "Log in" redirects to Nodryx and returns to the app logged in
- [ ] Refreshing `GET /api/auth/nodryx/verify` after 15 minutes returns a fresh pair (rotation stored)
- [ ] Logout, then forcing a refresh → `invalid_grant` (token truly revoked)
- [ ] Browser network tab shows no Nodryx secret anywhere

## Post-deploy checklist

- [ ] `GET /api/health` → `{"ok":true,"database":true}`
- [ ] Shorten a link; the returned short URL uses `APP_BASE_URL`
- [ ] Open the short URL → 302 to the original; click count increments
- [ ] Unknown code (`/{code}` with garbage) → not-found page
- [ ] `GET /api/links/{code}/stats` works for the creator
- [ ] Log in → dashboard lists links; edit/save works (session cookie same-origin)
- [ ] Burst 6 shortens quickly → 6th gets 429 with `Retry-After` (proves Redis counters)
- [ ] `X-RateLimit-*` headers present on create responses

## Troubleshooting

- **Go build fails on Vercel** — the runtime's Go version must be ≥ the `go` directive in
  `api/go.mod` / `backend/go.mod`. Lower both if the platform lags behind.
- **429s never trigger** — `UPSTASH_*` not set (falls back to per-instance memory).
- **Wrong client IPs in stats/logs** — `TRUST_PROXY=1` missing on Vercel (or set by
  mistake on a directly-exposed self-host).
- **Too many Neon connections** — use the `-pooler` host and keep `DB_MAX_CONNS` small.
