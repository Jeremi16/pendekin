import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import BarChart from "./BarChart";
import { apiGet } from "../lib/api";
import { formatApiError } from "../lib/utils";
import { label, stripProto, type DashLink, type DayCount, type LabelCount } from "../lib/ui";

type Analytics = { days: number; series: DayCount[]; referrers: LabelCount[]; devices: LabelCount[]; browsers: LabelCount[] };

const RANGES = [7, 30, 90] as const;

export default function AnalyticsPanel({ link, onClose }: { link: DashLink; onClose: () => void }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    apiGet<Analytics>(`/dashboard/links/${link.id}/analytics`, { days })
      .then((d) => live && (setData(d), setError("")))
      .catch((err) => live && setError(formatApiError(err, "Failed to load analytics")));
    return () => {
      live = false;
    };
  }, [link.id, days]);

  return (
    <Sheet kicker="Analytics" title={link.title || stripProto(link.short)} onClose={onClose}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="truncate text-xs text-neutral-500">→ {link.original}</p>
          <div className="flex shrink-0 rounded-full border border-neutral-800 p-0.5" role="tablist" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={days === r}
                onClick={() => setDays(r)}
                className={`rounded-full px-3 py-1 text-xs transition ${days === r ? "bg-white font-semibold text-black" : "text-neutral-400 hover:text-white"}`}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">{error}</p>}

        {!data ? (
          <p className="py-10 text-center text-sm text-neutral-500">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat k="All-time clicks" v={link.clickCount} />
              <Stat k="Last click" v={link.lastClickedAt ? new Date(link.lastClickedAt).toLocaleDateString() : "—"} />
            </div>
            <div className="rounded-2xl border border-neutral-800 p-4">
              <BarChart data={data.series} />
            </div>
            <Breakdown title="Top referrers" rows={data.referrers} />
            <Breakdown title="Devices" rows={data.devices} />
            <Breakdown title="Browsers" rows={data.browsers} />
          </>
        )}
      </div>
    </Sheet>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800 px-4 py-3">
      <p className={label}>{k}</p>
      <p className="mt-1 text-xl font-medium text-white">{v}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: LabelCount[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div>
      <p className={`${label} mb-2`}>{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">No clicks in this range.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const pct = total ? Math.round((r.count / total) * 100) : 0;
            return (
              <li key={r.label} className="relative overflow-hidden rounded-xl border border-neutral-900 px-3 py-2 text-sm">
                <span className="absolute inset-y-0 left-0 bg-neutral-800/60" style={{ width: `${pct}%` }} aria-hidden />
                <span className="relative flex justify-between gap-3">
                  <span className="truncate text-neutral-200">{r.label}</span>
                  <span className="shrink-0 font-mono text-xs text-neutral-400">{r.count} · {pct}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
