/**
 * gst-month-reports.test.ts — Regression tests for what the J9 (GST filing)
 * and J10 (dashboard & reports) e2e journeys found, on the same kind of
 * month: B2B same/other state, B2C small, B2C large, an exempt (0%) sale,
 * a service, supplier bills with the supplier's own bill numbers, and
 * credit notes to an unregistered (CDNUR) and a registered (CDNR) buyer.
 *
 *   - GSTR-1's HSN summary is net of the credit notes; the portal JSON puts
 *     0% B2C supplies in `nil`, not in `b2cs`; the CSV carries B2CL, the
 *     notes and the HSN summary.
 *   - GSTR-9 table 4I splits a credit note's tax by head (IGST stays IGST)
 *     and 0% supplies go to table 5 (nil-rated), not table 4.
 *   - GSTR-2B matches a bill on the supplier's invoice number, and compares
 *     the taxable value after the document discount.
 *   - P&L and the dashboard's profit are net of credit notes; the dashboard's
 *     invoice status is sale invoices only and its payment modes receipts
 *     only; month-on-month labels are the right months.
 *   - The Outstanding report, aging, sales register, tax summary and day
 *     book take credit notes off; the day book's days are Indian days.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { istDateParts, istStartOfDay } from "@fintranzact/shared";
import { createTestWorld, createParty, createItem, type TestWorld } from "../helpers/fixtures.js";
import { callerFor } from "../helpers/assertions.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";

let world: TestWorld;
const caller = () => callerFor(world, "ramesh");

// August 2025, read on the Indian calendar
const Y = 2025;
const M = 8;
const day = (d: number) => istStartOfDay(Y, M, d).toISOString();
const range = { fromDate: istStartOfDay(Y, M, 1).toISOString(), toDate: new Date(istStartOfDay(Y, M + 1, 1).getTime() - 1).toISOString() };

const ids: Record<string, string> = {};
const p: Record<string, string> = {};
const it_: Record<string, string> = {};

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  const b = world.business1.id;
  await seedChartOfAccounts(db, b);
  const party = async (key: string, o: Record<string, unknown>) => { p[key] = (await createParty(db, b, { name: key, ...o })).id; };
  await party("pune", { gstin: "27AAACR5055K1Z5", state: "Maharashtra", stateCode: "27" });
  await party("tumkur", { gstin: "29AABCT1332L1ZT", state: "Karnataka", stateCode: "29" });
  await party("ramesh", { gstin: null, state: "Maharashtra", stateCode: "27" });
  await party("anand", { gstin: null, state: "Gujarat", stateCode: "24" });
  await party("bhiwandi", { type: "supplier", gstin: "27AADCB2230M1ZT", state: "Maharashtra", stateCode: "27" });
  await party("bengaluru", { type: "supplier", gstin: "29AAGCB7383J1Z4", state: "Karnataka", stateCode: "29" });
  const item = async (key: string, o: Record<string, unknown>) => { it_[key] = (await createItem(db, b, { name: key, stockQuantity: "0", ...o })).id; };
  await item("bracket", { hsn: "7326", unit: "pcs", taxPercent: "18" });
  await item("tonic", { hsn: "3004", unit: "btl", taxPercent: "12" });
  await item("rice", { hsn: "1006", unit: "kg", taxPercent: "0" });
  await item("install", { hsn: "998719", unit: "other", itemType: "service", taxPercent: "18" });

  const line = (item: string, quantity: number, unitPrice: number, taxPercent: number) => ({
    itemId: it_[item], itemName: item, quantity: String(quantity), unitPrice: unitPrice.toFixed(2), taxPercent: String(taxPercent), discountPercent: "0",
  });
  const c = caller();
  const doc = async (key: string, input: Record<string, unknown>) => {
    ids[key] = (await c.invoice.create({ status: "sent", ...input } as never)).id;
    await c.invoice.updateStatus({ id: ids[key], status: "sent" });
  };
  await doc("boundary", { partyId: p.ramesh, type: "sale", invoiceDate: day(1), lineItems: [line("install", 1, 2000, 18)] });
  await doc("bill118", { partyId: p.bhiwandi, type: "purchase", supplierInvoiceNumber: "BPD/2526/118", invoiceDate: day(2), lineItems: [line("bracket", 120, 700, 18), line("rice", 100, 35, 0)] });
  // A ₹600 discount on the Bengaluru bill: taxable ₹8,400, IGST ₹1,008
  await doc("bill42", { partyId: p.bengaluru, type: "purchase", supplierInvoiceNumber: "KAR-INV-0042", invoiceDate: day(3), invoiceDiscount: "600", lineItems: [line("tonic", 30, 300, 12)] });
  await doc("b2bIntra", { partyId: p.pune, type: "sale", invoiceDate: day(4), lineItems: [line("bracket", 10, 1000, 18), line("tonic", 4, 500, 12)] });
  await doc("b2bInter", { partyId: p.tumkur, type: "sale", invoiceDate: day(5), invoiceDiscount: "500", lineItems: [line("tonic", 20, 500, 12)] });
  await doc("b2cl", { partyId: p.anand, type: "sale", invoiceDate: day(8), lineItems: [line("bracket", 100, 1000, 18)] });
  await doc("exempt", { partyId: p.ramesh, type: "sale", invoiceDate: day(10), lineItems: [line("rice", 40, 50, 0)] });
  await doc("bill131", { partyId: p.bhiwandi, type: "purchase", supplierInvoiceNumber: "BPD/2526/131", invoiceDate: day(11), lineItems: [line("bracket", 10, 700, 18)] });
  ids.cnUnreg = (await c.creditNote.create({ partyId: p.anand, type: "sale", documentType: "credit_note", referenceDocumentId: ids.b2cl, invoiceDate: day(12), lineItems: [line("bracket", 10, 1000, 18)] } as never)).id;
  ids.cnReg = (await c.creditNote.create({ partyId: p.pune, type: "sale", documentType: "credit_note", referenceDocumentId: ids.b2bIntra, invoiceDate: day(15), lineItems: [line("bracket", 2, 1000, 18)] } as never)).id;
  for (const k of ["cnUnreg", "cnReg"]) await c.creditNote.updateStatus({ id: ids[k], status: "sent" });
  await c.payment.create({ partyId: p.pune, invoiceId: ids.b2bIntra, amount: "10000", mode: "cash", paymentDate: day(20) } as never);
  await c.payment.create({ partyId: p.bengaluru, invoiceId: ids.bill42, amount: "9408", mode: "cash", paymentDate: day(21) } as never);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("GSTR-1", () => {
  it("HSN summary is net of the credit notes (12 brackets credited)", async () => {
    const r = await caller().gst.gstr1({ year: Y, month: M });
    const row = (hsn: string) => r.hsn.find((h) => h.hsn === hsn);
    expect(row("7326")).toMatchObject({ uqc: "PCS", rate: 18, quantity: 98, taxableValue: 98000, cgst: 720, sgst: 720, igst: 16200 });
    expect(row("998719")).toMatchObject({ uqc: "NA", quantity: 0, taxableValue: 2000 });
    expect(r.hsn.reduce((s, h) => s + h.taxableValue, 0)).toBe(r.totalTaxableValue - 12000);
  });

  it("portal JSON: 0% B2C supplies go to `nil`, not `b2cs`; notes to cdnr / cdnur", async () => {
    const { json } = await caller().gst.gstr1Json({ year: Y, month: M });
    const j = json as Record<string, any>;
    expect(j.b2cs).toEqual([{ sply_ty: "INTRA", pos: "27", typ: "OE", txval: 2000, rt: 18, camt: 180, samt: 180, iamt: 0, csamt: 0 }]);
    expect(j.nil).toEqual({ inv: [{ sply_ty: "INTRAB2C", nil_amt: 2000, expt_amt: 0, ngsup_amt: 0 }] });
    expect(j.cdnur).toHaveLength(1);
    expect(j.cdnur[0]).toMatchObject({ typ: "B2CL", ntty: "C", pos: "24", val: 11800 });
    expect(j.cdnr[0].ctin).toBe("27AAACR5055K1Z5");
  });

  it("CSV carries B2CL, the notes with their table and the HSN summary", async () => {
    const { csv } = await caller().gst.gstr1CSV({ year: Y, month: M });
    expect(csv).toContain("B2CL - Outward Supplies to Unregistered Persons (Large; inter-state)");
    expect(csv).toMatch(/\nCDNUR,Credit,[^,]+,12\/08\/2025,[^,]+,,"anand",10000\.00,0\.00,0\.00,1800\.00,11800\.00/);
    expect(csv).toMatch(/\nCDNR,Credit,[^,]+,15\/08\/2025,[^,]+,27AAACR5055K1Z5,"pune",2000\.00,180\.00,180\.00,0\.00,2360\.00/);
    expect(csv).toContain('7326,"bracket",PCS,98,18,98000.00,720.00,720.00,16200.00');
  });
});

describe("GSTR-9", () => {
  it("4I splits the notes' tax by head; 0% supplies are table 5 nil-rated, not table 4", async () => {
    const r = await caller().gst.gstr9({ financialYear: 2025 });
    expect(r.table4.creditNotes).toMatchObject({ taxableValue: 12000, cgst: 180, sgst: 180, igst: 1800 });
    expect(r.table4.taxableSuppliesB2C).toMatchObject({ taxableValue: 102000, cgst: 180, sgst: 180, igst: 18000 });
    expect(r.table5.nilRated.taxableValue).toBe(2000);
    const { json } = await caller().gst.gstr9Json({ financialYear: 2025 });
    expect((json as any).table5["5B"]).toEqual({ txval: 2000 });
  });
});

describe("GSTR-2B", () => {
  it("matches bills on the supplier's invoice number and the taxable value after discount", async () => {
    const content = JSON.stringify({
      data: {
        docdata: {
          b2b: [
            { ctin: "27AADCB2230M1ZT", inv: [{ inum: "BPD/2526/118", dt: "02-08-2025", val: 102620, items: [{ rt: 18, txval: 84000, cgst: 7560, sgst: 7560 }, { rt: 0, txval: 3500 }] }] },
            { ctin: "29AAGCB7383J1Z4", inv: [{ inum: "KAR-INV-0042", dt: "03-08-2025", val: 9408, items: [{ rt: 12, txval: 8400, igst: 1008 }] }] },
            { ctin: "27AAFCT2114Q1ZK", inv: [{ inum: "TPK-77", dt: "09-08-2025", val: 5900, items: [{ rt: 18, txval: 5000, cgst: 450, sgst: 450 }] }] },
          ],
        },
      },
    });
    const up = await caller().gstr2b.upload({ returnPeriod: "2025-08", content, fileName: "2b.json", format: "json" });
    expect(up).toMatchObject({ totalRecords: 3, matchedRecords: 2, missingInBooks: 1 });
    const missing = await caller().gstr2b.missingIn2B({ returnPeriod: "2025-08", page: 1, limit: 25 });
    expect(missing.records.map((r) => r.supplierInvoiceNumber)).toEqual(["BPD/2526/131"]);
  });
});

describe("P&L and dashboard", () => {
  it("revenue is net of the credit notes; the dashboard's profit is the P&L's", async () => {
    const pnl = await caller().dashboard.profitAndLoss(range);
    // ₹1,25,500 of sales less ₹12,000 credited; ₹95,000 of bills (after the ₹600 discount)
    expect(pnl.revenue).toBe("113500.00");
    expect(pnl.purchases).toBe("102900.00");
    const s = await caller().dashboard.summary(range);
    expect({ gross: s.grossProfit, net: s.netProfit }).toEqual({ gross: pnl.grossProfit, net: pnl.netProfit });
    // To collect: ₹1,47,040 − ₹14,160 credited − ₹10,000 received
    expect(s.receivable).toBe("122880.00");
  });

  it("invoice status counts sale invoices only; payment modes receipts only", async () => {
    const st = await caller().dashboard.invoiceStatusBreakdown(range);
    expect(st.reduce((n, r) => n + r.count, 0)).toBe(5);
    const modes = await caller().dashboard.paymentModeBreakdown(range);
    expect(modes).toEqual([{ mode: "cash", total: "10000.00", count: 1 }]);
  });

  it("month on month names the current and previous Indian months", async () => {
    const r = await caller().dashboard.monthlyComparison();
    const { year, month } = istDateParts(new Date());
    const name = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
    expect(r.currMonth).toBe(name(year, month));
    expect(r.prevMonth).toBe(month === 1 ? name(year - 1, 12) : name(year, month - 1));
  });
});

describe("reports", () => {
  it("outstanding and aging take the credit notes off each invoice", async () => {
    const out = await caller().reports.outstanding({ type: "both" });
    const total = (id: string) => out.receivables!.parties.find((x) => x.partyId === id)?.total;
    expect(total(p.anand)).toBe("106200.00");
    expect(total(p.pune)).toBe("1680.00");
    expect(out.receivables!.summary.total).toBe("122880.00");
    const aging = await caller().dashboard.receivablesAging();
    expect(aging.summary.total).toBe("122880.00");
  });

  it("sales register and tax summary net the credit notes", async () => {
    const reg = await caller().reports.salesRegister(range);
    expect(reg.summary).toMatchObject({ totalTax: "19380.00", totalAmount: "132880.00" });
    const tax = await caller().reports.taxSummary({ ...range, type: "sales" });
    expect(tax.summary.totalTaxCollected).toBe("19380.00");
  });

  it("day book: Indian days (the 1st's sale is in) and a credit note on the debit side", async () => {
    const r = await caller().reports.daybook({ fromDate: "2025-08-01", toDate: "2025-08-31" });
    expect(r.entries.find((e) => e.id === ids.boundary)).toMatchObject({ credit: "2360.00", debit: "0" });
    expect(r.entries.find((e) => e.id === ids.cnUnreg)).toMatchObject({ debit: "11800.00", credit: "0" });
    expect(r.summary.totalSalesInvoiced).toBe("132880.00");
    const first = await caller().reports.daybook({ fromDate: "2025-08-01", toDate: "2025-08-01" });
    expect(first.entries.map((e) => e.id)).toEqual([ids.boundary]);
  });
});
