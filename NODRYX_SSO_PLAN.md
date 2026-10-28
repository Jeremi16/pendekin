# Rencana Integrasi SSO Nodryx — Pendekin (OAuth2 Authorization Code + PKCE S256)

> Status: **menunggu implementasi**. Dokumen ini adalah rencana teknis final yang disepakati.
> Data kredensial (`__ISI_BASE_URL__`, `__ISI_CLIENT_ID__`, `__ISI_CLIENT_SECRET__`,
> `__ISI_CALLBACK_URL__`) diisi pemilik aplikasi lewat env — tidak pernah di-hardcode.

## Keputusan produk (sudah dipilih pemilik)

1. **Nodryx adalah satu-satunya cara login.** Route register/login/password lokal dihapus.
   Login email+password tidak lagi tersedia.
2. **Provisioning otomatis.** Login Nodryx pertama dengan email baru otomatis membuat
   akun pendekin. Email yang sudah terdaftar ter-link otomatis (dengan syarat
   `email_verified=true` dari Nodryx).

## Arsitektur

Backend Go memiliki seluruh alur OAuth (secret tidak pernah menyentuh browser).
Frontend hanya memicu redirect dan membaca session cookie yang sudah ada.

```
Browser ──► GET /api/auth/nodryx/start ──► simpan state+verifier di Postgres
                                           (tabel oauth_flows, TTL 10 menit)
        ◄── 302 ke {AUTH}/api/oauth/authorize?...code_challenge=S256(verifier)
User login di halaman Nodryx ──► kembali ke /api/auth/nodryx/callback?code=…&state=…
Backend: validasi state (single-use)
       ──► POST {AUTH}/api/oauth/token (code + verifier + client_secret, server-side)
       ──► GET {AUTH}/api/oauth/userinfo (Bearer access_token)
       ──► upsert account + auth_identity
       ──► issue cookie pk_session (helper startSession yang sudah ada)
       ──► 302 ke {APP_URL}/{redirect_to}
```

Prinsip yang dipegang:

- Tidak ada parsing JWT lokal, tidak ada discovery/well-known, tidak ada library
  OAuth — murni stdlib (`crypto/rand`, `crypto/sha256`, `net/http`), konsisten
  dengan gaya repo yang hand-rolled (PBKDF2, Upstash REST, dll).
- `JWT_SECRET` / `JWT_ISSUER` / `JWT_AUDIENCE` **tidak dipakai sama sekali**
  (aturan keras #4 superprompt).
- State & verifier PKCE disimpan **server-side di Postgres**, bukan cookie/localStorage
  (aturan keras #1) — aman untuk Vercel serverless multi-instance.
- Tukar kode & refresh **hanya dari backend** (aturan keras #3); secret tidak pernah
  masuk bundle browser (tidak ada env Nodryx ber-prefix `VITE_`).
- Kegagalan `invalid_grant` saat tukar kode → halaman error yang meminta user mulai
  login ulang dari authorize; **tidak ada retry** terhadap kode yang sama (aturan keras #7).

## Desain detail

### Identitas & provisioning

- Kunci identitas = `sub` (UUID stabil) dari userinfo — **bukan email**.
  `updated_at` Nodryx tidak dipakai untuk apa pun (ternyata waktu pembuatan akun).
- Callback tanpa identity yang cocok:
  - Email belum ada di tabel `accounts` → buat akun baru (`password_hash` NULL).
  - Email sudah ada **dan** Nodryx melaporkan `email_verified=true` → link identity
    ke akun existing (semua link `owner_id` ikut akun tersebut).
  - Email sudah ada tetapi `email_verified=false` → halaman error
    "verifikasi email kamu di Nodryx dulu" (mencegah account takeover email palsu).

### Penyimpanan token Nodryx

- Per-session: 1 login pendekin = 1 rantai token Nodryx (tabel `nodryx_tokens`,
  PK = hash SHA-256 token session cookie, foreign key ke `account_sessions`).
- `refresh_token` **dienkripsi AES-256-GCM** dengan key turunan `APP_SECRET`
  (SHA-256). Hash SHA-256 tidak bisa dipakai untuk refresh karena refresh butuh
  nilai asli; enkripsi memberi keamanan setara cookie session.
- `access_token` (hidup 15 menit) ikut disimpan terenkripsi agar refresh bisa lazy.

### Refresh otomatis + rotasi wajib

- Helper `ValidAccessToken`:
  - Access token masih berlaku > 60 detik → pakai apa adanya.
  - Kurang dari itu → POST refresh ke Nodryx → **simpan pasangan BARU, buang yang lama**
    (aturan rotasi; token lama hanya toleransi 30 detik untuk request paralel).
  - Nodryx balas `invalid_grant` saat refresh → hapus baris token + hapus session
    lokal → user dipaksa login ulang (rantai token dicabut di sisi Nodryx;
    sesuai aturan pencurian token).
- Dipanggil oleh endpoint `GET /api/auth/nodryx/verify` (auth.Require) yang juga
  menjadi bukti acceptance "akses API dengan access token mengembalikan data user".

### Logout

`POST /api/auth/logout` (sudah ada) diperluas:

1. `RevokeForSession(sessionTokenHash)`: POST `{AUTH}/api/logout`
   body JSON `{"refresh_token": "…"}` — best-effort (timeout 5 detik; kegagalan
   jaringan tidak menggagalkan logout lokal).
2. Hapus baris `nodryx_tokens`.
3. Hapus session + cookie seperti sekarang.

Pengecekan acceptance: refresh ulang setelah logout → `invalid_grant`.

### `APP_URL`

Spec Nodryx mewajibkan nama `APP_URL`; aplikasi sudah punya `APP_BASE_URL`.
Solusinya: `APP_URL` diterima sebagai nama utama, `APP_BASE_URL` jadi fallback
(keduanya trim trailing slash). Redirect URI =
`{APP_URL}/api/auth/nodryx/callback` — **nilai inilah yang harus didaftarkan di
client Nodryx, persis per karakter.**

## Perubahan per file

### Backend

| # | File | Perubahan |
|---|------|-----------|
| 1 | `backend/config/config.go` | Field baru: `NodryxAuthURL`, `NodryxClientID`, `NodryxClientSecret` (env `NODRYX_AUTH_URL`, `NODRYX_CLIENT_ID`, `NODRYX_CLIENT_SECRET`), `AppURL` (`APP_URL` fallback `APP_BASE_URL`), helper `NodryxEnabled()`. |
| 2 | `backend/db/schema.go` | Append ke `stmts` (mekanisme migrasi idempotent yang sudah ada): `ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL`; tabel `auth_identities` (UNIQUE(provider, subject), FK→accounts ON DELETE CASCADE); tabel `oauth_flows` (state PK, code_verifier, redirect_to, expires_at); tabel `nodryx_tokens` (session_token_hash PK, refresh/access token terenkripsi BYTEA, access_expires_at). |
| 3 | `backend/auth/nodryx.go` **(BARU)** | Seluruh alur Nodryx di package `auth` (bisa pakai `startSession` langsung): PKCE S256 (verifier 64 byte random → base64url 86 char, charset `[A-Za-z0-9\-._~]`; challenge = `base64url(sha256(verifier))` tanpa padding); handler `Start` (validasi `redirect_to` wajib kosong/mulai `#/`, tanpa `//` — anti open-redirect; simpan flow; 302 ke authorize dengan scope `openid email profile`); handler `Callback` (state single-use: dicari lalu langsung didelete; tukar kode form-urlencoded `client_secret_post`; error OAuth → halaman HTML rapi, bukan 500, tanpa retry; userinfo → upsert → session → simpan rantai token → 302 `{APP_URL}/{redirect_to}`); handler `Verify`; `RevokeForSession`; halaman error HTML gaya `link/pages.go`. |
| 4 | `backend/auth/auth.go` | Hapus `Register`, `Login`, `ChangePassword`, `dummyHash`. `DeleteAccount` tanpa verifikasi password (session + guard JSON cukup) + revoke semua rantai Nodryx milik akun (best-effort) sebelum delete. `Logout` → panggil `RevokeForSession` dulu. |
| 5 | `backend/server/server.go` | Hapus route `POST /auth/register`, `POST /auth/login`, `POST /auth/password`. Tambah: `GET /auth/nodryx/start` (rate-limit tier auth), `GET /auth/nodryx/callback` (rate-limit tier auth), `GET /auth/nodryx/verify` (`auth.Require`). |
| 6 | `backend/auth/nodryx_test.go` **(BARU)** | Unit test gaya repo (murni, tanpa DB): vektor PKCE S256; pembentukan URL authorize + parameter token; validasi `redirect_to`; mapping error token endpoint (`invalid_grant`/`invalid_client`/`invalid_request`); rotasi refresh + enkripsi round-trip terhadap fake Nodryx via `httptest`. |

Catatan: `backend/auth/password.go` **tetap ada** — dipakai package `link` untuk
password-proteksi short link.

### Frontend

| # | File | Perubahan |
|---|------|-----------|
| 7 | `frontend/src/lib/api.ts` | Tipe `Account` dipindah ke sini (sebelumnya hidup di AuthModal). |
| 8 | `frontend/src/App.tsx` | Hapus AuthModal & state `authOpen`. Tombol "Log in" (header + layar members-only) → full-page redirect `window.location.href = \`${API_BASE}/auth/nodryx/start?redirect_to=${encodeURIComponent(location.hash)}\``. Setelah callback halaman reload; probe `/auth/me` yang sudah ada otomatis men-set `account`. |
| 9 | `frontend/src/components/AuthModal.tsx` | Dihapus. |
| 10 | `frontend/src/pages/Settings.tsx` | Hapus form ChangePassword. DeleteAccount tanpa input password (cukup dialog konfirmasi yang sudah ada). |

### Env & dokumentasi

| # | File | Perubahan |
|---|------|-----------|
| 11 | `.env.example`, `.env.prod.example`, `backend/.env.example` | Tambah `NODRYX_AUTH_URL`, `NODRYX_CLIENT_ID`, `NODRYX_CLIENT_SECRET` (komentar: server-side only, jangan pernah beri prefix `VITE_`), `APP_URL`. Komentar memuat redirect_uri yang harus didaftarkan persis: `https://<domain>/api/auth/nodryx/callback` (lokal: `http://localhost:5173/api/auth/nodryx/callback`) + origin dev & produksi yang harus terdaftar di client Nodryx. |
| 12 | `DEPLOY.md` | Bagian baru "Nodryx SSO": daftar env, langkah registrasi client di Nodryx (origin + redirect_uri), catatan tidak ada `VITE_*` baru sehingga secret mustahil masuk bundle. |

## Endpoint Nodryx yang dipakai (semua di `{AUTH}` = `NODRYX_AUTH_URL`)

| Endpoint | Fungsi | Dipanggil dari |
|---|---|---|
| `GET /api/oauth/authorize` | Redirect browser, bawa `code_challenge` S256 | handler `Start` (302) |
| `POST /api/oauth/token` (`grant_type=authorization_code`) | Tukar code + verifier + secret → pasangan token | handler `Callback` (server-side) |
| `GET /api/oauth/userinfo` | Profil user (`sub`, `email`, `email_verified`, `provider`) | `Callback` dan `Verify` |
| `POST /api/oauth/token` (`grant_type=refresh_token`) | Rotasi → pasangan BARU | `ValidAccessToken` |
| `POST /api/logout` | Cabut refresh token | `RevokeForSession` (logout & delete account) |
| `GET /api/me` | Alternatif verifikasi tanpa secret | (opsional, tidak wajib) |

## Catatan penting

- Placeholder `__ISI_*__` di superprompt belum diisi — tidak menghalangi implementasi
  karena semuanya env-driven. Owner tinggal mengisi `.env` dengan nilai asli lalu
  mendaftarkan origin + redirect_uri di dashboard Nodryx.
- **Dampak migrasi "Nodryx-only"**: user existing dengan akun password tetap login
  selama session cookie (maks. 30 hari) hidup; setelah itu mereka masuk lewat Nodryx —
  jika email Nodryx sama, akun ter-link otomatis dan semua link `owner_id` ikut;
  jika beda email, terbentuk akun baru.
- CORS backend tidak berubah (semua deployment same-origin: vite dev proxy, nginx,
  Vercel rewrite; `credentials: "include"` + cookie `pk_session` sudah berjalan).
- Route baru otomatis jalan di Vercel lewat rewrite `/api/:path*` yang sudah ada —
  tidak ada perubahan `vercel.json`.

## Checklist acceptance (definisi selesai)

- [ ] `go vet ./... && go test ./...` hijau; `bun run build` hijau.
- [ ] Login end-to-end jalan di lokal begitu owner mengisi `NODRYX_*` +
      mendaftarkan `http://localhost:5173/api/auth/nodryx/callback`.
- [ ] Callback memverifikasi state (single-use) & PKCE; state palsu/kedaluwarsa →
      halaman error wajar, bukan 500.
- [ ] Refresh menghasilkan pasangan token baru & tersimpan terenkripsi; yang lama dibuang.
- [ ] Logout mencabut refresh token di Nodryx (cek: refresh ulang → `invalid_grant`)
      + session lokal terhapus.
- [ ] Tidak ada secret di bundle browser (tidak ada env Nodryx ber-prefix `VITE_`).
- [ ] `GET /api/auth/nodryx/verify` mengembalikan data user yang benar dari userinfo
      dengan access token yang masih valid.
