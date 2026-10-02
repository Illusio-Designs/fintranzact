import { useEffect, useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { toast } from "@/hooks/useToast";
import { formatBackupCodeInput, formatTotpInput } from "@/lib/two-factor";
import { BackupCodesPanel } from "./BackupCodesPanel";

export type ReauthMode = "disable" | "regenerate";

/**
 * Password + current code, for the two actions that must prove it is really
 * the account owner: turning two-factor off, and replacing backup codes.
 * Regenerating accepts an authenticator code only; turning off also takes a backup code.
 */
export function ReauthDialog({
  mode,
  onClose,
  email,
  onDisabled,
}: {
  mode: ReauthMode | null;
  onClose: () => void;
  email: string;
  /** After a successful turn-off (the caller clears any local trusted-device token). */
  onDisabled?: () => void;
}) {
  const utils = trpc.useUtils();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const isDisable = mode === "disable";

  useEffect(() => {
    if (mode) {
      setPassword("");
      setCode("");
      setError("");
      setCodes(null);
      setSaved(false);
    }
  }, [mode]);

  const disable = trpc.auth.twoFactorDisable.useMutation({
    onSuccess: () => {
      utils.auth.twoFactorStatus.invalidate();
      utils.auth.me.invalidate();
      utils.auth.listTrustedDevices.invalidate();
      toast.success("Two-factor authentication turned off");
      onDisabled?.();
      onClose();
    },
    // Wrong password/code, or "Your organisation requires two-factor authentication": show it here.
    onError: (e) => {
      setError(e.message);
      setCode("");
    },
  });
  const regenerate = trpc.auth.regenerateBackupCodes.useMutation({
    onSuccess: (data) => {
      setCodes(data.backupCodes);
      utils.auth.twoFactorStatus.invalidate();
    },
    onError: (e) => {
      setError(e.message);
      setCode("");
    },
  });
  const pending = disable.isPending || regenerate.isPending;
  const showingCodes = codes !== null;
  const locked = showingCodes && !saved;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!password) return setError("Enter your password.");
    if (!code.trim()) return setError(isDisable ? "Enter a code from your app, or a backup code." : "Enter the 6-digit code from your app.");
    setError("");
    (isDisable ? disable : regenerate).mutate({ password, code: code.trim() });
  }

  function close() {
    if (locked) return;
    onClose();
  }

  const title = showingCodes ? "Your new backup codes" : isDisable ? "Turn off two-factor authentication" : "Generate new backup codes";

  return (
    <Modal open={mode !== null} onClose={close} title={title}>
      {showingCodes ? (
        <div className="space-y-4">
          <BackupCodesPanel codes={codes!} email={email} saved={saved} onSavedChange={setSaved}>
            <p className="rounded-lg bg-surface-1 px-4 py-3 text-sm text-text-secondary">Your old backup codes no longer work.</p>
          </BackupCodesPanel>
          <div className="flex justify-end pt-2">
            <button type="button" className="btn-primary" disabled={!saved} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <div
            className={
              isDisable
                ? "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
                : "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-300"
            }
          >
            {isDisable
              ? "Your account will be protected by your password alone. Your other signed-in devices will be signed out and every trusted device forgotten."
              : "This replaces all your backup codes. Your old codes, used or not, stop working straight away."}
          </div>
          <div>
            <label htmlFor="reauth-password" className="mb-1 block text-sm font-medium text-text-primary">
              Your password
            </label>
            <PasswordInput
              id="reauth-password"
              className="input"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
            />
          </div>
          <div>
            <label htmlFor="reauth-code" className="mb-1 block text-sm font-medium text-text-primary">
              {isDisable ? "Code from your app, or a backup code" : "Current code from your app"}
            </label>
            <input
              id="reauth-code"
              className="input font-mono tracking-wider"
              inputMode={isDisable ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={isDisable ? "123456 or XXXXXX-XXXXXX" : "123456"}
              value={code}
              onChange={(e) => {
                const raw = e.target.value;
                // Six digits stay plain; anything with letters is a backup code and is dashed.
                setCode(isDisable ? (/^[\d\s]*$/.test(raw) ? formatTotpInput(raw) : formatBackupCodeInput(raw)) : formatTotpInput(raw));
                setError("");
              }}
              aria-describedby="reauth-error"
            />
          </div>
          <p id="reauth-error" role={error ? "alert" : undefined} className="min-h-5 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={isDisable ? "btn-danger" : "btn-primary"} disabled={pending}>
              {pending ? "Working…" : isDisable ? "Turn off" : "Generate new codes"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
