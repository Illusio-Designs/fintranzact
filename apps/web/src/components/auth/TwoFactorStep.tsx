import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircleIcon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import {
  formatBackupCodeInput,
  formatTotpInput,
  isCompleteBackupCode,
  lockedMessage,
} from "@/lib/two-factor";

export type VerifyResult = {
  user: { id: string; email: string; name: string | null };
  sessionToken: string;
  trustedDeviceToken?: string;
};

type Mode = "totp" | "backup";

const PRIMARY =
  "flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-bold text-white shadow-[0_12px_28px_-12px_rgba(59,94,170,.8)] transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Second sign-in step: the 6-digit code (or a backup code) after a correct
 * password. Wrong or locked codes stay on this screen; an expired or used-up
 * sign-in hands back to the password step via `onExpired`.
 */
export function TwoFactorStep({
  challengeToken,
  onVerified,
  onBack,
  onExpired,
  disabled = false,
}: {
  challengeToken: string;
  /** Runs the same post-login work as a password login. May be async. */
  onVerified: (data: VerifyResult, rememberDevice: boolean) => void | Promise<void>;
  onBack: () => void;
  onExpired: (message: string) => void;
  /** True once signed in, so a fast second click cannot submit again. */
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // A code is submitted once; typing past it or a re-render must not send it twice.
  const lastSubmitted = useRef<string>("");

  const verify = trpc.auth.verifyTwoFactor.useMutation({
    onSuccess: async (data) => {
      await onVerified(data as VerifyResult, remember);
    },
    onError: (e) => {
      const kind = e.data?.code;
      lastSubmitted.current = "";
      if (kind === "TOO_MANY_REQUESTS") {
        setLocked(true);
        setError(lockedMessage(e.message));
        return;
      }
      if (/sign-in has expired|enter your password again/i.test(e.message)) {
        onExpired(e.message);
        return;
      }
      setError(e.message || "That code is not right. Check the code and try again.");
      setCode("");
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });

  const busy = verify.isPending || disabled;

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  function submit(value: string) {
    if (busy || locked) return;
    if (lastSubmitted.current === value) return;
    lastSubmitted.current = value;
    setError("");
    verify.mutate({ challengeToken, code: value, rememberDevice: remember });
  }

  function onChange(raw: string) {
    setError("");
    if (mode === "totp") {
      const next = formatTotpInput(raw);
      setCode(next);
      if (next.length === 6) submit(next);
    } else {
      setCode(formatBackupCodeInput(raw));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const complete = mode === "totp" ? code.length === 6 : isCompleteBackupCode(code);
    if (!complete) {
      setError(mode === "totp" ? "Enter the 6-digit code from your app." : "Enter all 12 characters of a backup code.");
      inputRef.current?.focus();
      return;
    }
    // A manual submit may retry the same value after a failed attempt.
    lastSubmitted.current = "";
    submit(code);
  }

  function toggleMode() {
    setMode((m) => (m === "totp" ? "backup" : "totp"));
    setCode("");
    setError("");
    lastSubmitted.current = "";
  }

  const isTotp = mode === "totp";

  return (
    <section aria-labelledby="auth-2fa-title">
      <h1 id="auth-2fa-title" className="mt-7 font-display text-[30px] font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white">
        Two-factor authentication
      </h1>
      <p className="mt-2 text-[15px] text-text-tertiary">
        {isTotp
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of your backup codes. Each code works only once."}
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-[18px]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-2fa-code" className="text-[13px] font-medium text-text-secondary">
            {isTotp ? "Authentication code" : "Backup code"}
          </label>
          <input
            ref={inputRef}
            id="auth-2fa-code"
            // Distinct ids per mode would remount the field and drop focus; one input, props change.
            type="text"
            inputMode={isTotp ? "numeric" : "text"}
            autoComplete={isTotp ? "one-time-code" : "off"}
            autoCapitalize={isTotp ? "off" : "characters"}
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={code}
            onChange={(e) => onChange(e.target.value)}
            readOnly={verify.isPending}
            disabled={locked || disabled}
            aria-invalid={error && !locked ? true : undefined}
            aria-describedby="auth-2fa-error"
            placeholder={isTotp ? "123456" : "XXXXXX-XXXXXX"}
            className={cn("input h-[54px] text-center font-mono text-2xl tabular-nums", isTotp ? "tracking-[0.5em]" : "tracking-[0.15em]")}
          />
          {/* Space is always reserved so an error appearing does not move the form. */}
          <p
            id="auth-2fa-error"
            role={error ? "alert" : undefined}
            aria-live="polite"
            className={cn("flex min-h-[40px] items-start gap-2 text-sm", error ? "text-red-600 dark:text-red-400" : "text-transparent")}
          >
            {error && <Icon icon={AlertCircleIcon} size={16} className="mt-0.5 shrink-0" />}
            <span>{error}</span>
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 rounded border-border-medium accent-[var(--color-brand-600,#3b5eaa)]"
          />
          Trust this device for 30 days
        </label>

        <button type="submit" disabled={busy || locked} className={PRIMARY}>
          {verify.isPending || disabled ? "Verifying…" : "Verify"}
        </button>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <button type="button" onClick={onBack} disabled={busy} className="inline-flex items-center gap-1 font-semibold text-text-tertiary hover:text-text-primary disabled:opacity-60">
            <Icon icon={ArrowLeft01Icon} size={16} />
            Back
          </button>
          <button
            type="button"
            onClick={toggleMode}
            disabled={busy}
            className="font-bold text-brand-700 hover:underline disabled:opacity-60 dark:text-brand-300"
          >
            {isTotp ? "Use a backup code instead" : "Use authenticator app instead"}
          </button>
        </div>
      </form>
    </section>
  );
}
