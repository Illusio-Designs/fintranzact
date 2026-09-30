/**
 * Stock groups: the migration backfill from free-text categories, the tree
 * (nesting and cycle prevention), delete rules, keeping items.category in
 * step, and the stock group summary roll-up.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { items, stockGroups } from "@fintranzact/db";
import { getTestClient, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createItem, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

let world: TestWorld;

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

/** The backfill statements from the stock_groups migration (both layouts carry the same SQL). */
function backfillStatements(): string[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../../db/drizzle-tenant");
  const file = readdirSync(dir).find((f) => f.endsWith("_stock_groups.sql"));
  if (!file) throw new Error("stock_groups migration not found");
  const text = readFileSync(join(dir, file), "utf8");
  const backfill = text.slice(text.indexOf("-- Backfill"));
  return backfill.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
}

async function runBackfill() {
  const client = getTestClient();
  for (const stmt of backfillStatements()) await client.unsafe(stmt);
}

async function groupsOf(businessId: string) {
  return getTenantTestDb().select().from(stockGroups).where(eq(stockGroups.businessId, businessId));
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("migration backfill", () => {
  it("creates one group per distinct category per business and links items", async () => {
    const db = getTenantTestDb();
    const b1 = world.business1.id;
    const b2 = world.business2.id;
    const a = await createItem(db, b1, { name: "Bf A", category: "Snacks" });
    const b = await createItem(db, b1, { name: "Bf B", category: " Snacks " });
    const c = await createItem(db, b1, { name: "Bf C", category: "Drinks" });
    const none = await createItem(db, b1, { name: "Bf none", category: null });
    const blank = await createItem(db, b1, { name: "Bf blank", category: "  " });
    await createItem(db, b1, { name: "Bf deleted", category: "Gone", deletedAt: new Date() });
    const other = await createItem(db, b2, { name: "Bf other", category: "Snacks" });

    await runBackfill();
    // Idempotent: a second run changes nothing.
    await runBackfill();

    const g1 = await groupsOf(b1);
    expect(g1.map((g) => g.name).sort()).toEqual(["Drinks", "Snacks"]);
    const g2 = await groupsOf(b2);
    expect(g2.map((g) => g.name)).toContain("Snacks");

    const byId = async (id: string) => (await db.select().from(items).where(eq(items.id, id)))[0]!;
    const snacks = g1.find((g) => g.name === "Snacks")!;
    expect((await byId(a.id)).stockGroupId).toBe(snacks.id);
    // Whitespace is trimmed and the category follows the group's name.
    expect(await byId(b.id)).toMatchObject({ stockGroupId: snacks.id, category: "Snacks" });
    expect((await byId(c.id)).stockGroupId).toBe(g1.find((g) => g.name === "Drinks")!.id);
    expect((await byId(none.id)).stockGroupId).toBeNull();
    expect((await byId(blank.id)).stockGroupId).toBeNull();
    // Each business gets its own group.
    expect((await byId(other.id)).stockGroupId).toBe(g2.find((g) => g.name === "Snacks")!.id);
    expect((await byId(other.id)).stockGroupId).not.toBe(snacks.id);
  });
});

describe("stockGroup tree", () => {
  let root: string;
  let child: string;
  let grandchild: string;

  beforeAll(async () => {
    root = (await caller().stockGroup.create({ name: "Tree root" })).id;
    child = (await caller().stockGroup.create({ name: "Tree child", parentId: root })).id;
    grandchild = (await caller().stockGroup.create({ name: "Tree grandchild", parentId: child })).id;
  });

  it("lists groups in tree order with depth", async () => {
    const { data } = await caller().stockGroup.list();
    const idx = (id: string) => data.findIndex((g) => g.id === id);
    expect(idx(root)).toBeLessThan(idx(child));
    expect(idx(child)).toBeLessThan(idx(grandchild));
    expect(data[idx(grandchild)]!.depth).toBe(2);
    expect(data[idx(root)]!.childCount).toBe(1);
  });

  it("refuses duplicate names, ignoring case", async () => {
    await expect(caller().stockGroup.create({ name: "tree ROOT" })).rejects.toThrow(/already exists/);
    await expect(caller().stockGroup.rename({ id: child, name: "Tree Root" })).rejects.toThrow(/already exists/);
  });

  it("refuses to move a group under itself or a descendant", async () => {
    await expect(caller().stockGroup.move({ id: root, parentId: root })).rejects.toThrow(/under itself/);
    await expect(caller().stockGroup.move({ id: root, parentId: grandchild })).rejects.toThrow(/under itself/);
    // A legal move: grandchild up to the top and back.
    await caller().stockGroup.move({ id: grandchild, parentId: null });
    await caller().stockGroup.move({ id: grandchild, parentId: child });
  });

  it("refuses a group from another business as parent", async () => {
    const [foreign] = await getTenantTestDb()
      .insert(stockGroups)
      .values({ businessId: world.business2.id, name: "Foreign" })
      .returning();
    await expect(caller().stockGroup.create({ name: "Stray", parentId: foreign!.id })).rejects.toThrow(/not found/);
    await expect(caller().stockGroup.move({ id: root, parentId: foreign!.id })).rejects.toThrow(/not found/);
  });

  it("counts items through sub-groups and filters the item list by subtree", async () => {
    const top = await caller().item.create({ name: "In root", unit: "pcs", stockGroupId: root } as never);
    const deep = await caller().item.create({ name: "In grandchild", unit: "pcs", stockGroupId: grandchild } as never);
    const { data } = await caller().stockGroup.list();
    const r = data.find((g) => g.id === root)!;
    expect(r.directItemCount).toBe(1);
    expect(r.itemCount).toBe(2);

    const list = await caller().item.list({ stockGroupId: child, page: 1, limit: 50 });
    expect(list.data.map((i) => i.id)).toEqual([deep.id]);
    const all = await caller().item.list({ stockGroupId: root, page: 1, limit: 50 });
    expect(all.data.map((i) => i.id).sort()).toEqual([top.id, deep.id].sort());
  });
});

describe("items and categories", () => {
  it("sets category from the group and follows a rename", async () => {
    const g = await caller().stockGroup.create({ name: "Sync group" });
    const item = await caller().item.create({ name: "Sync item", unit: "pcs", stockGroupId: g.id } as never);
    expect(item.category).toBe("Sync group");
    await caller().stockGroup.rename({ id: g.id, name: "Renamed group" });
    const after = await caller().item.getById({ id: item.id });
    expect(after!.category).toBe("Renamed group");
  });

  it("files a bare category under a group of that name (older clients)", async () => {
    const item = await caller().item.create({ name: "Legacy item", unit: "pcs", category: "Legacy cat" } as never);
    expect(item.stockGroupId).toBeTruthy();
    const [g] = await groupsOf(world.business1.id).then((gs) => gs.filter((x) => x.name === "Legacy cat"));
    expect(item.stockGroupId).toBe(g!.id);

    // Clearing the group clears the category too.
    const cleared = await caller().item.update({ id: item.id, data: { stockGroupId: null } });
    expect(cleared).toMatchObject({ stockGroupId: null, category: null });
  });

  it("rejects a group from another business", async () => {
    const [foreign] = await getTenantTestDb()
      .insert(stockGroups)
      .values({ businessId: world.business2.id, name: "Foreign 2" })
      .returning();
    await expect(
      caller().item.create({ name: "Bad group", unit: "pcs", stockGroupId: foreign!.id } as never),
    ).rejects.toThrow(/not found/);
  });
});

describe("stockGroup.delete", () => {
  it("deletes an empty group", async () => {
    const g = await caller().stockGroup.create({ name: "Empty" });
    await caller().stockGroup.delete({ id: g.id });
    expect((await groupsOf(world.business1.id)).find((x) => x.id === g.id)).toBeUndefined();
  });

  it("refuses a group with items or sub-groups", async () => {
    const parent = await caller().stockGroup.create({ name: "Del parent" });
    await caller().stockGroup.create({ name: "Del child", parentId: parent.id });
    await expect(caller().stockGroup.delete({ id: parent.id })).rejects.toThrow(/sub-group/);

    const withItem = await caller().stockGroup.create({ name: "Del with item" });
    await caller().item.create({ name: "Del item", unit: "pcs", stockGroupId: withItem.id } as never);
    await expect(caller().stockGroup.delete({ id: withItem.id })).rejects.toThrow(/1 item/);
  });

  it("reassigns items and lifts sub-groups when asked", async () => {
    const outer = await caller().stockGroup.create({ name: "Re outer" });
    const doomed = await caller().stockGroup.create({ name: "Re doomed", parentId: outer.id });
    const sub = await caller().stockGroup.create({ name: "Re sub", parentId: doomed.id });
    const target = await caller().stockGroup.create({ name: "Re target" });
    const item = await caller().item.create({ name: "Re item", unit: "pcs", stockGroupId: doomed.id } as never);

    await expect(caller().stockGroup.delete({ id: doomed.id, reassignItemsTo: doomed.id })).rejects.toThrow();
    await caller().stockGroup.delete({ id: doomed.id, reassignItemsTo: target.id });

    const moved = await caller().item.getById({ id: item.id });
    expect(moved).toMatchObject({ stockGroupId: target.id, category: "Re target" });
    const [subRow] = await getTenantTestDb().select().from(stockGroups).where(eq(stockGroups.id, sub.id));
    expect(subRow!.parentId).toBe(outer.id);
  });

  it("ungroups items with reassignItemsTo null", async () => {
    const g = await caller().stockGroup.create({ name: "Ungroup me" });
    const item = await caller().item.create({ name: "Ungroup item", unit: "pcs", stockGroupId: g.id } as never);
    await caller().stockGroup.delete({ id: g.id, reassignItemsTo: null });
    expect(await caller().item.getById({ id: item.id })).toMatchObject({ stockGroupId: null, category: null });
  });
});

describe("stock group summary", () => {
  let top: string;
  let mid: string;
  let leaf: string;
  let itemTop: string;
  let itemLeaf: string;

  beforeAll(async () => {
    const db = getTenantTestDb();
    top = (await caller().stockGroup.create({ name: "Sum top" })).id;
    mid = (await caller().stockGroup.create({ name: "Sum mid", parentId: top })).id;
    leaf = (await caller().stockGroup.create({ name: "Sum leaf", parentId: mid })).id;
    // Stock with no movement history is valued at the item's purchase price.
    itemTop = (await createItem(db, world.business1.id, {
      name: "Sum item top", stockQuantity: "10", purchasePrice: "50", stockGroupId: top, category: "Sum top",
    })).id;
    itemLeaf = (await createItem(db, world.business1.id, {
      name: "Sum item leaf", stockQuantity: "4", purchasePrice: "25", stockGroupId: leaf, category: "Sum leaf",
    })).id;
  });

  it("rolls quantity and value up through parent groups", async () => {
    const res = await caller().inventoryReports.stockGroupSummary();
    const row = (id: string) => res.groups.find((g) => g.id === id)!;
    expect(row(leaf)).toMatchObject({ quantity: 4, value: 100, itemCount: 1 });
    expect(row(mid)).toMatchObject({ quantity: 4, value: 100, itemCount: 1 });
    expect(row(top)).toMatchObject({ quantity: 14, value: 600, itemCount: 2 });
    expect(row(leaf).depth).toBe(2);

    // Drill-down rows carry their group.
    expect(res.items.find((i) => i.itemId === itemLeaf)).toMatchObject({ groupId: leaf, quantity: 4, rate: 25, value: 100 });
    expect(res.items.find((i) => i.itemId === itemTop)!.groupId).toBe(top);

    // Top-level groups plus ungrouped stock add up to the total.
    const topLevel = res.groups.filter((g) => g.depth === 0).reduce((s, g) => s + g.value, 0);
    expect(topLevel + res.ungrouped.value).toBeCloseTo(res.totalValue, 2);
  });

  it("filters the stock summary to a group and its sub-groups", async () => {
    const res = await caller().reports.stockSummary({ stockGroupId: top, showZeroStock: true });
    const ids = res.simpleItems.map((r) => r.itemId).sort();
    expect(ids).toEqual([itemTop, itemLeaf].sort());
    const leafOnly = await caller().reports.stockSummary({ stockGroupId: leaf, showZeroStock: true });
    expect(leafOnly.simpleItems.map((r) => r.itemId)).toEqual([itemLeaf]);
  });
});
