import { useId, useState } from "react";
import { useFieldErrorToast } from "@/lib/field-error-toast";

interface GstinInputProps {
  value: string;
  onChange: (value: string) => void;
  onPanDetected?: (pan: string) => void;
  onBlur?: () => void;
  error?: string;
}

export function GstinInput({ value, onChange, onPanDetected, onBlur, error }: GstinInputProps) {
  const inputId = useId();
  const [blurred, setBlurred] = useState(false);
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const isValid = !value || gstinRegex.test(value);
  const showError = blurred && value.length > 0 && !isValid;
  const detectedPan = value.length === 15 && isValid ? value.slice(2, 12) : null;
  const message = error || (showError ? "Enter a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5)" : "");
  useFieldErrorToast("GSTIN", message);

  return (
    <div>
      <label className="label" htmlFor={inputId}>GSTIN</label>
      <input
        id={inputId}
        className="input font-mono tracking-wide"
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${inputId}-error` : undefined}
        value={value}
        onChange={(e) => {
          const upper = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
          onChange(upper);
          if (upper.length === 15 && gstinRegex.test(upper)) {
            onPanDetected?.(upper.slice(2, 12));
          }
        }}
        onBlur={() => {
          setBlurred(true);
          onBlur?.();
        }}
        maxLength={15}
        placeholder="22AAAAA0000A1Z5"
        spellCheck={false}
        autoCapitalize="characters"
      />
      {message && <p id={`${inputId}-error`} className="sr-only">{message}</p>}
      {!message && (
        <p className="text-2xs text-text-tertiary mt-1">15-character GST Identification Number</p>
      )}
      {detectedPan && (
        <p className="text-2xs text-brand-600 mt-1">
          PAN detected: {detectedPan}
        </p>
      )}
    </div>
  );
}
