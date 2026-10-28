import { useEffect } from "react";
import { X } from "lucide-react";
import { label } from "../lib/ui";

type Props = { title: string; kicker?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode };

// Right-hand drawer on desktop, full-height sheet on mobile.
export default function Sheet({ title, kicker, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-l border-neutral-800 bg-[#0d0d0d] shadow-2xl shadow-black animate-fade-in"
      >
        <header className="flex items-start justify-between gap-4 border-b border-neutral-900 px-6 py-5">
          <div className="min-w-0">
            {kicker && <p className={label}>{kicker}</p>}
            <h2 className="mt-1 truncate text-lg font-medium tracking-tight text-white">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-900 hover:text-white">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-neutral-900 px-6 py-4">{footer}</footer>}
      </aside>
    </div>
  );
}
