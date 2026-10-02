import { describe, it, expect } from "vitest";
import { buildCmp08Quarter, type Cmp08Document, type Cmp08RcmDocument } from "../lib/cmp08.js";

const doc = (documentType: string, subtotal: string, discountAmount = "0", additionalCharges = "0"): Cmp08Document =>
  ({ documentType, subtotal, discountAmount, additionalCharges });
const rcm = (documentType: string, subtotal: string, taxAmount: string, interState = false): Cmp08RcmDocument =>
  ({ ...doc(documentType, subtotal), taxAmount, interState });

const base = { financialYear: "2026-27", quarter: 1 as const, outward: [], rcm: [], category: "manufacturer_trader" as const };

describe("buildCmp08Quarter", () => {
  it("nets credit notes and returns against invoices and debit notes", () => {
    const q = buildCmp08Quarter({
      ...base,
      outward: [doc("invoice", "10000"), doc("debit_note", "500"), doc("credit_note", "1500", "0", "0"), doc("sales_return", "1000")],
    });
    expect(q.taxableValue).toBe("8000.00");
    expect(q.taxPayable).toBe("80.00");
    expect(q.centralTax).toBe("40.00");
    expect(q.stateTax).toBe("40.00");
    expect(q.integratedTax).toBe("0.00");
  });

  it("takes discount off and charges on", () => {
    const q = buildCmp08Quarter({ ...base, outward: [doc("invoice", "1000", "100", "50")] });
    expect(q.taxableValue).toBe("950.00");
  });

  it("applies the category rate and an override", () => {
    const outward = [doc("invoice", "100000")];
    expect(buildCmp08Quarter({ ...base, outward, category: "restaurant" }).taxPayable).toBe("5000.00");
    expect(buildCmp08Quarter({ ...base, outward, category: "other_service" }).rate).toBe("6");
    expect(buildCmp08Quarter({ ...base, outward, category: "other_service", rateOverride: "3" }).taxPayable).toBe("3000.00");
  });

  it("splits an odd paisa so central + state equal the tax", () => {
    const q = buildCmp08Quarter({ ...base, outward: [doc("invoice", "1.50")] });
    expect(q.taxPayable).toBe("0.02");
    expect(Number(q.centralTax) + Number(q.stateTax)).toBeCloseTo(0.02, 10);
  });

  it("reports reverse-charge tax by head, net of supplier credit notes", () => {
    const q = buildCmp08Quarter({
      ...base,
      rcm: [rcm("invoice", "10000", "1800"), rcm("invoice", "5000", "900", true), rcm("credit_note", "1000", "180")],
    });
    expect(q.rcm.taxableValue).toBe("14000.00");
    expect(q.rcm.centralTax).toBe("810.00");
    expect(q.rcm.stateTax).toBe("810.00");
    expect(q.rcm.integratedTax).toBe("900.00");
    expect(q.rcm.tax).toBe("2520.00");
  });

  it("has an empty quarter at zero", () => {
    const q = buildCmp08Quarter(base);
    expect([q.taxableValue, q.taxPayable, q.interest, q.rcm.tax]).toEqual(["0.00", "0.00", "0.00", "0.00"]);
  });

  it("works out interest only when the payment date is known", () => {
    const outward = [doc("invoice", "100000")];
    expect(buildCmp08Quarter({ ...base, outward }).interestBasis).toBe("payment_date_unknown");
    const late = buildCmp08Quarter({ ...base, outward, paidOn: new Date("2026-08-17T06:00:00Z") }); // 30 days after 18 Jul
    expect(late.interestBasis).toBe("paid_late");
    expect(late.interest).toBe("14.79"); // 1000 x 18% x 30 / 365
    const onTime = buildCmp08Quarter({ ...base, outward, paidOn: new Date("2026-07-18T06:00:00Z") });
    expect(onTime.interestBasis).toBe("paid_on_time_or_not_late");
    expect(onTime.interest).toBe("0.00");
  });

  it("files CMP-08 for Q4 too: due 18 April, tax and interest worked out like any quarter", () => {
    const q = buildCmp08Quarter({ ...base, quarter: 4, outward: [doc("invoice", "100000")], paidOn: new Date("2027-05-18T06:00:00Z") });
    expect(q.cmp08Applicable).toBe(true);
    expect(q.dueDate.toISOString()).toBe("2027-04-17T18:30:00.000Z"); // 18 Apr 2027 IST
    expect(q.taxPayable).toBe("1000.00");
    expect(q.interestBasis).toBe("paid_late");
    expect(q.interest).toBe("14.79"); // 30 days late
  });

  it("follows the business overrides at once: rate, CMP-08 due day and interest rate", () => {
    const outward = [doc("invoice", "100000")];
    const paidOn = new Date("2026-08-17T06:00:00Z");
    const def = buildCmp08Quarter({ ...base, outward, paidOn });
    const custom = buildCmp08Quarter({ ...base, outward, paidOn, overrides: { rate: "2", cmp08DueDay: 28, interestRate: "12" } });
    expect(def).toMatchObject({ rate: "1", taxPayable: "1000.00", interest: "14.79", interestRatePercent: "18" });
    expect(custom).toMatchObject({ rate: "2", taxPayable: "2000.00", interestRatePercent: "12" });
    expect(custom.dueDate.toISOString()).toBe("2026-07-27T18:30:00.000Z"); // 28 Jul IST
    expect(custom.interest).toBe("13.15"); // 2000 x 12% x 20 / 365
  });
});
