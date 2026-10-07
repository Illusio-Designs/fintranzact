import { useState } from "react";
import { fyLabel } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { SelectField } from "@/components/ui/FormField";
import { Panel, currentMonth, downloadBase64, downloadText, errorMessage, monthLabel, shiftMonth } from "./payroll-ui";
import { FyPicker, VerifyWithCa, currentFinancialYear } from "./statutory-ui";

interface RunFlags {
  pfRegistered?: boolean;
  esiRegistered?: boolean;
  ptStates?: string[];
  lwfState?: string | null;
  tdsEnabled?: boolean;
}

/**
 * Downloadable files for the owner or the CA to upload or file: PF ECR, ESIC
 * contribution file, PT and LWF working sheets, Form 24Q working data, Form 16
 * working copies and the registers. Nothing is filed with any government
 * system, and every layout must be checked against the portal's current template.
 */
export function FilingsTab() {
  const utils = trpc.useUtils();
  const runs = trpc.payrollRun.list.useQuery();
  const employees = trpc.payrollEmployee.list.useQuery({ status: "all", page: 1, limit: 200 });
  const approved = (runs.data ?? []).filter((r) => ["approved", "posted", "paid"].includes(r.status));
  const [runId, setRunId] = useState("");
  const run = approved.find((r) => r.id === runId) ?? approved[0];
  const flags = (run?.statutory?.flags ?? {}) as RunFlags;
  const [fy, setFy] = useState(currentFinancialYear());
  const [quarter, setQuarter] = useState(1);
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(currentMonth());

  async function run_<T>(label: string, f: () => Promise<T>, done: (r: T) => { note?: string; skipped?: string[] }) {
    try {
      const r = await f();
      const { note, skipped } = done(r);
      toast({
        title: `${label} ready`,
        description: [skipped?.length ? `Left out: ${skipped.join(", ")}.` : null, note].filter(Boolean).join(" "),
        variant: skipped?.length ? "warning" : "success",
      });
    } catch (e) {
      toast({ title: `Could not make the ${label}`, description: errorMessage(e), variant: "error" });
    }
  }

  const skipText = (s: Array<{ employeeCode: string; reason: string }>) => s.map((x) => `${x.employeeCode} (${x.reason})`);
  const fetchOpts = { staleTime: 0 };

  return (
    <div className="space-y-5">
      <VerifyWithCa note="These are files for you or your CA to check and upload. Fintranzact files nothing with EPFO, ESIC, the income-tax portal or any state. Check every layout against the portal's current template first." />

      <Panel title="Monthly files from an approved payroll run">
        <div className="space-y-4 p-4">
          {approved.length === 0 ? (
            <p className="text-sm text-text-tertiary">Files are available once a payroll run is approved.</p>
          ) : (
            <>
              <SelectField label="Payroll run" value={run?.id ?? ""} onChange={(e) => setRunId(e.target.value)}>
                {approved.map((r) => <option key={r.id} value={r.id}>{monthLabel(r.month)}</option>)}
              </SelectField>
              <div className="flex flex-wrap gap-2">
                {flags.pfRegistered && (
                  <button className="btn-secondary" onClick={() => void run_("PF ECR file", () => utils.payrollStatutory.ecrFile.fetch({ runId: run!.id }, fetchOpts), (r) => { downloadText(r.filename, "text/plain", r.text); return { note: r.note, skipped: skipText(r.skipped) }; })}>PF ECR file</button>
                )}
                {flags.esiRegistered && (
                  <button className="btn-secondary" onClick={() => void run_("ESIC file", () => utils.payrollStatutory.esicFile.fetch({ runId: run!.id }, fetchOpts), (r) => { downloadText(r.filename, "text/csv", r.text); return { note: r.note, skipped: skipText(r.skipped) }; })}>ESIC contribution file</button>
                )}
                {(flags.ptStates?.length ?? 0) > 0 && (
                  <button className="btn-secondary" onClick={() => void run_("professional tax sheets", () => utils.payrollStatutory.ptSheets.fetch({ runId: run!.id }, fetchOpts), (r) => { for (const s of r.sheets) downloadText(s.filename, "text/csv", s.text); return { note: r.note }; })}>Professional tax sheets</button>
                )}
                {flags.lwfState && (
                  <button className="btn-secondary" onClick={() => void run_("labour welfare fund sheets", () => utils.payrollStatutory.lwfSheets.fetch({ runId: run!.id }, fetchOpts), (r) => { for (const s of r.sheets) downloadText(s.filename, "text/csv", s.text); return { note: r.note }; })}>Labour welfare fund sheets</button>
                )}
                {!flags.pfRegistered && !flags.esiRegistered && !(flags.ptStates?.length) && !flags.lwfState && (
                  <p className="text-sm text-text-tertiary">This run was calculated with no statutory scheme turned on, so it has no statutory files. Turn a scheme on in Statutory settings; it applies to the next run you calculate.</p>
                )}
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Income tax on salary (TDS)">
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <FyPicker value={fy} onChange={setFy} />
            <SelectField label="Quarter" value={String(quarter)} onChange={(e) => setQuarter(Number(e.target.value))}>
              <option value="1">Q1 (April to June)</option>
              <option value="2">Q2 (July to September)</option>
              <option value="3">Q3 (October to December)</option>
              <option value="4">Q4 (January to March)</option>
            </SelectField>
            <div className="flex items-end">
              <button className="btn-secondary" onClick={() => void run_("Form 24Q data", () => utils.payrollStatutory.form24q.fetch({ financialYear: fy, quarter }, fetchOpts), (r) => { downloadText(r.deducteeFilename, "text/csv", r.deducteeCsv); downloadText(r.challanFilename, "text/csv", r.challanCsv); return { note: r.note }; })}>
                Form 24Q data
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <SelectField label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose...</option>
              {(employees.data?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
            </SelectField>
            <div className="flex items-end gap-2 sm:col-span-3">
              <button className="btn-secondary" disabled={!employeeId} onClick={() => void run_(`Form 16 working copy (${fyLabel(fy)})`, () => utils.payrollStatutory.form16Pdf.fetch({ financialYear: fy, employeeId }, fetchOpts), (r) => { downloadBase64(r.filename, r.contentType, r.base64); return { note: r.label }; })}>Form 16 (PDF)</button>
              <button className="btn-secondary" disabled={!employeeId} onClick={() => void run_("Form 16 data", () => utils.payrollStatutory.form16Data.fetch({ financialYear: fy, employeeId }, fetchOpts), (r) => { downloadText(r.filename, "text/csv", r.csv); return { note: r.label }; })}>Form 16 data (CSV)</button>
            </div>
          </div>
          <p className="text-xs text-text-tertiary">Form 16 here is a working copy for your CA to review. It is not generated by TRACES and is not a validated certificate.</p>
        </div>
      </Panel>

      <Panel title="Registers">
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <SelectField label="Month (wages and attendance)" value={month} onChange={(e) => setMonth(e.target.value)}>
              {Array.from({ length: 18 }, (_, i) => shiftMonth(currentMonth(), -i)).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </SelectField>
            <FyPicker label="Financial year (bonus)" value={fy} onChange={setFy} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["wages", "attendance"] as const).map((k) => (
              <button key={k} className="btn-secondary" onClick={() => void run_(`${k} register`, () => utils.payrollStatutory.register.fetch({ register: k, month }, fetchOpts), (r) => { downloadText(r.filename, "text/csv", r.text); return {}; })}>
                {k === "wages" ? "Wages register" : "Attendance register"}
              </button>
            ))}
            <button className="btn-secondary" onClick={() => void run_("leave register", () => utils.payrollStatutory.register.fetch({ register: "leave" }, fetchOpts), (r) => { downloadText(r.filename, "text/csv", r.text); return {}; })}>Leave register</button>
            <button className="btn-secondary" onClick={() => void run_("bonus register", () => utils.payrollStatutory.register.fetch({ register: "bonus", financialYear: fy }, fetchOpts), (r) => { downloadText(r.filename, "text/csv", r.text); return { note: "Computed from payroll data at the percentage in Statutory settings. No bonus is paid from here." }; })}>Bonus register</button>
            <button className="btn-secondary" onClick={() => void run_("gratuity register", () => utils.payrollStatutory.register.fetch({ register: "gratuity", financialYear: fy }, fetchOpts), (r) => { downloadText(r.filename, "text/csv", r.text); return { note: "Computed from joining dates and last drawn Basic + DA. No gratuity is paid from here." }; })}>Gratuity register</button>
          </div>
          <p className="text-xs text-text-tertiary">The bonus and gratuity registers are computed from your payroll data. Paying bonus or gratuity is not part of this release.</p>
        </div>
      </Panel>
    </div>
  );
}
