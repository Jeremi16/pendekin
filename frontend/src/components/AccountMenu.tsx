import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, LogOut, Settings } from "lucide-react";
import type { Account } from "../lib/api";

type Props = {
  account: Account;
  onDashboard: () => void;
  onSettings: () => void;
  onLogout: () => void;
};

export default function AccountMenu({ account, onDashboard, onSettings, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-900 hover:text-white";
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-neutral-800 py-1 pl-1 pr-3 text-xs text-neutral-300 transition hover:border-neutral-600 hover:text-white"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold uppercase text-black">{account.email[0]}</span>
        <span className="hidden max-w-[160px] truncate sm:inline">{account.email}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl border border-neutral-800 bg-[#0d0d0d] p-1.5 shadow-2xl shadow-black animate-fade-in">
          <p className="truncate px-3 pb-2 pt-1.5 text-xs text-neutral-500">{account.email}</p>
          <button role="menuitem" onClick={pick(onDashboard)} className={item}><LayoutDashboard size={14} /> Dashboard</button>
          <button role="menuitem" onClick={pick(onSettings)} className={item}><Settings size={14} /> Account settings</button>
          <div className="my-1 border-t border-neutral-900" />
          <button role="menuitem" onClick={pick(onLogout)} className={item}><LogOut size={14} /> Log out</button>
        </div>
      )}
    </div>
  );
}
