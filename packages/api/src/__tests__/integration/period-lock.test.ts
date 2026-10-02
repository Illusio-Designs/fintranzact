/**
 * Period locks and year-end close: the `period` router, and every writer that
 * must refuse to touch a locked period.
 *
 * FY 2025-26 is over for the whole life of this suite (it ends 31 Mar 2026), so
 * it can be closed; the current year is open.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, periodLocks, financialYearCloses, businessMembers } from "@fintranzact/db";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { runInvoicesImport } from "../../routers/import/engine/invoices.js";
import { runPaymentsImport } from "../../routers/import/engine/payments.js";
import { runTransfersImport } from "../../routers/import/engine/transfers.js";
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

let owner: Caller;
let accountant: Caller;
let businessId: string;
let customer: { id: string };
let item: { id: string };

const db = () => getTenantTestDb();
const OLD = "2026-02-10T06:30:00.000Z"; // in FY 2025-26
const OLD2 = "2026-02-20T06:30:00.000Z";
const NEW = "2026-06-10T06:30:00.000Z"; // in FY 2026-27, after the lock
const LOCK_MSG = "This period is locked.";

const sale = (date: string, price = "1000") =>
  owner.invoice.create({
    partyId: customer.id, type: "sale", invoiceDate: date,
    lineItems: [{ itemId: item.id, itemName: "Goods", quantity: "1", unitPrice: price, taxPercent: "18", discountPercent: "0" }],
  } as InvoiceInput);
const auditFor = async (action: string) =>
  db().select().from(auditLog).where(and(eq(auditLog.businessId, businessId), eq(auditLog.action, action)));

beforeAll(async () => {
  const o = await createUser({ email: `lock.owner.${Date.now()}@example.in`, name: "Rishi Soni" });
  const a = await createUser({ email: `lock.acct.${Date.now()}@example.in`, name: "Meera CA" });
  const tenant = await createTenant({ name: "Lock Traders" });
  await addMember(tenant.id, o.id, "owner");
  await addMember(tenant.id, a.id, "accountant");
  const ou = { id: o.id, email: o.email, name: o.name ?? null };
  const biz = await callerFor(ou, tenant.id, null).business.create({
    name: "Lock Traders", phone: "9876543210", address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27",
    gstRegistrationType: "regular", gstin: "27AABCU9603R1ZM", pan: "AABCU9603R",
  } as Parameters<Caller["business"]["create"]>[0]);
  businessId = biz.id;
  owner = callerFor(ou, tenant.id, biz.id);
  accountant = callerFor({ id: a.id, email: a.email, name: a.name ?? null }, tenant.id, biz.id);
  await getTenantTestDb().insert(businessMembers).values({ businessId, userId: a.id, role: "member" }).onConflictDoNothing();
  customer = await owner.party.create({ type: "customer", name: "Lock Customer", gstin: "27AAPFU0939F1ZV", openingBalance: "500" });
  await owner.party.create({ type: "supplier", name: "Lock Supplier", gstin: "27AABCS1234D1Z5", openingBalance: "0" });
  item = await owner.item.create({ name: "Goods", hsn: "1001", unit: "pcs", itemMode: "simple", taxPercent: "18", stockQuantity: "100", itemType: "product", taxInclusive: false });
}, 90_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("nothing is locked at first", () => {
  it("reports an open status and allows entries in any period", async () => {
    const s = await owner.period.status();
    expect(s.booksLockedThrough).toBeNull();
    expect(await sale(OLD)).toBeDefined();
  });
});

describe("lockBooks", () => {
  let oldInvoice: { id: string };
  let newInvoice: { id: string };
  let oldPayment: { id: string };

  beforeAll(async () => {
    oldInvoice = await sale(OLD2);
    newInvoice = await sale(NEW);
    oldPayment = await owner.payment.create({ partyId: customer.id, invoiceId: oldInvoice.id, amount: "100", mode: "cash", paymentDate: OLD2 });
  });

  it("refuses a date that is not in the past", async () => {
    await expect(owner.period.lockBooks({ through: "2999-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets an accountant lock, and records who and when", async () => {
    const r = await accountant.period.lockBooks({ through: "2026-03-31", note: "FY 2025-26 filed" });
    expect(r.lockedThrough).toBe("2026-03-31");
    const s = await owner.period.status();
    expect(s.booksLockedThrough).toBe("2026-03-31");
    expect((await auditFor("period.lockBooks")).length).toBe(1);
  });

  it("blocks adding, editing and deleting entries dated in the locked period, with a clear message", async () => {
    await expect(sale(OLD)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(LOCK_MSG) });
    await expect(sale(OLD)).rejects.toThrow(/31 Mar 2026/);
    await expect(owner.invoice.updateStatus({ id: oldInvoice.id, status: "cancelled" })).rejects.toThrow(LOCK_MSG);
    await expect(owner.invoice.delete({ id: oldInvoice.id })).rejects.toThrow(LOCK_MSG);
    await expect(owner.payment.delete({ id: oldPayment.id })).rejects.toThrow(LOCK_MSG);
    await expect(
      owner.payment.create({ partyId: customer.id, amount: "50", mode: "cash", paymentDate: OLD }),
    ).rejects.toThrow(LOCK_MSG);
    await expect(
      owner.expense.create({ category: "Rent", amount: "100", mode: "cash", expenseDate: OLD }),
    ).rejects.toThrow(LOCK_MSG);
    const accounts = await owner.account.list();
    const [a1, a2] = accounts as Array<{ id: string }>;
    await expect(
      owner.journal.create({
        entryDate: OLD,
        lines: [
          { accountId: a1!.id, debit: "10", credit: "0" },
          { accountId: a2!.id, debit: "0", credit: "10" },
        ],
      } as Parameters<Caller["journal"]["create"]>[0]),
    ).rejects.toThrow(LOCK_MSG);
  });

  it("blocks moving an open entry into the locked period (new date) and out of it (old date)", async () => {
    await expect(
      owner.invoice.update({ id: newInvoice.id, invoiceDate: OLD } as Parameters<Caller["invoice"]["update"]>[0]),
    ).rejects.toThrow(LOCK_MSG);
    await expect(
      owner.invoice.update({ id: oldInvoice.id, invoiceDate: NEW } as Parameters<Caller["invoice"]["update"]>[0]),
    ).rejects.toThrow(LOCK_MSG);
  });

  it("keeps working normally after the lock date", async () => {
    const inv = await sale("2026-07-01T06:30:00.000Z");
    expect(inv.id).toBeDefined();
    await expect(owner.invoice.updateStatus({ id: newInvoice.id, status: "cancelled" })).resolves.toBeDefined();
    await expect(owner.expense.create({ category: "Rent", amount: "100", mode: "cash", expenseDate: NEW })).resolves.toBeDefined();
  });

  it("protects opening balances while any period is locked", async () => {
    await expect(owner.party.update({ id: customer.id, data: { openingBalance: "900" } } as Parameters<Caller["party"]["update"]>[0])).rejects.toThrow(LOCK_MSG);
  });

  it("only the owner can unlock, with a reason, and it is audit-logged", async () => {
    await expect(accountant.period.unlockBooks({ through: null, reason: "Need to fix an invoice" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.period.unlockBooks({ through: null, reason: "short" })).rejects.toThrow();
    await owner.period.unlockBooks({ through: null, reason: "Correcting a wrongly dated invoice" });
    expect((await owner.period.status()).booksLockedThrough).toBeNull();
    const entries = await auditFor("period.unlockBooks");
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries[0]!.metadata ?? entries[0])).toContain("Correcting a wrongly dated invoice");
    // And the period accepts entries again.
    await expect(sale(OLD)).resolves.toBeDefined();
  });
});

describe("GST months marked as filed", () => {
  it("blocks entries in the filed month only", async () => {
    await accountant.period.lockGstMonth({ returnPeriod: "2026-06" });
    await expect(sale("2026-06-15T06:30:00.000Z")).rejects.toThrow(/GST returns for Jun 2026 are marked as filed/);
    await expect(sale("2026-07-15T06:30:00.000Z")).resolves.toBeDefined();
    await expect(sale("2026-05-15T06:30:00.000Z")).resolves.toBeDefined();
  });

  it("only the owner can unlock the month", async () => {
    await expect(accountant.period.unlockGstMonth({ returnPeriod: "2026-06", reason: "Need a correction" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.period.unlockGstMonth({ returnPeriod: "2026-06", reason: "Amended return being filed" });
    await expect(sale("2026-06-15T06:30:00.000Z")).resolves.toBeDefined();
    expect((await auditFor("period.unlockGstMonth")).length).toBe(1);
    expect(await db().select().from(periodLocks).where(eq(periodLocks.kind, "gst"))).toHaveLength(0);
  });
});

describe("year-end close", () => {
  it("won't close a year that is not over", async () => {
    await expect(owner.period.closeYear({ financialYear: "2026-27" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("previews balanced opening balances for the next year", async () => {
    const p = await owner.period.closeYearPreview({ financialYear: "2025-26" });
    const totals = p.snapshot.openingBalances.reduce(
      (acc, b) => ({ dr: acc.dr + Number(b.debit), cr: acc.cr + Number(b.credit) }),
      { dr: 0, cr: 0 },
    );
    expect(Math.abs(totals.dr - totals.cr)).toBeLessThan(0.02);
  });

  it("closes the year: stores the snapshot, locks the books through 31 Mar 2026 and logs it", async () => {
    const r = await owner.period.closeYear({ financialYear: "2025-26", note: "Audited", force: true });
    expect(r.lockedThrough).toBe("2026-03-31");
    expect((await owner.period.status()).booksLockedThrough).toBe("2026-03-31");
    expect(await db().select().from(financialYearCloses)).toHaveLength(1);
    expect((await auditFor("period.closeYear")).length).toBe(1);
    expect((await owner.period.closes()).map((c) => c.financialYear)).toContain("2025-26");
    await expect(sale(OLD)).rejects.toThrow(LOCK_MSG);
  });

  it("carries the closing balances into the next year's trial balance, which still balances", async () => {
    const tb = await owner.reports.trialBalance({ asOfDate: "2026-09-30T12:00:00.000Z" });
    expect(tb.carriedForwardFrom).toBe("2025-26");
    expect(Math.abs(Number(tb.totalDebit) - Number(tb.totalCredit))).toBeLessThan(0.02);
    // The old year itself is not given an opening balance.
    const old = await owner.reports.trialBalance({ asOfDate: "2026-03-31T12:00:00.000Z" });
    expect(old.carriedForwardFrom).toBeNull();
  });

  it("can't lower the lock below a closed year; the year must be reopened", async () => {
    await expect(owner.period.unlockBooks({ through: null, reason: "Trying to skip reopening" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("only the owner can reopen it, and it is audit-logged", async () => {
    await expect(accountant.period.reopenYear({ financialYear: "2025-26", reason: "Adjustment needed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.period.reopenYear({ financialYear: "2025-26", reason: "Auditor asked for an adjustment" });
    expect(await db().select().from(financialYearCloses)).toHaveLength(0);
    expect((await owner.period.status()).booksLockedThrough).toBeNull();
    expect((await auditFor("period.reopenYear")).length).toBe(1);
    await expect(sale(OLD)).resolves.toBeDefined();
  });
});

describe("imports respect locked periods", () => {
  const user = { id: "00000000-0000-4000-8000-000000000001", name: "Importer" };
  const inv = (number: string, date: string) => ({
    invoiceNumber: number, invoiceDate: new Date(date), partyName: "Lock Customer", type: "sale" as const, status: "sent" as const,
    subtotal: "100.00", taxAmount: "0.00", discountAmount: "0.00", totalAmount: "100.00", amountPaid: "0.00",
    lineItems: [{ itemName: "Goods", quantity: "1", unitPrice: "100.00", taxPercent: "0", discountPercent: "0" }],
  });

  it("skips rows dated in a locked period and reports why, importing the rest", async () => {
    await owner.period.lockBooks({ through: "2026-03-31" });
    const invoices = await runInvoicesImport(db() as never, businessId, user, "test", [inv("IMP-OLD", "2026-02-01T06:30:00Z"), inv("IMP-NEW", "2026-07-01T06:30:00Z")], {
      autoCreatePayments: false, defaultPaymentMode: "cash",
    });
    expect(invoices.created).toBe(1);
    expect(invoices.skipped).toBe(1);
    expect(invoices.errors.join(" ")).toContain(LOCK_MSG);

    const payments = await runPaymentsImport(db() as never, businessId, user, "test", [
      { paymentDate: new Date("2026-02-01T06:30:00Z"), partyName: "Lock Customer", amount: "10.00", mode: "cash" },
    ], []);
    expect(payments.created).toBe(0);
    expect(payments.errors.join(" ")).toContain(LOCK_MSG);

    const transfers = await runTransfersImport(db() as never, businessId, user.id, "test", [
      { date: new Date("2026-02-01T06:30:00Z"), amount: "10.00", fromMode: "cash", toMode: "bank" },
    ]);
    expect(transfers.created).toBe(0);
    expect(transfers.errors.join(" ")).toContain(LOCK_MSG);
    await owner.period.unlockBooks({ through: null, reason: "Test cleanup after the import checks" });
  });
});
