type Option = { value: string; label: string } | string;

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
};

export default function Select({ value, onChange, options, className }: Props) {
  const normalized: { value: string; label: string }[] = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  );
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ${className || ""}`}
    >
      {normalized.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
