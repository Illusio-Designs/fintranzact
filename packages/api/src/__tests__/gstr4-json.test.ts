import { describe, it, expect } from "vitest";
import { buildCmp08Quarter, type Cmp08Document } from "../lib/cmp08.js";
import { buildGstr4, type Gstr4PurchaseDocument } from "../lib/gstr4.js";
import { gstr4ToPortalJson, GSTR4_PORTAL_KEYS } from "../lib/gstr4-json.js";

const FY = "2026-27";
const sale = (subtotal: string): Cmp08Document => ({ documentType: "invoice", subtotal, discountAmount: "0", additionalCharges: "0" });
const purchase = (o: Partial<Gstr4PurchaseDocument> & { subtotal: string }): Gstr4PurchaseDocument => ({
  documentType: "invoice", discountAmount: "0", additionalCharges: "0", taxAmount: "0",
  isReverseCharge: false, interState: false, partyGstin: "27AAAAA0000A1Z5", partyRegistrationType: "regular", ...o,
});
const report = () => buildGstr4({
  financialYear: FY, isComposition: true,
  quarters: ([1, 2, 3, 4] as const).map((quarter) =>
    buildCmp08Quarter({ financialYear: FY, quarter, outward: [sale("100000")], rcm: [], category: "manufacturer_trader" })),
  purchases: [
    purchase({ subtotal: "10000" }),
    purchase({ subtotal: "5000", taxAmount: "900", isReverseCharge: true }),
    purchase({ subtotal: "2000", taxAmount: "360", isReverseCharge: true, partyGstin: null, partyRegistrationType: "unregistered" }),
    purchase({ subtotal: "1000", partyGstin: null, partyRegistrationType: "unregistered" }),
  ],
  cmp08Paid: { 1: "1000", 2: "1000", 3: "1000", 4: "0" },
});

describe("gstr4ToPortalJson", () => {
  const json = gstr4ToPortalJson(report(), { gstin: "27AAAAA0000A1Z5", fy: FY }) as any;

  it("carries the header and number amounts", () => {
    expect(json[GSTR4_PORTAL_KEYS.gstin]).toBe("27AAAAA0000A1Z5");
    expect(json[GSTR4_PORTAL_KEYS.fy]).toBe(FY);
    expect(json.table4["4A"].txval).toBe(10000);
  });

  it("merges unregistered rows into one code and keeps RCM tax by head", () => {
    expect(json.table4["4B"]).toMatchObject({ txval: 5000, camt: 450, samt: 450, iamt: 0 });
    expect(json.table4["4C"]).toMatchObject({ txval: 3000, camt: 180, samt: 180 });
    expect(json.table4["4D"].txval).toBe(0);
  });

  it("maps outward turnover by quarter, rate-wise tax and tax paid", () => {
    expect(json.table5.txval).toBe(400000);
    expect(json.table5.qtrs).toHaveLength(4);
    expect(json.table5.qtrs[0]).toEqual({ qtr: 1, txval: 100000, rt: 1, tax: 1000, rcm_tax: 0, tot_tax: 1000 });
    expect(json.table6.outward).toEqual([{ rt: 1, txval: 400000, camt: 2000, samt: 2000, iamt: 0 }]);
    expect(json.table6.inward_rcm).toMatchObject({ txval: 0, camt: 0 });
    expect(json.table7).toEqual({ tds: 0, tcs: 0 });
    expect(json.table8).toMatchObject({ cmp_tax: 4000, rcm_tax: 0, tot_tax: 4000, paid_cmp08: 3000, bal_pay: 1000, excess_paid: 0, lfee: 0 });
  });

  it("serialises to plain JSON", () => {
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});
