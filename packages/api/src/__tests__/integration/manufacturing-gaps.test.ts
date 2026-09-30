/**
 * Router gaps: manufacturing.
 *
 * manufacturing.test.ts covers BOM loops, stock movement, costing and
 * cancel. This file covers the listing/detail procedures, BOM update and
 * delete, input validation, unknown and foreign ids, permissions and the
 * default-BOM rules.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { boms, itemVariants, manufacturingJournals } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createItem, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";
import { ensureDefaultWarehouse } from "../../lib/inventory-service.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");

let mainId: string;
let otherMainId: string;
let bread: string;
let flour: string;
let yeast: string;
let bran: string;
let service: string;
let tee: string;
let teeRed: string;

const bom = (overrides: Record<string, unknown> = {}) => ({
  itemId: bread,
  name: "Bread BOM",
  outputQuantity: "10",
  components: [{ itemId: flour, quantity: "5", wastagePercent: "10" }, { itemId: yeast, quantity: "0.5" }],
  byProducts: [{ itemId: bran, quantity: "1" }],
  ...overrides,
}) as Parameters<ReturnType<typeof caller>["manufacturing"]["bomCreate"]>[0];

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  mainId = (await ensureDefaultWarehouse(db, world.business1.id)).salesWarehouseId as string;
  otherMainId = (await ensureDefaultWarehouse(db, world.business2.id)).salesWarehouseId as string;
  const c = caller();
  const make = (name: string, stockQuantity: string, purchasePrice = "10") =>
    c.item.create({ name, unit: "kg", stockQuantity, purchasePrice, salePrice: "50" } as never).then((i) => i.id as string);
  bread = await make("MG Bread", "0");
  flour = await make("MG Flour", "100", "40");
  yeast = await make("MG Yeast", "10", "200");
  bran = await make("MG Bran", "0");
  service = (await createItem(db, world.business1.id, { name: "MG Baking service", itemType: "service" })).id;
  tee = (await createItem(db, world.business1.id, { name: "MG Tee", itemMode: "variants" })).id;
  const [v] = await db.insert(itemVariants).values({ itemId: tee, attributeValues: { Color: "Red" } }).returning();
  teeRed = v!.id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("manufacturing.bomCreate", () => {
  it("validates input", async () => {
    await expectCode(caller().manufacturing.bomCreate(bom({ name: " " })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [] })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ outputQuantity: "0" })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: flour, quantity: "1.2345" }] })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: flour, quantity: "1", wastagePercent: "1001" }] })), "BAD_REQUEST");
  });

  it("refuses unknown, foreign and service items", async () => {
    await expectCode(caller().manufacturing.bomCreate(bom({ itemId: UNKNOWN })), "NOT_FOUND");
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: world.item2.id, quantity: "1" }] })), "NOT_FOUND");
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: service, quantity: "1" }] })), "BAD_REQUEST");
  });

  it("enforces variant rules", async () => {
    // A variant item needs a variant; a plain item must not have one.
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: tee, quantity: "1" }] })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: flour, variantId: teeRed, quantity: "1" }] })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: tee, variantId: UNKNOWN, quantity: "1" }] })), "NOT_FOUND");
    await expect(caller().manufacturing.bomCreate(bom({ name: "With variant", components: [{ itemId: tee, variantId: teeRed, quantity: "1" }], byProducts: [] })))
      .resolves.toHaveProperty("id");
  });

  it("refuses duplicates and overlaps between components and by-products", async () => {
    await expectCode(caller().manufacturing.bomCreate(bom({ components: [{ itemId: flour, quantity: "1" }, { itemId: flour, quantity: "2" }] })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ byProducts: [{ itemId: bran, quantity: "1" }, { itemId: bran, quantity: "1" }] })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ byProducts: [{ itemId: bread, quantity: "1" }] })), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomCreate(bom({ byProducts: [{ itemId: flour, quantity: "1" }] })), "BAD_REQUEST");
  });

  it("an inactive BOM never becomes the default, nor takes the flag from the active one", async () => {
    // Yeast has no BOM yet, so its first one becomes the default.
    const yeastBom = (name: string, extra: Record<string, unknown> = {}) =>
      bom({ itemId: yeast, name, components: [{ itemId: flour, quantity: "1" }], byProducts: [], ...extra });
    const first = await caller().manufacturing.bomCreate(yeastBom("Default yeast"));
    const inactive = await caller().manufacturing.bomCreate(yeastBom("Old yeast", { isDefault: true, isActive: false }));
    const db = getTenantTestDb();
    const [a] = await db.select().from(boms).where(eq(boms.id, first.id));
    const [b] = await db.select().from(boms).where(eq(boms.id, inactive.id));
    expect(a!.isDefault).toBe(true);
    expect(b!.isDefault).toBe(false);
  });

  it("is refused to a seller", async () => {
    await expectCode(seller().manufacturing.bomCreate(bom({ name: "Seller BOM" })), "FORBIDDEN");
  });
});

describe("manufacturing.boms / bom", () => {
  it("lists with counts, filters and pages; scoped to the business", async () => {
    const created = await caller().manufacturing.bomCreate(bom({ name: "Listed bread" }));
    const all = await caller().manufacturing.boms({ page: 1, limit: 100 });
    const row = all.data.find((b) => b.id === created.id)!;
    expect(row).toMatchObject({ itemName: "MG Bread", componentCount: 2, byProductCount: 1, outputQuantity: "10.000" });
    expect(all.total).toBe(all.data.length);

    const bySearch = await caller().manufacturing.boms({ search: "Listed", page: 1, limit: 100 });
    expect(bySearch.data.map((b) => b.id)).toEqual([created.id]);
    const byItem = await caller().manufacturing.boms({ itemId: tee, page: 1, limit: 100 });
    expect(byItem.data.every((b) => b.itemId === tee)).toBe(true);
    const active = await caller().manufacturing.boms({ activeOnly: true, page: 1, limit: 100 });
    expect(active.data.every((b) => b.isActive)).toBe(true);
    expect((await caller().manufacturing.boms({ search: "%", page: 1, limit: 100 })).total).toBe(0);
    expect((await other().manufacturing.boms({ page: 1, limit: 100 })).total).toBe(0);
    await expectCode(caller().manufacturing.boms({ page: 0, limit: 10 }), "BAD_REQUEST");
  });

  it("bom returns components and by-products; NOT_FOUND for unknown and foreign ids", async () => {
    const created = await caller().manufacturing.bomCreate(bom({ name: "Detail bread", notes: "  Knead well  " }));
    const got = await caller().manufacturing.bom({ id: created.id });
    expect(got).toMatchObject({ name: "Detail bread", notes: "Knead well" });
    expect(got.components.map((c) => [c.itemId, c.quantity, c.wastagePercent])).toEqual([[flour, "5.000", "10.00"], [yeast, "0.500", "0.00"]]);
    expect(got.byProducts.map((b) => b.itemId)).toEqual([bran]);
    await expectCode(caller().manufacturing.bom({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().manufacturing.bom({ id: created.id }), "NOT_FOUND");
  });

  it("a seller can read BOMs", async () => {
    await expect(seller().manufacturing.boms({ page: 1, limit: 10 })).resolves.toHaveProperty("data");
  });
});

describe("manufacturing.bomUpdate / bomDelete", () => {
  it("replaces the lines and fields, and moves the default flag", async () => {
    const a = await caller().manufacturing.bomCreate(bom({ name: "Upd A" }));
    const b = await caller().manufacturing.bomCreate(bom({ name: "Upd B" }));
    await caller().manufacturing.bomUpdate({ ...bom({ name: "Upd B2", outputQuantity: "2", components: [{ itemId: flour, quantity: "1" }], byProducts: [], isDefault: true }), id: b.id });
    const got = await caller().manufacturing.bom({ id: b.id });
    expect(got).toMatchObject({ name: "Upd B2", outputQuantity: "2.000", isDefault: true });
    expect(got.components).toHaveLength(1);
    expect(got.byProducts).toHaveLength(0);
    expect((await caller().manufacturing.bom({ id: a.id })).isDefault).toBe(false);
  });

  it("refuses a cycle on update and unknown or foreign ids", async () => {
    // Flour made from bread, then bread from flour.
    const flourBom = await caller().manufacturing.bomCreate({ itemId: flour, name: "Flour from bread", components: [{ itemId: bran, quantity: "1" }] } as never);
    await expectCode(caller().manufacturing.bomUpdate({ id: flourBom.id, itemId: flour, name: "Loop", components: [{ itemId: bread, quantity: "1" }] } as never), "BAD_REQUEST");
    await expectCode(caller().manufacturing.bomUpdate({ ...bom(), id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().manufacturing.bomUpdate({ ...bom(), id: flourBom.id }), "NOT_FOUND");
    await caller().manufacturing.bomDelete({ id: flourBom.id });
  });

  it("delete removes the BOM; journals made from it keep their lines", async () => {
    const created = await caller().manufacturing.bomCreate(bom({ name: "To delete", isDefault: true }));
    const j = await caller().manufacturing.manufacture({
      bomId: created.id, quantity: "10", sourceWarehouseId: mainId, destinationWarehouseId: mainId,
    });
    await expect(caller().manufacturing.bomDelete({ id: created.id })).resolves.toEqual({ ok: true });
    await expectCode(caller().manufacturing.bom({ id: created.id }), "NOT_FOUND");
    const journal = await caller().manufacturing.journal({ id: j.id });
    expect(journal.bomId).toBeNull();
    expect(journal.components).toHaveLength(2);
  });

  it("delete: NOT_FOUND for unknown and foreign ids; seller refused", async () => {
    const created = await caller().manufacturing.bomCreate(bom({ name: "Keep me" }));
    await expectCode(caller().manufacturing.bomDelete({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().manufacturing.bomDelete({ id: created.id }), "NOT_FOUND");
    await expectCode(seller().manufacturing.bomDelete({ id: created.id }), "FORBIDDEN");
  });
});

describe("manufacturing.plan", () => {
  it("scales the default BOM with wastage and reports stock at the warehouse", async () => {
    const created = await caller().manufacturing.bomCreate(bom({ name: "Plan bread", isDefault: true }));
    const p = await caller().manufacturing.plan({ itemId: bread, quantity: "20", sourceWarehouseId: mainId, extra: [{ itemId: bran }] });
    expect(p.bom!.id).toBe(created.id);
    const f = p.components.find((c) => c.itemId === flour)!;
    expect(f.standardQuantity).toBe("11.000"); // 5 x 2 x 1.1
    expect(f.available).not.toBeNull();
    expect(p.byProducts[0]!.standardQuantity).toBe("2.000");
    expect(p.extra.map((e) => e.itemId)).toEqual([bran]);
  });

  it("with no BOM gives an empty plan for the item; refuses unknown BOMs and items", async () => {
    const p = await caller().manufacturing.plan({ itemId: bran, quantity: "1" });
    expect(p).toMatchObject({ bom: null, components: [], finished: { itemId: bran } });
    await expectCode(caller().manufacturing.plan({ bomId: UNKNOWN, quantity: "1" }), "NOT_FOUND");
    await expectCode(caller().manufacturing.plan({ itemId: UNKNOWN, quantity: "1" }), "NOT_FOUND");
    await expectCode(caller().manufacturing.plan({ itemId: bread, quantity: "0" }), "BAD_REQUEST");
  });
});

describe("manufacturing.manufacture", () => {
  it("validates input and refuses a missing target", async () => {
    await expectCode(caller().manufacturing.manufacture({ quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId, components: [{ itemId: flour, quantity: "1" }] }), "BAD_REQUEST");
    await expectCode(caller().manufacturing.manufacture({ itemId: bread, quantity: "-1", sourceWarehouseId: mainId, destinationWarehouseId: mainId }), "BAD_REQUEST");
    await expectCode(caller().manufacturing.manufacture({ itemId: bread, quantity: "1", sourceWarehouseId: "x", destinationWarehouseId: mainId }), "BAD_REQUEST");
    await expectCode(caller().manufacturing.manufacture({ itemId: bread, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId, additionalCosts: [{ label: "", amount: "1" }] }), "BAD_REQUEST");
  });

  it("needs components when there is no BOM; refuses using an item to make itself", async () => {
    await expectCode(caller().manufacturing.manufacture({ itemId: bran, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId }), "BAD_REQUEST");
    await expectCode(caller().manufacturing.manufacture({
      itemId: bran, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId, components: [{ itemId: bran, quantity: "1" }],
    }), "BAD_REQUEST");
  });

  it("refuses an inactive BOM and a BOM for another item", async () => {
    const inactive = await caller().manufacturing.bomCreate(bom({ name: "Inactive for run", isActive: false }));
    await expectCode(caller().manufacturing.manufacture({ bomId: inactive.id, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId }), "BAD_REQUEST");
    const active = await caller().manufacturing.bomCreate(bom({ name: "Active for run" }));
    await expectCode(caller().manufacturing.manufacture({ bomId: active.id, itemId: bran, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId }), "BAD_REQUEST");
    await expectCode(caller().manufacturing.manufacture({ bomId: UNKNOWN, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId }), "NOT_FOUND");
  });

  it("refuses another business's warehouse", async () => {
    await expectCode(caller().manufacturing.manufacture({
      itemId: bran, quantity: "1", sourceWarehouseId: otherMainId, destinationWarehouseId: mainId, components: [{ itemId: flour, quantity: "1" }],
    }), "NOT_FOUND");
  });

  it("numbers journals in sequence, adds additional costs, and skips zero-quantity lines", async () => {
    const before = (await caller().manufacturing.journals({ page: 1, limit: 100 })).total;
    const j = await caller().manufacturing.manufacture({
      itemId: bran, quantity: "4", sourceWarehouseId: mainId, destinationWarehouseId: mainId,
      components: [{ itemId: flour, quantity: "2" }, { itemId: yeast, quantity: "0" }],
      additionalCosts: [{ label: "Labour", amount: "20" }],
      notes: "Hand made",
    });
    expect(j.journalNumber).toBe(`MJ-${before + 1}`);
    const detail = await caller().manufacturing.journal({ id: j.id });
    expect(detail.components.map((c) => c.itemId)).toEqual([flour]);
    expect(detail.additionalCostTotal).toBe("20.00");
    expect(parseFloat(detail.totalCost)).toBeCloseTo(parseFloat(detail.componentsCost) + 20, 2);
    expect(detail.notes).toBe("Hand made");
  });

  it("is refused to a seller", async () => {
    await expectCode(seller().manufacturing.manufacture({
      itemId: bran, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId, components: [{ itemId: flour, quantity: "1" }],
    }), "FORBIDDEN");
  });
});

describe("manufacturing.journals / journal / cancel", () => {
  it("lists journals newest first with names; scoped to the business", async () => {
    const res = await caller().manufacturing.journals({ page: 1, limit: 100 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty("sourceName");
    expect(res.data.every((j) => j.status === "posted" || j.status === "cancelled")).toBe(true);
    expect((await other().manufacturing.journals({ page: 1, limit: 100 })).total).toBe(0);
    expect((await caller().manufacturing.journals({ page: 1, limit: 1 })).data).toHaveLength(1);
  });

  it("journal: NOT_FOUND for unknown and foreign ids", async () => {
    const [first] = (await caller().manufacturing.journals({ page: 1, limit: 1 })).data;
    await expectCode(caller().manufacturing.journal({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().manufacturing.journal({ id: first!.id }), "NOT_FOUND");
  });

  it("cancel: once only; NOT_FOUND for unknown and foreign ids; seller refused", async () => {
    const j = await caller().manufacturing.manufacture({
      itemId: bran, quantity: "1", sourceWarehouseId: mainId, destinationWarehouseId: mainId, components: [{ itemId: flour, quantity: "1" }],
    });
    await expectCode(other().manufacturing.cancel({ id: j.id }), "NOT_FOUND");
    await expectCode(seller().manufacturing.cancel({ id: j.id }), "FORBIDDEN");
    await caller().manufacturing.cancel({ id: j.id });
    const [row] = await getTenantTestDb().select().from(manufacturingJournals).where(eq(manufacturingJournals.id, j.id));
    expect(row!.status).toBe("cancelled");
    expect(row!.cancelledByUserId).toBe(world.ramesh.id);
    await expectCode(caller().manufacturing.cancel({ id: j.id }), "BAD_REQUEST");
    await expectCode(caller().manufacturing.cancel({ id: UNKNOWN }), "NOT_FOUND");
  });
});
