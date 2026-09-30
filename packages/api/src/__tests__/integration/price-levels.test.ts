/**
 * Price levels, quantity slabs and MRP: level CRUD, the price grid, bulk
 * updates, the Price List report and pricing.resolve precedence.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { withMrpNotes, type InvoicePDFData } from "../../lib/invoice-pdf.js";

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

/** Kiran, owner of the other tenant and business. */
function otherCaller() {
  return createTestCaller({
    userId: world.kiran.id,
    email: world.kiran.email,
    name: world.kiran.name ?? null,
    tenantId: world.tenant2.id,
    businessId: world.business2.id,
  });
}

let retail: { id: string };
let wholesale: { id: string };
let plain: { id: string };
let boxed: { id: string };
let shirt: { id: string; variants: Array<{ id: string; attributeValues: Record<string, string> }> };
let wholesaleParty: { id: string };
let walkIn: { id: string };

const resolveOne = async (partyId: string | null, line: Record<string, unknown>, date?: string) => {
  const r = await caller().pricing.resolve({ partyId, date, lines: [line as never] });
  return { level: r.priceLevel?.name ?? null, ...r.lines[0] };
};

beforeAll(async () => {
  world = await createTestWorld();
  const c = caller();
  retail = await c.priceLevel.create({ name: "Retail", isDefault: true });
  wholesale = await c.priceLevel.create({ name: "Wholesale" });

  plain = await c.item.create({ name: "Soap", unit: "pcs", salePrice: "50", mrp: "60" } as never);
  boxed = await c.item.create({
    name: "Biscuit", unit: "pcs", itemMode: "alt_units", salePrice: "10",
    unitVariants: [{ unit: "box", conversionFactor: 12, salePrice: "110" }],
  } as never);
  shirt = (await c.item.create({
    name: "Shirt", unit: "pcs", itemMode: "variants", salePrice: "500", variantAttributes: ["Size"],
    variants: [
      { attributeValues: { Size: "M" }, salePrice: "500", mrp: "599" },
      { attributeValues: { Size: "XL" }, salePrice: "550" },
    ],
  } as never)) as never;

  wholesaleParty = await c.party.create({ type: "customer", name: "Bulk Buyer", priceLevelId: wholesale.id } as never);
  walkIn = await c.party.create({ type: "customer", name: "Walk-in" } as never);
});

afterAll(async () => {
  await truncateAllTables();
});

describe("priceLevel CRUD", () => {
  it("lists levels with only one default", async () => {
    const c = caller();
    const extra = await c.priceLevel.create({ name: "Dealer", isDefault: true });
    let list = await c.priceLevel.list();
    expect(list.filter((l) => l.isDefault).map((l) => l.name)).toEqual(["Dealer"]);
    await c.priceLevel.update({ id: retail.id, data: { isDefault: true } });
    list = await c.priceLevel.list();
    expect(list.filter((l) => l.isDefault).map((l) => l.name)).toEqual(["Retail"]);
    await c.priceLevel.delete({ id: extra.id });
    list = await c.priceLevel.list();
    expect(list.map((l) => l.name).sort()).toEqual(["Retail", "Wholesale"]);
  });

  it("rejects duplicate names", async () => {
    await expect(caller().priceLevel.create({ name: "Retail" })).rejects.toThrow(/already exists/);
  });

  it("keeps levels to their business", async () => {
    const other = otherCaller();
    await expect(other.priceLevel.update({ id: retail.id, data: { name: "Hijack" } })).rejects.toThrow(/not found/i);
    expect(await other.priceLevel.list()).toEqual([]);
  });

  it("stores a party's level and rejects another business's level", async () => {
    expect((await caller().party.getById({ id: wholesaleParty.id }))?.priceLevelId).toBe(wholesale.id);
    const foreign = await otherCaller().priceLevel.create({ name: "Foreign" });
    await expect(caller().party.update({ id: walkIn.id, data: { priceLevelId: foreign.id } })).rejects.toThrow(/Price level not found/);
  });
});

describe("MRP", () => {
  it("is stored and returned on items and variants", async () => {
    const c = caller();
    const item = await c.item.getById({ id: plain.id });
    expect(item?.mrp).toBe("60.00");
    const variants = await c.item.listVariants({ itemId: shirt.id });
    expect(variants.find((v) => v.attributeValues.Size === "M")?.mrp).toBe("599.00");
    await c.item.update({ id: plain.id, data: { mrp: "65" } });
    expect((await c.item.getById({ id: plain.id }))?.mrp).toBe("65.00");
    const xl = variants.find((v) => v.attributeValues.Size === "XL")!;
    await c.item.updateVariant({ variantId: xl.id, data: { mrp: "649" } });
    expect((await c.item.listVariants({ itemId: shirt.id })).find((v) => v.id === xl.id)?.mrp).toBe("649.00");
  });

  it("comes back from the resolver", async () => {
    const r = await resolveOne(walkIn.id, { itemId: plain.id, quantity: 1 });
    expect(r.mrp).toBe("65.00");
  });
});

describe("pricing.resolve", () => {
  beforeAll(async () => {
    const c = caller();
    // Soap: retail 48; wholesale slabs 45 (0+), 42 (10+), 40 (100+); a
    // dated wholesale revision from 2026-06-01 with 44 / 41 (10+).
    await c.priceLevel.setGridPrices({ cells: [{ priceLevelId: retail.id, itemId: plain.id, price: "48" }] });
    await c.priceLevel.setItemPrices({
      priceLevelId: wholesale.id, itemId: plain.id,
      slabs: [{ minQuantity: "0", price: "45" }, { minQuantity: "10", price: "42" }, { minQuantity: "100", price: "40" }],
    });
    await c.priceLevel.setItemPrices({
      priceLevelId: wholesale.id, itemId: plain.id, effectiveFrom: "2026-06-01",
      slabs: [{ minQuantity: "0", price: "44" }, { minQuantity: "10", price: "41" }],
    });
    // Biscuit: wholesale 9/pc; a box price of 100 on wholesale.
    await c.priceLevel.setItemPrices({ priceLevelId: wholesale.id, itemId: boxed.id, slabs: [{ minQuantity: "0", price: "9" }] });
    // Retail: only a per-piece price, so a box is 12 x 9.5.
    await c.priceLevel.setItemPrices({ priceLevelId: retail.id, itemId: boxed.id, slabs: [{ minQuantity: "0", price: "9.5" }] });
    await c.priceLevel.setItemPrices({ priceLevelId: wholesale.id, itemId: boxed.id, unit: "box", slabs: [{ minQuantity: "0", price: "100" }] });
    // Shirt: wholesale 10% off every size; M has its own wholesale rate.
    await c.priceLevel.setItemPrices({ priceLevelId: wholesale.id, itemId: shirt.id, slabs: [{ minQuantity: "0", discountPercent: "10" }] });
    const m = shirt.variants.find((v) => v.attributeValues.Size === "M")!;
    await c.priceLevel.setItemPrices({ priceLevelId: wholesale.id, itemId: shirt.id, variantId: m.id, slabs: [{ minQuantity: "0", price: "420" }] });
  });

  it("uses the party's level", async () => {
    const r = await resolveOne(wholesaleParty.id, { itemId: plain.id, quantity: 1 }, "2026-01-15");
    expect(r).toMatchObject({ level: "Wholesale", unitPrice: "45.00", source: "level" });
  });

  it("uses the default level for a party without one, and with no party", async () => {
    expect(await resolveOne(walkIn.id, { itemId: plain.id, quantity: 1 })).toMatchObject({ level: "Retail", unitPrice: "48.00" });
    expect(await resolveOne(null, { itemId: plain.id, quantity: 1 })).toMatchObject({ level: "Retail", unitPrice: "48.00" });
  });

  it("picks the highest slab the quantity reaches", async () => {
    const at = (q: number) => resolveOne(wholesaleParty.id, { itemId: plain.id, quantity: q }, "2026-01-15");
    expect((await at(9)).unitPrice).toBe("45.00");
    expect((await at(10)).unitPrice).toBe("42.00");
    expect((await at(250)).unitPrice).toBe("40.00");
  });

  it("uses the latest revision effective on the date", async () => {
    const at = (q: number, d: string) => resolveOne(wholesaleParty.id, { itemId: plain.id, quantity: q }, d);
    expect((await at(1, "2026-05-31")).unitPrice).toBe("45.00");
    expect((await at(1, "2026-06-01")).unitPrice).toBe("44.00");
    // The new revision has no 100+ slab: its 10+ slab applies.
    expect((await at(250, "2026-07-01T10:00:00.000Z")).unitPrice).toBe("41.00");
  });

  it("prices alternate units: own entry, else base entry x conversion, else the unit's sale price", async () => {
    expect((await resolveOne(wholesaleParty.id, { itemId: boxed.id, unit: "box", quantity: 1 })).unitPrice).toBe("100.00");
    expect((await resolveOne(walkIn.id, { itemId: boxed.id, unit: "box", quantity: 1 })).unitPrice).toBe("114.00");
    await caller().priceLevel.setItemPrices({ priceLevelId: retail.id, itemId: boxed.id, slabs: [] });
    expect(await resolveOne(walkIn.id, { itemId: boxed.id, unit: "box", quantity: 1 })).toMatchObject({ unitPrice: "110.00", source: "item" });
    expect(await resolveOne(walkIn.id, { itemId: boxed.id, unit: "pcs", quantity: 1 })).toMatchObject({ unitPrice: "10.00", source: "item" });
  });

  it("prefers a variant's entry, then the item's; a discount keeps the variant's price", async () => {
    const m = shirt.variants.find((v) => v.attributeValues.Size === "M")!;
    const xl = shirt.variants.find((v) => v.attributeValues.Size === "XL")!;
    expect(await resolveOne(wholesaleParty.id, { itemId: shirt.id, variantId: m.id, quantity: 1 }))
      .toMatchObject({ unitPrice: "420.00", discountPercent: null, mrp: "599.00" });
    expect(await resolveOne(wholesaleParty.id, { itemId: shirt.id, variantId: xl.id, quantity: 1 }))
      .toMatchObject({ unitPrice: "550.00", discountPercent: "10.00", netPrice: "495.00", source: "level" });
    // Retail has no shirt prices: the variant's own sale price.
    expect(await resolveOne(walkIn.id, { itemId: shirt.id, variantId: xl.id, quantity: 1 }))
      .toMatchObject({ unitPrice: "550.00", source: "item" });
  });

  it("falls back to the item price with no levels at all", async () => {
    const other = otherCaller();
    const r = await other.pricing.resolve({ lines: [{ itemId: world.item2.id, quantity: 1 }] });
    expect(r.priceLevel).toBeNull();
    expect(r.lines[0].source).toBe("item");
  });

  it("does not price another business's items", async () => {
    const r = await otherCaller().pricing.resolve({ partyId: null, lines: [{ itemId: plain.id, quantity: 1 }] });
    expect(r.lines[0].unitPrice).toBeNull();
  });

  it("rejects duplicate slab starts and foreign units", async () => {
    const c = caller();
    await expect(c.priceLevel.setItemPrices({
      priceLevelId: retail.id, itemId: plain.id, slabs: [{ minQuantity: "5", price: "1" }, { minQuantity: "5.0", price: "2" }],
    })).rejects.toThrow(/same quantity/);
    await expect(c.priceLevel.setItemPrices({
      priceLevelId: retail.id, itemId: plain.id, unit: "box", slabs: [{ minQuantity: "0", price: "1" }],
    })).rejects.toThrow(/not a unit/);
  });
});

describe("grid, bulk update and price list", () => {
  it("shows plain prices per level and counts the rest", async () => {
    const g = await caller().priceLevel.grid();
    const soap = g.rows.find((r) => r.itemId === plain.id && !r.variantId)!;
    expect(soap.prices[retail.id]).toBe("48.00");
    expect(soap.prices[wholesale.id]).toBe("45.00");
    expect(soap.slabCount[wholesale.id]).toBe(4);
    expect(g.rows.filter((r) => r.itemId === shirt.id)).toHaveLength(3);
  });

  it("clears a cell with a null price", async () => {
    const c = caller();
    await c.priceLevel.setGridPrices({ cells: [{ priceLevelId: retail.id, itemId: plain.id, price: null }] });
    const g = await c.priceLevel.grid();
    expect(g.rows.find((r) => r.itemId === plain.id && !r.variantId)!.prices[retail.id]).toBeNull();
  });

  it("bulk sets a level from sale prices less a percentage, then raises it", async () => {
    const c = caller();
    const res = await c.priceLevel.bulkUpdate({ priceLevelId: retail.id, basis: "salePrice", percent: -10, round: "rupee" });
    expect(res.updated).toBeGreaterThanOrEqual(4);
    let g = await c.priceLevel.grid();
    expect(g.rows.find((r) => r.itemId === plain.id && !r.variantId)!.prices[retail.id]).toBe("45.00");
    await c.priceLevel.bulkUpdate({ priceLevelId: retail.id, basis: "current", percent: 20 });
    g = await c.priceLevel.grid();
    expect(g.rows.find((r) => r.itemId === plain.id && !r.variantId)!.prices[retail.id]).toBe("54.00");
  });

  it("price list report gives each level's price as of a date", async () => {
    const r = await caller().priceLevel.priceList({ date: "2026-07-01" });
    expect(r.levels.map((l) => l.name)).toEqual(["Retail", "Wholesale"]);
    const soap = r.rows.find((x) => x.itemId === plain.id && !x.variantId)!;
    expect(soap).toMatchObject({ salePrice: "50.00", mrp: "65.00" });
    expect(soap.prices[wholesale.id]).toBe("44.00");
    const xl = r.rows.find((x) => x.itemId === shirt.id && x.variantId && x.name.includes("XL"))!;
    expect(xl.prices[wholesale.id]).toBe("495.00");
  });
});

describe("invoice PDF MRP", () => {
  it("adds MRP under lines that have one", () => {
    const line = { itemName: "Soap", quantity: "1", unitPrice: "50", taxPercent: "0", taxAmount: "0", discountPercent: "0", totalAmount: "50" };
    const data = { lineItems: [{ ...line, mrp: "60" }, { ...line, description: "Gift wrap", mrp: "60" }, line] } as unknown as InvoicePDFData;
    const out = withMrpNotes(data).lineItems;
    expect(out[0].description).toMatch(/^MRP .*60.00$/);
    expect(out[1].description).toMatch(/^Gift wrap · MRP /);
    expect(out[2].description).toBeUndefined();
  });
});
