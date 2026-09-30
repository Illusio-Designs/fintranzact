/**
 * Router gaps: barcode (itemCodes, removeItemCode, generate, symbol),
 * item.deleteVariant, and payment (getById, defaultAccount,
 * untrackedPayments, assignAccount) — procedures no other file calls.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { bankAccounts, bankTransactions, itemVariants, payments } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createBankAccount, createItem, createParty, createPayment, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("barcode", () => {
  it("generate needs barcodes switched on, then mints distinct codes", async () => {
    await caller().barcode.update({ enabled: false });
    await expectCode(caller().barcode.generate({}), "PRECONDITION_FAILED");
    await caller().barcode.lock({ type: "code128", mode: "multi" });
    const a = await caller().barcode.generate({ sku: "SKU-1" });
    const b = await caller().barcode.generate({});
    expect(a.code).toBeTruthy();
    expect(b.code).not.toBe(a.code);
    await expectCode(seller().barcode.generate({}), "FORBIDDEN");
    await expectCode(caller().barcode.generate({ sku: "x".repeat(51) }), "BAD_REQUEST");
  });

  it("itemCodes lists an item's codes oldest first; removeItemCode deletes one", async () => {
    const item = await createItem(getTenantTestDb(), world.business1.id, { name: "Coded item" });
    const one = await caller().barcode.addItemCode({ itemId: item.id, code: "PACK-ONE", packQty: "1" });
    const six = await caller().barcode.addItemCode({ itemId: item.id, code: "PACK-SIX", packQty: "6", label: "Six pack", source: "supplier" });
    const codes = await caller().barcode.itemCodes({ itemId: item.id });
    expect(codes.map((c) => c.code)).toEqual(["PACK-ONE", "PACK-SIX"]);
    expect(codes[1]).toMatchObject({ packQty: "6.000", label: "Six pack", source: "supplier" });
    expect(await other().barcode.itemCodes({ itemId: item.id })).toEqual([]);

    await expectCode(other().barcode.removeItemCode({ id: one!.id }), "NOT_FOUND");
    await expectCode(seller().barcode.removeItemCode({ id: one!.id }), "FORBIDDEN");
    await expect(caller().barcode.removeItemCode({ id: one!.id })).resolves.toEqual({ id: one!.id });
    await expectCode(caller().barcode.removeItemCode({ id: one!.id }), "NOT_FOUND");
    expect((await caller().barcode.itemCodes({ itemId: item.id })).map((c) => c.id)).toEqual([six!.id]);
  });

  it("symbol draws Code 128, EAN-13 and QR, and validates the code", async () => {
    const bars = await caller().barcode.symbol({ code: "ABC-123", type: "code128" });
    expect(bars).toMatchObject({ kind: "bars", type: "code128", text: "ABC-123" });
    expect((bars as { modules: string }).modules).toMatch(/^[01]+$/);
    const ean = await caller().barcode.symbol({ code: "4006381333931", type: "ean13" });
    expect(ean).toMatchObject({ kind: "bars", type: "ean13", text: "4 006381 333931" });
    // Not a valid EAN-13: drawn as Code 128 instead.
    expect(await caller().barcode.symbol({ code: "4006381333932", type: "ean13" })).toMatchObject({ type: "code128" });
    const qr = await caller().barcode.symbol({ code: "hello", type: "qr" });
    expect(qr.kind).toBe("matrix");
    expect((qr as { rows: string[] }).rows.length).toBeGreaterThan(10);
    // Without a type, the business's setup (code128 here) is used.
    expect(await caller().barcode.symbol({ code: "X1" })).toMatchObject({ type: "code128" });
    await expectCode(caller().barcode.symbol({ code: "" }), "BAD_REQUEST");
    await expectCode(caller().barcode.symbol({ code: "x".repeat(65) }), "BAD_REQUEST");
    await expectCode(caller().barcode.symbol({ code: "tab\there" }), "BAD_REQUEST");
  });
});

describe("item.deleteVariant", () => {
  it("soft-deletes once, audits once, and is idempotent; NOT_FOUND for unknown and foreign", async () => {
    const db = getTenantTestDb();
    const parent = await createItem(db, world.business1.id, { name: "Variant parent", itemMode: "variants" });
    const [v] = await db.insert(itemVariants).values({ itemId: parent.id, attributeValues: { Size: "L" } }).returning();
    await expectCode(other().item.deleteVariant({ variantId: v!.id }), "NOT_FOUND");
    await expectCode(seller().item.deleteVariant({ variantId: v!.id }), "FORBIDDEN");
    await expect(caller().item.deleteVariant({ variantId: v!.id })).resolves.toEqual({ success: true });
    const [row] = await db.select().from(itemVariants).where(eq(itemVariants.id, v!.id));
    expect(row!.deletedAt).not.toBeNull();
    await expect(caller().item.deleteVariant({ variantId: v!.id })).resolves.toEqual({ success: true });
    expect(await waitForAudit(world.business1.id, "item.deleteVariant", v!.id)).toHaveLength(1);
    expect((await caller().item.listVariants({ itemId: parent.id })).map((x) => x.id)).not.toContain(v!.id);
    await expectCode(caller().item.deleteVariant({ variantId: UNKNOWN }), "NOT_FOUND");
  });
});

describe("payment", () => {
  it("getById returns the payment with its party; null for unknown and foreign", async () => {
    const p = await createPayment(getTenantTestDb(), world.business1.id, world.party1.id, { amount: "750.00", paymentNumber: "PAY-GAP-1" });
    await expect(caller().payment.getById({ id: p.id })).resolves.toMatchObject({ id: p.id, amount: "750.00", partyName: world.party1.name, linkedInvoices: [] });
    expect(await caller().payment.getById({ id: UNKNOWN })).toBeNull();
    expect(await other().payment.getById({ id: p.id })).toBeNull();
  });

  it("defaultAccount: the party's last account, else the most used, else the default; null with none", async () => {
    expect(await other().payment.defaultAccount()).toBeNull();
    const db = getTenantTestDb();
    const def = await createBankAccount(db, world.business1.id, { accountName: "Default acct", isDefault: true });
    expect((await caller().payment.defaultAccount())!.id).toBe(def.id);
    const used = await createBankAccount(db, world.business1.id, { accountName: "Used acct", isDefault: false });
    await createPayment(db, world.business1.id, world.party1.id, { bankAccountId: used.id, paymentDate: new Date(Date.now() - 86_400_000) });
    expect((await caller().payment.defaultAccount())!.id).toBe(used.id);
    const partyAcct = await createBankAccount(db, world.business1.id, { accountName: "Party acct", isDefault: false });
    const { id: partyId } = await createParty(db, world.business1.id, { name: "Loyal payer" });
    await createPayment(db, world.business1.id, partyId, { bankAccountId: partyAcct.id, paymentDate: new Date(Date.now() - 5 * 86_400_000) });
    expect((await caller().payment.defaultAccount({ partyId }))!.id).toBe(partyAcct.id);
    await expectCode(seller().payment.defaultAccount(), "FORBIDDEN");
  });

  describe("untrackedPayments / assignAccount", () => {
    let acct: { id: string; currentBalance: string };
    beforeAll(async () => {
      acct = await createBankAccount(getTenantTestDb(), world.business1.id, { accountName: "Assign acct", currentBalance: "1000.00", isDefault: false });
    });

    const balance = async () => {
      const [row] = await getTenantTestDb().select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, acct.id));
      return row!.b;
    };

    it("lists untracked payments with filters, and never deleted ones", async () => {
      const db = getTenantTestDb();
      const live = await createPayment(db, world.business1.id, world.party1.id, { amount: "100.00", mode: "upi", paymentNumber: "UNTRK-LIVE" });
      const gone = await createPayment(db, world.business1.id, world.party1.id, { amount: "100.00", mode: "upi", paymentNumber: "UNTRK-GONE", deletedAt: new Date() });
      const res = await caller().payment.untrackedPayments({ search: "UNTRK", page: 1, limit: 100 });
      expect(res.data.map((p) => p.id)).toContain(live.id);
      expect(res.data.map((p) => p.id)).not.toContain(gone.id);
      expect((await caller().payment.untrackedPayments({ search: "UNTRK", mode: "cash", page: 1, limit: 100 })).total).toBe(0);
      expect((await other().payment.untrackedPayments({ page: 1, limit: 100 })).total).toBe(0);
      await expectCode(caller().payment.untrackedPayments({ mode: "card" as never, page: 1, limit: 10 }), "BAD_REQUEST");
    });

    it("assigns chosen payments: records deposits, moves the balance, audits", async () => {
      const db = getTenantTestDb();
      const p1 = await createPayment(db, world.business1.id, world.party1.id, { amount: "200.00", paymentNumber: "ASSIGN-1" });
      const p2 = await createPayment(db, world.business1.id, world.party1.id, { amount: "300.00", paymentNumber: "ASSIGN-2" });
      const before = parseFloat(await balance());
      const res = await caller().payment.assignAccount({ paymentIds: [p1.id, p2.id], bankAccountId: acct.id });
      expect(res).toEqual({ assigned: 2 });
      expect(parseFloat(await balance())).toBe(before + 500);
      const txns = await db.select().from(bankTransactions).where(and(eq(bankTransactions.bankAccountId, acct.id), eq(bankTransactions.referenceType, "payment")));
      expect(txns.map((t) => t.referenceId).sort()).toEqual([p1.id, p2.id].sort());
      expect(await waitForAudit(world.business1.id, "payment.reassignBankAccount")).not.toHaveLength(0);
      // Already assigned: nothing more happens.
      expect(await caller().payment.assignAccount({ paymentIds: [p1.id], bankAccountId: acct.id })).toEqual({ assigned: 0 });
      expect(parseFloat(await balance())).toBe(before + 500);
    });

    it("counts only what it assigned: foreign, unknown and deleted payments are skipped", async () => {
      const db = getTenantTestDb();
      const theirs = await createPayment(db, world.business2.id, world.party2.id, { amount: "999.00" });
      const gone = await createPayment(db, world.business1.id, world.party1.id, { amount: "40.00", deletedAt: new Date() });
      const before = await balance();
      expect(await caller().payment.assignAccount({ paymentIds: [theirs.id, UNKNOWN, gone.id], bankAccountId: acct.id })).toEqual({ assigned: 0 });
      expect(await balance()).toBe(before);
      const [t] = await db.select().from(payments).where(eq(payments.id, theirs.id));
      expect(t!.bankAccountId).toBeNull();
      const [g] = await db.select().from(payments).where(eq(payments.id, gone.id));
      expect(g!.bankAccountId).toBeNull();
    });

    it("allMatching assigns every live untracked payment that matches", async () => {
      const db = getTenantTestDb();
      const m1 = await createPayment(db, world.business1.id, world.party1.id, { amount: "10.00", mode: "cheque", paymentNumber: "BULK-1" });
      const m2 = await createPayment(db, world.business1.id, world.party1.id, { amount: "15.00", mode: "cheque", paymentNumber: "BULK-2" });
      await createPayment(db, world.business1.id, world.party1.id, { amount: "20.00", mode: "cheque", paymentNumber: "BULK-3", deletedAt: new Date() });
      const res = await caller().payment.assignAccount({ allMatching: true, search: "BULK-", mode: "cheque", bankAccountId: acct.id });
      expect(res).toEqual({ assigned: 2 });
      const rows = await db.select().from(payments).where(eq(payments.bankAccountId, acct.id));
      expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([m1.id, m2.id]));
    });

    it("refuses an unknown or foreign account; sellers refused", async () => {
      const p = await createPayment(getTenantTestDb(), world.business1.id, world.party1.id, { amount: "5.00" });
      const theirAcct = await createBankAccount(getTenantTestDb(), world.business2.id, { accountName: "Theirs" });
      await expectCode(caller().payment.assignAccount({ paymentIds: [p.id], bankAccountId: UNKNOWN }), "NOT_FOUND");
      await expectCode(caller().payment.assignAccount({ paymentIds: [p.id], bankAccountId: theirAcct.id }), "NOT_FOUND");
      await expectCode(caller().payment.assignAccount({ paymentIds: ["x"], bankAccountId: acct.id }), "BAD_REQUEST");
    });
  });
});
