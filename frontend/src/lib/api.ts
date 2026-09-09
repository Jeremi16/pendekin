const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { response: { status: res.status, data } };
  return data as T;
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    });
  }
  // If API_BASE is absolute, use it directly
  const fetchUrl = API_BASE.startsWith("http") ? `${API_BASE}${path}${url.search}` : url.pathname + url.search;
  const res = await fetch(fetchUrl);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { response: { status: res.status, data } };
  return data as T;
}
