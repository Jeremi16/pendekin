import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { apiDelete } from "../lib/api";
import { formatApiError } from "../lib/utils";
import { field, label } from "../lib/ui";
import { NODRYX_ACCOUNT_URL } from "../lib/constants";
import type { Account } from "../lib/api";

type Props = {
  account: Account;
  onToast: (t: { type: "success" | "error"; text: string }) => void;
  onDeleted: () => void;
};

export default function Settings({ account, onToast, onDeleted }: Props) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 pb-16 sm:px-6">
      <div>
        <p className={label}>Settings</p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight text-white">Account</h1>
      </div>
      <Profile account={account} />
      <DeleteAccount email={account.email} onToast={onToast} onDeleted={onDeleted} />
    </div>
  );
}

function Profile({ account }: { account: Account }) {
  const displayName = account.name || account.email;
  return (
    <section className="space-y-5 rounded-3xl border border-neutral-800 bg-neutral-950/60 p-6">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-lg font-bold uppercase text-black">{displayName[0]}</span>
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-white">{displayName}</p>
          {account.name && <p className="truncate text-sm text-neutral-400">{account.email}</p>}
          <p className="text-xs text-neutral-600">Member since {new Date(account.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-neutral-900 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-neutral-500">Your name, email and password are managed by Nodryx.</p>
        <a
          href={NODRYX_ACCOUNT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white"
        >
          Manage Nodryx account <ExternalLink size={13} />
        </a>
      </div>
    </section>
  );
}

function DeleteAccount({ email, onToast, onDeleted }: { email: string } & Pick<Props, "onToast" | "onDeleted">) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toLowerCase() === email.toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete("/auth/account", {});
      onToast({ type: "success", text: "Account deleted" });
      onDeleted();
    } catch (err) {
      setError(formatApiError(err, "Failed to delete account"));
      setBusy(false);
    }
  }

  function cancel() {
    setOpen(false);
    setTyped("");
    setError("");
  }

  if (!open) {
    return (
      <section className="flex flex-col gap-3 rounded-3xl border border-red-950/60 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium text-red-300">Delete Pendekin account</h2>
          <p className="text-sm text-neutral-500">Removes your account and all of its links. Your Nodryx account is not affected.</p>
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-900 px-4 py-2 text-sm text-red-300 transition hover:bg-red-950/40">
          Delete account
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-3xl border border-red-950 bg-red-950/10 p-6">
      <div>
        <h2 className="text-base font-medium text-red-300">Delete Pendekin account</h2>
        <p className="text-sm text-neutral-500">Permanently deletes your account and all of its links. Those short links stop working immediately. This can't be undone.</p>
      </div>
      <Field id="da-email" label="Type your email to confirm" type="text" value={typed} onChange={setTyped} autoComplete="off" placeholder={email} />
      {error && <p className="rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={cancel} disabled={busy} className="rounded-full px-4 py-2 text-sm text-neutral-400 transition hover:text-white">
          Cancel
        </button>
        <button disabled={!ready || busy} className="inline-flex items-center justify-center rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
};

function Field({ id, label: text, value, onChange, type = "text", autoComplete, placeholder }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`${label} px-1`}>{text}</label>
      <input id={id} type={type} required value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} maxLength={128} placeholder={placeholder} className={field} />
    </div>
  );
}
