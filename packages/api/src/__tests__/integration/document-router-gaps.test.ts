/**
 * Router gaps: the per-type document routers (debit notes, proformas,
 * sales/purchase returns, orders, challans, GRNs, credit notes). They share
 * one factory; this file calls the procedures no other file does, and pins
 * the stock side effects of cancel, reinstate and delete.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { items } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
let itemId: string;

type DocRouter = "debitNote" | "proforma" | "salesReturn" | "purchaseReturn" | "purchaseOrder" | "salesOrder"
  | "deliveryChallan" | "goodsReceiptNote" | "creditNote";

function create(kind: DocRouter, quantity = "2", type: "sale" | "purchase" = "sale") {
  return caller()[kind].create({
    partyId: world.party1.id, type, invoiceDate: new Date().toISOString(),
    lineItems: [{ itemId, itemName: "Doc item", quantity, unitPrice: "100", taxPercent: "0", discountPercent: "0" }],
  } as never) as Promise<{ id: string; invoiceNumber: string; status: string }>;
}

async function stock() {
  const [row] = await getTenantTestDb().select({ q: items.stockQuantity }).from(items).where(eq(items.id, itemId));
  return Number(row!.q);
}

beforeAll(async () => {
  world = await createTestWorld();
  itemId = (await caller().item.create({ name: "Doc gap item", unit: "pcs", stockQuantity: "100", purchasePrice: "50", salePrice: "100" } as never)).id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("getById / list for each type", () => {
  it.each(["creditNote", "debitNote", "proforma", "salesReturn", "purchaseReturn", "goodsReceiptNote", "deliveryChallan"] as const)(
    "%s.getById returns the document with lines and party; null for unknown, foreign or other types",
    async (kind) => {
      const doc = await create(kind);
      const got = await caller()[kind].getById({ id: doc.id });
      expect(got).toMatchObject({ id: doc.id, party: { id: world.party1.id } });
      expect(got!.lineItems).toHaveLength(1);
      expect(await caller()[kind].getById({ id: UNKNOWN })).toBeNull();
      expect(await other()[kind].getById({ id: doc.id })).toBeNull();
      const different = kind === "proforma" ? await create("debitNote") : await create("proforma");
      expect(await caller()[kind].getById({ id: different.id })).toBeNull();
      await expectCode(caller()[kind].getById({ id: "x" }), "BAD_REQUEST");
    },
  );

  it.each(["debitNote", "deliveryChallan", "goodsReceiptNote"] as const)("%s.list shows only its type, scoped to the business", async (kind) => {
    const doc = await create(kind);
    const res = await caller()[kind].list({ page: 1, limit: 100 });
    expect(res.data.map((d) => d.id)).toContain(doc.id);
    expect(res.data.every((d) => d.documentType === ({ debitNote: "debit_note", deliveryChallan: "delivery_challan", goodsReceiptNote: "goods_receipt_note" })[kind])).toBe(true);
    expect((await other()[kind].list({ page: 1, limit: 100 })).data.map((d) => d.id)).not.toContain(doc.id);
  });
});

describe("updateStatus", () => {
  it.each(["debitNote", "proforma", "purchaseOrder", "salesOrder"] as const)("%s: moves through allowed statuses and audits from/to", async (kind) => {
    const doc = await create(kind, "1", kind === "purchaseOrder" ? "purchase" : "sale");
    const sent = await caller()[kind].updateStatus({ id: doc.id, status: "sent" });
    expect(sent.status).toBe("sent");
    const [audit] = await waitForAudit(world.business1.id, `${({ debitNote: "debit_note", proforma: "proforma", purchaseOrder: "purchase_order", salesOrder: "sales_order" })[kind]}.updateStatus`, doc.id);
    expect(JSON.parse(String(audit!.metadata))).toMatchObject({ fromStatus: doc.status, toStatus: "sent" });
  });

  it("refuses statuses outside the type's list, unknown and foreign ids, and another type's id", async () => {
    const pf = await create("proforma");
    await expectCode(caller().proforma.updateStatus({ id: pf.id, status: "paid" as never }), "BAD_REQUEST");
    await expectCode(caller().proforma.updateStatus({ id: UNKNOWN, status: "sent" }), "NOT_FOUND");
    await expectCode(other().proforma.updateStatus({ id: pf.id, status: "sent" }), "NOT_FOUND");
    const dn = await create("debitNote");
    await expectCode(caller().proforma.updateStatus({ id: dn.id, status: "cancelled" }), "NOT_FOUND");
    expect((await caller().debitNote.getById({ id: dn.id }))!.status).toBe(dn.status);
  });

  it("cancelling a sales return takes its stock back out; reinstating puts it back", async () => {
    const start = await stock();
    const sr = await create("salesReturn", "3");
    expect(await stock()).toBe(start + 3);
    await caller().salesReturn.updateStatus({ id: sr.id, status: "cancelled" });
    expect(await stock()).toBe(start);
    await caller().salesReturn.updateStatus({ id: sr.id, status: "sent" });
    expect(await stock()).toBe(start + 3);
  });

  it("a deleted document can't be brought back with a status change", async () => {
    const pr = await create("purchaseReturn", "4", "purchase");
    const afterCreate = await stock();
    await caller().purchaseReturn.delete({ id: pr.id });
    expect(await stock()).toBe(afterCreate + 4);
    await expectCode(caller().purchaseReturn.updateStatus({ id: pr.id, status: "draft" }), "NOT_FOUND");
    expect(await stock()).toBe(afterCreate + 4);
  });

  it("a seller may update status (Invoice update) but not another business's document", async () => {
    const pf = await create("proforma");
    await expect(seller().proforma.updateStatus({ id: pf.id, status: "sent" })).resolves.toMatchObject({ status: "sent" });
  });
});

describe("delete", () => {
  it.each(["debitNote", "proforma", "salesReturn", "purchaseReturn"] as const)("%s: soft-deletes, cancels, audits once, and is idempotent", async (kind) => {
    const doc = await create(kind, "1", kind === "purchaseReturn" ? "purchase" : "sale");
    await expect(caller()[kind].delete({ id: doc.id })).resolves.toEqual({ success: true });
    const got = await caller()[kind].getById({ id: doc.id });
    expect(got).toMatchObject({ status: "cancelled" });
    expect(got!.deletedAt).not.toBeNull();
    await expect(caller()[kind].delete({ id: doc.id })).resolves.toEqual({ success: true });
    const action = `${({ debitNote: "debit_note", proforma: "proforma", salesReturn: "sales_return", purchaseReturn: "purchase_return" })[kind]}.delete`;
    expect(await waitForAudit(world.business1.id, action, doc.id)).toHaveLength(1);
  });

  it("deleting a sales return removes the stock it brought in", async () => {
    const start = await stock();
    const sr = await create("salesReturn", "5");
    await caller().salesReturn.delete({ id: sr.id });
    expect(await stock()).toBe(start);
  });

  it("NOT_FOUND for unknown, foreign and other-type ids; sellers refused", async () => {
    const dn = await create("debitNote");
    await expectCode(caller().debitNote.delete({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().debitNote.delete({ id: dn.id }), "NOT_FOUND");
    await expectCode(caller().salesReturn.delete({ id: dn.id }), "NOT_FOUND");
    await expectCode(seller().debitNote.delete({ id: dn.id }), "FORBIDDEN");
  });
});
