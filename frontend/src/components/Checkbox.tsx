import { useEffect, useRef } from "react";
import { Check, Minus } from "lucide-react";

type Props = {
  checked: boolean;
  onChange: (v: boolean) => void;
  indeterminate?: boolean;
  label?: React.ReactNode;
  "aria-label"?: string;
  className?: string;
};

// Styled checkbox backed by a real <input> (keeps keyboard, a11y and form semantics).
export default function Checkbox({ checked, onChange, indeterminate = false, label, className, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const on = checked || indeterminate;

  return (
    <label className={`group inline-flex cursor-pointer select-none items-center gap-2.5 ${className ?? ""}`}>
      <span className="relative inline-flex h-[18px] w-[18px] shrink-0">
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={rest["aria-label"]}
          className={`peer h-full w-full cursor-pointer appearance-none rounded-[6px] border transition-all duration-150 outline-none
            focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]
            ${on ? "border-white bg-white" : "border-neutral-700 bg-neutral-900 group-hover:border-neutral-500"}`}
        />
        <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-black transition-transform duration-150 ${on ? "scale-100" : "scale-0"}`}>
          {indeterminate ? <Minus size={12} strokeWidth={3.5} /> : <Check size={12} strokeWidth={3.5} />}
        </span>
      </span>
      {label && <span className="text-sm text-neutral-300">{label}</span>}
    </label>
  );
}
