import { useState } from "react";
import {
  INDIAN_STATES,
  LWF_FREQUENCIES,
  PT_GENDERS,
  ROUNDING_MODES,
  ROUNDING_MODE_LABELS,
  fyLabel,
  stateByCode,
  statutoryRatesSchema,
  type LwfFrequency,
  type PtSlab,
  type RegimeConfig,
  type StatutoryRates,
  type TaxSlab,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { InputField, SelectField } from "@/components/ui/FormField";
import { Panel, CheckRow, onError } from "./payroll-ui";
import { FyPicker, NumField, VerifyWithCa, currentFinancialYear, statutoryRegistrations, type StatutoryOut } from "./statutory-ui";

type Flags = {
  pfRegistered: boolean;
  pfEstablishmentCode: string | null;
  esiRegistered: boolean;
  esiCode: string | null;
  ptStates: string[];
  lwfState: string | null;
  tdsEnabled: boolean;
};

/**
 * Statutory settings: which schemes the business is registered for, and every
 * rate, ceiling, slab and due date for a financial year. Everything here is data
 * the owner (or their CA) can change; the shipped figures are only a starting
 * point and state slabs and income-tax slabs ship EMPTY on purpose.
 */
export function StatutoryTab() {
  const [fy, setFy] = useState(currentFinancialYear());
  const q = trpc.payrollStatutory.settings.useQuery({ financialYear: fy });
  if (q.isLoading || !q.data) return <p className="text-sm text-text-tertiary">Loading statutory settings...</p>;
  const s = q.data;
  return (
    <div className="space-y-5">
      <VerifyWithCa note="PF, ESI, professional tax, labour welfare fund and income-tax rules change often. Confirm each figure below with your CA before you run payroll, and again every year." />
      <Registrations key={JSON.stringify(s.flags)} flags={s.flags} hasTan={s.hasTan} canEdit={s.canEdit} />
      <Rates
        key={`${fy}-${s.ratesSource}-${s.ratesSavedForFinancialYear}-${s.verifiedOn}-${s.verifiedNote}`}
        data={s}
        fy={fy}
        onFy={setFy}
      />
    </div>
  );
}

// ── Registrations ────────────────────────────────────────────────────────────

function Registrations({ flags, hasTan, canEdit }: { flags: Flags; hasTan: boolean; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [v, setV] = useState({
    pfRegistered: flags.pfRegistered,
    pfEstablishmentCode: flags.pfEstablishmentCode ?? "",
    esiRegistered: flags.esiRegistered,
    esiCode: flags.esiCode ?? "",
    ptStates: flags.ptStates,
    lwfState: flags.lwfState ?? "",
    tdsEnabled: flags.tdsEnabled,
  });
  const save = trpc.payrollStatutory.updateBusinessSettings.useMutation({
    onSuccess: () => {
      toast({ title: "Registrations saved. Calculate the payroll run again to apply them.", variant: "success" });
      void utils.payrollStatutory.settings.invalidate();
    },
    onError: onError("Could not save the registrations"),
  });
  const toggleState = (code: string) => setV((s) => ({ ...s, ptStates: s.ptStates.includes(code) ? s.ptStates.filter((c) => c !== code) : [...s.ptStates, code] }));
  return (
    <Panel title="Registrations" actions={canEdit ? <button className="btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate({ ...v, lwfState: v.lwfState || null })}>Save registrations</button> : undefined}>
      <div className="grid gap-5 p-4 sm:grid-cols-2">
        {!canEdit && <p className="text-sm text-text-tertiary sm:col-span-2">Only an owner or admin can change these.</p>}
        <div className="space-y-2">
          <CheckRow label="Registered for provident fund (PF)" checked={v.pfRegistered} onChange={(c) => setV((s) => ({ ...s, pfRegistered: c }))} hint="Off: PF and EPS never appear anywhere in payroll." />
          {v.pfRegistered && <InputField label="PF establishment code" disabled={!canEdit} value={v.pfEstablishmentCode} onChange={(e) => setV((s) => ({ ...s, pfEstablishmentCode: e.target.value }))} />}
        </div>
        <div className="space-y-2">
          <CheckRow label="Registered for ESI" checked={v.esiRegistered} onChange={(c) => setV((s) => ({ ...s, esiRegistered: c }))} />
          {v.esiRegistered && <InputField label="ESI code" disabled={!canEdit} value={v.esiCode} onChange={(e) => setV((s) => ({ ...s, esiCode: e.target.value }))} />}
        </div>
        <div className="space-y-2">
          <CheckRow label="Deduct income tax (TDS) on salary" checked={v.tdsEnabled} onChange={(c) => setV((s) => ({ ...s, tdsEnabled: c }))} hint="Needs the business's TAN and the income-tax slabs below." />
          {v.tdsEnabled && !hasTan && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">The business has no TAN yet: add it in Business settings before the TDS return.</p>}
        </div>
        <SelectField label="Labour welfare fund state" value={v.lwfState} onChange={(e) => setV((s) => ({ ...s, lwfState: e.target.value }))} disabled={!canEdit}>
          <option value="">Not applicable</option>
          {INDIAN_STATES.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
        </SelectField>
        <fieldset className="sm:col-span-2">
          <legend className="label">Professional tax states</legend>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {INDIAN_STATES.map((st) => (
              <label key={st.code} className="flex items-center gap-2 text-sm text-text-primary">
                <input type="checkbox" disabled={!canEdit} checked={v.ptStates.includes(st.code)} onChange={() => toggleState(st.code)} />
                {st.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Panel>
  );
}

// ── Rates ────────────────────────────────────────────────────────────────────

type SettingsData = StatutoryOut["settings"];

function Rates({ data, fy, onFy }: { data: SettingsData; fy: number; onFy: (fy: number) => void }) {
  const utils = trpc.useUtils();
  const reg = statutoryRegistrations(data.flags);
  const [rates, setRates] = useState<StatutoryRates>(() => structuredClone(data.rates) as StatutoryRates);
  const [note, setNote] = useState(data.verifiedNote ?? "");
  const [verifiedOn, setVerifiedOn] = useState(data.verifiedOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const canEdit = data.canEdit;
  const save = trpc.payrollStatutory.saveRates.useMutation({
    onSuccess: () => {
      toast({ title: `Rates saved for ${fyLabel(fy)}. Calculate the payroll run again to apply them.`, variant: "success" });
      void utils.payrollStatutory.settings.invalidate();
    },
    onError: onError("Could not save the rates"),
  });
  const patch = (f: (r: StatutoryRates) => void) =>
    setRates((r) => {
      const next = structuredClone(r) as StatutoryRates;
      f(next);
      return next;
    });
  function submit() {
    const parsed = statutoryRatesSchema.safeParse(rates);
    if (!parsed.success) return setError(`${parsed.error.issues[0]!.path.join(" > ")}: ${parsed.error.issues[0]!.message}`);
    setError(null);
    save.mutate({ financialYear: fy, rates: parsed.data, verifiedNote: note, verifiedOn });
  }

  return (
    <Panel
      title="Rates and limits"
      actions={canEdit ? <button className="btn-primary btn-sm" disabled={save.isPending} onClick={submit}>Save for {fyLabel(fy)}</button> : undefined}
    >
      <div className="space-y-6 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FyPicker value={fy} onChange={onFy} />
          <InputField label="Last verified note" value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} placeholder="Checked with CA Shah, Finance Act 2026" />
          <InputField label="Verified on" type="date" value={verifiedOn} disabled={!canEdit} onChange={(e) => setVerifiedOn(e.target.value)} />
        </div>
        <p className="text-xs text-text-tertiary">
          {data.ratesSource === "saved"
            ? `Using figures saved for ${fyLabel(data.ratesSavedForFinancialYear ?? fy)}${data.ratesSavedForFinancialYear !== fy ? " (carried forward: save to set this year's own)" : ""}.`
            : "Nothing saved yet: these are the figures Fintranzact starts from. Review them, then save."}
        </p>
        {data.gaps.length > 0 && (
          <ul role="status" aria-label="Not configured" className="list-disc space-y-1 rounded-lg bg-amber-50 px-8 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {data.gaps.map((g) => <li key={g}>{g}</li>)}
          </ul>
        )}

        {reg.pf && <PfSection rates={rates} patch={patch} disabled={!canEdit} />}
        {reg.esi && <EsiSection rates={rates} patch={patch} disabled={!canEdit} />}
        {data.flags.ptStates.map((code) => <PtSection key={code} code={code} rates={rates} patch={patch} disabled={!canEdit} />)}
        {data.flags.lwfState && <LwfSection code={data.flags.lwfState} rates={rates} patch={patch} disabled={!canEdit} />}
        {reg.tds && <TdsSection rates={rates} patch={patch} disabled={!canEdit} />}
        <DueDates rates={rates} patch={patch} disabled={!canEdit} reg={reg} />
        <RegistersSection rates={rates} patch={patch} disabled={!canEdit} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </Panel>
  );
}

type SectionProps = { rates: StatutoryRates; patch: (f: (r: StatutoryRates) => void) => void; disabled: boolean };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-semibold text-text-primary">{title}</legend>
      {children}
    </fieldset>
  );
}

function RoundingSelect({ value, onChange, disabled }: { value: StatutoryRates["pf"]["rounding"]; onChange: (v: StatutoryRates["pf"]["rounding"]) => void; disabled: boolean }) {
  return (
    <SelectField label="Rounding" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as typeof value)}>
      {ROUNDING_MODES.map((m) => <option key={m} value={m}>{ROUNDING_MODE_LABELS[m]}</option>)}
    </SelectField>
  );
}

function PfSection({ rates, patch, disabled }: SectionProps) {
  const p = rates.pf;
  return (
    <Section title="Provident fund (PF, EPS)">
      <div className="grid gap-3 sm:grid-cols-4">
        <NumField label="Employee share" suffix="%" value={p.employeePercent} disabled={disabled} onChange={(n) => patch((r) => void (r.pf.employeePercent = n ?? 0))} />
        <NumField label="Employer share" suffix="%" value={p.employerPercent} disabled={disabled} onChange={(n) => patch((r) => void (r.pf.employerPercent = n ?? 0))} />
        <NumField label="Of which EPS" suffix="%" value={p.epsPercent} disabled={disabled} onChange={(n) => patch((r) => void (r.pf.epsPercent = n ?? 0))} />
        <RoundingSelect value={p.rounding} disabled={disabled} onChange={(m) => patch((r) => void (r.pf.rounding = m))} />
        <NumField label="PF wage ceiling" suffix="₹ a month" value={p.wageCeilingRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.pf.wageCeilingRupees = n ?? 0))} />
        <NumField label="EPS wage ceiling" suffix="₹ a month" value={p.epsWageCeilingRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.pf.epsWageCeilingRupees = n ?? 0))} />
        <InputField label="No EPS for members joining on or after" type="date" value={p.epsCutoffDate} disabled={disabled} onChange={(e) => patch((r) => void (r.pf.epsCutoffDate = e.target.value))} />
        <NumField label="EPS stops at age" value={p.epsStopAge} disabled={disabled} onChange={(n) => patch((r) => void (r.pf.epsStopAge = n ?? 58))} />
      </div>
    </Section>
  );
}

function EsiSection({ rates, patch, disabled }: SectionProps) {
  const e = rates.esi;
  return (
    <Section title="ESI">
      <div className="grid gap-3 sm:grid-cols-4">
        <NumField label="Employee share" suffix="%" value={e.employeePercent} disabled={disabled} onChange={(n) => patch((r) => void (r.esi.employeePercent = n ?? 0))} />
        <NumField label="Employer share" suffix="%" value={e.employerPercent} disabled={disabled} onChange={(n) => patch((r) => void (r.esi.employerPercent = n ?? 0))} />
        <NumField label="Wage ceiling" suffix="₹ a month" value={e.wageCeilingRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.esi.wageCeilingRupees = n ?? 0))} />
        <RoundingSelect value={e.rounding} disabled={disabled} onChange={(m) => patch((r) => void (r.esi.rounding = m))} />
      </div>
      <p className="text-xs text-text-tertiary">Contribution periods run April to September and October to March: an employee covered in a period stays covered to its end, even if wages rise above the ceiling.</p>
    </Section>
  );
}

function SlabRows<T extends { fromRupees: number; toRupees: number | null }>({
  rows, onChange, disabled, extra, blank, label,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  disabled: boolean;
  label: string;
  blank: T;
  extra: Array<{ header: string; cell: (row: T, set: (patch: Partial<T>) => void) => React.ReactNode }>;
}) {
  const set = (i: number, patch: Partial<T>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={label}>
        <thead>
          <tr className="text-left text-xs text-text-tertiary">
            <th className="pr-2">Above (₹)</th><th className="pr-2">Up to (₹, blank = no limit)</th>
            {extra.map((x) => <th key={x.header} className="pr-2">{x.header}</th>)}
            <th><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="pr-2"><NumField label={`${label} row ${i + 1} above`} value={r.fromRupees} disabled={disabled} onChange={(n) => set(i, { fromRupees: n ?? 0 } as Partial<T>)} /></td>
              <td className="pr-2"><NumField label={`${label} row ${i + 1} up to`} nullable value={r.toRupees} disabled={disabled} onChange={(n) => set(i, { toRupees: n } as Partial<T>)} /></td>
              {extra.map((x) => <td key={x.header} className="pr-2">{x.cell(r, (p) => set(i, p))}</td>)}
              <td>{!disabled && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!disabled && <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => onChange([...rows, { ...blank }])}>+ Add slab</button>}
    </div>
  );
}

function PtSection({ code, rates, patch, disabled }: SectionProps & { code: string }) {
  const rule = rates.pt[code];
  const name = stateByCode(code)?.name ?? code;
  const slabs = rule?.slabs ?? [];
  const setSlabs = (next: PtSlab[]) => patch((r) => void (r.pt[code] = { ...r.pt[code], annualMaxRupees: r.pt[code]?.annualMaxRupees ?? 2500, slabs: next }));
  return (
    <Section title={`Professional tax: ${name}`}>
      {slabs.length === 0 && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Slabs not configured: add your state's slabs. Until you do, no professional tax is deducted and the payroll run shows a warning.</p>}
      <NumField label={`${name} yearly maximum`} suffix="₹ (0 = none)" value={rule?.annualMaxRupees ?? 2500} disabled={disabled} onChange={(n) => patch((r) => void (r.pt[code] = { ...r.pt[code], slabs: r.pt[code]?.slabs ?? [], annualMaxRupees: n ?? 0 }))} />
      <SlabRows<PtSlab>
        label={`${name} professional tax slabs`}
        rows={slabs}
        onChange={setSlabs}
        disabled={disabled}
        blank={{ fromRupees: 0, toRupees: null, monthlyRupees: 0, februaryRupees: null, gender: "any" }}
        extra={[
          { header: "Monthly tax (₹)", cell: (r, set) => <NumField label={`${name} slab monthly ${r.fromRupees}`} value={r.monthlyRupees} disabled={disabled} onChange={(n) => set({ monthlyRupees: n ?? 0 })} /> },
          { header: "February (₹, blank = same)", cell: (r, set) => <NumField label={`${name} slab february ${r.fromRupees}`} nullable value={r.februaryRupees ?? null} disabled={disabled} onChange={(n) => set({ februaryRupees: n })} /> },
          {
            header: "Applies to",
            cell: (r, set) => (
              <select aria-label={`${name} slab gender ${r.fromRupees}`} className="input" value={r.gender} disabled={disabled} onChange={(e) => set({ gender: e.target.value as PtSlab["gender"] })}>
                {PT_GENDERS.map((g) => <option key={g} value={g}>{g === "any" ? "Everyone" : g === "male" ? "Men" : "Women"}</option>)}
              </select>
            ),
          },
        ]}
      />
    </Section>
  );
}

function LwfSection({ code, rates, patch, disabled }: SectionProps & { code: string }) {
  const name = stateByCode(code)?.name ?? code;
  const rule = rates.lwf[code];
  const set = (f: (x: NonNullable<StatutoryRates["lwf"][string]>) => void) =>
    patch((r) => {
      r.lwf[code] ??= { frequency: "half_yearly", deductionMonths: [6, 12], employeeRupees: 0, employerRupees: 0 };
      f(r.lwf[code]!);
    });
  return (
    <Section title={`Labour welfare fund: ${name}`}>
      {!rule && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Amounts not configured: add them below. Until you do, no labour welfare fund is deducted and the payroll run shows a warning.</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <SelectField label="How often" value={rule?.frequency ?? "half_yearly"} disabled={disabled} onChange={(e) => set((x) => void (x.frequency = e.target.value as LwfFrequency))}>
          {LWF_FREQUENCIES.map((f) => <option key={f} value={f}>{f === "monthly" ? "Monthly" : f === "half_yearly" ? "Half-yearly" : "Yearly"}</option>)}
        </SelectField>
        <InputField
          label="Deducted in months (numbers, e.g. 6, 12)"
          disabled={disabled}
          value={(rule?.deductionMonths ?? [6, 12]).join(", ")}
          onChange={(e) => set((x) => void (x.deductionMonths = e.target.value.split(",").map((t) => Number(t.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)))}
        />
        <NumField label="Employee amount" suffix="₹" value={rule?.employeeRupees ?? 0} disabled={disabled} onChange={(n) => set((x) => void (x.employeeRupees = n ?? 0))} />
        <NumField label="Employer amount" suffix="₹" value={rule?.employerRupees ?? 0} disabled={disabled} onChange={(n) => set((x) => void (x.employerRupees = n ?? 0))} />
      </div>
    </Section>
  );
}

function RegimeEditor({ title, regime, disabled, onChange }: { title: string; regime: RegimeConfig; disabled: boolean; onChange: (f: (x: RegimeConfig) => void) => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-border-light p-3">
      <h4 className="text-sm font-medium text-text-primary">{title}</h4>
      {regime.slabs.length === 0 && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Income-tax slabs not configured: add them. Until you do, no TDS is deducted for employees on this regime and the payroll run shows a warning.</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <NumField label={`${title} standard deduction`} suffix="₹" value={regime.standardDeductionRupees} disabled={disabled} onChange={(n) => onChange((x) => void (x.standardDeductionRupees = n ?? 0))} />
        <NumField label={`${title} rebate (s.87A) income limit`} suffix="₹ (0 = none)" value={regime.rebateThresholdRupees} disabled={disabled} onChange={(n) => onChange((x) => void (x.rebateThresholdRupees = n ?? 0))} />
        <NumField label={`${title} rebate (s.87A) maximum`} suffix="₹" value={regime.rebateMaxRupees} disabled={disabled} onChange={(n) => onChange((x) => void (x.rebateMaxRupees = n ?? 0))} />
        <CheckRow label="Marginal relief above the limit" checked={regime.marginalRelief} onChange={(c) => onChange((x) => void (x.marginalRelief = c))} />
      </div>
      <SlabRows<TaxSlab>
        label={`${title} income-tax slabs`}
        rows={regime.slabs}
        onChange={(rows) => onChange((x) => void (x.slabs = rows))}
        disabled={disabled}
        blank={{ fromRupees: 0, toRupees: null, ratePercent: 0 }}
        extra={[{ header: "Rate (%)", cell: (r, set) => <NumField label={`${title} slab rate ${r.fromRupees}`} value={r.ratePercent} disabled={disabled} onChange={(n) => set({ ratePercent: n ?? 0 })} /> }]}
      />
    </div>
  );
}

function TdsSection({ rates, patch, disabled }: SectionProps) {
  const t = rates.tds;
  return (
    <Section title="Income tax on salary (TDS, s.192)">
      <div className="grid gap-3 sm:grid-cols-4">
        <NumField label="Health and education cess" suffix="%" value={t.cessPercent} disabled={disabled} onChange={(n) => patch((r) => void (r.tds.cessPercent = n ?? 0))} />
        <NumField label="Round income and tax to a multiple of" suffix="₹" value={t.roundingRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.tds.roundingRupees = Math.max(1, Math.round(n ?? 1))))} />
        <NumField label="Section 80C limit" suffix="₹ (0 = none)" value={t.limits.sec80CRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.tds.limits.sec80CRupees = n ?? 0))} />
        <NumField label="Section 80D limit" suffix="₹ (0 = none)" value={t.limits.sec80DRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.tds.limits.sec80DRupees = n ?? 0))} />
        <NumField label="Home-loan interest limit" suffix="₹ (0 = none)" value={t.limits.homeLoanInterestRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.tds.limits.homeLoanInterestRupees = n ?? 0))} />
        <NumField label="Warn above taxable income of" suffix="₹ (surcharge not computed)" value={t.surchargeWarnAboveRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.tds.surchargeWarnAboveRupees = n ?? 0))} />
      </div>
      <RegimeEditor title="New regime" regime={t.newRegime} disabled={disabled} onChange={(f) => patch((r) => f(r.tds.newRegime))} />
      <RegimeEditor title="Old regime" regime={t.oldRegime} disabled={disabled} onChange={(f) => patch((r) => f(r.tds.oldRegime))} />
    </Section>
  );
}

function DueDates({ rates, patch, disabled, reg }: SectionProps & { reg: ReturnType<typeof statutoryRegistrations> }) {
  const d = rates.dueDates;
  if (!(reg.pf || reg.esi || reg.pt || reg.lwf || reg.tds)) return null;
  return (
    <Section title="Due dates">
      <p className="text-xs text-text-tertiary">Day of the month after the wage month. Shown on the Statutory dues tab.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {reg.pf && <NumField label="PF payment and ECR" suffix="day" value={d.pfDay} disabled={disabled} onChange={(n) => patch((r) => void (r.dueDates.pfDay = Math.min(31, Math.max(1, n ?? 15))))} />}
        {reg.esi && <NumField label="ESI payment" suffix="day" value={d.esiDay} disabled={disabled} onChange={(n) => patch((r) => void (r.dueDates.esiDay = Math.min(31, Math.max(1, n ?? 15))))} />}
        {reg.tds && <NumField label="TDS deposit" suffix="day" value={d.tdsDepositDay} disabled={disabled} onChange={(n) => patch((r) => void (r.dueDates.tdsDepositDay = Math.min(31, Math.max(1, n ?? 7))))} />}
        {reg.pt && <NumField label="Professional tax" nullable suffix="day, blank = not set" value={d.ptDay} disabled={disabled} onChange={(n) => patch((r) => void (r.dueDates.ptDay = n === null ? null : Math.min(31, Math.max(1, n))))} />}
        {reg.lwf && <NumField label="Labour welfare fund" nullable suffix="day, blank = not set" value={d.lwfDay} disabled={disabled} onChange={(n) => patch((r) => void (r.dueDates.lwfDay = n === null ? null : Math.min(31, Math.max(1, n))))} />}
        {reg.tds && <InputField label="March TDS deposit (MM-DD)" value={d.tdsMarchDeposit} disabled={disabled} onChange={(e) => patch((r) => void (r.dueDates.tdsMarchDeposit = e.target.value))} />}
        {reg.tds && <InputField label="Form 16 due (MM-DD)" value={d.form16} disabled={disabled} onChange={(e) => patch((r) => void (r.dueDates.form16 = e.target.value))} />}
      </div>
    </Section>
  );
}

function RegistersSection({ rates, patch, disabled }: SectionProps) {
  const g = rates.gratuity;
  const b = rates.bonus;
  return (
    <Section title="Bonus and gratuity registers">
      <p className="text-xs text-text-tertiary">These only feed the computed registers on the Filings tab. Nothing is paid from them.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <NumField label="Gratuity days per year" value={g.daysPerYear} disabled={disabled} onChange={(n) => patch((r) => void (r.gratuity.daysPerYear = n ?? 0))} />
        <NumField label="Gratuity working-days divisor" value={g.workingDaysDivisor} disabled={disabled} onChange={(n) => patch((r) => void (r.gratuity.workingDaysDivisor = Math.max(1, n ?? 26)))} />
        <NumField label="Gratuity minimum years" value={g.minYears} disabled={disabled} onChange={(n) => patch((r) => void (r.gratuity.minYears = n ?? 0))} />
        <NumField label="Gratuity limit" suffix="₹ (0 = none)" value={g.capRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.gratuity.capRupees = n ?? 0))} />
        <NumField label="Bonus wage ceiling" suffix="₹ a month (0 = not set)" value={b.wageCeilingRupees} disabled={disabled} onChange={(n) => patch((r) => void (r.bonus.wageCeilingRupees = n ?? 0))} />
        <NumField label="Bonus percentage" suffix="% (0 = not set)" value={b.percent} disabled={disabled} onChange={(n) => patch((r) => void (r.bonus.percent = n ?? 0))} />
      </div>
    </Section>
  );
}
