/**
 * Router gaps: store order management (listOrders, getOrder, confirmOrder,
 * cancelOrder, updateOrderStatus) and updateVariantStoreSettings.
 *
 * Orders are set up the way the public checkout leaves them: a pending
 * store order linked to an "unfulfilled" sale invoice that has already
 * taken the stock out.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, items, itemVariants, storeOrders } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createItem, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";
import { syncDocumentStock } from "../../lib/inventory-service.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
let itemId: string;
let n = 0;

async function stock() {
  const [row] = await getTenantTestDb().select({ q: items.stockQuantity }).from(items).where(eq(items.id, itemId));
  return Number(row!.q);
}

/** A checkout-style order: unfulfilled invoice with stock taken, pending order. */
async function placeOrder(quantity = 2, customerName = "Walk-in Buyer") {
  const db = getTenantTestDb();
  n++;
  const [inv] = await db.insert(invoices).values({
    businessId: world.business1.id, partyId: world.party1.id, type: "sale", status: "unfulfilled", documentType: "invoice",
    invoiceNumber: `STORE-${n}`, invoiceDate: new Date(), subtotal: "200.00", taxAmount: "0.00", totalAmount: "200.00",
    source: "online_store", stockMode: "tracked",
  } as never).returning();
  const { invoiceItems } = await import("@fintranzact/db");
  await db.insert(invoiceItems).values({
    invoiceId: inv!.id, itemId, itemName: "Store item", quantity: String(quantity), unitPrice: "100", taxPercent: "0",
    taxAmount: "0", discountPercent: "0", totalAmount: String(quantity * 100), sortOrder: 0, conversionFactor: "1",
  });
  await db.transaction(async (tx) => {
    await syncDocumentStock(tx as never, { businessId: world.business1.id, documentId: inv!.id, event: "CREATE" });
  });
  const [order] = await db.insert(storeOrders).values({
    businessId: world.business1.id, invoiceId: inv!.id, orderNumber: `ORD-${n}`, status: "pending",
    customerName, customerPhone: `98${String(n).padStart(8, "0")}`, totalAmount: "200.00", itemCount: 1,
  }).returning();
  return { order: order!, invoiceId: inv!.id };
}

async function invoiceStatus(id: string) {
  const [row] = await getTenantTestDb().select({ s: invoices.status }).from(invoices).where(eq(invoices.id, id));
  return row!.s;
}

beforeAll(async () => {
  world = await createTestWorld();
  itemId = (await createItem(getTenantTestDb(), world.business1.id, { name: "Store stock item", stockQuantity: "50.000" })).id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("listOrders / getOrder", () => {
  it("lists with status, search and date filters; pages; scoped to the business", async () => {
    const { order } = await placeOrder(1, "Kavya Search");
    const all = await caller().store.listOrders({ page: 1, limit: 100 });
    expect(all.data.map((o) => o.id)).toContain(order.id);
    expect((await caller().store.listOrders({ search: "kavya sea", page: 1, limit: 10 })).data.map((o) => o.id)).toEqual([order.id]);
    expect((await caller().store.listOrders({ search: order.orderNumber, page: 1, limit: 10 })).total).toBe(1);
    expect((await caller().store.listOrders({ status: "delivered", page: 1, limit: 10 })).data.map((o) => o.id)).not.toContain(order.id);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await caller().store.listOrders({ fromDate: future, page: 1, limit: 10 })).total).toBe(0);
    expect((await caller().store.listOrders({ search: "%", page: 1, limit: 10 })).total).toBe(0);
    expect((await other().store.listOrders({ page: 1, limit: 10 })).total).toBe(0);
    await expectCode(caller().store.listOrders({ status: "shipped" as never, page: 1, limit: 10 }), "BAD_REQUEST");
  });

  it("getOrder includes the linked invoice and lines; NOT_FOUND for unknown and foreign", async () => {
    const { order, invoiceId } = await placeOrder();
    const got = await caller().store.getOrder({ id: order.id });
    expect(got.invoice!.id).toBe(invoiceId);
    expect(got.lineItems).toHaveLength(1);
    await expectCode(caller().store.getOrder({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().store.getOrder({ id: order.id }), "NOT_FOUND");
  });
});

describe("confirmOrder", () => {
  it("confirms a pending order and sends its invoice; can't confirm twice", async () => {
    const { order, invoiceId } = await placeOrder();
    await expect(caller().store.confirmOrder({ orderId: order.id })).resolves.toEqual({ success: true, orderId: order.id });
    const [row] = await getTenantTestDb().select().from(storeOrders).where(eq(storeOrders.id, order.id));
    expect(row!.status).toBe("confirmed");
    expect(row!.confirmedAt).not.toBeNull();
    expect(await invoiceStatus(invoiceId)).toBe("sent");
    await expectCode(caller().store.confirmOrder({ orderId: order.id }), "BAD_REQUEST");
  });

  it("NOT_FOUND for unknown and foreign orders; sellers can't confirm", async () => {
    const { order } = await placeOrder();
    await expectCode(caller().store.confirmOrder({ orderId: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().store.confirmOrder({ orderId: order.id }), "NOT_FOUND");
    await expectCode(seller().store.confirmOrder({ orderId: order.id }), "FORBIDDEN");
  });
});

describe("cancelOrder", () => {
  it("cancels the order and its invoice, and puts the stock back", async () => {
    const before = await stock();
    const { order, invoiceId } = await placeOrder(3);
    expect(await stock()).toBe(before - 3);
    await caller().store.cancelOrder({ orderId: order.id, reason: "Out of area" });
    const [row] = await getTenantTestDb().select().from(storeOrders).where(eq(storeOrders.id, order.id));
    expect(row).toMatchObject({ status: "cancelled", cancellationReason: "Out of area" });
    expect(await invoiceStatus(invoiceId)).toBe("cancelled");
    expect(await stock()).toBe(before);
  });

  it("refuses delivered and already-cancelled orders; validates the reason", async () => {
    const { order } = await placeOrder();
    await expectCode(caller().store.cancelOrder({ orderId: order.id, reason: "x".repeat(501) }), "BAD_REQUEST");
    await caller().store.cancelOrder({ orderId: order.id });
    await expectCode(caller().store.cancelOrder({ orderId: order.id }), "BAD_REQUEST");
    const { order: done } = await placeOrder();
    await caller().store.updateOrderStatus({ orderId: done.id, status: "delivered" });
    await expectCode(caller().store.cancelOrder({ orderId: done.id }), "BAD_REQUEST");
  });

  it("NOT_FOUND for unknown and foreign orders; sellers refused", async () => {
    const { order } = await placeOrder();
    await expectCode(caller().store.cancelOrder({ orderId: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().store.cancelOrder({ orderId: order.id }), "NOT_FOUND");
    await expectCode(seller().store.cancelOrder({ orderId: order.id }), "FORBIDDEN");
  });
});

describe("updateOrderStatus", () => {
  it("moves an order along; refuses a cancelled one and unknown statuses", async () => {
    const { order } = await placeOrder();
    await caller().store.confirmOrder({ orderId: order.id });
    await expect(caller().store.updateOrderStatus({ orderId: order.id, status: "preparing" })).resolves.toEqual({ success: true, status: "preparing" });
    await caller().store.updateOrderStatus({ orderId: order.id, status: "ready" });
    await expectCode(caller().store.updateOrderStatus({ orderId: order.id, status: "cancelled" as never }), "BAD_REQUEST");
    const { order: dead } = await placeOrder();
    await caller().store.cancelOrder({ orderId: dead.id });
    await expectCode(caller().store.updateOrderStatus({ orderId: dead.id, status: "ready" }), "BAD_REQUEST");
  });

  it("NOT_FOUND for unknown and foreign orders; sellers refused", async () => {
    const { order } = await placeOrder();
    await expectCode(caller().store.updateOrderStatus({ orderId: UNKNOWN, status: "ready" }), "NOT_FOUND");
    await expectCode(other().store.updateOrderStatus({ orderId: order.id, status: "ready" }), "NOT_FOUND");
    await expectCode(seller().store.updateOrderStatus({ orderId: order.id, status: "ready" }), "FORBIDDEN");
  });
});

describe("updateVariantStoreSettings", () => {
  it("enables a variant with its own price; NOT_FOUND for unknown, foreign and deleted variants", async () => {
    const db = getTenantTestDb();
    const parent = await createItem(db, world.business1.id, { name: "Store tee", itemMode: "variants" });
    const [v] = await db.insert(itemVariants).values({ itemId: parent.id, attributeValues: { Size: "M" } }).returning();
    const res = await caller().store.updateVariantStoreSettings({ variantId: v!.id, storeEnabled: true, storePrice: "299" });
    expect(res).toMatchObject({ storeEnabled: true, storePrice: "299.00" });
    const cleared = await caller().store.updateVariantStoreSettings({ variantId: v!.id, storePrice: null });
    expect(cleared).toMatchObject({ storeEnabled: true, storePrice: null });

    await expectCode(caller().store.updateVariantStoreSettings({ variantId: UNKNOWN, storeEnabled: true }), "NOT_FOUND");
    await expectCode(other().store.updateVariantStoreSettings({ variantId: v!.id, storeEnabled: false }), "NOT_FOUND");
    await expectCode(caller().store.updateVariantStoreSettings({ variantId: v!.id, storePrice: "abc" }), "BAD_REQUEST");
    await db.update(itemVariants).set({ deletedAt: new Date() }).where(eq(itemVariants.id, v!.id));
    await expectCode(caller().store.updateVariantStoreSettings({ variantId: v!.id, storeEnabled: false }), "NOT_FOUND");
    await expectCode(seller().store.updateVariantStoreSettings({ variantId: v!.id, storeEnabled: false }), "FORBIDDEN");
  });
});
