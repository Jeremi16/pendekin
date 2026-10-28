import { useState } from "react";
import { apiDelete } from "../lib/api";
import { formatApiError } from "../lib/utils";
import { field, label } from "../lib/ui";
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
        <p className="mt-1 text-sm text-neutral-500">
          Signed in as <span className="text-neutral-300">{account.email}</span> · member since {new Date(account.createdAt).toLocaleDateString()}
        </p>
      </div>
      <DeleteAccount email={account.email} onToast={onToast} onDeleted={onDeleted} />
    </div>
  );
}

function DeleteAccount({ email, onToast, onDeleted }: { email: string } & Pick<Props, "onToast" | "onDeleted">) {
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

  return (
    <form onSubmit={submit} className="space-y-4 rounded-3xl border border-red-950 bg-red-950/10 p-6">
      <div>
        <h2 className="text-base font-medium text-red-300">Delete account</h2>
        <p className="text-sm text-neutral-500">Permanently deletes your account and all of its links. Those short links stop working immediately. This can't be undone.</p>
      </div>
      <Field id="da-email" label="Type your email to confirm" type="text" value={typed} onChange={setTyped} autoComplete="off" placeholder={email} />
      {error && <p className="rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">{error}</p>}
      <div className="flex justify-end">
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
