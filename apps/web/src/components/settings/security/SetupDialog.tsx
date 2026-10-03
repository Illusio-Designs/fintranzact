import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/hooks/useToast";
import { formatTotpInput, groupKey } from "@/lib/two-factor";
import { BackupCodesPanel } from "./BackupCodesPanel";

type Step = "scan" | "confirm" | "codes";
const STEP_TITLE: Record<Step, string> = {
  scan: "Turn on two-factor: scan the code",
  confirm: "Turn on two-factor: confirm",
  codes: "Save your backup codes",
};

/** Three steps: scan the QR code, confirm with a code, save the backup codes (shown once). */
export function SetupDialog({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
  const utils = trpc.useUtils();
  const [step, setStep] = useState<Step>("scan");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const begin = trpc.auth.twoFactorBeginSetup.useMutation({
    onError: (e) => setError(e.message),
  });
  const confirm = trpc.auth.twoFactorConfirmSetup.useMutation({
    onSuccess: (data) => {
      setCodes(data.backupCodes);
      setStep("codes");
      utils.auth.twoFactorStatus.invalidate();
      utils.auth.me.invalidate();
      utils.auth.listSessions.invalidate();
    },
    onError: (e) => {
      setError(e.message);
      setCode("");
      requestAnimationFrame(() => codeRef.current?.focus());
    },
  });

  // A fresh secret each time the dialog opens; nothing is kept between openings.
  useEffect(() => {
    if (!open) return;
    setStep("scan");
    setCode("");
    setError("");
    setCodes([]);
    setSaved(false);
    begin.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (step === "confirm") codeRef.current?.focus();
  }, [step]);

  // Once the codes are on screen they cannot be fetched again: closing needs the checkbox.
  const locked = step === "codes" && !saved;
  function close() {
    if (locked) return;
    onClose();
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (confirm.isPending) return;
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your app.");
      return;
    }
    setError("");
    confirm.mutate({ code });
  }

  async function copyKey() {
    if (!begin.data) return;
    try {
      await navigator.clipboard.writeText(begin.data.manualKey.replace(/\s+/g, ""));
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      toast.error("Could not copy", "Select the key and copy it by hand.");
    }
  }

  const setup = begin.data;

  return (
    <Modal open={open} onClose={close} title={STEP_TITLE[step]}>
      <p className="mb-4 text-xs text-text-tertiary" aria-live="polite">
        Step {step === "scan" ? 1 : step === "confirm" ? 2 : 3} of 3
      </p>

      {step === "scan" && (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
            <li>
              Open an authenticator app: Google Authenticator, Microsoft Authenticator or Authy.
            </li>
            <li>Add a new account and scan this QR code.</li>
            <li>Come back here and enter the 6-digit code it shows.</li>
          </ol>
          {begin.isPending && <p className="text-sm text-text-tertiary">Preparing your QR code…</p>}
          {begin.isError && (
            <div role="alert" className="space-y-2 text-sm text-red-600 dark:text-red-400">
              <p>{error || "Could not start setup."}</p>
              <button type="button" className="btn-secondary btn-sm" onClick={() => { setError(""); begin.mutate(); }}>
                Try again
              </button>
            </div>
          )}
          {setup && (
            <>
              <div className="flex justify-center">
                <img
                  src={setup.qrDataUrl}
                  alt={`QR code to add ${setup.accountName} to your authenticator app`}
                  width={192}
                  height={192}
                  className="h-48 w-48 rounded-lg bg-white p-2"
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-text-tertiary">Can't scan? Enter this key by hand (time-based, 6 digits):</p>
                <div className="flex items-center gap-2">
                  <code
                    aria-label="Setup key"
                    className="min-w-0 flex-1 select-all break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider text-text-primary"
                  >
                    {groupKey(setup.manualKey)}
                  </code>
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={copyKey}>
                    <Icon icon={Copy01Icon} size={15} />
                    {copiedKey ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={!setup} onClick={() => { setError(""); setStep("confirm"); }}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label htmlFor="setup-code" className="mb-1 block text-sm font-medium text-text-primary">
              6-digit code from your app
            </label>
            <input
              ref={codeRef}
              id="setup-code"
              className="input h-12 text-center font-mono text-xl tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              readOnly={confirm.isPending}
              onChange={(e) => {
                const next = formatTotpInput(e.target.value);
                setCode(next);
                setError("");
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby="setup-code-error"
            />
            <p id="setup-code-error" role={error ? "alert" : undefined} className="mt-1.5 min-h-5 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => { setError(""); setStep("scan"); }} disabled={confirm.isPending}>
              Back
            </button>
            <button type="submit" className="btn-primary" disabled={confirm.isPending || code.length !== 6}>
              {confirm.isPending ? "Verifying…" : "Verify and turn on"}
            </button>
          </div>
        </form>
      )}

      {step === "codes" && (
        <div className="space-y-4">
          <BackupCodesPanel codes={codes} email={email} saved={saved} onSavedChange={setSaved}>
            <p className="rounded-lg bg-surface-1 px-4 py-3 text-sm text-text-secondary">
              Two-factor authentication is on. For your safety, your other signed-in devices were signed out.
            </p>
          </BackupCodesPanel>
          <div className="flex justify-end pt-2">
            <button type="button" className="btn-primary" disabled={!saved} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
