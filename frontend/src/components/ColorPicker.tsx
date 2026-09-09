type Props = { label: string; color: string; onChange: (v: string) => void };
export default function ColorPicker({ label, color, onChange }: Props) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input type="color" value={color} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 cursor-pointer rounded-lg border-none bg-transparent p-0" />
      <span className="text-xs text-slate-600">{color}</span>
    </label>
  );
}
