import { useEffect, useId, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@fintranzact/api";
import { VERIFY_WITH_CA_LABEL, fyLabel, fyStartYearOfMonth } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { SelectField } from "@/components/ui/FormField";
import { currentMonth } from "./payroll-ui";

/** What the payrollStatutory procedures return. */
export type StatutoryOut = inferRouterOutputs<AppRouter>["payrollStatutory"];

/** Which statutory schemes the business is registered for. Anything not registered is never shown. */
export interface Registrations {
  pf: boolean;
  esi: boolean;
  pt: boolean;
  lwf: boolean;
  tds: boolean;
}

export interface FlagsLike {
  pfRegistered?: boolean;
  esiRegistered?: boolean;
  ptStates?: readonly string[];
  lwfState?: string | null;
  tdsEnabled?: boolean;
}

export const NO_REGISTRATIONS: Registrations = { pf: false, esi: false, pt: false, lwf: false, tds: false };

export function statutoryRegistrations(flags: FlagsLike | null | undefined): Registrations {
  if (!flags) return NO_REGISTRATIONS;
  return { pf: !!flags.pfRegistered, esi: !!flags.esiRegistered, pt: (flags.ptStates?.length ?? 0) > 0, lwf: !!flags.lwfState, tds: !!flags.tdsEnabled };
}

export const anyRegistration = (r: Registrations) => r.pf || r.esi || r.pt || r.lwf || r.tds;

/** The business's statutory registrations from the server (nothing is shown until they are known). */
export function useStatutoryRegistrations() {
  const q = trpc.payrollStatutory.settings.useQuery(undefined);
  const reg = statutoryRegistrations(q.data?.flags);
  return { reg, flags: q.data?.flags, loading: q.isLoading, settings: q.data };
}

export function currentFinancialYear(): number {
  return fyStartYearOfMonth(currentMonth());
}

/** The financial years to choose from: two back, this one and the next. */
export function financialYearOptions(): number[] {
  const y = currentFinancialYear();
  return [y + 1, y, y - 1, y - 2];
}

export function FyPicker({ value, onChange, label = "Financial year" }: { value: number; onChange: (fy: number) => void; label?: string }) {
  return (
    <SelectField label={label} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
      {financialYearOptions().map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
    </SelectField>
  );
}

/** The standing reminder on every statutory screen: rates change and are the owner's and CA's responsibility. */
export function VerifyWithCa({ note }: { note?: string }) {
  return (
    <p data-testid="verify-with-ca" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <strong>{VERIFY_WITH_CA_LABEL}.</strong> {note ?? "Every rate, ceiling, slab and due date here can change each year and is yours to confirm."}
    </p>
  );
}

/** A number box that keeps what is typed ("12.", "0.7") and reports the number. */
export function NumField({
  label, value, onChange, disabled, hint, nullable = false, suffix,
}: { label: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean; hint?: string; nullable?: boolean; suffix?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const parsed = text.trim() === "" ? (nullable ? null : 0) : Number(text);
    // Re-sync only when the value was changed from outside (what is typed parses to the same number otherwise).
    if (parsed !== value) setText(value === null ? "" : String(value));
  }, [value, text, nullable]);
  const id = useId();
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="label">{label}{suffix ? ` (${suffix})` : ""}</label>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === "") return onChange(nullable ? null : 0);
          const n = Number(t);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
      />
      {hint && <span className="mt-0.5 text-2xs text-text-tertiary">{hint}</span>}
    </div>
  );
}
