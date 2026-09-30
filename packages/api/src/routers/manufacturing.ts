/**
 * Bills of material and the manufacturing journal (Tally's BOM and
 * Manufacturing Journal).
 *
 * A BOM says what goes into `outputQuantity` of an item. Manufacturing posts a
 * journal: components leave the source warehouse (CONSUMPTION movements), the
 * finished item and any by-products arrive in the destination warehouse
 * (PRODUCTION / BY_PRODUCT movements), all under reference MANUFACTURING in
 * one transaction. Cancelling posts the opposite movements under
 * MANUFACTURING_CANCEL.
 *
 * Costing: each component is taken at its current valuation rate (see
 * lib/stock-valuation); the run's cost is that plus any additional costs
 * (labour, power…) and is carried on the PRODUCTION movement as unit_cost.
 * Stock valuation then counts production runs as inwards alongside purchases,
 * so finished goods get a real rate. By-products carry no cost.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  bomByProducts,
  bomComponents,
  boms,
  inventorySettings,
  items,
  itemVariants,
  manufacturingJournalLines,
  manufacturingJournals,
} from "@fintranzact/db";
import { paginationSchema } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import {
  ensureDefaultWarehouse,
  getNegativeStockPolicy,
  placeUnplacedStock,
  recordStockMovement,
  warehouseBalance,
} from "../lib/inventory-service.js";
import { unitKey, valueStock } from "../lib/stock-valuation.js";
import { escapeLike } from "../lib/escape-like.js";
import { assertWarehousePermission, assertWarehouses } from "./stock.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Unit = { itemId: string; variantId: string | null };
type UnitInfo = Unit & { name: string; unit: string };

const positiveQty = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, "Quantity can have up to 3 decimals")
  .refine((v) => parseFloat(v) > 0, "Quantity must be more than zero");
const quantity = z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "Quantity can have up to 3 decimals");
const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Amount can have up to 2 decimals");
const percent = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Wastage can have up to 2 decimals")
  .refine((v) => parseFloat(v) <= 1000, "Wastage is too high");

const unitRef = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
});

const bomInput = unitRef.extend({
  name: z.string().trim().min(1, "Give the BOM a name").max(200),
  outputQuantity: positiveQty.default("1"),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(1000).nullish(),
  components: z
    .array(unitRef.extend({ quantity: positiveQty, wastagePercent: percent.optional() }))
    .min(1, "Add at least one component")
    .max(200),
  byProducts: z.array(unitRef.extend({ quantity: positiveQty })).max(50).default([]),
});

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const qty3 = (n: number) => round3(n).toFixed(3);
const trimQty = (n: number) => qty3(n).replace(/\.?0+$/, "");
const keyOf = (u: { itemId: string; variantId?: string | null }) => unitKey(u.itemId, u.variantId ?? null);

/** "Shirt — Red / L": the item name with its variant's attributes. */
const unitNameSql = sql`i.name || COALESCE(' — ' || (SELECT string_agg(value, ' / ') FROM jsonb_each_text(v.attribute_values)), '')`;

/**
 * Check that each unit is a stock item of this business: a product, not
 * deleted, with a variant exactly when the item has variants. Returns names
 * and units for messages and screens.
 */
async function loadUnits(db: Tx, businessId: string, units: Unit[]): Promise<Map<string, UnitInfo>> {
  const itemIds = [...new Set(units.map((u) => u.itemId))];
  const info = new Map<string, UnitInfo>();
  if (itemIds.length === 0) return info;
  const itemRows = (await db
    .select({ id: items.id, name: items.name, unit: items.unit, itemType: items.itemType, itemMode: items.itemMode })
    .from(items)
    .where(and(eq(items.businessId, businessId), sql`${items.id} IN ${itemIds}`, sql`${items.deletedAt} IS NULL`))) as Array<{
    id: string; name: string; unit: string; itemType: string; itemMode: string;
  }>;
  const variantIds = [...new Set(units.map((u) => u.variantId).filter((v): v is string => !!v))];
  const variantRows = variantIds.length
    ? ((await db
        .select({ id: itemVariants.id, itemId: itemVariants.itemId, attributes: itemVariants.attributeValues })
        .from(itemVariants)
        .where(and(sql`${itemVariants.id} IN ${variantIds}`, sql`${itemVariants.deletedAt} IS NULL`))) as Array<{
        id: string; itemId: string; attributes: Record<string, string> | null;
      }>)
    : [];
  const itemById = new Map(itemRows.map((r) => [r.id, r]));
  const variantById = new Map(variantRows.map((r) => [r.id, r]));

  for (const u of units) {
    const item = itemById.get(u.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
    if (item.itemType !== "product") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is a service — services don't carry stock` });
    }
    let name = item.name;
    if (item.itemMode === "variants") {
      const variant = u.variantId ? variantById.get(u.variantId) : null;
      if (!u.variantId) throw new TRPCError({ code: "BAD_REQUEST", message: `Pick a variant of ${item.name}` });
      if (!variant || variant.itemId !== item.id) throw new TRPCError({ code: "NOT_FOUND", message: "Item variant not found" });
      const attrs = Object.values(variant.attributes ?? {}).join(" / ");
      name = `${item.name} — ${attrs || "Variant"}`;
    } else if (u.variantId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} has no variants` });
    }
    info.set(keyOf(u), { itemId: u.itemId, variantId: u.variantId, name, unit: item.unit });
  }
  return info;
}

function assertNoDuplicates(lines: Unit[], info: Map<string, UnitInfo>, what: string) {
  const seen = new Set<string>();
  for (const l of lines) {
    const k = keyOf(l);
    if (seen.has(k)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${info.get(k)?.name ?? "An item"} is listed twice among the ${what}` });
    }
    seen.add(k);
  }
}

/**
 * Refuse a BOM whose finished item would end up among its own components,
 * directly or through the BOMs of its components (A needs B, B needs A).
 */
async function assertNoCycle(
  db: Tx,
  businessId: string,
  finished: Unit,
  components: Unit[],
  info: Map<string, UnitInfo>,
  excludeBomId?: string,
) {
  const target = keyOf(finished);
  const direct = components.find((c) => keyOf(c) === target);
  if (direct) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${info.get(target)?.name ?? "An item"} can't be a component of itself` });
  }

  const rows = (await db.execute(sql`
    SELECT b.item_id, b.variant_id, c.item_id AS component_item_id, c.variant_id AS component_variant_id,
           (SELECT ${unitNameSql} FROM items i LEFT JOIN item_variants v ON v.id = b.variant_id WHERE i.id = b.item_id) AS name
    FROM boms b
    JOIN bom_components c ON c.bom_id = b.id
    WHERE b.business_id = ${businessId}
      ${excludeBomId ? sql`AND b.id <> ${excludeBomId}` : sql``}
  `)) as unknown as Array<{
    item_id: string; variant_id: string | null; component_item_id: string; component_variant_id: string | null; name: string;
  }>;
  const needs = new Map<string, string[]>();
  const names = new Map<string, string>();
  for (const r of rows) {
    const k = unitKey(r.item_id, r.variant_id);
    needs.set(k, [...(needs.get(k) ?? []), unitKey(r.component_item_id, r.component_variant_id)]);
    names.set(k, r.name);
  }

  // Walk down from each component; reaching the finished item is a loop.
  const visited = new Set<string>();
  const stack = components.map((c) => ({ key: keyOf(c), via: keyOf(c) }));
  while (stack.length > 0) {
    const { key, via } = stack.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const next of needs.get(key) ?? []) {
      if (next === target) {
        const viaName = info.get(via)?.name ?? names.get(via) ?? "a component";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${info.get(target)?.name ?? "This item"} is already used to make ${viaName}, so it can't be made from it`,
        });
      }
      stack.push({ key: next, via });
    }
  }
}

/** Stock at a warehouse per unit, counting unplaced stock in the default warehouse. */
async function availableAt(db: Tx, businessId: string, warehouseId: string, units: Unit[]) {
  const result = new Map<string, number>();
  if (units.length === 0) return result;
  const [settings] = await db
    .select({ defaultId: inventorySettings.salesWarehouseId })
    .from(inventorySettings)
    .where(eq(inventorySettings.businessId, businessId))
    .limit(1);
  const isDefault = settings?.defaultId === warehouseId;
  const itemIds = [...new Set(units.map((u) => u.itemId))];
  const rows = (await db.execute(sql`
    WITH units AS (
      SELECT i.id AS item_id, NULL::uuid AS variant_id, i.stock_quantity::numeric AS total
      FROM items i WHERE i.business_id = ${businessId} AND i.id IN ${itemIds} AND i.item_mode <> 'variants'
      UNION ALL
      SELECT i.id, v.id, v.stock_quantity::numeric
      FROM item_variants v JOIN items i ON i.id = v.item_id
      WHERE i.business_id = ${businessId} AND i.id IN ${itemIds} AND v.deleted_at IS NULL
    )
    SELECT u.item_id, u.variant_id,
           (COALESCE((SELECT SUM(quantity::numeric) FROM stock_balances sb
              WHERE sb.business_id = ${businessId} AND sb.warehouse_id = ${warehouseId}
                AND sb.item_id = u.item_id AND sb.variant_id IS NOT DISTINCT FROM u.variant_id), 0)
            + CASE WHEN ${isDefault} THEN u.total - COALESCE((SELECT SUM(quantity::numeric) FROM stock_balances sb
              WHERE sb.business_id = ${businessId}
                AND sb.item_id = u.item_id AND sb.variant_id IS NOT DISTINCT FROM u.variant_id), 0)
              ELSE 0 END)::text AS available
    FROM units u
  `)) as unknown as Array<{ item_id: string; variant_id: string | null; available: string }>;
  for (const r of rows) result.set(unitKey(r.item_id, r.variant_id), round3(parseFloat(r.available)));
  return result;
}

type LoadedBom = {
  id: string;
  name: string;
  itemId: string;
  variantId: string | null;
  outputQuantity: string;
  isActive: boolean;
  components: Array<Unit & { quantity: string; wastagePercent: string; unit: string | null }>;
  byProducts: Array<Unit & { quantity: string }>;
};

async function loadBom(db: Tx, businessId: string, id: string): Promise<LoadedBom> {
  const [bom] = await db
    .select()
    .from(boms)
    .where(and(eq(boms.id, id), eq(boms.businessId, businessId)))
    .limit(1);
  if (!bom) throw new TRPCError({ code: "NOT_FOUND", message: "BOM not found" });
  const [components, byProducts] = await Promise.all([
    db.select().from(bomComponents).where(eq(bomComponents.bomId, id)).orderBy(bomComponents.sortOrder),
    db.select().from(bomByProducts).where(eq(bomByProducts.bomId, id)).orderBy(bomByProducts.sortOrder),
  ]);
  return {
    id: bom.id,
    name: bom.name,
    itemId: bom.itemId,
    variantId: bom.variantId,
    outputQuantity: bom.outputQuantity,
    isActive: bom.isActive,
    components: components.map((c: typeof bomComponents.$inferSelect) => ({
      itemId: c.itemId, variantId: c.variantId, quantity: c.quantity, wastagePercent: c.wastagePercent, unit: c.unit,
    })),
    byProducts: byProducts.map((b: typeof bomByProducts.$inferSelect) => ({
      itemId: b.itemId, variantId: b.variantId, quantity: b.quantity,
    })),
  };
}

/** The default active BOM for an item (or the most recently changed active one). */
async function defaultBomId(db: Tx, businessId: string, unit: Unit): Promise<string | null> {
  const [row] = await db
    .select({ id: boms.id })
    .from(boms)
    .where(and(
      eq(boms.businessId, businessId),
      eq(boms.itemId, unit.itemId),
      unit.variantId ? eq(boms.variantId, unit.variantId) : sql`${boms.variantId} IS NULL`,
      eq(boms.isActive, true),
    ))
    .orderBy(desc(boms.isDefault), desc(boms.updatedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Component and by-product quantities a BOM calls for to make `quantity`. */
function scaleBom(bom: LoadedBom, quantity: number) {
  const factor = quantity / parseFloat(bom.outputQuantity);
  return {
    components: bom.components.map((c) => ({
      itemId: c.itemId,
      variantId: c.variantId,
      quantity: round3(parseFloat(c.quantity) * factor * (1 + parseFloat(c.wastagePercent) / 100)),
    })),
    byProducts: bom.byProducts.map((b) => ({
      itemId: b.itemId,
      variantId: b.variantId,
      quantity: round3(parseFloat(b.quantity) * factor),
    })),
  };
}

/** Write a BOM's component and by-product rows (after clearing old ones). */
async function writeBomLines(tx: Tx, bomId: string, input: z.infer<typeof bomInput>, info: Map<string, UnitInfo>) {
  await tx.delete(bomComponents).where(eq(bomComponents.bomId, bomId));
  await tx.delete(bomByProducts).where(eq(bomByProducts.bomId, bomId));
  await tx.insert(bomComponents).values(input.components.map((c, i) => ({
    bomId,
    itemId: c.itemId,
    variantId: c.variantId ?? null,
    quantity: c.quantity,
    unit: info.get(keyOf(c))?.unit ?? null,
    wastagePercent: c.wastagePercent ?? "0",
    sortOrder: i,
  })));
  if (input.byProducts.length > 0) {
    await tx.insert(bomByProducts).values(input.byProducts.map((b, i) => ({
      bomId,
      itemId: b.itemId,
      variantId: b.variantId ?? null,
      quantity: b.quantity,
      sortOrder: i,
    })));
  }
}

/** Check a BOM's items and structure; returns names for its units. */
async function validateBom(tx: Tx, businessId: string, input: z.infer<typeof bomInput>, excludeBomId?: string) {
  const finished = { itemId: input.itemId, variantId: input.variantId ?? null };
  const components = input.components.map((c) => ({ itemId: c.itemId, variantId: c.variantId ?? null }));
  const byProducts = input.byProducts.map((b) => ({ itemId: b.itemId, variantId: b.variantId ?? null }));
  const info = await loadUnits(tx, businessId, [finished, ...components, ...byProducts]);
  assertNoDuplicates(components, info, "components");
  assertNoDuplicates(byProducts, info, "by-products");
  const target = keyOf(finished);
  if (byProducts.some((b) => keyOf(b) === target)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The finished item can't also be a by-product" });
  }
  const componentKeys = new Set(components.map(keyOf));
  const clash = byProducts.find((b) => componentKeys.has(keyOf(b)));
  if (clash) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${info.get(keyOf(clash))?.name} can't be both a component and a by-product` });
  }
  await assertNoCycle(tx, businessId, finished, components, info, excludeBomId);
  return info;
}

/** Only one default BOM per item: clear the flag on the others. */
async function makeOnlyDefault(tx: Tx, businessId: string, bomId: string, unit: Unit) {
  await tx
    .update(boms)
    .set({ isDefault: false })
    .where(and(
      eq(boms.businessId, businessId),
      eq(boms.itemId, unit.itemId),
      unit.variantId ? eq(boms.variantId, unit.variantId) : sql`${boms.variantId} IS NULL`,
      sql`${boms.id} <> ${bomId}`,
    ));
}

export const manufacturingRouter = router({
  /** Bills of material, optionally for one item. */
  boms: viewerProcedure
    .input(z.object({
      search: z.string().max(100).nullish(),
      itemId: z.string().uuid().nullish(),
      activeOnly: z.boolean().default(false),
      ...paginationSchema.shape,
    }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const offset = (input.page - 1) * input.limit;
      const like = input.search ? `%${escapeLike(input.search)}%` : null;
      const where = sql`
        b.business_id = ${ctx.businessId}
        ${input.itemId ? sql`AND b.item_id = ${input.itemId}` : sql``}
        ${input.activeOnly ? sql`AND b.is_active` : sql``}
        ${like ? sql`AND (b.name ILIKE ${like} OR i.name ILIKE ${like})` : sql``}
      `;
      const [data, [{ count }]] = await Promise.all([
        ctx.db.execute(sql`
          SELECT b.id, b.name, b.item_id AS "itemId", b.variant_id AS "variantId",
                 ${unitNameSql} AS "itemName", i.unit::text AS unit,
                 b.output_quantity::text AS "outputQuantity", b.is_default AS "isDefault", b.is_active AS "isActive",
                 (SELECT COUNT(*)::int FROM bom_components c WHERE c.bom_id = b.id) AS "componentCount",
                 (SELECT COUNT(*)::int FROM bom_by_products p WHERE p.bom_id = b.id) AS "byProductCount",
                 b.updated_at AS "updatedAt"
          FROM boms b
          JOIN items i ON i.id = b.item_id
          LEFT JOIN item_variants v ON v.id = b.variant_id
          WHERE ${where}
          ORDER BY i.name, b.is_default DESC, b.name
          LIMIT ${input.limit} OFFSET ${offset}
        `) as unknown as Promise<Array<{
          id: string; name: string; itemId: string; variantId: string | null; itemName: string; unit: string;
          outputQuantity: string; isDefault: boolean; isActive: boolean; componentCount: number; byProductCount: number;
          updatedAt: string;
        }>>,
        ctx.db.execute(sql`
          SELECT COUNT(*)::int AS count FROM boms b JOIN items i ON i.id = b.item_id WHERE ${where}
        `) as unknown as Promise<Array<{ count: number }>>,
      ]);
      return { data, total: count, page: input.page, limit: input.limit };
    }),

  /** One BOM with its components and by-products. */
  bom: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const [bom] = (await ctx.db.execute(sql`
        SELECT b.id, b.name, b.item_id AS "itemId", b.variant_id AS "variantId",
               ${unitNameSql} AS "itemName", i.unit::text AS unit,
               b.output_quantity::text AS "outputQuantity", b.is_default AS "isDefault", b.is_active AS "isActive",
               b.notes
        FROM boms b
        JOIN items i ON i.id = b.item_id
        LEFT JOIN item_variants v ON v.id = b.variant_id
        WHERE b.id = ${input.id} AND b.business_id = ${ctx.businessId}
      `)) as unknown as Array<{
        id: string; name: string; itemId: string; variantId: string | null; itemName: string; unit: string;
        outputQuantity: string; isDefault: boolean; isActive: boolean; notes: string | null;
      }>;
      if (!bom) throw new TRPCError({ code: "NOT_FOUND", message: "BOM not found" });
      const [components, byProducts] = await Promise.all([
        ctx.db.execute(sql`
          SELECT c.id, c.item_id AS "itemId", c.variant_id AS "variantId", ${unitNameSql} AS name,
                 i.unit::text AS unit, c.quantity::text AS quantity, c.wastage_percent::text AS "wastagePercent"
          FROM bom_components c
          JOIN items i ON i.id = c.item_id
          LEFT JOIN item_variants v ON v.id = c.variant_id
          WHERE c.bom_id = ${bom.id}
          ORDER BY c.sort_order
        `) as unknown as Promise<Array<{
          id: string; itemId: string; variantId: string | null; name: string; unit: string; quantity: string; wastagePercent: string;
        }>>,
        ctx.db.execute(sql`
          SELECT p.id, p.item_id AS "itemId", p.variant_id AS "variantId", ${unitNameSql} AS name,
                 i.unit::text AS unit, p.quantity::text AS quantity
          FROM bom_by_products p
          JOIN items i ON i.id = p.item_id
          LEFT JOIN item_variants v ON v.id = p.variant_id
          WHERE p.bom_id = ${bom.id}
          ORDER BY p.sort_order
        `) as unknown as Promise<Array<{
          id: string; itemId: string; variantId: string | null; name: string; unit: string; quantity: string;
        }>>,
      ]);
      return { ...bom, components, byProducts };
    }),

  bomCreate: memberProcedure
    .input(bomInput)
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      return ctx.db.transaction(async (tx: Tx) => {
        const info = await validateBom(tx, ctx.businessId, input);
        const unit = { itemId: input.itemId, variantId: input.variantId ?? null };
        // An item's first BOM is its default.
        const hasDefault = !!(await defaultBomId(tx, ctx.businessId, unit));
        const [bom] = await tx.insert(boms).values({
          businessId: ctx.businessId,
          itemId: input.itemId,
          variantId: input.variantId ?? null,
          name: input.name,
          outputQuantity: input.outputQuantity,
          isDefault: input.isDefault || (!hasDefault && input.isActive),
          isActive: input.isActive,
          notes: input.notes?.trim() || null,
        }).returning({ id: boms.id, isDefault: boms.isDefault });
        await writeBomLines(tx, bom.id, input, info);
        if (bom.isDefault) await makeOnlyDefault(tx, ctx.businessId, bom.id, unit);
        return { id: bom.id as string };
      });
    }),

  bomUpdate: memberProcedure
    .input(bomInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      return ctx.db.transaction(async (tx: Tx) => {
        const [existing] = await tx
          .select({ id: boms.id })
          .from(boms)
          .where(and(eq(boms.id, input.id), eq(boms.businessId, ctx.businessId)))
          .for("update")
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "BOM not found" });
        const info = await validateBom(tx, ctx.businessId, input, input.id);
        const unit = { itemId: input.itemId, variantId: input.variantId ?? null };
        await tx.update(boms).set({
          itemId: input.itemId,
          variantId: input.variantId ?? null,
          name: input.name,
          outputQuantity: input.outputQuantity,
          isDefault: input.isDefault && input.isActive,
          isActive: input.isActive,
          notes: input.notes?.trim() || null,
          updatedAt: new Date(),
        }).where(eq(boms.id, input.id));
        await writeBomLines(tx, input.id, input, info);
        if (input.isDefault && input.isActive) await makeOnlyDefault(tx, ctx.businessId, input.id, unit);
        return { id: input.id };
      });
    }),

  /** Delete a BOM. Journals made from it keep their own lines. */
  bomDelete: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      const deleted = await ctx.db
        .delete(boms)
        .where(and(eq(boms.id, input.id), eq(boms.businessId, ctx.businessId)))
        .returning({ id: boms.id });
      if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "BOM not found" });
      return { ok: true };
    }),

  /**
   * What a production run would use: the BOM's components scaled to the
   * quantity, with stock at the source warehouse and the current rate, so the
   * manufacture form can prefill and show shortages and cost before posting.
   * Without a BOM id, the item's default BOM is used (if it has one).
   */
  plan: viewerProcedure
    .input(z.object({
      bomId: z.string().uuid().nullish(),
      itemId: z.string().uuid().nullish(),
      variantId: z.string().uuid().nullish(),
      quantity: positiveQty,
      sourceWarehouseId: z.string().uuid().nullish(),
      /** Extra units to report stock and rates for (lines added by hand). */
      extra: z.array(unitRef).max(200).default([]),
    }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const produce = parseFloat(input.quantity);
      let bomId = input.bomId ?? null;
      if (!bomId && input.itemId) {
        bomId = await defaultBomId(ctx.db, ctx.businessId, { itemId: input.itemId, variantId: input.variantId ?? null });
      }
      const bom = bomId ? await loadBom(ctx.db, ctx.businessId, bomId) : null;
      const finished = bom
        ? { itemId: bom.itemId, variantId: bom.variantId }
        : input.itemId ? { itemId: input.itemId, variantId: input.variantId ?? null } : null;
      const scaled = bom ? scaleBom(bom, produce) : { components: [], byProducts: [] };
      const extra = input.extra
        .map((u) => ({ itemId: u.itemId, variantId: u.variantId ?? null, quantity: 0 }))
        .filter((u) => !scaled.components.some((c) => keyOf(c) === keyOf(u)));

      const all = [...scaled.components, ...extra, ...scaled.byProducts];
      const info = await loadUnits(ctx.db, ctx.businessId, finished ? [finished, ...all] : all);
      const [available, valuation] = await Promise.all([
        input.sourceWarehouseId
          ? availableAt(ctx.db, ctx.businessId, input.sourceWarehouseId, [...scaled.components, ...extra])
          : Promise.resolve(new Map<string, number>()),
        valueStock(ctx.db, ctx.businessId, new Date()),
      ]);

      const describe = (u: Unit & { quantity: number }) => {
        const k = keyOf(u);
        const rate = valuation.units.get(k)?.rate ?? 0;
        return {
          itemId: u.itemId,
          variantId: u.variantId,
          name: info.get(k)?.name ?? "",
          unit: info.get(k)?.unit ?? "",
          standardQuantity: qty3(u.quantity),
          available: input.sourceWarehouseId ? qty3(available.get(k) ?? 0) : null,
          rate: rate.toFixed(2),
          amount: round2(u.quantity * rate).toFixed(2),
        };
      };
      const components = scaled.components.map(describe);
      return {
        bom: bom ? { id: bom.id, name: bom.name, outputQuantity: bom.outputQuantity, isActive: bom.isActive } : null,
        finished: finished ? { ...finished, name: info.get(keyOf(finished))!.name, unit: info.get(keyOf(finished))!.unit } : null,
        components,
        extra: extra.map(describe),
        byProducts: scaled.byProducts.map((b) => ({
          itemId: b.itemId,
          variantId: b.variantId,
          name: info.get(keyOf(b))?.name ?? "",
          unit: info.get(keyOf(b))?.unit ?? "",
          standardQuantity: qty3(b.quantity),
        })),
        componentsCost: components.reduce((s, c) => s + parseFloat(c.amount), 0).toFixed(2),
      };
    }),

  /**
   * Post a manufacturing journal. Component quantities default to the BOM
   * scaled to the quantity made (plus wastage); pass `components` to record
   * what was actually used instead. Everything happens in one transaction.
   */
  manufacture: memberProcedure
    .input(z.object({
      bomId: z.string().uuid().nullish(),
      itemId: z.string().uuid().nullish(),
      variantId: z.string().uuid().nullish(),
      quantity: positiveQty,
      date: z.string().datetime().optional(),
      sourceWarehouseId: z.string().uuid(),
      destinationWarehouseId: z.string().uuid(),
      components: z.array(unitRef.extend({ quantity })).max(200).optional(),
      byProducts: z.array(unitRef.extend({ quantity })).max(50).optional(),
      additionalCosts: z.array(z.object({
        label: z.string().trim().min(1, "Name the cost").max(100),
        amount: money,
      })).max(20).default([]),
      notes: z.string().max(1000).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      const produce = parseFloat(input.quantity);
      const date = input.date ? new Date(input.date) : new Date();

      return ctx.db.transaction(async (tx: Tx) => {
        const bom = input.bomId ? await loadBom(tx, ctx.businessId, input.bomId) : null;
        if (bom && !bom.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "This BOM is inactive" });
        if (bom && input.itemId && (input.itemId !== bom.itemId || (input.variantId ?? null) !== bom.variantId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That BOM is for a different item" });
        }
        const finished: Unit | null = bom
          ? { itemId: bom.itemId, variantId: bom.variantId }
          : input.itemId ? { itemId: input.itemId, variantId: input.variantId ?? null } : null;
        if (!finished) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a BOM or the item to make" });

        const standard = bom ? scaleBom(bom, produce) : { components: [], byProducts: [] };
        const standardBy = new Map([...standard.components, ...standard.byProducts].map((l) => [keyOf(l), l.quantity]));
        const toLines = (lines: Array<{ itemId: string; variantId?: string | null; quantity: string | number }>) =>
          lines
            .map((l) => ({ itemId: l.itemId, variantId: l.variantId ?? null, quantity: round3(Number(l.quantity)) }))
            .filter((l) => l.quantity > 0);
        const components = toLines(input.components ?? standard.components);
        const byProducts = toLines(input.byProducts ?? standard.byProducts);
        if (components.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Add the components used" });

        const info = await loadUnits(tx, ctx.businessId, [finished, ...components, ...byProducts]);
        assertNoDuplicates(components, info, "components");
        assertNoDuplicates(byProducts, info, "by-products");
        const target = keyOf(finished);
        if (components.some((c) => keyOf(c) === target) || byProducts.some((b) => keyOf(b) === target)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${info.get(target)!.name} can't be used to make itself` });
        }

        const warehouseIds = [...new Set([input.sourceWarehouseId, input.destinationWarehouseId])];
        await assertWarehouses(tx, ctx.businessId, warehouseIds);
        await assertWarehousePermission(tx, ctx, warehouseIds, "canAdjust");

        // One journal at a time per business, so numbers don't collide.
        await ensureDefaultWarehouse(tx, ctx.businessId);
        await tx.select({ id: inventorySettings.id }).from(inventorySettings)
          .where(eq(inventorySettings.businessId, ctx.businessId)).for("update");

        // Place unplaced stock (this also locks the items), then check stock.
        for (const c of components) await placeUnplacedStock(tx, ctx.businessId, c.itemId, c.variantId);
        if ((await getNegativeStockPolicy(tx, ctx.businessId)) === "block") {
          const short: string[] = [];
          for (const c of components) {
            const have = await warehouseBalance(tx, ctx.businessId, input.sourceWarehouseId, c.itemId, c.variantId);
            if (have - c.quantity < -0.0005) {
              const u = info.get(keyOf(c))!;
              short.push(`${u.name}: ${trimQty(Math.max(have, 0))} ${u.unit} available, ${trimQty(c.quantity)} needed`);
            }
          }
          if (short.length > 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Not enough stock — ${short.join("; ")}` });
          }
        }

        // Components at their current valuation rate, taken before they move.
        const valuation = await valueStock(tx, ctx.businessId, new Date(Math.max(date.getTime(), Date.now())));
        const costed = components.map((c) => {
          const rate = valuation.units.get(keyOf(c))?.rate ?? 0;
          return { ...c, rate, amount: round2(c.quantity * rate) };
        });
        const componentsCost = round2(costed.reduce((s, c) => s + c.amount, 0));
        const additionalTotal = round2(input.additionalCosts.reduce((s, a) => s + parseFloat(a.amount), 0));
        const totalCost = round2(componentsCost + additionalTotal);
        const unitCost = totalCost / produce;

        const [{ count }] = (await tx.execute(sql`
          SELECT COUNT(*)::int AS count FROM manufacturing_journals WHERE business_id = ${ctx.businessId}
        `)) as unknown as Array<{ count: number }>;
        const journalNumber = `MJ-${count + 1}`;

        const [journal] = await tx.insert(manufacturingJournals).values({
          businessId: ctx.businessId,
          journalNumber,
          journalDate: date,
          bomId: bom?.id ?? null,
          itemId: finished.itemId,
          variantId: finished.variantId,
          quantity: qty3(produce),
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          componentsCost: componentsCost.toFixed(2),
          additionalCosts: input.additionalCosts.map((a) => ({ label: a.label, amount: parseFloat(a.amount).toFixed(2) })),
          additionalCostTotal: additionalTotal.toFixed(2),
          totalCost: totalCost.toFixed(2),
          unitCost: unitCost.toFixed(4),
          notes: input.notes?.trim() || null,
          createdByUserId: ctx.user.id,
          createdByName: ctx.user.name,
        }).returning({ id: manufacturingJournals.id });

        await tx.insert(manufacturingJournalLines).values([
          ...costed.map((c, i) => ({
            journalId: journal.id,
            kind: "component",
            itemId: c.itemId,
            variantId: c.variantId,
            standardQuantity: standardBy.has(keyOf(c)) ? qty3(standardBy.get(keyOf(c))!) : null,
            quantity: qty3(c.quantity),
            unitCost: c.rate.toFixed(4),
            amount: c.amount.toFixed(2),
            sortOrder: i,
          })),
          ...byProducts.map((b, i) => ({
            journalId: journal.id,
            kind: "by_product",
            itemId: b.itemId,
            variantId: b.variantId,
            standardQuantity: standardBy.has(keyOf(b)) ? qty3(standardBy.get(keyOf(b))!) : null,
            quantity: qty3(b.quantity),
            sortOrder: i,
          })),
        ]);

        const common = {
          businessId: ctx.businessId,
          referenceType: "MANUFACTURING",
          referenceId: journal.id,
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          movementDate: date,
          actorUserId: ctx.user.id,
        };
        for (const c of costed) {
          await recordStockMovement(tx, {
            ...common,
            warehouseId: input.sourceWarehouseId,
            itemId: c.itemId,
            variantId: c.variantId,
            movementType: "CONSUMPTION",
            quantity: qty3(-c.quantity),
            unitCost: c.rate.toFixed(2),
          });
        }
        await recordStockMovement(tx, {
          ...common,
          warehouseId: input.destinationWarehouseId,
          itemId: finished.itemId,
          variantId: finished.variantId,
          movementType: "PRODUCTION",
          quantity: qty3(produce),
          unitCost: unitCost.toFixed(2),
        });
        for (const b of byProducts) {
          await recordStockMovement(tx, {
            ...common,
            warehouseId: input.destinationWarehouseId,
            itemId: b.itemId,
            variantId: b.variantId,
            movementType: "BY_PRODUCT",
            quantity: qty3(b.quantity),
          });
        }

        return {
          id: journal.id as string,
          journalNumber,
          componentsCost: componentsCost.toFixed(2),
          totalCost: totalCost.toFixed(2),
          unitCost: unitCost.toFixed(4),
        };
      });
    }),

  /** Manufacturing journals, newest first. */
  journals: viewerProcedure
    .input(z.object({ ...paginationSchema.shape }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const offset = (input.page - 1) * input.limit;
      const [data, [{ count }], [settings]] = await Promise.all([
        ctx.db.execute(sql`
          SELECT j.id, j.journal_number AS "journalNumber", j.journal_date AS date, j.status,
                 j.item_id AS "itemId", j.variant_id AS "variantId", ${unitNameSql} AS "itemName", i.unit::text AS unit,
                 j.quantity::text AS quantity, j.total_cost::text AS "totalCost", j.unit_cost::text AS "unitCost",
                 sw.name AS "sourceName", dw.name AS "destinationName", b.name AS "bomName",
                 (SELECT COUNT(*)::int FROM manufacturing_journal_lines l WHERE l.journal_id = j.id AND l.kind = 'component') AS "componentCount"
          FROM manufacturing_journals j
          JOIN items i ON i.id = j.item_id
          LEFT JOIN item_variants v ON v.id = j.variant_id
          JOIN warehouses sw ON sw.id = j.source_warehouse_id
          JOIN warehouses dw ON dw.id = j.destination_warehouse_id
          LEFT JOIN boms b ON b.id = j.bom_id
          WHERE j.business_id = ${ctx.businessId}
          ORDER BY j.journal_date DESC, j.created_at DESC
          LIMIT ${input.limit} OFFSET ${offset}
        `) as unknown as Promise<Array<{
          id: string; journalNumber: string; date: string; status: string; itemId: string; variantId: string | null;
          itemName: string; unit: string; quantity: string; totalCost: string; unitCost: string;
          sourceName: string; destinationName: string; bomName: string | null; componentCount: number;
        }>>,
        ctx.db.execute(sql`
          SELECT COUNT(*)::int AS count FROM manufacturing_journals WHERE business_id = ${ctx.businessId}
        `) as unknown as Promise<Array<{ count: number }>>,
        ctx.db
          .select({ productionWarehouseId: inventorySettings.productionWarehouseId })
          .from(inventorySettings)
          .where(eq(inventorySettings.businessId, ctx.businessId))
          .limit(1) as Promise<Array<{ productionWarehouseId: string | null }>>,
      ]);
      return {
        data,
        total: count,
        page: input.page,
        limit: input.limit,
        /** Where manufacturing happens by default (inventory settings). */
        productionWarehouseId: settings?.productionWarehouseId ?? null,
      };
    }),

  /** One journal with its component and by-product lines. */
  journal: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const [journal] = (await ctx.db.execute(sql`
        SELECT j.id, j.journal_number AS "journalNumber", j.journal_date AS date, j.status,
               j.bom_id AS "bomId", b.name AS "bomName",
               j.item_id AS "itemId", j.variant_id AS "variantId", ${unitNameSql} AS "itemName", i.unit::text AS unit,
               j.quantity::text AS quantity,
               j.source_warehouse_id AS "sourceWarehouseId", sw.name AS "sourceName",
               j.destination_warehouse_id AS "destinationWarehouseId", dw.name AS "destinationName",
               j.components_cost::text AS "componentsCost", j.additional_costs AS "additionalCosts",
               j.additional_cost_total::text AS "additionalCostTotal", j.total_cost::text AS "totalCost",
               j.unit_cost::text AS "unitCost", j.notes, j.created_by_name AS "createdByName",
               j.cancelled_at AS "cancelledAt"
        FROM manufacturing_journals j
        JOIN items i ON i.id = j.item_id
        LEFT JOIN item_variants v ON v.id = j.variant_id
        JOIN warehouses sw ON sw.id = j.source_warehouse_id
        JOIN warehouses dw ON dw.id = j.destination_warehouse_id
        LEFT JOIN boms b ON b.id = j.bom_id
        WHERE j.id = ${input.id} AND j.business_id = ${ctx.businessId}
      `)) as unknown as Array<{
        id: string; journalNumber: string; date: string; status: string; bomId: string | null; bomName: string | null;
        itemId: string; variantId: string | null; itemName: string; unit: string; quantity: string;
        sourceWarehouseId: string; sourceName: string; destinationWarehouseId: string; destinationName: string;
        componentsCost: string; additionalCosts: Array<{ label: string; amount: string }>; additionalCostTotal: string;
        totalCost: string; unitCost: string; notes: string | null; createdByName: string | null; cancelledAt: string | null;
      }>;
      if (!journal) throw new TRPCError({ code: "NOT_FOUND", message: "Manufacturing journal not found" });
      const lines = (await ctx.db.execute(sql`
        SELECT l.id, l.kind, l.item_id AS "itemId", l.variant_id AS "variantId", ${unitNameSql} AS name,
               i.unit::text AS unit, l.standard_quantity::text AS "standardQuantity", l.quantity::text AS quantity,
               l.unit_cost::text AS "unitCost", l.amount::text AS amount
        FROM manufacturing_journal_lines l
        JOIN items i ON i.id = l.item_id
        LEFT JOIN item_variants v ON v.id = l.variant_id
        WHERE l.journal_id = ${journal.id}
        ORDER BY l.kind DESC, l.sort_order
      `)) as unknown as Array<{
        id: string; kind: string; itemId: string; variantId: string | null; name: string; unit: string;
        standardQuantity: string | null; quantity: string; unitCost: string; amount: string;
      }>;
      return {
        ...journal,
        components: lines.filter((l) => l.kind === "component"),
        byProducts: lines.filter((l) => l.kind === "by_product"),
      };
    }),

  /**
   * Cancel a journal: components go back to the source warehouse and the
   * finished goods and by-products come out of the destination. Under the
   * "block" policy this is refused if the made goods have already gone.
   */
  cancel: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      return ctx.db.transaction(async (tx: Tx) => {
        const [journal] = await tx
          .select()
          .from(manufacturingJournals)
          .where(and(eq(manufacturingJournals.id, input.id), eq(manufacturingJournals.businessId, ctx.businessId)))
          .for("update")
          .limit(1);
        if (!journal) throw new TRPCError({ code: "NOT_FOUND", message: "Manufacturing journal not found" });
        if (journal.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This journal is already cancelled" });
        }
        const warehouseIds = [...new Set([journal.sourceWarehouseId, journal.destinationWarehouseId])] as string[];
        await assertWarehouses(tx, ctx.businessId, warehouseIds);
        await assertWarehousePermission(tx, ctx, warehouseIds, "canAdjust");

        const held = (await tx.execute(sql`
          SELECT warehouse_id, item_id, variant_id, movement_type, SUM(quantity::numeric)::text AS qty
          FROM stock_movements
          WHERE business_id = ${ctx.businessId} AND reference_id = ${journal.id}
            AND reference_type = 'MANUFACTURING'
          GROUP BY 1, 2, 3, 4
        `)) as unknown as Array<{ warehouse_id: string; item_id: string; variant_id: string | null; movement_type: string; qty: string }>;

        const outgoing = held.filter((h) => parseFloat(h.qty) > 0);
        for (const h of outgoing) await placeUnplacedStock(tx, ctx.businessId, h.item_id, h.variant_id);
        if (outgoing.length > 0 && (await getNegativeStockPolicy(tx, ctx.businessId)) === "block") {
          const info = await loadUnits(tx, ctx.businessId, outgoing.map((h) => ({ itemId: h.item_id, variantId: h.variant_id })))
            .catch(() => new Map<string, UnitInfo>());
          const short: string[] = [];
          for (const h of outgoing) {
            const have = await warehouseBalance(tx, ctx.businessId, h.warehouse_id, h.item_id, h.variant_id);
            const need = parseFloat(h.qty);
            if (have - need < -0.0005) {
              const u = info.get(unitKey(h.item_id, h.variant_id));
              const unit = u ? ` ${u.unit}` : "";
              short.push(`${u?.name ?? "An item"}: ${trimQty(Math.max(have, 0))}${unit} available, ${trimQty(need)} needed`);
            }
          }
          if (short.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Can't cancel — the goods made have already moved on. ${short.join("; ")}`,
            });
          }
        }

        const date = new Date();
        for (const h of held) {
          if (Math.abs(parseFloat(h.qty)) < 0.0005) continue;
          await recordStockMovement(tx, {
            businessId: ctx.businessId,
            warehouseId: h.warehouse_id,
            itemId: h.item_id,
            variantId: h.variant_id,
            sourceWarehouseId: journal.sourceWarehouseId,
            destinationWarehouseId: journal.destinationWarehouseId,
            referenceType: "MANUFACTURING_CANCEL",
            referenceId: journal.id,
            movementType: `${h.movement_type}_REVERSAL`,
            quantity: qty3(-parseFloat(h.qty)),
            movementDate: date,
            actorUserId: ctx.user.id,
          });
        }
        await tx.update(manufacturingJournals).set({
          status: "cancelled",
          cancelledAt: date,
          cancelledByUserId: ctx.user.id,
          updatedAt: date,
        }).where(eq(manufacturingJournals.id, journal.id));
        return { id: journal.id as string };
      });
    }),
});
