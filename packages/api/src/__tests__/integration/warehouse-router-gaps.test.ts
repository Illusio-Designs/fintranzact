/**
 * Router gaps: warehouse premises, locations, self-grants and inventory
 * settings — procedures no other file calls.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { warehousePermissions } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");

let mainId: string;
let theirWarehouseId: string;

beforeAll(async () => {
  world = await createTestWorld();
  await caller().stock.setup();
  await other().stock.setup();
  mainId = (await caller().warehouse.warehouseList())[0]!.id;
  theirWarehouseId = (await other().warehouse.warehouseList())[0]!.id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("premises", () => {
  it("create, list, get and update", async () => {
    const p = await caller().warehouse.premiseCreate({ name: "North Yard", code: "NY", city: "Nashik" });
    expect(p).toMatchObject({ name: "North Yard", code: "NY", status: "active", city: "Nashik", address: null });
    expect((await caller().warehouse.premiseList()).map((x) => x.id)).toContain(p.id);
    await expect(caller().warehouse.premiseGet({ id: p.id })).resolves.toMatchObject({ id: p.id });
    const u = await caller().warehouse.premiseUpdate({ id: p.id, name: "North Yard 2", code: "NY", address: null });
    expect(u).toMatchObject({ name: "North Yard 2", code: "NY" });
  });

  it("refuses duplicate codes on create and update", async () => {
    await caller().warehouse.premiseCreate({ name: "Dup A", code: "DUPA" });
    const b = await caller().warehouse.premiseCreate({ name: "Dup B", code: "DUPB" });
    await expectCode(caller().warehouse.premiseCreate({ name: "Dup A again", code: "DUPA" }), "CONFLICT");
    await expectCode(caller().warehouse.premiseUpdate({ id: b.id, code: "DUPA" }), "CONFLICT");
    // Another business may reuse the code.
    await expect(other().warehouse.premiseCreate({ name: "Theirs", code: "DUPA" })).resolves.toHaveProperty("id");
  });

  it("validates input", async () => {
    await expectCode(caller().warehouse.premiseCreate({ name: "", code: "X" }), "BAD_REQUEST");
    await expectCode(caller().warehouse.premiseCreate({ name: "X", code: "" }), "BAD_REQUEST");
    await expectCode(caller().warehouse.premiseGet({ id: "x" }), "BAD_REQUEST");
  });

  it("NOT_FOUND for unknown and foreign premises", async () => {
    const theirs = (await other().warehouse.premiseList())[0]!;
    await expectCode(caller().warehouse.premiseGet({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(caller().warehouse.premiseGet({ id: theirs.id }), "NOT_FOUND");
    await expectCode(caller().warehouse.premiseUpdate({ id: theirs.id, name: "x" }), "NOT_FOUND");
    await expectCode(caller().warehouse.premiseDelete({ id: theirs.id }), "NOT_FOUND");
    await expectCode(caller().warehouse.premiseDelete({ id: UNKNOWN }), "NOT_FOUND");
    expect((await caller().warehouse.premiseList()).map((x) => x.id)).not.toContain(theirs.id);
  });

  it("deletes an empty premise, but not one that still has warehouses", async () => {
    const empty = await caller().warehouse.premiseCreate({ name: "Empty", code: "EMPTY" });
    await expect(caller().warehouse.premiseDelete({ id: empty.id })).resolves.toEqual({ success: true, id: empty.id });
    const busy = await caller().warehouse.premiseCreate({ name: "Busy", code: "BUSY" });
    await caller().warehouse.warehouseCreate({ premiseId: busy.id, name: "Busy godown", code: "BUSYG", warehouseType: "godown" });
    await expectCode(caller().warehouse.premiseDelete({ id: busy.id }), "PRECONDITION_FAILED");
    await expect(caller().warehouse.premiseGet({ id: busy.id })).resolves.toMatchObject({ id: busy.id });
  });

  it("sellers can read premises but not change them", async () => {
    await expect(seller().warehouse.premiseList()).resolves.toBeInstanceOf(Array);
    await expectCode(seller().warehouse.premiseCreate({ name: "S", code: "S" }), "FORBIDDEN");
  });
});

describe("warehouseGet", () => {
  it("returns this business's warehouse; NOT_FOUND otherwise", async () => {
    await expect(caller().warehouse.warehouseGet({ id: mainId })).resolves.toMatchObject({ id: mainId });
    await expectCode(caller().warehouse.warehouseGet({ id: theirWarehouseId }), "NOT_FOUND");
    await expectCode(caller().warehouse.warehouseGet({ id: UNKNOWN }), "NOT_FOUND");
  });
});

describe("locations", () => {
  it("creates a rack under an area, lists and updates them", async () => {
    const area = await caller().warehouse.locationCreate({ warehouseId: mainId, locationType: "AREA", name: "Area 1", code: "A1" });
    const rack = await caller().warehouse.locationCreate({ warehouseId: mainId, parentId: area.id, locationType: "RACK", name: "Rack 1", code: "A1-R1" });
    expect(rack.parentId).toBe(area.id);
    const list = await caller().warehouse.locationList({ warehouseId: mainId });
    expect(list.map((l) => l.id)).toEqual(expect.arrayContaining([area.id, rack.id]));
    const u = await caller().warehouse.locationUpdate({ id: rack.id, name: "Rack One", locationType: "SHELF" });
    expect(u).toMatchObject({ name: "Rack One", locationType: "SHELF" });
  });

  it("refuses duplicate codes, a parent in another warehouse, and foreign warehouses", async () => {
    const godown = await caller().warehouse.warehouseCreate({
      premiseId: (await caller().warehouse.warehouseGet({ id: mainId })).premiseId, name: "Loc godown", code: "LOCG", warehouseType: "godown",
    });
    const a = await caller().warehouse.locationCreate({ warehouseId: mainId, locationType: "AREA", name: "Dup", code: "DUP" });
    const b = await caller().warehouse.locationCreate({ warehouseId: mainId, locationType: "AREA", name: "Dup 2", code: "DUP2" });
    await expectCode(caller().warehouse.locationCreate({ warehouseId: mainId, locationType: "BIN", name: "x", code: "DUP" }), "CONFLICT");
    await expectCode(caller().warehouse.locationUpdate({ id: b.id, code: "DUP" }), "CONFLICT");
    // The same code in another warehouse is fine.
    await expect(caller().warehouse.locationCreate({ warehouseId: godown.id, locationType: "AREA", name: "Dup", code: "DUP" })).resolves.toHaveProperty("id");
    await expectCode(caller().warehouse.locationCreate({ warehouseId: godown.id, parentId: a.id, locationType: "RACK", name: "x", code: "X1" }), "BAD_REQUEST");
    await expectCode(caller().warehouse.locationCreate({ warehouseId: theirWarehouseId, locationType: "AREA", name: "x", code: "X2" }), "BAD_REQUEST");
    await expectCode(caller().warehouse.locationCreate({ warehouseId: mainId, locationType: "ROOM" as never, name: "x", code: "X3" }), "BAD_REQUEST");
    await expectCode(caller().warehouse.locationList({ warehouseId: theirWarehouseId }), "NOT_FOUND");
  });

  it("refuses a location as its own parent, and a loop through its children", async () => {
    const a = await caller().warehouse.locationCreate({ warehouseId: mainId, locationType: "AREA", name: "Loop A", code: "LA" });
    const b = await caller().warehouse.locationCreate({ warehouseId: mainId, parentId: a.id, locationType: "RACK", name: "Loop B", code: "LB" });
    await expectCode(caller().warehouse.locationUpdate({ id: a.id, parentId: a.id }), "BAD_REQUEST");
    await expectCode(caller().warehouse.locationUpdate({ id: a.id, parentId: b.id }), "BAD_REQUEST");
  });

  it("delete: removes the location; NOT_FOUND for unknown and foreign", async () => {
    const l = await caller().warehouse.locationCreate({ warehouseId: mainId, locationType: "BIN", name: "Del", code: "DEL" });
    const theirs = await other().warehouse.locationCreate({ warehouseId: theirWarehouseId, locationType: "BIN", name: "T", code: "T" });
    await expectCode(caller().warehouse.locationDelete({ id: theirs.id }), "NOT_FOUND");
    await expectCode(caller().warehouse.locationUpdate({ id: theirs.id, name: "x" }), "NOT_FOUND");
    await expect(caller().warehouse.locationDelete({ id: l.id })).resolves.toEqual({ success: true, id: l.id });
    await expectCode(caller().warehouse.locationDelete({ id: l.id }), "NOT_FOUND");
  });

  it("sellers can list but not change locations", async () => {
    await expect(seller().warehouse.locationList({ warehouseId: mainId })).resolves.toBeInstanceOf(Array);
    await expectCode(seller().warehouse.locationCreate({ warehouseId: mainId, locationType: "BIN", name: "s", code: "S" }), "FORBIDDEN");
  });
});

describe("warehousePermissionCreate", () => {
  it("grants the caller's own access once; refuses duplicates and foreign warehouses", async () => {
    const perm = await caller().warehouse.warehousePermissionCreate({ warehouseId: mainId, canTransfer: true });
    expect(perm).toMatchObject({ warehouseId: mainId, canView: true, canTransfer: true, canAdjust: false });
    const rows = await getTenantTestDb().select().from(warehousePermissions).where(eq(warehousePermissions.id, perm.id));
    expect(rows).toHaveLength(1);
    await expectCode(caller().warehouse.warehousePermissionCreate({ warehouseId: mainId }), "CONFLICT");
    await expectCode(caller().warehouse.warehousePermissionCreate({ warehouseId: theirWarehouseId }), "BAD_REQUEST");
    await expectCode(seller().warehouse.warehousePermissionCreate({ warehouseId: mainId }), "FORBIDDEN");
  });
});

describe("inventory settings", () => {
  it("get returns the defaults set up; update changes only what was sent", async () => {
    const before = await caller().warehouse.inventorySettingsGet();
    expect(before!.salesWarehouseId).toBe(mainId);
    const godown = await caller().warehouse.warehouseCreate({
      premiseId: (await caller().warehouse.warehouseGet({ id: mainId })).premiseId, name: "Prod floor", code: "PROD", warehouseType: "godown",
    });
    const after = await caller().warehouse.inventorySettingsUpdate({ productionWarehouseId: godown.id });
    expect(after).toMatchObject({ productionWarehouseId: godown.id, salesWarehouseId: mainId });
    const cleared = await caller().warehouse.inventorySettingsUpdate({ productionWarehouseId: null });
    expect(cleared!.productionWarehouseId).toBeNull();
    expect(cleared!.salesWarehouseId).toBe(mainId);
  });

  it("refuses another business's warehouse and bad ids; sellers refused", async () => {
    await expectCode(caller().warehouse.inventorySettingsUpdate({ salesWarehouseId: theirWarehouseId }), "BAD_REQUEST");
    await expectCode(caller().warehouse.inventorySettingsUpdate({ salesWarehouseId: "x" }), "BAD_REQUEST");
    await expectCode(seller().warehouse.inventorySettingsUpdate({ productionWarehouseId: null }), "FORBIDDEN");
    await expect(seller().warehouse.inventorySettingsGet()).resolves.not.toBeNull();
  });
});
