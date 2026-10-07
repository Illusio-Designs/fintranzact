import type { EndpointDef, EndpointGroup, EndpointParam } from "./types";
import { API_BASE_URL } from "./api-base";

const UUID = "5d3c0d5e-3f0e-4b43-9d7c-0f3a8f7d9a11";
const id = (name: string, description: string): EndpointParam => ({ name, type: "string (UUID)", required: true, description });
const str = (name: string, description: string, required = true): EndpointParam => ({ name, type: "string", required, description });
const num = (name: string, description: string, required = true): EndpointParam => ({ name, type: "number", required, description });
const bool = (name: string, description: string, required = false): EndpointParam => ({ name, type: "boolean", required, description });
const date = (name: string, description: string, required = true): EndpointParam => ({ name, type: "string (YYYY-MM-DD)", required, description });
const month = (name = "month"): EndpointParam => ({ name, type: "string (YYYY-MM)", required: true, description: "A payroll month, for example `2026-08`" });

type Role = "viewer" | "member" | "admin";

/** One Payroll endpoint. The examples are generated, so every procedure is documented the same way. */
function ep(spec: {
  slug: string;
  path: string;
  method: "query" | "mutation";
  title: string;
  description: string;
  role?: Role;
  input?: EndpointParam[];
  output: string;
  example: unknown;
  sample?: Record<string, unknown>;
  gotchas?: string[];
  related?: string[];
}): EndpointDef {
  const input = spec.sample ?? {};
  const hasInput = (spec.input ?? []).length > 0;
  const body = JSON.stringify({ json: input });
  return {
    id: `payroll-${spec.slug}`,
    method: spec.method,
    path: spec.path,
    title: spec.title,
    description: spec.description,
    auth: "business",
    requiredRole: spec.role ?? (spec.method === "query" ? "viewer" : "member"),
    input: spec.input ?? [],
    output: { description: spec.output, example: spec.example },
    codeExamples: {
      curl:
        spec.method === "query"
          ? `curl "${API_BASE_URL}/api/trpc/${spec.path}${hasInput ? `?input=${encodeURIComponent(body)}` : ""}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`
          : `curl -X POST "${API_BASE_URL}/api/trpc/${spec.path}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`,
      javascript: `const result = await trpc.${spec.path}.${spec.method === "query" ? "query" : "mutate"}(${hasInput ? JSON.stringify(input) : ""});`,
    },
    gotchas: spec.gotchas,
    relatedEndpoints: spec.related?.map((r) => `payroll-${r}`),
  };
}

const ADDON = "Needs the Payroll add-on (a Full Access Trial, or an add-on subscription).";
const PERM_READ = `Requires \`Payroll:read\`. ${ADDON}`;
const PERM_UPDATE = `Requires \`Payroll:update\` (owner, admin, accountant). ${ADDON} Refused while the organization is read-only.`;
const PERM_CREATE = `Requires \`Payroll:create\` (owner, admin, accountant). ${ADDON} Refused while the organization is read-only.`;

const EMPLOYEE_LIST_ITEM = {
  id: UUID, employeeCode: "E001", name: "Asha Verma", department: "Operations", designation: "Executive", branch: "Mumbai", employmentType: "permanent",
  status: "active", dateOfJoining: "2026-04-01", lastWorkingDay: null, phone: "9876543210", email: "asha@example.in", panMasked: "XXXXXX234F", uanMasked: "XXXXXXXX0400",
  bankAccountMasked: "XXXXXXXXXX6789", hasBankDetails: true,
};

const RUN = {
  id: UUID, month: "2026-08", status: "calculated", daysInMonth: 31, employeeCount: 3, grossTotal: "88224.30", deductionsTotal: "1000.00", employerTotal: "0.00",
  netTotal: "87224.30", warnings: [], accrualJournalEntryId: null, paymentJournalEntryId: null,
};

export const payrollEndpoints: EndpointGroup = {
  id: "payroll",
  title: "Payroll (add-on)",
  description:
    "Employees, attendance and leave, salary structures, monthly payroll runs, payslips, a bank payment file, and statutory payroll (PF, EPS, VPF, ESI, professional tax, LWF, TDS on salary, dues, files and registers). Payroll is a paid add-on: every procedure below needs the `payroll` add-on (a Full Access Trial includes it with a cap of 10 active employees; a platform admin can also grant it) AND the `Payroll` permission (owner and admin: everything; accountant: read, create and update but not approve, delete or see full identity numbers; every other role: nothing). Without the add-on a call fails with FORBIDDEN and `error.data.entitlement = { reason: \"addon_required\", addon: \"payroll\" }`. A read-only organization keeps reading its payroll data; all writes are refused. Phase 1 has no statutory deductions: PF, ESI, professional tax and income-tax TDS are not calculated (enter them as manual deductions). **Money** is rupee strings with two decimals; dates are `YYYY-MM-DD`, payroll months `YYYY-MM`. **Identity data** (PAN, Aadhaar, UAN, ESIC number, bank account and IFSC) is masked in every list and in audit entries; only `payrollEmployee.get` returns it in full, and only to a role with `Payroll:manage` (owner, admin). **Run status machine:** `draft` -> `attendance_locked` -> `calculated` -> `pending_approval` -> `approved` -> `posted` -> `paid`. Before approval a run can be reopened to `draft`; an approved run is final (lines, payslips and the month's attendance never change). **Maker-checker:** the person who last calculated a run cannot approve it, unless the business has a single user. **Calculation:** monthly pay = annual CTC / 12 per the template; each earning is prorated by paid days / days in the month and rounded half-up to the paisa once; paid days = employed days - loss-of-pay days (weekly offs and holidays are paid; absence and unpaid leave are LOP). Posting an approved run writes one balanced journal entry (salary expense by group, Dr; salaries payable, payroll deductions payable and employer contributions payable, Cr); marking it paid writes a second (Dr Salaries Payable, Cr cash or bank) and a withdrawal on the account. Both are idempotent and respect period locks. Every mutation writes an audit entry (`payroll.*`) that carries ids and field names, never identity numbers.",
  endpoints: [
    // ── Employees ─────────────────────────────────────────────────────────────
    ep({
      slug: "employee-list", path: "payrollEmployee.list", method: "query", title: "List Employees",
      description: "Employees of the business, by employee code. Identity and bank numbers are masked.",
      input: [
        { name: "status", type: "enum", required: false, description: "`active` (default), `exited` or `all`", enumValues: ["active", "exited", "all"], default: "active" },
        str("search", "Part of a name or code", false),
        { name: "departmentId", type: "string (UUID)", required: false, description: "Only this department" },
        num("page", "Default 1", false),
        num("limit", "Default 50, at most 200", false),
      ],
      output: "`data` rows (masked), the `total` and the page.",
      example: { data: [EMPLOYEE_LIST_ITEM], total: 1, page: 1, limit: 50 },
      sample: { status: "active", page: 1, limit: 50 },
      gotchas: [PERM_READ, "Never contains a full PAN, Aadhaar, UAN, ESIC or bank account number."],
      related: ["employee-get"],
    }),
    ep({
      slug: "employee-get", path: "payrollEmployee.get", method: "query", title: "Get Employee",
      description: "One employee with every field. The identity and bank numbers (`pan`, `aadhaar`, `uan`, `esicNumber`, `bankAccountNumber`, `bankIfsc`) are returned in full only to a role with `Payroll:manage` (`sensitiveIncluded: true`); anyone else gets `null` for them and the masked forms in `panMasked`, `aadhaarMasked`, `uanMasked`, `esicMasked` and `bankAccountMasked`.",
      input: [id("id", "The employee")],
      output: "The employee.",
      example: { ...EMPLOYEE_LIST_ITEM, pan: "ABCDE1234F", aadhaar: "234567890123", bankAccountNumber: "50100123456789", bankIfsc: "HDFC0001234", sensitiveIncluded: true, taxRegime: "new", workState: "27" },
      sample: { id: UUID },
      gotchas: [PERM_READ, "NOT_FOUND for an id from another business."],
      related: ["employee-update"],
    }),
    ep({
      slug: "employee-capacity", path: "payrollEmployee.capacity", method: "query", title: "Employee Cap",
      description: "How many active employees the organization has and the cap, which applies only during the Full Access Trial (`trial.caps.payrollEmployees`, default 10). `cap` is `null` outside a trial.",
      output: "`active` employees across the organization's businesses and the `cap`.",
      example: { active: 4, cap: 10 },
      gotchas: [PERM_READ],
    }),
    ep({
      slug: "employee-create", path: "payrollEmployee.create", method: "mutation", title: "Create Employee",
      description: "Add an employee. Formats are checked: PAN `AAAAA9999A`, IFSC `AAAA0XXXXXX`, Aadhaar and UAN 12 digits, ESIC 10-17 digits, bank account 9-18 digits, Indian mobile. Spaces and dashes inside numbers are removed and letters upper-cased. Audit entry `payroll.employee.create`.",
      role: "member",
      input: [
        str("employeeCode", "Unique per business"), str("name", "Full name"), date("dateOfJoining", "Joining date"),
        str("dateOfBirth", "YYYY-MM-DD", false), str("gender", "male, female or other", false), str("fatherOrSpouseName", "", false), str("address", "", false),
        str("phone", "Indian mobile", false), str("email", "", false), str("photoDataUrl", "PNG, JPEG or WebP data URL, at most about 150 KB", false),
        str("pan", "AAAAA9999A", false), str("aadhaar", "12 digits", false), str("uan", "12 digits", false), str("esicNumber", "10-17 digits", false),
        { name: "departmentId", type: "string (UUID)", required: false, description: "A department of this business" },
        { name: "designationId", type: "string (UUID)", required: false, description: "A designation of this business" },
        str("branch", "Branch or location", false), str("workState", "State code (decides which state holidays apply)", false),
        { name: "managerId", type: "string (UUID)", required: false, description: "Another employee" },
        { name: "shiftId", type: "string (UUID)", required: false, description: "A shift (otherwise the business default weekly offs apply)" },
        { name: "employmentType", type: "enum", required: false, description: "Default permanent", enumValues: ["permanent", "contract", "intern"] },
        { name: "taxRegime", type: "enum", required: false, description: "A record of the choice (TDS is not calculated yet)", enumValues: ["new", "old"], default: "new" },
        str("bankAccountNumber", "9-18 digits", false), str("bankIfsc", "", false), str("bankAccountName", "Name as per bank", false), str("bankName", "", false),
      ],
      output: "The employee, as `payrollEmployee.get` returns it.",
      example: { ...EMPLOYEE_LIST_ITEM, sensitiveIncluded: false },
      sample: { employeeCode: "E001", name: "Asha Verma", dateOfJoining: "2026-04-01", pan: "ABCDE1234F", bankAccountNumber: "50100123456789", bankIfsc: "HDFC0001234" },
      gotchas: [PERM_CREATE, "During the Full Access Trial a call that would make an 11th active employee fails with FORBIDDEN and `entitlement.reason: \"plan_limit\"`.", "CONFLICT when the employee code is already used."],
    }),
    ep({
      slug: "employee-update", path: "payrollEmployee.update", method: "mutation", title: "Update Employee",
      description: "Change any employee field (send only what changes, with the `id`). A blank optional field clears it. Changing an employee never changes an approved payslip. Audit entry `payroll.employee.update` lists the NAMES of the changed fields.",
      input: [id("id", "The employee"), str("name", "Any field of `payrollEmployee.create`", false)],
      output: "`employee` (as `get`) and the changed `fields`.",
      example: { employee: EMPLOYEE_LIST_ITEM, fields: ["name"] },
      sample: { id: UUID, name: "Asha V. Verma" },
      gotchas: [PERM_UPDATE, "An employee cannot be their own manager."],
    }),
    ep({
      slug: "employee-exit", path: "payrollEmployee.exit", method: "mutation", title: "Employee Exit",
      description: "Record that an employee has left: last working day, reason and a full-and-final note. Payroll pays up to the last working day; the run that settles that month is linked to the employee (`fnfPayrollRunId`) when it is approved. Audit entry `payroll.employee.exit`.",
      input: [id("id", "The employee"), date("lastWorkingDay", "Not before the joining date"), { name: "reason", type: "enum", required: true, description: "Why", enumValues: ["resignation", "termination", "retirement", "end_of_contract", "absconded", "other"] }, str("note", "", false), str("fnfNote", "Full and final settlement note", false)],
      output: "The employee with `status: \"exited\"`.",
      example: { ...EMPLOYEE_LIST_ITEM, status: "exited", lastWorkingDay: "2026-08-20" },
      sample: { id: UUID, lastWorkingDay: "2026-08-20", reason: "resignation" },
      gotchas: [PERM_UPDATE],
    }),
    ep({
      slug: "employee-reactivate", path: "payrollEmployee.reactivate", method: "mutation", title: "Reactivate Employee",
      description: "Bring a former employee back (counts toward the trial cap again).",
      input: [id("id", "The employee")],
      output: "The employee, active.",
      example: EMPLOYEE_LIST_ITEM,
      sample: { id: UUID },
      gotchas: [PERM_UPDATE],
    }),
    ep({ slug: "department-list", path: "payrollEmployee.departmentList", method: "query", title: "List Departments", description: "Departments with the number of active employees in each.", output: "Rows.", example: [{ id: UUID, name: "Operations", isActive: true, employeeCount: 3 }], gotchas: [PERM_READ] }),
    ep({ slug: "department-create", path: "payrollEmployee.departmentCreate", method: "mutation", title: "Create Department", description: "Add a department.", input: [str("name", "Unique per business")], output: "The department.", example: { id: UUID, name: "Operations", isActive: true }, sample: { name: "Operations" }, gotchas: [PERM_CREATE, "CONFLICT for a name already used."] }),
    ep({ slug: "department-update", path: "payrollEmployee.departmentUpdate", method: "mutation", title: "Update Department", description: "Rename a department or hide it (`isActive: false`; employees who have it keep it).", input: [id("id", "The department"), str("name", "New name"), bool("isActive", "Hide or show")], output: "The department.", example: { id: UUID, name: "Operations", isActive: true }, sample: { id: UUID, name: "Operations" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "designation-list", path: "payrollEmployee.designationList", method: "query", title: "List Designations", description: "Designations with the number of active employees in each.", output: "Rows.", example: [{ id: UUID, name: "Executive", isActive: true, employeeCount: 3 }], gotchas: [PERM_READ] }),
    ep({ slug: "designation-create", path: "payrollEmployee.designationCreate", method: "mutation", title: "Create Designation", description: "Add a designation.", input: [str("name", "Unique per business")], output: "The designation.", example: { id: UUID, name: "Executive", isActive: true }, sample: { name: "Executive" }, gotchas: [PERM_CREATE] }),
    ep({ slug: "designation-update", path: "payrollEmployee.designationUpdate", method: "mutation", title: "Update Designation", description: "Rename or hide a designation.", input: [id("id", "The designation"), str("name", "New name"), bool("isActive", "Hide or show")], output: "The designation.", example: { id: UUID, name: "Executive", isActive: true }, sample: { id: UUID, name: "Executive" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "shift-list", path: "payrollEmployee.shiftList", method: "query", title: "List Shifts", description: "Working patterns: hours and weekly offs.", output: "Rows.", example: [{ id: UUID, name: "General", startTime: "09:00", endTime: "18:00", weeklyOffDays: [0], standardHours: "8.00", isActive: true }], gotchas: [PERM_READ] }),
    ep({ slug: "shift-create", path: "payrollEmployee.shiftCreate", method: "mutation", title: "Create Shift", description: "Add a shift. `weeklyOffDays` are weekday numbers, 0 = Sunday.", input: [str("name", ""), str("startTime", "24-hour HH:MM"), str("endTime", "24-hour HH:MM"), { name: "weeklyOffDays", type: "integer[] 0-6", required: false, description: "Default `[0]`" }, num("standardHours", "Default 8", false)], output: "The shift.", example: { id: UUID, name: "General", startTime: "09:00", endTime: "18:00", weeklyOffDays: [0] }, sample: { name: "General", startTime: "09:00", endTime: "18:00", weeklyOffDays: [0] }, gotchas: [PERM_CREATE] }),
    ep({ slug: "shift-update", path: "payrollEmployee.shiftUpdate", method: "mutation", title: "Update Shift", description: "Change a shift (send every field of `shiftCreate` and the `id`), or hide it with `isActive: false`.", input: [id("id", "The shift"), str("name", ""), str("startTime", "HH:MM"), str("endTime", "HH:MM"), bool("isActive", "")], output: "The shift.", example: { id: UUID, name: "General" }, sample: { id: UUID, name: "General", startTime: "09:00", endTime: "18:00", weeklyOffDays: [0] }, gotchas: [PERM_UPDATE] }),

    // ── Salary ────────────────────────────────────────────────────────────────
    ep({ slug: "component-list", path: "payrollSalary.componentList", method: "query", title: "List Salary Components", description: "Components: earnings, deductions and employer contributions. `statutoryKind` is reserved for the statutory phase and is `null` for every Phase 1 component.", output: "Rows.", example: [{ id: UUID, code: "BASIC", name: "Basic", type: "earning", category: "basic", prorate: true, isWage: true, statutoryKind: null, isActive: true }], gotchas: [PERM_READ] }),
    ep({
      slug: "component-create", path: "payrollSalary.componentCreate", method: "mutation", title: "Create Salary Component",
      description: "Add a component. `type` is `earning`, `deduction` or `employer_contribution`; the `category` must belong to the type (earnings: basic, da, retaining_allowance, hra, conveyance, special_allowance, bonus, incentive, overtime, other_earning; deductions: manual_deduction, advance_recovery, other_deduction; employer: other_employer). `statutoryKind` must be left out in Phase 1.",
      input: [str("code", "Unique per business, upper-cased"), str("name", ""), { name: "type", type: "enum", required: true, description: "Component type", enumValues: ["earning", "deduction", "employer_contribution"] }, str("category", "See above"), bool("prorate", "Pay by paid days (default true); false pays in full when there is at least one paid day"), bool("isWage", "Counts toward wages for the 50% rule")],
      output: "The component.", example: { id: UUID, code: "CONV", name: "Conveyance", type: "earning", category: "conveyance", prorate: true, isWage: false },
      sample: { code: "CONV", name: "Conveyance", type: "earning", category: "conveyance" },
      gotchas: [PERM_CREATE, "A `statutoryKind` is refused (BAD_REQUEST): PF, ESI, PT and TDS are not part of Phase 1."],
    }),
    ep({ slug: "component-update", path: "payrollSalary.componentUpdate", method: "mutation", title: "Update Salary Component", description: "Rename, switch proration or wage, retire (`isActive: false`) or reorder a component. Its type and category do not change.", input: [id("id", "The component"), str("name", "", false), bool("prorate", ""), bool("isWage", ""), bool("isActive", "")], output: "The component.", example: { id: UUID, code: "CONV" }, sample: { id: UUID, name: "Travel allowance" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "component-seed", path: "payrollSalary.componentSeedDefaults", method: "mutation", title: "Add Standard Components", description: "Add the standard set that is missing: Basic, DA, retaining allowance, HRA, conveyance, special allowance, bonus, incentive, advance recovery and other deduction. Safe to repeat.", output: "How many were added.", example: { added: 10 }, gotchas: [PERM_CREATE] }),
    ep({ slug: "template-list", path: "payrollSalary.templateList", method: "query", title: "List Salary Templates", description: "Templates with their lines and the number of employees assigned.", output: "Rows.", example: [{ id: UUID, name: "Staff 50k", sampleAnnualCtc: "600000.00", employeeCount: 2, lines: [{ componentId: UUID, code: "BASIC", name: "Basic", calcType: "percent_of_ctc", value: "50.00" }] }], gotchas: [PERM_READ] }),
    ep({
      slug: "template-create", path: "payrollSalary.templateCreate", method: "mutation", title: "Create Salary Template",
      description: "A template says how an annual CTC splits into monthly amounts. Each line has a `calcType`: `fixed` (a monthly amount in rupees), `percent_of_ctc` (of the monthly CTC), `percent_of_basic`, or `balance` (what is left of the monthly CTC after every other earning and employer contribution; at most one, an earning). The structure is checked when saved.",
      input: [str("name", "Unique per business"), str("description", "", false), num("sampleAnnualCtc", "Annual CTC the template is previewed with", false), { name: "lines", type: "object[]", required: true, description: "`{ componentId, calcType, value }`" }],
      output: "The template.", example: { id: UUID, name: "Staff 50k" },
      sample: { name: "Staff 50k", sampleAnnualCtc: 600000, lines: [{ componentId: "BASIC_ID", calcType: "percent_of_ctc", value: 50 }, { componentId: "SPECIAL_ID", calcType: "balance", value: 0 }] },
      gotchas: [PERM_CREATE, "BAD_REQUEST with the reason when the lines cannot work (for example the other components exceed the monthly CTC)."],
    }),
    ep({ slug: "template-update", path: "payrollSalary.templateUpdate", method: "mutation", title: "Update Salary Template", description: "Replace a template's name and lines. Employees already assigned keep the monthly breakdown they were given.", input: [id("id", "The template"), str("name", ""), { name: "lines", type: "object[]", required: true, description: "As `templateCreate`" }], output: "The template.", example: { id: UUID, name: "Staff 50k" }, sample: { id: UUID, name: "Staff 50k", lines: [{ componentId: "BASIC_ID", calcType: "percent_of_ctc", value: 60 }] }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "template-delete", path: "payrollSalary.templateDelete", method: "mutation", title: "Delete Salary Template", description: "Delete a template. Employees keep their salary: assignments are snapshots.", role: "admin", input: [id("id", "The template")], output: "The id.", example: { id: UUID }, sample: { id: UUID }, gotchas: [`Requires \`Payroll:delete\` (owner and admin). ${ADDON}`] }),
    ep({
      slug: "salary-preview", path: "payrollSalary.preview", method: "query", title: "Preview CTC to Monthly",
      description: "Work out the monthly amounts for an annual CTC and a list of template lines. Nothing is saved. `warnings` carries the Labour Codes 50% wage rule check (wages = Basic + DA + retaining allowance, at least half of the total remuneration) as a WARNING, never an error, and a note when part of the CTC is not given to any component.",
      input: [num("annualCtc", "Rupees"), { name: "lines", type: "object[]", required: true, description: "`{ componentId, calcType, value }`" }],
      output: "Monthly CTC, gross, wages and the percentage of remuneration they are, each line's monthly amount and the warnings.",
      example: { annualCtc: "600000.00", monthlyCtc: "50000.00", gross: "50000.00", wages: "25000.00", wagePercent: 50, unallocated: "0.00", warnings: [], lines: [{ code: "BASIC", name: "Basic", monthly: "25000.00" }] },
      sample: { annualCtc: 600000, lines: [{ componentId: "BASIC_ID", calcType: "percent_of_ctc", value: 50 }] },
      gotchas: [PERM_READ],
    }),
    ep({
      slug: "salary-assign", path: "payrollSalary.assign", method: "mutation", title: "Assign Salary",
      description: "Give an employee a salary: a template, an annual CTC and the date it takes effect. The monthly breakdown is stored with the assignment. A payroll run uses the latest assignment effective by the last day of the month, so a revision applies from the start of the month its date falls in. Optional `overrides` (`{ [componentId]: { calcType, value } }`) change a template line for this employee only.",
      input: [id("employeeId", "The employee"), id("templateId", "The template"), num("annualCtc", "Rupees"), date("effectiveFrom", "Effective date")],
      output: "The assignment, the monthly breakdown and the employee code.",
      example: { assignment: { id: UUID, annualCtc: "600000.00", monthlyCtc: "50000.00", effectiveFrom: "2026-04-01" }, breakdown: { gross: "50000.00" }, employeeCode: "E001" },
      sample: { employeeId: UUID, templateId: UUID, annualCtc: 600000, effectiveFrom: "2026-04-01" },
      gotchas: [PERM_UPDATE],
    }),
    ep({ slug: "salary-assignments", path: "payrollSalary.assignments", method: "query", title: "Salary History", description: "An employee's salary assignments, newest first, each with its stored monthly breakdown.", input: [id("employeeId", "The employee")], output: "Rows.", example: [{ id: UUID, annualCtc: "600000.00", effectiveFrom: "2026-04-01", breakdown: [{ code: "BASIC", monthly: "25000.00" }] }], sample: { employeeId: UUID }, gotchas: [PERM_READ] }),
    ep({ slug: "salary-overview", path: "payrollSalary.overview", method: "query", title: "Salaries In Force", description: "Every active employee with the salary in force today (or none yet).", output: "Rows.", example: [{ employeeId: UUID, employeeCode: "E001", name: "Asha Verma", annualCtc: "600000.00", monthlyCtc: "50000.00", effectiveFrom: "2026-04-01", templateName: "Staff 50k" }], gotchas: [PERM_READ] }),

    // ── Attendance ────────────────────────────────────────────────────────────
    ep({
      slug: "attendance-month", path: "payrollAttendance.month", method: "query", title: "Monthly Attendance",
      description: "One month: every employee employed in it with each marked day, their weekly offs and holidays, and the summary payroll will use (`employedDays`, `paidDays`, `lopDays`, overtime hours and `unmarkedDates`). `locked` is true when the month's payroll run has moved past `draft`.",
      input: [month(), { name: "departmentId", type: "string (UUID)", required: false, description: "Only this department" }],
      output: "The month.", example: { month: "2026-08", dates: ["2026-08-01"], employees: [{ id: UUID, employeeCode: "E001", name: "Asha Verma", weeklyOffDays: [0], holidayDates: ["2026-08-15"], days: {}, summary: { employedDays: 31, paidDays: 28.5, lopDays: 2.5, unmarkedDates: [] } }], holidays: [], run: null, locked: false },
      sample: { month: "2026-08" }, gotchas: [PERM_READ],
    }),
    ep({
      slug: "attendance-mark", path: "payrollAttendance.mark", method: "mutation", title: "Mark Attendance",
      description: "Mark one day: `present`, `absent`, `half_day`, `week_off`, `holiday` or `leave` (with a `leaveTypeId`), with optional check-in/out (HH:MM) and overtime hours (only on a day worked). A half day is half paid and half loss of pay. Refused for a date outside the employee's employment or in a month whose payroll run has locked attendance. Audit entry `payroll.attendance.mark`.",
      input: [id("employeeId", "The employee"), date("date", "The day"), { name: "status", type: "enum", required: true, description: "The status", enumValues: ["present", "absent", "half_day", "week_off", "holiday", "leave"] }, str("checkIn", "HH:MM", false), str("checkOut", "HH:MM", false), num("overtimeHours", "0-24, default 0", false)],
      output: "The record.", example: { id: UUID, date: "2026-08-10", status: "absent" }, sample: { employeeId: UUID, date: "2026-08-10", status: "absent" },
      gotchas: [PERM_UPDATE, "BAD_REQUEST `Attendance for August 2026 is locked by its payroll run. Reopen the run to change it.`"],
    }),
    ep({ slug: "attendance-bulk-mark", path: "payrollAttendance.bulkMark", method: "mutation", title: "Bulk Mark Attendance", description: "Mark the same status for many employees and dates (at most 500 employees and 31 dates). Days already marked are kept unless `overwrite` is true; days written by approved leave are never overwritten. Days outside an employee's employment are skipped.", input: [{ name: "employeeIds", type: "string[] (UUID)", required: true, description: "Employees of this business" }, { name: "dates", type: "string[] (YYYY-MM-DD)", required: true, description: "At most 31" }, { name: "status", type: "enum", required: true, description: "Status", enumValues: ["present", "absent", "half_day", "week_off", "holiday"] }, bool("overwrite", "Replace marked days (default false)")], output: "How many days were marked and skipped.", example: { marked: 62, skipped: 4 }, sample: { employeeIds: [UUID], dates: ["2026-08-03"], status: "present" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "holiday-list", path: "payrollAttendance.holidayList", method: "query", title: "List Holidays", description: "Holidays of a calendar year. A national holiday applies to everyone, a state holiday to employees whose `workState` matches, a branch holiday to employees at that branch.", input: [{ name: "year", type: "integer", required: false, description: "Default: this year" }], output: "Rows.", example: [{ id: UUID, date: "2026-08-15", name: "Independence Day", scope: "national", stateCode: null, branch: null }], sample: { year: 2026 }, gotchas: [PERM_READ] }),
    ep({ slug: "holiday-create", path: "payrollAttendance.holidayCreate", method: "mutation", title: "Create Holiday", description: "Add a holiday (`scope`: `national`, `state` with `stateCode`, or `branch` with `branch`). Refused in a month whose attendance is locked.", input: [date("date", ""), str("name", ""), { name: "scope", type: "enum", required: false, description: "Default national", enumValues: ["national", "state", "branch"] }, str("stateCode", "Required for a state holiday", false), str("branch", "Required for a branch holiday", false)], output: "The holiday.", example: { id: UUID, date: "2026-08-15", name: "Independence Day", scope: "national" }, sample: { date: "2026-08-15", name: "Independence Day" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "holiday-delete", path: "payrollAttendance.holidayDelete", method: "mutation", title: "Delete Holiday", description: "Remove a holiday.", input: [id("id", "The holiday")], output: "The id and date.", example: { id: UUID, date: "2026-08-15" }, sample: { id: UUID }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "holiday-copy-year", path: "payrollAttendance.holidayCopyYear", method: "mutation", title: "Copy Holidays To Another Year", description: "Copy one year's holidays onto another year with the same dates (movable festivals need editing afterwards). Holidays that already exist are skipped.", input: [num("fromYear", ""), num("toYear", "")], output: "How many were copied.", example: { copied: 12 }, sample: { fromYear: 2026, toYear: 2027 }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "attendance-settings", path: "payrollAttendance.settings", method: "query", title: "Payroll Settings", description: "Defaults: weekly offs, standard hours a day, overtime multiplier and the month a leave year starts in.", output: "The settings (defaults until saved).", example: { defaultWeeklyOffDays: [0], standardHoursPerDay: 8, overtimeMultiplier: 2, leaveYearStartMonth: 4 }, gotchas: [PERM_READ] }),
    ep({ slug: "attendance-update-settings", path: "payrollAttendance.updateSettings", method: "mutation", title: "Update Payroll Settings", description: "Save the defaults. Overtime pays hours x the ordinary hourly wage x `overtimeMultiplier`, where the ordinary hourly wage is the full-month Basic + DA + retaining allowance / days in the month / standard hours (the usual multiplier is 2; confirm it with your CA each year). Change settings before locking a month's attendance: a recalculation uses the current settings.", input: [{ name: "defaultWeeklyOffDays", type: "integer[] 0-6", required: true, description: "0 = Sunday" }, num("standardHoursPerDay", "1-24"), num("overtimeMultiplier", "1-5"), num("leaveYearStartMonth", "1-12; 4 = April")], output: "The settings.", example: { defaultWeeklyOffDays: [0], standardHoursPerDay: 8, overtimeMultiplier: 2, leaveYearStartMonth: 4 }, sample: { defaultWeeklyOffDays: [0], standardHoursPerDay: 8, overtimeMultiplier: 2, leaveYearStartMonth: 4 }, gotchas: [PERM_UPDATE] }),

    // ── Leave ─────────────────────────────────────────────────────────────────
    ep({ slug: "leave-type-list", path: "payrollLeave.typeList", method: "query", title: "List Leave Types", description: "Leave types with accrual, carry-forward and encashment rules.", output: "Rows.", example: [{ id: UUID, code: "EL", name: "Earned leave", isPaid: true, accrualType: "monthly", accrualDays: "1.50", carryForward: true, carryForwardMax: "30.00", encashable: true, isActive: true }], gotchas: [PERM_READ] }),
    ep({ slug: "leave-type-create", path: "payrollLeave.typeCreate", method: "mutation", title: "Create Leave Type", description: "Add a leave type. `accrualType` is `none`, `annual` (days a year, granted once per leave year) or `monthly` (days a month).", input: [str("code", "Unique, upper-cased"), str("name", ""), bool("isPaid", "Default true; unpaid leave is loss of pay"), { name: "accrualType", type: "enum", required: false, description: "Default none", enumValues: ["none", "annual", "monthly"] }, num("accrualDays", "", false), bool("carryForward", ""), num("carryForwardMax", "", false), bool("encashable", "")], output: "The type.", example: { id: UUID, code: "CL", name: "Casual leave" }, sample: { code: "CL", name: "Casual leave", isPaid: true, accrualType: "annual", accrualDays: 12 }, gotchas: [PERM_CREATE] }),
    ep({ slug: "leave-type-update", path: "payrollLeave.typeUpdate", method: "mutation", title: "Update Leave Type", description: "Change a leave type's rules (its code does not change) or retire it.", input: [id("id", "The type"), str("name", "", false), bool("isPaid", ""), bool("carryForward", ""), num("carryForwardMax", "", false), bool("isActive", "")], output: "The type.", example: { id: UUID, code: "CL" }, sample: { id: UUID, carryForward: true, carryForwardMax: 5 }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "leave-type-seed", path: "payrollLeave.typeSeedDefaults", method: "mutation", title: "Add Standard Leave Types", description: "Add the standard types that are missing: CL (12 a year), SL (7 a year), EL (1.5 a month, carry forward up to 30, encashable) and LOP (unpaid).", output: "How many were added.", example: { added: 4 }, gotchas: [PERM_CREATE] }),
    ep({ slug: "leave-balances", path: "payrollLeave.balances", method: "query", title: "Leave Balances", description: "Balances per active employee and leave type for a leave year (named by the year it starts in; the current one by default). A balance is the sum of the employee's leave ledger.", input: [{ name: "leaveYear", type: "integer", required: false, description: "For example 2026 for April 2026 to March 2027" }, { name: "employeeId", type: "string (UUID)", required: false, description: "One employee" }], output: "The types and each employee's balances.", example: { leaveYear: 2026, yearStart: "2026-04-01", types: [{ id: UUID, code: "CL", name: "Casual leave", isPaid: true }], employees: [{ id: UUID, employeeCode: "E001", name: "Asha Verma", balances: { [UUID]: 12 } }] }, sample: { leaveYear: 2026 }, gotchas: [PERM_READ] }),
    ep({ slug: "leave-ledger", path: "payrollLeave.ledger", method: "query", title: "Leave Ledger", description: "One employee's ledger for a leave year: accruals, leave taken, carry-forward, closing and encashment rows (`days` is signed).", input: [id("employeeId", "The employee"), num("leaveYear", "")], output: "Rows.", example: [{ id: UUID, code: "EL", kind: "accrual", days: "1.50", entryDate: "2026-07-01", periodKey: "2026-07" }], sample: { employeeId: UUID, leaveYear: 2026 }, gotchas: [PERM_READ] }),
    ep({ slug: "leave-applications", path: "payrollLeave.applications", method: "query", title: "List Leave Applications", description: "Applications, newest first.", input: [{ name: "status", type: "enum", required: false, description: "Default all", enumValues: ["pending", "approved", "rejected", "cancelled", "all"] }, { name: "employeeId", type: "string (UUID)", required: false, description: "One employee" }], output: "Rows with employee and leave type names.", example: [{ id: UUID, employeeName: "Asha Verma", leaveCode: "EL", fromDate: "2026-07-06", toDate: "2026-07-08", days: "3.00", paidDays: "1.50", lopDays: "1.50", status: "approved" }], sample: { status: "pending" }, gotchas: [PERM_READ] }),
    ep({ slug: "leave-request", path: "payrollLeave.request", method: "mutation", title: "Apply For Leave", description: "Record a leave application. Weekly offs and holidays inside the dates do not use leave; `halfDayStart` and `halfDayEnd` make the first or last day a half day. Overlapping a pending or approved application is refused.", input: [id("employeeId", "The employee"), id("leaveTypeId", "The leave type"), date("fromDate", ""), date("toDate", ""), bool("halfDayStart", ""), bool("halfDayEnd", ""), str("reason", "", false)], output: "The pending application.", example: { id: UUID, status: "pending", days: "3.00" }, sample: { employeeId: UUID, leaveTypeId: UUID, fromDate: "2026-07-06", toDate: "2026-07-08" }, gotchas: [PERM_CREATE, "CONFLICT when the employee already has leave on some of the dates."] }),
    ep({ slug: "leave-decide", path: "payrollLeave.decide", method: "mutation", title: "Approve Or Reject Leave", description: "Decide a pending application. Approval uses the balance first and turns the rest into loss of pay (`paidDays` and `lopDays` on the result), writes the days into attendance (`source: \"leave\"`) and debits the ledger. Refused when the month's payroll run has locked attendance.", input: [id("id", "The application"), { name: "decision", type: "enum", required: true, description: "approve or reject", enumValues: ["approve", "reject"] }, str("note", "", false)], output: "The application.", example: { id: UUID, status: "approved", paidDays: "1.50", lopDays: "1.50" }, sample: { id: UUID, decision: "approve" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "leave-cancel", path: "payrollLeave.cancel", method: "mutation", title: "Cancel Leave", description: "Cancel a pending or approved application. An approved one gives the balance back and clears the attendance it wrote.", input: [id("id", "The application")], output: "The application.", example: { id: UUID, status: "cancelled" }, sample: { id: UUID }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "leave-accrue", path: "payrollLeave.accrue", method: "mutation", title: "Grant Leave For A Month", description: "Grant leave for a month: monthly types their monthly days, annual types their yearly grant once per leave year. Safe to repeat: a grant is written once per employee, type and period.", input: [month()], output: "How many ledger rows were created.", example: { created: 6, leaveYear: 2026 }, sample: { month: "2026-07" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "leave-close-year", path: "payrollLeave.closeYear", method: "mutation", title: "Close A Leave Year", description: "Carry each balance into the next year up to the type's maximum (when it carries forward) and lapse the rest. Running it twice changes nothing.", input: [num("leaveYear", "The year to close, for example 2026")], output: "Days carried and lapsed.", example: { carried: 12.5, lapsed: 4 }, sample: { leaveYear: 2026 }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "leave-encash", path: "payrollLeave.encash", method: "mutation", title: "Encash Leave", description: "Encash days of an encashable leave type: the days leave the balance and the `amount` you give is added as an earning (\"Leave encashment\") to the employee's next payroll run.", input: [id("employeeId", "The employee"), id("leaveTypeId", "An encashable type"), num("days", "At most the balance"), num("amount", "Rupees to pay")], output: "The encashment.", example: { id: UUID, days: "2.00", amount: "1600.00", payrollRunId: null }, sample: { employeeId: UUID, leaveTypeId: UUID, days: 2, amount: 1600 }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "leave-encashments", path: "payrollLeave.encashments", method: "query", title: "List Encashments", description: "Recent encashments, with the payroll run each was taken into (`payrollRunId`, null while waiting).", output: "Rows.", example: [{ id: UUID, employeeName: "Asha Verma", leaveCode: "EL", days: "2.00", amount: "1600.00", payrollRunId: null }], gotchas: [PERM_READ] }),

    // ── Payroll runs ──────────────────────────────────────────────────────────
    ep({ slug: "run-list", path: "payrollRun.list", method: "query", title: "List Payroll Runs", description: "Runs, newest month first, with their totals and status.", output: "Rows.", example: [RUN], gotchas: [PERM_READ] }),
    ep({
      slug: "run-get", path: "payrollRun.get", method: "query", title: "Get Payroll Run",
      description: "A run with its employee lines (each with every component's full and paid amount), the adjustments and `approval`: whether the signed-in person may approve it now and, if not, why (a role without `Payroll:manage`, or the maker-checker rule). Lines carry no bank details, only `hasBankDetails`.",
      input: [id("id", "The run")],
      output: "`run`, `lines`, `adjustments` and `approval`.",
      example: { run: RUN, lines: [{ id: UUID, employeeCode: "E001", employeeName: "Asha Verma", paidDays: "28.5", lopDays: "2.5", grossEarnings: "46774.19", totalDeductions: "1000.00", netPay: "45774.19", components: [{ code: "BASIC", name: "Basic", type: "earning", full: "25000.00", amount: "22983.87" }], hasBankDetails: true }], adjustments: [], approval: { canApprove: false, reason: "The person who calculated this payroll cannot approve it." } },
      sample: { id: UUID }, gotchas: [PERM_READ],
    }),
    ep({ slug: "run-create", path: "payrollRun.create", method: "mutation", title: "Start A Payroll Run", description: "Start the run for a month (the current month or an earlier one). One run per month per business.", input: [month()], output: "The run, in `draft`.", example: { ...RUN, status: "draft", employeeCount: 0 }, sample: { month: "2026-08" }, gotchas: [PERM_CREATE, "CONFLICT when the month already has a run; BAD_REQUEST for a month that has not started."], related: ["run-lock-attendance"] }),
    ep({ slug: "run-delete", path: "payrollRun.delete", method: "mutation", title: "Delete A Draft Run", description: "Delete a run that is still a draft.", input: [id("id", "The run")], output: "The id.", example: { id: UUID }, sample: { id: UUID }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "run-lock-attendance", path: "payrollRun.lockAttendance", method: "mutation", title: "Lock Attendance", description: "Step 1. Lock the month's attendance (`draft` -> `attendance_locked`). Every working day of every employee must have a record: otherwise the call is refused naming how many are missing, unless `fillUnmarked` (`present` or `absent`) says how to count them (the days are then written as marked).", input: [id("id", "The run"), { name: "fillUnmarked", type: "enum", required: false, description: "How to count working days with no record", enumValues: ["present", "absent"] }], output: "The run and how many days were filled.", example: { run: { ...RUN, status: "attendance_locked" }, filled: 0 }, sample: { id: UUID }, gotchas: [PERM_UPDATE], related: ["run-calculate"] }),
    ep({ slug: "run-calculate", path: "payrollRun.calculate", method: "mutation", title: "Calculate Payroll", description: "Step 2. Calculate (or recalculate) every employee's pay from the locked attendance, the salary in force, overtime, the run's adjustments and waiting leave encashments: earnings - loss of pay - deductions = net pay. Allowed from `attendance_locked`, `calculated` and `pending_approval` (which sends it back). Employees with no salary are left out and listed in `warnings`. The calculator of record becomes the maker for maker-checker.", input: [id("id", "The run")], output: "The run (status `calculated`) and the warnings (wages under 50% of remuneration, a negative net pay, employees left out).", example: { run: RUN, warnings: [{ code: "wages_below_50_percent", message: "Asha Verma: Wages (Basic + DA + retaining allowance) are below 50% of the total remuneration.", employeeId: UUID }] }, sample: { id: UUID }, gotchas: [PERM_UPDATE, "Warnings never block; a negative net pay blocks `submit`."] }),
    ep({ slug: "run-add-adjustment", path: "payrollRun.addAdjustment", method: "mutation", title: "Add Adjustment", description: "A one-off amount on one employee's pay in this run: a manual deduction, an advance recovery, an incentive. Kept across recalculation. A run waiting for approval goes back to `calculated` and must be calculated and submitted again.", input: [id("runId", "The run"), id("employeeId", "The employee"), str("name", "Shown on the payslip"), { name: "type", type: "enum", required: true, description: "earning or deduction", enumValues: ["earning", "deduction"] }, num("amount", "Rupees above zero")], output: "The adjustment.", example: { id: UUID, runId: UUID, employeeId: UUID, name: "Advance recovery", type: "deduction", amount: "1000.00" }, sample: { runId: UUID, employeeId: UUID, name: "Advance recovery", type: "deduction", amount: 1000 }, gotchas: [PERM_UPDATE, "Statutory deductions (PF, ESI, PT, TDS) are not calculated in Phase 1: enter them here."] }),
    ep({ slug: "run-remove-adjustment", path: "payrollRun.removeAdjustment", method: "mutation", title: "Remove Adjustment", description: "Remove an adjustment from a run that is not yet approved.", input: [id("runId", "The run"), id("adjustmentId", "The adjustment")], output: "The run id.", example: { runId: UUID }, sample: { runId: UUID, adjustmentId: UUID }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "run-submit", path: "payrollRun.submit", method: "mutation", title: "Submit For Approval", description: "Step 3 (`calculated` -> `pending_approval`). Refused when a net pay is below zero, naming the employee.", input: [id("id", "The run")], output: "The run.", example: { ...RUN, status: "pending_approval" }, sample: { id: UUID }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "run-approve", path: "payrollRun.approve", method: "mutation", title: "Approve Payroll", description: "Step 4, maker-checker (`pending_approval` -> `approved`). Needs `Payroll:manage` (owner, admin). The person who last calculated the run is refused with FORBIDDEN unless the business has a single user. Approval freezes the run: bank details are copied onto the lines for the payment file and one payslip snapshot (identity numbers masked) is stored per employee. An employee's final month is linked to them as their full and final run.", role: "admin", input: [id("id", "The run")], output: "The approved run.", example: { ...RUN, status: "approved", approvedAt: "2026-09-01T09:30:00.000Z" }, sample: { id: UUID }, gotchas: [`Requires \`Payroll:manage\`. ${ADDON}`, "An approved run cannot be recalculated, reopened, adjusted or deleted."] }),
    ep({ slug: "run-reopen", path: "payrollRun.reopen", method: "mutation", title: "Reopen A Run", description: "Back to `draft` before approval: the calculated lines are discarded; attendance and adjustments stay. An approved run cannot be reopened.", input: [id("id", "The run")], output: "The run, as a draft.", example: { ...RUN, status: "draft", employeeCount: 0 }, sample: { id: UUID }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "run-post", path: "payrollRun.post", method: "mutation", title: "Post To The Books", description: "Step 5 (`approved` -> `posted`). Writes ONE balanced journal entry dated the last day of the month: Dr Salary & Wages (5200), Salary - Allowances (5201), Bonus & Incentives (5202), Overtime (5203), Employer Contributions (5204); Cr Salaries Payable (2400, net pay), Payroll Deductions Payable (2410) and Employer Contributions Payable (2420). The accounts are created in the business's chart when missing. Posting twice returns the same entry (`created: false`). Refused for a locked period. The entry cannot be voided from Journal Entries.", input: [id("id", "The run")], output: "The run, the journal entry id and whether it was created now.", example: { run: { ...RUN, status: "posted" }, journalEntryId: UUID, created: true }, sample: { id: UUID }, gotchas: [PERM_UPDATE, "FORBIDDEN `This period is locked...` when the books are locked through the month end."] }),
    ep({ slug: "run-mark-paid", path: "payrollRun.markPaid", method: "mutation", title: "Mark Salaries Paid", description: "Step 6 (`posted` -> `paid`). Records the salary payment out of a bank or cash account of this business: Dr Salaries Payable / Cr Cash in Hand (1000) or Bank Accounts (1010), a withdrawal on the account and its balance. Once; a repeat returns the same entry. Refused for a locked payment date.", input: [id("runId", "The run"), id("bankAccountId", "A bank or cash account of this business"), date("paidOn", "Payment date"), str("reference", "Batch or UTR", false)], output: "The run, the payment entry and whether it was created now.", example: { run: { ...RUN, status: "paid" }, journalEntryId: UUID, created: true }, sample: { runId: UUID, bankAccountId: UUID, paidOn: "2026-09-05" }, gotchas: [PERM_UPDATE] }),
    ep({ slug: "run-payslip-pdf", path: "payrollRun.payslipPdf", method: "query", title: "Payslip PDF", description: "The payslip as an A4 PDF (base64): business header, employee details with masked PAN, UAN and bank account, earnings and deductions, net pay in figures and words, paid and LOP days. Before approval it is a marked draft built from the calculated line; after approval it is drawn from the frozen snapshot and never changes.", input: [id("runId", "The run"), id("employeeId", "The employee")], output: "`filename`, `contentType`, `base64` and whether it is a `draft`.", example: { filename: "PS-2026-08-E001.pdf", contentType: "application/pdf", base64: "JVBERi0xLjM...", draft: false }, sample: { runId: UUID, employeeId: UUID }, gotchas: [PERM_READ] }),
    ep({ slug: "run-payslip-email", path: "payrollRun.payslipEmail", method: "mutation", title: "Email A Payslip", description: "Email an approved payslip (PDF attached) to the employee's email address. The reply goes to the business email. The response and the audit entry carry the masked address only.", input: [id("runId", "The run"), id("employeeId", "The employee")], output: "Who it was sent to (masked).", example: { runId: UUID, employeeId: UUID, sentTo: "as***@example.in" }, sample: { runId: UUID, employeeId: UUID }, gotchas: [PERM_UPDATE, "BAD_REQUEST before approval or when the employee has no email."] }),
    ep({ slug: "run-bank-file", path: "payrollRun.bankFile", method: "query", title: "Bank Payment File", description: "A CSV of net pay per employee for an approved run: Sr No, Employee Code, Beneficiary Name, Account Number, IFSC, Amount (INR), Payment Mode (NEFT, or RTGS from Rs 2,00,000), Narration. It is a generic NEFT/RTGS-style file, NOT any specific bank's upload format: rearrange the columns if your bank asks for another. Employees with no bank account or IFSC are left out and listed in `skipped`. Cells that could run as spreadsheet formulas are neutralised.", input: [id("id", "The run")], output: "`csv`, the number of payments, their total and the employee codes left out.", example: { filename: "salary-2026-08.csv", contentType: "text/csv", csv: "Sr No,Employee Code,...", count: 2, total: "61758.56", skipped: ["E003"] }, sample: { id: UUID }, gotchas: [`Requires \`Payroll:update\` because the file holds full bank account numbers. ${ADDON}`] }),
    // ── Statutory (Phase 2): PF, EPS, VPF, ESI, PT, LWF, TDS on salary ───────────────
    ep({
      slug: "statutory-settings", path: "payrollStatutory.settings", method: "query", title: "Statutory Settings",
      description: "The registrations (PF, ESI, professional tax states, labour welfare fund state, TDS on salary) and every rate, ceiling, slab and due date in force for a financial year: the latest row saved at or before it, else the shipped defaults (`ratesSource`). State slabs and income-tax slabs ship EMPTY on purpose; `gaps` lists what is not configured. All figures are data per financial year and need verifying with your CA (`verifyLabel`).",
      input: [num("financialYear", "Start year of the financial year (2026 = 2026-27). Default: the current one", false)],
      output: "`flags`, `rates`, `ratesSource` (`saved` or `default`), `gaps`, `verifiedNote`, `verifiedOn` and `canEdit`.",
      example: { financialYear: 2026, financialYearLabel: "2026-27", verifyLabel: "Verify with your CA", flags: { pfRegistered: true, esiRegistered: true, ptStates: ["27"], lwfState: null, tdsEnabled: false }, ratesSource: "default", gaps: ["New-regime income-tax slabs are not configured: TDS on salary is 0 for employees on the new regime until you add them."], canEdit: true },
      sample: { financialYear: 2026 }, gotchas: [PERM_READ],
    }),
    ep({
      slug: "statutory-update-business-settings", path: "payrollStatutory.updateBusinessSettings", method: "mutation", title: "Update Statutory Registrations", role: "admin",
      description: "Turn the schemes on or off: PF registered (+ establishment code), ESI registered (+ code), the states the business deducts professional tax in, the labour welfare fund state and TDS on salary. With PF off, PF, VPF and EPS never appear anywhere (salary lines, payslips, files, dues, screens). Takes effect when a run is calculated again; approved runs are never touched. Audit entry `payroll.statutory.updateBusinessSettings`.",
      input: [bool("pfRegistered", "PF registration", true), str("pfEstablishmentCode", "PF establishment code", false), bool("esiRegistered", "ESI registration", true), str("esiCode", "ESI code", false), { name: "ptStates", type: "string[]", required: true, description: "GST state codes, for example `[\"27\"]`" }, str("lwfState", "GST state code or empty", false), bool("tdsEnabled", "Deduct income tax on salary", true)],
      output: "The registrations now in force.", example: { flags: { pfRegistered: true, esiRegistered: false, ptStates: ["27"], lwfState: null, tdsEnabled: false } },
      sample: { pfRegistered: true, pfEstablishmentCode: "MHBAN0012345000", esiRegistered: false, ptStates: ["27"], tdsEnabled: false },
      gotchas: [`Requires \`Payroll:manage\` (owner, admin). ${ADDON} Refused while the organization is read-only.`, "BAD_REQUEST for an unknown state code."],
    }),
    ep({
      slug: "statutory-save-rates", path: "payrollStatutory.saveRates", method: "mutation", title: "Save Statutory Rates", role: "admin",
      description: "Save the whole rates document for a financial year (PF and EPS percentages and ceilings, ESI, state professional tax slabs with February amounts and gender, labour welfare fund amounts and months, new and old regime income-tax slabs, standard deduction, 87A rebate, cess, declaration limits, due dates, gratuity and bonus parameters) with a last-verified note. A run copies what it used when it is calculated, so editing a year never changes a calculated or approved run. Overlapping PT slabs are refused. Audit entry `payroll.statutory.saveRates`.",
      input: [num("financialYear", "Start year of the financial year"), { name: "rates", type: "object", required: true, description: "The StatutoryRates document (see `statutoryRatesSchema` in @fintranzact/shared)" }, str("verifiedNote", "Who checked the figures, against what", false), date("verifiedOn", "When", false)],
      output: "The financial year saved.", example: { financialYear: 2026 }, sample: { financialYear: 2026, rates: { pf: { employeePercent: 12 } }, verifiedNote: "Checked with CA Shah" },
      gotchas: [`Requires \`Payroll:manage\` (owner, admin). ${ADDON} Refused while the organization is read-only.`, "BAD_REQUEST when a value is out of range or the PT slabs of a state overlap."],
    }),
    ep({
      slug: "statutory-employee-settings", path: "payrollStatutory.employeeSettings", method: "query", title: "Employee Statutory Settings",
      description: "One employee's PF applicable, excluded employee, EPS eligible, PF on actual wages, VPF %, international worker, PF join date and ESI applicable, with what payroll uses for EPS today (`epsInEffect`), an EPS suggestion (joined PF on or after 1 Sep 2014 with wages above the ceiling: no EPS; age 58 or more: EPS stops; international workers need review) and the tax declaration for the financial year.",
      input: [id("employeeId", "The employee"), num("financialYear", "Start year; default the current one", false)],
      output: "The settings, `epsSuggestion` and `declaration`.", example: { employeeId: UUID, pfApplicable: true, pfExcluded: false, epsEligible: true, vpfPercent: 0, esiApplicable: true, epsInEffect: true, epsSuggestion: { status: "eligible", reasons: [] }, declaration: { sec80C: 0, sec80D: 0 } },
      sample: { employeeId: UUID }, gotchas: [PERM_READ],
    }),
    ep({
      slug: "statutory-employee-update", path: "payrollStatutory.employeeUpdate", method: "mutation", title: "Update Employee Statutory Settings",
      description: "Change an employee's PF, EPS, VPF and ESI settings. Only the fields sent change. They only matter when the business is registered for the scheme. Audit entry `payroll.statutory.employeeUpdate` (field names, never values).",
      input: [id("employeeId", "The employee"), bool("pfApplicable", "PF applies"), bool("pfExcluded", "Excluded employee (opted out)"), bool("epsEligible", "EPS eligible"), bool("pfOnActualWages", "Contribute on actual wages"), num("vpfPercent", "Voluntary PF, 0-100", false), bool("internationalWorker", "International worker"), date("pfJoinDate", "Date joined PF", false), bool("esiApplicable", "ESI applies")],
      output: "The employee and the fields changed.", example: { employeeId: UUID, employeeCode: "E001", fields: ["vpfPercent"] }, sample: { employeeId: UUID, vpfPercent: 5 },
      gotchas: [PERM_UPDATE],
    }),
    ep({
      slug: "statutory-save-declaration", path: "payrollStatutory.saveDeclaration", method: "mutation", title: "Save Tax Declaration",
      description: "An employee's investment declarations for a financial year, in rupees: 80C, 80D, HRA exemption, home-loan interest, other deductions, and income and tax from a previous employer. Used under the old regime only; the 80C, 80D and home-loan limits are settings. Audit entry `payroll.statutory.saveDeclaration`.",
      input: [id("employeeId", "The employee"), num("financialYear", "Start year"), { name: "amounts", type: "object", required: true, description: "`sec80C`, `sec80D`, `hraExemption`, `homeLoanInterest`, `otherDeductions`, `previousEmployerIncome`, `previousEmployerTds` (rupees)" }],
      output: "The employee and year saved.", example: { employeeId: UUID, financialYear: 2026 }, sample: { employeeId: UUID, financialYear: 2026, amounts: { sec80C: 150000 } },
      gotchas: [PERM_UPDATE],
    }),
    ep({
      slug: "statutory-dues", path: "payrollStatutory.dues", method: "query", title: "Statutory Dues",
      description: "What each approved run of a financial year owes PF (employee, employer, VPF and EPS), ESI, professional tax, labour welfare fund and TDS on salary, what has been paid (with challan details), what is outstanding and the due date from the due-day settings (`null` when not configured). `canPay` is true once the run is posted to the books.",
      input: [num("financialYear", "Start year; default the current one", false)],
      output: "`rows`: one per run and authority with an accrued amount.", example: { financialYear: 2026, financialYearLabel: "2026-27", rows: [{ runId: UUID, month: "2026-04", kind: "pf", accrued: "10680.00", paid: "0.00", outstanding: "10680.00", dueDate: "2026-05-15", canPay: true, payments: [] }] },
      sample: { financialYear: 2026 }, gotchas: [PERM_READ],
    }),
    ep({
      slug: "statutory-record-payment", path: "payrollStatutory.recordPayment", method: "mutation", title: "Record A Statutory Payment",
      description: "Record that you paid a statutory due: Dr the payable account (PF and EPS 2430, ESI 2431, PT 2432, LWF 2433, TDS on salary 2434) / Cr cash or bank, a withdrawal on the account and a payment row with the challan number and date. Never more than is outstanding (the run is locked while this is re-checked). It records a payment you made; it pays nothing. Respects period locks. Audit entry `payroll.statutory.recordPayment`.",
      input: [id("runId", "The payroll run"), { name: "kind", type: "enum", required: true, description: "Authority", enumValues: ["pf", "esi", "pt", "lwf", "tds"] }, num("amount", "Rupees"), date("paidOn", "Payment date"), id("bankAccountId", "A bank or cash account of this business"), str("challanNumber", "Challan number", false), date("challanDate", "Challan date", false), str("reference", "BSR code, TRRN or UTR", false)],
      output: "The payment, the journal entry and what is still outstanding.", example: { payment: { id: UUID, kind: "pf", amount: "5000.00", challanNumber: "TRRN-1001" }, journalEntryId: UUID, outstanding: "5680.00", kind: "pf", runId: UUID },
      sample: { runId: UUID, kind: "pf", amount: 5000, paidOn: "2026-05-14", bankAccountId: UUID, challanNumber: "TRRN-1001" },
      gotchas: [PERM_UPDATE, "BAD_REQUEST `Only 5680.00 is outstanding...` when the amount is more than is owed, and when the run is not posted yet."],
    }),
    ep({
      slug: "statutory-ecr-file", path: "payrollStatutory.ecrFile", method: "query", title: "PF ECR File",
      description: "The PF ECR text file (EPFO ECR 2.0 layout: `#~#` separated: UAN, name, gross, EPF, EPS and EDLI wages, EPF contribution (employee share with VPF), EPS contribution, EPF-EPS difference (employer share), NCP days, refund of advances) for an approved run, plus the same rows as a CSV. Only PF members with a UAN; a member without EPS has zero pension wages and contribution and the full employer 12% in the difference column. Check it against the EPFO portal's current template before uploading: nothing is filed.",
      input: [id("runId", "An approved run")],
      output: "`text`, `csv`, the member count, the members left out (`skipped`), totals and a `note`.", example: { filename: "ECR-2026-04.txt", text: "100200300401#~#ASHA VERMA#~#30000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0\n", count: 1, skipped: [], totals: { epfEe: 1800, eps: 1250, epfEr: 550 } },
      sample: { runId: UUID }, gotchas: [`Requires \`Payroll:update\` because the file holds UAN numbers. ${ADDON}`, "BAD_REQUEST when the run is not approved or was calculated for a business with no PF registration."],
    }),
    ep({
      slug: "statutory-esic-file", path: "payrollStatutory.esicFile", method: "query", title: "ESIC Contribution File",
      description: "The ESIC monthly contribution CSV (IP number, name, days paid, total monthly wages, reason code, last working day) for an approved run: covered employees only, those without an IP number are listed in `skipped`. Check against the ESIC portal's current bulk-upload template; nothing is filed.",
      input: [id("runId", "An approved run")], output: "`text` (CSV), the count, `skipped` and a `note`.", example: { filename: "ESIC-2026-04.csv", text: "IP Number,IP Name,...", count: 2, skipped: [] },
      sample: { runId: UUID }, gotchas: [`Requires \`Payroll:update\` (the file holds ESIC numbers). ${ADDON}`, "BAD_REQUEST without an approved run or an ESI registration."],
    }),
    ep({
      slug: "statutory-pt-sheets", path: "payrollStatutory.ptSheets", method: "query", title: "Professional Tax Sheets",
      description: "A working CSV per state for an approved run: employee, gross salary, professional tax and a total row. For your CA to check; not a government template.",
      input: [id("runId", "An approved run")], output: "`sheets`, one per state, and a `note`.", example: { month: "2026-04", kind: "pt", sheets: [{ state: "27", filename: "PT-27-2026-04.csv", count: 4, employeeTotal: "800.00" }] },
      sample: { runId: UUID }, gotchas: [PERM_UPDATE],
    }),
    ep({
      slug: "statutory-lwf-sheets", path: "payrollStatutory.lwfSheets", method: "query", title: "Labour Welfare Fund Sheets",
      description: "A working CSV for an approved run with the employee and employer labour welfare fund amounts and a total row. Empty in months when none is due.",
      input: [id("runId", "An approved run")], output: "`sheets` and a `note`.", example: { month: "2026-12", kind: "lwf", sheets: [] },
      sample: { runId: UUID }, gotchas: [PERM_UPDATE, "BAD_REQUEST when the run was calculated with no labour welfare fund state."],
    }),
    ep({
      slug: "statutory-form-24q", path: "payrollStatutory.form24q", method: "query", title: "Form 24Q Working Data",
      description: "Working data for Form 24Q for a quarter: a deductee-wise CSV (TAN, section 192, employee, PAN, amount paid, TDS deducted, date of deduction) and a challans CSV from the recorded TDS payments. It is not an FVU file: prepare the return in the Income Tax Department's utility.",
      input: [num("financialYear", "Start year"), num("quarter", "1 to 4 (Q1 is April to June)")], output: "Both CSVs, the totals and a `note`.", example: { deducteeFilename: "24Q-2026-27-Q1-deductees.csv", challanFilename: "24Q-2026-27-Q1-challans.csv", totalTds: "7345.00", totalChallan: "7345.00", rows: 5 },
      sample: { financialYear: 2026, quarter: 1 }, gotchas: [`Requires \`Payroll:update\` (the file holds PAN numbers). ${ADDON}`],
    }),
    ep({
      slug: "statutory-form-16-pdf", path: "payrollStatutory.form16Pdf", method: "query", title: "Form 16 Working Copy (PDF)",
      description: "A Part A and Part B style summary for one employee and financial year as a PDF (base64): the quarter-wise tax deducted, then the year's tax recomputed on the actual income with the same rules as the monthly projection, compared with the tax deducted. Labelled \"Working copy for CA review\": it is not a TRACES-generated Form 16 and not a validated certificate.",
      input: [num("financialYear", "Start year"), id("employeeId", "The employee")], output: "The PDF as base64 and the label.", example: { filename: "form16-working-copy-2026-27-E001.pdf", contentType: "application/pdf", base64: "JVBERi0...", label: "Working copy for CA review. Not a TRACES-generated Form 16 and not a validated certificate." },
      sample: { financialYear: 2026, employeeId: UUID }, gotchas: [`Requires \`Payroll:update\` (it holds the full PAN). ${ADDON}`, "BAD_REQUEST when the employee has no approved payroll in that year."],
    }),
    ep({
      slug: "statutory-form-16-data", path: "payrollStatutory.form16Data", method: "query", title: "Form 16 Working Copy (Data)",
      description: "The same Form 16 working copy as a CSV with a short summary (taxable income, tax payable, tax deducted, difference).",
      input: [num("financialYear", "Start year"), id("employeeId", "The employee")], output: "The CSV, the label and the summary.", example: { filename: "form16-working-copy-2026-27-E001.csv", contentType: "text/csv", csv: "Working copy,...", label: "Working copy for CA review.", summary: { taxableIncome: 1245000, taxPayable: 46800, taxDeducted: 46800, difference: 0 } },
      sample: { financialYear: 2026, employeeId: UUID }, gotchas: [PERM_UPDATE],
    }),
    ep({
      slug: "statutory-register", path: "payrollStatutory.register", method: "query", title: "Registers",
      description: "A register as a CSV: `wages` (a month's approved run, a column per earning and deduction), `attendance` (a month, one column per day), `leave` (a leave year: opening, accrued, taken, encashed, lapsed, balance), `bonus` (a financial year: wages after the ceiling and the bonus at the configured percentage, or a note when none is configured) and `gratuity` (as of a date: 15/26 of last Basic + DA per completed year, more than six months counted as a year, the configured minimum years and cap). Bonus and gratuity are computed from existing data; nothing is paid.",
      input: [{ name: "register", type: "enum", required: true, description: "Which register", enumValues: ["wages", "attendance", "leave", "bonus", "gratuity"] }, month("month"), num("financialYear", "For bonus and gratuity", false), num("leaveYear", "For leave", false), date("asOf", "For gratuity; default today", false)],
      output: "`filename`, `text` (CSV) and the row count.", example: { filename: "wages-register-2026-04.csv", contentType: "text/csv", text: "Month,Employee Code,...", count: 5 },
      sample: { register: "wages", month: "2026-04" }, gotchas: [PERM_UPDATE, "BAD_REQUEST for a wages register with no approved run that month."],
    }),
  ],
};
