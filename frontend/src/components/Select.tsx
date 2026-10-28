import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string; icon?: React.ReactNode } | string;

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  className?: string;
  "aria-label"?: string;
  align?: "left" | "right";
  prefix?: React.ReactNode;
};

const pretty = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");

// Custom dark listbox replacing the native <select>, whose popup can't be styled.
export default function Select({ value, onChange, options, className, align = "left", prefix, ...rest }: Props) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: pretty(o) } : o));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = opts.find((o) => o.value === value) ?? opts[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    listRef.current?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function openList() {
    setActive(Math.max(0, opts.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(i: number) {
    onChange(opts[i].value);
    setOpen(false);
    ref.current?.querySelector("button")?.focus();
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") setActive((i) => Math.min(opts.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(opts.length - 1);
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") ref.current?.querySelector("button")?.focus();
      return;
    } else return;
    e.preventDefault();
  }

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={rest["aria-label"]}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openList();
          }
        }}
        className={`flex h-full w-full items-center gap-2 rounded-full border bg-neutral-900/60 px-4 py-2.5 text-left text-sm text-neutral-100 outline-none transition hover:border-neutral-600 focus-visible:border-neutral-500 ${open ? "border-neutral-600" : "border-neutral-800"}`}
      >
        {prefix}
        {current?.icon}
        <span className="flex-1 truncate">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={id}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
          className={`absolute top-full z-50 mt-2 max-h-64 min-w-full overflow-y-auto overflow-x-hidden rounded-2xl border border-neutral-800 bg-[#0d0d0d]/95 p-1.5 shadow-2xl shadow-black outline-none backdrop-blur animate-fade-in ${align === "right" ? "right-0" : "left-0"}`}
        >
          {opts.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                className={`flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors ${
                  i === active ? "bg-neutral-800/80 text-white" : "text-neutral-400"
                }`}
              >
                {o.icon}
                <span className="flex-1">{o.label}</span>
                <Check size={14} className={selected ? "text-white" : "invisible"} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
