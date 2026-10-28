import { useState } from "react";
import type { DayCount } from "../lib/ui";

// Minimal dependency-free SVG bar chart for daily click counts.
export default function BarChart({ data, height = 120 }: { data: DayCount[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = Math.max(1, data.length);
  const gap = n > 30 ? 1 : 2;
  const total = data.reduce((s, d) => s + d.count, 0);
  const shown = hover !== null ? data[hover] : null;
  const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs text-neutral-500">
        <span>{shown ? fmt(shown.date) : `Last ${data.length} days`}</span>
        <span className="font-mono text-neutral-300">{shown ? shown.count : total} clicks</span>
      </div>
      <svg
        viewBox={`0 0 ${n * 10} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`Clicks per day, ${total} total over ${data.length} days`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={n * 10} y1={height - 0.5} y2={height - 0.5} stroke="#262626" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = d.count === 0 ? 0 : Math.max(2, (d.count / max) * (height - 8));
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={i * 10} y={0} width={10} height={height} fill="transparent" />
              <rect
                x={i * 10 + gap / 2}
                y={height - h}
                width={10 - gap}
                height={h}
                rx={1.5}
                fill={hover === i ? "#ffffff" : "#a3a3a3"}
              />
            </g>
          );
        })}
      </svg>
      {data.length > 0 && (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-600">
          <span>{fmt(data[0].date)}</span>
          <span>{fmt(data[data.length - 1].date)}</span>
        </div>
      )}
    </div>
  );
}
