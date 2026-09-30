/**
 * Warehouse stock: balances per warehouse, the stock transfer journal, stock
 * adjustments and physical stock verification.
 *
 * Stock has two layers. items/item_variants.stock_quantity is the business-wide
 * total every other screen reads. stock_balances splits it by warehouse. Every
 * write path records a movement that updates both, but data from before
 * warehouses existed can leave stock that no warehouse accounts for
 * ("unplaced"). It is treated as sitting in the default warehouse: read paths
 * add it there, and write paths move it there for real before touching a
 * balance, so the two layers stay consistent.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  businessMembers,
  inventorySettings,
  stockAdjustments,
  warehousePermissions,
  warehouses,
} from "@fintranzact/db";
import { paginationSchema } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import {
  ensureDefaultWarehouse,
  getNegativeStockPolicy,
  placeUnplacedStock,
  recordStockMovement,
  warehouseBalance,
} from "../lib/inventory-service.js";
import { escapeLike } from "../lib/escape-like.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const quantityString = z
  .string()
  .regex(/^-?\d+(\.\d{1,3})?$/, "Quantity can have up to 3 decimals");

const lineKey = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
});

/** Roles that manage stock in every warehouse without per-warehouse grants. */
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

const PHYSICAL_REASON = "Physical stock verification";

function qty(n: number) {
  return n.toFixed(3);
}

async function assertWarehouses(tx: Tx, businessId: string, ids: string[]) {
  const rows = await tx
    .select({ id: warehouses.id, status: warehouses.status })
    .from(warehouses)
    .where(and(eq(warehouses.businessId, businessId), sql`${warehouses.id} IN ${ids}`));
  if (rows.length !== new Set(ids).size) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found" });
  }
  if (rows.some((r: { status: string }) => r.status !== "active")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That warehouse is inactive" });
  }
}

/** Non-admin members need an explicit per-warehouse grant. */
async function assertWarehousePermission(
  tx: Tx,
  ctx: { businessId: string; role: string; user: { id: string } },
  warehouseIds: string[],
  permission: "canTransfer" | "canAdjust",
) {
  if (ADMIN_ROLES.has(ctx.role)) return;
  const [member] = await tx
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.userId, ctx.user.id)))
    .limit(1);
  const grants = member
    ? await tx
        .select({ warehouseId: warehousePermissions.warehouseId, allowed: warehousePermissions[permission] })
        .from(warehousePermissions)
        .where(and(eq(warehousePermissions.businessMemberId, member.id), sql`${warehousePermissions.warehouseId} IN ${warehouseIds}`))
    : [];
  const allowed = new Set(grants.filter((g: { allowed: boolean }) => g.allowed).map((g: { warehouseId: string }) => g.warehouseId));
  if (!warehouseIds.every((id) => allowed.has(id))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: permission === "canTransfer"
        ? "You don't have transfer permission for these warehouses"
        : "You don't have adjustment permission for this warehouse",
    });
  }
}

/**
 * Change stock at one warehouse and record it as a stock adjustment.
 * Keeps the item total, the warehouse balance and the adjustment log in step.
 */
export async function applyStockAdjustment(
  tx: Tx,
  input: {
    businessId: string;
    warehouseId: string;
    itemId: string;
    variantId?: string | null;
    quantity: number; // signed
    reason: string | null;
    date: Date;
    user: { id: string; name: string | null };
    referenceType?: "STOCK_ADJUSTMENT" | "PHYSICAL_STOCK";
    /** Refuse to take the warehouse below zero. */
    enforceWarehouseBalance?: boolean;
  },
) {
  const previousTotal = await placeUnplacedStock(tx, input.businessId, input.itemId, input.variantId);

  if (input.enforceWarehouseBalance && input.quantity < 0) {
    const available = await warehouseBalance(tx, input.businessId, input.warehouseId, input.itemId, input.variantId);
    if (available + input.quantity < -0.0005) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Only ${available} in stock at this warehouse`,
      });
    }
  }

  const [adjustment] = await tx.insert(stockAdjustments).values({
    businessId: input.businessId,
    itemId: input.itemId,
    variantId: input.variantId ?? null,
    quantity: qty(input.quantity),
    previousStock: qty(previousTotal),
    newStock: qty(previousTotal + input.quantity),
    reason: input.reason,
    adjustmentDate: input.date,
    createdByUserId: input.user.id,
    createdByName: input.user.name,
  }).returning();

  // Updates the warehouse balance and the item total together.
  await recordStockMovement(tx, {
    businessId: input.businessId,
    warehouseId: input.warehouseId,
    itemId: input.itemId,
    variantId: input.variantId ?? undefined,
    referenceType: input.referenceType ?? "STOCK_ADJUSTMENT",
    referenceId: adjustment.id,
    movementType: "ADJUSTMENT",
    quantity: qty(input.quantity),
    movementDate: input.date,
    actorUserId: input.user.id,
  });

  return adjustment;
}

/** Stock units: simple items, plus one unit per variant for variant items. */
function stockUnitsSql(businessId: string, search?: string | null) {
  const like = search ? `%${escapeLike(search)}%` : null;
  return sql`
    WITH units AS (
      SELECT i.id AS item_id, NULL::uuid AS variant_id, i.name AS name, i.sku, i.unit::text AS unit,
             i.stock_quantity::numeric AS total, i.low_stock_alert::numeric AS low_stock
      FROM items i
      WHERE i.business_id = ${businessId} AND i.deleted_at IS NULL
        AND i.item_type = 'product' AND i.item_mode <> 'variants'
      UNION ALL
      SELECT i.id, v.id,
             i.name || ' — ' || COALESCE((SELECT string_agg(value, ' / ') FROM jsonb_each_text(v.attribute_values)), 'Variant'),
             COALESCE(v.sku, i.sku), i.unit::text, v.stock_quantity::numeric, v.low_stock_alert::numeric
      FROM item_variants v
      JOIN items i ON i.id = v.item_id
      WHERE i.business_id = ${businessId} AND i.deleted_at IS NULL AND v.deleted_at IS NULL
        AND i.item_type = 'product'
    )
    SELECT * FROM units
    ${like ? sql`WHERE name ILIKE ${like} OR sku ILIKE ${like}` : sql``}
  `;
}

export const stockRouter = router({
  /** Create the default "Main" premise + warehouse if the business has none yet. */
  setup: memberProcedure.mutation(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    await ctx.db.transaction((tx: Tx) => ensureDefaultWarehouse(tx, ctx.businessId));
    return { ok: true };
  }),

  /** Warehouses with how much stock each holds. */
  warehouses: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    const [settings] = await ctx.db
      .select({ defaultId: inventorySettings.salesWarehouseId })
      .from(inventorySettings)
      .where(eq(inventorySettings.businessId, ctx.businessId))
      .limit(1);

    const rows = (await ctx.db.execute(sql`
      SELECT w.id, w.name, w.code, w.warehouse_type AS "warehouseType", w.address, w.status,
             p.name AS "premiseName",
             COALESCE(b.units, 0)::int AS units,
             COALESCE(b.qty, 0)::text AS quantity
      FROM warehouses w
      LEFT JOIN premises p ON p.id = w.premise_id
      LEFT JOIN (
        SELECT warehouse_id, COUNT(*) FILTER (WHERE quantity::numeric <> 0) AS units, SUM(quantity::numeric) AS qty
        FROM stock_balances WHERE business_id = ${ctx.businessId}
        GROUP BY warehouse_id
      ) b ON b.warehouse_id = w.id
      WHERE w.business_id = ${ctx.businessId}
      ORDER BY w.name
    `)) as unknown as Array<{
      id: string; name: string; code: string; warehouseType: string; address: string | null;
      status: string; premiseName: string | null; units: number; quantity: string;
    }>;

    // Stock no warehouse accounts for yet belongs to the default warehouse.
    const [unplaced] = (await ctx.db.execute(sql`
      WITH units AS (${stockUnitsSql(ctx.businessId)}),
      placed AS (
        SELECT item_id, variant_id, SUM(quantity::numeric) AS qty
        FROM stock_balances WHERE business_id = ${ctx.businessId}
        GROUP BY item_id, variant_id
      )
      SELECT COALESCE(SUM(u.total - COALESCE(p.qty, 0)), 0)::text AS qty,
             COUNT(*) FILTER (WHERE u.total - COALESCE(p.qty, 0) <> 0)::int AS units
      FROM units u
      LEFT JOIN placed p ON p.item_id = u.item_id AND p.variant_id IS NOT DISTINCT FROM u.variant_id
    `)) as unknown as Array<{ qty: string; units: number }>;

    const defaultId = settings?.defaultId ?? rows.find((r) => r.status === "active")?.id ?? null;
    return rows.map((r) => {
      const extra = r.id === defaultId ? parseFloat(unplaced?.qty ?? "0") : 0;
      return {
        ...r,
        isDefault: r.id === defaultId,
        quantity: qty(parseFloat(r.quantity) + extra),
      };
    });
  }),

  /** Stock per item, split by warehouse. */
  balances: viewerProcedure
    .input(z.object({ search: z.string().max(100).nullish(), ...paginationSchema.shape }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const offset = (input.page - 1) * input.limit;
      const [settings] = await ctx.db
        .select({ defaultId: inventorySettings.salesWarehouseId })
        .from(inventorySettings)
        .where(eq(inventorySettings.businessId, ctx.businessId))
        .limit(1);

      const [page, [{ count }]] = await Promise.all([
        ctx.db.execute(sql`
          WITH units AS (${stockUnitsSql(ctx.businessId, input.search)})
          SELECT u.item_id AS "itemId", u.variant_id AS "variantId", u.name, u.sku, u.unit,
                 u.total::text AS total, u.low_stock::text AS "lowStock",
                 COALESCE((
                   SELECT json_object_agg(b.warehouse_id, b.qty)
                   FROM (
                     SELECT warehouse_id, SUM(quantity::numeric)::text AS qty
                     FROM stock_balances sb
                     WHERE sb.business_id = ${ctx.businessId} AND sb.item_id = u.item_id
                       AND sb.variant_id IS NOT DISTINCT FROM u.variant_id
                     GROUP BY warehouse_id
                   ) b
                 ), '{}'::json) AS "byWarehouse"
          FROM units u
          ORDER BY u.name
          LIMIT ${input.limit} OFFSET ${offset}
        `) as unknown as Promise<Array<{
          itemId: string; variantId: string | null; name: string; sku: string | null; unit: string;
          total: string; lowStock: string | null; byWarehouse: Record<string, string>;
        }>>,
        ctx.db.execute(sql`
          WITH units AS (${stockUnitsSql(ctx.businessId, input.search)})
          SELECT COUNT(*)::int AS count FROM units
        `) as unknown as Promise<Array<{ count: number }>>,
      ]);

      const defaultId = settings?.defaultId ?? null;
      const data = page.map((r) => {
        const byWarehouse: Record<string, string> = { ...r.byWarehouse };
        const placed = Object.values(byWarehouse).reduce((s, v) => s + parseFloat(v), 0);
        const unplaced = parseFloat(r.total) - placed;
        if (defaultId && Math.abs(unplaced) >= 0.0005) {
          byWarehouse[defaultId] = qty(parseFloat(byWarehouse[defaultId] ?? "0") + unplaced);
        }
        return { ...r, byWarehouse };
      });
      return { data, total: count, page: input.page, limit: input.limit, defaultWarehouseId: defaultId };
    }),

  /** Move stock between two warehouses. One transfer can carry many lines. */
  transfer: memberProcedure
    .input(z.object({
      sourceWarehouseId: z.string().uuid(),
      destinationWarehouseId: z.string().uuid(),
      date: z.string().datetime().optional(),
      lines: z.array(lineKey.extend({ quantity: quantityString })).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      if (input.sourceWarehouseId === input.destinationWarehouseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick two different warehouses" });
      }
      const ids = [input.sourceWarehouseId, input.destinationWarehouseId];
      const date = input.date ? new Date(input.date) : new Date();

      return ctx.db.transaction(async (tx: Tx) => {
        await assertWarehouses(tx, ctx.businessId, ids);
        await assertWarehousePermission(tx, ctx, ids, "canTransfer");
        const referenceId = crypto.randomUUID();

        for (const line of input.lines) {
          const amount = parseFloat(line.quantity);
          if (!(amount > 0)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer quantities must be more than zero" });
          }
          await placeUnplacedStock(tx, ctx.businessId, line.itemId, line.variantId);
          const available = await warehouseBalance(tx, ctx.businessId, input.sourceWarehouseId, line.itemId, line.variantId);
          if (available < amount - 0.0005) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Not enough stock to transfer: ${available} available` });
          }
          const common = {
            businessId: ctx.businessId,
            itemId: line.itemId,
            variantId: line.variantId ?? undefined,
            sourceWarehouseId: input.sourceWarehouseId,
            destinationWarehouseId: input.destinationWarehouseId,
            referenceType: "STOCK_TRANSFER",
            referenceId,
            movementDate: date,
            actorUserId: ctx.user.id,
          };
          await recordStockMovement(tx, { ...common, warehouseId: input.sourceWarehouseId, movementType: "TRANSFER_OUT", quantity: qty(-amount) });
          await recordStockMovement(tx, { ...common, warehouseId: input.destinationWarehouseId, movementType: "TRANSFER_IN", quantity: qty(amount) });
        }
        return { referenceId };
      });
    }),

  /** The stock transfer journal, newest first. */
  transfers: viewerProcedure
    .input(z.object({ ...paginationSchema.shape }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const offset = (input.page - 1) * input.limit;
      const [data, [{ count }]] = await Promise.all([
        ctx.db.execute(sql`
          SELECT m.reference_id AS "referenceId",
                 MIN(m.movement_date) AS date,
                 m.warehouse_id AS "sourceWarehouseId",
                 sw.name AS "sourceName",
                 dw.id AS "destinationWarehouseId",
                 dw.name AS "destinationName",
                 COUNT(*)::int AS "lineCount",
                 SUM(-m.quantity::numeric)::text AS "totalQuantity",
                 json_agg(json_build_object(
                   'name', i.name || COALESCE(' — ' || (SELECT string_agg(value, ' / ') FROM jsonb_each_text(v.attribute_values)), ''),
                   'unit', i.unit,
                   'quantity', (-m.quantity::numeric)::text
                 ) ORDER BY i.name) AS lines
          FROM stock_movements m
          JOIN items i ON i.id = m.item_id
          LEFT JOIN item_variants v ON v.id = m.variant_id
          JOIN warehouses sw ON sw.id = m.warehouse_id
          LEFT JOIN warehouses dw ON dw.id = COALESCE(m.destination_warehouse_id, (
            SELECT x.warehouse_id FROM stock_movements x
            WHERE x.reference_id = m.reference_id AND x.movement_type = 'TRANSFER_IN' LIMIT 1
          ))
          WHERE m.business_id = ${ctx.businessId}
            AND m.reference_type = 'STOCK_TRANSFER' AND m.movement_type = 'TRANSFER_OUT'
          GROUP BY m.reference_id, m.warehouse_id, sw.name, dw.id, dw.name
          ORDER BY date DESC
          LIMIT ${input.limit} OFFSET ${offset}
        `) as unknown as Promise<Array<{
          referenceId: string; date: string; sourceWarehouseId: string; sourceName: string;
          destinationWarehouseId: string | null; destinationName: string | null; lineCount: number;
          totalQuantity: string; lines: Array<{ name: string; unit: string; quantity: string }>;
        }>>,
        ctx.db.execute(sql`
          SELECT COUNT(DISTINCT reference_id)::int AS count FROM stock_movements
          WHERE business_id = ${ctx.businessId} AND reference_type = 'STOCK_TRANSFER' AND movement_type = 'TRANSFER_OUT'
        `) as unknown as Promise<Array<{ count: number }>>,
      ]);
      return { data, total: count, page: input.page, limit: input.limit };
    }),

  /** Add or remove stock at a warehouse, with a reason. */
  adjust: memberProcedure
    .input(z.object({
      warehouseId: z.string().uuid(),
      date: z.string().datetime().optional(),
      reason: z.string().min(1, "Give a reason").max(500),
      lines: z.array(lineKey.extend({
        quantity: quantityString.refine((v) => parseFloat(v) !== 0, "Quantity cannot be zero"),
      })).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      const date = input.date ? new Date(input.date) : new Date();
      return ctx.db.transaction(async (tx: Tx) => {
        await assertWarehouses(tx, ctx.businessId, [input.warehouseId]);
        await assertWarehousePermission(tx, ctx, [input.warehouseId], "canAdjust");
        for (const line of input.lines) {
          await applyStockAdjustment(tx, {
            businessId: ctx.businessId,
            warehouseId: input.warehouseId,
            itemId: line.itemId,
            variantId: line.variantId,
            quantity: parseFloat(line.quantity),
            reason: input.reason,
            date,
            user: { id: ctx.user.id, name: ctx.user.name },
            enforceWarehouseBalance: true,
          });
        }
        return { count: input.lines.length };
      });
    }),

  /** Adjustment log across all items; `kind` narrows to physical counts. */
  adjustments: viewerProcedure
    .input(z.object({ kind: z.enum(["all", "physical"]).default("all"), ...paginationSchema.shape }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const offset = (input.page - 1) * input.limit;
      const kindFilter = input.kind === "physical" ? sql`AND m.reference_type = 'PHYSICAL_STOCK'` : sql``;
      const [data, [{ count }]] = await Promise.all([
        ctx.db.execute(sql`
          SELECT a.id, a.adjustment_date AS date, a.quantity::text AS quantity,
                 a.previous_stock::text AS "previousStock", a.new_stock::text AS "newStock",
                 a.reason, a.created_by_name AS "createdByName",
                 i.name || COALESCE(' — ' || (SELECT string_agg(value, ' / ') FROM jsonb_each_text(v.attribute_values)), '') AS "itemName",
                 i.unit, w.name AS "warehouseName",
                 COALESCE(m.reference_type = 'PHYSICAL_STOCK', false) AS physical
          FROM stock_adjustments a
          JOIN items i ON i.id = a.item_id
          LEFT JOIN item_variants v ON v.id = a.variant_id
          LEFT JOIN stock_movements m ON m.reference_id = a.id AND m.reference_type IN ('STOCK_ADJUSTMENT', 'PHYSICAL_STOCK')
          LEFT JOIN warehouses w ON w.id = m.warehouse_id
          WHERE a.business_id = ${ctx.businessId} ${kindFilter}
          ORDER BY a.adjustment_date DESC, a.created_at DESC
          LIMIT ${input.limit} OFFSET ${offset}
        `) as unknown as Promise<Array<{
          id: string; date: string; quantity: string; previousStock: string; newStock: string;
          reason: string | null; createdByName: string | null; itemName: string; unit: string;
          warehouseName: string | null; physical: boolean;
        }>>,
        ctx.db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM stock_adjustments a
          LEFT JOIN stock_movements m ON m.reference_id = a.id AND m.reference_type IN ('STOCK_ADJUSTMENT', 'PHYSICAL_STOCK')
          WHERE a.business_id = ${ctx.businessId} ${kindFilter}
        `) as unknown as Promise<Array<{ count: number }>>,
      ]);
      return { data, total: count, page: input.page, limit: input.limit };
    }),

  /**
   * Physical stock verification: post counted quantities for a warehouse.
   * Every line that differs from the books becomes an adjustment.
   */
  verify: memberProcedure
    .input(z.object({
      warehouseId: z.string().uuid(),
      date: z.string().datetime().optional(),
      note: z.string().max(300).optional(),
      counts: z.array(lineKey.extend({
        counted: z.string().regex(/^\d+(\.\d{1,3})?$/, "Counted quantity can't be negative"),
      })).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      const date = input.date ? new Date(input.date) : new Date();
      const reason = input.note?.trim() ? `${PHYSICAL_REASON}: ${input.note.trim()}` : PHYSICAL_REASON;
      return ctx.db.transaction(async (tx: Tx) => {
        await assertWarehouses(tx, ctx.businessId, [input.warehouseId]);
        await assertWarehousePermission(tx, ctx, [input.warehouseId], "canAdjust");
        let adjusted = 0;
        for (const line of input.counts) {
          await placeUnplacedStock(tx, ctx.businessId, line.itemId, line.variantId);
          const system = await warehouseBalance(tx, ctx.businessId, input.warehouseId, line.itemId, line.variantId);
          const diff = parseFloat(line.counted) - system;
          if (Math.abs(diff) < 0.0005) continue;
          await applyStockAdjustment(tx, {
            businessId: ctx.businessId,
            warehouseId: input.warehouseId,
            itemId: line.itemId,
            variantId: line.variantId,
            quantity: diff,
            reason,
            date,
            user: { id: ctx.user.id, name: ctx.user.name },
            referenceType: "PHYSICAL_STOCK",
          });
          adjusted++;
        }
        return { checked: input.counts.length, adjusted };
      });
    }),

  /** Inventory settings: the negative stock policy and default warehouses. */
  settings: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    const settings = await ctx.db.transaction((tx: Tx) => ensureDefaultWarehouse(tx, ctx.businessId));
    return {
      negativeStockPolicy: await getNegativeStockPolicy(ctx.db, ctx.businessId),
      salesWarehouseId: settings.salesWarehouseId as string | null,
      purchaseWarehouseId: settings.purchaseWarehouseId as string | null,
      salesReturnWarehouseId: settings.salesReturnWarehouseId as string | null,
      purchaseReturnWarehouseId: settings.purchaseReturnWarehouseId as string | null,
      stockAdjustmentWarehouseId: settings.stockAdjustmentWarehouseId as string | null,
    };
  }),

  updateSettings: adminProcedure
    .input(z.object({ negativeStockPolicy: z.enum(["allow", "warn", "block"]) }))
    .mutation(async ({ ctx, input }) => {
      // A business-wide rule, so the same permission as editing the business.
      requireCan(ctx.ability, "update", "Business");
      await ctx.db.transaction(async (tx: Tx) => {
        await ensureDefaultWarehouse(tx, ctx.businessId);
        await tx
          .update(inventorySettings)
          .set({ negativeStockPolicy: input.negativeStockPolicy, updatedAt: new Date() })
          .where(eq(inventorySettings.businessId, ctx.businessId));
      });
      return { ok: true };
    }),

  /**
   * How much of each item a warehouse holds, for warning about shortfalls
   * while a document is being entered. Defaults to the default warehouse,
   * which also holds any unplaced stock.
   */
  availability: viewerProcedure
    .input(z.object({
      warehouseId: z.string().uuid().nullish(),
      lines: z.array(lineKey).max(200),
    }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const [settings] = await ctx.db
        .select({ defaultId: inventorySettings.salesWarehouseId, policy: inventorySettings.negativeStockPolicy })
        .from(inventorySettings)
        .where(eq(inventorySettings.businessId, ctx.businessId))
        .limit(1);
      const warehouseId = input.warehouseId ?? settings?.defaultId ?? null;
      const policy = settings?.policy ?? "warn";
      if (!warehouseId || input.lines.length === 0) return { warehouseId, policy, lines: [] };
      const isDefault = warehouseId === settings?.defaultId;

      const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
      const rows = (await ctx.db.execute(sql`
        WITH units AS (${stockUnitsSql(ctx.businessId)})
        SELECT u.item_id AS "itemId", u.variant_id AS "variantId",
               COALESCE((SELECT SUM(quantity::numeric) FROM stock_balances sb
                 WHERE sb.business_id = ${ctx.businessId} AND sb.warehouse_id = ${warehouseId}
                   AND sb.item_id = u.item_id AND sb.variant_id IS NOT DISTINCT FROM u.variant_id), 0)
               + CASE WHEN ${isDefault} THEN u.total - COALESCE((SELECT SUM(quantity::numeric) FROM stock_balances sb
                 WHERE sb.business_id = ${ctx.businessId}
                   AND sb.item_id = u.item_id AND sb.variant_id IS NOT DISTINCT FROM u.variant_id), 0)
                 ELSE 0 END AS available
        FROM units u
        WHERE u.item_id IN ${itemIds}
      `)) as unknown as Array<{ itemId: string; variantId: string | null; available: string }>;

      return {
        warehouseId,
        policy,
        lines: rows.map((r) => ({ ...r, available: qty(parseFloat(r.available)) })),
      };
    }),
});
