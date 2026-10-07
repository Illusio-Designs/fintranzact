/**
 * Payroll (Phase 1) shared definitions: field formats, masking, the bank
 * payment file and the input schemas the API, the web forms and the CLI share.
 *
 * The calculation lives in payroll-calc.ts and the calendar and attendance
 * rules in payroll-calendar.ts. Everything here is pure.
 */

import { z } from "zod";
import { PAN_REGEX, IFSC_REGEX } from "./party-compliance.js";
import { isValidIndianMobile, normaliseIndianMobile, PHONE_INVALID_MESSAGE } from "./phone.js";
import { isStateCode } from "./indian-states.js";
import { COMPONENT_CATEGORIES, COMPONENT_TYPES, CALC_TYPES, type ComponentType } from "./payroll-calc.js";
import { ATTENDANCE_STATUSES, isIsoDate, isPayrollMonth, LEAVE_ACCRUAL_TYPES } from "./payroll-calendar.js";

// ── Field formats ────────────────────────────────────────────────────────────

/** Aadhaar: 12 digits (a simple format check; it does not verify the number). */
export const AADHAAR_REGEX = /^[0-9]{12}$/;
/** UAN (Universal Account Number for PF): 12 digits. */
export const UAN_REGEX = /^[0-9]{12}$/;
/** ESIC insurance number: 10 to 17 digits. */
export const ESIC_REGEX = /^[0-9]{10,17}$/;
/** Bank account number: 9 to 18 digits. */
export const BANK_ACCOUNT_REGEX = /^[0-9]{9,18}$/;

export const PAN_MESSAGE = "PAN must look like AAAAA9999A.";
export const IFSC_MESSAGE = "IFSC must be 11 characters: 4 letters, a 0, then 6 letters or digits (for example HDFC0001234).";
export const AADHAAR_MESSAGE = "Aadhaar must be 12 digits.";
export const UAN_MESSAGE = "UAN must be 12 digits.";
export const ESIC_MESSAGE = "ESIC number must be 10 to 17 digits.";
export const BANK_ACCOUNT_MESSAGE = "Bank account number must be 9 to 18 digits.";

/** Remove the spaces and dashes people type inside a number. */
export function compactDigits(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/**
 * Hide all but the last 4 characters of a sensitive number ("XXXXXXXX3456").
 * Used in every list, in the audit trail, in emails and on payslips. A value
 * of 4 characters or fewer is hidden completely.
 */
export function maskSensitive(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (v.length <= 4) return "X".repeat(v.length);
  return `${"X".repeat(v.length - 4)}${v.slice(-4)}`;
}

// ── Master values ────────────────────────────────────────────────────────────

export const EMPLOYMENT_TYPES = ["permanent", "contract", "intern"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = { permanent: "Permanent", contract: "Contract", intern: "Intern" };

export const GENDERS = ["male", "female", "other"] as const;
export const TAX_REGIMES = ["new", "old"] as const;
export const TAX_REGIME_LABELS: Record<(typeof TAX_REGIMES)[number], string> = { new: "New regime", old: "Old regime" };

export const EMPLOYEE_STATUSES = ["active", "exited"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const HOLIDAY_SCOPES = ["national", "state", "branch"] as const;
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number];

export const EXIT_REASONS = ["resignation", "termination", "retirement", "end_of_contract", "absconded", "other"] as const;
export const EXIT_REASON_LABELS: Record<(typeof EXIT_REASONS)[number], string> = {
  resignation: "Resignation",
  termination: "Termination",
  retirement: "Retirement",
  end_of_contract: "End of contract",
  absconded: "Absconded",
  other: "Other",
};

/** Largest profile photo (a data URL: image/png, jpeg or webp). About 150 KB of image. */
export const MAX_PHOTO_DATA_URL_LENGTH = 220_000;
export const PHOTO_DATA_URL_REGEX = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

// ── Input schemas ────────────────────────────────────────────────────────────

const uuid = z.string().uuid();

/** A free-text field: trimmed, may be left empty. */
const text = (max: number) => z.string().trim().max(max);

/** A date "YYYY-MM-DD". */
export const isoDateSchema = z.string().refine(isIsoDate, "Enter a valid date.");
export const payrollMonthSchema = z.string().refine(isPayrollMonth, "Enter a month like 2026-10.");

/**
 * Employee fields. Optional text fields may be sent empty (a form's blank
 * input); the API stores an empty value as null. Identity numbers are
 * normalised (spaces and dashes removed, letters upper-cased) before they
 * are checked.
 */
const maybe = <T extends z.ZodTypeAny>(schema: T) => z.union([z.literal(""), schema]).optional();

const panField = z.string().trim().transform((v) => compactDigits(v).toUpperCase()).refine((v) => PAN_REGEX.test(v), PAN_MESSAGE);
const aadhaarField = z.string().trim().transform(compactDigits).refine((v) => AADHAAR_REGEX.test(v), AADHAAR_MESSAGE);
const uanField = z.string().trim().transform(compactDigits).refine((v) => UAN_REGEX.test(v), UAN_MESSAGE);
const esicField = z.string().trim().transform(compactDigits).refine((v) => ESIC_REGEX.test(v), ESIC_MESSAGE);
const accountField = z.string().trim().transform(compactDigits).refine((v) => BANK_ACCOUNT_REGEX.test(v), BANK_ACCOUNT_MESSAGE);
const ifscField = z.string().trim().transform((v) => v.toUpperCase()).refine((v) => IFSC_REGEX.test(v), IFSC_MESSAGE);
const phoneField = z.string().trim().refine((v) => isValidIndianMobile(v), PHONE_INVALID_MESSAGE).transform((v) => normaliseIndianMobile(v) ?? v);

export const employeeFieldsSchema = z.object({
  employeeCode: z.string().trim().min(1, "Enter an employee code.").max(30),
  name: z.string().trim().min(2, "Enter the employee's name.").max(120),
  dateOfBirth: maybe(isoDateSchema),
  gender: maybe(z.enum(GENDERS)),
  fatherOrSpouseName: maybe(text(120)),
  address: maybe(text(500)),
  phone: maybe(phoneField),
  email: maybe(z.string().trim().email("Enter a valid email address.").max(255)),
  /** A small profile photo as a data URL. */
  photoDataUrl: maybe(z.string().max(MAX_PHOTO_DATA_URL_LENGTH).regex(PHOTO_DATA_URL_REGEX, "Use a PNG, JPEG or WebP image.")),
  pan: maybe(panField),
  aadhaar: maybe(aadhaarField),
  uan: maybe(uanField),
  esicNumber: maybe(esicField),
  dateOfJoining: isoDateSchema,
  departmentId: uuid.nullable().optional(),
  designationId: uuid.nullable().optional(),
  branch: maybe(text(120)),
  /** The state the employee works in (a state code): decides which state holidays apply. */
  workState: maybe(z.string().refine(isStateCode, "Choose a state.")),
  managerId: uuid.nullable().optional(),
  shiftId: uuid.nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("permanent"),
  taxRegime: z.enum(TAX_REGIMES).default("new"),
  bankAccountNumber: maybe(accountField),
  bankIfsc: maybe(ifscField),
  bankAccountName: maybe(text(120)),
  bankName: maybe(text(120)),
});
export type EmployeeFieldsInput = z.input<typeof employeeFieldsSchema>;

export const employeeUpdateSchema = employeeFieldsSchema.partial().extend({ id: uuid });

export const employeeListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["active", "exited", "all"]).default("active"),
  departmentId: uuid.optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(200).default(50),
});

export const employeeExitSchema = z.object({
  id: uuid,
  lastWorkingDay: isoDateSchema,
  reason: z.enum(EXIT_REASONS),
  note: maybe(text(500)),
  /** Free text on the full and final settlement (what is owed, notice recovery...). */
  fnfNote: maybe(text(1000)),
});

export const departmentInputSchema = z.object({ name: z.string().trim().min(1, "Enter a name.").max(80) });
export const designationInputSchema = z.object({ name: z.string().trim().min(1, "Enter a name.").max(80) });

// Salary components and templates

export const salaryComponentSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a code.").max(20).transform((v) => v.toUpperCase()),
    name: z.string().trim().min(1, "Enter a name.").max(80),
    type: z.enum(COMPONENT_TYPES),
    category: z.enum(COMPONENT_CATEGORIES),
    prorate: z.boolean().default(true),
    isWage: z.boolean().default(false),
    /** Always null here: statutory components (PF, ESI, PT, LWF, TDS) are calculated by the payroll run, not added by hand. */
    statutoryKind: z.null().optional(),
    sortOrder: z.number().int().min(0).max(999).default(100),
  })
  .superRefine((v, ctx) => {
    const okType: Record<string, ComponentType> = {
      basic: "earning", da: "earning", retaining_allowance: "earning", hra: "earning", conveyance: "earning", special_allowance: "earning",
      bonus: "earning", incentive: "earning", overtime: "earning", other_earning: "earning",
      manual_deduction: "deduction", advance_recovery: "deduction", other_deduction: "deduction", other_employer: "employer_contribution",
    };
    if (okType[v.category] !== v.type) ctx.addIssue({ code: "custom", path: ["category"], message: "This category does not belong to that component type." });
  });
export type SalaryComponentInput = z.input<typeof salaryComponentSchema>;

export const templateLineSchema = z.object({
  componentId: uuid,
  calcType: z.enum(CALC_TYPES),
  /** Rupees for a fixed amount, a percentage for the percent types, ignored for "balance". */
  value: z.number().min(0).max(1_000_000_000).default(0),
});

export const salaryTemplateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  description: maybe(text(300)),
  /** The annual CTC the template is shown with (rupees); employees get their own CTC when assigned. */
  sampleAnnualCtc: z.number().min(0).max(1_000_000_000).default(0),
  lines: z.array(templateLineSchema).min(1, "Add at least one component.").max(40),
});

export const salaryPreviewSchema = z.object({
  annualCtc: z.number().min(0).max(1_000_000_000),
  lines: z.array(templateLineSchema).min(1).max(40),
});

export const salaryAssignSchema = z.object({
  employeeId: uuid,
  templateId: uuid,
  /** Annual CTC in rupees. */
  annualCtc: z.number().min(0).max(1_000_000_000),
  effectiveFrom: isoDateSchema,
  /** Replace the template's line values for this employee only. Keys are component ids. */
  overrides: z.record(uuid, z.object({ calcType: z.enum(CALC_TYPES), value: z.number().min(0).max(1_000_000_000) })).optional(),
});

// Attendance

export const attendanceMarkSchema = z.object({
  employeeId: uuid,
  date: isoDateSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  /** For "leave", or a "half_day" that is half a leave. */
  leaveTypeId: uuid.nullable().optional(),
  checkIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time like 09:30.").nullable().optional(),
  checkOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time like 18:00.").nullable().optional(),
  overtimeHours: z.number().min(0).max(24).default(0),
  note: maybe(text(200)),
});

export const attendanceBulkMarkSchema = z.object({
  employeeIds: z.array(uuid).min(1).max(500),
  /** Dates to mark, "YYYY-MM-DD" (at most 31). */
  dates: z.array(isoDateSchema).min(1).max(31),
  status: z.enum(["present", "absent", "half_day", "week_off", "holiday"]),
  /** Leave the days that are already marked alone (default), or overwrite them. */
  overwrite: z.boolean().default(false),
});

export const attendanceMonthSchema = z.object({
  month: payrollMonthSchema,
  departmentId: uuid.optional(),
});

export const holidaySchema = z
  .object({
    date: isoDateSchema,
    name: z.string().trim().min(1, "Enter a name.").max(100),
    scope: z.enum(HOLIDAY_SCOPES).default("national"),
    /** Required for a state holiday. */
    stateCode: z.string().refine(isStateCode, "Choose a state.").nullable().optional(),
    /** Required for a branch holiday (matches the employee's branch). */
    branch: maybe(text(120)),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "state" && !v.stateCode) ctx.addIssue({ code: "custom", path: ["stateCode"], message: "Choose the state this holiday applies to." });
    if (v.scope === "branch" && !v.branch) ctx.addIssue({ code: "custom", path: ["branch"], message: "Enter the branch this holiday applies to." });
  });

export const shiftSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time like 09:30."),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time like 18:00."),
  /** Weekly off weekdays, 0 = Sunday. */
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6).default([0]),
  standardHours: z.number().min(1).max(24).default(8),
});

export const payrollSettingsSchema = z.object({
  /** Default weekly off weekdays (0 = Sunday), used for an employee with no shift. */
  defaultWeeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6),
  standardHoursPerDay: z.number().min(1).max(24),
  overtimeMultiplier: z.number().min(1).max(5),
  /** Month a leave year starts in (4 = April). */
  leaveYearStartMonth: z.number().int().min(1).max(12),
});

// Leave

export const leaveTypeSchema = z.object({
  code: z.string().trim().min(1).max(10).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "Enter a name.").max(60),
  isPaid: z.boolean().default(true),
  accrualType: z.enum(LEAVE_ACCRUAL_TYPES).default("none"),
  /** Days granted per year (annual) or per month (monthly). */
  accrualDays: z.number().min(0).max(366).default(0),
  carryForward: z.boolean().default(false),
  carryForwardMax: z.number().min(0).max(366).default(0),
  encashable: z.boolean().default(false),
});

export const leaveApplySchema = z
  .object({
    employeeId: uuid,
    leaveTypeId: uuid,
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    halfDayStart: z.boolean().default(false),
    halfDayEnd: z.boolean().default(false),
    reason: maybe(text(300)),
  })
  .refine((v) => v.toDate >= v.fromDate, { path: ["toDate"], message: "The end date cannot be before the start date." });

export const leaveEncashSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  days: z.number().positive().max(366),
  /** The amount to pay in rupees. Added to the employee's next payroll run as an earning. */
  amount: z.number().positive().max(1_000_000_000),
  note: maybe(text(200)),
});

// Payroll run

export const runCreateSchema = z.object({ month: payrollMonthSchema });

export const runAdjustmentSchema = z.object({
  runId: uuid,
  employeeId: uuid,
  name: z.string().trim().min(1, "Enter a name.").max(80),
  type: z.enum(["earning", "deduction"]),
  /** Rupees. */
  amount: z.number().positive("Enter an amount above zero.").max(1_000_000_000),
  note: maybe(text(200)),
});

export const markPaidSchema = z.object({
  runId: uuid,
  bankAccountId: uuid,
  paidOn: isoDateSchema,
  reference: maybe(text(100)),
});

// ── Bank payment file (a generic NEFT/RTGS-style CSV) ────────────────────────

export interface BankFileRow {
  employeeCode: string;
  beneficiaryName: string;
  accountNumber: string;
  ifsc: string;
  /** Paise. */
  amountPaise: number;
  narration: string;
}

export const BANK_FILE_HEADER = ["Sr No", "Employee Code", "Beneficiary Name", "Account Number", "IFSC", "Amount (INR)", "Payment Mode", "Narration"] as const;

/** NEFT up to ₹2,00,000 a transfer, RTGS above (the usual retail limits; banks differ). */
export const RTGS_MIN_PAISE = 200_000_00;

/** A cell that cannot run as a spreadsheet formula and is safe inside a CSV. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The bank payment file: one row per employee with net pay above zero. A
 * generic NEFT/RTGS-style CSV, NOT any particular bank's upload format: check
 * the column layout your bank asks for and rearrange it if needed.
 */
export function buildBankPaymentCsv(rows: readonly BankFileRow[]): { csv: string; count: number; totalPaise: number; skipped: string[] } {
  const skipped: string[] = [];
  const lines: string[] = [BANK_FILE_HEADER.map(csvCell).join(",")];
  let n = 0;
  let total = 0;
  for (const r of rows) {
    if (r.amountPaise <= 0) continue;
    if (!r.accountNumber || !r.ifsc) {
      skipped.push(r.employeeCode);
      continue;
    }
    n += 1;
    total += r.amountPaise;
    const rupees = `${Math.floor(r.amountPaise / 100)}.${String(r.amountPaise % 100).padStart(2, "0")}`;
    lines.push(
      [n, r.employeeCode, r.beneficiaryName, r.accountNumber, r.ifsc, rupees, r.amountPaise >= RTGS_MIN_PAISE ? "RTGS" : "NEFT", r.narration]
        .map(csvCell)
        .join(","),
    );
  }
  return { csv: `${lines.join("\r\n")}\r\n`, count: n, totalPaise: total, skipped };
}

// ── Payslip ──────────────────────────────────────────────────────────────────

/** "PS-2026-10-E001" style payslip number: month and employee code. */
export function payslipNumber(month: string, employeeCode: string): string {
  return `PS-${month}-${employeeCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "EMP"}`;
}

/**
 * The note on the salary screen about statutory deductions. They are not salary
 * components: each payroll run calculates them from the Statutory settings. Only
 * the schemes the business is registered for are named, so a business without PF
 * never sees PF mentioned.
 */
export function payrollStatutoryNote(reg: { pf: boolean; esi: boolean; pt: boolean; lwf: boolean; tds: boolean }): string {
  const names = [reg.pf ? "provident fund" : null, reg.esi ? "ESI" : null, reg.pt ? "professional tax" : null, reg.lwf ? "labour welfare fund" : null, reg.tds ? "income-tax TDS" : null].filter(Boolean) as string[];
  if (names.length === 0) {
    return "Statutory deductions (for example ESI, professional tax and income-tax TDS) are calculated automatically in each payroll run once you turn them on in Statutory settings. Do not add them here as deductions.";
  }
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Statutory deductions (${list}) are calculated automatically in each payroll run from your Statutory settings. Do not add them here as components or manual deductions.`;
}
