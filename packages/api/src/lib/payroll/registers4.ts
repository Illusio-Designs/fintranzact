/**
 * Extra labour-law style registers (Payroll Phase 4), reformatted from data the app already holds:
 *   employment  - the register of employees (joining, designation, exit);
 *   deductions  - deductions from wages (other than the statutory ones), and loans and advances given and recovered;
 *   overtime    - overtime hours and pay by month;
 *   fnf         - full and final settlements.
 * They are WORKING COPIES for CA or legal review. Formats differ by state and by Act (Shops and Establishments, Contract
 * Labour...): none of these is a statutory form and none claims compliance.
 */

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  employeeLoanEvents,
  employeeLoans,
  employees,
  fnfSettlements,
  payrollDepartments,
  payrollDesignations,
  payrollRunLines,
  payrollRuns,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  buildDeductionsRegister,
  buildEmploymentRegister,
  buildFnfRegister,
  buildOvertimeRegister,
  fyLabel,
  monthsOfFy,
  rupeesToPaise,
  type DeductionRegisterRow,
} from "@fintranzact/shared";

const FINAL = ["approved", "posted", "paid"];

export interface RegisterFile {
  filename: string;
  contentType: "text/csv";
  text: string;
  count: number;
  /** Printed above the register in the app and repeated in the docs. */
  note: string;
}

export const WORKING_COPY_NOTE = "Working copy for CA or legal review. Formats differ by state and by Act; this is not a statutory form.";

export async function buildEmploymentRegisterFile(db: TenantDatabase, businessId: string): Promise<RegisterFile> {
  const [emps, desigs, depts] = await Promise.all([
    db.select().from(employees).where(eq(employees.businessId, businessId)).orderBy(asc(employees.employeeCode)),
    db.select().from(payrollDesignations).where(eq(payrollDesignations.businessId, businessId)),
    db.select().from(payrollDepartments).where(eq(payrollDepartments.businessId, businessId)),
  ]);
  const desig = new Map(desigs.map((d) => [d.id, d.name]));
  const dept = new Map(depts.map((d) => [d.id, d.name]));
  const text = buildEmploymentRegister(
    emps.map((e) => ({
      employeeCode: e.employeeCode,
      name: e.name,
      fatherOrSpouse: e.fatherOrSpouseName,
      gender: e.gender,
      dateOfBirth: e.dateOfBirth,
      designation: e.designationId ? desig.get(e.designationId) ?? null : null,
      department: e.departmentId ? dept.get(e.departmentId) ?? null : null,
      employmentType: e.employmentType,
      joinedOn: e.dateOfJoining,
      status: e.status,
      lastWorkingDay: e.lastWorkingDay,
      exitReason: e.exitReason,
    })),
  );
  return { filename: "employment-register.csv", contentType: "text/csv", text, count: emps.length, note: WORKING_COPY_NOTE };
}

export async function buildDeductionsRegisterFile(db: TenantDatabase, businessId: string, fy: number): Promise<RegisterFile> {
  const months = monthsOfFy(fy);
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.businessId, businessId), inArray(payrollRuns.month, months), inArray(payrollRuns.status, FINAL)));
  const lines = runs.length ? await db.select().from(payrollRunLines).where(inArray(payrollRunLines.runId, runs.map((r) => r.id))) : [];
  const monthOfRun = new Map(runs.map((r) => [r.id, r.month]));
  const rows: DeductionRegisterRow[] = [];
  for (const l of lines) {
    for (const c of l.components) {
      // Statutory deductions (PF, ESI, PT, TDS, LWF) have their own registers and files; loan instalments are listed from the loan log below.
      if (c.type !== "deduction" || c.statutoryKind || c.source === "statutory" || c.source === "loan") continue;
      const amount = rupeesToPaise(c.amount);
      if (amount > 0) rows.push({ period: monthOfRun.get(l.runId)!, employeeCode: l.employeeCode, name: l.employeeName, kind: "deduction", description: c.name, amountPaise: amount });
    }
  }
  const start = `${fy}-04-01`;
  const end = `${fy + 1}-03-31`;
  const events = await db
    .select({ e: employeeLoanEvents, loanNumber: employeeLoans.number, kind: employeeLoans.kind, code: employees.employeeCode, name: employees.name })
    .from(employeeLoanEvents)
    .innerJoin(employeeLoans, eq(employeeLoans.id, employeeLoanEvents.loanId))
    .innerJoin(employees, eq(employees.id, employeeLoanEvents.employeeId))
    .where(and(eq(employeeLoanEvents.businessId, businessId), gte(employeeLoanEvents.eventDate, start), lte(employeeLoanEvents.eventDate, end), inArray(employeeLoanEvents.kind, ["disbursed", "emi_recovered", "prepaid", "foreclosed", "fnf_recovered", "fnf_reversed"])));
  for (const ev of events) {
    const label = ev.kind === "advance" ? "Advance" : "Loan";
    if (ev.e.kind === "disbursed") {
      rows.push({ period: ev.e.eventDate, employeeCode: ev.code, name: ev.name, kind: "advance_given", description: `${label} ${ev.loanNumber}`, amountPaise: rupeesToPaise(ev.e.balanceAfter) });
    } else {
      // A reversed settlement puts its recovery back: shown as a negative recovery so the register nets to what was kept.
      const sign = ev.e.kind === "fnf_reversed" ? -1 : 1;
      const amount = sign * (rupeesToPaise(ev.e.principal) + rupeesToPaise(ev.e.interest));
      if (amount !== 0) rows.push({ period: ev.e.eventDate, employeeCode: ev.code, name: ev.name, kind: "loan_recovery", description: `${label} ${ev.loanNumber} (${ev.e.kind.replace(/_/g, " ")})`, amountPaise: amount });
    }
  }
  rows.sort((a, b) => a.period.localeCompare(b.period) || a.employeeCode.localeCompare(b.employeeCode));
  return { filename: `deductions-register-${fyLabel(fy)}.csv`, contentType: "text/csv", text: buildDeductionsRegister(rows), count: rows.length, note: WORKING_COPY_NOTE };
}

export async function buildOvertimeRegisterFile(db: TenantDatabase, businessId: string, fy: number): Promise<RegisterFile> {
  const months = monthsOfFy(fy);
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.businessId, businessId), inArray(payrollRuns.month, months), inArray(payrollRuns.status, FINAL)));
  const lines = runs.length ? await db.select().from(payrollRunLines).where(inArray(payrollRunLines.runId, runs.map((r) => r.id))) : [];
  const monthOfRun = new Map(runs.map((r) => [r.id, r.month]));
  const rows = lines
    .filter((l) => Number(l.overtimeHours) > 0)
    .map((l) => ({
      month: monthOfRun.get(l.runId)!,
      employeeCode: l.employeeCode,
      name: l.employeeName,
      hours: Number(l.overtimeHours).toString(),
      amountPaise: l.components.filter((c) => c.category === "overtime" && c.type === "earning").reduce((s, c) => s + rupeesToPaise(c.amount), 0),
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.employeeCode.localeCompare(b.employeeCode));
  return { filename: `overtime-register-${fyLabel(fy)}.csv`, contentType: "text/csv", text: buildOvertimeRegister(rows), count: rows.length, note: WORKING_COPY_NOTE };
}

export async function buildFnfRegisterFile(db: TenantDatabase, businessId: string, fy: number): Promise<RegisterFile> {
  const start = `${fy}-04-01`;
  const end = `${fy + 1}-03-31`;
  const rows = await db
    .select({ s: fnfSettlements, code: employees.employeeCode, name: employees.name })
    .from(fnfSettlements)
    .innerJoin(employees, eq(employees.id, fnfSettlements.employeeId))
    .where(and(eq(fnfSettlements.businessId, businessId), gte(fnfSettlements.lastWorkingDay, start), lte(fnfSettlements.lastWorkingDay, end)))
    .orderBy(asc(fnfSettlements.number));
  const text = buildFnfRegister(
    rows.map((r) => ({
      number: r.s.number,
      employeeCode: r.code,
      name: r.name,
      lastWorkingDay: r.s.lastWorkingDay,
      status: r.s.status.replace(/_/g, " "),
      grossPaise: rupeesToPaise(r.s.grossTotal),
      deductionsPaise: rupeesToPaise(r.s.deductionsTotal),
      netPaise: rupeesToPaise(r.s.netPayable),
      paidOn: r.s.paidOn,
    })),
  );
  return { filename: `fnf-register-${fyLabel(fy)}.csv`, contentType: "text/csv", text, count: rows.length, note: WORKING_COPY_NOTE };
}
