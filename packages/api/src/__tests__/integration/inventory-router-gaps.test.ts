/**
 * Router gaps: stockGroup, pos and inventoryReports.
 *
 * The happy paths of the tree and the reports live in stock-groups.test.ts
 * and inventory-reports.test.ts. This file covers what those leave out:
 * input validation, unknown and foreign ids, permissions, audit rows, and
 * the edge cases of each procedure.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { items, itemVariants, stockGroups } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createItem, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const now = () => new Date().toISOString();

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── stockGroup ──────────────────────────────────────────────────────────────

describe("stockGroup.create", () => {
  it("creates a top-level group and writes an audit row", async () => {
    const g = await caller().stockGroup.create({ name: "  Fabrics  " });
    expect(g.name).toBe("Fabrics"); // trimmed
    expect(g.parentId).toBeNull();
    const audit = await waitForAudit(world.business1.id, "stockGroup.create", g.id);
    expect(audit).toHaveLength(1);
  });

  it("validates the name", async () => {
    await expectCode(caller().stockGroup.create({ name: "   " }), "BAD_REQUEST");
    await expectCode(caller().stockGroup.create({ name: "x".repeat(101) }), "BAD_REQUEST");
    await expectCode(caller().stockGroup.create({ name: "ok", parentId: "not-a-uuid" }), "BAD_REQUEST");
  });

  it("refuses an unknown parent", async () => {
    await expectCode(caller().stockGroup.create({ name: "Orphan", parentId: UNKNOWN }), "NOT_FOUND");
  });

  it("lets two businesses use the same name", async () => {
    await caller().stockGroup.create({ name: "Shared name" });
    await expect(other().stockGroup.create({ name: "shared NAME" })).resolves.toMatchObject({ name: "shared NAME" });
  });

  it("is refused to a seller, who cannot create items", async () => {
    await expectCode(seller().stockGroup.create({ name: "Seller group" }), "FORBIDDEN");
  });
});

describe("stockGroup.list", () => {
  it("counts direct, nested and ungrouped items and children", async () => {
    const parent = await caller().stockGroup.create({ name: "List parent" });
    const child = await caller().stockGroup.create({ name: "List child", parentId: parent.id });
    const db = getTenantTestDb();
    await createItem(db, world.business1.id, { name: "In parent", stockGroupId: parent.id });
    await createItem(db, world.business1.id, { name: "In child", stockGroupId: child.id });
    await createItem(db, world.business1.id, { name: "Deleted in child", stockGroupId: child.id, deletedAt: new Date() });

    const res = await caller().stockGroup.list();
    const p = res.data.find((g) => g.id === parent.id)!;
    const c = res.data.find((g) => g.id === child.id)!;
    expect(p).toMatchObject({ directItemCount: 1, itemCount: 2, childCount: 1, depth: 0 });
    expect(c).toMatchObject({ directItemCount: 1, itemCount: 1, childCount: 0, depth: 1 });
    // world.item1 has no group
    expect(res.ungroupedItemCount).toBeGreaterThanOrEqual(1);
  });

  it("never shows another business's groups", async () => {
    const mine = await caller().stockGroup.create({ name: "Private group" });
    const res = await other().stockGroup.list();
    expect(res.data.find((g) => g.id === mine.id)).toBeUndefined();
  });

  it("is readable by a seller", async () => {
    await expect(seller().stockGroup.list()).resolves.toHaveProperty("data");
  });
});

describe("stockGroup.rename", () => {
  it("renames, updates item categories and audits the change", async () => {
    const g = await caller().stockGroup.create({ name: "Rename me" });
    const item = await createItem(getTenantTestDb(), world.business1.id, { name: "Rename item", stockGroupId: g.id, category: "Rename me" });
    const renamed = await caller().stockGroup.rename({ id: g.id, name: "Renamed" });
    expect(renamed.name).toBe("Renamed");
    const [row] = await getTenantTestDb().select().from(items).where(eq(items.id, item.id));
    expect(row!.category).toBe("Renamed");
    const [audit] = await waitForAudit(world.business1.id, "stockGroup.rename", g.id);
    expect(JSON.parse(String(audit!.metadata))).toEqual({ from: "Rename me", to: "Renamed" });
  });

  it("allows a change of case to the same group", async () => {
    const g = await caller().stockGroup.create({ name: "casey" });
    await expect(caller().stockGroup.rename({ id: g.id, name: "Casey" })).resolves.toMatchObject({ name: "Casey" });
  });

  it("refuses a name another group has", async () => {
    await caller().stockGroup.create({ name: "Taken name" });
    const g = await caller().stockGroup.create({ name: "Free name" });
    await expectCode(caller().stockGroup.rename({ id: g.id, name: "TAKEN NAME" }), "CONFLICT");
  });

  it("refuses unknown and foreign ids", async () => {
    await expectCode(caller().stockGroup.rename({ id: UNKNOWN, name: "x" }), "NOT_FOUND");
    const theirs = await other().stockGroup.create({ name: "Theirs to rename" });
    await expectCode(caller().stockGroup.rename({ id: theirs.id, name: "Hijacked" }), "NOT_FOUND");
  });

  it("validates input", async () => {
    await expectCode(caller().stockGroup.rename({ id: "bad", name: "x" }), "BAD_REQUEST");
  });
});

describe("stockGroup.move", () => {
  it("moves under a parent and back to the top, auditing each move", async () => {
    const a = await caller().stockGroup.create({ name: "Move A" });
    const b = await caller().stockGroup.create({ name: "Move B" });
    await expect(caller().stockGroup.move({ id: b.id, parentId: a.id })).resolves.toMatchObject({ parentId: a.id });
    await expect(caller().stockGroup.move({ id: b.id, parentId: null })).resolves.toMatchObject({ parentId: null });
    expect(await waitForAudit(world.business1.id, "stockGroup.move", b.id)).not.toHaveLength(0);
  });

  it("refuses to move a group under itself", async () => {
    const a = await caller().stockGroup.create({ name: "Self parent" });
    await expectCode(caller().stockGroup.move({ id: a.id, parentId: a.id }), "BAD_REQUEST");
  });

  it("refuses unknown group and unknown parent", async () => {
    const a = await caller().stockGroup.create({ name: "Move unknown" });
    await expectCode(caller().stockGroup.move({ id: UNKNOWN, parentId: null }), "NOT_FOUND");
    await expectCode(caller().stockGroup.move({ id: a.id, parentId: UNKNOWN }), "NOT_FOUND");
  });

  it("is refused to a seller", async () => {
    const a = await caller().stockGroup.create({ name: "Seller move" });
    await expectCode(seller().stockGroup.move({ id: a.id, parentId: null }), "FORBIDDEN");
  });
});

describe("stockGroup.delete", () => {
  it("deletes and audits", async () => {
    const g = await caller().stockGroup.create({ name: "Delete audit" });
    await expect(caller().stockGroup.delete({ id: g.id })).resolves.toEqual({ success: true });
    const rows = await getTenantTestDb().select().from(stockGroups).where(eq(stockGroups.id, g.id));
    expect(rows).toHaveLength(0);
    expect(await waitForAudit(world.business1.id, "stockGroup.delete", g.id)).toHaveLength(1);
  });

  it("refuses to reassign items to the group being deleted", async () => {
    const g = await caller().stockGroup.create({ name: "Reassign self" });
    await expectCode(caller().stockGroup.delete({ id: g.id, reassignItemsTo: g.id }), "BAD_REQUEST");
  });

  it("refuses unknown ids, an unknown target, and another business's group", async () => {
    const g = await caller().stockGroup.create({ name: "Delete target" });
    await expectCode(caller().stockGroup.delete({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(caller().stockGroup.delete({ id: g.id, reassignItemsTo: UNKNOWN }), "NOT_FOUND");
    const theirs = await other().stockGroup.create({ name: "Theirs to delete" });
    await expectCode(caller().stockGroup.delete({ id: theirs.id }), "NOT_FOUND");
    await expectCode(caller().stockGroup.delete({ id: g.id, reassignItemsTo: theirs.id }), "NOT_FOUND");
  });

  it("counts soft-deleted items as not blocking, but still clears their group", async () => {
    const g = await caller().stockGroup.create({ name: "Only deleted items" });
    const gone = await createItem(getTenantTestDb(), world.business1.id, {
      name: "Gone item", stockGroupId: g.id, category: "Only deleted items", deletedAt: new Date(),
    });
    await caller().stockGroup.delete({ id: g.id });
    const [row] = await getTenantTestDb().select().from(items).where(eq(items.id, gone.id));
    expect(row!.stockGroupId).toBeNull();
    expect(row!.category).toBeNull();
  });

  it("is refused to a seller", async () => {
    const g = await caller().stockGroup.create({ name: "Seller delete" });
    await expectCode(seller().stockGroup.delete({ id: g.id }), "FORBIDDEN");
  });
});

// ── pos.catalog ────────────────────────────────────────────────────────────

describe("pos.catalog", () => {
  let simpleId: string;
  let altId: string;
  let variantItemId: string;
  let redId: string;

  beforeAll(async () => {
    const db = getTenantTestDb();
    const b = world.business1.id;
    simpleId = (await createItem(db, b, { name: "POS Simple Soap", sku: "SOAP-1", barcode: "8901234567890", salePrice: "40.00", stockQuantity: "12.000" })).id;
    altId = (await createItem(db, b, {
      name: "POS Rice", unit: "kg", itemMode: "alt_units", salePrice: "60.00", stockQuantity: "50.000",
      unitVariants: [{ unit: "bag", conversionFactor: 25, salePrice: "1400.00" }, { unit: "g", conversionFactor: 0.001 }],
    } as never)).id;
    variantItemId = (await createItem(db, b, { name: "POS Tee", itemMode: "variants", salePrice: "300.00", sku: "TEE" })).id;
    const [red] = await db.insert(itemVariants).values({ itemId: variantItemId, attributeValues: { Color: "Red", Size: "M" }, salePrice: "350.00", stockQuantity: "4", sku: "TEE-R-M" }).returning();
    redId = red!.id;
    await db.insert(itemVariants).values({ itemId: variantItemId, attributeValues: { Color: "Blue" }, stockQuantity: "2" });
    await db.insert(itemVariants).values({ itemId: variantItemId, attributeValues: { Color: "Gone" }, stockQuantity: "9", deletedAt: new Date() });
    await createItem(db, b, { name: "POS Service", itemType: "service" });
    await createItem(db, b, { name: "POS Deleted", deletedAt: new Date() });
  });

  it("expands simple, alternate-unit and variant items into tiles", async () => {
    const { tiles } = await caller().pos.catalog({ search: "POS", limit: 200 });
    const simple = tiles.filter((t) => t.itemId === simpleId);
    expect(simple).toHaveLength(1);
    expect(simple[0]).toMatchObject({ tileKey: `i:${simpleId}`, unitPrice: "40.00", conversionFactor: "1", variantId: null });

    const alt = tiles.filter((t) => t.itemId === altId);
    expect(alt.map((t) => t.unit).sort()).toEqual(["bag", "g"]);
    expect(alt.find((t) => t.unit === "bag")).toMatchObject({ unitPrice: "1400.00", stockQuantity: "2.000", conversionFactor: "25" });
    // No price on the "g" unit: falls back to the item price.
    expect(alt.find((t) => t.unit === "g")!.unitPrice).toBe("60.00");

    const vars = tiles.filter((t) => t.itemId === variantItemId);
    expect(vars).toHaveLength(2); // the deleted variant is left out
    const red = vars.find((t) => t.variantId === redId)!;
    // Ambiguous: attribute_values is JSONB, which stores keys shortest-first,
    // so {Color, Size} comes back as Size / Color. The tile name follows the
    // stored order, not the order the attributes were entered in.
    expect(red.displayName).toBe("POS Tee — M / Red");
    expect(red.unitPrice).toBe("350.00");
    expect(red.sku).toBe("TEE-R-M");
    const blue = vars.find((t) => t.variantId !== redId)!;
    expect(blue.unitPrice).toBe("300.00"); // item's price
    expect(blue.sku).toBe("TEE"); // item's sku

    const names = tiles.map((t) => t.displayName);
    expect(names).not.toContain("POS Service");
    expect(names).not.toContain("POS Deleted");
  });

  it("matches on barcode and SKU, and escapes LIKE wildcards", async () => {
    const byBarcode = await caller().pos.catalog({ search: "8901234567890" });
    expect(byBarcode.tiles.map((t) => t.itemId)).toEqual([simpleId]);
    const bySku = await caller().pos.catalog({ search: "soap-1" });
    expect(bySku.tiles.map((t) => t.itemId)).toEqual([simpleId]);
    const wildcard = await caller().pos.catalog({ search: "%" });
    expect(wildcard.tiles).toHaveLength(0);
  });

  it("pages by item and echoes page and limit", async () => {
    const page1 = await caller().pos.catalog({ search: "POS", limit: 1, page: 1 });
    const page2 = await caller().pos.catalog({ search: "POS", limit: 1, page: 2 });
    expect(page1).toMatchObject({ page: 1, limit: 1 });
    expect(page1.tiles[0]!.itemId).not.toBe(page2.tiles[0]!.itemId);
    const beyond = await caller().pos.catalog({ search: "POS", limit: 200, page: 50 });
    expect(beyond.tiles).toEqual([]);
  });

  it("validates paging input", async () => {
    await expectCode(caller().pos.catalog({ limit: 201 }), "BAD_REQUEST");
    await expectCode(caller().pos.catalog({ page: 0 }), "BAD_REQUEST");
  });

  it("is open to sellers and scoped to the business", async () => {
    const mine = await seller().pos.catalog({ search: "POS Simple" });
    expect(mine.tiles).toHaveLength(1);
    const theirs = await other().pos.catalog({ search: "POS Simple" });
    expect(theirs.tiles).toHaveLength(0);
  });
});

// ── inventoryReports ────────────────────────────────────────────────────────

describe("inventoryReports", () => {
  let itemId: string;
  let variantParent: string;
  let variantId: string;
  let group: { id: string };

  beforeAll(async () => {
    group = await caller().stockGroup.create({ name: "Report group" });
    itemId = (await caller().item.create({ name: "Report widget", unit: "pcs", stockQuantity: "0", purchasePrice: "10", salePrice: "15", stockGroupId: group.id } as never)).id;
    await caller().invoice.create({
      partyId: world.party1.id, type: "purchase", invoiceDate: daysAgo(3),
      lineItems: [{ itemId, itemName: "Report widget", quantity: "5", unitPrice: "10", taxPercent: "0", discountPercent: "0" }],
    } as never);
    const db = getTenantTestDb();
    variantParent = (await createItem(db, world.business1.id, { name: "Report variant item", itemMode: "variants", stockQuantity: "0" })).id;
    const [v] = await db.insert(itemVariants).values({ itemId: variantParent, attributeValues: { Size: "L" }, stockQuantity: "0" }).returning();
    variantId = v!.id;
  });

  it("stockLedger: validates dates and ids", async () => {
    await expectCode(caller().inventoryReports.stockLedger({ itemId, fromDate: "yesterday", toDate: now() }), "BAD_REQUEST");
    await expectCode(caller().inventoryReports.stockLedger({ itemId: "nope", fromDate: daysAgo(1), toDate: now() }), "BAD_REQUEST");
  });

  it("stockLedger: NOT_FOUND for unknown items, another business's item, and a variant of another item", async () => {
    await expectCode(caller().inventoryReports.stockLedger({ itemId: UNKNOWN, fromDate: daysAgo(10), toDate: now() }), "NOT_FOUND");
    await expectCode(caller().inventoryReports.stockLedger({ itemId: world.item2.id, fromDate: daysAgo(10), toDate: now() }), "NOT_FOUND");
    await expectCode(caller().inventoryReports.stockLedger({ itemId, variantId, fromDate: daysAgo(10), toDate: now() }), "NOT_FOUND");
  });

  it("stockLedger: an empty window keeps the balance as the opening", async () => {
    const res = await caller().inventoryReports.stockLedger({ itemId, fromDate: daysAgo(1), toDate: now() });
    expect(res.lines).toHaveLength(0);
    expect(res.opening).toBe(5);
    expect(res.closing).toBe(5);
  });

  it("stockLedger: works for a variant", async () => {
    const res = await caller().inventoryReports.stockLedger({ itemId: variantParent, variantId, fromDate: daysAgo(10), toDate: now() });
    expect(res.lines).toHaveLength(0);
    expect(res.closing).toBe(0);
  });

  it("movementSummary: validates input and scopes to the business", async () => {
    await expectCode(caller().inventoryReports.movementSummary({ fromDate: "x", toDate: now() } as never), "BAD_REQUEST");
    const res = await other().inventoryReports.movementSummary({ fromDate: daysAgo(10), toDate: now() });
    expect(res.data.find((r) => r.itemId === itemId)).toBeUndefined();
  });

  it("godownSummary, ageing: return this business's stock only", async () => {
    const [godown, ageing] = await Promise.all([other().inventoryReports.godownSummary(), other().inventoryReports.ageing()]);
    expect(JSON.stringify(godown)).not.toContain(itemId);
    expect(ageing.data.find((r) => r.itemId === itemId)).toBeUndefined();
    const mine = await caller().inventoryReports.ageing();
    expect(mine.data.find((r) => r.itemId === itemId)?.buckets[0]?.quantity).toBe(5);
  });

  it("reorderStatus and deadStock: validate their bounds and use defaults with no input", async () => {
    await expectCode(caller().inventoryReports.reorderStatus({ coverDays: 0 }), "BAD_REQUEST");
    await expectCode(caller().inventoryReports.reorderStatus({ coverDays: 366 }), "BAD_REQUEST");
    await expectCode(caller().inventoryReports.deadStock({ days: 6 }), "BAD_REQUEST");
    await expectCode(caller().inventoryReports.deadStock({ days: 3651 }), "BAD_REQUEST");
    await expect(caller().inventoryReports.reorderStatus()).resolves.toHaveProperty("data");
    await expect(caller().inventoryReports.deadStock()).resolves.toHaveProperty("data");
  });

  it("stockGroupSummary: puts the item under its group and validates asOf", async () => {
    const res = await caller().inventoryReports.stockGroupSummary();
    const g = res.groups.find((x) => x.id === group.id)!;
    expect(g).toMatchObject({ quantity: 5, value: 50, itemCount: 1 });
    expect(res.items.find((i) => i.itemId === itemId)!.groupId).toBe(group.id);
    // Before the purchase there was nothing.
    const before = await caller().inventoryReports.stockGroupSummary({ asOf: daysAgo(30) });
    expect(before.groups.find((x) => x.id === group.id)!.quantity).toBe(0);
    await expectCode(caller().inventoryReports.stockGroupSummary({ asOf: "not a date" }), "BAD_REQUEST");
  });

  it("all reports are readable by a seller (Report read) — documented permission", async () => {
    await expect(seller().inventoryReports.godownSummary()).resolves.toHaveProperty("data");
    await expect(seller().inventoryReports.stockGroupSummary()).resolves.toHaveProperty("groups");
  });
});
