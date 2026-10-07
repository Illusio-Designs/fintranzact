import { useMemo, useState } from "react";
import {
  CALC_TYPES,
  CALC_TYPE_LABELS,
  COMPONENT_CATEGORY_LABELS,
  COMPONENT_TYPES,
  COMPONENT_TYPE_LABELS,
  payrollStatutoryNote,
  PayrollRuleError,
  categoriesForType,
  computeSalaryBreakdown,
  paiseToRupees,
  rupeesToPaise,
  salaryComponentSchema,
  type CalcType,
  type ComponentCategory,
  type ComponentType,
  type SalaryBreakdown,
  type SalaryLineDef,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { useCan } from "@/lib/permissions";
import { formatCurrency, formatDate, todayISODate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { CheckRow, Panel, TABLE, onError } from "./payroll-ui";

interface ComponentRow {
  id: string;
  code: string;
  name: string;
  type: string;
  category: string;
  prorate: boolean;
  isWage: boolean;
  isActive: boolean;
}

interface LineDraft {
  componentId: string;
  calcType: CalcType;
  value: string;
}

/** Monthly breakdown for the lines, or the reason it cannot be made (shown to the person, not thrown). */
export function previewBreakdown(annualCtc: number, lines: LineDraft[], components: ComponentRow[]): { breakdown: SalaryBreakdown | null; error: string | null } {
  const byId = new Map(components.map((c) => [c.id, c]));
  const defs: SalaryLineDef[] = [];
  for (const l of lines) {
    const c = byId.get(l.componentId);
    if (!c) continue;
    defs.push({
      componentId: c.id,
      code: c.code,
      name: c.name,
      type: c.type as ComponentType,
      category: c.category as ComponentCategory,
      isWage: c.isWage,
      prorate: c.prorate,
      calcType: l.calcType,
      value: Number(l.value) || 0,
    });
  }
  if (defs.length === 0) return { breakdown: null, error: null };
  try {
    return { breakdown: computeSalaryBreakdown({ annualCtcPaise: rupeesToPaise(annualCtc || 0), lines: defs }), error: null };
  } catch (e) {
    return { breakdown: null, error: e instanceof PayrollRuleError ? e.message : "These lines cannot be calculated." };
  }
}

export function BreakdownTable({ breakdown }: { breakdown: SalaryBreakdown }) {
  const money = (p: number) => formatCurrency(paiseToRupees(p));
  return (
    <div data-testid="salary-breakdown" className="space-y-2">
      <table className={TABLE}>
        <thead>
          <tr><th>Component</th><th className="text-right">Per month</th><th className="text-right">Per year</th></tr>
        </thead>
        <tbody>
          {breakdown.lines.map((l) => (
            <tr key={l.componentId ?? l.code}>
              <td>
                {l.name}
                {l.type !== "earning" && <span className="ml-2 text-xs text-text-tertiary">{COMPONENT_TYPE_LABELS[l.type]}</span>}
              </td>
              <td className="text-right tabular-nums">{money(l.monthlyPaise)}</td>
              <td className="text-right tabular-nums text-text-secondary">{money(l.monthlyPaise * 12)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold"><td>Gross earnings</td><td className="text-right tabular-nums">{money(breakdown.grossPaise)}</td><td className="text-right tabular-nums">{money(breakdown.grossPaise * 12)}</td></tr>
          <tr><td>Monthly CTC</td><td className="text-right tabular-nums">{money(breakdown.monthlyCtcPaise)}</td><td className="text-right tabular-nums">{money(breakdown.annualCtcPaise)}</td></tr>
        </tfoot>
      </table>
      {breakdown.wagePercent !== null && (
        <p className="text-xs text-text-tertiary">Wages (Basic + DA + retaining allowance) are {breakdown.wagePercent}% of the total remuneration.</p>
      )}
      {breakdown.warnings.map((w) => (
        <p key={w.code} role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">{w.message}</p>
      ))}
    </div>
  );
}

export function SalaryTab() {
  const utils = trpc.useUtils();
  const canDelete = useCan("Payroll", "delete");
  const components = trpc.payrollSalary.componentList.useQuery();
  const templates = trpc.payrollSalary.templateList.useQuery();
  const overview = trpc.payrollSalary.overview.useQuery();
  const [componentOpen, setComponentOpen] = useState(false);
  const [template, setTemplate] = useState<string | "new" | null>(null);
  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(null);

  const seed = trpc.payrollSalary.componentSeedDefaults.useMutation({
    onSuccess: (r) => {
      toast({ title: r.added ? `Added ${r.added} standard components` : "The standard components are already there", variant: "success" });
      void utils.payrollSalary.componentList.invalidate();
    },
    onError: onError("Could not add the components"),
  });
  const del = trpc.payrollSalary.templateDelete.useMutation({
    onSuccess: () => {
      toast({ title: "Template deleted. Employees keep their salary.", variant: "success" });
      void utils.payrollSalary.templateList.invalidate();
    },
    onError: onError("Could not delete the template"),
  });

  const comps = (components.data ?? []) as ComponentRow[];

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-surface-1 px-4 py-3 text-sm text-text-secondary">{payrollStatutoryNote(statutoryRegistrations(flags))}</p>

      <Panel
        title="Salary components"
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => seed.mutate()} disabled={seed.isPending}>Add standard components</button>
            <button className="btn-primary btn-sm" onClick={() => setComponentOpen(true)}>+ Component</button>
          </>
        }
      >
        {comps.length === 0 ? (
          <EmptyState title="No components yet" description="Components are the lines of a salary: Basic, HRA, special allowance, bonus and deductions. Add the standard set to start." action={<button className="btn-primary" onClick={() => seed.mutate()}>Add standard components</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Category</th><th>Pays</th><th><span className="sr-only">Notes</span></th></tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-text-primary">{c.code}</td>
                    <td>{c.name}</td>
                    <td className="text-text-secondary">{COMPONENT_TYPE_LABELS[c.type as ComponentType]}</td>
                    <td className="text-text-secondary">{COMPONENT_CATEGORY_LABELS[c.category as ComponentCategory]}</td>
                    <td className="text-text-secondary">{c.prorate ? "By paid days" : "In full"}</td>
                    <td>{c.isWage && <Badge color="bg-blue-600/[0.08] text-blue-700 dark:text-blue-400">Wage</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Salary templates" actions={<button className="btn-primary btn-sm" onClick={() => setTemplate("new")} disabled={comps.length === 0}>+ Template</button>}>
        {(templates.data ?? []).length === 0 ? (
          <EmptyState title="No templates yet" description="A template says how an annual CTC splits into monthly amounts, for example Staff 25k or Manager 60k. You choose the CTC for each employee." />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Template</th><th>Lines</th><th className="text-right">Employees</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {(templates.data ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-text-primary">{t.name}{t.description && <p className="text-xs font-normal text-text-tertiary">{t.description}</p>}</td>
                    <td className="text-xs text-text-secondary">{t.lines.map((l) => l.name).join(", ")}</td>
                    <td className="text-right tabular-nums">{t.employeeCount}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-secondary btn-sm mr-2" onClick={() => setTemplate(t.id)}>Edit</button>
                      {canDelete && <button className="btn-secondary btn-sm" onClick={() => del.mutate({ id: t.id })} disabled={del.isPending}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Employee salaries">
        {(overview.data ?? []).length === 0 ? (
          <EmptyState title="No active employees" description="Add employees first, then give each one a salary." />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Employee</th><th>Template</th><th className="text-right">Annual CTC</th><th className="text-right">Monthly CTC</th><th>From</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {(overview.data ?? []).map((o) => (
                  <tr key={o.employeeId}>
                    <td className="font-medium text-text-primary">{o.name} <span className="text-xs font-normal text-text-tertiary">{o.employeeCode}</span></td>
                    <td className="text-text-secondary">{o.templateName ?? (o.annualCtc ? "-" : <span className="text-amber-700 dark:text-amber-400">No salary yet</span>)}</td>
                    <td className="text-right tabular-nums">{o.annualCtc ? formatCurrency(o.annualCtc) : "-"}</td>
                    <td className="text-right tabular-nums">{o.monthlyCtc ? formatCurrency(o.monthlyCtc) : "-"}</td>
                    <td className="text-text-secondary">{o.effectiveFrom ? formatDate(o.effectiveFrom) : "-"}</td>
                    <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => setAssigning({ id: o.employeeId, name: o.name })}>{o.annualCtc ? "Revise" : "Set salary"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {componentOpen && <ComponentModal onClose={() => setComponentOpen(false)} onSaved={() => void utils.payrollSalary.componentList.invalidate()} />}
      {template && (
        <TemplateEditor
          id={template === "new" ? null : template}
          components={comps}
          existing={(templates.data ?? []).find((t) => t.id === template) ?? null}
          onClose={() => setTemplate(null)}
          onSaved={() => void utils.payrollSalary.templateList.invalidate()}
        />
      )}
      {assigning && (
        <AssignSalaryModal
          employee={assigning}
          components={comps}
          templates={templates.data ?? []}
          onClose={() => setAssigning(null)}
          onSaved={() => {
            void utils.payrollSalary.overview.invalidate();
            void utils.payrollSalary.templateList.invalidate();
          }}
        />
      )}
    </div>
  );
}

function ComponentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ComponentType>("earning");
  const [category, setCategory] = useState<ComponentCategory>("other_earning");
  const [prorate, setProrate] = useState(true);
  const [isWage, setIsWage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = trpc.payrollSalary.componentCreate.useMutation({
    onSuccess: () => {
      toast({ title: "Component added", variant: "success" });
      onSaved();
      onClose();
    },
    onError: onError("Could not add the component"),
  });
  const cats = categoriesForType(type);

  function save() {
    const parsed = salaryComponentSchema.safeParse({ code, name, type, category, prorate, isWage });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setError(null);
    create.mutate(parsed.data);
  }

  return (
    <Modal open onClose={onClose} title="Add salary component">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="CONV" />
          <InputField label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Conveyance allowance" />
          <SelectField label="Type" value={type} onChange={(e) => { const t = e.target.value as ComponentType; setType(t); setCategory(categoriesForType(t)[0]!); }}>
            {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{COMPONENT_TYPE_LABELS[t]}</option>)}
          </SelectField>
          <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value as ComponentCategory)}>
            {cats.map((c) => <option key={c} value={c}>{COMPONENT_CATEGORY_LABELS[c]}</option>)}
          </SelectField>
        </div>
        <CheckRow label="Pay in proportion to paid days" checked={prorate} onChange={setProrate} hint="Off: paid in full whenever the employee has at least one paid day (a fixed bonus, for example)." />
        {type === "earning" && <CheckRow label="Counts as wages (Basic, DA, retaining allowance)" checked={isWage} onChange={setIsWage} hint="Used by the 50% wage rule check." />}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={create.isPending}>Add</button>
        </div>
      </div>
    </Modal>
  );
}

function TemplateEditor({ id, components, existing, onClose, onSaved }: {
  id: string | null;
  components: ComponentRow[];
  existing: { name: string; description: string | null; sampleAnnualCtc: string; lines: Array<{ componentId: string; calcType: string; value: string }> } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [ctc, setCtc] = useState(existing && Number(existing.sampleAnnualCtc) > 0 ? String(Number(existing.sampleAnnualCtc)) : "600000");
  const [lines, setLines] = useState<LineDraft[]>(
    existing?.lines.map((l) => ({ componentId: l.componentId, calcType: l.calcType as CalcType, value: String(Number(l.value)) })) ??
      defaultLines(components),
  );
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => previewBreakdown(Number(ctc) || 0, lines, components), [ctc, lines, components]);

  const onDone = () => {
    toast({ title: id ? "Template saved" : "Template created", variant: "success" });
    onSaved();
    onClose();
  };
  const create = trpc.payrollSalary.templateCreate.useMutation({ onSuccess: onDone, onError: onError("Could not save the template") });
  const update = trpc.payrollSalary.templateUpdate.useMutation({ onSuccess: onDone, onError: onError("Could not save the template") });
  const saving = create.isPending || update.isPending;

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function save() {
    if (!name.trim()) return setError("Enter a name for the template.");
    if (lines.length === 0) return setError("Add at least one component.");
    if (new Set(lines.map((l) => l.componentId)).size !== lines.length) return setError("A component can only be used once.");
    if (preview.error) return setError(preview.error);
    setError(null);
    const payload = { name: name.trim(), description, sampleAnnualCtc: Number(ctc) || 0, lines: lines.map((l) => ({ componentId: l.componentId, calcType: l.calcType, value: Number(l.value) || 0 })) };
    if (id) update.mutate({ ...payload, id });
    else create.mutate(payload);
  }

  const unused = components.filter((c) => c.isActive && !lines.some((l) => l.componentId === c.id));

  return (
    <SlideOver
      open
      onClose={onClose}
      title={id ? "Edit template" : "New salary template"}
      description="Say how an annual CTC splits into monthly amounts."
      footer={<div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save template"}</button></div>}
    >
      <div className="space-y-4">
        <InputField label="Template name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Staff 25k" />
        <TextareaField label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="space-y-2">
          <p className="text-sm font-semibold text-text-primary">Components</p>
          {lines.map((l, i) => (
            <div key={l.componentId} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border-light p-2 sm:grid-cols-[1.2fr_1fr_6rem_auto]">
              <span className="self-center text-sm font-medium text-text-primary">{components.find((c) => c.id === l.componentId)?.name ?? "Component"}</span>
              <SelectField label="How it is worked out" aria-label={`How ${components.find((c) => c.id === l.componentId)?.name} is worked out`} value={l.calcType} onChange={(e) => setLine(i, { calcType: e.target.value as CalcType })}>
                {CALC_TYPES.map((c) => <option key={c} value={c}>{CALC_TYPE_LABELS[c]}</option>)}
              </SelectField>
              <InputField
                label={l.calcType === "fixed" ? "Amount" : "Percent"}
                aria-label={`Value for ${components.find((c) => c.id === l.componentId)?.name}`}
                inputMode="decimal"
                value={l.calcType === "balance" ? "" : l.value}
                disabled={l.calcType === "balance"}
                onChange={(e) => setLine(i, { value: e.target.value })}
              />
              <button type="button" className="btn-secondary btn-sm self-end" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label={`Remove ${components.find((c) => c.id === l.componentId)?.name}`}>Remove</button>
            </div>
          ))}
          {unused.length > 0 && (
            <SelectField label="Add a component" value="" onChange={(e) => e.target.value && setLines((ls) => [...ls, { componentId: e.target.value, calcType: "fixed", value: "0" }])}>
              <option value="">Choose...</option>
              {unused.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          )}
        </div>
        <div className="space-y-2 rounded-xl bg-surface-1 p-3">
          <InputField label="Preview with an annual CTC of" inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} />
          {preview.error && <p role="alert" className="text-sm text-red-600">{preview.error}</p>}
          {preview.breakdown && <BreakdownTable breakdown={preview.breakdown} />}
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </SlideOver>
  );
}

/** A sensible first template: Basic 50% of CTC, HRA 40% of Basic, the rest as special allowance. */
function defaultLines(components: ComponentRow[]): LineDraft[] {
  const by = (code: string) => components.find((c) => c.code === code);
  const out: LineDraft[] = [];
  if (by("BASIC")) out.push({ componentId: by("BASIC")!.id, calcType: "percent_of_ctc", value: "50" });
  if (by("HRA")) out.push({ componentId: by("HRA")!.id, calcType: "percent_of_basic", value: "40" });
  if (by("SPECIAL")) out.push({ componentId: by("SPECIAL")!.id, calcType: "balance", value: "0" });
  return out;
}

function AssignSalaryModal({ employee, components, templates, onClose, onSaved }: {
  employee: { id: string; name: string };
  components: ComponentRow[];
  templates: Array<{ id: string; name: string; sampleAnnualCtc: string; lines: Array<{ componentId: string; calcType: string; value: string }> }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [ctc, setCtc] = useState(() => (templates[0] && Number(templates[0].sampleAnnualCtc) > 0 ? String(Number(templates[0].sampleAnnualCtc)) : ""));
  const [from, setFrom] = useState(todayISODate().slice(0, 8) + "01");
  const tpl = templates.find((t) => t.id === templateId);
  const preview = useMemo(
    () => (tpl ? previewBreakdown(Number(ctc) || 0, tpl.lines.map((l) => ({ componentId: l.componentId, calcType: l.calcType as CalcType, value: String(Number(l.value)) })), components) : { breakdown: null, error: null }),
    [tpl, ctc, components],
  );
  const assign = trpc.payrollSalary.assign.useMutation({
    onSuccess: () => {
      toast({ title: `Salary set for ${employee.name}`, variant: "success" });
      onSaved();
      onClose();
    },
    onError: onError("Could not set the salary"),
  });
  return (
    <Modal open onClose={onClose} title={`Salary for ${employee.name}`} className="max-w-xl">
      <div className="space-y-3">
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {templates.length === 0 && <option value="">No templates yet</option>}
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Annual CTC" required inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} />
          <InputField label="Effective from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <p className="text-xs text-text-tertiary">A revision applies from the start of the month its date falls in. The month's payroll uses the latest salary effective by the end of that month.</p>
        {preview.error && <p role="alert" className="text-sm text-red-600">{preview.error}</p>}
        {preview.breakdown && <BreakdownTable breakdown={preview.breakdown} />}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={assign.isPending || !templateId || !ctc || !!preview.error}
            onClick={() => assign.mutate({ employeeId: employee.id, templateId, annualCtc: Number(ctc), effectiveFrom: from })}
          >
            {assign.isPending ? "Saving..." : "Set salary"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
