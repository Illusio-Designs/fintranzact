import { useId } from "react";
import { cleanOtp } from "@fintranzact/shared";

/**
 * A one-time-password field: numeric keypad, paste friendly (spaces and dashes are
 * dropped), 6 digits shown. The value lives only in the caller's state; it is never
 * written to storage, logs or the URL.
 */
export function OtpInput({
  label,
  value,
  onChange,
  error,
  disabled,
  autoFocus = true,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        className="input w-full max-w-xs text-center text-xl tracking-[0.5em] tabular-nums"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        maxLength={12}
        placeholder="------"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        data-step-autofocus={autoFocus ? "" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(cleanOtp(e.target.value))}
        onPaste={(e) => {
          e.preventDefault();
          onChange(cleanOtp(e.clipboardData.getData("text")));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {error && <p id={errId} role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
