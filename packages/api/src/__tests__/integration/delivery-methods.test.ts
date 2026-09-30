/**
 * Delivery methods on invoices and other documents.
 *
 * A document's delivery method is either a built-in one (self_pickup,
 * hand_delivery, courier, bus, transport, post) or one of the business's own
 * methods from Settings → Shipping (`businesses.customShippingMethods`). The
 * server checks custom ids against that list, so a method the business
 * doesn't offer is rejected rather than stored.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, shipments } from "@fintranzact/db";
import { createInvoiceSchema, updateBusinessSchema } from "@fintranzact/shared";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
  await callerForRamesh().business.update({
    id: world.business1.id,
    data: {
      customShippingMethods: [
        { id: "porter", label: "Porter", hasTracking: false },
        { id: "local_tempo", label: "Local Tempo", hasTracking: true },
      ],
    },
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function callerForKiran() {
  return createTestCaller({
    userId: world.kiran.id,
    email: world.kiran.email,
    name: world.kiran.name ?? null,
    tenantId: world.tenant2.id,
    businessId: world.business2.id,
  });
}

const line = {
  itemName: "Parcel goods",
  quantity: "1",
  unitPrice: "500.00",
  taxPercent: "0",
  discountPercent: "0",
};

async function savedMethod(id: string) {
  const [row] = await getTenantTestDb()
    .select({ deliveryMethod: invoices.deliveryMethod })
    .from(invoices)
    .where(eq(invoices.id, id));
  return row?.deliveryMethod;
}

describe("validators", () => {
  it("accepts any method id in the shape, defaulting to self_pickup", () => {
    const base = { partyId: "00000000-0000-4000-8000-000000000000", type: "sale", lineItems: [line] };
    expect(createInvoiceSchema.parse(base).deliveryMethod).toBe("self_pickup");
    expect(createInvoiceSchema.parse({ ...base, deliveryMethod: "porter" }).deliveryMethod).toBe("porter");
    expect(createInvoiceSchema.safeParse({ ...base, deliveryMethod: "" }).success).toBe(false);
  });

  it("rejects custom methods that reuse a built-in id or repeat an id", () => {
    expect(updateBusinessSchema.safeParse({
      customShippingMethods: [{ id: "courier", label: "Courier", hasTracking: true }],
    }).success).toBe(false);
    expect(updateBusinessSchema.safeParse({
      customShippingMethods: [
        { id: "porter", label: "Porter", hasTracking: false },
        { id: "porter", label: "Porter 2", hasTracking: false },
      ],
    }).success).toBe(false);
  });
});

describe("invoice.create", () => {
  it("keeps built-in methods working", async () => {
    const caller = callerForRamesh();
    const inv = await caller.invoice.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "courier", lineItems: [line] });
    expect(await savedMethod(inv.id)).toBe("courier");

    const plain = await caller.invoice.create({ partyId: world.party1.id, type: "sale", lineItems: [line] });
    expect(await savedMethod(plain.id)).toBe("self_pickup");
  });

  it("stores one of the business's custom methods", async () => {
    const caller = callerForRamesh();
    const inv = await caller.invoice.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "porter", lineItems: [line] });
    expect(await savedMethod(inv.id)).toBe("porter");
    expect(await caller.invoice.lastDeliveryMethod({ partyId: world.party1.id })).toBe("porter");
  });

  it("matches a custom method typed by its name (CLI prompt) and stores its id", async () => {
    const caller = callerForRamesh();
    const inv = await caller.invoice.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "local tempo", lineItems: [line] });
    expect(await savedMethod(inv.id)).toBe("local_tempo");
  });

  it("rejects a method the business hasn't added", async () => {
    const caller = callerForRamesh();
    await expect(
      caller.invoice.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "dunzo", lineItems: [line] }),
    ).rejects.toThrow(/Unknown delivery method "dunzo"/);
  });

  it("does not accept another business's custom method", async () => {
    await expect(
      callerForKiran().invoice.create({ partyId: world.party2.id, type: "sale", deliveryMethod: "porter", lineItems: [line] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("uses the custom method as the mode of the auto-created shipment", async () => {
    const caller = callerForRamesh();
    const inv = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale",
      deliveryMethod: "porter",
      charges: [{ label: "Shipping", amount: "60.00" }],
      lineItems: [line],
    });
    const [shipment] = await getTenantTestDb().select({ mode: shipments.mode }).from(shipments).where(eq(shipments.invoiceId, inv.id));
    expect(shipment?.mode).toBe("porter");
  });
});

describe("invoice.update", () => {
  it("changes the method to a custom one and rejects unknown ones", async () => {
    const caller = callerForRamesh();
    const inv = await caller.invoice.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "bus", lineItems: [line] });

    await caller.invoice.update({ id: inv.id, deliveryMethod: "local_tempo" });
    expect(await savedMethod(inv.id)).toBe("local_tempo");

    await expect(caller.invoice.update({ id: inv.id, deliveryMethod: "rocket" })).rejects.toThrow(/Unknown delivery method/);
    expect(await savedMethod(inv.id)).toBe("local_tempo");
  });

  it("keeps a saved method that has since been removed from Settings → Shipping", async () => {
    const caller = callerForRamesh();
    const inv = await caller.invoice.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "porter", lineItems: [line] });
    await getTenantTestDb().update(invoices).set({ deliveryMethod: "retired_van" }).where(eq(invoices.id, inv.id));

    await caller.invoice.update({ id: inv.id, deliveryMethod: "retired_van", notes: "still going by van" });
    expect(await savedMethod(inv.id)).toBe("retired_van");
  });
});

describe("other documents", () => {
  it("stores built-in and custom methods on factory documents and rejects unknown ones", async () => {
    const caller = callerForRamesh();
    const challan = await caller.deliveryChallan.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "porter", lineItems: [line] });
    expect(await savedMethod(challan.id)).toBe("porter");

    const quotation = await caller.quotation.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "transport", lineItems: [line] });
    expect(await savedMethod(quotation.id)).toBe("transport");

    await expect(
      caller.salesOrder.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "teleport", lineItems: [line] }),
    ).rejects.toThrow(/Unknown delivery method/);
  });

  it("carries the method from a quotation to the invoice made from it", async () => {
    const caller = callerForRamesh();
    const quotation = await caller.quotation.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "local_tempo", lineItems: [line] });
    const converted = await caller.document.convert({ sourceDocumentId: quotation.id, targetDocumentType: "invoice" });
    expect(await savedMethod(converted.id)).toBe("local_tempo");
  });

  it("falls back to the default when converting a document whose method is no longer offered", async () => {
    const caller = callerForRamesh();
    const quotation = await caller.quotation.create({ partyId: world.party1.id, type: "sale", deliveryMethod: "porter", lineItems: [line] });
    await getTenantTestDb().update(invoices).set({ deliveryMethod: "retired_van" }).where(eq(invoices.id, quotation.id));

    const converted = await caller.document.convert({ sourceDocumentId: quotation.id, targetDocumentType: "invoice" });
    expect(await savedMethod(converted.id)).toBe("self_pickup");
  });
});
