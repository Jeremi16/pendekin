import { useEffect, useState } from "react";
import { Lock, Share2 } from "lucide-react";
import Sheet from "./Sheet";
import ColorPicker from "./ColorPicker";
import Select from "./Select";
import ExpiryPicker from "./ExpiryPicker";
import useQrCode from "../hooks/useQrCode";
import { apiPatch } from "../lib/api";
import { CORNER_STYLES, DEFAULT_SETTINGS, QR_STYLES } from "../lib/constants";
import { formatApiError } from "../lib/utils";
import { btnGhost, btnPrimary, field, label, parseTags, stripProto, toLocalInput, type DashLink } from "../lib/ui";

type Props = { link: DashLink; onClose: () => void; onSaved: (l: DashLink) => void };

export default function EditLinkDrawer({ link, onClose, onSaved }: Props) {
  const [url, setUrl] = useState(link.original);
  const [title, setTitle] = useState(link.title ?? "");
  const [isActive, setIsActive] = useState(link.isActive);
  const [expiresAt, setExpiresAt] = useState(toLocalInput(link.expiresAt));
  // Password: "keep" leaves it unchanged; "set" uses newPassword; "remove" clears it.
  const [pwMode, setPwMode] = useState<"keep" | "set" | "remove">(link.hasPassword ? "keep" : "remove");
  const [newPassword, setNewPassword] = useState("");
  const [maxClicks, setMaxClicks] = useState(link.maxClicks ? String(link.maxClicks) : "");
  const [tags, setTags] = useState(link.tags.join(", "));
  const [ogTitle, setOgTitle] = useState(link.ogTitle ?? "");
  const [ogDescription, setOgDescription] = useState(link.ogDescription ?? "");
  const [ogImage, setOgImage] = useState(link.ogImage ?? "");
  const [qr, setQr] = useState({ ...DEFAULT_SETTINGS, ...(link.qrConfig as Partial<typeof DEFAULT_SETTINGS>) });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const qrCode = useQrCode();

  useEffect(() => {
    qrCode.render(link.short, qr);
  }, [link.short, qr, qrCode]);

  async function save() {
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = {
      url,
      title,
      isActive,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      qrConfig: qr,
      maxClicks: maxClicks ? Number(maxClicks) : null,
      tags: parseTags(tags),
      ogTitle: ogTitle || null,
      ogDescription: ogDescription || null,
      ogImage: ogImage || null,
    };
    if (pwMode === "set") {
      if (newPassword.length < 4) {
        setError("Link password must be at least 4 characters");
        setSaving(false);
        return;
      }
      body.password = newPassword;
    } else if (pwMode === "remove" && link.hasPassword) {
      body.password = null;
    }
    try {
      const d = await apiPatch<{ link: DashLink }>(`/dashboard/links/${link.id}`, body);
      onSaved(d.link);
    } catch (err) {
      setError(formatApiError(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      kicker="Edit link"
      title={stripProto(link.short)}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save changes"}</button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="e-url" className={`${label} px-1`}>Destination URL</label>
          <input id="e-url" value={url} onChange={(e) => setUrl(e.target.value)} className={field} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="e-title" className={`${label} px-1`}>Title</label>
          <input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" className={field} />
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-neutral-800 px-4 py-3">
          <span>
            <span className="block text-sm text-white">Active</span>
            <span className="block text-xs text-neutral-500">Inactive links show a "turned off" page.</span>
          </span>
          <Toggle checked={isActive} onChange={setIsActive} label="Active" />
        </label>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <label htmlFor="e-exp" className={label}>Expires</label>
            {expiresAt && <button type="button" onClick={() => setExpiresAt("")} className="text-xs text-neutral-500 hover:text-white">Remove expiry</button>}
          </div>
          <ExpiryPicker id="e-exp" value={expiresAt} onChange={setExpiresAt} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="e-max" className={`${label} px-1`}>Click limit</label>
            <input id="e-max" type="number" min={1} inputMode="numeric" value={maxClicks} onChange={(e) => setMaxClicks(e.target.value)} placeholder="Unlimited" className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="e-tags" className={`${label} px-1`}>Tags</label>
            <input id="e-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="promo, instagram" className={field} />
          </div>
        </div>

        <div className="space-y-2 rounded-2xl border border-neutral-800 p-4">
          <p className="flex items-center gap-2 text-sm text-white"><Share2 size={14} /> Social preview</p>
          <p className="text-xs text-neutral-500">Shown when the link is shared on WhatsApp, X, Facebook, Telegram… Leave empty to use the destination's own preview.</p>
          <input value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} placeholder="Preview title" maxLength={120} className={field} aria-label="Preview title" />
          <input value={ogDescription} onChange={(e) => setOgDescription(e.target.value)} placeholder="Preview description" maxLength={300} className={field} aria-label="Preview description" />
          <input value={ogImage} onChange={(e) => setOgImage(e.target.value)} placeholder="Image URL (https://…)" className={field} aria-label="Preview image URL" />
        </div>

        <div className="space-y-2 rounded-2xl border border-neutral-800 p-4">
          <p className="flex items-center gap-2 text-sm text-white"><Lock size={14} /> Password protection</p>
          <div className="flex flex-wrap gap-1.5">
            {link.hasPassword && <Chip active={pwMode === "keep"} onClick={() => setPwMode("keep")}>Keep current</Chip>}
            <Chip active={pwMode === "set"} onClick={() => setPwMode("set")}>{link.hasPassword ? "Change" : "Set password"}</Chip>
            <Chip active={pwMode === "remove"} onClick={() => setPwMode("remove")}>{link.hasPassword ? "Remove" : "None"}</Chip>
          </div>
          {pwMode === "set" && (
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Visitors must enter this (min 4)"
              className={field}
              aria-label="Link password"
            />
          )}
        </div>

        <div className="space-y-3">
          <p className={`${label} px-1`}>QR code</p>
          <div className="flex gap-4">
            <div ref={qrCode.qrRef} className="w-28 shrink-0 overflow-hidden rounded-xl [&>canvas]:h-auto [&>canvas]:w-full [&>svg]:h-auto [&>svg]:w-full" />
            <div className="flex flex-1 flex-col justify-center gap-2">
              <button type="button" onClick={() => qrCode.download("png", link.short)} className={btnGhost}>Download PNG</button>
              <button type="button" onClick={() => qrCode.download("svg", link.short)} className={btnGhost}>Download SVG</button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ColorPicker label="Dots" color={qr.dotsColor} onChange={(v) => setQr((s) => ({ ...s, dotsColor: v }))} />
            <ColorPicker label="Background" color={qr.backgroundColor} onChange={(v) => setQr((s) => ({ ...s, backgroundColor: v }))} />
            <Select value={qr.dotsType} onChange={(v) => setQr((s) => ({ ...s, dotsType: v }))} options={[...QR_STYLES]} />
            <Select value={qr.cornersType} onChange={(v) => setQr((s) => ({ ...s, cornersType: v }))} options={[...CORNER_STYLES]} />
          </div>
        </div>

        {error && <p className="rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">{error}</p>}
      </div>
    </Sheet>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => { e.preventDefault(); onChange(!checked); }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-white" : "bg-neutral-800"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${checked ? "left-[22px] bg-black" : "left-0.5 bg-neutral-400"}`} />
    </button>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs transition ${active ? "bg-white font-semibold text-black" : "border border-neutral-800 text-neutral-400 hover:text-white"}`}
    >
      {children}
    </button>
  );
}
