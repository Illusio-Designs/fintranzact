import { describe, it, expect } from "vitest";
import { buildCmp08Quarter, type Cmp08Document } from "../lib/cmp08.js";
import { buildGstr4, classifyGstr4Purchase, type Gstr4PurchaseDocument } from "../lib/gstr4.js";

const FY = "2026-27";
const sale = (documentType: string, subtotal: string): Cmp08Document =>
  ({ documentType, subtotal, discountAmount: "0", additionalCharges: "0" });
const purchase = (o: Partial<Gstr4PurchaseDocument> & { subtotal: string }): Gstr4PurchaseDocument => ({
  documentType: "invoice", discountAmount: "0", additionalCharges: "0", taxAmount: "0",
  isReverseCharge: false, interState: false, partyGstin: "27AAAAA0000A1Z5", partyRegistrationType: "regular", ...o,
});
const quarters = (outward: Cmp08Document[][] = [[], [], [], []], rcm: Parameters<typeof buildCmp08Quarter>[0]["rcm"][] = [[], [], [], []]) =>
  ([1, 2, 3, 4] as const).map((quarter) =>
    buildCmp08Quarter({ financialYear: FY, quarter, outward: outward[quarter - 1], rcm: rcm[quarter - 1], category: "manufacturer_trader" }));

describe("classifyGstr4Purchase", () => {
  it("separates registered, unregistered, RCM and imports", () => {
    expect(classifyGstr4Purchase(purchase({ subtotal: "1" }))).toBe("registered_non_rcm");
    expect(classifyGstr4Purchase(purchase({ subtotal: "1", isReverseCharge: true }))).toBe("registered_rcm");
    expect(classifyGstr4Purchase(purchase({ subtotal: "1", partyGstin: null, partyRegistrationType: "unregistered" }))).toBe("unregistered_non_rcm");
    expect(classifyGstr4Purchase(purchase({ subtotal: "1", partyGstin: null, partyRegistrationType: null, isReverseCharge: true }))).toBe("unregistered_rcm");
    expect(classifyGstr4Purchase(purchase({ subtotal: "1", partyGstin: null, partyRegistrationType: "overseas" }))).toBe("import_of_services");
  });
});

describe("buildGstr4", () => {
  it("groups inward supplies, taking RCM tax by head and netting credit notes", () => {
    const r = buildGstr4({
      financialYear: FY, isComposition: true, quarters: quarters(),
      purchases: [
        purchase({ subtotal: "10000", taxAmount: "1800" }),
        purchase({ subtotal: "2000", taxAmount: "360", partyGstin: null, partyRegistrationType: "unregistered" }),
        purchase({ subtotal: "5000", taxAmount: "900", isReverseCharge: true }),
        purchase({ documentType: "credit_note", subtotal: "1000", taxAmount: "180", isReverseCharge: true }),
        purchase({ subtotal: "4000", taxAmount: "720", isReverseCharge: true, interState: true, partyGstin: null, partyRegistrationType: "unregistered" }),
        purchase({ subtotal: "8000", taxAmount: "1440", partyGstin: null, partyRegistrationType: "overseas", isReverseCharge: true }),
      ],
    });
    const row = (k: string) => r.inward.rows.find((x) => x.kind === k)!;
    expect(row("registered_non_rcm")).toMatchObject({ taxableValue: "10000.00", tax: "0.00" });
    expect(row("unregistered_non_rcm")).toMatchObject({ taxableValue: "2000.00", tax: "0.00" });
    expect(row("registered_rcm")).toMatchObject({ taxableValue: "4000.00", centralTax: "360.00", stateTax: "360.00", tax: "720.00" });
    expect(row("unregistered_rcm")).toMatchObject({ integratedTax: "720.00", centralTax: "0.00" });
    expect(row("import_of_services")).toMatchObject({ integratedTax: "1440.00", cess: "0.00" });
    expect(r.inward.totalRcmTax).toBe("2880.00");
  });

  it("takes outward turnover and tax from the CMP-08 quarters, net of credit notes, across the FY boundary", () => {
    const r = buildGstr4({
      financialYear: FY, isComposition: true,
      quarters: quarters([[sale("invoice", "100000")], [sale("invoice", "50000"), sale("credit_note", "10000")], [], [sale("invoice", "20000")]]),
      purchases: [],
    });
    expect(r.outward.quarters.map((q) => q.taxableValue)).toEqual(["100000.00", "40000.00", "0.00", "20000.00"]);
    expect(r.outward.taxableValue).toBe("160000.00");
    expect(r.outward.tax).toBe("1600.00");
    expect(r.rateWise).toEqual([{ rate: "1", taxableValue: "160000.00", centralTax: "800.00", stateTax: "800.00", integratedTax: "0.00", tax: "1600.00" }]);
    expect(r.outward.exempt).toBe("0.00");
    expect(r.dueDate.toISOString()).toBe("2027-04-29T18:30:00.000Z");
  });

  const withTax = () => quarters(
    [[sale("invoice", "100000")], [sale("invoice", "100000")], [sale("invoice", "100000")], [sale("invoice", "100000")]],
    [[], [{ ...sale("invoice", "1000"), taxAmount: "180", interState: false }], [], []],
  );

  it("assumes Q1-Q3 paid in full when no amount is given and leaves Q4 as the balance", () => {
    const r = buildGstr4({ financialYear: FY, isComposition: true, quarters: withTax(), purchases: [] });
    expect(r.taxPaid.paidAssumed).toBe(true);
    expect(r.taxPaid.compositionTaxPayable).toBe("4000.00");
    expect(r.taxPaid.rcmTaxPayable).toBe("180.00");
    expect(r.taxPaid.totalPayable).toBe("4180.00");
    expect(r.taxPaid.paidThroughCmp08).toBe("3180.00");
    expect(r.taxPaid.balancePayable).toBe("1000.00");
    expect(r.taxPaid.lateFee).toBe("0.00");
  });

  it("uses given paid amounts and flags assumption only for the missing ones", () => {
    const r = buildGstr4({ financialYear: FY, isComposition: true, quarters: withTax(), purchases: [], cmp08Paid: { 1: "500", 2: "1180", 3: "1000" } });
    expect(r.taxPaid.paidAssumed).toBe(false);
    expect(r.taxPaid.paidThroughCmp08).toBe("2680.00");
    expect(r.taxPaid.balancePayable).toBe("1500.00");
    const partial = buildGstr4({ financialYear: FY, isComposition: true, quarters: withTax(), purchases: [], cmp08Paid: { 1: "1000" } });
    expect(partial.taxPaid.paidAssumed).toBe(true);
    expect(partial.taxPaid.quarters.map((q) => q.paidAssumed)).toEqual([false, true, true, false]);
  });

  it("reports excess payment instead of a negative balance", () => {
    const r = buildGstr4({ financialYear: FY, isComposition: true, quarters: quarters(), purchases: [], cmp08Paid: { 1: "100" } });
    expect(r.taxPaid.balancePayable).toBe("0.00");
    expect(r.taxPaid.excessPaid).toBe("100.00");
  });

  it("flags a non-composition business", () => {
    const r = buildGstr4({ financialYear: FY, isComposition: false, quarters: quarters(), purchases: [] });
    expect(r.isComposition).toBe(false);
    expect(r.notes.join(" ")).toMatch(/not registered under the composition/);
  });
});
