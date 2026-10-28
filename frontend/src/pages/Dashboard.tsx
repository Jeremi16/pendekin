import { useCallback, useEffect, useState } from "react";
import { BarChart3, Check, ChevronLeft, Clock, History, MousePointerClick, ChevronRight, Copy, Download, ExternalLink, Inbox, Lock, Pencil, Search, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { downloadText, fetchAllLinks, toCSV } from "../lib/csv";
import { formatApiError } from "../lib/utils";
import { btnDanger, btnGhost, btnPrimary, card, field, iconBtn, label, linkStatus, stripProto, type DashLink, type DayCount } from "../lib/ui";
import BarChart from "../components/BarChart";
import EditLinkDrawer, { Toggle } from "../components/EditLinkDrawer";
import AnalyticsPanel from "../components/AnalyticsPanel";
import Select from "../components/Select";
import Checkbox from "../components/Checkbox";

type Summary = { links: number; active: number; clicks: number; clicks7d: number; series: DayCount[] };
type Confirm = { title: string; body: string; action: string; run: () => Promise<void> };

const PAGE_SIZE = 20;

export default function Dashboard({ onToast }: { onToast: (t: { type: "success" | "error"; text: string }) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [links, setLinks] = useState<DashLink[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // debounced search
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("created");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<DashLink | null>(null);
  const [viewing, setViewing] = useState<DashLink | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [copied, setCopied] = useState("");
  const [exporting, setExporting] = useState(""); // "" idle, else "loaded/total"

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadSummary = useCallback(() => {
    apiGet<Summary>("/dashboard/summary").then(setSummary).catch(() => {});
  }, []);

  const loadLinks = useCallback(async () => {
    try {
      const d = await apiGet<{ links: DashLink[]; total: number }>("/dashboard/links", { search: query, status, sort, page, limit: PAGE_SIZE });
      setLinks(d.links);
      setTotal(d.total);
      setSelected(new Set());
    } catch (err) {
      onToast({ type: "error", text: formatApiError(err, "Failed to load links") });
    }
  }, [query, status, sort, page, onToast]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const refresh = () => {
    loadLinks();
    loadSummary();
  };

  function replaceLink(l: DashLink) {
    setLinks((ls) => ls?.map((x) => (x.id === l.id ? l : x)) ?? ls);
  }

  async function toggleActive(l: DashLink, v: boolean) {
    replaceLink({ ...l, isActive: v });
    try {
      const d = await apiPatch<{ link: DashLink }>(`/dashboard/links/${l.id}`, { isActive: v });
      replaceLink(d.link);
      loadSummary();
    } catch (err) {
      replaceLink(l);
      onToast({ type: "error", text: formatApiError(err, "Update failed") });
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      onToast({ type: "error", text: "Copy failed" });
    }
  }

  function askDelete(l: DashLink) {
    setConfirm({
      title: "Delete link?",
      body: `${stripProto(l.short)} will stop working immediately and its analytics will be removed. This can't be undone.`,
      action: "Delete",
      run: async () => {
        await apiDelete(`/dashboard/links/${l.id}`);
        onToast({ type: "success", text: "Link deleted" });
        refresh();
      },
    });
  }

  async function bulk(action: "activate" | "deactivate" | "delete") {
    const ids = [...selected];
    const run = async () => {
      const d = await apiPost<{ affected: number }>("/dashboard/links/bulk", { ids, action });
      onToast({ type: "success", text: `${d.affected} link${d.affected === 1 ? "" : "s"} ${action === "delete" ? "deleted" : action + "d"}` });
      refresh();
    };
    if (action === "delete") {
      setConfirm({ title: `Delete ${ids.length} links?`, body: "They will stop working immediately and their analytics will be removed. This can't be undone.", action: "Delete all", run });
    } else {
      try {
        await run();
      } catch (err) {
        onToast({ type: "error", text: formatApiError(err, "Bulk action failed") });
      }
    }
  }

  // CSV is built entirely in the browser; the server only serves paged JSON.
  async function exportCSV() {
    if (exporting) return;
    setExporting("0");
    try {
      const all = await fetchAllLinks((n, t) => setExporting(`${n}/${t}`));
      downloadText(toCSV(all), `pendekin-links-${new Date().toISOString().slice(0, 10)}.csv`);
      onToast({ type: "success", text: `Exported ${all.length} link${all.length === 1 ? "" : "s"}` });
    } catch (err) {
      onToast({ type: "error", text: formatApiError(err, "Export failed") });
    } finally {
      setExporting("");
    }
  }

  async function claim() {
    try {
      const d = await apiPost<{ claimed: number }>("/dashboard/claim", {});
      onToast({ type: "success", text: d.claimed ? `Added ${d.claimed} link${d.claimed === 1 ? "" : "s"} created from this network` : "No unclaimed links found from this network" });
      if (d.claimed) refresh();
    } catch (err) {
      onToast({ type: "error", text: formatApiError(err, "Claim failed") });
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allOnPage = !!links?.length && links.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(links?.map((l) => l.id)));
  const toggleOne = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={label}>Dashboard</p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight text-white">Your links</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={claim} className={btnGhost} title="Attach links you created before logging in, from this network">
            <Inbox size={14} /> Claim old links
          </button>
          <button onClick={exportCSV} disabled={!!exporting} className={btnGhost} aria-live="polite">
            <Download size={14} /> {exporting ? `Exporting ${exporting}…` : "Export CSV"}
          </button>
          <a href="#/" className={btnPrimary}>+ New link</a>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))_1.6fr]">
        <Tile k="Links" v={summary?.links} />
        <Tile k="Active" v={summary?.active} />
        <Tile k="Total clicks" v={summary?.clicks} />
        <Tile k="Clicks · 7d" v={summary?.clicks7d} />
        <div className={`${card} col-span-2 p-4 sm:col-span-4 lg:col-span-1`}>
          {summary ? <BarChart data={summary.series} height={44} /> : <div className="h-[84px]" />}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, URL or code" aria-label="Search links" className={`${field} pl-10`} />
        </div>
        <div className="flex gap-2">
          <Seg value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[["all", "All"], ["active", "Active"], ["inactive", "Off"], ["expired", "Expired"]]} label="Status" />
          <Select
            aria-label="Sort"
            value={sort}
            onChange={(v) => { setSort(v); setPage(1); }}
            align="right"
            className="w-44 shrink-0"
            options={[
              { value: "created", label: "Newest", icon: <Clock size={14} className="shrink-0" /> },
              { value: "oldest", label: "Oldest", icon: <History size={14} className="shrink-0" /> },
              { value: "clicks", label: "Most clicks", icon: <MousePointerClick size={14} className="shrink-0" /> },
            ]}
          />
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/95 py-1.5 pl-4 pr-1.5 shadow-xl shadow-black/50 backdrop-blur animate-fade-in">
          <span className="mr-auto text-sm text-white">{selected.size} selected</span>
          <button onClick={() => bulk("activate")} className={btnGhost}>Activate</button>
          <button onClick={() => bulk("deactivate")} className={btnGhost}>Turn off</button>
          <button onClick={() => bulk("delete")} className={btnDanger}><Trash2 size={14} /> Delete</button>
          <button onClick={() => setSelected(new Set())} aria-label="Clear selection" className={iconBtn}><X size={14} /></button>
        </div>
      )}

      {/* List */}
      <div className={`${card} overflow-hidden`}>
        <div className="hidden grid-cols-[28px_minmax(0,1fr)_90px_70px_120px] items-center gap-4 border-b border-neutral-900 px-4 py-2.5 md:grid">
          <Checkbox checked={allOnPage} indeterminate={!allOnPage && selected.size > 0} onChange={toggleAll} aria-label="Select all on page" />
          <span className={label}>Link</span>
          <span className={label}>Clicks</span>
          <span className={label}>Active</span>
          <span className={`${label} text-right`}>Actions</span>
        </div>

        {links === null ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-500">Loading…</p>
        ) : links.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="text-sm text-neutral-300">{query || status !== "all" ? "No links match these filters." : "No links yet."}</p>
            <p className="mt-1 text-xs text-neutral-500">{query || status !== "all" ? "Try clearing the search or status filter." : "Shorten your first link, or claim ones you made before logging in."}</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-900">
            {links.map((l) => {
              const st = linkStatus(l);
              return (
                <li key={l.id} className={`grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[28px_minmax(0,1fr)_90px_70px_120px] ${selected.has(l.id) ? "bg-neutral-900/70" : ""}`}>
                  <Checkbox checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} aria-label={`Select ${stripProto(l.short)}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <a href={l.short} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-white hover:underline">{stripProto(l.short)}</a>
                      {l.hasPassword && <Lock size={12} className="shrink-0 text-neutral-500" aria-label="Password protected" />}
                      {st !== "active" && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${st === "expired" ? "bg-amber-950/60 text-amber-300" : "bg-neutral-800 text-neutral-400"}`}>{st === "inactive" ? "off" : st}</span>}
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {l.title ? <span className="text-neutral-400">{l.title} · </span> : null}
                      {l.original}
                    </p>
                    <p className="mt-0.5 text-[11px] text-neutral-600">
                      {new Date(l.createdAt).toLocaleDateString()}
                      {l.expiresAt && ` · expires ${new Date(l.expiresAt).toLocaleString()}`}
                    </p>
                  </div>
                  {/* Mobile: meta row under the link; desktop: own columns */}
                  <div className="col-start-2 flex items-center justify-between gap-3 md:contents">
                    <span className="font-mono text-sm text-neutral-300">{l.clickCount}<span className="text-neutral-600 md:hidden"> clicks</span></span>
                    <Toggle checked={l.isActive} onChange={(v) => toggleActive(l, v)} label={`Active: ${stripProto(l.short)}`} />
                    <div className="flex justify-end">
                      <button onClick={() => copy(l.short)} aria-label="Copy" title="Copy" className={iconBtn}>{copied === l.short ? <Check size={15} /> : <Copy size={15} />}</button>
                      <button onClick={() => setViewing(l)} aria-label="Analytics" title="Analytics" className={iconBtn}><BarChart3 size={15} /></button>
                      <button onClick={() => setEditing(l)} aria-label="Edit" title="Edit" className={iconBtn}><Pencil size={15} /></button>
                      <button onClick={() => askDelete(l)} aria-label="Delete" title="Delete" className={`${iconBtn} hover:text-red-300`}><Trash2 size={15} /></button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>{total} links</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" className={btnGhost}><ChevronLeft size={14} /></button>
            <span className="font-mono text-xs">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page" className={btnGhost}><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {editing && (
        <EditLinkDrawer
          link={editing}
          onClose={() => setEditing(null)}
          onSaved={(l) => {
            replaceLink(l);
            setEditing(null);
            loadSummary();
            onToast({ type: "success", text: "Link updated" });
          }}
        />
      )}
      {viewing && <AnalyticsPanel link={viewing} onClose={() => setViewing(null)} />}
      {confirm && <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} onError={(t) => onToast({ type: "error", text: t })} />}

      <p className="flex items-center justify-center gap-1.5 text-xs text-neutral-600">
        <ExternalLink size={11} /> Short links open for visitors without login. Turned-off, expired and protected links show a pendekin page.
      </p>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: number | undefined }) {
  return (
    <div className={`${card} flex flex-col justify-between px-4 py-3.5`}>
      <p className={label}>{k}</p>
      <p className="mt-1.5 text-2xl font-medium tracking-tight text-white">{v === undefined ? "—" : v.toLocaleString()}</p>
    </div>
  );
}

function Seg({ value, onChange, options, label: aria }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={aria} className="flex rounded-full border border-neutral-800 p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1.5 text-xs transition ${value === v ? "bg-white font-semibold text-black" : "text-neutral-400 hover:text-white"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function ConfirmDialog({ c, onClose, onError }: { c: Confirm; onClose: () => void; onError: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function go() {
    setBusy(true);
    try {
      await c.run();
      onClose();
    } catch (err) {
      onError(formatApiError(err, "Action failed"));
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cf-title" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-neutral-800 bg-[#0d0d0d] p-6 animate-fade-in">
        <h2 id="cf-title" className="text-lg font-medium text-white">{c.title}</h2>
        <p className="mt-2 text-sm text-neutral-400">{c.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost} autoFocus>Cancel</button>
          <button onClick={go} disabled={busy} className="inline-flex items-center justify-center rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50">
            {busy ? "Working…" : c.action}
          </button>
        </div>
      </div>
    </div>
  );
}
