/**
 * Gratuity (Payroll Phase 4): the eligibility and liability estimate for the people who work for the business today, the
 * on-demand provision journal, and the helpers the full and final settlement uses.
 *
 * The formula is in @fintranzact/shared (computeGratuityFull): last drawn Basic + DA x 15 / 26 x years of service. The
 * last drawn wages are the monthly Basic + DA of the latest salary assignment effective on or before the date. Tax on
 * gratuity is NOT computed. The provision is report-first: nothing is posted unless someone presses "Post provision",
 * which books the difference between the liability on the date and the balance of 2441 Gratuity Provision, so posting it
 * twice does nothing the second time.
 */

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  employeeSalaryAssignments,
  employees,
  gratuityProvisions,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  computeGratuityFull,
  fyStartYearOfMonth,
  gratuityLiability,
  paiseToRupees,
  rupeesToPaise,
  type GratuityEstimateRow,
  type StatutoryRates,
} from "@fintranzact/shared";
import { assertPeriodOpen } from "../period-lock.js";
import { badRequest } from "./access.js";
import { accountCreditBalancePaise, bookDate, ensurePayrollAccounts, writeJournalEntry } from "./books.js";
import { loadStatutoryRates } from "./statutory.js";
import type { Actor } from "./run.js";

type Reader = Pick<TenantDatabase, "select">;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface SalaryBasis {
  basicDaPaise: number;
  grossPaise: number;
}

/** The monthly Basic + DA and gross of each employee's latest salary assignment effective on or before `asOf`. */
export async function salaryBasisOf(db: Reader, businessId: string, employeeIds: string[], asOf: string): Promise<Map<string, SalaryBasis>> {
  const out = new Map<string, SalaryBasis>();
  if (employeeIds.length === 0) return out;
  const rows = await db
    .select()
    .from(employeeSalaryAssignments)
    .where(and(eq(employeeSalaryAssignments.businessId, businessId), inArray(employeeSalaryAssignments.employeeId, employeeIds), lte(employeeSalaryAssignments.effectiveFrom, asOf)))
    .orderBy(desc(employeeSalaryAssignments.effectiveFrom), desc(employeeSalaryAssignments.createdAt));
  for (const a of rows) {
    if (out.has(a.employeeId)) continue;
    let basicDa = 0;
    let gross = 0;
    for (const b of a.breakdown) {
      if (b.type !== "earning") continue;
      const m = rupeesToPaise(b.monthly);
      gross += m;
      if (b.category === "basic" || b.category === "da") basicDa += m;
    }
    out.set(a.employeeId, { basicDaPaise: basicDa, grossPaise: gross });
  }
  return out;
}

export interface GratuityEstimate {
  asOf: string;
  financialYear: number;
  rules: StatutoryRates["gratuity"];
  rows: Array<GratuityEstimateRow & { hasSalary: boolean }>;
  payableTodayPaise: number;
  ifEligiblePaise: number;
  eligibleCount: number;
}

/** What each active employee would receive if they left on `asOf`, and the sum (the liability today). */
export async function estimateGratuity(db: Reader, businessId: string, asOf: string): Promise<GratuityEstimate> {
  const fy = fyStartYearOfMonth(asOf.slice(0, 7));
  const loaded = await loadStatutoryRates(db, businessId, fy);
  const emps = await db.select().from(employees).where(and(eq(employees.businessId, businessId), eq(employees.status, "active"))).orderBy(asc(employees.employeeCode));
  const basis = await salaryBasisOf(db, businessId, emps.map((e) => e.id), asOf);
  const rows = emps
    .filter((e) => e.dateOfJoining <= asOf)
    .map((e) => {
      const wages = basis.get(e.id)?.basicDaPaise ?? 0;
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: e.name,
        joinedOn: e.dateOfJoining,
        employmentType: e.employmentType,
        lastDrawnWagesPaise: wages,
        hasSalary: basis.has(e.id),
        detail: computeGratuityFull({ joinedOn: e.dateOfJoining, endOn: asOf, lastDrawnWagesPaise: wages, employmentType: e.employmentType, rules: loaded.rates.gratuity }),
      };
    });
  const l = gratuityLiability(rows);
  return { asOf, financialYear: fy, rules: loaded.rates.gratuity, rows, ...l };
}

/** The gratuity provision in the books: credits less debits on 2441, paise. */
export async function provisionBalancePaise(tx: Tx, businessId: string): Promise<number> {
  return accountCreditBalancePaise(tx, businessId, "gratuity_provision");
}

/**
 * Post the provision: Dr 5205 Salary - Gratuity / Cr 2441 Gratuity Provision for the increase in the liability (the other way round
 * for a decrease). Does nothing when the books already show the liability.
 */
export async function postGratuityProvision(
  db: TenantDatabase,
  input: { businessId: string; asOf: string; note?: string | null; actor: Actor },
): Promise<{ id: string; amountPaise: number; liabilityPaise: number; previousPaise: number; journalEntryId: string }> {
  await assertPeriodOpen(db, input.businessId, [input.asOf]);
  return db.transaction(async (tx) => {
    // One provision at a time per business, so two clicks cannot both post the same increase.
    await tx.execute(sqlLock(input.businessId));
    const est = await estimateGratuity(tx, input.businessId, input.asOf);
    const previous = await provisionBalancePaise(tx, input.businessId);
    const delta = est.payableTodayPaise - previous;
    if (delta === 0) throw badRequest("The gratuity provision in the books already equals the liability on that date. Nothing to post.");
    const acc = await ensurePayrollAccounts(tx, input.businessId, ["gratuity_expense", "gratuity_provision"]);
    const abs = Math.abs(delta);
    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(input.asOf),
      narration: `Gratuity provision as on ${input.asOf}`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines:
        delta > 0
          ? [
              { accountId: acc.gratuity_expense!, debitPaise: abs, creditPaise: 0, narration: "Gratuity provision" },
              { accountId: acc.gratuity_provision!, debitPaise: 0, creditPaise: abs, narration: "Gratuity provision" },
            ]
          : [
              { accountId: acc.gratuity_provision!, debitPaise: abs, creditPaise: 0, narration: "Gratuity provision written back" },
              { accountId: acc.gratuity_expense!, debitPaise: 0, creditPaise: abs, narration: "Gratuity provision written back" },
            ],
    });
    const [row] = await tx
      .insert(gratuityProvisions)
      .values({
        businessId: input.businessId,
        asOf: input.asOf,
        liability: paiseToRupees(est.payableTodayPaise),
        previousBalance: paiseToRupees(previous),
        amount: paiseToRupees(delta),
        employeeCount: est.eligibleCount,
        note: input.note || null,
        journalEntryId: entry.id,
        createdByUserId: input.actor.id,
        createdByName: input.actor.name,
      })
      .returning({ id: gratuityProvisions.id });
    return { id: row!.id, amountPaise: delta, liabilityPaise: est.payableTodayPaise, previousPaise: previous, journalEntryId: entry.id };
  });
}

function sqlLock(businessId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`payroll4:gratuity:${businessId}`}))`;
}

export async function provisionHistory(db: Reader, businessId: string) {
  return db.select().from(gratuityProvisions).where(eq(gratuityProvisions.businessId, businessId)).orderBy(desc(gratuityProvisions.createdAt)).limit(50);
}
