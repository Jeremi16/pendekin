// Shared Tailwind class tokens (nodryx-style dark UI).
export const label = "text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500";
export const field =
  "w-full rounded-full border border-neutral-800 bg-neutral-900/60 px-4 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none transition focus:border-neutral-600";
export const card = "rounded-3xl border border-neutral-800 bg-neutral-900/40";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-800 px-4 py-2 text-sm text-neutral-300 transition hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-red-900/70 px-4 py-2 text-sm text-red-300 transition hover:bg-red-950/50 disabled:opacity-50";
export const iconBtn = "rounded-full p-2 text-neutral-500 transition hover:bg-neutral-800 hover:text-white";

export type DashLink = {
  id: number;
  title: string | null;
  original: string;
  short: string;
  shortCode: string;
  isActive: boolean;
  expiresAt: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  qrConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string | null;
  hasPassword: boolean;
  maxClicks: number | null;
  tags: string[];
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
};

export type DayCount = { date: string; count: number };
export type LabelCount = { label: string; count: number };

// "a, b ,c" → ["a","b","c"]
export function parseTags(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

// Adds UTM parameters to a URL, keeping any existing query string.
export function withUtm(url: string, utm: { source: string; medium: string; campaign: string }): string {
  const entries = Object.entries(utm).filter(([, v]) => v.trim());
  if (!entries.length) return url;
  const t = url.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    entries.forEach(([k, v]) => u.searchParams.set(`utm_${k}`, v.trim()));
    return u.toString();
  } catch {
    return url;
  }
}

export function stripProto(u: string) {
  return u.replace(/^https?:\/\//, "");
}

// Converts an ISO timestamp to the value format of <input type="datetime-local"> in local time.
export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function linkStatus(l: DashLink): "active" | "inactive" | "expired" | "limit" {
  if (!l.isActive) return "inactive";
  if (l.maxClicks !== null && l.clickCount >= l.maxClicks) return "limit";
  if (l.expiresAt && new Date(l.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}
