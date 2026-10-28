import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import Select from "./Select";
import { cn } from "../lib/utils";

type Props = {
  value: string; // "" | "YYYY-MM-DDTHH:mm" local time (datetime-local format)
  onChange: (v: string) => void;
  id?: string;
  maxDays?: number;
  className?: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const PRESETS: { label: string; ms: number }[] = [
  { label: "1h", ms: 3_600_000 },
  { label: "24h", ms: 86_400_000 },
  { label: "7d", ms: 7 * 86_400_000 },
  { label: "30d", ms: 30 * 86_400_000 },
  { label: "90d", ms: 90 * 86_400_000 },
];
const PANEL_HEIGHT = 340;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }));

const pad = (n: number) => String(n).padStart(2, "0");

function parseLocal(v: string) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Backend rejects expiry in the past or beyond maxDays, so clamp selections into that window.
function clampExpiry(d: Date, maxDays: number) {
  const min = new Date(Date.now() + 60_000);
  min.setSeconds(0, 0);
  const max = new Date(Date.now() + maxDays * 86_400_000);
  return d < min ? min : d > max ? max : d;
}

// Custom calendar replacing <input type="datetime-local">, whose popup can't be styled.
export default function ExpiryPicker({ value, onChange, id, maxDays = 90, className }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => new Date());
  const [sel, setSel] = useState<Date | null>(null);
  const [hour, setHour] = useState("23");
  const [minute, setMinute] = useState("59");
  // Snapshot of "now", refreshed when the panel opens, so render stays pure.
  const [now, setNow] = useState(() => Date.now());
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // stopPropagation keeps Escape from closing a wrapping Sheet at the same time
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openPanel() {
    const current = parseLocal(value);
    const base = current ?? new Date();
    setNow(Date.now());
    setSel(current);
    setHour(String(current ? current.getHours() : 23));
    setMinute(String(current ? current.getMinutes() : 59));
    setView(new Date(base.getFullYear(), base.getMonth(), 1));
    // Open upward when there is not enough room below the trigger.
    const rect = ref.current?.getBoundingClientRect();
    setFlip(!!rect && window.innerHeight - rect.bottom < PANEL_HEIGHT && rect.top > PANEL_HEIGHT);
    setOpen(true);
  }

  function apply(d: Date | null) {
    setSel(d);
    onChange(d ? toInput(d) : "");
    if (d) {
      setHour(String(d.getHours()));
      setMinute(String(d.getMinutes()));
    }
  }

  function pickDay(day: Date) {
    apply(clampExpiry(new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(hour), Number(minute)), maxDays));
  }

  function changeTime(h: string, m: string) {
    setHour(h);
    setMinute(m);
    if (sel) apply(clampExpiry(new Date(sel.getFullYear(), sel.getMonth(), sel.getDate(), Number(h), Number(m)), maxDays));
  }

  const today = new Date(now);
  const maxDay = startOfDay(new Date(now + maxDays * 86_400_000));
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="flex w-full items-center gap-2.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-4 py-2.5 text-left text-sm outline-none transition hover:border-neutral-600 focus-visible:border-neutral-500"
      >
        <Calendar size={15} className="shrink-0 text-neutral-500" />
        <span className={cn("flex-1 truncate", sel ? "text-neutral-100" : "text-neutral-600")}>
          {sel
            ? sel.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "No expiry"}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Pick expiry date"
          className={`absolute z-50 w-[320px] rounded-2xl border border-neutral-800 bg-[#0d0d0d]/95 p-3 shadow-2xl shadow-black backdrop-blur animate-fade-in ${flip ? "bottom-full mb-2" : "left-0 top-full mt-2"}`}
        >
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                title={`Expires in ${p.label}`}
                onClick={() => apply(new Date(Date.now() + p.ms))}
                className="rounded-full border border-neutral-800 px-2.5 py-1 text-[11px] text-neutral-400 transition hover:border-neutral-600 hover:text-white"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mb-1 flex items-center justify-between px-1">
            <p className="text-sm font-medium text-white">{view.toLocaleString(undefined, { month: "long", year: "numeric" })}</p>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7">
            {WEEKDAYS.map((w) => (
              <p key={w} className="py-1 text-center text-[10px] font-semibold uppercase text-neutral-600">
                {w}
              </p>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const outside = d.getMonth() !== view.getMonth();
              const disabled = d < startOfDay(today) || d > maxDay;
              const selected = !!sel && sameDay(d, sel);
              return (
                <div key={i} className="flex justify-center">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={d.toDateString()}
                    onClick={() => pickDay(d)}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-[13px] transition",
                      disabled && "cursor-not-allowed text-neutral-700",
                      !disabled && !selected && (outside ? "text-neutral-600 hover:bg-neutral-800/60" : "text-neutral-300 hover:bg-neutral-800"),
                      selected && "bg-white font-semibold text-black",
                      !selected && sameDay(d, today) && "ring-1 ring-neutral-600"
                    )}
                  >
                    {d.getDate()}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-2 border-t border-neutral-800 pt-3">
            <div className="min-w-0 flex-1">
              <Select aria-label="Hour" value={hour} onChange={(h) => changeTime(h, minute)} options={HOUR_OPTIONS} />
            </div>
            <span className="text-neutral-600">:</span>
            <div className="min-w-0 flex-1">
              <Select aria-label="Minute" value={minute} onChange={(m) => changeTime(hour, m)} options={MINUTE_OPTIONS} />
            </div>
            <button
              type="button"
              onClick={() => apply(null)}
              disabled={!sel}
              className="shrink-0 rounded-full px-3 py-2 text-xs text-neutral-500 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
