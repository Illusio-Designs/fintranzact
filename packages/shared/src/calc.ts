import { money } from "./money.js";

export interface LineItemInput {
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  taxInclusive?: boolean; // if true, unitPrice includes tax
}

export interface LineItemResult {
  subtotal: string;       // qty * price (tax-exclusive base)
  discountAmount: string; // subtotal * (disc / 100)
  afterDiscount: string;  // subtotal - discountAmount
  taxAmount: string;      // tax on afterDiscount
  total: string;          // afterDiscount + taxAmount (or original amount if tax-inclusive)
}

export function calcLineItem(item: LineItemInput): LineItemResult {
  if (item.taxInclusive) {
    // Tax-inclusive: unitPrice already includes tax
    // Back-calculate: base = price / (1 + tax/100), tax = price - base
    const grossPerUnit = money.toNumber(item.unitPrice);
    const taxRate = money.toNumber(item.taxPercent);
    const basePerUnit = grossPerUnit / (1 + taxRate / 100);
    const basePrice = basePerUnit.toFixed(2);

    const subtotal = money.mul(basePrice, item.quantity);
    const discountAmount = money.percent(subtotal, item.discountPercent);
    const afterDiscount = money.sub(subtotal, discountAmount);
    const taxAmount = money.percent(afterDiscount, item.taxPercent);
    const total = money.add(afterDiscount, taxAmount);

    return { subtotal, discountAmount, afterDiscount, taxAmount, total };
  }

  // Tax-exclusive (default)
  const subtotal = money.mul(item.unitPrice, item.quantity);
  const discountAmount = money.percent(subtotal, item.discountPercent);
  const afterDiscount = money.sub(subtotal, discountAmount);
  const taxAmount = money.percent(afterDiscount, item.taxPercent);
  const total = money.add(afterDiscount, taxAmount);

  return { subtotal, discountAmount, afterDiscount, taxAmount, total };
}

export interface InvoiceTotalsInput {
  lineItems: LineItemInput[];
  charges?: Array<{ amount: string }>;
  roundOff?: string;
  invoiceDiscount?: string;
  invoiceDiscountType?: "amount" | "percent";
}

/** A line after its share of the document-level discount. */
export interface AllocatedLine {
  /** Taxable value after the line discount and the line's share of the document discount. */
  taxableValue: string;
  /** This line's share of the document-level discount. */
  discountShare: string;
  /** Tax on taxableValue. */
  taxAmount: string;
  /** taxableValue + taxAmount. */
  total: string;
}

export interface InvoiceTotals {
  /** Sum of line values after line discounts, before the document discount. */
  subtotal: string;
  lineDiscountTotal: string;
  invoiceDiscountAmount: string;
  /** Tax on the lines (after the document discount) plus tax on the charges. */
  taxTotal: string;
  chargesTotal: string;
  /** GST rate the charges are taxed at ("0.00" when untaxed). */
  chargeTaxRate: string;
  chargeTax: string;
  /** Value of supply: subtotal − document discount + charges. */
  taxableValue: string;
  roundOff: string;
  total: string;
  /** One per input line, in input order. */
  lines: AllocatedLine[];
}

function paise(v: string | number): number {
  return Math.round(Number(v || 0) * 100);
}

function rupees(p: number): string {
  return money.add(p / 100, 0);
}

/**
 * Split `amount` (paise) over `weights` pro rata, handing out the leftover
 * paise by largest remainder (ties to the earlier line), so the parts add up
 * to `amount` exactly.
 */
export function allocatePaise(amount: number, weights: number[]): number[] {
  const w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  const total = w.reduce((s, x) => s + x, 0n);
  if (total === 0n || amount === 0) return weights.map(() => 0);
  const neg = amount < 0;
  const a = BigInt(Math.abs(Math.round(amount)));
  const parts = w.map((x) => (a * x) / total);
  const order = w
    .map((x, i) => ({ i, r: (a * x) % total }))
    .sort((p, q) => (q.r > p.r ? 1 : q.r < p.r ? -1 : p.i - q.i));
  let left = a - parts.reduce((s, x) => s + x, 0n);
  for (const { i } of order) {
    if (left <= 0n) break;
    parts[i] = parts[i]! + 1n;
    left -= 1n;
  }
  return parts.map((x) => (neg ? -Number(x) : Number(x)));
}

/**
 * GST rate for charges billed with a supply (freight, packing, insurance…).
 * They are part of the value of supply (CGST Act s.15(2)(c)) and take the
 * rate of the main supply. With mixed rates we use the highest line rate —
 * treating the highest-rated goods as the principal supply of a composite
 * supply. An invoice of only nil-rated/exempt (0%) lines leaves them untaxed.
 */
export function chargeTaxRateFor(lineRates: Array<string | number | null | undefined>): string {
  const max = lineRates.reduce<number>((m, r) => Math.max(m, Number(r ?? 0) || 0), 0);
  return money.add(max, 0);
}

/**
 * Document totals.
 *
 * - A document-level discount given on the invoice reduces the taxable value
 *   (CGST Act s.15(3)(a)): it is spread over the lines pro rata to their
 *   taxable values (paise-exact) and each line's tax is taken on what is
 *   left. A percent discount is a percent of the pre-tax subtotal.
 * - Charges are taxed at chargeTaxRateFor(line rates).
 *
 * total = subtotal − document discount + charges + tax + round-off
 */
export function calcInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const results = input.lineItems.map((li) => calcLineItem(li));

  const subtotal = money.sum(results.map((r) => r.afterDiscount));
  const lineDiscountTotal = money.sum(results.map((r) => r.discountAmount));

  const discountInput = input.invoiceDiscount || "0";
  const discountType = input.invoiceDiscountType || "amount";
  const invoiceDiscountAmount = discountType === "percent"
    ? money.percent(subtotal, discountInput)
    : money.add(discountInput, 0);

  const shares = allocatePaise(paise(invoiceDiscountAmount), results.map((r) => paise(r.afterDiscount)));
  const lines: AllocatedLine[] = results.map((r, i) => {
    const share = shares[i] ?? 0;
    const taxableValue = rupees(paise(r.afterDiscount) - share);
    const taxAmount = share === 0 ? r.taxAmount : money.percent(taxableValue, input.lineItems[i]!.taxPercent || "0");
    return { taxableValue, discountShare: rupees(share), taxAmount, total: money.add(taxableValue, taxAmount) };
  });

  const chargesTotal = input.charges ? money.sum(input.charges.map((c) => c.amount)) : "0.00";
  const chargeTaxRate = chargeTaxRateFor(input.lineItems.map((li) => li.taxPercent));
  const chargeTax = money.percent(chargesTotal, chargeTaxRate);
  const taxTotal = money.add(money.sum(lines.map((l) => l.taxAmount)), chargeTax);
  const taxableValue = money.add(money.sub(subtotal, invoiceDiscountAmount), chargesTotal);
  const roundOff = input.roundOff || "0.00";
  const total = money.add(money.add(taxableValue, taxTotal), roundOff);

  return {
    subtotal, lineDiscountTotal, invoiceDiscountAmount, taxTotal, chargesTotal,
    chargeTaxRate, chargeTax, taxableValue, roundOff, total, lines,
  };
}

/**
 * The charges part of a saved document: its value (additionalCharges), the
 * tax on it (document tax less the lines' tax) and the rate. Documents saved
 * before charges were taxed carry no charge tax, so their charges report at 0%.
 */
export function chargeSupplyOf(
  doc: { additionalCharges?: string | null; taxAmount: string },
  lines: Array<{ taxPercent: string | null; taxAmount: string | null }>,
): { taxableValue: string; taxAmount: string; rate: string } {
  const taxableValue = money.add(doc.additionalCharges || "0", 0);
  const taxAmount = money.sub(doc.taxAmount, money.sum(lines.map((l) => l.taxAmount || "0")));
  const rate = money.isZero(taxAmount) ? "0.00" : chargeTaxRateFor(lines.map((l) => l.taxPercent));
  return { taxableValue, taxAmount, rate };
}
