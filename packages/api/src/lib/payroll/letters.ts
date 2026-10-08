/**
 * Relieving letters (Payroll Phase 4): the wording is a per-business template with placeholders ({{employee_name}}...),
 * the letter is drawn as a PDF on demand for an employee who has left. Nothing is stored from a generated letter (the audit
 * log records who generated which letter). No digital signature is claimed: the signature line is blank, or carries the
 * signature image the owner uploaded to the business.
 */

import { and, eq } from "drizzle-orm";
import {
  businesses,
  employees,
  payrollDepartments,
  payrollDesignations,
  payrollLetterTemplates,
  type TenantDatabase,
} from "@fintranzact/db";
import { DEFAULT_RELIEVING_LETTER_BODY, istDateParts, renderLetterBody, type LetterKind } from "@fintranzact/shared";
import { badRequest, notFound } from "./access.js";
import { fmtDay, generateLetterPDF } from "./phase4-pdf.js";

type Reader = Pick<TenantDatabase, "select">;

export interface LetterTemplateView {
  kind: LetterKind;
  title: string;
  body: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  place: string | null;
  isDefault: boolean;
  updatedAt: Date | null;
}

export async function getLetterTemplate(db: Reader, businessId: string, kind: LetterKind = "relieving"): Promise<LetterTemplateView> {
  const [row] = await db.select().from(payrollLetterTemplates).where(and(eq(payrollLetterTemplates.businessId, businessId), eq(payrollLetterTemplates.kind, kind))).limit(1);
  if (!row) return { kind, title: "Relieving Letter", body: DEFAULT_RELIEVING_LETTER_BODY, signatoryName: null, signatoryTitle: null, place: null, isDefault: true, updatedAt: null };
  return { kind, title: row.title, body: row.body, signatoryName: row.signatoryName, signatoryTitle: row.signatoryTitle, place: row.place, isDefault: false, updatedAt: row.updatedAt };
}

export async function saveLetterTemplate(
  db: TenantDatabase,
  input: { businessId: string; userId: string; kind: LetterKind; title: string; body: string; signatoryName?: string | null; signatoryTitle?: string | null; place?: string | null },
): Promise<LetterTemplateView> {
  const values = {
    businessId: input.businessId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    signatoryName: input.signatoryName || null,
    signatoryTitle: input.signatoryTitle || null,
    place: input.place || null,
    updatedByUserId: input.userId,
    updatedAt: new Date(),
  };
  await db.insert(payrollLetterTemplates).values(values).onConflictDoUpdate({ target: [payrollLetterTemplates.businessId, payrollLetterTemplates.kind], set: values });
  return getLetterTemplate(db, input.businessId, input.kind);
}

/** The relieving letter of an employee who has left, as a PDF. */
export async function generateRelievingLetter(db: TenantDatabase, businessId: string, employeeId: string): Promise<{ filename: string; pdf: Buffer; employeeCode: string }> {
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId))).limit(1);
  if (!emp) throw notFound("Employee");
  if (emp.status !== "exited" || !emp.lastWorkingDay) throw badRequest("A relieving letter is available once the employee's exit is recorded.");
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw notFound("Business");
  const [desig, dept, tpl] = await Promise.all([
    emp.designationId ? db.select({ n: payrollDesignations.name }).from(payrollDesignations).where(eq(payrollDesignations.id, emp.designationId)).limit(1) : Promise.resolve([]),
    emp.departmentId ? db.select({ n: payrollDepartments.name }).from(payrollDepartments).where(eq(payrollDepartments.id, emp.departmentId)).limit(1) : Promise.resolve([]),
    getLetterTemplate(db, businessId),
  ]);
  const p = istDateParts(new Date());
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const company = biz.legalName || biz.name;
  const body = renderLetterBody(tpl.body, {
    employee_name: emp.name,
    employee_code: emp.employeeCode,
    designation: desig[0]?.n ?? null,
    department: dept[0]?.n ?? null,
    date_of_joining: fmtDay(emp.dateOfJoining),
    last_working_day: fmtDay(emp.lastWorkingDay),
    company_name: company,
    letter_date: fmtDay(today),
  });
  const pdf = await generateLetterPDF(
    {
      business: { name: biz.name, legalName: biz.legalName, address: biz.address, city: biz.city, state: biz.state, pincode: biz.pincode, phone: biz.phone, email: biz.email },
      title: tpl.title,
      body,
      dateText: fmtDay(today),
      place: tpl.place,
      subject: `${emp.name} (${emp.employeeCode})`,
      signatoryName: tpl.signatoryName,
      signatoryTitle: tpl.signatoryTitle,
    },
    { logo: biz.logoData ?? null, signature: biz.signatureData ?? null },
  );
  return { filename: `relieving-letter-${emp.employeeCode}.pdf`, pdf, employeeCode: emp.employeeCode };
}
