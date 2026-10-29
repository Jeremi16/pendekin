import { useCallback, useEffect, useState } from "react";
import { BarChart3, Check, Copy, CornerDownRight, ExternalLink, Link2, LogIn, QrCode, History, Settings as SettingsIcon, X } from "lucide-react";
import { apiGet, apiPost, loginRedirect, type Account } from "./lib/api";
import { APP_BASE_URL, CORNER_STYLES, DEFAULT_SETTINGS, QR_STYLES } from "./lib/constants";
import { cn, formatApiError, loadRecent, plausibleUrl, saveRecent } from "./lib/utils";
import useQrCode from "./hooks/useQrCode";
import ColorPicker from "./components/ColorPicker";
import Select from "./components/Select";
import Checkbox from "./components/Checkbox";
import ExpiryPicker from "./components/ExpiryPicker";
import AccountMenu from "./components/AccountMenu";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import { btnPrimary, field, label, parseTags, withUtm } from "./lib/ui";

type Recent = { short: string; original: string; createdAt: string };
type Window = { limit: number; remaining: number; resetAt: string };
type Quota = { tier: "anonymous" | "account"; minute: Window; day: Window };
type Route = "home" | "dashboard" | "settings";
type Toast = { type: "success" | "error"; text: string };

function parseRoute(hash: string): Route {
  if (hash.startsWith("#/dashboard")) return "dashboard";
  if (hash.startsWith("#/settings")) return "settings";
  return "home";
}

function go(route: Route) {
  window.location.hash = route === "home" ? "#/" : `#/${route}`;
}

function secondsUntil(iso: string, now: number) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

function formatWait(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  return `${Math.ceil(s / 3600)}h`;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxClicks, setMaxClicks] = useState("");
  const [tags, setTags] = useState("");
  const [utm, setUtm] = useState({ source: "", medium: "", campaign: "" });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [panel, setPanel] = useState<"none" | "options" | "qr">("none");
  const [shortUrl, setShortUrl] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState("");
  const [recent, setRecent] = useState<Recent[]>(loadRecent);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsQuery, setStatsQuery] = useState("");
  const [statsData, setStatsData] = useState<any>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [toast, setToast] = useState<Toast | null>(null);

  const qr = useQrCode();
  const qrPreview = useQrCode();
  const previewDomain = APP_BASE_URL.replace(/^https?:\/\//, "");

  const refreshQuota = useCallback(async () => {
    try {
      setQuota(await apiGet<Quota>("/quota"));
    } catch {
      /* quota display is best-effort */
    }
  }, []);

  useEffect(() => {
    refreshQuota();
    apiGet<{ account: Account | null }>("/auth/me")
      .then((d) => setAccount(d.account))
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, [refreshQuota]);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const showToast = useCallback((t: Toast) => setToast(t), []);

  async function handleLogout() {
    try {
      await apiPost("/auth/logout", {});
    } catch {
      /* cookie is cleared server-side; ignore network errors */
    }
    setAccount(null);
    go("home");
    refreshQuota();
  }

  // Tick while a window is exhausted so the countdown updates and the quota refills.
  const blocked = quota ? [quota.minute, quota.day].find((w) => w.remaining === 0) : undefined;
  const wait = blocked ? secondsUntil(blocked.resetAt, now) : 0;
  useEffect(() => {
    if (!blocked) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [blocked]);
  useEffect(() => {
    if (blocked && wait === 0) refreshQuota();
  }, [blocked, wait, refreshQuota]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (shortUrl) qr.render(shortUrl, settings);
  }, [shortUrl, settings, qr]);

  const qrPreviewData = plausibleUrl(url) ? url.trim() : `https://${previewDomain}`;
  useEffect(() => {
    if (panel === "qr") qrPreview.render(qrPreviewData, settings);
  }, [panel, qrPreviewData, settings, qrPreview]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || submitting || blocked) return;
    setSubmitting(true);
    setError("");
    try {
      const dest = withUtm(url, utm);
      const data = await apiPost<{ shortURL: string }>("/links", {
        url: dest,
        title,
        customSlug,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        qrConfig: settings,
        maxClicks: maxClicks ? Number(maxClicks) : null,
        tags: parseTags(tags),
      });
      setShortUrl(data.shortURL);
      saveRecent({ short: data.shortURL, original: dest, createdAt: new Date().toISOString() });
      setRecent(loadRecent());
      setUrl("");
      setTitle("");
      setCustomSlug("");
      setExpiresAt("");
      setMaxClicks("");
      setTags("");
      setUtm({ source: "", medium: "", campaign: "" });
      setPanel("none");
    } catch (err: any) {
      setError(
        err?.response?.status === 429 ? "Rate limit reached — please wait before shortening again." : formatApiError(err, "Failed to create link")
      );
    } finally {
      setSubmitting(false);
      setNow(Date.now());
      refreshQuota();
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setError("Copy failed");
    }
  }

  async function handleStats(e: React.FormEvent) {
    e.preventDefault();
    const code = statsQuery.trim().split("/").filter(Boolean).pop();
    if (!code) return;
    try {
      const data = await apiGet<{ link: any }>(`/links/${code}/stats`);
      setStatsData(data.link);
    } catch (err: any) {
      setStatsData(null);
      setError(formatApiError(err, "Not found — stats are only visible to the link's creator"));
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <a href="#/" className="font-mono text-sm font-bold tracking-[0.35em] text-white">PENDEKIN</a>
        <div className="flex items-center gap-2">
          {account ? (
            <AccountMenu account={account} onDashboard={() => go("dashboard")} onSettings={() => go("settings")} onLogout={handleLogout} />
          ) : (
            <>
              <button
                onClick={() => setStatsOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-white"
              >
                <BarChart3 size={13} /> Stats
              </button>
              <button
                onClick={loginRedirect}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-neutral-200"
              >
                <LogIn size={13} /> Log in
              </button>
            </>
          )}
        </div>
      </header>

      {route !== "home" ? (
        <main className="flex-1 pt-2">
          {!authChecked ? (
            <p className="py-20 text-center text-sm text-neutral-500">Loading…</p>
          ) : !account ? (
            <div className="mx-auto max-w-sm px-4 py-20 text-center">
              <p className={label}>Members only</p>
              <h1 className="mt-2 text-2xl font-medium tracking-tight text-white">Log in to continue</h1>
              <p className="mt-1 text-sm text-neutral-500">The dashboard lets you edit, pause, protect and track your links.</p>
              <button onClick={loginRedirect} className={`${btnPrimary} mt-6`}><LogIn size={14} /> Log in</button>
            </div>
          ) : route === "dashboard" ? (
            <Dashboard onToast={showToast} />
          ) : (
            <Settings account={account} onToast={showToast} onDeleted={() => { setAccount(null); go("home"); refreshQuota(); }} />
          )}
        </main>
      ) : (
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <div className="w-full max-w-2xl animate-fade-in">
          <div className="mb-8 flex items-center justify-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black">
              <Link2 size={18} strokeWidth={2.5} />
            </div>
            <h1 className="text-3xl font-medium tracking-tight text-white">pendekin</h1>
          </div>

          {/* Composer */}
          <form onSubmit={handleCreate} className="rounded-[26px] border border-neutral-800 bg-neutral-900/70 p-3 shadow-2xl shadow-black/40 transition focus-within:border-neutral-700">
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a long link to shorten…"
              className="w-full bg-transparent px-2 pb-3 pt-1 text-[15px] text-white placeholder:text-neutral-500 outline-none"
            />
            {plausibleUrl(url) && (
              <div
                className="flex animate-fade-in items-center gap-1.5 px-2 pb-2"
                title={customSlug.trim() ? `${previewDomain}/${customSlug.trim()}` : "The short code is generated once you shorten"}
              >
                <CornerDownRight size={13} className="shrink-0 text-neutral-600" />
                <p className="min-w-0 truncate font-mono text-[12.5px] text-neutral-400">
                  <span className="text-neutral-500">{previewDomain}</span>/
                  {customSlug.trim() ? (
                    <span className="text-neutral-100">{customSlug.trim()}</span>
                  ) : (
                    <span className="tracking-[0.25em] text-neutral-600">·······</span>
                  )}
                </p>
              </div>
            )}
            <div className="flex items-center gap-1">
              <IconToggle active={panel === "options"} onClick={() => setPanel(panel === "options" ? "none" : "options")} title="Options">
                <SettingsIcon size={16} />
              </IconToggle>
              <IconToggle active={panel === "qr"} onClick={() => setPanel(panel === "qr" ? "none" : "qr")} title="QR style">
                <QrCode size={16} />
              </IconToggle>

              <div className="ml-auto flex items-center gap-3">
                {quota && <QuotaBadge quota={quota} wait={wait} />}
                <button
                  disabled={!url.trim() || submitting || !!blocked}
                  aria-label="Shorten"
                  className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                >
                  {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-black" /> : <Link2 size={14} strokeWidth={2.5} />}
                  Shorten
                </button>
              </div>
            </div>

            {panel === "options" && (
              <div className="mt-3 grid gap-3 border-t border-neutral-800 px-1 pt-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className={label}>Custom slug</p>
                  <input value={customSlug} onChange={(e) => setCustomSlug(e.target.value)} placeholder="promo2026" className={field} />
                </div>
                <div className="space-y-1.5">
                  <p className={label}>Title</p>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My campaign" className={field} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <p className={label}>Expires (max 90 days)</p>
                  <ExpiryPicker value={expiresAt} onChange={setExpiresAt} />
                </div>
                <div className="space-y-1.5">
                  <p className={label}>Click limit</p>
                  <input type="number" min={1} inputMode="numeric" value={maxClicks} onChange={(e) => setMaxClicks(e.target.value)} placeholder="Unlimited" className={field} />
                </div>
                <div className="space-y-1.5">
                  <p className={label}>Tags</p>
                  <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="promo, instagram" className={field} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <p className={label}>UTM parameters</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input value={utm.source} onChange={(e) => setUtm((u) => ({ ...u, source: e.target.value }))} placeholder="source · instagram" aria-label="utm_source" className={field} />
                    <input value={utm.medium} onChange={(e) => setUtm((u) => ({ ...u, medium: e.target.value }))} placeholder="medium · social" aria-label="utm_medium" className={field} />
                    <input value={utm.campaign} onChange={(e) => setUtm((u) => ({ ...u, campaign: e.target.value }))} placeholder="campaign · promo" aria-label="utm_campaign" className={field} />
                  </div>
                  {plausibleUrl(url) && (utm.source || utm.medium || utm.campaign) && (
                    <p className="truncate px-1 font-mono text-[11px] text-neutral-500" title={withUtm(url, utm)}>→ {withUtm(url, utm)}</p>
                  )}
                </div>
              </div>
            )}

            {panel === "qr" && (
              <div className="mt-3 flex flex-col gap-4 border-t border-neutral-800 px-1 pt-4 sm:flex-row sm:gap-5">
                <div className="flex shrink-0 flex-col items-center gap-1.5 sm:w-32">
                  <div ref={qrPreview.qrRef} className="w-28 overflow-hidden rounded-2xl border border-neutral-800 [&>canvas]:h-auto [&>canvas]:w-full [&>svg]:h-auto [&>svg]:w-full" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-600">Live preview</p>
                </div>
                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                  <ColorPicker label="Dots" color={settings.dotsColor} onChange={(v) => setSettings((s) => ({ ...s, dotsColor: v }))} />
                  <ColorPicker label="Background" color={settings.backgroundColor} onChange={(v) => setSettings((s) => ({ ...s, backgroundColor: v }))} />
                  <div className="space-y-1.5">
                    <p className={label}>Dots style</p>
                    <Select value={settings.dotsType} onChange={(v) => setSettings((s) => ({ ...s, dotsType: v }))} options={[...QR_STYLES]} />
                  </div>
                  <div className="space-y-1.5">
                    <p className={label}>Corners</p>
                    <Select value={settings.cornersType} onChange={(v) => setSettings((s) => ({ ...s, cornersType: v }))} options={[...CORNER_STYLES]} />
                  </div>
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <Checkbox label="Gradient" checked={settings.gradient} onChange={(v) => setSettings((s) => ({ ...s, gradient: v }))} />
                    {settings.gradient && (
                      <div className="min-w-0 flex-1">
                        <ColorPicker label="Gradient to" color={settings.gradientColor2} onChange={(v) => setSettings((s) => ({ ...s, gradientColor2: v }))} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </form>

          {account && shortUrl && (
            <p className="mt-2 px-2 text-xs text-neutral-500">
              Saved to your account — manage it in the <a href="#/dashboard" className="text-neutral-300 underline-offset-2 hover:underline">dashboard</a>.
            </p>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">
              <span className="flex-1">{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss"><X size={14} /></button>
            </div>
          )}

          {/* Result */}
          {shortUrl && (
            <div className="mt-4 flex flex-col gap-4 rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 sm:flex-row sm:items-center">
              <div ref={qr.qrRef} className="mx-auto w-36 shrink-0 overflow-hidden rounded-2xl [&>canvas]:h-auto [&>canvas]:w-full [&>svg]:h-auto [&>svg]:w-full" />
              <div className="min-w-0 flex-1 space-y-3">
                <p className={label}>Your short link</p>
                <a href={shortUrl} target="_blank" rel="noreferrer" className="block truncate text-lg font-medium text-white hover:underline">
                  {shortUrl.replace(/^https?:\/\//, "")}
                </a>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleCopy(shortUrl)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200">
                    {copied === shortUrl ? <Check size={14} /> : <Copy size={14} />} {copied === shortUrl ? "Copied" : "Copy"}
                  </button>
                  <PillButton onClick={() => qr.download("png", shortUrl)}>PNG</PillButton>
                  <PillButton onClick={() => qr.download("svg", shortUrl)}>SVG</PillButton>
                  <a href={shortUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white">
                    <ExternalLink size={14} /> Open
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Stats lookup */}
          {statsOpen && (
            <form onSubmit={handleStats} className="mt-4 space-y-3 rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4">
              <p className={label}>Link stats</p>
              <div className="flex gap-2">
                <input value={statsQuery} onChange={(e) => setStatsQuery(e.target.value)} placeholder="Short URL or code" className={field} />
                <button className="rounded-full bg-white px-5 text-sm font-semibold text-black hover:bg-neutral-200">View</button>
              </div>
              {statsData && (
                <div className="space-y-1 px-2 text-sm text-neutral-400">
                  <p className="font-medium text-white">{statsData.title || statsData.shortCode}</p>
                  <p className="truncate">→ {statsData.original}</p>
                  <p>
                    <span className="text-white">{statsData.clickCount}</span> clicks · {statsData.isActive ? "active" : "inactive"}
                    {statsData.expiresAt && ` · expires ${new Date(statsData.expiresAt).toLocaleString()}`}
                  </p>
                </div>
              )}
            </form>
          )}

          {/* Recent */}
          {recent.length > 0 && (
            <div className="mt-8 px-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs text-neutral-500"><History size={12} /> Recent</p>
                <button onClick={() => { localStorage.removeItem("pendekin_recent"); setRecent([]); }} className="text-xs text-neutral-600 hover:text-neutral-300">Clear</button>
              </div>
              <ul className="divide-y divide-neutral-900">
                {recent.slice(0, 5).map((r) => (
                  <li key={r.short} className="group flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-200">{r.short.replace(/^https?:\/\//, "")}</p>
                      <p className="truncate text-xs text-neutral-500">{r.original}</p>
                    </div>
                    <button onClick={() => handleCopy(r.short)} aria-label="Copy" className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-900 hover:text-white">
                      {copied === r.short ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
      )}

      {toast && (
        <div role="status" className={`fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border px-5 py-2.5 text-sm shadow-2xl shadow-black animate-fade-in ${toast.type === "error" ? "border-red-900/70 bg-red-950 text-red-200" : "border-neutral-700 bg-neutral-900 text-white"}`}>
          {toast.text}
        </div>
      )}

      <footer className="flex justify-center gap-6 pb-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-600">
        <span>No login required</span>
        <a href="/api/health" target="_blank" className="hover:text-neutral-300">Status</a>
      </footer>
    </div>
  );
}

function IconToggle({ active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full transition",
        active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function PillButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className="rounded-full border border-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white" />;
}

function QuotaBadge({ quota, wait }: { quota: Quota; wait: number }) {
  const { minute, day } = quota;
  if (wait > 0) {
    return <span className="text-xs text-amber-400">Limit reached · {formatWait(wait)}</span>;
  }
  return (
    <span
      className="hidden font-mono text-[11px] text-neutral-500 sm:inline"
      title={`${minute.remaining}/${minute.limit} per minute · ${day.remaining}/${day.limit} per day`}
    >
      {minute.remaining}/{minute.limit} min · {day.remaining}/{day.limit} day
    </span>
  );
}
