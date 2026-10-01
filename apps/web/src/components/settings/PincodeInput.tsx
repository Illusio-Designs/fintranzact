import { useId, useState } from "react";
import { useFieldErrorToast } from "@/lib/field-error-toast";
import { lookupPincode } from "@/lib/pincode-lookup";
import { Icon } from "@/components/ui/Icon";
import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";

interface PincodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when PIN resolves and city/state were empty — autofill them. */
  onCityStateResolved: (city: string, state: string) => void;
  /** Current city value (to detect user-filled vs empty). */
  currentCity?: string;
  /** Current state value (to detect user-filled vs empty). */
  currentState?: string;
  error?: string;
}

export function PincodeInput({ value, onChange, onCityStateResolved, currentCity, currentState, error }: PincodeInputProps) {
  useFieldErrorToast("Pincode", error);
  const inputId = useId();
  const [lookupState, setLookupState] = useState<"idle" | "found" | "found-mismatch" | "not-found">("idle");
  const [resolvedInfo, setResolvedInfo] = useState<{ district: string; state: string } | null>(null);
  const [justFilled, setJustFilled] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
    onChange(raw);
    setJustFilled(false);

    if (raw.length === 6) {
      const result = lookupPincode(raw);
      if (result) {
        setResolvedInfo(result);
        const cityEmpty = !currentCity?.trim();
        const stateEmpty = !currentState?.trim();

        if (cityEmpty && stateEmpty) {
          // Both empty — autofill with a little celebration
          setLookupState("found");
          onCityStateResolved(result.district, result.state);
          setJustFilled(true);
          setTimeout(() => setJustFilled(false), 2000);
        } else {
          // User already filled city/state — check for mismatch
          const cityMatch = !currentCity?.trim() || currentCity.trim().toLowerCase() === result.district.toLowerCase();
          const stateMatch = !currentState?.trim() || currentState.trim().toLowerCase() === result.state.toLowerCase();
          if (cityMatch && stateMatch) {
            setLookupState("found");
          } else {
            setLookupState("found-mismatch");
          }
        }
      } else {
        setLookupState("not-found");
        setResolvedInfo(null);
      }
    } else {
      setLookupState("idle");
      setResolvedInfo(null);
    }
  }

  return (
    <div>
      <label className="label" htmlFor={inputId}>Pincode</label>
      <div className="relative">
        <input
          id={inputId}
          className="input"
          value={value}
          onChange={handleChange}
          maxLength={6}
          inputMode="numeric"
          placeholder="400001"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        {lookupState === "found" && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <span className="block" style={justFilled ? { animation: "pincode-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" } : undefined}>
              <Icon icon={Tick02Icon} size={16} className="text-emerald-500" />
            </span>
          </div>
        )}
        {lookupState === "found-mismatch" && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <Icon icon={Alert02Icon} size={16} className="text-amber-500" />
          </div>
        )}
      </div>
      {error && <p id={`${inputId}-error`} className="sr-only">{error}</p>}
      {lookupState === "found" && justFilled && !error && (
        <p className="text-2xs text-emerald-600 mt-1" style={{ animation: "pincode-slide 0.3s ease-out" }}>
          Got it! {resolvedInfo?.district}, {resolvedInfo?.state}
        </p>
      )}
      {lookupState === "found" && !justFilled && !error && (
        <p className="text-2xs text-emerald-600 mt-1">
          {resolvedInfo?.district}, {resolvedInfo?.state}
        </p>
      )}
      {lookupState === "found-mismatch" && !error && resolvedInfo && (
        <p className="text-2xs text-amber-600 mt-1">
          PIN suggests {resolvedInfo.district}, {resolvedInfo.state} — your entry differs
        </p>
      )}
      {lookupState === "not-found" && !error && (
        <p className="text-2xs text-text-tertiary mt-1">Pincode not recognized — enter city and state manually</p>
      )}
      <style>{`
        @keyframes pincode-pop { 0% { transform: scale(0); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
        @keyframes pincode-slide { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
