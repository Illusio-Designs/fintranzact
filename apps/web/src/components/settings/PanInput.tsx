import { useId, useState } from "react";
import { useFieldErrorToast } from "@/lib/field-error-toast";

interface PanInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function PanInput({ value, onChange, error }: PanInputProps) {
  const inputId = useId();
  const [blurred, setBlurred] = useState(false);
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  const isValid = !value || panRegex.test(value);
  const showError = blurred && value.length > 0 && !isValid;
  const message = error || (showError ? "Enter a valid PAN: 5 letters, 4 digits, 1 letter (e.g. AAAAA0000A)" : "");
  useFieldErrorToast("PAN", message);

  return (
    <div>
      <label className="label" htmlFor={inputId}>PAN <span className="text-red-500">*</span></label>
      <input
        id={inputId}
        className={`input font-mono tracking-wide ${showError || error ? "border-red-500" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        onBlur={() => setBlurred(true)}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${inputId}-error` : undefined}
        maxLength={10}
        placeholder="AAAAA0000A"
        spellCheck={false}
        autoCapitalize="characters"
      />
      {message && <p id={`${inputId}-error`} className="sr-only">{message}</p>}
    </div>
  );
}
