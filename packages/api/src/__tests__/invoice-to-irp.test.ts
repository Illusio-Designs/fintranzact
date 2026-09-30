/**
 * mapInvoiceToIRP — pure mapping rules not covered by the e-invoicing
 * integration suite: document-type codes, the IST document date, the
 * CGST/SGST odd-paise split, and that ValDtls adds up the way the IRP
 * validates it (TotInvVal = AssVal + taxes + OthChrg − Discount + RndOffAmt).
 *
 * Supply type (B2B / SEZ / EXP) and the place-of-supply fallbacks are covered
 * in integration/e-invoicing.test.ts.
 */
import { describe, it, expect } from "vitest";
import { calcInvoiceTotals, calcLineItem } from "@fintranzact/shared";
import { mapInvoiceToIRP, type IRPInvoice, type IRPLineItem } from "../lib/invoice-to-irp.js";

const seller = {
  gstin: "27AABCU9603R1ZM", legalName: null, name: "Acme", address: null, city: null,
  state: "Maharashtra", stateCode: "27", pincode: "400001", phone: null, email: null,
};
const buyer = (over: Record<string, unknown> = {}) => ({
  gstin: "27AABCP0000R1ZM", name: "Buyer", billingAddress: null, city: null,
  state: "Maharashtra", stateCode: "27", pincode: "411001", phone: null, email: null,
  ...over,
});

type Line = { quantity: string; unitPrice: string; taxPercent: string; discountPercent: string };

/** Build an invoice + lines the way invoice.create stores them. */
function build(lines: Line[], opts: { discount?: string; charges?: string; roundOff?: string; documentType?: string; date?: Date; rcm?: boolean } = {}) {
  const totals = calcInvoiceTotals({
    lineItems: lines,
    charges: [{ amount: opts.charges ?? "0" }],
    invoiceDiscount: opts.discount ?? "0",
    roundOff: opts.roundOff ?? "0",
  });
  const invoice: IRPInvoice = {
    invoiceNumber: "INV-00001",
    invoiceDate: opts.date ?? new Date("2026-06-15T06:30:00.000Z"),
    type: "sale",
    documentType: opts.documentType ?? "invoice",
    subtotal: totals.subtotal,
    taxAmount: totals.taxTotal,
    discountAmount: totals.invoiceDiscountAmount,
    additionalCharges: totals.chargesTotal,
    roundOff: totals.roundOff,
    totalAmount: totals.total,
    isReverseCharge: opts.rcm ?? false,
  };
  const items: IRPLineItem[] = lines.map((l) => {
    const c = calcLineItem(l);
    return {
      itemName: "Widget", description: null, ...l,
      taxAmount: c.taxAmount, totalAmount: c.total,
      selectedUnit: "pcs", itemType: "product", itemHsn: "8471",
    };
  });
  return { invoice, items };
}

function balance(v: ReturnType<typeof mapInvoiceToIRP>["ValDtls"]) {
  const r = v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + (v.OthChrg ?? 0) - (v.Discount ?? 0) + (v.RndOffAmt ?? 0);
  return Math.round(r * 100) / 100;
}

describe("DocDtls.Typ — document type mapping", () => {
  it.each([
    ["invoice", "INV"],
    ["credit_note", "CRN"],
    ["sales_return", "CRN"],
    ["debit_note", "DBN"],
    ["purchase_return", "DBN"],
    ["proforma", "INV"],
  ])("%s → %s", (documentType, typ) => {
    const { invoice, items } = build([{ quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }], { documentType });
    expect(mapInvoiceToIRP(invoice, items, buyer(), seller).DocDtls.Typ).toBe(typ);
  });
});

describe("DocDtls.Dt — the invoice's date in India", () => {
  it("an invoice dated 1 April in India (18:30 UTC on 31 March) is 01/04", () => {
    const { invoice, items } = build(
      [{ quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }],
      { date: new Date("2026-03-31T18:30:00.000Z") },
    );
    expect(mapInvoiceToIRP(invoice, items, buyer(), seller).DocDtls.Dt).toBe("01/04/2026");
  });

  it("23:59 IST on 31 March stays 31/03", () => {
    const { invoice, items } = build(
      [{ quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }],
      { date: new Date("2026-03-31T18:29:00.000Z") },
    );
    expect(mapInvoiceToIRP(invoice, items, buyer(), seller).DocDtls.Dt).toBe("31/03/2026");
  });
});

describe("tax split", () => {
  it("intra-state odd paise: CGST gets the rounded half, SGST the rest, so they add to the line tax", () => {
    // 0.25 × 18% = 0.05 → CGST 0.03 (Math.round(2.5)), SGST 0.02
    const { invoice, items } = build([{ quantity: "1", unitPrice: "0.25", taxPercent: "18", discountPercent: "0" }]);
    const r = mapInvoiceToIRP(invoice, items, buyer(), seller);
    expect(r.ItemList[0]).toMatchObject({ CgstAmt: 0.03, SgstAmt: 0.02, IgstAmt: 0 });
  });

  it("inter-state puts the whole tax in IGST", () => {
    const { invoice, items } = build([{ quantity: "3", unitPrice: "33.33", taxPercent: "12", discountPercent: "0" }]);
    const r = mapInvoiceToIRP(invoice, items, buyer({ gstin: "29AABCG0000R1ZM", stateCode: "29" }), seller);
    expect(r.ItemList[0]).toMatchObject({ AssAmt: 99.99, IgstAmt: 12, CgstAmt: 0, SgstAmt: 0 });
  });

  it("marks reverse charge on TranDtls.RegRev", () => {
    const { invoice, items } = build([{ quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }], { rcm: true });
    expect(mapInvoiceToIRP(invoice, items, buyer(), seller).TranDtls.RegRev).toBe("Y");
  });
});

describe("ValDtls adds up to TotInvVal", () => {
  const lines: Line[] = [
    { quantity: "2", unitPrice: "1000", taxPercent: "18", discountPercent: "10" },
    { quantity: "1.5", unitPrice: "333.33", taxPercent: "5", discountPercent: "0" },
    { quantity: "7", unitPrice: "12.99", taxPercent: "28", discountPercent: "2.5" },
  ];

  it("with line discounts only (regression: they were subtracted a second time as ValDtls.Discount)", () => {
    const { invoice, items } = build(lines);
    const r = mapInvoiceToIRP(invoice, items, buyer(), seller);
    expect(r.ValDtls.Discount).toBe(0);
    expect(r.ValDtls.AssVal).toBe(Number(invoice.subtotal));
    expect(balance(r.ValDtls)).toBe(r.ValDtls.TotInvVal);
  });

  it("with a document discount, charges and round-off", () => {
    const { invoice, items } = build(lines, { discount: "150", charges: "80", roundOff: "-0.42" });
    const r = mapInvoiceToIRP(invoice, items, buyer(), seller);
    expect(r.ValDtls.Discount).toBe(150);
    expect(r.ValDtls.OthChrg).toBe(80);
    expect(r.ValDtls.RndOffAmt).toBe(-0.42);
    expect(balance(r.ValDtls)).toBe(r.ValDtls.TotInvVal);
  });

  it("inter-state too", () => {
    const { invoice, items } = build(lines, { discount: "10" });
    const r = mapInvoiceToIRP(invoice, items, buyer({ gstin: "07AABCG0000R1ZM", stateCode: "07" }), seller);
    expect(balance(r.ValDtls)).toBe(r.ValDtls.TotInvVal);
  });

  it("uses the invoice's paise maths for each line (regression: float qty × price gave 15.04 for 1.5 × 10.03, the invoice 15.05)", () => {
    const { invoice, items } = build([
      { quantity: "1.5", unitPrice: "10.03", taxPercent: "18", discountPercent: "0" },
      { quantity: "0.125", unitPrice: "10.04", taxPercent: "5", discountPercent: "0" },
    ]);
    const r = mapInvoiceToIRP(invoice, items, buyer(), seller);
    expect(r.ItemList.map((i) => i.TotAmt)).toEqual([15.05, 1.26]);
    expect(r.ValDtls.AssVal).toBe(Number(invoice.subtotal));
    expect(balance(r.ValDtls)).toBe(r.ValDtls.TotInvVal);
  });

  it("line values match what the invoice stored (AssAmt + tax = TotItemVal = line total)", () => {
    const { invoice, items } = build(lines);
    const r = mapInvoiceToIRP(invoice, items, buyer(), seller);
    r.ItemList.forEach((it, i) => {
      expect(it.TotItemVal).toBe(Number(items[i]!.totalAmount));
      expect(Math.round((it.CgstAmt + it.SgstAmt + it.IgstAmt) * 100) / 100).toBe(Number(items[i]!.taxAmount));
    });
  });
});

describe("item details", () => {
  it("maps services, HSN default and units", () => {
    const { invoice, items } = build([{ quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }]);
    const svc = { ...items[0]!, itemType: "service", itemHsn: null, selectedUnit: "kg" };
    const odd = { ...items[0]!, selectedUnit: "furlong" };
    const r = mapInvoiceToIRP(invoice, [svc, odd], buyer(), seller);
    expect(r.ItemList[0]).toMatchObject({ IsServc: "Y", HsnCd: "9999", Unit: "KGS", SlNo: "1" });
    expect(r.ItemList[1]).toMatchObject({ IsServc: "N", Unit: "OTH", SlNo: "2" });
  });

  it("refuses without a seller GSTIN, and for an unregistered domestic buyer", () => {
    const { invoice, items } = build([{ quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }]);
    expect(() => mapInvoiceToIRP(invoice, items, buyer(), { ...seller, gstin: null })).toThrow(/Business GSTIN/);
    expect(() => mapInvoiceToIRP(invoice, items, buyer({ gstin: null }), seller)).toThrow(/Party GSTIN/);
  });
});
