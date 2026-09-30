/**
 * mapInvoiceToEWB and the E-Way Bill value threshold — pure rules.
 */
import { describe, it, expect } from "vitest";
import { calcInvoiceTotals, calcLineItem } from "@fintranzact/shared";
import { mapInvoiceToEWB, type InvoiceForEWB, type LineItemForEWB, type TransportDetails } from "../lib/invoice-to-ewb.js";
import { resolveEwbThreshold } from "../routers/ewayBill.js";

type Line = { quantity: string; unitPrice: string; taxPercent: string; discountPercent: string };

const transport: TransportDetails = {
  vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 150,
};

function build(lines: Line[], over: Partial<InvoiceForEWB> = {}) {
  const totals = calcInvoiceTotals({ lineItems: lines });
  const invoice: InvoiceForEWB = {
    id: "00000000-0000-0000-0000-000000000001",
    invoiceNumber: "INV-00001",
    invoiceDate: new Date("2026-06-15T06:30:00.000Z"),
    type: "sale",
    documentType: "invoice",
    subtotal: totals.subtotal,
    taxAmount: totals.taxTotal,
    totalAmount: totals.total,
    isReverseCharge: false,
    partyGstin: "27AABCP0000R1ZM", partyName: "Buyer", partyAddress: "1 Road", partyCity: "Pune",
    partyPincode: "411001", partyStateCode: "27",
    businessGstin: "27AABCU9603R1ZM", businessName: "Acme", businessAddress: "2 Road", businessCity: "Mumbai",
    businessPincode: "400001", businessStateCode: "27",
    ...over,
  };
  const items: LineItemForEWB[] = lines.map((l) => {
    const c = calcLineItem(l);
    return {
      itemName: "Widget", description: null, quantity: l.quantity, unitPrice: l.unitPrice,
      taxPercent: l.taxPercent, taxAmount: c.taxAmount, totalAmount: c.total,
      hsn: "8471", unit: "pcs", itemType: "product",
    };
  });
  return { invoice, items };
}

describe("resolveEwbThreshold", () => {
  it.each([
    [null, 50000],
    [undefined, 50000],
    ["", 50000],
    ["abc", 50000],
    ["-1", 50000],
    ["100000", 100000],
    ["0", 0],
  ])("%s → %i", (configured, expected) => {
    expect(resolveEwbThreshold(configured)).toBe(expected);
  });
});

describe("mapInvoiceToEWB", () => {
  const lines: Line[] = [
    { quantity: "10", unitPrice: "5000", taxPercent: "18", discountPercent: "10" },
    { quantity: "3", unitPrice: "999.99", taxPercent: "5", discountPercent: "0" },
  ];

  it("item taxable amounts are after the line discount and add up to the invoice value (regression: qty × price)", () => {
    const { invoice, items } = build(lines);
    const p = mapInvoiceToEWB(invoice, items, transport);
    expect(p.itemList.map((i) => i.taxableAmount)).toEqual([45000, 2999.97]);
    const sum = Math.round(p.itemList.reduce((s, i) => s + i.taxableAmount, 0) * 100) / 100;
    expect(sum).toBe(p.totalValue);
    expect(p.totalValue).toBe(Number(invoice.subtotal));
  });

  it("dates the document on the Indian calendar", () => {
    const { invoice, items } = build(lines, { invoiceDate: new Date("2026-03-31T18:30:00.000Z") });
    expect(mapInvoiceToEWB(invoice, items, transport).docDate).toBe("01/04/2026");
  });

  it("intra-state: CGST + SGST at half the rate each", () => {
    const { invoice, items } = build(lines);
    const p = mapInvoiceToEWB(invoice, items, transport);
    expect(p.itemList[0]).toMatchObject({ cgstRate: 9, sgstRate: 9, igstRate: 0 });
    expect(p.igstValue).toBe(0);
    expect(p.cgstValue + p.sgstValue).toBeCloseTo(Number(invoice.taxAmount), 2);
  });

  it("inter-state: IGST at the full rate", () => {
    const { invoice, items } = build(lines, { partyStateCode: "29", partyGstin: "29AABCG0000R1ZM" });
    const p = mapInvoiceToEWB(invoice, items, transport);
    expect(p.itemList[1]).toMatchObject({ cgstRate: 0, sgstRate: 0, igstRate: 5 });
    expect(p.igstValue).toBe(Number(invoice.taxAmount));
    expect(p.toStateCode).toBe(29);
  });

  it("a missing state code on either side counts as intra-state — documents current behaviour", () => {
    const { invoice, items } = build(lines, { partyStateCode: null, partyGstin: "29AABCG0000R1ZM" });
    expect(mapInvoiceToEWB(invoice, items, transport).igstValue).toBe(0);
  });

  it("odd-paise tax: CGST and SGST are each the rounded half, so together they can be a paisa over — documents current behaviour", () => {
    const { invoice, items } = build([{ quantity: "1", unitPrice: "0.25", taxPercent: "18", discountPercent: "0" }]);
    const p = mapInvoiceToEWB(invoice, items, transport);
    expect(invoice.taxAmount).toBe("0.05");
    expect([p.cgstValue, p.sgstValue]).toEqual([0.03, 0.03]);
  });

  it("outward for a sale (seller → buyer), inward for a purchase (supplier → us)", () => {
    const sale = build(lines);
    const s = mapInvoiceToEWB(sale.invoice, sale.items, transport);
    expect(s).toMatchObject({ supplyType: "O", fromGstin: "27AABCU9603R1ZM", toGstin: "27AABCP0000R1ZM", fromPincode: 400001 });

    const purchase = build(lines, { type: "purchase" });
    const pu = mapInvoiceToEWB(purchase.invoice, purchase.items, transport);
    expect(pu).toMatchObject({ supplyType: "I", fromGstin: "27AABCP0000R1ZM", toGstin: "27AABCU9603R1ZM", fromPincode: 411001 });
  });

  it("an unregistered party is URP", () => {
    const { invoice, items } = build(lines, { partyGstin: null });
    expect(mapInvoiceToEWB(invoice, items, transport).toGstin).toBe("URP");
  });

  it.each([
    ["invoice", "INV"],
    ["credit_note", "CRN"],
    ["debit_note", "DBN"],
    ["delivery_challan", "INV"],
    ["sales_return", "INV"],
  ])("document type %s → %s", (documentType, code) => {
    const { invoice, items } = build(lines, { documentType });
    expect(mapInvoiceToEWB(invoice, items, transport).docType).toBe(code);
  });

  it("maps the transport mode and vehicle type", () => {
    const { invoice, items } = build(lines);
    expect(mapInvoiceToEWB(invoice, items, { ...transport, transportMode: "rail", vehicleType: "over_dimensional" }))
      .toMatchObject({ transMode: "2", vehicleType: "O" });
  });
});
