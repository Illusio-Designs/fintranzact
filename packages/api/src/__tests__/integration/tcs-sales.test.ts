/**
 * TCS (s.206C) on sales, end to end through the tRPC procedures.
 *
 * An item can carry a TCS section. A sale invoice collects TCS on those lines,
 * on top of the goods and GST: invoices.total_amount includes it and
 * invoices.tcs_amount says how much of the total it is. The tax is a payable
 * row in tax_deductions (kind 'tcs') and a credit to TCS Payable (2210).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { taxChallans, taxDeductions } from "@fintranzact/db";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { mapInvoiceToIRP } from "../../lib/invoice-to-irp.js";
import { runAudit } from "../../lib/data-audit/runner.js";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getTenantTestDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { invoices } from "@fintranzact/db";

const callerFactory = createCallerFactory(appRouter);

function callerFor(user: { id: string; email: string; name: string | null }, tenantId: string, businessId: string | null) {
  return callerFactory({
    user,
    tenantId,
    businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", ...(businessId ? { "x-business-id": businessId } : {}) }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

type Caller = ReturnType<typeof callerFor>;
type InvoiceInput = Parameters<Caller["invoice"]["create"]>[0];

let c: Caller;
let businessId: string;
let withPan: { id: string }; // PAN inside the GSTIN
let noPan: { id: string }; // unregistered, no PAN
let scrap: { id: string };
let plain: { id: string };
let vehicle: { id: string };

const db = () => getTenantTestDb();
const line = (itemId: string, price: string, qty = "1") => ({
  itemId, itemName: "Goods", quantity: qty, unitPrice: price, taxPercent: "18", discountPercent: "0",
});
const sale = (partyId: string, lines: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) =>
  c.invoice.create({ partyId, type: "sale", lineItems: lines, ...extra } as InvoiceInput);
const row = async (id: string) => (await db().select().from(invoices).where(eq(invoices.id, id)))[0]!;
const tcsRows = (invoiceId: string) =>
  db().select().from(taxDeductions).where(and(eq(taxDeductions.invoiceId, invoiceId), eq(taxDeductions.kind, "tcs")));
const trial = async () => c.reports.trialBalance({ asOfDate: new Date(Date.now() + 86_400_000).toISOString() });
const acct = (tb: Awaited<ReturnType<typeof trial>>, code: string) => tb.accounts.find((a: { accountCode: string }) => a.accountCode === code);

beforeAll(async () => {
  const owner = await createUser({ email: `tcs.${Date.now()}@example.in`, name: "TCS Owner" });
  const tenant = await createTenant({ name: "TCS Traders" });
  await addMember(tenant.id, owner.id, "owner");
  const u = { id: owner.id, email: owner.email, name: owner.name ?? null };
  const biz = await callerFor(u, tenant.id, null).business.create({
    name: "TCS Traders", phone: "9876543210", address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27",
    gstRegistrationType: "regular", gstin: "27AABCU9603R1ZM", pan: "AABCU9603R",
  } as Parameters<Caller["business"]["create"]>[0]);
  businessId = biz.id;
  c = callerFor(u, tenant.id, biz.id);
  withPan = await c.party.create({ type: "customer", name: "Registered Buyer", gstin: "27AAPFU0939F1ZV", openingBalance: "0" });
  noPan = await c.party.create({ type: "customer", name: "Walk-in Buyer", openingBalance: "0" });
  const mk = (name: string, extra: Record<string, unknown> = {}) =>
    c.item.create({ name, hsn: "7204", unit: "pcs", itemMode: "simple", taxPercent: "18", stockQuantity: "1000", itemType: "product", taxInclusive: false, ...extra } as Parameters<Caller["item"]["create"]>[0]);
  scrap = await mk("Metal scrap", { tcsSection: "206C_SCRAP" });
  plain = await mk("Steel rod");
  vehicle = await mk("Truck", { tcsSection: "206C_VEHICLE" });
}, 60_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("TCS on a sale of scrap", () => {
  let inv: { id: string };

  it("is collected on top of the goods and GST, and included in the total", async () => {
    inv = await sale(withPan.id, [line(scrap.id, "100000")]);
    const r = await row(inv.id);
    // 100,000 goods + 18,000 GST + 1,000 TCS (1%)
    expect(r).toMatchObject({ subtotal: "100000.00", taxAmount: "18000.00", tcsAmount: "1000.00", totalAmount: "119000.00", tcsMode: "auto" });
    const rows = await tcsRows(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "tcs", direction: "payable", partyId: withPan.id, paymentId: null, sectionCode: "206C_SCRAP",
      baseAmount: "100000.00", rate: "1.000", amount: "1000.00", hasPan: true, challanId: null,
    });
  });

  it("posts the ledger: Cr Sales for the goods only, Cr TCS Payable, Dr Receivable for everything", async () => {
    const tb = await trial();
    expect(acct(tb, "4000")).toMatchObject({ credit: "100000.00" });
    expect(acct(tb, "2210")).toMatchObject({ credit: "1000.00" });
    expect(acct(tb, "1100")).toMatchObject({ debit: "119000.00" });
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("is what the customer owes: paying the goods and GST alone leaves the TCS due", async () => {
    await c.payment.create({ partyId: withPan.id, invoiceId: inv.id, amount: "118000", mode: "cash" });
    const r = await row(inv.id);
    expect(r).toMatchObject({ amountPaid: "118000.00", status: "partial" });
    await c.payment.create({ partyId: withPan.id, invoiceId: inv.id, amount: "1000", mode: "cash" });
    expect((await row(inv.id)).status).toBe("paid");
  });

  it("is re-worked when the lines are edited (an unpaid invoice)", async () => {
    const other = await sale(withPan.id, [line(scrap.id, "100000")]);
    await c.invoice.update({ id: other.id, lineItems: [line(scrap.id, "250000")] });
    expect(await row(other.id)).toMatchObject({ subtotal: "250000.00", taxAmount: "45000.00", tcsAmount: "2500.00", totalAmount: "297500.00" });
    const rows = await tcsRows(other.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ baseAmount: "250000.00", amount: "2500.00" });
  });

  it("goes when the invoice is cancelled and returns when it is reinstated", async () => {
    const x = await sale(withPan.id, [line(scrap.id, "100000")]);
    await c.invoice.updateStatus({ id: x.id, status: "cancelled" });
    expect(await row(x.id)).toMatchObject({ tcsAmount: "0.00", totalAmount: "118000.00" });
    expect(await tcsRows(x.id)).toHaveLength(0);
    await c.invoice.updateStatus({ id: x.id, status: "sent" });
    expect(await row(x.id)).toMatchObject({ tcsAmount: "1000.00", totalAmount: "119000.00" });
    expect(await tcsRows(x.id)).toHaveLength(1);
  });

  it("goes when the invoice is deleted", async () => {
    const x = await sale(withPan.id, [line(scrap.id, "100000")]);
    await c.invoice.delete({ id: x.id });
    expect(await tcsRows(x.id)).toHaveLength(0);
    expect(await row(x.id)).toMatchObject({ tcsAmount: "0.00" });
  });

  it("can be switched off for an invoice, and back on", async () => {
    const x = await sale(withPan.id, [line(scrap.id, "100000")], { tcsMode: "none" });
    expect(await row(x.id)).toMatchObject({ tcsMode: "none", tcsAmount: "0.00", totalAmount: "118000.00" });
    expect(await tcsRows(x.id)).toHaveLength(0);
    await c.invoice.update({ id: x.id, tcsMode: "auto" });
    expect(await row(x.id)).toMatchObject({ tcsMode: "auto", tcsAmount: "1000.00", totalAmount: "119000.00" });
  });
});

describe("TCS rates and lines", () => {
  it("is collected at the higher s.206CC rate from a buyer with no PAN", async () => {
    const x = await sale(noPan.id, [line(scrap.id, "100000")]);
    expect(await row(x.id)).toMatchObject({ tcsAmount: "5000.00", totalAmount: "123000.00" });
    expect((await tcsRows(x.id))[0]).toMatchObject({ rate: "5.000", hasPan: false, amount: "5000.00" });
  });

  it("is collected only on the lines whose item has a TCS section", async () => {
    const x = await sale(withPan.id, [line(plain.id, "50000"), line(scrap.id, "100000")]);
    // GST on both lines: 150,000 + 27,000 + 1,000 TCS on the scrap line only
    expect(await row(x.id)).toMatchObject({ subtotal: "150000.00", taxAmount: "27000.00", tcsAmount: "1000.00", totalAmount: "178000.00" });
  });

  it("collects nothing on an invoice with no such items", async () => {
    const x = await sale(withPan.id, [line(plain.id, "50000")]);
    expect(await row(x.id)).toMatchObject({ tcsAmount: "0.00", totalAmount: "59000.00" });
    expect(await tcsRows(x.id)).toHaveLength(0);
  });

  it("applies the ₹10 lakh limit to a motor vehicle, and then taxes its whole value", async () => {
    const under = await sale(withPan.id, [line(vehicle.id, "800000")]);
    expect((await row(under.id)).tcsAmount).toBe("0.00");
    const over = await sale(withPan.id, [line(vehicle.id, "1200000")]);
    expect(await row(over.id)).toMatchObject({ tcsAmount: "12000.00" });
    expect((await tcsRows(over.id))[0]).toMatchObject({ sectionCode: "206C_VEHICLE", baseAmount: "1200000.00", amount: "12000.00" });
  });

  it("groups several sections on one invoice into one row each", async () => {
    const x = await sale(withPan.id, [line(scrap.id, "100000"), line(scrap.id, "50000"), line(vehicle.id, "1200000")]);
    const rows = await tcsRows(x.id);
    expect(rows.map((r) => [r.sectionCode, r.baseAmount, r.amount]).sort()).toEqual([
      ["206C_SCRAP", "150000.00", "1500.00"],
      ["206C_VEHICLE", "1200000.00", "12000.00"],
    ]);
    expect((await row(x.id)).tcsAmount).toBe("13500.00");
  });
});

describe("tcsPreview", () => {
  it("shows the TCS the form will collect, by section, with a no-PAN warning", async () => {
    const p = await c.tds.tcsPreview({ partyId: withPan.id, lines: [{ itemId: scrap.id, taxable: "100000" }, { itemId: plain.id, taxable: "5000" }, { itemId: null, taxable: "10" }] });
    expect(p).toMatchObject({ hasPan: true, amount: "1000.00", warnings: [] });
    expect(p.sections).toEqual([{ sectionCode: "206C_SCRAP", base: "100000.00", rate: "1", amount: "1000.00", label: "206C · Scrap" }]);
    const n = await c.tds.tcsPreview({ partyId: noPan.id, lines: [{ itemId: scrap.id, taxable: "100000" }] });
    expect(n).toMatchObject({ hasPan: false, amount: "5000.00" });
    expect(n.warnings.join(" ")).toMatch(/higher rate/);
    expect((await c.tds.tcsPreview({ partyId: withPan.id, lines: [] })).amount).toBe("0.00");
  });
});

describe("TCS ledger, challans and return data", () => {
  it("lists and summarises TCS with its own due dates (7th of next month, 27EQ dates)", async () => {
    const fy = (await c.tds.summary({ kind: "tcs" })).financialYear;
    const s = await c.tds.summary({ financialYear: fy, kind: "tcs" });
    expect(s.kind).toBe("tcs");
    expect(parseFloat(s.payable.total)).toBeGreaterThan(0);
    expect(s.payable.bySection.map((x) => x.sectionCode)).toEqual(expect.arrayContaining(["206C_SCRAP", "206C_VEHICLE"]));
    // The quarter's 27EQ date is the 15th (TDS returns fall on the 30th/31st).
    expect(new Date(s.payable.byQuarter[0]!.returnDueDate).toISOString().slice(8, 10)).toMatch(/1[45]/);
    // TDS and TCS ledgers are separate.
    const tds = await c.tds.summary({ financialYear: fy, kind: "tds" });
    expect(tds.payable.total).toBe("0.00");

    const list = await c.tds.deductions({ financialYear: fy, kind: "tcs", limit: 200 });
    expect(list.total).toBeGreaterThan(5);
    const first = list.data[0]!;
    const due = new Date(first.depositDueDate);
    expect(due.getTime()).toBeGreaterThan(new Date(first.deductedOn).getTime());
  });

  it("deposits TCS with a challan and locks the invoice until it is removed", async () => {
    const x = await sale(withPan.id, [line(scrap.id, "100000")]);
    const [d] = await tcsRows(x.id);
    const challan = await c.tds.createChallan({
      financialYear: d!.financialYear, quarter: d!.quarter, kind: "tcs", challanNumber: "00099", bsrCode: "0510308",
      depositedOn: new Date().toISOString(), amount: "1000", deductionIds: [d!.id],
    } as never);
    expect(challan).toMatchObject({ kind: "tcs", amount: "1000.00", linkedCount: 1 });

    await expect(c.invoice.update({ id: x.id, lineItems: [line(scrap.id, "200000")] })).rejects.toThrow(/already deposited/);
    await expect(c.invoice.updateStatus({ id: x.id, status: "cancelled" })).rejects.toThrow(/already deposited/);
    await expect(c.invoice.delete({ id: x.id })).rejects.toThrow(/already deposited/);

    // It is a TCS challan, not a TDS one.
    expect((await c.tds.challans({ financialYear: d!.financialYear, kind: "tcs" })).map((r) => r.challanNumber)).toContain("00099");
    expect((await c.tds.challans({ financialYear: d!.financialYear, kind: "tds" })).map((r) => r.challanNumber)).not.toContain("00099");
    // A TDS challan cannot take TCS entries.
    const [d2] = await tcsRows((await sale(withPan.id, [line(scrap.id, "100000")])).id);
    await expect(c.tds.createChallan({
      financialYear: d2!.financialYear, quarter: d2!.quarter, kind: "tds", challanNumber: "00100", bsrCode: "0510308",
      depositedOn: new Date().toISOString(), amount: "1000", deductionIds: [d2!.id],
    } as never)).rejects.toThrow(/not found/i);

    await c.tds.deleteChallan({ id: challan.id });
    await c.invoice.updateStatus({ id: x.id, status: "cancelled" });
  });

  it("gives the quarter's return figures (27EQ)", async () => {
    const [any] = await db().select().from(taxDeductions).where(eq(taxDeductions.kind, "tcs")).limit(1);
    const r = await c.tds.returnData({ financialYear: any!.financialYear, quarter: any!.quarter, kind: "tcs" });
    expect(r.kind).toBe("tcs");
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0]).toMatchObject({ sectionCode: expect.stringMatching(/^206C_/) });
    expect(r.deducteeCsv.split("\n")[0]).toContain("Deductee name");
    expect(r.warnings.join(" ")).toMatch(/TAN is not set/);
  });

  it("lists TCS sections with their own rates and lets a business override one", async () => {
    const fy = (await c.tds.sections({ kind: "tcs" })).financialYear;
    const r = await c.tds.sections({ financialYear: fy, kind: "tcs" });
    expect(r.kind).toBe("tcs");
    expect(r.sections.find((s) => s.code === "206C_SCRAP")).toMatchObject({ rate: "1", rateWithoutPan: "5", overridden: false });
    await c.tds.updateSection({ financialYear: fy, sectionCode: "206C_SCRAP", rate: "2", rateWithoutPan: "6" });
    try {
      const x = await sale(withPan.id, [line(scrap.id, "100000")]);
      expect((await row(x.id)).tcsAmount).toBe("2000.00"); // the override applies to new sales
    } finally {
      await c.tds.resetSection({ financialYear: fy, sectionCode: "206C_SCRAP" });
    }
  });
});

describe("TCS in the e-invoice", () => {
  it("is reported as other charges so the invoice value adds up", async () => {
    const irp = mapInvoiceToIRP(
      {
        invoiceNumber: "INV-1", invoiceDate: new Date("2026-10-01T06:30:00Z"), type: "sale", documentType: "invoice",
        subtotal: "100000.00", taxAmount: "18000.00", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00",
        tcsAmount: "1000.00", totalAmount: "119000.00", isReverseCharge: false,
      },
      [{ itemName: "Metal scrap", itemHsn: "7204", itemType: "product", quantity: "1", unit: "pcs", unitPrice: "100000.00", taxPercent: "18", taxAmount: "18000.00", discountPercent: "0", totalAmount: "118000.00" } as never],
      {
        gstin: "27AABCU9603R1ZM", name: "TCS Traders", legalName: null, address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27", pincode: "400001", phone: null, email: null,
      } as never,
      { gstin: "27AAPFU0939F1ZV", name: "Registered Buyer", billingAddress: "2 Road", city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "411001", phone: null, email: null, type: "customer" } as never,
    );
    const v = irp.ValDtls;
    expect(v.OthChrg).toBe(1000);
    expect(v.TotInvVal).toBe(119000);
    // Goods + GST + other charges = invoice value.
    expect(v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + (v.OthChrg ?? 0) - (v.Discount ?? 0)).toBeCloseTo(v.TotInvVal, 2);
  });
});

describe("data audit", () => {
  it("finds nothing wrong after all of the above", async () => {
    const report = await runAudit(getTestClient(), { businessIds: [businessId], samples: 10 });
    expect(report.failures.map((f) => `${f.rule.id}: ${f.error}`)).toEqual([]);
    const errors = report.results.filter((r) => r.rule.severity === "error");
    expect(errors.map((r) => `${r.rule.id}: ${r.samples.map((s) => s.detail).join(" | ")}`)).toEqual([]);
  });
});

// Keeps the import used when challans are only read through the API.
void taxChallans;
