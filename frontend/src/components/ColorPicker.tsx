import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";

type Props = { label: string; color: string; onChange: (v: string) => void; className?: string };

const PRESETS = ["#000000", "#ffffff", "#0f172a", "#0ea5e9", "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6"];
const PANEL_HEIGHT = 340;

type Hsv = { h: number; s: number; v: number };
type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb | null {
  const m = hex.replace("#", "").toLowerCase();
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-f]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: Rgb) {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let rgb: [number, number, number] = [0, 0, 0];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: Math.round((rgb[0] + m) * 255), g: Math.round((rgb[1] + m) * 255), b: Math.round((rgb[2] + m) * 255) };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Custom dark picker replacing <input type="color">, whose popup can't be styled.
export default function ColorPicker({ label, color, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [hsv, setHsv] = useState<Hsv>({ h: 0, s: 0, v: 0 });
  const [hexDraft, setHexDraft] = useState(color);
  const ref = useRef<HTMLDivElement>(null);
  const areaDrag = useRef(false);
  const hueDrag = useRef(false);

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
    const rgb = hexToRgb(color) ?? { r: 0, g: 0, b: 0 };
    setHsv(rgbToHsv(rgb));
    setHexDraft(rgbToHex(rgb));
    const rect = ref.current?.getBoundingClientRect();
    setFlip(!!rect && window.innerHeight - rect.bottom < PANEL_HEIGHT && rect.top > PANEL_HEIGHT);
    setOpen(true);
  }

  function apply(next: Hsv) {
    setHsv(next);
    const hex = rgbToHex(hsvToRgb(next));
    setHexDraft(hex);
    onChange(hex);
  }

  function pointToHsv(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    apply({
      h: hsv.h,
      s: clamp01((e.clientX - rect.left) / rect.width),
      v: 1 - clamp01((e.clientY - rect.top) / rect.height),
    });
  }

  function pointToHue(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    apply({ h: clamp01((e.clientX - rect.left) / rect.width) * 360, s: hsv.s, v: hsv.v });
  }

  function commitHex() {
    const rgb = hexToRgb(hexDraft);
    if (rgb) {
      setHsv(rgbToHsv(rgb));
      onChange(rgbToHex(rgb));
    }
    setHexDraft(rgbToHex(hexToRgb(hexDraft) ?? hexToRgb(color) ?? { r: 0, g: 0, b: 0 }));
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="flex w-full cursor-pointer items-center gap-3 rounded-full border border-neutral-800 bg-neutral-900/60 py-1.5 pl-1.5 pr-4 text-sm transition hover:border-neutral-600"
      >
        <span className="h-7 w-7 shrink-0 rounded-full border border-white/15" style={{ backgroundColor: color }} />
        <span className="text-xs text-neutral-400">{label}</span>
        <span className="ml-auto font-mono text-xs text-neutral-500">{color}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Pick ${label} color`}
          className={cn(
            "absolute z-50 w-[272px] rounded-2xl border border-neutral-800 bg-[#0d0d0d]/95 p-3 shadow-2xl shadow-black backdrop-blur animate-fade-in",
            flip ? "bottom-full mb-2" : "left-0 top-full mt-2"
          )}
        >
          <div
            role="slider"
            aria-label="Saturation and brightness"
            aria-valuetext={`${Math.round(hsv.s * 100)}% saturated, ${Math.round(hsv.v * 100)}% bright`}
            tabIndex={0}
            className="relative h-36 w-full cursor-crosshair touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            style={{
              background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${hsv.h} 100% 50%)`,
            }}
            onPointerDown={(e) => {
              areaDrag.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              pointToHsv(e);
            }}
            onPointerMove={(e) => areaDrag.current && pointToHsv(e)}
            onPointerUp={(e) => {
              areaDrag.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02;
              if (e.key === "ArrowLeft") apply({ ...hsv, s: clamp01(hsv.s - step) });
              else if (e.key === "ArrowRight") apply({ ...hsv, s: clamp01(hsv.s + step) });
              else if (e.key === "ArrowUp") apply({ ...hsv, v: clamp01(hsv.v + step) });
              else if (e.key === "ArrowDown") apply({ ...hsv, v: clamp01(hsv.v - step) });
              else return;
              e.preventDefault();
            }}
          >
            <div
              className="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white shadow-md"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, transform: "translate(-50%, -50%)", backgroundColor: color }}
            />
          </div>

          <div
            role="slider"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            tabIndex={0}
            className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            style={{ background: "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)" }}
            onPointerDown={(e) => {
              hueDrag.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              pointToHue(e);
            }}
            onPointerMove={(e) => hueDrag.current && pointToHue(e)}
            onPointerUp={(e) => {
              hueDrag.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 30 : 5;
              if (e.key === "ArrowLeft") apply({ ...hsv, h: (hsv.h - step + 360) % 360 });
              else if (e.key === "ArrowRight") apply({ ...hsv, h: (hsv.h + step) % 360 });
              else return;
              e.preventDefault();
            }}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 rounded-full border-2 border-white shadow-md"
              style={{ left: `${(hsv.h / 360) * 100}%`, transform: "translate(-50%, -50%)", backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use ${c}`}
                title={c}
                onClick={() => {
                  const next = rgbToHsv(hexToRgb(c)!);
                  apply(next);
                }}
                className={cn(
                  "h-6 w-6 rounded-full border transition hover:scale-110",
                  c.toLowerCase() === color.toLowerCase() ? "border-white" : "border-white/15"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Hex</span>
            <input
              value={hexDraft}
              onChange={(e) => {
                setHexDraft(e.target.value);
                const rgb = hexToRgb(e.target.value);
                if (rgb) onChange(rgbToHex(rgb));
              }}
              onBlur={commitHex}
              onKeyDown={(e) => e.key === "Enter" && commitHex()}
              spellCheck={false}
              aria-label={`${label} hex value`}
              className="flex-1 rounded-full border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 font-mono text-xs text-neutral-100 outline-none transition focus:border-neutral-600"
            />
          </div>
        </div>
      )}
    </div>
  );
}
