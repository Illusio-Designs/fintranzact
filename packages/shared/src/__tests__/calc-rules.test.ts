/**
 * Money rules not covered by calc.test.ts / money.test.ts: paise rounding
 * direction, fractional quantities, tax-inclusive back-calculation, the
 * document-level discount reducing the taxable value (CGST Act s.15(3)(a),
 * allocated pro rata), charges taxed at the main rate (s.15(2)(c)), and
 * invariants that must hold (parts add up to the invoice total).
 *
 * Where the current behaviour is a design choice rather than a clear rule,
 * the test says "documents current behaviour".
 */
import { describe, it, expect } from "vitest";
import { allocatePaise, calcInvoiceTotals, calcLineItem, chargeSupplyOf, type LineItemInput } from "../calc.js";
import { money } from "../money.js";

const line = (o: Partial<LineItemInput>): LineItemInput => ({
  quantity: "1",
  unitPrice: "0",
  taxPercent: "0",
  discountPercent: "0",
  ...o,
});

describe("paise rounding", () => {
  it("rounds half a paisa up (0.25 × 18% = 0.045 → 0.05)", () => {
    expect(calcLineItem(line({ unitPrice: "0.25", taxPercent: "18" })).taxAmount).toBe("0.05");
  });

  it("rounds below half a paisa down (0.24 × 18% = 0.0432 → 0.04)", () => {
    expect(calcLineItem(line({ unitPrice: "0.24", taxPercent: "18" })).taxAmount).toBe("0.04");
  });

  it("rounds qty × price to paise for 3-decimal quantities (1.333 × 99.99 = 133.28667 → 133.29)", () => {
    expect(calcLineItem(line({ quantity: "1.333", unitPrice: "99.99" })).subtotal).toBe("133.29");
  });

  it("rounds each step to paise: subtotal, then discount, then tax", () => {
    // 1.333 × 99.99 = 133.29; 7.5% = 9.99675 → 10.00; after 123.29; 12% = 14.7948 → 14.79
    const r = calcLineItem(line({ quantity: "1.333", unitPrice: "99.99", discountPercent: "7.5", taxPercent: "12" }));
    expect(r).toEqual({
      subtotal: "133.29",
      discountAmount: "10.00",
      afterDiscount: "123.29",
      taxAmount: "14.79",
      total: "138.08",
    });
  });

  it("rounds a negative half paisa toward +∞ (Math.round) — documents current behaviour", () => {
    expect(money.percent("-0.25", "18")).toBe("-0.04");
  });

  it("is exact for crore-scale values", () => {
    const r = calcLineItem(line({ quantity: "1000", unitPrice: "99999.99", taxPercent: "28" }));
    expect(r.subtotal).toBe("99999990.00");
    expect(r.taxAmount).toBe("27999997.20");
    expect(r.total).toBe("127999987.20");
  });
});

describe("line invariants", () => {
  const cases: LineItemInput[] = [
    line({ quantity: "3", unitPrice: "33.33", taxPercent: "18", discountPercent: "10" }),
    line({ quantity: "0.5", unitPrice: "0.01", taxPercent: "5" }),
    line({ quantity: "7.125", unitPrice: "12.34", taxPercent: "28", discountPercent: "33.33" }),
    line({ quantity: "1", unitPrice: "999.99", taxPercent: "0.25", discountPercent: "100" }),
    line({ quantity: "2", unitPrice: "118", taxPercent: "18", taxInclusive: true }),
  ];
  it.each(cases)("subtotal − discount = taxable, taxable + tax = total (%o)", (li) => {
    const r = calcLineItem(li);
    expect(money.sub(r.subtotal, r.discountAmount)).toBe(r.afterDiscount);
    expect(money.add(r.afterDiscount, r.taxAmount)).toBe(r.total);
  });

  it("100% discount leaves nothing to tax", () => {
    const r = calcLineItem(line({ unitPrice: "999.99", taxPercent: "18", discountPercent: "100" }));
    expect(r.afterDiscount).toBe("0.00");
    expect(r.taxAmount).toBe("0.00");
    expect(r.total).toBe("0.00");
  });
});

describe("tax-inclusive prices", () => {
  it("splits a gross price that divides cleanly (118 at 18% → 100 + 18)", () => {
    const r = calcLineItem(line({ unitPrice: "118", taxPercent: "18", taxInclusive: true }));
    expect(r).toMatchObject({ subtotal: "100.00", taxAmount: "18.00", total: "118.00" });
  });

  it("back-calculates the base per unit, so qty × gross can drift by paise — documents current behaviour", () => {
    // 100 / 1.18 = 84.745… → 84.75 per unit; × 3 = 254.25; 18% = 45.765 → 45.77
    const r = calcLineItem(line({ quantity: "3", unitPrice: "100", taxPercent: "18", taxInclusive: true }));
    expect(r.subtotal).toBe("254.25");
    expect(r.taxAmount).toBe("45.77");
    expect(r.total).toBe("300.02"); // not 300.00
  });

  it("applies the line discount to the back-calculated base", () => {
    const r = calcLineItem(line({ unitPrice: "118", taxPercent: "18", discountPercent: "10", taxInclusive: true }));
    expect(r).toMatchObject({ subtotal: "100.00", discountAmount: "10.00", afterDiscount: "90.00", taxAmount: "16.20", total: "106.20" });
  });

  it("at 0% tax the gross price is the base", () => {
    const r = calcLineItem(line({ quantity: "2", unitPrice: "49.99", taxInclusive: true }));
    expect(r).toMatchObject({ subtotal: "99.98", taxAmount: "0.00", total: "99.98" });
  });
});

describe("document totals", () => {
  const lines = [
    line({ quantity: "2", unitPrice: "500", taxPercent: "18" }), // 1000 + 180
    line({ quantity: "1", unitPrice: "250", taxPercent: "5", discountPercent: "10" }), // 225 + 11.25
  ];

  it("subtotal is the sum of taxable values after line discounts", () => {
    const t = calcInvoiceTotals({ lineItems: lines });
    expect(t).toMatchObject({ subtotal: "1225.00", lineDiscountTotal: "25.00", taxTotal: "191.25", total: "1416.25" });
  });

  it("a document discount reduces the taxable value, shared pro rata with paise that add up exactly", () => {
    // ₹100 over 1000 : 225 → 81.63 + 18.37 (largest remainder gets the odd paisa)
    const t = calcInvoiceTotals({ lineItems: lines, invoiceDiscount: "100" });
    expect(t.lines.map((l) => l.discountShare)).toEqual(["81.63", "18.37"]);
    expect(t.lines.map((l) => l.taxableValue)).toEqual(["918.37", "206.63"]);
    // tax on what is left: 918.37 × 18% = 165.31, 206.63 × 5% = 10.33
    expect(t.lines.map((l) => l.taxAmount)).toEqual(["165.31", "10.33"]);
    expect(t.taxTotal).toBe("175.64");
    expect(t.invoiceDiscountAmount).toBe("100.00");
    expect(t.taxableValue).toBe("1125.00");
    expect(t.total).toBe("1300.64");
  });

  it("a percent document discount is taken on the taxable subtotal, not the total with tax", () => {
    const t = calcInvoiceTotals({ lineItems: lines, invoiceDiscount: "10", invoiceDiscountType: "percent" });
    expect(t.invoiceDiscountAmount).toBe("122.50");
    // 900 × 18% = 162.00, 202.50 × 5% = 10.13
    expect(t.taxTotal).toBe("172.13");
    expect(t.total).toBe("1274.63");
  });

  it("allocation handles many lines and awkward ratios without losing a paisa", () => {
    const many = Array.from({ length: 7 }, (_, i) => line({ quantity: "1", unitPrice: (i * 13.37 + 1).toFixed(2), taxPercent: "12" }));
    const t = calcInvoiceTotals({ lineItems: many, invoiceDiscount: "33.33" });
    expect(money.sum(t.lines.map((l) => l.discountShare))).toBe("33.33");
    expect(money.sum(t.lines.map((l) => l.taxableValue))).toBe(money.sub(t.subtotal, "33.33"));
  });

  it("no document discount leaves every line exactly as calcLineItem has it", () => {
    const t = calcInvoiceTotals({ lineItems: lines });
    lines.forEach((li, i) => {
      const r = calcLineItem(li);
      expect(t.lines[i]).toEqual({ taxableValue: r.afterDiscount, discountShare: "0.00", taxAmount: r.taxAmount, total: r.total });
    });
  });

  it("a percent document discount rounds to paise", () => {
    const t = calcInvoiceTotals({
      lineItems: [line({ unitPrice: "99.99" })],
      invoiceDiscount: "12.5",
      invoiceDiscountType: "percent",
    });
    expect(t.invoiceDiscountAmount).toBe("12.50"); // 12.49875 → 12.50
    expect(t.total).toBe("87.49");
  });

  it("charges are taxed at the highest line rate (composite supply)", () => {
    // 1000 @ 18% and 225 @ 5%: charges take 18%. 50.75 × 18% = 9.135 → 9.14
    const t = calcInvoiceTotals({ lineItems: lines, charges: [{ amount: "50" }, { amount: "0.75" }] });
    expect(t.chargesTotal).toBe("50.75");
    expect(t.chargeTaxRate).toBe("18.00");
    expect(t.chargeTax).toBe("9.14");
    expect(t.taxTotal).toBe("200.39");
    expect(t.taxableValue).toBe("1275.75");
    expect(t.total).toBe("1476.14");
  });

  it("charges on a nil/exempt-only invoice stay untaxed", () => {
    const t = calcInvoiceTotals({ lineItems: [line({ unitPrice: "500" })], charges: [{ amount: "40" }] });
    expect(t.chargeTaxRate).toBe("0.00");
    expect(t.chargeTax).toBe("0.00");
    expect(t.total).toBe("540.00");
  });

  it("round-off can be negative and is added as given", () => {
    const t = calcInvoiceTotals({ lineItems: lines, roundOff: "-0.25" });
    expect(t.total).toBe("1416.00");
  });

  it("total = subtotal − document discount + charges + tax + round-off, always", () => {
    const t = calcInvoiceTotals({
      lineItems: lines,
      invoiceDiscount: "7.5",
      invoiceDiscountType: "percent",
      charges: [{ amount: "40" }],
      roundOff: "0.37",
    });
    const expected = money.add(
      money.sub(money.add(t.subtotal, t.taxTotal), t.invoiceDiscountAmount),
      money.add(t.chargesTotal, t.roundOff),
    );
    expect(t.total).toBe(expected);
    expect(money.add(t.taxableValue, money.add(t.taxTotal, t.roundOff))).toBe(t.total);
    // 1225 − 91.88 + 40 = 1173.12 taxable; tax 166.50 + 10.41 + 7.20 = 184.11
    expect(t.total).toBe("1357.60");
  });

  it("a flat charge passed as a one-entry charge list counts like an itemised one", () => {
    // invoice.create / document create / recurring runs send additionalCharges this way.
    const t = calcInvoiceTotals({ lineItems: lines, charges: [{ amount: "0" }] });
    expect(t.chargesTotal).toBe("0.00");
    expect(t.total).toBe("1416.25");
  });
});

describe("chargeSupplyOf — the charges part of a saved document", () => {
  it("is the document tax less the lines' tax, at the highest line rate", () => {
    expect(chargeSupplyOf(
      { additionalCharges: "100.00", taxAmount: "202.50" },
      [{ taxPercent: "18", taxAmount: "162.00" }, { taxPercent: "5", taxAmount: "22.50" }],
    )).toEqual({ taxableValue: "100.00", taxAmount: "18.00", rate: "18.00" });
  });

  it("reports charges saved before they were taxed at 0%", () => {
    expect(chargeSupplyOf(
      { additionalCharges: "50", taxAmount: "180.00" },
      [{ taxPercent: "18", taxAmount: "180.00" }],
    )).toEqual({ taxableValue: "50.00", taxAmount: "0.00", rate: "0.00" });
  });

  it("round-trips what calcInvoiceTotals saved", () => {
    const t = calcInvoiceTotals({
      lineItems: [line({ quantity: "3", unitPrice: "99.99", taxPercent: "12" }), line({ unitPrice: "10", taxPercent: "28" })],
      invoiceDiscount: "7.77",
      charges: [{ amount: "33.33" }],
    });
    const c = chargeSupplyOf(
      { additionalCharges: t.chargesTotal, taxAmount: t.taxTotal },
      t.lines.map((l, i) => ({ taxPercent: ["12", "28"][i]!, taxAmount: l.taxAmount })),
    );
    expect(c).toEqual({ taxableValue: t.chargesTotal, taxAmount: t.chargeTax, rate: t.chargeTaxRate });
  });
});

describe("allocatePaise", () => {
  it.each([
    [100, [1, 1, 1], [34, 33, 33]],
    [1, [5, 5], [1, 0]],
    [0, [3, 4], [0, 0]],
    [10, [0, 0], [0, 0]],
    [-10, [1, 3], [-3, -7]],
  ])("%i over %j → %j", (amount, weights, parts) => {
    expect(allocatePaise(amount, weights)).toEqual(parts);
  });
});
