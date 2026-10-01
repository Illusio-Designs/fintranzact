/**
 * Warehouse management: guards on deactivating and deleting warehouses, and
 * per-member access grants that the stock screens enforce.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { tenantMembers } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

let world: TestWorld;

function owner() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function seller() {
  return createTestCaller({
    userId: world.suresh.id,
    email: world.suresh.email,
    name: world.suresh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

let mainId: string;
let premiseId: string;

async function newWarehouse(name: string) {
  return owner().warehouse.warehouseCreate({
    premiseId,
    name,
    code: name.replace(/\W/g, "").toUpperCase().slice(0, 8),
    warehouseType: "godown",
  });
}

beforeAll(async () => {
  world = await createTestWorld();
  // A seller manager may move stock, but only where granted — unlike an admin.
  await getTenantTestDb()
    .update(tenantMembers)
    .set({ role: "seller_manager" })
    .where(and(eq(tenantMembers.userId, world.suresh.id), eq(tenantMembers.tenantId, world.tenant1.id)));
  await owner().stock.setup();
  const [main] = await owner().warehouse.warehouseList();
  mainId = main!.id;
  premiseId = main!.premiseId;
});

afterAll(async () => {
  await truncateAllTables();
});

describe("deactivating and deleting", () => {
  it("won't deactivate or delete a default warehouse", async () => {
    await expect(owner().warehouse.warehouseUpdate({ id: mainId, status: "inactive" })).rejects.toThrow(/default warehouse/);
    await expect(owner().warehouse.warehouseDelete({ id: mainId })).rejects.toThrow(/default warehouse/);
  });

  it("won't deactivate a warehouse that holds stock, or delete one with history", async () => {
    const godown = await newWarehouse("Stocked");
    const item = await owner().item.create({ name: "Boxed", unit: "pcs", stockQuantity: "10" } as never);
    await owner().stock.transfer({ sourceWarehouseId: mainId, destinationWarehouseId: godown.id, lines: [{ itemId: item.id, quantity: "4" }] });

    await expect(owner().warehouse.warehouseUpdate({ id: godown.id, status: "inactive" })).rejects.toThrow(/holds stock/);

    await owner().stock.transfer({ sourceWarehouseId: godown.id, destinationWarehouseId: mainId, lines: [{ itemId: item.id, quantity: "4" }] });
    await owner().warehouse.warehouseUpdate({ id: godown.id, status: "inactive" });
    await expect(owner().warehouse.warehouseDelete({ id: godown.id })).rejects.toThrow(/stock history/);
  });

  it("deletes an unused warehouse", async () => {
    const empty = await newWarehouse("Unused");
    await owner().warehouse.warehouseDelete({ id: empty.id });
    const list = await owner().warehouse.warehouseList();
    expect(list.find((w) => w.id === empty.id)).toBeUndefined();
  });
});

describe("per-member access", () => {
  it("lists members, with admins on full access", async () => {
    const members = await owner().warehouse.accessList({ warehouseId: mainId });
    const me = members.find((m) => m.email === world.ramesh.email)!;
    expect(me.fullAccess).toBe(true);
    const sellerRow = members.find((m) => m.email === world.suresh.email)!;
    expect(sellerRow.role).toBe("seller_manager");
    expect(sellerRow.fullAccess).toBe(false);
  });

  it("a grant lets a non-admin transfer, and removing it takes that away", async () => {
    const godown = await newWarehouse("Granted");
    const item = await owner().item.create({ name: "Granted item", unit: "pcs", stockQuantity: "5" } as never);
    const members = await owner().warehouse.accessList({ warehouseId: godown.id });
    const sellerRow = members.find((m) => m.email === world.suresh.email)!;

    const move = () => seller().stock.transfer({
      sourceWarehouseId: mainId,
      destinationWarehouseId: godown.id,
      lines: [{ itemId: item.id, quantity: "1" }],
    });
    await expect(move()).rejects.toThrow(/transfer permission/);

    const grant = (canTransfer: boolean) => Promise.all([mainId, godown.id].map((warehouseId) =>
      owner().warehouse.accessSet({
        warehouseId,
        businessMemberId: sellerRow.businessMemberId,
        canView: canTransfer, canReceive: canTransfer, canIssue: canTransfer, canTransfer, canAdjust: false,
      })));
    await grant(true);
    await move();

    await grant(false);
    await expect(move()).rejects.toThrow(/transfer permission/);
    const after = await owner().warehouse.accessList({ warehouseId: godown.id });
    expect(after.find((m) => m.businessMemberId === sellerRow.businessMemberId)!.canTransfer).toBe(false);
  });

  it("only admins can change access", async () => {
    const members = await owner().warehouse.accessList({ warehouseId: mainId });
    await expect(seller().warehouse.accessSet({
      warehouseId: mainId,
      businessMemberId: members[0]!.businessMemberId,
      canView: true, canReceive: true, canIssue: true, canTransfer: true, canAdjust: true,
    })).rejects.toThrow();
  });
});
