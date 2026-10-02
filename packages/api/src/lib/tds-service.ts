/**
 * tds-service.ts — TDS rules per business, TDS on purchase bills, and the rows
 * behind tax withheld on a payment.
 *
 * WHERE TDS IS DEDUCTED
 *   Purchase bill   TDS on what we buy is deducted when the bill is credited
 *                   (the bill date). syncBillTds() works it out from the
 *                   supplier's section, the purchases so far this year and the
 *                   year's limits, and settles it against the bill with a
 *                   system payment (payments.source = 'tds', no bank account).
 *                   Balances, statuses and statements need no special case:
 *                   the bill shows total, TDS adjusted, and what is left to pay.
 *   Expense         An expense paid to a payee (rent, professional fees…) can
 *                   carry TDS: syncExpenseTds() keeps one deduction row for it.
 *                   The expense amount is gross; the bank moves amount - TDS.
 *   On account      A payment to a supplier that is not against a bill (an
 *                   advance) carries its own TDS.
 *   Customer pays   A customer who withholds TDS from what they pay us:
 *                   TDS receivable, on the receipt.
 *
 * MODEL
 *   payments.amount      gross: what settles the invoices and the party's balance
 *   payments.tds_amount  part of it withheld (on-account and customer receipts)
 *   bank movement        amount - tds_amount
 *   tax_deductions       one row per deduction (the TDS payable / receivable
 *                        ledger, challans and returns read these)
 */

import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { expenses, invoices, parties, paymentAllocations, payments, taxDeductions, tdsSectionSettings } from "@fintranzact/db";
import {
  computeTds,
  defaultTdsSectionRules,
  money,
  panFromGstin,
  tdsFinancialYear,
  tdsFinancialYearRange,
  tdsQuarter,
  type TdsResult,
  type TdsSectionRule,
} from "@fintranzact/shared";
import { applyInvoicePayment } from "./invoice-status.js";
import { assertPeriodOpen } from "./period-lock.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type TdsDirection = "payable" | "receivable";

/** payments.source of the system payment that settles a bill's TDS. */
export const TDS_PAYMENT_SOURCE = "tds";

const INDIVIDUAL_CONSTITUTIONS = ["proprietorship", "huf"];

/** "2.000" → "2"; null stays null. */
const clean = (v: string | null | undefined): string | null =>
  v == null ? null : String(Number(v));

// ── Rules ──────────────────────────────────────────────────────

/**
 * The section rules for a financial year: code defaults with this business's
 * overrides applied. Sections the business turned off are left out.
 */
export async function loadSectionRules(db: Db, businessId: string, fy: string): Promise<TdsSectionRule[]> {
  const overrides = await db
    .select()
    .from(tdsSectionSettings)
    .where(and(eq(tdsSectionSettings.businessId, businessId), eq(tdsSectionSettings.financialYear, fy)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byCode = new Map<string, any>(overrides.map((o: any) => [o.sectionCode, o]));

  return defaultTdsSectionRules(fy)
    .filter((s) => byCode.get(s.code)?.isActive !== false)
    .map((s) => {
      const o = byCode.get(s.code);
      if (!o) return s;
      return {
        ...s,
        rate: clean(o.rate) ?? s.rate,
        individualRate: clean(o.individualRate) ?? s.individualRate,
        rateWithoutPan: clean(o.rateWithoutPan) ?? s.rateWithoutPan,
        singleThreshold: o.singleThreshold != null ? String(o.singleThreshold) : s.singleThreshold,
        aggregateThreshold: o.aggregateThreshold != null ? String(o.aggregateThreshold) : s.aggregateThreshold,
      };
    });
}

// ── Year to date ───────────────────────────────────────────────

/**
 * What one supplier has been bought from / paid under a section this financial
 * year, before the given bill or payment, and how much of it TDS was already
 * deducted on. Counts purchase bills (by bill date), expenses to the payee
 * and on-account payments that carry the section, so a payment against a bill is never counted twice.
 */
export async function partyYearToDate(
  db: Db,
  businessId: string,
  partyId: string,
  sectionCode: string,
  fy: string,
  exclude: { invoiceId?: string; paymentId?: string; expenseId?: string } = {},
): Promise<{ paid: string; taxedBase: string }> {
  const { from, to } = tdsFinancialYearRange(fy);

  const [bills] = await db
    .select({ total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric - ${invoices.taxAmount}::numeric), 0)::text` })
    .from(invoices)
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.partyId, partyId),
      eq(invoices.type, "purchase"),
      eq(invoices.documentType, "invoice"),
      ne(invoices.status, "cancelled"),
      isNull(invoices.deletedAt),
      eq(invoices.tdsSection, sectionCode),
      gte(invoices.invoiceDate, from),
      lte(invoices.invoiceDate, to),
      exclude.invoiceId ? ne(invoices.id, exclude.invoiceId) : undefined,
    ));

  const [advances] = await db
    .select({ total: sql<string>`COALESCE(SUM(${payments.amount}::numeric), 0)::text` })
    .from(payments)
    .where(and(
      eq(payments.businessId, businessId),
      eq(payments.partyId, partyId),
      eq(payments.tdsSection, sectionCode),
      isNull(payments.deletedAt),
      isNull(payments.invoiceId),
      sql`${payments.source} IS DISTINCT FROM ${TDS_PAYMENT_SOURCE}`,
      gte(payments.paymentDate, from),
      lte(payments.paymentDate, to),
      exclude.paymentId ? ne(payments.id, exclude.paymentId) : undefined,
    ));

  const [spent] = await db
    .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}::numeric), 0)::text` })
    .from(expenses)
    .where(and(
      eq(expenses.businessId, businessId),
      eq(expenses.partyId, partyId),
      eq(expenses.tdsSection, sectionCode),
      isNull(expenses.deletedAt),
      gte(expenses.expenseDate, from),
      lte(expenses.expenseDate, to),
      exclude.expenseId ? ne(expenses.id, exclude.expenseId) : undefined,
    ));

  const [taxed] = await db
    .select({ total: sql<string>`COALESCE(SUM(${taxDeductions.baseAmount}::numeric), 0)::text` })
    .from(taxDeductions)
    .leftJoin(invoices, eq(invoices.id, taxDeductions.invoiceId))
    .where(and(
      eq(taxDeductions.businessId, businessId),
      eq(taxDeductions.partyId, partyId),
      eq(taxDeductions.kind, "tds"),
      eq(taxDeductions.direction, "payable"),
      eq(taxDeductions.sectionCode, sectionCode),
      eq(taxDeductions.financialYear, fy),
      exclude.invoiceId ? sql`${taxDeductions.invoiceId} IS DISTINCT FROM ${exclude.invoiceId}` : sql`TRUE`,
      exclude.paymentId ? sql`${taxDeductions.paymentId} IS DISTINCT FROM ${exclude.paymentId}` : sql`TRUE`,
      exclude.expenseId ? sql`${taxDeductions.expenseId} IS DISTINCT FROM ${exclude.expenseId}` : sql`TRUE`,
    ));

  return {
    paid: money.add(money.add(bills?.total ?? "0", advances?.total ?? "0"), spent?.total ?? "0"),
    taxedBase: taxed?.total ?? "0",
  };
}

// ── Preview ────────────────────────────────────────────────────

export interface TdsPreview {
  financialYear: string;
  quarter: 1 | 2 | 3 | 4;
  sectionCode: string | null;
  section: TdsSectionRule | null;
  hasPan: boolean;
  isIndividual: boolean;
  ytdPaid: string;
  ytdTaxedBase: string;
  result: TdsResult | null;
  warnings: string[];
}

/**
 * What TDS applies to buying / paying `amount` (taxable value, excluding GST)
 * from a supplier on `date`. Used for the bill form, bill sync and advances.
 */
export async function previewPartyTds(
  db: Db,
  businessId: string,
  input: {
    partyId: string;
    amount: string;
    paymentDate?: Date;
    sectionCode?: string | null;
    excludePaymentId?: string;
    excludeInvoiceId?: string;
    excludeExpenseId?: string;
  },
): Promise<TdsPreview> {
  const date = input.paymentDate ?? new Date();
  const fy = tdsFinancialYear(date);
  const quarter = tdsQuarter(date);

  const [party] = await db
    .select({ pan: parties.pan, gstin: parties.gstin, constitution: parties.constitution, tdsSection: parties.tdsSection })
    .from(parties)
    .where(and(eq(parties.id, input.partyId), eq(parties.businessId, businessId)))
    .limit(1);
  if (!party) throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });

  const sectionCode = input.sectionCode ?? party.tdsSection ?? null;
  const hasPan = !!(party.pan?.trim() || panFromGstin(party.gstin));
  const isIndividual = INDIVIDUAL_CONSTITUTIONS.includes(party.constitution ?? "");
  const base = { financialYear: fy, quarter, sectionCode, hasPan, isIndividual, ytdPaid: "0", ytdTaxedBase: "0" };

  if (!sectionCode) {
    return { ...base, section: null, result: null, warnings: ["No TDS section is set on this party."] };
  }
  const rules = await loadSectionRules(db, businessId, fy);
  const section = rules.find((r) => r.code === sectionCode) ?? null;
  if (!section) {
    return { ...base, section: null, result: null, warnings: [`Section ${sectionCode} is switched off for ${fy}.`] };
  }

  const ytd = await partyYearToDate(db, businessId, input.partyId, sectionCode, fy, {
    invoiceId: input.excludeInvoiceId,
    paymentId: input.excludePaymentId,
    expenseId: input.excludeExpenseId,
  });
  const result = computeTds({
    section,
    hasPan,
    isIndividual,
    amount: input.amount,
    ytdBase: ytd.paid,
    ytdTaxedBase: ytd.taxedBase,
  });

  const warnings: string[] = [];
  if (!hasPan) warnings.push(`No PAN on file — TDS is at the higher ${section.rateWithoutPan}% rate (s.206AA).`);
  return { ...base, section, ytdPaid: ytd.paid, ytdTaxedBase: ytd.taxedBase, result, warnings };
}

// ── Purchase bills ─────────────────────────────────────────────

export type BillTdsMode = "auto" | "none" | "manual";

/** Checks the TDS settings entered on a purchase bill and returns what to store. */
export function assertBillTdsInput(
  mode: BillTdsMode,
  section: string | null | undefined,
  amount: string | null | undefined,
  total: string,
): { mode: BillTdsMode; section: string | null; amount: string } {
  if (mode !== "manual") return { mode, section: null, amount: "0" };
  if (!section) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the TDS section for the TDS entered on this bill" });
  const amt = amount && amount.length > 0 ? amount : "0";
  if (money.compare(amt, total) >= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "TDS must be less than the bill total" });
  return { mode, section, amount: amt };
}

/** The taxable value of a bill: what TDS is worked out on (GST excluded). */
export function billTaxableValue(totalAmount: string, taxAmount: string): string {
  return money.sub(totalAmount, taxAmount);
}

/**
 * Makes a purchase bill's TDS match its current state: removes the bill's
 * system TDS adjustment, then adds one again if TDS applies. Call after a
 * purchase bill is created, edited, cancelled, reinstated or deleted.
 *
 *   auto    worked out from the supplier's section, the year to date and limits
 *   manual  the section and amount entered on the bill
 *   none    no TDS on this bill
 *
 * Throws if the bill's current TDS is already deposited against a challan.
 */
export async function syncBillTds(
  db: Db,
  input: { businessId: string; invoiceId: string; userId?: string | null; userName?: string | null },
): Promise<{ tdsAmount: string; tdsSection: string | null }> {
  const { businessId, invoiceId } = input;
  const [bill] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!bill || bill.type !== "purchase" || bill.documentType !== "invoice") {
    return { tdsAmount: "0.00", tdsSection: null };
  }

  // 1. Take the bill's current TDS adjustment out.
  const existing = await db
    .select({ id: payments.id, amount: payments.amount })
    .from(payments)
    .where(and(
      eq(payments.businessId, businessId),
      eq(payments.invoiceId, invoiceId),
      eq(payments.source, TDS_PAYMENT_SOURCE),
    ));
  for (const p of existing) {
    await assertTdsNotDeposited(db, businessId, p.id);
    await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, p.id));
    await applyInvoicePayment(db, businessId, invoiceId, money.sub("0", p.amount));
    await db.delete(payments).where(eq(payments.id, p.id)); // its deduction row goes with it
  }

  // A draft bill is in the books like any other (ledger, ITC); only a cancelled or deleted one is not.
  const live = !bill.deletedAt && bill.status !== "cancelled";
  const setBill = async (tdsAmount: string, tdsSection: string | null) => {
    await db.update(invoices).set({ tdsAmount, tdsSection, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
    return { tdsAmount, tdsSection };
  };

  const [party] = await db
    .select({ pan: parties.pan, gstin: parties.gstin, constitution: parties.constitution, tdsSection: parties.tdsSection })
    .from(parties)
    .where(eq(parties.id, bill.partyId))
    .limit(1);

  // The section is the supplier's (or the one entered on the bill, in manual mode).
  const manualSection = bill.tdsMode === "manual" ? bill.tdsSection : null;
  const sectionCode = bill.tdsMode === "none" ? null : manualSection ?? party?.tdsSection ?? null;
  if (!live || !sectionCode) {
    // A manual amount stays on the bill so reinstating a cancelled bill brings it back.
    if (bill.tdsMode === "manual") return { tdsAmount: bill.tdsAmount, tdsSection: bill.tdsSection };
    return setBill("0.00", sectionCode && live ? sectionCode : null);
  }

  const fy = tdsFinancialYear(bill.invoiceDate);
  const hasPan = !!(party?.pan?.trim() || panFromGstin(party?.gstin));
  const taxable = billTaxableValue(bill.totalAmount, bill.taxAmount);

  let tds = "0.00";
  let base = taxable;
  let rate = "0";
  if (bill.tdsMode === "manual") {
    tds = bill.tdsAmount; // the amount entered on the bill
    rate = money.isPositive(taxable) ? ((parseFloat(tds) / parseFloat(taxable)) * 100).toFixed(3) : "0";
  } else {
    const rules = await loadSectionRules(db, businessId, fy);
    const section = rules.find((r) => r.code === sectionCode);
    if (!section) return setBill("0.00", sectionCode);
    const ytd = await partyYearToDate(db, businessId, bill.partyId, sectionCode, fy, { invoiceId });
    const result = computeTds({
      section,
      hasPan,
      isIndividual: INDIVIDUAL_CONSTITUTIONS.includes(party?.constitution ?? ""),
      amount: taxable,
      ytdBase: ytd.paid,
      ytdTaxedBase: ytd.taxedBase,
    });
    if (!result.applicable) return setBill("0.00", sectionCode);
    tds = result.tds;
    base = result.base;
    rate = result.rate;
  }
  if (!money.isPositive(tds)) return setBill("0.00", sectionCode);
  if (money.compare(tds, bill.totalAmount) >= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "TDS must be less than the bill total" });
  }

  // 2. Settle the TDS against the bill with a system payment.
  const [sys] = await db
    .insert(payments)
    .values({
      businessId,
      partyId: bill.partyId,
      invoiceId,
      amount: tds,
      discount: "0",
      tdsAmount: "0",
      tdsSection: sectionCode,
      mode: "other",
      paymentDate: bill.invoiceDate,
      notes: `TDS deducted at source under ${sectionCode} on bill ${bill.invoiceNumber}`,
      paymentNumber: `TDS-${bill.invoiceNumber}`,
      source: TDS_PAYMENT_SOURCE,
      createdByUserId: input.userId ?? null,
      createdByName: input.userName ?? null,
    })
    .returning({ id: payments.id });
  await db.insert(paymentAllocations).values({ paymentId: sys.id, invoiceId, amount: tds });
  await applyInvoicePayment(db, businessId, invoiceId, tds);
  await db.insert(taxDeductions).values({
    businessId,
    kind: "tds",
    direction: "payable",
    partyId: bill.partyId,
    paymentId: sys.id,
    invoiceId,
    sectionCode,
    financialYear: fy,
    quarter: tdsQuarter(bill.invoiceDate),
    baseAmount: base,
    rate,
    amount: tds,
    hasPan,
    deductedOn: bill.invoiceDate,
  });
  return setBill(tds, sectionCode);
}

// ── Expenses ───────────────────────────────────────────────────

export type ExpenseTdsMode = "none" | "auto" | "manual";

/**
 * Checks the TDS settings entered on an expense and returns what to store.
 * `none` carries no section or amount. `auto` keeps the chosen section (or
 * leaves it to the payee's) and the amount is worked out on save. `manual`
 * needs the section and an amount below the expense.
 */
export function assertExpenseTdsInput(
  mode: ExpenseTdsMode,
  partyId: string | null | undefined,
  section: string | null | undefined,
  amount: string | null | undefined,
  total: string,
): { mode: ExpenseTdsMode; section: string | null; amount: string } {
  if (mode === "none") return { mode, section: null, amount: "0" };
  if (!partyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose who was paid to deduct TDS on this expense" });
  if (mode === "auto") return { mode, section: section || null, amount: "0" };
  if (!section) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the TDS section for the TDS entered on this expense" });
  const amt = amount && amount.length > 0 ? amount : "0";
  if (money.compare(amt, total) >= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "TDS must be less than the expense amount" });
  return { mode, section, amount: amt };
}

/**
 * Makes an expense's TDS match its current state: removes its deduction row,
 * then adds one again if TDS applies. Call after an expense is created,
 * edited or deleted, and use the returned tdsAmount to size the bank
 * withdrawal (amount - TDS).
 *
 *   auto    section chosen on the expense (else the payee's), worked out from
 *           the payee's PAN, the year to date and the section's limits
 *   manual  the section and amount entered on the expense
 *   none    no TDS
 *
 * Throws if the current TDS is already deposited against a challan, or the
 * expense's date is in a locked period.
 */
export async function syncExpenseTds(
  db: Db,
  input: { businessId: string; expenseId: string },
): Promise<{ tdsAmount: string; tdsSection: string | null }> {
  const { businessId, expenseId } = input;
  const [exp] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.businessId, businessId)))
    .limit(1);
  if (!exp) return { tdsAmount: "0.00", tdsSection: null };

  // 1. Take the expense's current deduction out.
  const existing = await db
    .select({ id: taxDeductions.id, challanId: taxDeductions.challanId })
    .from(taxDeductions)
    .where(and(eq(taxDeductions.businessId, businessId), eq(taxDeductions.expenseId, expenseId)));
  if (existing.length > 0) {
    await assertPeriodOpen(db, businessId, [exp.expenseDate]);
    if (existing.some((d: { challanId: string | null }) => d.challanId)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The TDS here is already deposited against a challan. Remove it from the challan first.",
      });
    }
    await db.delete(taxDeductions).where(and(eq(taxDeductions.businessId, businessId), eq(taxDeductions.expenseId, expenseId)));
  }

  const setExpense = async (tdsAmount: string, tdsSection: string | null) => {
    await db.update(expenses).set({ tdsAmount, tdsSection }).where(eq(expenses.id, expenseId));
    return { tdsAmount, tdsSection };
  };

  const mode = exp.tdsMode as ExpenseTdsMode;
  if (exp.deletedAt || mode === "none" || !exp.partyId) {
    // A deleted expense keeps what was entered; it just has no deduction row.
    if (exp.deletedAt) return { tdsAmount: exp.tdsAmount, tdsSection: exp.tdsSection };
    return setExpense("0.00", null);
  }

  const [party] = await db
    .select({ pan: parties.pan, gstin: parties.gstin, constitution: parties.constitution, tdsSection: parties.tdsSection })
    .from(parties)
    .where(and(eq(parties.id, exp.partyId), eq(parties.businessId, businessId)))
    .limit(1);
  const sectionCode: string | null = exp.tdsSection ?? party?.tdsSection ?? null;
  if (!sectionCode) return setExpense("0.00", null);

  const fy = tdsFinancialYear(exp.expenseDate);
  const hasPan = !!(party?.pan?.trim() || panFromGstin(party?.gstin));

  let tds = "0.00";
  let base: string = exp.amount;
  let rate = "0";
  if (mode === "manual") {
    tds = exp.tdsAmount;
    rate = money.isPositive(exp.amount) ? ((parseFloat(tds) / parseFloat(exp.amount)) * 100).toFixed(3) : "0";
  } else {
    const rules = await loadSectionRules(db, businessId, fy);
    const section = rules.find((r) => r.code === sectionCode);
    if (!section) return setExpense("0.00", sectionCode);
    const ytd = await partyYearToDate(db, businessId, exp.partyId, sectionCode, fy, { expenseId });
    const result = computeTds({
      section,
      hasPan,
      isIndividual: INDIVIDUAL_CONSTITUTIONS.includes(party?.constitution ?? ""),
      amount: exp.amount,
      ytdBase: ytd.paid,
      ytdTaxedBase: ytd.taxedBase,
    });
    if (!result.applicable) return setExpense("0.00", sectionCode);
    tds = result.tds;
    base = result.base;
    rate = result.rate;
  }
  if (!money.isPositive(tds)) return setExpense("0.00", sectionCode);
  if (money.compare(tds, exp.amount) >= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "TDS must be less than the expense amount" });
  }

  // 2. Record the deduction (TDS payable).
  await db.insert(taxDeductions).values({
    businessId,
    kind: "tds",
    direction: "payable",
    partyId: exp.partyId,
    expenseId,
    sectionCode,
    financialYear: fy,
    quarter: tdsQuarter(exp.expenseDate),
    baseAmount: base,
    rate,
    amount: tds,
    hasPan,
    deductedOn: exp.expenseDate,
  });
  return setExpense(tds, sectionCode);
}

// ── Payment rows (on-account advances and customer receipts) ──

/** TDS on a payment must be a sensible slice of it. */
export function assertValidTds(amount: string, tdsAmount: string, sectionCode: string | null | undefined): void {
  if (money.isZero(tdsAmount)) return;
  if (money.compare(tdsAmount, amount) >= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "TDS must be less than the payment amount" });
  }
  if (!sectionCode) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the TDS section for the tax withheld" });
  }
}

/** What reaches the bank: the gross less the tax withheld. */
export function netOfTds(amount: string, tdsAmount: string | null | undefined): string {
  return money.sub(amount, tdsAmount || "0");
}

/** Throws if the tax on this payment was already deposited against a challan — it can't change any more. */
export async function assertTdsNotDeposited(db: Db, businessId: string, paymentId: string): Promise<void> {
  const [row] = await db
    .select({ id: taxDeductions.id })
    .from(taxDeductions)
    .where(and(
      eq(taxDeductions.businessId, businessId),
      eq(taxDeductions.paymentId, paymentId),
      sql`${taxDeductions.challanId} IS NOT NULL`,
    ))
    .limit(1);
  if (row) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The TDS here is already deposited against a challan. Remove it from the challan first.",
    });
  }
}

/** Removes the deduction rows of a payment (before it is edited or deleted). */
export async function removePaymentTax(db: Db, businessId: string, paymentId: string): Promise<void> {
  await db.delete(taxDeductions).where(and(eq(taxDeductions.businessId, businessId), eq(taxDeductions.paymentId, paymentId)));
}

/**
 * Writes the deduction row for a payment that withheld tax. `base` is the
 * taxable value the tax was worked out on (defaults to the gross payment);
 * the rate stored is the effective percent of that base.
 */
export async function recordPaymentTax(
  db: Db,
  input: {
    businessId: string;
    paymentId: string;
    partyId: string;
    invoiceId?: string | null;
    direction: TdsDirection;
    sectionCode: string;
    amount: string; // gross payment
    tdsAmount: string;
    base?: string | null;
    paymentDate: Date;
    hasPan: boolean;
  },
): Promise<void> {
  if (money.isZero(input.tdsAmount)) return;
  const base = input.base && money.isPositive(input.base) ? input.base : input.amount;
  const rate = ((parseFloat(input.tdsAmount) / parseFloat(base)) * 100).toFixed(3);
  await db.insert(taxDeductions).values({
    businessId: input.businessId,
    kind: "tds",
    direction: input.direction,
    partyId: input.partyId,
    paymentId: input.paymentId,
    invoiceId: input.invoiceId ?? null,
    sectionCode: input.sectionCode,
    financialYear: tdsFinancialYear(input.paymentDate),
    quarter: tdsQuarter(input.paymentDate),
    baseAmount: base,
    rate,
    amount: input.tdsAmount,
    hasPan: input.hasPan,
    deductedOn: input.paymentDate,
  });
}
