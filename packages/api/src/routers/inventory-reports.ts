/**
 * Inventory reports: stock ledger, movement summary, godown (warehouse)
 * summary, stock ageing, reorder status and dead stock.
 *
 * All of them read the stock movement ledger. Quantities are in each item's
 * base unit. Values use the business's valuation method (see
 * lib/stock-valuation), so they agree with the stock summary, the P&L and the
 * balance sheet.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { stockGroups } from "@fintranzact/db";
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { unitKey, valueStock } from "../lib/stock-valuation.js";
import { descendantIds, orderTree, type StockGroupRow } from "../lib/stock-groups.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const dateString = z.string().datetime();

/** Movements that take goods out to a customer (not transfers, corrections
 *  or components used up in manufacturing). */
const OUTWARD_TYPES = ["SALE", "DELIVERY_CHALLAN", "PURCHASE_RETURN"];
/** Movements that bring goods in and so start their age. */
const INWARD_TYPES = ["PURCHASE", "GOODS_RECEIPT_NOTE", "OPENING", "UNPLACED_STOCK", "SALES_RETURN", "ADJUSTMENT", "PRODUCTION", "BY_PRODUCT"];

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every stock unit (item, or one variant of a variant item) with its name. */
function unitsSql(businessId: string) {
  return sql`
    SELECT i.id AS item_id, NULL::uuid AS variant_id, i.name AS name, i.sku, i.unit::text AS unit,
           i.category, i.stock_quantity::numeric AS total, i.low_stock_alert::numeric AS low_stock,
           i.stock_group_id
    FROM items i
    WHERE i.business_id = ${businessId} AND i.deleted_at IS NULL
      AND i.item_type = 'product' AND i.item_mode <> 'variants'
    UNION ALL
    SELECT i.id, v.id,
           i.name || ' — ' || COALESCE((SELECT string_agg(value, ' / ') FROM jsonb_each_text(v.attribute_values)), 'Variant'),
           COALESCE(v.sku, i.sku), i.unit::text, i.category, v.stock_quantity::numeric, v.low_stock_alert::numeric,
           i.stock_group_id
    FROM item_variants v
    JOIN items i ON i.id = v.item_id
    WHERE i.business_id = ${businessId} AND i.deleted_at IS NULL AND v.deleted_at IS NULL
      AND i.item_type = 'product'
  `;
}

type UnitRow = {
  item_id: string;
  variant_id: string | null;
  name: string;
  sku: string | null;
  unit: string;
  category: string | null;
  total: string;
  low_stock: string | null;
  stock_group_id: string | null;
};

async function loadUnits(db: Db, businessId: string): Promise<UnitRow[]> {
  return (await db.execute(sql`${unitsSql(businessId)} ORDER BY 3`)) as UnitRow[];
}

/** A human label for where a movement came from. */
function referenceLabel(row: { reference_type: string; movement_type: string; document_type: string | null; document_number: string | null; reason: string | null; journal_number?: string | null }) {
  if (row.reference_type === "MANUFACTURING" || row.reference_type === "MANUFACTURING_CANCEL") {
    const number = row.journal_number ? ` ${row.journal_number}` : "";
    if (row.reference_type === "MANUFACTURING_CANCEL") return `Manufacturing${number} cancelled`;
    if (row.movement_type === "PRODUCTION") return `Manufactured — journal${number}`;
    if (row.movement_type === "BY_PRODUCT") return `By-product of manufacturing — journal${number}`;
    return `Used in manufacturing — journal${number}`;
  }
  if (row.document_number) {
    const kind: Record<string, string> = {
      invoice: row.movement_type.startsWith("PURCHASE") ? "Purchase" : "Sale",
      delivery_challan: "Delivery challan",
      goods_receipt_note: "Goods receipt note",
      sales_return: "Sales return",
      purchase_return: "Purchase return",
    };
    return `${kind[row.document_type ?? ""] ?? "Document"} ${row.document_number}`;
  }
  switch (row.reference_type) {
    case "STOCK_TRANSFER": return row.movement_type === "TRANSFER_IN" ? "Transfer in" : "Transfer out";
    case "STOCK_ADJUSTMENT": return row.reason ? `Adjustment — ${row.reason}` : "Stock adjustment";
    case "PHYSICAL_STOCK": return "Physical stock count";
    case "OPENING_BALANCE": return row.movement_type === "UNPLACED_STOCK" ? "Stock brought into warehouse" : "Opening stock";
    default: return row.reference_type.replace(/_/g, " ").toLowerCase();
  }
}

export const inventoryReportsRouter = router({
  /**
   * Every movement of one item (or variant) in a period, with opening and
   * running balance — Tally's stock item register. Optionally for one
   * warehouse.
   */
  stockLedger: viewerProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      variantId: z.string().uuid().nullish(),
      warehouseId: z.string().uuid().nullish(),
      fromDate: dateString,
      toDate: dateString,
    }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Report");
      // The item (and variant) must belong to this business: the opening
      // balance below reads its stock total by id.
      const [owned] = (await ctx.db.execute(sql`
        SELECT 1 FROM items i
        ${input.variantId ? sql`JOIN item_variants v ON v.item_id = i.id AND v.id = ${input.variantId}` : sql``}
        WHERE i.id = ${input.itemId} AND i.business_id = ${ctx.businessId}
      `)) as unknown[];
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

      const variant = input.variantId
        ? sql`m.variant_id = ${input.variantId}`
        : sql`m.variant_id IS NULL`;
      const warehouse = input.warehouseId ? sql`AND m.warehouse_id = ${input.warehouseId}` : sql``;

      // Business-wide opening = today's total less everything since; that
      // also counts stock with no movement history. Per warehouse, only
      // recorded movements can say what was there.
      const [opening] = input.warehouseId
        ? ((await ctx.db.execute(sql`
            SELECT COALESCE(SUM(m.quantity::numeric), 0)::text AS qty
            FROM stock_movements m
            WHERE m.business_id = ${ctx.businessId} AND m.item_id = ${input.itemId} AND ${variant}
              ${warehouse} AND m.movement_date < ${input.fromDate}
          `)) as Array<{ qty: string }>)
        : ((await ctx.db.execute(sql`
            SELECT (
              COALESCE((SELECT stock_quantity::numeric
                        FROM ${input.variantId ? sql`item_variants` : sql`items`}
                        WHERE id = ${input.variantId ?? input.itemId}), 0)
              - COALESCE((SELECT SUM(m.quantity::numeric) FROM stock_movements m
                          WHERE m.business_id = ${ctx.businessId} AND m.item_id = ${input.itemId} AND ${variant}
                            AND m.movement_date >= ${input.fromDate}), 0)
            )::text AS qty
          `)) as Array<{ qty: string }>);

      const rows = (await ctx.db.execute(sql`
        SELECT m.id, m.movement_date AS date, m.movement_type, m.reference_type, m.reference_id,
               m.quantity::text AS quantity, w.name AS warehouse,
               d.invoice_number AS document_number, d.document_type::text AS document_type,
               p.name AS party, a.reason, mj.journal_number,
               -- Free goods ("10 + 1") within a document's posting, in base units.
               CASE WHEN m.reference_type IN ('INVOICE', 'DOCUMENT') THEN (
                 SELECT SUM(COALESCE(li.free_quantity, 0)::numeric
                   * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END)
                 FROM invoice_items li
                 WHERE li.invoice_id = m.reference_id
                   AND COALESCE(li.item_id, (SELECT iv.item_id FROM item_variants iv WHERE iv.id = li.variant_id)) = m.item_id
                   AND li.variant_id IS NOT DISTINCT FROM m.variant_id
               ) END::text AS free
        FROM stock_movements m
        JOIN warehouses w ON w.id = m.warehouse_id
        LEFT JOIN invoices d ON d.id = m.reference_id
          AND (m.reference_type LIKE 'INVOICE%' OR m.reference_type LIKE 'DOCUMENT%')
        LEFT JOIN parties p ON p.id = d.party_id
        LEFT JOIN stock_adjustments a ON a.id = m.reference_id AND m.reference_type = 'STOCK_ADJUSTMENT'
        LEFT JOIN manufacturing_journals mj ON mj.id = m.reference_id
          AND m.reference_type IN ('MANUFACTURING', 'MANUFACTURING_CANCEL')
        WHERE m.business_id = ${ctx.businessId} AND m.item_id = ${input.itemId} AND ${variant}
          ${warehouse}
          AND m.movement_date >= ${input.fromDate} AND m.movement_date <= ${input.toDate}
          -- Moving unplaced stock into a warehouse doesn't change the business total.
          ${input.warehouseId ? sql`` : sql`AND m.movement_type <> 'UNPLACED_STOCK'`}
        ORDER BY m.movement_date, m.created_at
        LIMIT 2000
      `)) as Array<{
        id: string; date: string; movement_type: string; reference_type: string; reference_id: string | null;
        quantity: string; warehouse: string; document_number: string | null; document_type: string | null;
        party: string | null; reason: string | null; journal_number: string | null; free: string | null;
      }>;

      let balance = parseFloat(opening?.qty ?? "0");
      let inward = 0;
      let outward = 0;
      const lines = rows.map((r) => {
        const q = parseFloat(r.quantity);
        balance = round3(balance + q);
        if (q >= 0) inward += q; else outward -= q;
        return {
          id: r.id,
          date: r.date,
          particulars: referenceLabel(r),
          party: r.party,
          warehouse: r.warehouse,
          documentId: r.document_number ? r.reference_id : null,
          inward: q > 0 ? round3(q) : 0,
          outward: q < 0 ? round3(-q) : 0,
          /** Of the quantity moved, how much was free goods. */
          free: Math.min(round3(parseFloat(r.free ?? "0") || 0), round3(Math.abs(q))),
          balance,
        };
      });

      return {
        opening: round3(parseFloat(opening?.qty ?? "0")),
        inward: round3(inward),
        outward: round3(outward),
        closing: balance,
        lines,
        truncated: rows.length === 2000,
      };
    }),

  /**
   * Opening, inward, outward and closing per item for a period — Tally's
   * stock summary with movements. Transfers between warehouses cancel out
   * business-wide and are left out unless one warehouse is chosen.
   */
  movementSummary: viewerProcedure
    .input(z.object({
      fromDate: dateString,
      toDate: dateString,
      warehouseId: z.string().uuid().nullish(),
    }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Report");
      const warehouse = input.warehouseId ? sql`AND m.warehouse_id = ${input.warehouseId}` : sql``;
      const [units, moves, closing] = await Promise.all([
        loadUnits(ctx.db, ctx.businessId),
        ctx.db.execute(sql`
          SELECT m.item_id, m.variant_id,
                 SUM(CASE WHEN m.movement_date >= ${input.fromDate} AND m.movement_date <= ${input.toDate} AND m.quantity::numeric > 0 THEN m.quantity::numeric ELSE 0 END)::text AS inward,
                 SUM(CASE WHEN m.movement_date >= ${input.fromDate} AND m.movement_date <= ${input.toDate} AND m.quantity::numeric < 0 THEN -m.quantity::numeric ELSE 0 END)::text AS outward,
                 SUM(CASE WHEN m.movement_date > ${input.toDate} THEN m.quantity::numeric ELSE 0 END)::text AS after,
                 SUM(CASE WHEN m.movement_date <= ${input.toDate} THEN m.quantity::numeric ELSE 0 END)::text AS upto
          FROM stock_movements m
          WHERE m.business_id = ${ctx.businessId} ${warehouse}
            ${input.warehouseId ? sql`` : sql`AND m.movement_type NOT IN ('TRANSFER_IN', 'TRANSFER_OUT', 'UNPLACED_STOCK')`}
          GROUP BY 1, 2
        `) as Promise<Array<{ item_id: string; variant_id: string | null; inward: string; outward: string; after: string; upto: string }>>,
        valueStock(ctx.db, ctx.businessId, new Date(input.toDate)),
      ]);

      const byUnit = new Map(moves.map((m) => [unitKey(m.item_id, m.variant_id), m]));
      const data = units.flatMap((u) => {
        const m = byUnit.get(unitKey(u.item_id, u.variant_id));
        const inward = parseFloat(m?.inward ?? "0");
        const outward = parseFloat(m?.outward ?? "0");
        // Business-wide closing counts stock with no movement history too.
        const closingQty = input.warehouseId
          ? parseFloat(m?.upto ?? "0")
          : parseFloat(u.total) - parseFloat(m?.after ?? "0");
        const openingQty = closingQty - inward + outward;
        if (!inward && !outward && Math.abs(closingQty) < 0.0005) return [];
        const rate = closing.units.get(unitKey(u.item_id, u.variant_id))?.rate ?? 0;
        return [{
          itemId: u.item_id,
          variantId: u.variant_id,
          name: u.name,
          unit: u.unit,
          category: u.category,
          opening: round3(openingQty),
          inward: round3(inward),
          outward: round3(outward),
          closing: round3(closingQty),
          closingValue: round2(Math.max(closingQty, 0) * rate),
        }];
      });

      return {
        data,
        totals: {
          closingValue: round2(data.reduce((s, r) => s + r.closingValue, 0)),
        },
        valuationMethod: closing.method,
      };
    }),

  /** How much stock, and what it's worth, in each warehouse. */
  godownSummary: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Report");
    const [rows, valuation] = await Promise.all([
      ctx.db.execute(sql`
        WITH units AS (${unitsSql(ctx.businessId)}),
        placed AS (
          SELECT item_id, variant_id, SUM(quantity::numeric) AS qty
          FROM stock_balances WHERE business_id = ${ctx.businessId}
          GROUP BY 1, 2
        ),
        settings AS (
          SELECT sales_warehouse_id AS default_id FROM inventory_settings WHERE business_id = ${ctx.businessId}
        )
        SELECT b.warehouse_id, b.item_id, b.variant_id, SUM(b.quantity::numeric)::text AS qty
        FROM stock_balances b
        JOIN units u ON u.item_id = b.item_id AND u.variant_id IS NOT DISTINCT FROM b.variant_id
        WHERE b.business_id = ${ctx.businessId}
        GROUP BY 1, 2, 3
        UNION ALL
        -- Stock no warehouse accounts for sits in the default warehouse.
        SELECT (SELECT default_id FROM settings), u.item_id, u.variant_id,
               (u.total - COALESCE(p.qty, 0))::text
        FROM units u
        LEFT JOIN placed p ON p.item_id = u.item_id AND p.variant_id IS NOT DISTINCT FROM u.variant_id
        WHERE u.total - COALESCE(p.qty, 0) <> 0 AND (SELECT default_id FROM settings) IS NOT NULL
      `) as Promise<Array<{ warehouse_id: string; item_id: string; variant_id: string | null; qty: string }>>,
      valueStock(ctx.db, ctx.businessId, new Date()),
    ]);
    const warehouses = (await ctx.db.execute(sql`
      SELECT w.id, w.name, w.code, w.status, p.name AS premise
      FROM warehouses w LEFT JOIN premises p ON p.id = w.premise_id
      WHERE w.business_id = ${ctx.businessId}
      ORDER BY w.name
    `)) as Array<{ id: string; name: string; code: string; status: string; premise: string | null }>;

    const totals = new Map<string, { quantity: number; value: number; units: Set<string> }>();
    for (const r of rows) {
      const q = parseFloat(r.qty);
      if (Math.abs(q) < 0.0005) continue;
      const key = unitKey(r.item_id, r.variant_id);
      const rate = valuation.units.get(key)?.rate ?? 0;
      const t = totals.get(r.warehouse_id) ?? { quantity: 0, value: 0, units: new Set<string>() };
      t.quantity += q;
      t.value += Math.max(q, 0) * rate;
      t.units.add(key);
      totals.set(r.warehouse_id, t);
    }

    const data = warehouses.map((w) => {
      const t = totals.get(w.id);
      return {
        ...w,
        itemCount: t?.units.size ?? 0,
        quantity: round3(t?.quantity ?? 0),
        value: round2(t?.value ?? 0),
      };
    });
    return {
      data,
      totalValue: round2(data.reduce((s, w) => s + w.value, 0)),
      valuationMethod: valuation.method,
    };
  }),

  /**
   * Stock on hand split by how long it has been held. What's left is taken
   * to be the most recent arrivals (first in, first out), so older stock is
   * what has been sitting longest.
   */
  ageing: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Report");
    const now = Date.now();
    const [units, inwards, valuation] = await Promise.all([
      loadUnits(ctx.db, ctx.businessId),
      ctx.db.execute(sql`
        SELECT item_id, variant_id, movement_date AS date, quantity::text AS qty
        FROM stock_movements
        WHERE business_id = ${ctx.businessId} AND quantity::numeric > 0
          AND movement_type IN ${INWARD_TYPES}
        ORDER BY movement_date DESC
      `) as Promise<Array<{ item_id: string; variant_id: string | null; date: string; qty: string }>>,
      valueStock(ctx.db, ctx.businessId, new Date()),
    ]);

    const BUCKETS = [30, 60, 90, 180, Infinity];
    const arrivals = new Map<string, Array<{ days: number; qty: number }>>();
    for (const r of inwards) {
      const key = unitKey(r.item_id, r.variant_id);
      const list = arrivals.get(key) ?? [];
      list.push({ days: Math.floor((now - new Date(r.date).getTime()) / 86_400_000), qty: parseFloat(r.qty) });
      arrivals.set(key, list);
    }

    const data = units.flatMap((u) => {
      const onHand = parseFloat(u.total);
      if (onHand <= 0.0005) return [];
      const key = unitKey(u.item_id, u.variant_id);
      const rate = valuation.units.get(key)?.rate ?? 0;
      const qty = BUCKETS.map(() => 0);
      let remaining = onHand;
      let oldestDays = 0;
      for (const a of arrivals.get(key) ?? []) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, a.qty);
        qty[BUCKETS.findIndex((b) => a.days <= b)] += take;
        remaining -= take;
        oldestDays = a.days;
      }
      // Stock older than any recorded arrival.
      if (remaining > 0) {
        qty[BUCKETS.length - 1] += remaining;
        oldestDays = Math.max(oldestDays, 181);
      }
      return [{
        itemId: u.item_id,
        variantId: u.variant_id,
        name: u.name,
        unit: u.unit,
        quantity: round3(onHand),
        value: round2(onHand * rate),
        oldestDays,
        buckets: qty.map((q) => ({ quantity: round3(q), value: round2(q * rate) })),
      }];
    });

    const bucketTotals = BUCKETS.map((_, i) => round2(data.reduce((s, r) => s + r.buckets[i]!.value, 0)));
    return {
      bucketLabels: ["0–30 days", "31–60 days", "61–90 days", "91–180 days", "Over 180 days"],
      data: data.sort((a, b) => b.oldestDays - a.oldestDays),
      bucketTotals,
      totalValue: round2(data.reduce((s, r) => s + r.value, 0)),
    };
  }),

  /**
   * Items at or below their reorder level, with how fast they sell and a
   * suggested order: enough to get back above the level and cover the next
   * `coverDays` of sales.
   */
  reorderStatus: viewerProcedure
    .input(z.object({ coverDays: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Report");
      const coverDays = input?.coverDays ?? 30;
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [units, sold] = await Promise.all([
        loadUnits(ctx.db, ctx.businessId),
        ctx.db.execute(sql`
          SELECT item_id, variant_id, SUM(-quantity::numeric)::text AS qty
          FROM stock_movements
          WHERE business_id = ${ctx.businessId} AND movement_date >= ${since}
            AND movement_type IN ('SALE', 'DELIVERY_CHALLAN', 'SALE_REVERSAL', 'DELIVERY_CHALLAN_REVERSAL')
          GROUP BY 1, 2
        `) as Promise<Array<{ item_id: string; variant_id: string | null; qty: string }>>,
      ]);
      const soldBy = new Map(sold.map((s) => [unitKey(s.item_id, s.variant_id), Math.max(parseFloat(s.qty), 0)]));

      const data = units.flatMap((u) => {
        if (u.low_stock === null) return [];
        const level = parseFloat(u.low_stock);
        const onHand = parseFloat(u.total);
        if (onHand > level) return [];
        const dailySales = (soldBy.get(unitKey(u.item_id, u.variant_id)) ?? 0) / 30;
        const suggested = Math.max(Math.ceil(level - onHand + dailySales * coverDays), 0);
        return [{
          itemId: u.item_id,
          variantId: u.variant_id,
          name: u.name,
          sku: u.sku,
          unit: u.unit,
          onHand: round3(onHand),
          reorderLevel: round3(level),
          shortfall: round3(level - onHand),
          dailySales: round3(dailySales),
          daysLeft: dailySales > 0 ? Math.max(Math.floor(onHand / dailySales), 0) : null,
          suggestedOrder: suggested,
        }];
      });
      return { data: data.sort((a, b) => b.shortfall - a.shortfall), coverDays };
    }),

  /** Stock that hasn't gone out to a customer in `days` days (or ever). */
  deadStock: viewerProcedure
    .input(z.object({ days: z.number().int().min(7).max(3650).default(90) }).optional())
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Report");
      const days = input?.days ?? 90;
      const cutoff = Date.now() - days * 86_400_000;
      const [units, lastOut, valuation] = await Promise.all([
        loadUnits(ctx.db, ctx.businessId),
        ctx.db.execute(sql`
          SELECT item_id, variant_id, MAX(movement_date) AS last
          FROM stock_movements
          WHERE business_id = ${ctx.businessId} AND quantity::numeric < 0
            AND movement_type IN ${OUTWARD_TYPES}
          GROUP BY 1, 2
        `) as Promise<Array<{ item_id: string; variant_id: string | null; last: string }>>,
        valueStock(ctx.db, ctx.businessId, new Date()),
      ]);
      const lastBy = new Map(lastOut.map((r) => [unitKey(r.item_id, r.variant_id), r.last]));

      const data = units.flatMap((u) => {
        const onHand = parseFloat(u.total);
        if (onHand <= 0.0005) return [];
        const key = unitKey(u.item_id, u.variant_id);
        const last = lastBy.get(key) ?? null;
        if (last && new Date(last).getTime() >= cutoff) return [];
        return [{
          itemId: u.item_id,
          variantId: u.variant_id,
          name: u.name,
          unit: u.unit,
          category: u.category,
          quantity: round3(onHand),
          value: valuation.units.get(key)?.value ?? 0,
          lastSold: last,
          idleDays: last ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) : null,
        }];
      });
      return {
        days,
        data: data.sort((a, b) => b.value - a.value),
        totalValue: round2(data.reduce((s, r) => s + r.value, 0)),
      };
    }),

  /**
   * Tally's stock group summary: quantity and value per stock group at a
   * date, each group including the groups under it, plus the stock units
   * (items and variants) so the screen can drill into a group. Quantities
   * of different units are added as they are, as Tally does.
   */
  stockGroupSummary: viewerProcedure
    .input(z.object({ asOf: dateString.optional() }).optional())
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Report");
      const asOf = input?.asOf ? new Date(input.asOf) : new Date();
      const [units, groups, valuation] = await Promise.all([
        loadUnits(ctx.db, ctx.businessId),
        ctx.db
          .select({ id: stockGroups.id, name: stockGroups.name, parentId: stockGroups.parentId })
          .from(stockGroups)
          .where(eq(stockGroups.businessId, ctx.businessId)) as Promise<StockGroupRow[]>,
        valueStock(ctx.db, ctx.businessId, asOf),
      ]);

      const groupIds = new Set(groups.map((g) => g.id));
      const rows = units.flatMap((u) => {
        const v = valuation.units.get(unitKey(u.item_id, u.variant_id));
        const quantity = v?.quantity ?? 0;
        const value = v?.value ?? 0;
        if (Math.abs(quantity) < 0.0005 && !value) return [];
        return [{
          itemId: u.item_id,
          variantId: u.variant_id,
          name: u.name,
          unit: u.unit,
          groupId: u.stock_group_id && groupIds.has(u.stock_group_id) ? u.stock_group_id : null,
          quantity: round3(quantity),
          rate: v?.rate ?? 0,
          value: round2(value),
        }];
      });

      type Totals = { quantity: number; value: number; items: Set<string> };
      const direct = new Map<string | null, Totals>();
      for (const r of rows) {
        const t = direct.get(r.groupId) ?? { quantity: 0, value: 0, items: new Set<string>() };
        t.quantity += r.quantity;
        t.value += r.value;
        t.items.add(r.itemId);
        direct.set(r.groupId, t);
      }

      const summary = orderTree(groups).map((g) => {
        let quantity = 0;
        let value = 0;
        let itemCount = 0;
        for (const id of descendantIds(groups, g.id)) {
          const t = direct.get(id);
          if (!t) continue;
          quantity += t.quantity;
          value += t.value;
          itemCount += t.items.size;
        }
        return { ...g, quantity: round3(quantity), value: round2(value), itemCount };
      });
      const ungrouped = direct.get(null);

      return {
        asOf: asOf.toISOString(),
        groups: summary,
        ungrouped: {
          quantity: round3(ungrouped?.quantity ?? 0),
          value: round2(ungrouped?.value ?? 0),
          itemCount: ungrouped?.items.size ?? 0,
        },
        items: rows,
        totalValue: round2(rows.reduce((s, r) => s + r.value, 0)),
        valuationMethod: valuation.method,
      };
    }),
});
