/**
 * The tds router: yearly section settings, the TDS ledger and summary, and
 * challans. TDS itself is recorded by the invoice and payment procedures
 * (tds-payments.test.ts); these tests read and organise what they wrote.
 *
 * Bills are dated inside FY 2026-27 so quarters and due dates are fixed:
 *   Q1 bill  10 May 2026   (deposit due 7 Jun 2026  — long past)
 *   Q2 bill  10 Aug 2026   (deposit due 7 Sep 2026  — past)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, businesses, taxChallans, taxDeductions, tdsSectionSettings } from "@fintranzact/db";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

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

const FY = "2026-27";
let c: Caller;
let businessId: string;
let supplier: { id: string };
let customer: { id: string };
let service: { id: string };
let q1Bill: { id: string };
let q2Bill: { id: string };

const db = () => getTenantTestDb();
const bill = (partyId: string, price: string, invoiceDate: string) =>
  c.invoice.create({
    partyId, type: "purchase", invoiceDate,
    lineItems: [{ itemId: service.id, itemName: "Services", quantity: "1", unitPrice: price, taxPercent: "18", discountPercent: "0" }],
  } as InvoiceInput);
const deductionOf = async (invoiceId: string) =>
  (await db().select().from(taxDeductions).where(eq(taxDeductions.invoiceId, invoiceId)))[0]!;
const auditActions = async (entityId: string) =>
  (await db().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, entityId))).map((r) => r.action);

beforeAll(async () => {
  const owner = await createUser({ email: `tdsr.${Date.now()}@example.in`, name: "TDS Router Owner" });
  const tenant = await createTenant({ name: "TDS Router Traders" });
  await addMember(tenant.id, owner.id, "owner");
  const u = { id: owner.id, email: owner.email, name: owner.name ?? null };
  const biz = await callerFor(u, tenant.id, null).business.create({
    name: "TDS Router Traders", phone: "9876543210", address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27",
    gstRegistrationType: "regular", gstin: "27AABCU9603R1ZM", pan: "AABCU9603R",
  } as Parameters<Caller["business"]["create"]>[0]);
  businessId = biz.id;
  c = callerFor(u, tenant.id, biz.id);
  supplier = await c.party.create({ type: "supplier", name: "Commission Agent", gstin: "27AABCS1234D1Z5", tdsSection: "194H", openingBalance: "0" });
  customer = await c.party.create({ type: "customer", name: "Deducting Customer", gstin: "27AAPFU0939F1ZV", openingBalance: "0" });
  service = await c.item.create({ name: "Services", hsn: "998719", unit: "pcs", itemMode: "simple", taxPercent: "18", stockQuantity: "0", itemType: "service", taxInclusive: false });

  q1Bill = await bill(supplier.id, "100000", "2026-05-10T06:30:00.000Z"); // 194H 2%: 2,000
  q2Bill = await bill(supplier.id, "50000", "2026-08-10T06:30:00.000Z"); //  1,000

  // A customer withholds TDS on a receipt (receivable).
  const sale = await c.invoice.create({
    partyId: customer.id, type: "sale", invoiceDate: "2026-06-10T06:30:00.000Z",
    lineItems: [{ itemId: service.id, itemName: "Services", quantity: "1", unitPrice: "10000", taxPercent: "18", discountPercent: "0" }],
  } as InvoiceInput);
  await c.payment.create({
    partyId: customer.id, invoiceId: sale.id, amount: "11800", mode: "cash", paymentDate: "2026-06-20T06:30:00.000Z",
    tdsAmount: "100", tdsSection: "194C", tdsBase: "10000",
  });
}, 90_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("tds.sections", () => {
  it("lists every section with the year's defaults and nothing overridden", async () => {
    const r = await c.tds.sections({ financialYear: FY });
    expect(r.financialYear).toBe(FY);
    expect(r.sections.map((s) => s.code)).toEqual(
      expect.arrayContaining(["194C", "194J_PROF", "194J_TECH", "194H", "194I_PM", "194I_LB", "194Q"]),
    );
    const h = r.sections.find((s) => s.code === "194H")!;
    expect(h).toMatchObject({ rate: "2", aggregateThreshold: "20000", overridden: false, isActive: true });
  });

  it("defaults to the current financial year", async () => {
    const r = await c.tds.sections();
    expect(r.financialYear).toMatch(/^\d{4}-\d{2}$/);
  });

  it("rejects a financial year whose second half is not the next year", async () => {
    await expect(c.tds.sections({ financialYear: "2026-28" })).rejects.toThrow(/April to March/);
  });

  it("applies an override, keeps unset fields at the default, and records who changed it", async () => {
    const row = await c.tds.updateSection({ financialYear: FY, sectionCode: "194H", rate: "5", aggregateThreshold: "50000" });
    const h = (await c.tds.sections({ financialYear: FY })).sections.find((s) => s.code === "194H")!;
    expect(h).toMatchObject({ rate: "5", aggregateThreshold: "50000", rateWithoutPan: "20", overridden: true });
    expect(h.defaults).toMatchObject({ rate: "2", aggregateThreshold: "20000" });
    expect(await auditActions(row.id)).toContain("tds.updateSection");

    // Another year is untouched.
    const other = (await c.tds.sections({ financialYear: "2027-28" })).sections.find((s) => s.code === "194H")!;
    expect(other.overridden).toBe(false);
  });

  it("can switch a section off and the server then stops deducting under it", async () => {
    await c.tds.updateSection({ financialYear: FY, sectionCode: "194H", isActive: false });
    const h = (await c.tds.sections({ financialYear: FY })).sections.find((s) => s.code === "194H")!;
    expect(h.isActive).toBe(false);

    const b = await bill(supplier.id, "100000", "2026-09-10T06:30:00.000Z");
    expect(await db().select().from(taxDeductions).where(eq(taxDeductions.invoiceId, b.id))).toHaveLength(0);
    await c.invoice.delete({ id: b.id });
  });

  it("resets to the defaults and records that too", async () => {
    const res = await c.tds.resetSection({ financialYear: FY, sectionCode: "194H" });
    expect(res.id).toBeTruthy();
    expect(await db().select().from(tdsSectionSettings).where(eq(tdsSectionSettings.businessId, businessId))).toHaveLength(0);
    const h = (await c.tds.sections({ financialYear: FY })).sections.find((s) => s.code === "194H")!;
    expect(h).toMatchObject({ rate: "2", overridden: false, isActive: true });
    expect(await auditActions(res.id!)).toContain("tds.resetSection");
    // Resetting something that was never overridden is a no-op, not an error.
    expect((await c.tds.resetSection({ financialYear: FY, sectionCode: "194H" })).id).toBeNull();
  });

  it("refuses rates above 100 percent", async () => {
    await expect(c.tds.updateSection({ financialYear: FY, sectionCode: "194H", rate: "150" })).rejects.toThrow();
  });
});

describe("tds.deductions", () => {
  it("lists TDS payable with the supplier, rate, quarter and deposit due date", async () => {
    const r = await c.tds.deductions({ financialYear: FY, direction: "payable" });
    expect(r.total).toBe(2);
    const q1 = r.data.find((d) => d.invoiceId === q1Bill.id)!;
    expect(q1).toMatchObject({ partyName: "Commission Agent", sectionCode: "194H", quarter: 1, amount: "2000.00", baseAmount: "100000.00", hasPan: true, challanId: null });
    expect(q1.depositDueDate.toISOString().slice(0, 10)).toBe("2026-06-06"); // 7 Jun IST starts on 6 Jun UTC
    expect(r.data.find((d) => d.invoiceId === q2Bill.id)).toMatchObject({ quarter: 2, amount: "1000.00" });
  });

  it("separates TDS receivable", async () => {
    const r = await c.tds.deductions({ financialYear: FY, direction: "receivable" });
    expect(r.total).toBe(1);
    expect(r.data[0]).toMatchObject({ partyName: "Deducting Customer", sectionCode: "194C", amount: "100.00" });
  });

  it("filters by quarter, section and deposit state, and paginates", async () => {
    expect((await c.tds.deductions({ financialYear: FY, direction: "payable", quarter: 2 })).data).toHaveLength(1);
    expect((await c.tds.deductions({ financialYear: FY, sectionCode: "194C" })).data).toHaveLength(1);
    expect((await c.tds.deductions({ financialYear: FY, direction: "payable", deposited: true })).total).toBe(0);
    expect((await c.tds.deductions({ financialYear: FY, direction: "payable", deposited: false })).total).toBe(2);
    const page = await c.tds.deductions({ financialYear: FY, direction: "payable", limit: 1, page: 2 });
    expect(page).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(page.data).toHaveLength(1);
  });

  it("is empty for a year with no TDS", async () => {
    expect((await c.tds.deductions({ financialYear: "2025-26" })).total).toBe(0);
  });
});

describe("tds.summary", () => {
  it("totals what is payable, by quarter and section, with return and deposit due dates", async () => {
    const s = await c.tds.summary({ financialYear: FY });
    expect(s.payable).toMatchObject({ total: "3000.00", deposited: "0.00", pending: "3000.00" });
    expect(s.payable.bySection).toEqual([{ sectionCode: "194H", total: "3000.00", deposited: "0.00", pending: "3000.00" }]);
    expect(s.payable.byQuarter.map((q) => [q.quarter, q.total, q.count])).toEqual([[1, "2000.00", 1], [2, "1000.00", 1]]);
    expect(s.payable.byQuarter[0]!.returnDueDate.toISOString().slice(0, 10)).toBe("2026-07-30"); // 31 Jul IST
    expect(s.payable.depositsDue.map((d) => [d.month, d.pending, d.overdue])).toEqual([
      ["2026-05", "2000.00", true],
      ["2026-08", "1000.00", true],
    ]);
    expect(s.receivable).toMatchObject({ total: "100.00", bySection: [{ sectionCode: "194C", total: "100.00" }] });
  });

  it("is all zeros for a year with no TDS", async () => {
    const s = await c.tds.summary({ financialYear: "2025-26" });
    expect(s.payable).toMatchObject({ total: "0.00", pending: "0.00", bySection: [], byQuarter: [], depositsDue: [] });
  });
});

describe("tds challans", () => {
  const challan = (over: Record<string, unknown> = {}) => ({
    financialYear: FY, quarter: 1, challanNumber: "00041", bsrCode: "0510308",
    depositedOn: "2026-06-05T06:30:00.000Z", amount: "2000", ...over,
  });
  let created: { id: string };

  it("records a deposit, marks the TDS as deposited and logs it", async () => {
    const d = await deductionOf(q1Bill.id);
    created = await c.tds.createChallan(challan({ deductionIds: [d.id], interest: "0" }) as never);
    expect(created).toMatchObject({ kind: "tds", quarter: 1, amount: "2000.00", linkedCount: 1 });
    expect((await deductionOf(q1Bill.id)).challanId).toBe(created.id);
    expect(await auditActions(created.id)).toContain("tds.createChallan");

    const s = await c.tds.summary({ financialYear: FY });
    expect(s.payable).toMatchObject({ deposited: "2000.00", pending: "1000.00" });
    expect(s.payable.depositsDue.map((x) => x.month)).toEqual(["2026-08"]);

    const list = await c.tds.challans({ financialYear: FY });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ challanNumber: "00041", bsrCode: "0510308", amount: "2000.00", linked: "2000.00", deductionCount: 1 });
    expect((await c.tds.challans({ financialYear: FY, quarter: 2 }))).toHaveLength(0);
  });

  it("refuses TDS that is already on a challan", async () => {
    const d = await deductionOf(q1Bill.id);
    await expect(c.tds.createChallan(challan({ challanNumber: "00042", deductionIds: [d.id] }) as never)).rejects.toThrow(/already on a challan/);
  });

  it("refuses to mix quarters on one challan", async () => {
    const d2 = await deductionOf(q2Bill.id);
    await expect(c.tds.createChallan(challan({ quarter: 1, challanNumber: "00043", deductionIds: [d2.id] }) as never)).rejects.toThrow(/one quarter/);
  });

  it("refuses a challan for less than the TDS it covers", async () => {
    const d2 = await deductionOf(q2Bill.id);
    await expect(c.tds.createChallan(challan({ quarter: 2, challanNumber: "00044", amount: "500", deductionIds: [d2.id] }) as never)).rejects.toThrow(/more than the challan amount/);
  });

  it("only deposits TDS we deducted, not TDS customers deducted from us", async () => {
    const [recv] = await db().select().from(taxDeductions).where(and(eq(taxDeductions.businessId, businessId), eq(taxDeductions.direction, "receivable")));
    await expect(c.tds.createChallan(challan({ quarter: 1, challanNumber: "00045", deductionIds: [recv!.id] }) as never)).rejects.toThrow(/TDS you deducted/);
  });

  it("reports entries that do not exist", async () => {
    await expect(c.tds.createChallan(challan({ deductionIds: ["00000000-0000-4000-8000-000000000000"] }) as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a malformed BSR code and a duplicate CIN", async () => {
    const d2 = await deductionOf(q2Bill.id);
    await expect(c.tds.createChallan(challan({ quarter: 2, bsrCode: "123", deductionIds: [d2.id] }) as never)).rejects.toThrow(/7 digits/);
    // Same BSR code, serial and date as the first challan.
    const [d3] = await db().select().from(taxDeductions).where(eq(taxDeductions.invoiceId, q2Bill.id));
    await db().update(taxDeductions).set({ quarter: 1 }).where(eq(taxDeductions.id, d3!.id)); // let it pass the quarter check
    await expect(c.tds.createChallan(challan({ deductionIds: [d3!.id] }) as never)).rejects.toMatchObject({ code: "CONFLICT" });
    await db().update(taxDeductions).set({ quarter: 2 }).where(eq(taxDeductions.id, d3!.id));
  });

  it("removing a challan puts its TDS back to pending", async () => {
    const res = await c.tds.deleteChallan({ id: created.id });
    expect(res.challanNumber).toBe("00041");
    expect((await deductionOf(q1Bill.id)).challanId).toBeNull();
    expect(await db().select().from(taxChallans).where(eq(taxChallans.id, created.id))).toHaveLength(0);
    expect(await auditActions(created.id)).toContain("tds.deleteChallan");
    expect((await c.tds.summary({ financialYear: FY })).payable.pending).toBe("3000.00");
    await expect(c.tds.deleteChallan({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tds.returnData", () => {
  it("lists the quarter's deductions with the things to fix, before anything is deposited", async () => {
    const r = await c.tds.returnData({ financialYear: FY, quarter: 1 });
    expect(r).toMatchObject({ financialYear: FY, quarter: 1, deductor: { name: "TDS Router Traders", tan: null } });
    expect(r.returnDueDate.toISOString().slice(0, 10)).toBe("2026-07-30");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ partyName: "Commission Agent", sectionCode: "194H", baseAmount: "100000.00", amount: "2000.00", hasPan: true, challan: null });
    expect(r.totals).toEqual({ deducted: "2000.00", deposited: "0.00", pending: "2000.00", deducteeCount: 1 });
    expect(r.warnings.join(" ")).toMatch(/TAN is not set/);
    expect(r.warnings.join(" ")).toMatch(/1 deduction is not on a challan yet/);
    expect(r.deducteeCsv.split("\n")[1]).toMatch(/^1,Commission Agent,AABCS1234D,194H,10\/05\/2026,100000\.00,2,2000\.00,No,INV-\d+,,,$/);
  });

  it("only includes the asked quarter, and TDS we deducted (not receivable)", async () => {
    const q2 = await c.tds.returnData({ financialYear: FY, quarter: 2 });
    expect(q2.rows.map((x) => x.amount)).toEqual(["1000.00"]);
    const q4 = await c.tds.returnData({ financialYear: FY, quarter: 4 });
    expect(q4.rows).toEqual([]);
    expect(q4.totals.deducted).toBe("0.00");
    // The customer's 100 of TDS receivable (Q1) is not in the return.
    expect((await c.tds.returnData({ financialYear: FY, quarter: 1 })).rows.map((x) => x.amount)).not.toContain("100.00");
  });

  it("shows the challan against each deduction once it is deposited, and stops warning about the TAN once it is set", async () => {
    const d = await deductionOf(q1Bill.id);
    const ch = await c.tds.createChallan({
      financialYear: FY, quarter: 1, challanNumber: "00051", bsrCode: "0510308",
      depositedOn: "2026-06-05T06:30:00.000Z", amount: "2050", interest: "50", deductionIds: [d.id],
    } as never);
    await db().update(businesses).set({ tan: "MUMA12345B" }).where(eq(businesses.id, businessId));
    try {
      const r = await c.tds.returnData({ financialYear: FY, quarter: 1 });
      expect(r.deductor.tan).toBe("MUMA12345B");
      expect(r.warnings).toEqual([]);
      expect(r.totals).toMatchObject({ deposited: "2000.00", pending: "0.00" });
      expect(r.rows[0]!.challan).toMatchObject({ bsrCode: "0510308", challanNumber: "00051" });
      expect(r.challans).toHaveLength(1);
      expect(r.challans[0]).toMatchObject({ amount: "2050.00", interest: "50.00", linked: "2000.00" });
      expect(r.deducteeCsv.split("\n")[1]).toMatch(/,0510308,00051,05\/06\/2026$/);
      expect(r.challanCsv.split("\n")[1]).toBe("1,0510308,00051,05/06/2026,2050.00,50.00,2000.00");
    } finally {
      await db().update(businesses).set({ tan: null }).where(eq(businesses.id, businessId));
      await c.tds.deleteChallan({ id: ch.id });
    }
  });

  it("rejects a bad quarter or financial year", async () => {
    await expect(c.tds.returnData({ financialYear: FY, quarter: 5 } as never)).rejects.toThrow();
    await expect(c.tds.returnData({ financialYear: "2026-28", quarter: 1 })).rejects.toThrow(/April to March/);
  });
});

describe("tds.preview", () => {
  it("answers from the supplier's section and the year so far", async () => {
    const p = await c.tds.preview({ partyId: supplier.id, amount: "100000", paymentDate: "2026-10-01T06:30:00.000Z" });
    expect(p).toMatchObject({ financialYear: FY, sectionCode: "194H", hasPan: true });
    // 150,000 already bought under 194H and taxed; this 100,000 is taxed in full at 2%.
    expect(p.ytdPaid).toBe("150000.00");
    expect(p.result).toMatchObject({ applicable: true, tds: "2000.00", base: "100000.00" });
  });

  it("is not found for a party of another business", async () => {
    await expect(c.tds.preview({ partyId: "00000000-0000-4000-8000-000000000000", amount: "1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
