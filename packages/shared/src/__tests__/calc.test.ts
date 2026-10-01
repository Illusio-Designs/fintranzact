/**
 * Tests for packages/shared/src/calc.ts
 *
 * WHY THIS FILE EXISTS:
 * calcLineItem and calcInvoiceTotals are the core financial calculation engine
 * used every time a user creates or edits an invoice. Mistakes here directly
 * result in incorrect customer billing, wrong GST filings, or stock ledger
 * errors. Each test case represents a real-world invoice scenario that a
 * contributor could encounter while running an Indian small business.
 *
 * GST NOTE: India's Goods and Services Tax requires tracking subtotal,
 * discount, tax-exclusive base, and final amount separately. The tests
 * mirror the actual invoice structure rather than simplified models.
 */

import { describe, it, expect } from "vitest";
import { calcLineItem, calcInvoiceTotals, taxOn } from "../calc.js";
import { splitIntraStateTax } from "../gst.js";

// ─────────────────────────────────────────────────────────────────────────────
// calcLineItem — single invoice line item calculations
// ─────────────────────────────────────────────────────────────────────────────
describe("calcLineItem — calculates subtotal, discount, tax and total for a single invoice line", () => {

  it("calculates basic subtotal: quantity × unitPrice (no tax, no discount)", () => {
    // 5 units of rice @ ₹50 each — the simplest possible sale.
    const result = calcLineItem({
      quantity: "5",
      unitPrice: "50.00",
      taxPercent: "0",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("250.00");
    expect(result.discountAmount).toBe("0.00");
    expect(result.afterDiscount).toBe("250.00");
    expect(result.taxAmount).toBe("0.00");
    expect(result.total).toBe("250.00");
  });

  it("applies 18% GST to the subtotal when there is no discount", () => {
    // Selling software services: 1 unit @ ₹1000 + 18% GST.
    // Expected: subtotal=1000, tax=180, total=1180.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "1000.00",
      taxPercent: "18",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("1000.00");
    expect(result.taxAmount).toBe("180.00");
    expect(result.total).toBe("1180.00");
  });

  it("applies percentage discount before calculating tax (discount reduces taxable base)", () => {
    // This is the legally correct GST treatment: tax is applied after discount.
    // 10 kg cement @ ₹100, 10% discount, 28% GST.
    // subtotal = 1000, discount = 100, afterDiscount = 900, tax = 252, total = 1152.
    const result = calcLineItem({
      quantity: "10",
      unitPrice: "100.00",
      taxPercent: "28",
      discountPercent: "10",
    });
    expect(result.subtotal).toBe("1000.00");
    expect(result.discountAmount).toBe("100.00");
    expect(result.afterDiscount).toBe("900.00");
    expect(result.taxAmount).toBe("252.00");
    expect(result.total).toBe("1152.00");
  });

  it("handles tax-inclusive pricing — back-calculates base price from gross price", () => {
    // When a retailer sets MRP (Maximum Retail Price) which already includes GST,
    // the system must reverse-calculate the base price.
    // ₹118 MRP at 18% GST → base = 118 / 1.18 = 100, tax = 18, total = 118.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "118.00",
      taxPercent: "18",
      discountPercent: "0",
      taxInclusive: true,
    });
    // Base price should be ₹100 (rounded to 2dp)
    expect(result.subtotal).toBe("100.00");
    expect(result.taxAmount).toBe("18.00");
    // Total should equal the original inclusive price
    expect(result.total).toBe("118.00");
  });

  it("handles tax-inclusive pricing with a discount — discount applied to base (post-split) amount", () => {
    // ₹118 MRP (18% GST inclusive), 10% discount.
    // base = 100, discount = 10, afterDiscount = 90, tax = 16.20, total = 106.20
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "118.00",
      taxPercent: "18",
      discountPercent: "10",
      taxInclusive: true,
    });
    expect(result.subtotal).toBe("100.00");
    expect(result.discountAmount).toBe("10.00");
    expect(result.afterDiscount).toBe("90.00");
    expect(result.taxAmount).toBe("16.20");
    expect(result.total).toBe("106.20");
  });

  it("handles 100% discount (zero total) — e.g. complimentary goods on an invoice", () => {
    // Sales teams sometimes add a free item to an invoice at 100% discount.
    const result = calcLineItem({
      quantity: "2",
      unitPrice: "500.00",
      taxPercent: "12",
      discountPercent: "100",
    });
    expect(result.discountAmount).toBe("1000.00");
    expect(result.afterDiscount).toBe("0.00");
    expect(result.taxAmount).toBe("0.00");
    expect(result.total).toBe("0.00");
  });

  it("handles zero quantity — all amounts are zero", () => {
    // Although the validator rejects quantity ≤ 0, the function itself is also
    // tested directly to ensure it doesn't produce NaN or undefined.
    const result = calcLineItem({
      quantity: "0",
      unitPrice: "200.00",
      taxPercent: "5",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("0.00");
    expect(result.total).toBe("0.00");
  });

  it("handles very small amounts at paise granularity (₹0.01 × 1, 0% tax)", () => {
    // Edge case: invoicing at minimum INR granularity.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "0.01",
      taxPercent: "0",
      discountPercent: "0",
    });
    expect(result.total).toBe("0.01");
  });

  it("handles large quantities with decimal prices (500.5 units × ₹12.75 = ₹6381.38)", () => {
    // Bulk commodity: 500.5 kg of wheat @ ₹12.75/kg.
    // 500.5 × 12.75 = 6381.375, rounds to 6381.38
    const result = calcLineItem({
      quantity: "500.5",
      unitPrice: "12.75",
      taxPercent: "0",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("6381.38");
  });

  it("handles 5% GST on an odd amount without floating-point error", () => {
    // 5% of ₹850 = ₹42.50 — tests that paise multiplication is exact.
    const result = calcLineItem({
      quantity: "1",
      unitPrice: "850.00",
      taxPercent: "5",
      discountPercent: "0",
    });
    expect(result.taxAmount).toBe("42.50");
    expect(result.total).toBe("892.50");
  });

  it("handles multiple quantity with decimal tax producing an odd paise result", () => {
    // 3 units @ ₹33.33, 18% GST.
    // subtotal = 99.99, tax = 17.998... rounds to 18.00, total = 117.99
    const result = calcLineItem({
      quantity: "3",
      unitPrice: "33.33",
      taxPercent: "18",
      discountPercent: "0",
    });
    expect(result.subtotal).toBe("99.99");
    // Tax = Math.round(9999 * 18 / 100) = Math.round(1799.82) = 1800 paise = 18.00
    expect(result.taxAmount).toBe("18.00");
    expect(result.total).toBe("117.99");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInvoiceTotals — aggregate multiple line items with invoice-level adjustments
// ─────────────────────────────────────────────────────────────────────────────
describe("calcInvoiceTotals — aggregates line items with invoice-level discounts, charges, and round-off", () => {

  // Helper: a standard two-line invoice for Sharma Traders
  function sharmaInvoiceInput() {
    return {
      lineItems: [
        // Line 1: 10 kg wheat @ ₹50/kg, no tax, no discount
        { quantity: "10", unitPrice: "50.00", taxPercent: "0", discountPercent: "0" },
        // Line 2: 5 kg sugar @ ₹40/kg, 5% GST, no discount
        { quantity: "5", unitPrice: "40.00", taxPercent: "5", discountPercent: "0" },
      ],
    };
  }

  it("sums multiple line items correctly", () => {
    // Line 1: subtotal=500, tax=0, total=500
    // Line 2: subtotal=200, tax=10, total=210
    // Invoice subtotal (afterDiscount sum) = 700, taxTotal = 10, total = 710
    const result = calcInvoiceTotals(sharmaInvoiceInput());
    expect(result.subtotal).toBe("700.00");
    expect(result.taxTotal).toBe("10.00");
    expect(result.total).toBe("710.00");
  });

  it("applies an invoice-level discount as a fixed amount (type='amount')", () => {
    // Sharma Traders gets a ₹50 loyalty discount on the whole invoice. Given
    // on the invoice, it reduces the taxable value (CGST Act s.15(3)(a)):
    // shared 500:200 → 35.71 + 14.29, so the 5% line is taxed on 185.71 = 9.29.
    // total = 700 - 50 + 9.29 = 659.29
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      invoiceDiscount: "50",
      invoiceDiscountType: "amount",
    });
    expect(result.invoiceDiscountAmount).toBe("50.00");
    expect(result.lines.map((l) => l.discountShare)).toEqual(["35.71", "14.29"]);
    expect(result.taxTotal).toBe("9.29");
    expect(result.total).toBe("659.29");
  });

  it("applies an invoice-level discount as a percentage (type='percent')", () => {
    // 10% discount on the post-line-discount subtotal of ₹700 = ₹70 discount,
    // shared 50 + 20; the 5% line is taxed on 180 = 9.00. total = 630 + 9 = 639
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      invoiceDiscount: "10",
      invoiceDiscountType: "percent",
    });
    expect(result.invoiceDiscountAmount).toBe("70.00");
    expect(result.taxTotal).toBe("9.00");
    expect(result.total).toBe("639.00");
  });

  it("adds additional charges (e.g. delivery charges, packing fees)", () => {
    // ₹50 delivery fee: part of the value of supply (s.15(2)(c)), taxed at the
    // highest line rate (5%) = 2.50. total = 700 + 50 + 10 + 2.50 = 762.50
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      charges: [{ amount: "50.00" }],
    });
    expect(result.chargesTotal).toBe("50.00");
    expect(result.chargeTaxRate).toBe("5.00");
    expect(result.chargeTax).toBe("2.50");
    expect(result.taxableValue).toBe("750.00");
    expect(result.total).toBe("762.50");
  });

  it("applies multiple named charges and sums them into chargesTotal", () => {
    // ₹30 delivery + ₹20 packing = ₹50 charges total.
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      charges: [{ amount: "30.00" }, { amount: "20.00" }],
    });
    expect(result.chargesTotal).toBe("50.00");
  });

  it("applies a positive round-off (adds to final total)", () => {
    // GST invoices sometimes include a small positive round-off to get a whole rupee total.
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      roundOff: "0.50",
    });
    expect(result.roundOff).toBe("0.50");
    expect(result.total).toBe("710.50");
  });

  it("applies a negative round-off (reduces final total)", () => {
    // A small deduction to round down to the nearest rupee.
    const result = calcInvoiceTotals({
      ...sharmaInvoiceInput(),
      roundOff: "-0.25",
    });
    expect(result.roundOff).toBe("-0.25");
    expect(result.total).toBe("709.75");
  });

  it("handles an empty line items array (all zeros)", () => {
    // An invoice with no line items should not throw — it's a valid intermediate state.
    const result = calcInvoiceTotals({ lineItems: [] });
    expect(result.subtotal).toBe("0.00");
    expect(result.taxTotal).toBe("0.00");
    expect(result.total).toBe("0.00");
  });

  it("defaults invoiceDiscountType to 'amount' when not provided", () => {
    // When the caller omits the type, the discount is treated as a fixed rupee amount.
    const result = calcInvoiceTotals({
      lineItems: [{ quantity: "1", unitPrice: "1000.00", taxPercent: "0", discountPercent: "0" }],
      invoiceDiscount: "100",
      // invoiceDiscountType intentionally omitted
    });
    expect(result.invoiceDiscountAmount).toBe("100.00");
    expect(result.total).toBe("900.00");
  });

  it("returns lineDiscountTotal as the sum of all line-level discount amounts", () => {
    // Both lines have a 10% discount — the aggregate discount should be visible on the invoice.
    const result = calcInvoiceTotals({
      lineItems: [
        { quantity: "10", unitPrice: "100.00", taxPercent: "0", discountPercent: "10" }, // disc=100
        { quantity: "5", unitPrice: "200.00", taxPercent: "0", discountPercent: "10" }, // disc=100
      ],
    });
    expect(result.lineDiscountTotal).toBe("200.00");
    // After line discounts: 900 + 900 = 1800 subtotal
    expect(result.subtotal).toBe("1800.00");
  });

  it("combines all adjustments correctly: discount + charges + roundOff + multiple lines", () => {
    // Full scenario: Mehta Electronics invoice
    // Line 1: 2 phones @ ₹15000, 12% GST, 5% discount
    //   subtotal=30000, disc=1500, afterDisc=28500, tax=3420, total=31920
    // Line 2: 1 charger @ ₹500, 12% GST, no discount
    //   subtotal=500, disc=0, afterDisc=500, tax=60, total=560
    // Invoice-level: ₹200 flat discount, ₹100 delivery charge, +₹0.80 roundoff
    // Combined subtotal (afterDisc) = 28500 + 500 = 29000
    // Discount shared pro rata: 196.55 + 3.45 → taxable 28303.45 + 496.55
    //   line tax 3396.41 + 59.59 = 3456.00
    // Charges ₹100 at 12% = 12.00 → taxTotal = 3468.00
    // total = 29000 - 200 + 100 + 3468 + 0.80 = 32368.80
    const result = calcInvoiceTotals({
      lineItems: [
        { quantity: "2", unitPrice: "15000.00", taxPercent: "12", discountPercent: "5" },
        { quantity: "1", unitPrice: "500.00", taxPercent: "12", discountPercent: "0" },
      ],
      invoiceDiscount: "200",
      invoiceDiscountType: "amount",
      charges: [{ amount: "100.00" }],
      roundOff: "0.80",
    });
    expect(result.subtotal).toBe("29000.00");
    expect(result.lines.map((l) => l.taxableValue)).toEqual(["28303.45", "496.55"]);
    expect(result.taxTotal).toBe("3468.00");
    expect(result.invoiceDiscountAmount).toBe("200.00");
    expect(result.chargesTotal).toBe("100.00");
    expect(result.total).toBe("32368.80");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intra-state supplies: CGST and SGST are each rounded at half the rate
// ─────────────────────────────────────────────────────────────────────────────

describe("intraState — CGST and SGST rounded separately at half the rate", () => {
  it("5% on ₹135: the full-rate tax ₹6.75 is an odd paisa; intra-state it is 2 × ₹3.38", () => {
    const igst = calcLineItem({ quantity: "1", unitPrice: "135", taxPercent: "5", discountPercent: "0" });
    expect(igst.taxAmount).toBe("6.75");
    const intra = calcLineItem({ quantity: "1", unitPrice: "135", taxPercent: "5", discountPercent: "0", intraState: true });
    expect(intra.taxAmount).toBe("6.76");
    expect(intra.total).toBe("141.76");
    const { cgst, sgst } = splitIntraStateTax(intra.taxAmount);
    expect(cgst).toBe(3.38);
    expect(sgst).toBe(3.38);
  });

  it("inter-state (intraState false / unset) keeps one amount at the full rate", () => {
    const off = calcLineItem({ quantity: "1", unitPrice: "135", taxPercent: "5", discountPercent: "0", intraState: false });
    expect(off.taxAmount).toBe("6.75");
    const t = calcInvoiceTotals({
      lineItems: [{ quantity: "1", unitPrice: "135", taxPercent: "5", discountPercent: "0" }],
      charges: [{ amount: "45" }],
    });
    expect(t.taxTotal).toBe("9.00"); // 6.75 + 2.25
  });

  it("already-even taxes are unchanged", () => {
    const r = calcLineItem({ quantity: "2", unitPrice: "500", taxPercent: "18", discountPercent: "0", intraState: true });
    expect(r.taxAmount).toBe("180.00");
  });

  it("tax-inclusive: the back-calculated base is taxed in two equal halves", () => {
    // ₹141.75 incl. 5% → base 135.00; halves 3.375 → 3.38 each
    const r = calcLineItem({ quantity: "1", unitPrice: "141.75", taxPercent: "5", discountPercent: "0", taxInclusive: true, intraState: true });
    expect(r.afterDiscount).toBe("135.00");
    expect(r.taxAmount).toBe("6.76");
    const old = calcLineItem({ quantity: "1", unitPrice: "141.75", taxPercent: "5", discountPercent: "0", taxInclusive: true });
    expect(old.taxAmount).toBe("6.75");
  });

  it("totals: lines, the discounted lines and the charges are all even-paisa", () => {
    const t = calcInvoiceTotals({
      lineItems: [
        { quantity: "1", unitPrice: "135", taxPercent: "5", discountPercent: "0" },
        { quantity: "1", unitPrice: "45", taxPercent: "5", discountPercent: "0" },
      ],
      charges: [{ amount: "45" }],
      intraState: true,
    });
    expect(t.lines.map((l) => l.taxAmount)).toEqual(["6.76", "2.26"]);
    expect(t.chargeTax).toBe("2.26");
    expect(t.taxTotal).toBe("11.28");
    expect(t.total).toBe("236.28");
    for (const tax of [...t.lines.map((l) => l.taxAmount), t.chargeTax, t.taxTotal]) {
      const { cgst, sgst } = splitIntraStateTax(tax);
      expect(cgst).toBe(sgst);
    }
  });

  it("totals with a document discount re-tax the discounted line in halves", () => {
    // 145 − 10 discount = 135 taxable → 2 × 3.38
    const t = calcInvoiceTotals({
      lineItems: [{ quantity: "1", unitPrice: "145", taxPercent: "5", discountPercent: "0" }],
      invoiceDiscount: "10",
      intraState: true,
    });
    expect(t.lines[0]!.taxableValue).toBe("135.00");
    expect(t.lines[0]!.taxAmount).toBe("6.76");
    expect(t.taxTotal).toBe("6.76");
  });

  it("taxOn: zero/blank rates and amounts give zero", () => {
    expect(taxOn("0", "18", true)).toBe("0.00");
    expect(taxOn("100", "0", true)).toBe("0.00");
    expect(taxOn("100", "", true)).toBe("0.00");
    expect(taxOn("100", "28", true)).toBe("28.00");
    expect(taxOn("0.03", "18", true)).toBe("0.00"); // half 0.0027 → 0.00
    expect(taxOn("0.03", "18")).toBe("0.01");
  });
});
