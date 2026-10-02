/**
 * year-close.ts — what a financial year closes with, and what the next year
 * opens with.
 *
 * The books are continuous: balance-sheet accounts, stock and party balances
 * already run on from one year to the next, and income / expense start again at
 * zero. Closing a year freezes that picture so it can be shown and checked:
 *   ledger        every account's cumulative balance at year end, the year's
 *                 profit, and a balanced set of opening balances for the next
 *                 year (the profit to date is carried into retained earnings)
 *   stock         value and quantity of every item at year end
 *   outstanding   what each customer owes and what is owed to each supplier
 * The close also locks the books through the year end (see period-lock.ts), so
 * the snapshot stays true.
 */

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { chartOfAccounts, invoices } from "@fintranzact/db";
import { financialYearLabel, financialYearRange, money } from "@fintranzact/shared";
import { deriveFullLedger } from "./derive-ledger.js";
import { valueStock } from "./stock-valuation.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface SnapshotAccount {
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
  /** debit − credit */
  net: string;
}

export interface OpeningBalance {
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
}

export interface YearCloseSnapshot {
  version: 1;
  financialYear: string;
  /** First and last instant of the year (ISO). */
  from: string;
  to: string;
  ledger: {
    /** Every account, cumulative from the beginning to the year end. */
    accounts: SnapshotAccount[];
    yearIncome: string;
    yearExpense: string;
    /** Profit (or loss) of this year alone. */
    yearProfit: string;
    /** Profit (or loss) of all years to date: what retained earnings carries. */
    profitToDate: string;
  };
  /** What the next year opens with: balance-sheet accounts, with the profit to date in retained earnings. Balanced. */
  openingBalances: OpeningBalance[];
  stock: {
    method: string;
    totalValue: string;
    itemCount: number;
    units: Array<{ itemId: string; variantId: string | null; quantity: number; rate: number; value: number }>;
  };
  outstanding: {
    /** What customers owe (positive balances). */
    receivable: string;
    /** What is owed to suppliers (negative balances, shown positive). */
    payable: string;
    parties: Array<{ partyId: string; name: string; type: string; balance: string }>;
  };
  counts: { invoices: number; payments: number; expenses: number };
}

const EPOCH = new Date("2000-01-01T00:00:00Z");

/** The financial year starting in `startYear` for a business whose year starts in `startMonth`. */
export function yearBounds(startYear: number, startMonth: number) {
  const { from, to } = financialYearRange(startYear, startMonth);
  return { from, to, label: financialYearLabel(startYear) };
}

/** Start year of a label like "2025-26". */
export function startYearOf(label: string): number {
  return parseInt(label.slice(0, 4), 10);
}

type Totals = Map<string, { debit: string; credit: string }>;

function addLines(entries: Awaited<ReturnType<typeof deriveFullLedger>>): Totals {
  const m: Totals = new Map();
  for (const e of entries) {
    for (const l of e.lines) {
      const cur = m.get(l.accountCode) ?? { debit: "0.00", credit: "0.00" };
      cur.debit = money.add(cur.debit, l.debit);
      cur.credit = money.add(cur.credit, l.credit);
      m.set(l.accountCode, cur);
    }
  }
  return m;
}

/**
 * Balance-sheet accounts' closing balances as the next year's opening balances.
 * Income and expense do not carry over: their net (the profit to date) goes to
 * retained earnings (3200), added to whatever that account already holds.
 */
export function openingBalancesFrom(accounts: SnapshotAccount[], profitToDate: string): OpeningBalance[] {
  const out = new Map<string, OpeningBalance>();
  for (const a of accounts) {
    if (a.type !== "asset" && a.type !== "liability" && a.type !== "equity") continue;
    const net = parseFloat(a.net);
    if (Math.abs(net) < 0.005) continue;
    out.set(a.code, {
      code: a.code, name: a.name, type: a.type,
      debit: net > 0 ? a.net : "0.00",
      credit: net < 0 ? money.sub("0", a.net) : "0.00",
    });
  }
  const profit = parseFloat(profitToDate);
  if (Math.abs(profit) >= 0.005) {
    const cur = out.get("3200") ?? { code: "3200", name: "Retained Earnings", type: "equity", debit: "0.00", credit: "0.00" };
    // net (debit − credit) of retained earnings falls by the profit
    const net = money.sub(money.sub(cur.debit, cur.credit), profitToDate);
    out.set("3200", { ...cur, debit: parseFloat(net) > 0 ? net : "0.00", credit: parseFloat(net) < 0 ? money.sub("0", net) : "0.00" });
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export async function buildYearCloseSnapshot(
  db: Db,
  businessId: string,
  year: { label: string; from: Date; to: Date },
): Promise<YearCloseSnapshot> {
  // ── Ledger ───────────────────────────────────────────────────
  const coa: Array<{ code: string; name: string; accountType: string }> = await db
    .select({ code: chartOfAccounts.code, name: chartOfAccounts.name, accountType: chartOfAccounts.accountType })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.businessId, businessId));
  const coaByCode = new Map(coa.map((a) => [a.code, a]));

  const cumulative = addLines(await deriveFullLedger(db, businessId, EPOCH, year.to));
  const inYear = addLines(await deriveFullLedger(db, businessId, year.from, year.to));

  const accounts: SnapshotAccount[] = [...cumulative.entries()]
    .map(([code, t]) => ({
      code,
      name: coaByCode.get(code)?.name ?? code,
      type: coaByCode.get(code)?.accountType ?? "expense",
      debit: t.debit,
      credit: t.credit,
      net: money.sub(t.debit, t.credit),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const profitOf = (totals: Totals) => {
    let income = "0.00";
    let expense = "0.00";
    for (const [code, t] of totals) {
      const type = coaByCode.get(code)?.accountType;
      if (type === "income") income = money.add(income, money.sub(t.credit, t.debit));
      else if (type === "expense") expense = money.add(expense, money.sub(t.debit, t.credit));
    }
    return { income, expense, profit: money.sub(income, expense) };
  };
  const year$ = profitOf(inYear);
  const toDate$ = profitOf(cumulative);

  // ── Stock ────────────────────────────────────────────────────
  const valuation = await valueStock(db, businessId, year.to);
  const units = [...valuation.units.values()]
    .filter((u) => Math.abs(u.quantity) > 0.0005)
    .map((u) => ({ itemId: u.itemId, variantId: u.variantId, quantity: u.quantity, rate: u.rate, value: u.value }));

  // ── What each party owes / is owed, at the year end ──────────
  const rows: Array<{ id: string; name: string; type: string; balance: string }> = await db.execute(sql`
    WITH e AS (
      SELECT party_id, total_amount::numeric AS amt, invoice_date AS d
        FROM invoices WHERE business_id = ${businessId} AND document_type = 'invoice' AND type = 'sale'
          AND status <> 'cancelled' AND deleted_at IS NULL
      UNION ALL
      SELECT party_id, -total_amount::numeric, invoice_date
        FROM invoices WHERE business_id = ${businessId} AND document_type = 'invoice' AND type = 'purchase'
          AND status <> 'cancelled' AND deleted_at IS NULL
      UNION ALL
      SELECT party_id, -total_amount::numeric, invoice_date
        FROM invoices WHERE business_id = ${businessId} AND type = 'sale' AND document_type IN ('credit_note', 'sales_return')
          AND status <> 'cancelled' AND deleted_at IS NULL
      UNION ALL
      SELECT party_id, total_amount::numeric, invoice_date
        FROM invoices WHERE business_id = ${businessId} AND type = 'purchase' AND document_type IN ('credit_note', 'purchase_return', 'debit_note')
          AND status <> 'cancelled' AND deleted_at IS NULL
      UNION ALL
      SELECT party_id, total_amount::numeric, invoice_date
        FROM invoices WHERE business_id = ${businessId} AND type = 'sale' AND document_type = 'debit_note'
          AND status <> 'cancelled' AND deleted_at IS NULL
      UNION ALL
      SELECT pm.party_id, CASE WHEN pt.type = 'supplier' THEN pm.amount::numeric ELSE -pm.amount::numeric END, pm.payment_date
        FROM payments pm JOIN parties pt ON pt.id = pm.party_id
        WHERE pm.business_id = ${businessId} AND pm.deleted_at IS NULL
    )
    SELECT p.id::text AS id, p.name, p.type::text AS type,
           (p.opening_balance::numeric + COALESCE(SUM(e.amt) FILTER (WHERE e.d <= ${year.to.toISOString()}::timestamptz), 0))::text AS balance
      FROM parties p LEFT JOIN e ON e.party_id = p.id
     WHERE p.business_id = ${businessId}
     GROUP BY p.id
  `) as never;
  const partyBalances = (Array.isArray(rows) ? rows : (rows as { rows?: typeof rows }).rows ?? [])
    .filter((r) => Math.abs(parseFloat(r.balance)) >= 0.005)
    .map((r) => ({ partyId: r.id, name: r.name, type: r.type, balance: money.add(r.balance, 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const receivable = money.sum(partyBalances.filter((p) => parseFloat(p.balance) > 0).map((p) => p.balance));
  const payable = money.sum(partyBalances.filter((p) => parseFloat(p.balance) < 0).map((p) => money.sub("0", p.balance)));

  // ── Counts ───────────────────────────────────────────────────
  const [[inv], [pay], [exp]] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = ${businessId} AND deleted_at IS NULL AND status <> 'cancelled' AND invoice_date BETWEEN ${year.from.toISOString()}::timestamptz AND ${year.to.toISOString()}::timestamptz`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM payments WHERE business_id = ${businessId} AND deleted_at IS NULL AND payment_date BETWEEN ${year.from.toISOString()}::timestamptz AND ${year.to.toISOString()}::timestamptz`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM expenses WHERE business_id = ${businessId} AND deleted_at IS NULL AND expense_date BETWEEN ${year.from.toISOString()}::timestamptz AND ${year.to.toISOString()}::timestamptz`),
  ].map(async (p) => {
    const r = (await p) as unknown;
    return (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Array<{ n: number }>;
  }));

  return {
    version: 1,
    financialYear: year.label,
    from: year.from.toISOString(),
    to: year.to.toISOString(),
    ledger: { accounts, yearIncome: year$.income, yearExpense: year$.expense, yearProfit: year$.profit, profitToDate: toDate$.profit },
    openingBalances: openingBalancesFrom(accounts, toDate$.profit),
    stock: { method: valuation.method, totalValue: valuation.total, itemCount: units.length, units },
    outstanding: { receivable, payable, parties: partyBalances },
    counts: { invoices: inv?.n ?? 0, payments: pay?.n ?? 0, expenses: exp?.n ?? 0 },
  };
}

/** Things worth fixing before a year is closed. */
export async function yearCloseWarnings(db: Db, businessId: string, year: { from: Date; to: Date }): Promise<string[]> {
  const [drafts] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(invoices)
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.status, "draft"),
      isNull(invoices.deletedAt),
      gte(invoices.invoiceDate, year.from),
      lte(invoices.invoiceDate, year.to),
    ));
  const warnings: string[] = [];
  if ((drafts?.n ?? 0) > 0) {
    warnings.push(`${drafts.n} draft document${drafts.n === 1 ? " is" : "s are"} dated in this year. Send, cancel or delete ${drafts.n === 1 ? "it" : "them"} first: they can't be changed after the close.`);
  }
  return warnings;
}
