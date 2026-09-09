import { useEffect, useState } from "react";
import { Clock3, Copy, ExternalLink, Link2, QrCode, Search, Zap } from "lucide-react";
import { apiGet, apiPost } from "./lib/api";
import { APP_BASE_URL, CORNER_STYLES, DEFAULT_SETTINGS, QR_STYLES } from "./lib/constants";
import { formatApiError, loadRecent, saveRecent } from "./lib/utils";
import useQrCode from "./hooks/useQrCode";
import ColorPicker from "./components/ColorPicker";
import Select from "./components/Select";

type Recent = { short: string; original: string; createdAt: string };

export default function App() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [shortUrl, setShortUrl] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const [statsQuery, setStatsQuery] = useState("");
  const [statsData, setStatsData] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const qr = useQrCode();
  const previewDomain = APP_BASE_URL.replace(/^https?:\/\//, "");
  const slugPreview = customSlug.trim() ? `${APP_BASE_URL}/${customSlug.trim()}` : "";
  const createData = shortUrl || slugPreview || url.trim();

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    qr.render(createData, settings);
  }, [createData, settings, qr]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setMessage({ type: "error", text: "URL is required" });
      return;
    }
    setSubmitting(true);
    try {
      const data: any = await apiPost<{ shortURL: string; link: any }>("/links", {
        url,
        title,
        customSlug,
        expiresAt: expiresAt || null,
        qrConfig: settings,
      });
      setShortUrl(data.shortURL);
      setMessage({ type: "success", text: "Link created!" });
      const rec = { short: data.shortURL, original: url, createdAt: new Date().toISOString() };
      saveRecent(rec);
      setRecent(loadRecent());
    } catch (err: any) {
      setMessage({ type: "error", text: formatApiError(err, "Failed to create link") });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setMessage({ type: "success", text: "Copied!" });
    } catch {
      setMessage({ type: "error", text: "Copy failed" });
    }
  }

  async function handleStats() {
    const code = statsQuery.trim().split("/").filter(Boolean).pop() || statsQuery.trim();
    if (!code) return;
    setStatsLoading(true);
    try {
      const data: any = await apiGet(`/links/${code}/stats`);
      setStatsData(data.link);
    } catch (err: any) {
      setMessage({ type: "error", text: formatApiError(err, "Not found") });
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_50%_at_15%_5%,rgba(99,102,241,0.14),transparent),radial-gradient(ellipse_50%_40%_at_85%_8%,rgba(245,158,11,0.1),transparent),linear-gradient(180deg,#f8faff_0%,#eef0fb_100%)]" />
      {/* header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 border-b border-slate-200/60">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg">
              <Link2 size={18} />
            </div>
            <div>
              <p className="font-black tracking-tight leading-none">pendekin</p>
              <p className="text-[11px] text-slate-500 -mt-0.5">URL shortener • QR generator • no login</p>
            </div>
          </div>
          <a href="https://github.com" target="_blank" className="hidden sm:inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900">
            <ExternalLink size={14} /> Go + Vite + Bun
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-8 space-y-6">
        {message && (
          <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${message.type === "error" ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
            <Zap size={16} /> {message.text}
          </div>
        )}

        {/* create */}
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/80 bg-white/80 backdrop-blur shadow-xl p-5 md:p-7 space-y-5">
            <div className="flex items-center gap-2 text-slate-900 font-bold">
              <Link2 className="text-indigo-600" size={18} /> Create short link
              <span className="ml-auto text-xs font-normal text-slate-500 flex items-center gap-1">
                <Clock3 size={12} /> public • 5/min
              </span>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-slate-400">Destination URL *</label>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/very/long/url" className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 outline-none" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-widest text-slate-400">Title (optional)</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My campaign" className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-widest text-slate-400">Custom slug (4-32)</label>
                  <input value={customSlug} onChange={(e) => setCustomSlug(e.target.value)} placeholder="promo2026" className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 outline-none" />
                  {customSlug && <p className="text-xs text-slate-500 truncate">Preview: {slugPreview} <span className="text-slate-400">• domain: {previewDomain}</span></p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-slate-400">Expiry (optional, max 90d)</label>
                <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 outline-none" />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 disabled:opacity-60">
                  <Zap size={16} /> {submitting ? "Creating..." : "Shorten URL"}
                </button>
                {shortUrl && (
                  <button type="button" onClick={() => handleCopy(shortUrl)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold shadow-sm">
                    <Copy size={16} /> {copied === shortUrl ? "Copied!" : "Copy"} — {shortUrl}
                  </button>
                )}
              </div>
            </form>

            {/* QR appearance */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <p className="text-sm font-bold text-slate-900 flex items-center gap-2"><QrCode size={16} className="text-slate-500" /> QR appearance</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ColorPicker label="Dots" color={settings.dotsColor} onChange={(v) => setSettings((s) => ({ ...s, dotsColor: v }))} />
                <ColorPicker label="BG" color={settings.backgroundColor} onChange={(v) => setSettings((s) => ({ ...s, backgroundColor: v }))} />
                <div><p className="text-xs font-semibold text-slate-500 mb-1">Dots</p><Select value={settings.dotsType} onChange={(v) => setSettings((s) => ({ ...s, dotsType: v }))} options={[...QR_STYLES]} /></div>
                <div><p className="text-xs font-semibold text-slate-500 mb-1">Corners</p><Select value={settings.cornersType} onChange={(v) => setSettings((s) => ({ ...s, cornersType: v }))} options={[...CORNER_STYLES]} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={settings.gradient} onChange={(e) => setSettings((s) => ({ ...s, gradient: e.target.checked }))} /> Gradient
                {settings.gradient && <ColorPicker label="Grad 2" color={settings.gradientColor2} onChange={(v) => setSettings((s) => ({ ...s, gradientColor2: v }))} />}
              </label>
            </div>

            {/* stats lookup */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <p className="text-sm font-bold">Check stats</p>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <Search size={14} className="text-slate-400" />
                  <input value={statsQuery} onChange={(e) => setStatsQuery(e.target.value)} placeholder="paste short URL or code e.g. abc123" className="w-full bg-transparent text-sm outline-none" />
                </div>
                <button onClick={handleStats} disabled={statsLoading} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-50">
                  {statsLoading ? "..." : "View"}
                </button>
              </div>
              {statsData && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm space-y-1">
                  <p className="font-bold">{statsData.title || statsData.shortCode} — {statsData.short}</p>
                  <p className="text-slate-600 truncate">→ {statsData.original}</p>
                  <p>Clicks: <b>{statsData.clickCount}</b> • {statsData.isActive ? "Active" : "Inactive"} {statsData.expiresAt ? `• expires ${new Date(statsData.expiresAt).toLocaleString()}` : ""}</p>
                  <p className="text-xs text-slate-500">Created {new Date(statsData.createdAt).toLocaleString()}</p>
                </div>
              )}
            </div>
          </section>

          {/* QR preview */}
          <section className="rounded-3xl border border-white/80 bg-white/80 backdrop-blur shadow-xl p-5 md:p-7 space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">QR Preview</p>
            <div ref={qr.qrRef} className="flex min-h-[320px] items-center justify-center rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4" />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => qr.download("png", createData)} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Download PNG</button>
              <button onClick={() => qr.download("svg", createData)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">SVG</button>
              {shortUrl && <button onClick={() => handleCopy(shortUrl)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"><Copy size={14} className="inline mr-1" /> Copy link</button>}
            </div>
            <p className="text-xs text-slate-500">Data: <span className="font-mono break-all">{createData || "—"}</span></p>

            {recent.length > 0 && (
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <p className="text-sm font-bold">Recent (this browser)</p>
                <div className="space-y-2 max-h-[220px] overflow-auto pr-1">
                  {recent.map((r) => (
                    <div key={r.short} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-sm">
                      <p className="truncate flex-1"><span className="font-semibold text-indigo-600">{r.short}</span> <span className="text-slate-500">→ {r.original}</span></p>
                      <button onClick={() => handleCopy(r.short)} className="shrink-0 rounded-lg border px-2 py-1 text-xs"><Copy size={12} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={() => { localStorage.removeItem("pendekin_recent"); setRecent([]); }} className="text-xs text-slate-500 hover:text-slate-700">Clear recent</button>
              </div>
            )}
          </section>
        </div>

        <footer className="text-center text-xs text-slate-500 py-4">pendekin • Go + Vite + Bun + Tailwind • public shortener • no login • <a className="underline" href="/health" target="_blank">health</a> • <a className="underline" href="/api/health" target="_blank">api health</a></footer>
      </main>
    </div>
  );
}
