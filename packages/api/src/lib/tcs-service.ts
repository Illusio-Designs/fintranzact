/**
 * tcs-service.ts — tax collected at source (s.206C) on sales.
 *
 * An item can carry a TCS section (scrap, minerals, alcohol…). When a sale
 * invoice is created or changed, syncInvoiceTcs() works out the TCS on its
 * lines, adds it to what the customer owes (invoices.total_amount includes it;
 * invoices.tcs_amount says how much of the total it is) and keeps one
 * tax_deductions row per section (kind 'tcs', direction 'payable') for the TCS
 * ledger, challans and returns. TCS is collected when the invoice is raised.
 *
 * Because the total already includes TCS, balances, statuses, payments and
 * statements need no special case; only places that work out the *sales value*
 * (total - GST) subtract tcs_amount too.
 */

import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { invoiceItems, invoices, items, parties, taxDeductions, tdsSectionSettings } from "@fintranzact/db";
import {
  computeTcs,
  defaultTcsSectionRules,
  money,
  panFromGstin,
  tdsFinancialYear,
  tdsQuarter,
  type TcsSectionRule,
} from "@fintranzact/shared";
import { recomputeInvoiceStatus } from "./invoice-status.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type InvoiceTcsMode = "auto" | "none";

const clean = (v: string | null | undefined): string | null => (v == null ? null : String(Number(v)));

/** TCS section rules for a year: defaults with this business's overrides (same table as TDS; codes are distinct). */
export async function loadTcsSectionRules(db: Db, businessId: string, fy: string): Promise<TcsSectionRule[]> {
  const overrides = await db
    .select()
    .from(tdsSectionSettings)
    .where(and(eq(tdsSectionSettings.businessId, businessId), eq(tdsSectionSettings.financialYear, fy)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byCode = new Map<string, any>(overrides.map((o: any) => [o.sectionCode, o]));
  return defaultTcsSectionRules(fy)
    .filter((s) => byCode.get(s.code)?.isActive !== false)
    .map((s) => {
      const o = byCode.get(s.code);
      if (!o) return s;
      return {
        ...s,
        rate: clean(o.rate) ?? s.rate,
        rateWithoutPan: clean(o.rateWithoutPan) ?? s.rateWithoutPan,
        singleThreshold: o.singleThreshold != null ? String(Number(o.singleThreshold)) : s.singleThreshold,
      };
    });
}

export interface TcsLineInput {
  tcsSection: string | null;
  /** Taxable value of the line, GST excluded. */
  taxable: string;
}

export interface TcsSectionTotal {
  sectionCode: string;
  base: string;
  rate: string;
  amount: string;
}

/** TCS on a set of sale lines, grouped by section. */
export function tcsForLines(
  rules: TcsSectionRule[],
  lines: TcsLineInput[],
  hasPan: boolean,
): { amount: string; sections: TcsSectionTotal[] } {
  const bySection = new Map<string, { base: number; amount: number; rate: string }>();
  for (const line of lines) {
    const rule = rules.find((r) => r.code === line.tcsSection);
    if (!rule) continue;
    const r = computeTcs({ section: rule, hasPan, taxable: line.taxable });
    if (!r.applicable) continue;
    const cur = bySection.get(rule.code) ?? { base: 0, amount: 0, rate: r.rate };
    cur.base += parseFloat(r.base);
    cur.amount += parseFloat(r.tcs);
    bySection.set(rule.code, cur);
  }
  const sections = [...bySection.entries()].map(([sectionCode, v]) => ({
    sectionCode,
    base: v.base.toFixed(2),
    rate: v.rate,
    amount: v.amount.toFixed(2),
  }));
  return { amount: money.sum(sections.map((s) => s.amount)), sections };
}

/** Throws if this invoice's TCS is already on a challan. */
export async function assertTcsNotDeposited(db: Db, businessId: string, invoiceId: string): Promise<void> {
  const [row] = await db
    .select({ id: taxDeductions.id })
    .from(taxDeductions)
    .where(and(
      eq(taxDeductions.businessId, businessId),
      eq(taxDeductions.invoiceId, invoiceId),
      eq(taxDeductions.kind, "tcs"),
      sql`${taxDeductions.challanId} IS NOT NULL`,
    ))
    .limit(1);
  if (row) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The TCS on this invoice is already deposited against a challan. Remove it from the challan first.",
    });
  }
}

/**
 * Makes a sale invoice's TCS match its current state: works out the TCS on its
 * lines, adjusts the invoice total by the change, and rewrites the TCS ledger
 * rows. Call after a sale invoice is created, edited, cancelled, reinstated or
 * deleted. A cancelled or deleted invoice carries no TCS.
 */
export async function syncInvoiceTcs(
  db: Db,
  input: { businessId: string; invoiceId: string },
): Promise<{ tcsAmount: string }> {
  const { businessId, invoiceId } = input;
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!inv || inv.type !== "sale" || inv.documentType !== "invoice") return { tcsAmount: "0.00" };

  await assertTcsNotDeposited(db, businessId, invoiceId);

  const live = !inv.deletedAt && inv.status !== "cancelled" && inv.tcsMode !== "none";
  let amount = "0.00";
  let sections: TcsSectionTotal[] = [];
  let hasPan = true;

  if (live) {
    const fy = tdsFinancialYear(inv.invoiceDate);
    const [party] = await db
      .select({ pan: parties.pan, gstin: parties.gstin })
      .from(parties)
      .where(eq(parties.id, inv.partyId))
      .limit(1);
    hasPan = !!(party?.pan?.trim() || panFromGstin(party?.gstin));
    const lines = await db
      .select({
        taxable: sql<string>`(${invoiceItems.totalAmount}::numeric - ${invoiceItems.taxAmount}::numeric)::text`,
        tcsSection: items.tcsSection,
      })
      .from(invoiceItems)
      .innerJoin(items, eq(items.id, invoiceItems.itemId))
      .where(eq(invoiceItems.invoiceId, invoiceId));
    const rules = await loadTcsSectionRules(db, businessId, fy);
    ({ amount, sections } = tcsForLines(rules, lines, hasPan));
  }

  await db.delete(taxDeductions).where(and(
    eq(taxDeductions.businessId, businessId),
    eq(taxDeductions.invoiceId, invoiceId),
    eq(taxDeductions.kind, "tcs"),
  ));
  for (const s of sections) {
    await db.insert(taxDeductions).values({
      businessId,
      kind: "tcs",
      direction: "payable",
      partyId: inv.partyId,
      paymentId: null,
      invoiceId,
      sectionCode: s.sectionCode,
      financialYear: tdsFinancialYear(inv.invoiceDate),
      quarter: tdsQuarter(inv.invoiceDate),
      baseAmount: s.base,
      rate: s.rate,
      amount: s.amount,
      hasPan,
      deductedOn: inv.invoiceDate,
    });
  }

  if (money.compare(amount, inv.tcsAmount) !== 0) {
    const newTotal = money.add(money.sub(inv.totalAmount, inv.tcsAmount), amount);
    await db.update(invoices)
      .set({ tcsAmount: amount, totalAmount: newTotal, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    // A new total changes how much of the invoice is settled.
    await recomputeInvoiceStatus(db, businessId, invoiceId);
  }
  return { tcsAmount: amount };
}
