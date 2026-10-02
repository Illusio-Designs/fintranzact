/**
 * tds-reminders.ts — what TDS / TCS deposits and returns are coming up or
 * overdue for a business.
 *
 * The date arithmetic is pure (depositsDueFromMonths, buildReminderItems,
 * reminderOffset, reminderEmail) and the due dates themselves come from the
 * shared helpers, never recomputed here. loadTdsReminders reads the books.
 * Due dates are the current rules, not advice: verify them with your CA.
 */

import { and, eq, sql } from "drizzle-orm";
import { taxDeductions, type TenantDatabase } from "@fintranzact/db";
import {
  formatIstDate,
  istDateParts,
  istStartOfDay,
  money,
  tcsDepositDueDate,
  tcsReturnDueDate,
  tdsDepositDueDate,
  tdsFinancialYear,
  tdsReturnDueDate,
} from "@fintranzact/shared";

export type TaxKind = "tds" | "tcs";
type Quarter = 1 | 2 | 3 | 4;

/** Deposit and return due dates differ between TDS and TCS (no March exception; 27EQ dates). */
export const depositDue = (kind: TaxKind, d: Date | string) => (kind === "tcs" ? tcsDepositDueDate(d) : tdsDepositDueDate(d));
export const returnDue = (kind: TaxKind, fy: string, q: Quarter) => (kind === "tcs" ? tcsReturnDueDate(fy, q) : tdsReturnDueDate(fy, q));

export interface DepositDue {
  month: string;
  pending: string;
  dueDate: Date;
  overdue: boolean;
}

/**
 * Tax still to deposit by the month it was deducted, with the day it is due.
 * `byMonth` is the pending (not on a challan) total per "YYYY-MM".
 */
export function depositsDueFromMonths(
  kind: TaxKind,
  byMonth: Array<{ month: string; pending: string }>,
  now: number = Date.now(),
): DepositDue[] {
  return byMonth
    .filter((m) => money.isPositive(m.pending))
    .map((m) => {
      const dueDate = depositDue(kind, `${m.month}-15T12:00:00+05:30`);
      return { month: m.month, pending: m.pending, dueDate, overdue: dueDate.getTime() < now };
    });
}

export interface ReminderItem {
  /** Stable per due item, e.g. "deposit:tds:2026-27:2026-09". */
  key: string;
  type: "deposit" | "return";
  kind: TaxKind;
  title: string;
  /** Rupees: tax to deposit, or the quarter's total tax for a return. */
  amount: string;
  dueDate: Date;
  /** Whole days from today (India) to the due date; negative once overdue. */
  daysUntil: number;
  overdue: boolean;
  financialYear: string;
}

const KIND_LABEL: Record<TaxKind, string> = { tds: "TDS", tcs: "TCS" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole calendar days from `now` to `due` by the Indian calendar. */
export function daysUntil(due: Date, now: Date): number {
  const { year, month, day } = istDateParts(now);
  return Math.round((due.getTime() - istStartOfDay(year, month, day).getTime()) / 86_400_000);
}

/** The reminder day-offset for an item: 7 (within a week), 0 (today), -1 (overdue), or null (too early). */
export function reminderOffset(days: number): 7 | 0 | -1 | null {
  if (days < 0) return -1;
  if (days === 0) return 0;
  return days <= 7 ? 7 : null;
}

export interface ReminderInput {
  kind: TaxKind;
  financialYear: string;
  depositsDue: Array<{ month: string; pending: string; dueDate: Date }>;
  /** Quarters with tax deducted/collected, and the tax in them. */
  quarters: Array<{ quarter: Quarter; total: string }>;
}

/**
 * Upcoming and overdue items, soonest first. Deposits come from depositsDue;
 * a return is listed for every quarter that has tax in it (the books do not
 * know whether it was filed). Items further than `horizonDays` away are left
 * out, and returns more than `returnGraceDays` overdue stop being listed.
 */
export function buildReminderItems(
  inputs: ReminderInput[],
  now: Date = new Date(),
  { horizonDays = 14, returnGraceDays = 60 }: { horizonDays?: number; returnGraceDays?: number } = {},
): ReminderItem[] {
  const out: ReminderItem[] = [];
  for (const inp of inputs) {
    const label = KIND_LABEL[inp.kind];
    for (const d of inp.depositsDue) {
      const days = daysUntil(d.dueDate, now);
      if (days > horizonDays) continue;
      const [y, m] = d.month.split("-").map(Number);
      out.push({
        key: `deposit:${inp.kind}:${inp.financialYear}:${d.month}`,
        type: "deposit", kind: inp.kind,
        title: `${label} deducted in ${MONTHS[m! - 1]} ${y} to deposit`,
        amount: d.pending, dueDate: d.dueDate, daysUntil: days, overdue: days < 0, financialYear: inp.financialYear,
      });
    }
    for (const q of inp.quarters) {
      if (!money.isPositive(q.total)) continue;
      const dueDate = returnDue(inp.kind, inp.financialYear, q.quarter);
      const days = daysUntil(dueDate, now);
      if (days > horizonDays || days < -returnGraceDays) continue;
      out.push({
        key: `return:${inp.kind}:${inp.financialYear}:Q${q.quarter}`,
        type: "return", kind: inp.kind,
        title: `${label} return for Q${q.quarter} FY ${inp.financialYear}`,
        amount: q.total, dueDate, daysUntil: days, overdue: days < 0, financialYear: inp.financialYear,
      });
    }
  }
  return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.key.localeCompare(b.key));
}

/** What is still to deposit and which quarters have tax, for one ledger and year, from the books. */
async function loadYear(db: TenantDatabase, businessId: string, kind: TaxKind, fy: string): Promise<ReminderInput> {
  const base = and(
    eq(taxDeductions.businessId, businessId),
    eq(taxDeductions.kind, kind),
    eq(taxDeductions.direction, "payable"),
    eq(taxDeductions.financialYear, fy),
  );
  const [byMonth, byQuarter] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${taxDeductions.deductedOn} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`,
        pending: sql<string>`COALESCE(SUM(${taxDeductions.amount}) FILTER (WHERE ${taxDeductions.challanId} IS NULL), 0.00)::text`,
      })
      .from(taxDeductions)
      .where(base)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ quarter: taxDeductions.quarter, total: sql<string>`COALESCE(SUM(${taxDeductions.amount}), 0.00)::text` })
      .from(taxDeductions)
      .where(base)
      .groupBy(taxDeductions.quarter),
  ]);
  return {
    kind,
    financialYear: fy,
    depositsDue: depositsDueFromMonths(kind, byMonth),
    quarters: byQuarter.map((q) => ({ quarter: q.quarter as Quarter, total: q.total })),
  };
}

/**
 * Upcoming and overdue TDS and TCS items for a business: this financial year
 * and the last (the Q4 return and March deposits fall due in the new year).
 */
export async function loadTdsReminders(db: TenantDatabase, businessId: string, now: Date = new Date()): Promise<ReminderItem[]> {
  const fy = tdsFinancialYear(now);
  const start = parseInt(fy.slice(0, 4), 10);
  const prev = `${start - 1}-${String(start % 100).padStart(2, "0")}`;
  const inputs = await Promise.all(
    (["tds", "tcs"] as const).flatMap((kind) => [fy, prev].map((y) => loadYear(db, businessId, kind, y))),
  );
  return buildReminderItems(inputs, now);
}

/** Subject and plain-text body of the reminder email for the items that just came due. */
export function reminderEmail(businessName: string, items: ReminderItem[]): { subject: string; text: string } {
  const overdue = items.filter((i) => i.overdue).length;
  const subject = overdue
    ? `${overdue} TDS/TCS item${overdue > 1 ? "s" : ""} overdue for ${businessName}`
    : `TDS/TCS due dates coming up for ${businessName}`;
  const lines = items.map((i) => {
    const when = i.daysUntil < 0
      ? `${-i.daysUntil} day${i.daysUntil === -1 ? "" : "s"} overdue`
      : i.daysUntil === 0 ? "due today" : `due in ${i.daysUntil} day${i.daysUntil === 1 ? "" : "s"}`;
    const verb = i.type === "deposit" ? `Rs ${i.amount} to deposit` : `Rs ${i.amount} tax in the quarter`;
    return `- ${i.title}: ${verb}, by ${formatIstDate(i.dueDate)} (${when})`;
  });
  const text = [
    `Hi,`,
    "",
    `These TDS/TCS items for ${businessName} need attention:`,
    "",
    ...lines,
    "",
    "Open TDS in Fintranzact to record the challan or prepare the return data.",
    "",
    "These dates follow the usual due dates under current rules. Please verify due dates with your CA.",
    "",
    "The Fintranzact team",
  ].join("\n");
  return { subject, text };
}
