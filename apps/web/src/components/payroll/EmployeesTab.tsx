import { useEffect, useMemo, useState } from "react";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  EXIT_REASONS,
  EXIT_REASON_LABELS,
  GENDERS,
  INDIAN_STATES,
  MAX_PHOTO_DATA_URL_LENGTH,
  TAX_REGIMES,
  TAX_REGIME_LABELS,
  employeeFieldsSchema,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate, todayISODate } from "@/lib/utils";
import { SlideOver } from "@/components/ui/SlideOver";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { UnderlineTabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { Panel, TABLE, onError } from "./payroll-ui";
import { EmployeeStatutoryDialog } from "./EmployeeStatutoryDialog";
import { anyRegistration, useStatutoryRegistrations } from "./statutory-ui";

type FormState = {
  employeeCode: string; name: string; dateOfBirth: string; gender: string; fatherOrSpouseName: string; address: string; phone: string; email: string;
  photoDataUrl: string; pan: string; aadhaar: string; uan: string; esicNumber: string; dateOfJoining: string; departmentId: string; designationId: string;
  branch: string; workState: string; managerId: string; shiftId: string; employmentType: string; taxRegime: string;
  bankAccountNumber: string; bankIfsc: string; bankAccountName: string; bankName: string;
};

const EMPTY: FormState = {
  employeeCode: "", name: "", dateOfBirth: "", gender: "", fatherOrSpouseName: "", address: "", phone: "", email: "", photoDataUrl: "", pan: "", aadhaar: "", uan: "",
  esicNumber: "", dateOfJoining: "", departmentId: "", designationId: "", branch: "", workState: "", managerId: "", shiftId: "", employmentType: "permanent",
  taxRegime: "new", bankAccountNumber: "", bankIfsc: "", bankAccountName: "", bankName: "",
};

const SENSITIVE = ["pan", "aadhaar", "uan", "esicNumber", "bankAccountNumber", "bankIfsc"] as const;

const NULLABLE_IDS = ["departmentId", "designationId", "managerId", "shiftId"] as const;

export function EmployeesTab() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"active" | "exited" | "all">("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [exiting, setExiting] = useState<{ id: string; name: string } | null>(null);
  const [lists, setLists] = useState(false);
  const [statutory, setStatutory] = useState<{ id: string; name: string } | null>(null);
  const { reg } = useStatutoryRegistrations();
  const list = trpc.payrollEmployee.list.useQuery({ status, search: search || undefined, page: 1, limit: 200 });
  const capacity = trpc.payrollEmployee.capacity.useQuery();
  const rows = list.data?.data ?? [];

  const refresh = () => {
    void utils.payrollEmployee.list.invalidate();
    void utils.payrollEmployee.capacity.invalidate();
    void utils.payrollSalary.overview.invalidate();
  };
  const reactivate = trpc.payrollEmployee.reactivate.useMutation({
    onSuccess: () => {
      toast({ title: "Employee is active again", variant: "success" });
      refresh();
    },
    onError: onError("Could not reactivate the employee"),
  });

  const cap = capacity.data?.cap ?? null;
  const atCap = cap !== null && (capacity.data?.active ?? 0) >= cap;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UnderlineTabs
          label="Employees shown"
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
          tabs={[{ value: "active", label: "Active" }, { value: "exited", label: "Left" }, { value: "all", label: "All" }]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search employees"
            placeholder="Search name or code"
            className="input w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-secondary" onClick={() => setLists(true)}>Departments and designations</button>
          <button className="btn-primary" onClick={() => setEditing("new")} disabled={atCap} title={atCap ? `The Full Access Trial includes up to ${cap} employees.` : undefined}>
            + Add employee
          </button>
        </div>
      </div>

      {cap !== null && (
        <p data-testid="trial-employee-cap" className="text-xs text-text-tertiary">
          Full Access Trial: {capacity.data?.active ?? 0} of {cap} employees. Employees who have left do not count.
        </p>
      )}

      <Panel>
        {list.isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading employees...</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title={status === "exited" ? "Nobody has left" : "No employees yet"}
            description="Add the people you pay. Their salary, attendance and payslips all start from here."
            action={status !== "exited" ? <button className="btn-primary" onClick={() => setEditing("new")}>+ Add employee</button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Joined</th>
                  <th>PAN</th>
                  <th>Bank</th>
                  <th>Status</th>
                  <th className="text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap font-medium text-text-primary">{e.employeeCode}</td>
                    <td>
                      <button className="text-left font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setEditing(e.id)}>
                        {e.name}
                      </button>
                      {e.designation && <p className="text-xs text-text-tertiary">{e.designation}</p>}
                    </td>
                    <td className="text-text-secondary">{e.department ?? "-"}</td>
                    <td className="whitespace-nowrap text-text-secondary">{formatDate(e.dateOfJoining)}</td>
                    <td className="whitespace-nowrap font-mono text-xs text-text-secondary">{e.panMasked ?? "-"}</td>
                    <td className="text-xs text-text-secondary">{e.hasBankDetails ? e.bankAccountMasked : <span className="text-amber-700 dark:text-amber-400">Missing</span>}</td>
                    <td>
                      {e.status === "active" ? (
                        <Badge color="bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400">Active</Badge>
                      ) : (
                        <Badge color="bg-surface-2 text-text-secondary">Left {formatDate(e.lastWorkingDay)}</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-secondary btn-sm mr-2" onClick={() => setEditing(e.id)}>Open</button>
                      {anyRegistration(reg) && e.status === "active" && <button className="btn-secondary btn-sm mr-2" onClick={() => setStatutory({ id: e.id, name: e.name })}>Statutory</button>}
                      {e.status === "active" ? (
                        <button className="btn-secondary btn-sm" onClick={() => setExiting({ id: e.id, name: e.name })}>Exit</button>
                      ) : (
                        <button className="btn-secondary btn-sm" onClick={() => reactivate.mutate({ id: e.id })} disabled={reactivate.isPending}>Reactivate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && <EmployeeForm id={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {statutory && <EmployeeStatutoryDialog employeeId={statutory.id} name={statutory.name} onClose={() => setStatutory(null)} />}
      {exiting && <ExitDialog employee={exiting} onClose={() => setExiting(null)} onDone={refresh} />}
      {lists && <ListsDialog onClose={() => setLists(false)} />}
    </div>
  );
}

function EmployeeForm({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const detail = trpc.payrollEmployee.get.useQuery({ id: id ?? "" }, { enabled: !!id });
  const departments = trpc.payrollEmployee.departmentList.useQuery();
  const designations = trpc.payrollEmployee.designationList.useQuery();
  const shifts = trpc.payrollEmployee.shiftList.useQuery();
  const managers = trpc.payrollEmployee.list.useQuery({ status: "active", page: 1, limit: 200 });
  const { reg } = useStatutoryRegistrations();
  const [v, setV] = useState<FormState>({ ...EMPTY, dateOfJoining: todayISODate() });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [loaded, setLoaded] = useState(!id);

  // The server returns the identity and bank numbers only to an owner or admin; others see the masked form.
  const sensitiveIncluded = !id || detail.data?.sensitiveIncluded === true;
  const masked: Record<string, string | null | undefined> = detail.data
    ? { pan: detail.data.panMasked, aadhaar: detail.data.aadhaarMasked, uan: detail.data.uanMasked, esicNumber: detail.data.esicMasked, bankAccountNumber: detail.data.bankAccountMasked, bankIfsc: null }
    : {};

  useEffect(() => {
    const d = detail.data;
    if (!d || loaded) return;
    setV({
      employeeCode: d.employeeCode, name: d.name, dateOfBirth: d.dateOfBirth ?? "", gender: d.gender ?? "", fatherOrSpouseName: d.fatherOrSpouseName ?? "", address: d.address ?? "",
      phone: d.phone ?? "", email: d.email ?? "", photoDataUrl: d.photoDataUrl ?? "", pan: d.pan ?? "", aadhaar: d.aadhaar ?? "", uan: d.uan ?? "", esicNumber: d.esicNumber ?? "",
      dateOfJoining: d.dateOfJoining, departmentId: d.departmentId ?? "", designationId: d.designationId ?? "", branch: d.branch ?? "", workState: d.workState ?? "",
      managerId: d.managerId ?? "", shiftId: d.shiftId ?? "", employmentType: d.employmentType, taxRegime: d.taxRegime, bankAccountNumber: d.bankAccountNumber ?? "",
      bankIfsc: d.bankIfsc ?? "", bankAccountName: d.bankAccountName ?? "", bankName: d.bankName ?? "",
    });
    setLoaded(true);
  }, [detail.data, loaded]);

  const create = trpc.payrollEmployee.create.useMutation();
  const update = trpc.payrollEmployee.update.useMutation();
  const saving = create.isPending || update.isPending;

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const managerOptions = useMemo(() => (managers.data?.data ?? []).filter((m) => m.id !== id), [managers.data, id]);

  function payload() {
    const out: Record<string, unknown> = { ...v };
    for (const k of NULLABLE_IDS) out[k] = v[k] || null;
    // A role that cannot see the numbers keeps what is stored unless a new value is typed.
    if (!sensitiveIncluded) for (const k of SENSITIVE) if (!v[k]) delete out[k];
    return out;
  }

  function onPhoto(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setErrors((s) => ({ ...s, photoDataUrl: "Use a PNG, JPEG or WebP image." }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (url.length > MAX_PHOTO_DATA_URL_LENGTH) {
        setErrors((s) => ({ ...s, photoDataUrl: "The photo is too large. Use one under 150 KB." }));
        return;
      }
      setErrors((s) => ({ ...s, photoDataUrl: undefined }));
      setV((s) => ({ ...s, photoDataUrl: url }));
    };
    reader.readAsDataURL(file);
  }

  function save() {
    const data = payload();
    const parsed = employeeFieldsSchema.safeParse(data);
    if (!parsed.success) {
      const next: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]) as keyof FormState;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const done = () => {
      toast({ title: id ? "Employee saved" : "Employee added", variant: "success" });
      onSaved();
      onClose();
    };
    if (id) update.mutate({ ...parsed.data, id } as never, { onSuccess: done, onError: onError("Could not save the employee") });
    else create.mutate(parsed.data as never, { onSuccess: done, onError: onError("Could not add the employee") });
  }

  const sensitiveField = (key: (typeof SENSITIVE)[number], label: string, extra?: { inputMode?: "numeric" | "text"; maxLength?: number }) => (
    <InputField
      label={label}
      value={v[key]}
      onChange={set(key)}
      error={errors[key]}
      autoComplete="off"
      placeholder={!sensitiveIncluded && masked[key] ? `Current: ${masked[key]}` : undefined}
      {...extra}
    />
  );

  return (
    <SlideOver
      open
      onClose={onClose}
      title={id ? "Employee" : "Add employee"}
      description={id && !sensitiveIncluded ? "Identity and bank numbers are hidden. Only an owner or admin sees them in full; type a new number to replace one." : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || (!!id && !loaded)}>{saving ? "Saving..." : "Save"}</button>
        </div>
      }
    >
      {id && !loaded ? (
        <p className="text-sm text-text-tertiary">Loading...</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-6" noValidate>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text-primary">Personal details</legend>
            <InputField label="Employee code" required value={v.employeeCode} onChange={set("employeeCode")} error={errors.employeeCode} />
            <InputField label="Full name" required value={v.name} onChange={set("name")} error={errors.name} />
            <InputField label="Date of birth" type="date" value={v.dateOfBirth} onChange={set("dateOfBirth")} error={errors.dateOfBirth} />
            <SelectField label="Gender" value={v.gender} onChange={set("gender")}>
              <option value="">Not stated</option>
              {GENDERS.map((g) => <option key={g} value={g}>{g[0]!.toUpperCase() + g.slice(1)}</option>)}
            </SelectField>
            <InputField label="Father's or spouse's name" value={v.fatherOrSpouseName} onChange={set("fatherOrSpouseName")} />
            <InputField label="Mobile number" inputMode="tel" value={v.phone} onChange={set("phone")} error={errors.phone} />
            <InputField label="Email" type="email" value={v.email} onChange={set("email")} error={errors.email} className="sm:col-span-2" />
            <TextareaField label="Address" rows={2} value={v.address} onChange={set("address")} className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <label className="label" htmlFor="employee-photo">Photo</label>
              <div className="flex items-center gap-3">
                {v.photoDataUrl ? <img src={v.photoDataUrl} alt="Employee photo" className="h-14 w-14 rounded-full object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-xs text-text-tertiary">None</span>}
                <input id="employee-photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onPhoto(e.target.files?.[0])} />
                {v.photoDataUrl && <button type="button" className="btn-secondary btn-sm" onClick={() => setV((s) => ({ ...s, photoDataUrl: "" }))}>Remove</button>}
              </div>
              {errors.photoDataUrl && <p role="alert" className="mt-1 text-xs text-red-600">{errors.photoDataUrl}</p>}
            </div>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text-primary">Statutory IDs</legend>
            {sensitiveField("pan", "PAN", { maxLength: 10 })}
            {sensitiveField("aadhaar", "Aadhaar number", { inputMode: "numeric", maxLength: 14 })}
            {reg.pf && sensitiveField("uan", "UAN (for PF)", { inputMode: "numeric", maxLength: 14 })}
            {reg.esi && sensitiveField("esicNumber", "ESIC IP number", { inputMode: "numeric", maxLength: 20 })}
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text-primary">Job</legend>
            <InputField label="Date of joining" type="date" required value={v.dateOfJoining} onChange={set("dateOfJoining")} error={errors.dateOfJoining} />
            <SelectField label="Employment type" value={v.employmentType} onChange={set("employmentType")}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
            </SelectField>
            <SelectField label="Department" value={v.departmentId} onChange={set("departmentId")}>
              <option value="">None</option>
              {(departments.data ?? []).filter((d) => d.isActive || d.id === v.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <SelectField label="Designation" value={v.designationId} onChange={set("designationId")}>
              <option value="">None</option>
              {(designations.data ?? []).filter((d) => d.isActive || d.id === v.designationId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <InputField label="Branch or location" value={v.branch} onChange={set("branch")} />
            <SelectField label="State of work" value={v.workState} onChange={set("workState")} error={errors.workState}>
              <option value="">Not set</option>
              {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </SelectField>
            <SelectField label="Manager" value={v.managerId} onChange={set("managerId")}>
              <option value="">None</option>
              {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.employeeCode})</option>)}
            </SelectField>
            <SelectField label="Shift" value={v.shiftId} onChange={set("shiftId")}>
              <option value="">Business default</option>
              {(shifts.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <SelectField label="Tax regime" value={v.taxRegime} onChange={set("taxRegime")}>
              {TAX_REGIMES.map((t) => <option key={t} value={t}>{TAX_REGIME_LABELS[t]}</option>)}
            </SelectField>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text-primary">Bank account for salary</legend>
            {sensitiveField("bankAccountNumber", "Account number", { inputMode: "numeric", maxLength: 22 })}
            {sensitiveField("bankIfsc", "IFSC", { maxLength: 11 })}
            <InputField label="Name as per bank" value={v.bankAccountName} onChange={set("bankAccountName")} />
            <InputField label="Bank name" value={v.bankName} onChange={set("bankName")} />
          </fieldset>

          {id && detail.data?.status === "exited" && (
            <p className="rounded-lg bg-surface-1 p-3 text-sm text-text-secondary">
              Left on {formatDate(detail.data.lastWorkingDay)}
              {detail.data.exitReason ? ` (${EXIT_REASON_LABELS[detail.data.exitReason as keyof typeof EXIT_REASON_LABELS] ?? detail.data.exitReason})` : ""}.
              {detail.data.fnfPayrollRunId ? " The final month was settled in a payroll run." : " The final month is settled in the next payroll run for the month they left."}
              {detail.data.fnfNote ? ` Full and final note: ${detail.data.fnfNote}` : ""}
            </p>
          )}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1}>Submit</button>
        </form>
      )}
    </SlideOver>
  );
}

function ExitDialog({ employee, onClose, onDone }: { employee: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [lastWorkingDay, setLast] = useState(todayISODate());
  const [reason, setReason] = useState<(typeof EXIT_REASONS)[number]>("resignation");
  const [note, setNote] = useState("");
  const [fnfNote, setFnf] = useState("");
  const exit = trpc.payrollEmployee.exit.useMutation({
    onSuccess: () => {
      toast({ title: `${employee.name} has been marked as left`, variant: "success" });
      onDone();
      onClose();
    },
    onError: onError("Could not record the exit"),
  });
  return (
    <Modal open onClose={onClose} title={`${employee.name} is leaving`}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Payroll pays up to the last working day. The run for that month is linked to the employee as their full and final settlement.
        </p>
        <InputField label="Last working day" type="date" required value={lastWorkingDay} onChange={(e) => setLast(e.target.value)} />
        <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          {EXIT_REASONS.map((r) => <option key={r} value={r}>{EXIT_REASON_LABELS[r]}</option>)}
        </SelectField>
        <TextareaField label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <TextareaField label="Full and final settlement note" rows={2} value={fnfNote} onChange={(e) => setFnf(e.target.value)} placeholder="Notice period recovery, leave encashment, dues..." />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={exit.isPending || !lastWorkingDay}
            onClick={() => exit.mutate({ id: employee.id, lastWorkingDay, reason, note, fnfNote })}
          >
            {exit.isPending ? "Saving..." : "Mark as left"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Departments and designations: add one, hide or show one (a hidden one stays on employees who have it). */
function ListsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Departments and designations" className="max-w-2xl">
      <div className="grid gap-5 sm:grid-cols-2">
        <NameList kind="department" title="Departments" />
        <NameList kind="designation" title="Designations" />
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-secondary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function NameList({ kind, title }: { kind: "department" | "designation"; title: string }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const dept = trpc.payrollEmployee.departmentList.useQuery(undefined, { enabled: kind === "department" });
  const desig = trpc.payrollEmployee.designationList.useQuery(undefined, { enabled: kind === "designation" });
  const rows = (kind === "department" ? dept.data : desig.data) ?? [];
  const refresh = () => {
    void utils.payrollEmployee.departmentList.invalidate();
    void utils.payrollEmployee.designationList.invalidate();
  };
  const createDept = trpc.payrollEmployee.departmentCreate.useMutation({ onSuccess: () => { setName(""); refresh(); }, onError: onError("Could not add the department") });
  const createDesig = trpc.payrollEmployee.designationCreate.useMutation({ onSuccess: () => { setName(""); refresh(); }, onError: onError("Could not add the designation") });
  const updateDept = trpc.payrollEmployee.departmentUpdate.useMutation({ onSuccess: refresh, onError: onError("Could not change the department") });
  const updateDesig = trpc.payrollEmployee.designationUpdate.useMutation({ onSuccess: refresh, onError: onError("Could not change the designation") });
  const add = () => {
    if (!name.trim()) return;
    if (kind === "department") createDept.mutate({ name: name.trim() });
    else createDesig.mutate({ name: name.trim() });
  };
  const toggle = (r: { id: string; name: string; isActive: boolean }) => {
    const patch = { id: r.id, name: r.name, isActive: !r.isActive };
    if (kind === "department") updateDept.mutate(patch);
    else updateDesig.mutate(patch);
  };
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-sm font-semibold text-text-primary">{title}</h3>
      <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto text-sm">
        {rows.length === 0 && <li className="text-text-tertiary">None yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-1 px-3 py-1.5">
            <span className={r.isActive ? "text-text-primary" : "text-text-tertiary line-through"}>
              {r.name} <span className="text-xs text-text-tertiary">({r.employeeCount})</span>
            </span>
            <button type="button" className="text-xs text-brand-700 hover:underline dark:text-brand-300" onClick={() => toggle(r)}>
              {r.isActive ? "Hide" : "Show"}
            </button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input flex-1" aria-label={`New ${kind} name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "department" ? "Operations" : "Executive"} />
        <button type="submit" className="btn-primary btn-sm" disabled={!name.trim()}>Add</button>
      </form>
    </section>
  );
}
