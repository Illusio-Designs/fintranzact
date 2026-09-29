/**
 * Default warehouse + legacy compatibility for the warehouse/business-member
 * model.
 *
 * - business.create sets up one "Main" warehouse from the registration address
 *   and points every inventory operation at it.
 * - Businesses from before warehouses existed get the same default lazily the
 *   first time stock moves, so invoicing keeps working without any setup.
 * - Invoices from before warehouses existed (no stock movements) reverse stock
 *   from their line items; repeated edits of new invoices never double-reverse.
 * - Businesses from before per-business membership give the whole tenant team
 *   access on first use, instead of locking everyone out.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  businessMembers,
  inventorySettings,
  items,
  premises,
  warehouses,
} from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import {
  createUser,
  createTenant,
  addMember,
  createBusiness,
  createItem,
  createParty,
  createInvoiceWithItems,
  type TestUser,
  type TestTenant,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

const callerFactory = createCallerFactory(appRouter);

let owner: TestUser;
let seller: TestUser;
let tenant: TestTenant;

function tenantCaller(user: TestUser) {
  return callerFactory({
    user: { id: user.id, email: user.email, name: user.name },
    tenantId: tenant.id,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

function businessCaller(user: TestUser, businessId: string) {
  return createTestCaller({
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    tenantId: tenant.id,
    businessId,
  });
}

async function stockOf(itemId: string) {
  const [row] = await getTenantTestDb()
    .select({ qty: items.stockQuantity })
    .from(items)
    .where(eq(items.id, itemId));
  return Number(row!.qty);
}

beforeAll(async () => {
  owner = await createUser({ email: "owner.wh@acmetrading.in", name: "Asha Owner" });
  seller = await createUser({ email: "seller.wh@acmetrading.in", name: "Sunil Seller" });
  tenant = await createTenant({ name: "Warehouse Defaults Org" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, seller.id, "seller");
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("business.create — default warehouse from the registration address", () => {
  it("creates one Main premise + warehouse and uses it for every operation", async () => {
    const biz = await tenantCaller(owner).business.create({
      name: "Registration Warehouse Co",
      pan: "ABCDE1234F",
      phone: "9123456780",
      address: "12, Station Road",
      city: "Pune",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "411001",
      gstRegistrationType: "unregistered" as const,
      invoicePrefix: "RWC",
      currency: "INR",
    });

    const db = getTenantTestDb();
    const whs = await db.select().from(warehouses).where(eq(warehouses.businessId, biz.id));
    expect(whs).toHaveLength(1);
    expect(whs[0]!.code).toBe("MAIN");
    expect(whs[0]!.address).toBe("12, Station Road, Pune, Maharashtra, 411001");

    const [premise] = await db.select().from(premises).where(eq(premises.id, whs[0]!.premiseId));
    expect(premise!.city).toBe("Pune");
    expect(premise!.state).toBe("Maharashtra");

    const [settings] = await db
      .select()
      .from(inventorySettings)
      .where(eq(inventorySettings.businessId, biz.id));
    for (const id of [
      settings!.salesWarehouseId,
      settings!.purchaseWarehouseId,
      settings!.salesReturnWarehouseId,
      settings!.purchaseReturnWarehouseId,
      settings!.productionWarehouseId,
      settings!.stockAdjustmentWarehouseId,
    ]) {
      expect(id).toBe(whs[0]!.id);
    }
  });
});

describe("businesses from before warehouses and business members", () => {
  let bizId: string;
  let itemId: string;
  let partyId: string;

  beforeAll(async () => {
    // Inserted directly: no business_members rows, no warehouse, no settings.
    const biz = await createBusiness(getTenantTestDb(), owner.id, { name: "Legacy Traders" });
    bizId = biz.id;
    const item = await createItem(getTenantTestDb(), bizId, { name: "Legacy Widget", stockQuantity: "50.000" });
    itemId = item.id;
    const party = await createParty(getTenantTestDb(), bizId, { name: "Legacy Customer" });
    partyId = party.id;
  });

  it("gives the whole tenant team access on first use, with roles mapped from the tenant", async () => {
    const list = await tenantCaller(seller).business.list();
    expect(list.map((b) => b.id)).toContain(bizId);

    const members = await getTenantTestDb()
      .select({ userId: businessMembers.userId, role: businessMembers.role })
      .from(businessMembers)
      .where(eq(businessMembers.businessId, bizId));
    expect(members).toEqual(expect.arrayContaining([
      { userId: owner.id, role: "admin" },
      { userId: seller.id, role: "member" },
    ]));
  });

  it("creates the default warehouse on the first invoice instead of failing", async () => {
    const invoice = await businessCaller(owner, bizId).invoice.create({
      type: "sale",
      partyId,
      invoiceDate: new Date().toISOString(),
      lineItems: [{ itemId, itemName: "Legacy Widget", quantity: "5", unitPrice: "100.00", taxPercent: "0", discountPercent: "0", conversionFactor: "1" }],
    });

    expect(invoice.id).toBeDefined();
    expect(await stockOf(itemId)).toBe(45);
    const whs = await getTenantTestDb().select().from(warehouses).where(eq(warehouses.businessId, bizId));
    expect(whs).toHaveLength(1);
  });

  it("editing an invoice twice nets stock correctly (no double reversal)", async () => {
    const caller = businessCaller(owner, bizId);
    const invoice = await caller.invoice.create({
      type: "sale",
      partyId,
      invoiceDate: new Date().toISOString(),
      lineItems: [{ itemId, itemName: "Legacy Widget", quantity: "4", unitPrice: "100.00", taxPercent: "0", discountPercent: "0", conversionFactor: "1" }],
    });
    expect(await stockOf(itemId)).toBe(41);

    for (const quantity of ["6", "2"]) {
      await caller.invoice.update({
        id: invoice.id,
        lineItems: [{ itemId, itemName: "Legacy Widget", quantity, unitPrice: "100.00", taxPercent: "0", discountPercent: "0", conversionFactor: "1" }],
      });
    }
    expect(await stockOf(itemId)).toBe(43);

    await caller.invoice.delete({ id: invoice.id });
    expect(await stockOf(itemId)).toBe(45);
  });

  it("reverses stock of a pre-warehouse invoice from its line items on delete", async () => {
    // Pre-warehouse invoices changed item stock directly and recorded no movements.
    const { invoice } = await createInvoiceWithItems(getTenantTestDb(), bizId, partyId, [
      { itemId, itemName: "Legacy Widget", quantity: "3", unitPrice: "100.00" },
    ]);
    await getTenantTestDb().update(items).set({ stockQuantity: "42.000" }).where(eq(items.id, itemId));

    await businessCaller(owner, bizId).invoice.delete({ id: invoice.id });
    expect(await stockOf(itemId)).toBe(45);
  });
});
