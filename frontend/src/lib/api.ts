export const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export type Account = { id: number; email: string; name: string; createdAt: string };

// Login is exclusively via Nodryx SSO: the backend owns the OAuth flow and the
// session cookie, so the app only redirects there and never sees tokens.
export function loginRedirect() {
  const current = window.location.hash;
  const qs = current ? `?redirect_to=${encodeURIComponent(current)}` : "";
  window.location.href = `${API_BASE}/auth/nodryx/start${qs}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { response: { status: res.status, data } };
  return data as T;
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

// DELETE sends an (optionally empty) JSON body so it passes the server's JSON-only CSRF guard.
export function apiDelete<T>(path: string, body: unknown = {}): Promise<T> {
  return request<T>("DELETE", path, body);
}

export function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  const q = qs.toString();
  return request<T>("GET", q ? `${path}?${q}` : path);
}
