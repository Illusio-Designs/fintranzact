/**
 * Router gaps: priceLevel and pricing.
 *
 * price-levels.test.ts covers the resolver's precedence rules and the main
 * grid/bulk flows. This file covers validation, unknown and foreign ids,
 * permissions, audit rows and the side effects of delete.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { itemVariants, parties, priceListEntries } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createItem, createParty, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");

let itemId: string;
let variantItemId: string;
let variantId: string;
let foreignLevelId: string;

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  itemId = (await createItem(db, world.business1.id, { name: "PL Gap Item", salePrice: "100.00", category: "PL Cat" })).id;
  variantItemId = (await createItem(db, world.business1.id, { name: "PL Gap Tee", itemMode: "variants", salePrice: "200.00" })).id;
  const [v] = await db.insert(itemVariants).values({ itemId: variantItemId, attributeValues: { Size: "S" }, salePrice: "210.00" }).returning();
  variantId = v!.id;
  foreignLevelId = (await other().priceLevel.create({ name: "Foreign level" })).id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("priceLevel.create / update / delete", () => {
  it("create validates input", async () => {
    await expectCode(caller().priceLevel.create({ name: " " }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.create({ name: "x".repeat(101) }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.create({ name: "Neg", sortOrder: -1 }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.create({ name: "Desc", description: "d".repeat(501) }), "BAD_REQUEST");
  });

  it("create writes an audit row", async () => {
    const level = await caller().priceLevel.create({ name: "Audited level", description: "for audit", sortOrder: 5 });
    expect(level).toMatchObject({ name: "Audited level", description: "for audit", sortOrder: 5, isDefault: false });
    expect(await waitForAudit(world.business1.id, "priceLevel.create", level.id)).toHaveLength(1);
  });

  it("names are unique per business but case-sensitive (documented)", async () => {
    await caller().priceLevel.create({ name: "Case level" });
    // Ambiguous: the unique index is on (business_id, name), so a change of
    // case is a different level — unlike stock groups, which ignore case.
    await expect(caller().priceLevel.create({ name: "case level" })).resolves.toHaveProperty("id");
    // Another business may use the same name.
    await expect(other().priceLevel.create({ name: "Case level" })).resolves.toHaveProperty("id");
  });

  it("update renames, refuses a duplicate name, and refuses unknown or foreign ids", async () => {
    const a = await caller().priceLevel.create({ name: "Update A" });
    await caller().priceLevel.create({ name: "Update B" });
    await expect(caller().priceLevel.update({ id: a.id, data: { name: "Update A2", sortOrder: 3 } }))
      .resolves.toMatchObject({ name: "Update A2", sortOrder: 3 });
    await expectCode(caller().priceLevel.update({ id: a.id, data: { name: "Update B" } }), "CONFLICT");
    await expectCode(caller().priceLevel.update({ id: UNKNOWN, data: { name: "x" } }), "NOT_FOUND");
    await expectCode(caller().priceLevel.update({ id: foreignLevelId, data: { name: "x" } }), "NOT_FOUND");
    await expectCode(caller().priceLevel.update({ id: "bad", data: {} }), "BAD_REQUEST");
  });

  it("delete removes the level with its prices, and its parties drop back to no level", async () => {
    const level = await caller().priceLevel.create({ name: "Doomed level" });
    await caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [{ minQuantity: "0", price: "90" }] });
    const party = await createParty(getTenantTestDb(), world.business1.id, { name: "Doomed party", priceLevelId: level.id });

    const list = await caller().priceLevel.list();
    expect(list.find((l) => l.id === level.id)).toMatchObject({ entryCount: 1, partyCount: 1 });

    await expect(caller().priceLevel.delete({ id: level.id })).resolves.toEqual({ success: true });
    const entries = await getTenantTestDb().select().from(priceListEntries).where(eq(priceListEntries.priceLevelId, level.id));
    expect(entries).toHaveLength(0);
    const [p] = await getTenantTestDb().select().from(parties).where(eq(parties.id, party.id));
    expect(p!.priceLevelId).toBeNull();
    expect(await waitForAudit(world.business1.id, "priceLevel.delete", level.id)).toHaveLength(1);
  });

  it("delete refuses unknown and foreign ids", async () => {
    await expectCode(caller().priceLevel.delete({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(caller().priceLevel.delete({ id: foreignLevelId }), "NOT_FOUND");
  });

  it("a seller may list levels but not change them", async () => {
    await expect(seller().priceLevel.list()).resolves.toBeInstanceOf(Array);
    await expectCode(seller().priceLevel.create({ name: "Seller level" }), "FORBIDDEN");
    const level = await caller().priceLevel.create({ name: "Seller target" });
    await expectCode(seller().priceLevel.update({ id: level.id, data: { name: "x" } }), "FORBIDDEN");
    await expectCode(seller().priceLevel.delete({ id: level.id }), "FORBIDDEN");
    await expectCode(seller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId, price: "1" }] }), "FORBIDDEN");
    await expectCode(seller().priceLevel.bulkUpdate({ priceLevelId: level.id, basis: "current", percent: 1 }), "FORBIDDEN");
  });
});

describe("priceLevel.setItemPrices / itemEntries", () => {
  let level: { id: string };
  beforeAll(async () => {
    level = await caller().priceLevel.create({ name: "Slab level" });
  });

  it("replaces a revision's slabs and lists them per item", async () => {
    await caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [{ minQuantity: "0", price: "95" }, { minQuantity: "10", price: "90" }] });
    await caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [{ minQuantity: "0", price: "94" }] });
    const entries = await caller().priceLevel.itemEntries({ itemId });
    const mine = entries.filter((e) => e.priceLevelId === level.id);
    expect(mine.map((e) => e.price)).toEqual(["94.00"]);
    // Empty slabs remove the revision.
    await expect(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [] })).resolves.toEqual([]);
    expect((await caller().priceLevel.itemEntries({ itemId })).filter((e) => e.priceLevelId === level.id)).toHaveLength(0);
  });

  it("stores the item's base unit as null", async () => {
    const [row] = await caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, unit: "m", slabs: [{ minQuantity: "0", price: "80" }] });
    expect(row!.unit).toBeNull();
  });

  it("validates slabs", async () => {
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [{ minQuantity: "0" }] }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [{ minQuantity: "0", discountPercent: "101" }] }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [{ minQuantity: "-1", price: "1" }] }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, slabs: [{ minQuantity: "5", price: "1" }, { minQuantity: "5.000", price: "2" }] }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, effectiveFrom: "01/06/2026", slabs: [] }), "BAD_REQUEST");
  });

  it("rejects an impossible calendar date as bad input rather than failing in the database", async () => {
    await expectCode(
      caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, effectiveFrom: "2026-02-30", slabs: [{ minQuantity: "0", price: "1" }] }),
      "BAD_REQUEST",
    );
  });

  it("refuses unknown levels, items, variants and units", async () => {
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: UNKNOWN, itemId, slabs: [] }), "NOT_FOUND");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: foreignLevelId, itemId, slabs: [] }), "NOT_FOUND");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId: UNKNOWN, slabs: [] }), "NOT_FOUND");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId: world.item2.id, slabs: [] }), "NOT_FOUND");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, variantId, slabs: [] }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.setItemPrices({ priceLevelId: level.id, itemId, unit: "crate", slabs: [{ minQuantity: "0", price: "1" }] }), "BAD_REQUEST");
  });

  it("itemEntries: another business's item gives nothing, and bad ids are refused", async () => {
    expect(await other().priceLevel.itemEntries({ itemId })).toEqual([]);
    await expectCode(caller().priceLevel.itemEntries({ itemId: "x" }), "BAD_REQUEST");
  });
});

describe("priceLevel.grid / setGridPrices", () => {
  let level: { id: string };
  beforeAll(async () => {
    level = await caller().priceLevel.create({ name: "Grid level" });
  });

  it("sets, updates and clears plain prices, including a variant's", async () => {
    await expect(caller().priceLevel.setGridPrices({ cells: [
      { priceLevelId: level.id, itemId, price: "99" },
      { priceLevelId: level.id, itemId: variantItemId, variantId, price: "205" },
    ] })).resolves.toEqual({ updated: 2 });
    await caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId, price: "98" }] });
    let grid = await caller().priceLevel.grid({ search: "PL Gap" });
    expect(grid.rows.find((r) => r.itemId === itemId && !r.variantId)!.prices[level.id]).toBe("98.00");
    const vRow = grid.rows.find((r) => r.variantId === variantId)!;
    expect(vRow.prices[level.id]).toBe("205.00");
    expect(vRow.name).toBe("PL Gap Tee (S)");
    expect(vRow.salePrice).toBe("210.00");

    await caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId, price: null }] });
    grid = await caller().priceLevel.grid({ search: "PL Gap" });
    expect(grid.rows.find((r) => r.itemId === itemId && !r.variantId)!.prices[level.id]).toBeNull();
  });

  it("grid filters by category and escapes the search", async () => {
    const byCat = await caller().priceLevel.grid({ category: "PL Cat" });
    expect(byCat.rows.map((r) => r.itemId)).toEqual([itemId]);
    expect((await caller().priceLevel.grid({ search: "%" })).rows).toEqual([]);
    expect((await other().priceLevel.grid()).rows.find((r) => r.itemId === itemId)).toBeUndefined();
  });

  it("setGridPrices validates cells and refuses unknown or foreign levels and items", async () => {
    await expectCode(caller().priceLevel.setGridPrices({ cells: [] }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId, price: "-5" }] }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: UNKNOWN, itemId, price: "5" }] }), "NOT_FOUND");
    await expectCode(caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: foreignLevelId, itemId, price: "5" }] }), "NOT_FOUND");
    await expectCode(caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId: world.item2.id, price: "5" }] }), "NOT_FOUND");
  });

  it("setGridPrices refuses a variant that is not the item's", async () => {
    await expectCode(
      caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId, variantId, price: "5" }] }),
      "BAD_REQUEST",
    );
    const stray = await getTenantTestDb().select().from(priceListEntries)
      .where(eq(priceListEntries.variantId, variantId));
    expect(stray.every((e) => e.itemId === variantItemId)).toBe(true);
  });
});

describe("priceLevel.bulkUpdate / priceList", () => {
  it("salePrice basis prices items and variants; current basis adjusts them; audits", async () => {
    const level = await caller().priceLevel.create({ name: "Bulk gap level" });
    const res = await caller().priceLevel.bulkUpdate({ priceLevelId: level.id, basis: "salePrice", percent: -10, category: "PL Cat" });
    expect(res.updated).toBe(1);
    let entries = await caller().priceLevel.itemEntries({ itemId });
    expect(entries.find((e) => e.priceLevelId === level.id)!.price).toBe("90.00");

    await caller().priceLevel.bulkUpdate({ priceLevelId: level.id, basis: "current", percent: 5.5, round: "rupee" });
    entries = await caller().priceLevel.itemEntries({ itemId });
    expect(entries.find((e) => e.priceLevelId === level.id)!.price).toBe("95.00"); // 94.95 rounded
    const audits = await waitForAudit(world.business1.id, "priceLevel.bulkUpdate", level.id);
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("-100% takes prices to zero, never below", async () => {
    const level = await caller().priceLevel.create({ name: "Zero level" });
    await caller().priceLevel.bulkUpdate({ priceLevelId: level.id, basis: "salePrice", percent: -100 });
    const entries = await caller().priceLevel.itemEntries({ itemId });
    expect(entries.find((e) => e.priceLevelId === level.id)!.price).toBe("0.00");
  });

  it("validates input and refuses unknown or foreign levels", async () => {
    await expectCode(caller().priceLevel.bulkUpdate({ priceLevelId: UNKNOWN, basis: "current", percent: 1 }), "NOT_FOUND");
    await expectCode(caller().priceLevel.bulkUpdate({ priceLevelId: foreignLevelId, basis: "current", percent: 1 }), "NOT_FOUND");
    await expectCode(caller().priceLevel.bulkUpdate({ priceLevelId: UNKNOWN, basis: "current", percent: -101 }), "BAD_REQUEST");
    await expectCode(caller().priceLevel.bulkUpdate({ priceLevelId: UNKNOWN, basis: "other" as never, percent: 1 }), "BAD_REQUEST");
  });

  it("priceList lists items with each level's price; validates the date", async () => {
    const level = await caller().priceLevel.create({ name: "Report level" });
    await caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId, price: "77" }] });
    const res = await caller().priceLevel.priceList({ date: "2026-01-01", category: "PL Cat" });
    expect(res.date).toBe("2026-01-01");
    const row = res.rows.find((r) => r.itemId === itemId)!;
    expect(row.prices[level.id]).toBe("77.00");
    expect(row.salePrice).toBe("100.00");
    await expectCode(caller().priceLevel.priceList({ date: "1 Jan" }), "BAD_REQUEST");
    await expect(caller().priceLevel.priceList()).resolves.toHaveProperty("rows");
  });
});

describe("pricing.resolve", () => {
  it("refuses an unknown or foreign level id", async () => {
    await expectCode(caller().pricing.resolve({ priceLevelId: UNKNOWN, lines: [{ itemId }] }), "NOT_FOUND");
    await expectCode(caller().pricing.resolve({ priceLevelId: foreignLevelId, lines: [{ itemId }] }), "NOT_FOUND");
  });

  it("gives no price for unknown or foreign items", async () => {
    const res = await caller().pricing.resolve({ lines: [{ itemId: UNKNOWN }, { itemId: world.item2.id }] });
    expect(res.lines.map((l) => l.unitPrice)).toEqual([null, null]);
  });

  it("ignores a variant that belongs to another item", async () => {
    const res = await caller().pricing.resolve({ lines: [{ itemId, variantId }] });
    expect(res.lines[0]).toMatchObject({ variantId: null, unitPrice: "100.00", source: "item" });
  });

  it("uses an explicit level over the party's", async () => {
    const level = await caller().priceLevel.create({ name: "Explicit level" });
    await caller().priceLevel.setGridPrices({ cells: [{ priceLevelId: level.id, itemId, price: "66" }] });
    const res = await caller().pricing.resolve({ partyId: world.party1.id, priceLevelId: level.id, lines: [{ itemId, quantity: "abc" }] });
    expect(res.priceLevel).toEqual({ id: level.id, name: "Explicit level" });
    expect(res.lines[0]).toMatchObject({ unitPrice: "66.00", source: "level" });
  });

  it("returns no lines for none, and validates input", async () => {
    await expect(caller().pricing.resolve({ lines: [] })).resolves.toMatchObject({ lines: [] });
    await expectCode(caller().pricing.resolve({ lines: [{ itemId: "x" }] }), "BAD_REQUEST");
    await expectCode(caller().pricing.resolve({ lines: Array.from({ length: 501 }, () => ({ itemId })) }), "BAD_REQUEST");
  });

  it("is open to a seller", async () => {
    await expect(seller().pricing.resolve({ lines: [{ itemId }] })).resolves.toHaveProperty("lines");
  });
});
