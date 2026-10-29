import { useState } from "react";
import Sheet from "./Sheet";
import { apiPost } from "../lib/api";
import { downloadText, csvCell } from "../lib/csv";
import { formatApiError } from "../lib/utils";
import { btnGhost, btnPrimary, field, label, parseTags } from "../lib/ui";

type Row = { url: string; short?: string; error?: string };

const MAX = 100;

// Shortens many URLs one by one through the normal create endpoint, so the
// account's rate limit applies; it stops early when the limit is hit.
export default function BulkShorten({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const urls = [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

  async function run() {
    if (!urls.length || busy) return;
    setBusy(true);
    const out: Row[] = urls.slice(0, MAX).map((url) => ({ url }));
    setRows([...out]);
    for (let i = 0; i < out.length; i++) {
      try {
        const d = await apiPost<{ shortURL: string }>("/links", { url: out[i].url, tags: parseTags(tags) });
        out[i] = { ...out[i], short: d.shortURL };
      } catch (err: any) {
        const limited = err?.response?.status === 429;
        out[i] = { ...out[i], error: limited ? "Rate limit reached" : formatApiError(err, "Failed") };
        if (limited) {
          for (let j = i + 1; j < out.length; j++) out[j] = { ...out[j], error: "Skipped (rate limit)" };
          setRows([...out]);
          break;
        }
      }
      setRows([...out]);
    }
    setBusy(false);
    onDone();
  }

  const done = rows.filter((r) => r.short);
  function exportCSV() {
    const lines = ["original_url,short_url,error", ...rows.map((r) => [r.url, r.short ?? "", r.error ?? ""].map(csvCell).join(","))];
    downloadText("﻿" + lines.join("\r\n") + "\r\n", `pendekin-bulk-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <Sheet
      kicker="Bulk shorten"
      title="Shorten many links"
      onClose={onClose}
      footer={
        <>
          {rows.length > 0 && !busy && <button onClick={exportCSV} className={btnGhost}>Download CSV</button>}
          <button onClick={run} disabled={busy || !urls.length} className={btnPrimary}>
            {busy ? `Shortening ${rows.filter((r) => r.short || r.error).length}/${rows.length}…` : `Shorten ${Math.min(urls.length, MAX)} link${urls.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="b-urls" className={`${label} px-1`}>URLs · one per line (max {MAX})</label>
          <textarea
            id="b-urls"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={"https://example.com/a\nhttps://example.com/b"}
            className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-neutral-600"
          />
          {urls.length > MAX && <p className="px-1 text-xs text-amber-400">Only the first {MAX} will be shortened.</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="b-tags" className={`${label} px-1`}>Tags for all (optional)</label>
          <input id="b-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="import, campaign" className={field} />
        </div>
        {rows.length > 0 && (
          <div>
            <p className={`${label} mb-2`}>{done.length} of {rows.length} shortened</p>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {rows.map((r) => (
                <li key={r.url} className="rounded-xl border border-neutral-900 px-3 py-2 text-xs">
                  <p className="truncate text-neutral-500">{r.url}</p>
                  {r.short ? <p className="truncate font-mono text-neutral-100">{r.short}</p> : r.error ? <p className="text-red-300">{r.error}</p> : <p className="text-neutral-600">Waiting…</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
