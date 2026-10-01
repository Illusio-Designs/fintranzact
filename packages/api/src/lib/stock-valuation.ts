/**
 * Closing stock valuation.
 *
 * Stock is valued periodically, the way Tally does: the quantity on hand at a
 * date is priced from purchase bills up to that date, and the result feeds the
 * stock summary, the P&L (as the change in inventories) and the balance sheet
 * (as the Inventory asset). Nothing is posted to the ledger.
 *
 * - Quantity at a date = today's total minus every movement dated after it,
 *   so stock with no movement history (entered before warehouses existed)
 *   still counts.
 * - Purchase cost = the line's taxable value (after discount, before GST — the
 *   GST is input credit, not cost) per base unit. Free goods on the bill
 *   ("10 + 1") count in the quantity at no cost, so they lower the rate.
 * - Manufactured stock counts as an inward at its production cost (components
 *   consumed at their valuation rate plus additional costs, from the
 *   manufacturing journal), alongside purchases. A cancelled run stops counting
 *   from the date it was cancelled.
 * - "weighted_average": average cost of all purchases up to the date, with
 *   opening stock counted at the item's purchase price.
 * - "fifo": what is left is assumed to be the most recent purchases; anything
 *   older than the purchases on record is priced at the item's purchase price.
 * - Negative stock is valued at zero.
 */
import { eq, sql } from "drizzle-orm";
import { inventorySettings } from "@fintranzact/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type ValuationMethod = "weighted_average" | "fifo";

export type UnitValuation = {
  itemId: string;
  variantId: string | null;
  quantity: number;
  rate: number;
  value: number;
};

export type StockValuation = {
  method: ValuationMethod;
  asOf: Date;
  /** Total value, 2 decimals. */
  total: string;
  /** Keyed by unitKey(itemId, variantId). */
  units: Map<string, UnitValuation>;
};

export function unitKey(itemId: string, variantId: string | null | undefined) {
  return `${itemId}:${variantId ?? ""}`;
}

export async function getValuationMethod(db: Db, businessId: string): Promise<ValuationMethod> {
  const [row] = await db
    .select({ method: inventorySettings.valuationMethod })
    .from(inventorySettings)
    .where(eq(inventorySettings.businessId, businessId))
    .limit(1);
  return row?.method === "fifo" ? "fifo" : "weighted_average";
}

type Purchase = { qty: number; value: number; date: number };

export async function valueStock(
  db: Db,
  businessId: string,
  asOf: Date,
  method?: ValuationMethod,
): Promise<StockValuation> {
  const valuationMethod = method ?? (await getValuationMethod(db, businessId));

  const [unitRows, purchaseRows, productionRows] = await Promise.all([
    db.execute(sql`
      WITH units AS (
        SELECT i.id AS item_id, NULL::uuid AS variant_id,
               i.stock_quantity::numeric AS total,
               COALESCE(i.purchase_price::numeric, 0) AS master
        FROM items i
        WHERE i.business_id = ${businessId} AND i.deleted_at IS NULL
          AND i.item_type = 'product' AND i.item_mode <> 'variants'
        UNION ALL
        SELECT i.id, v.id, v.stock_quantity::numeric,
               COALESCE(v.purchase_price::numeric, i.purchase_price::numeric, 0)
        FROM item_variants v
        JOIN items i ON i.id = v.item_id
        WHERE i.business_id = ${businessId} AND i.deleted_at IS NULL AND v.deleted_at IS NULL
          AND i.item_type = 'product'
      ),
      later AS (
        SELECT item_id, variant_id, SUM(quantity::numeric) AS qty
        FROM stock_movements
        WHERE business_id = ${businessId} AND movement_date > ${asOf.toISOString()}
        GROUP BY 1, 2
      ),
      opening AS (
        SELECT item_id, variant_id, SUM(quantity::numeric) AS qty
        FROM stock_movements
        WHERE business_id = ${businessId} AND reference_type = 'OPENING_BALANCE'
          AND movement_date <= ${asOf.toISOString()}
        GROUP BY 1, 2
      )
      SELECT u.item_id AS "itemId", u.variant_id AS "variantId",
             (u.total - COALESCE(l.qty, 0))::text AS quantity,
             u.master::text AS master,
             COALESCE(o.qty, 0)::text AS opening
      FROM units u
      LEFT JOIN later l ON l.item_id = u.item_id AND l.variant_id IS NOT DISTINCT FROM u.variant_id
      LEFT JOIN opening o ON o.item_id = u.item_id AND o.variant_id IS NOT DISTINCT FROM u.variant_id
    `) as Promise<Array<{ itemId: string; variantId: string | null; quantity: string; master: string; opening: string }>>,
    // Newest first, for FIFO.
    db.execute(sql`
      SELECT COALESCE(li.item_id, v.item_id) AS "itemId", li.variant_id AS "variantId",
             -- Free goods came in at no cost, so they lower the rate.
             ((li.quantity::numeric + COALESCE(li.free_quantity, 0)::numeric)
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END)::text AS qty,
             (li.total_amount::numeric - li.tax_amount::numeric)::text AS value,
             i.invoice_date AS date
      FROM invoice_items li
      JOIN invoices i ON i.id = li.invoice_id
      LEFT JOIN item_variants v ON v.id = li.variant_id
      WHERE i.business_id = ${businessId}
        AND i.type = 'purchase' AND i.document_type = 'invoice'
        AND i.deleted_at IS NULL AND i.status <> 'cancelled'
        AND i.invoice_date <= ${asOf.toISOString()}
        AND COALESCE(li.item_id, v.item_id) IS NOT NULL
      ORDER BY i.invoice_date DESC, i.created_at DESC, li.sort_order DESC
    `) as Promise<Array<{ itemId: string; variantId: string | null; qty: string; value: string; date: string | Date }>>,
    // Production runs: the finished quantity at the run's total cost.
    db.execute(sql`
      SELECT m.item_id AS "itemId", m.variant_id AS "variantId",
             m.quantity::text AS qty,
             COALESCE(mj.total_cost::numeric, m.quantity::numeric * COALESCE(m.unit_cost::numeric, 0))::text AS value,
             m.movement_date AS date
      FROM stock_movements m
      LEFT JOIN manufacturing_journals mj ON mj.id = m.reference_id
      WHERE m.business_id = ${businessId}
        AND m.reference_type = 'MANUFACTURING' AND m.movement_type = 'PRODUCTION'
        AND m.movement_date <= ${asOf.toISOString()}
        AND NOT EXISTS (
          SELECT 1 FROM stock_movements r
          WHERE r.business_id = m.business_id AND r.reference_id = m.reference_id
            AND r.reference_type = 'MANUFACTURING_CANCEL'
            AND r.movement_date <= ${asOf.toISOString()}
        )
    `) as Promise<Array<{ itemId: string; variantId: string | null; qty: string; value: string; date: string | Date }>>,
  ]);

  const purchases = new Map<string, Purchase[]>();
  for (const p of [...purchaseRows, ...productionRows]) {
    const qty = parseFloat(p.qty);
    if (!(qty > 0)) continue;
    const key = unitKey(p.itemId, p.variantId);
    const list = purchases.get(key) ?? [];
    list.push({ qty, value: parseFloat(p.value), date: new Date(p.date).getTime() });
    purchases.set(key, list);
  }
  // Newest first, for FIFO. The sort is stable, so purchases on the same
  // date keep their order.
  for (const list of purchases.values()) list.sort((a, b) => b.date - a.date);

  const units = new Map<string, UnitValuation>();
  let total = 0;
  for (const u of unitRows) {
    const key = unitKey(u.itemId, u.variantId);
    const quantity = Math.round(parseFloat(u.quantity) * 1000) / 1000;
    const master = parseFloat(u.master);
    const bought = purchases.get(key) ?? [];
    const onHand = Math.max(quantity, 0);

    let value: number;
    let rate: number;
    if (valuationMethod === "fifo") {
      let remaining = onHand;
      value = 0;
      for (const p of bought) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, p.qty);
        value += take * (p.value / p.qty);
        remaining -= take;
      }
      value += remaining * master;
      rate = onHand > 0 ? value / onHand : bought[0] ? bought[0].value / bought[0].qty : master;
    } else {
      const opening = Math.max(parseFloat(u.opening), 0);
      const boughtQty = bought.reduce((s, p) => s + p.qty, 0);
      const boughtValue = bought.reduce((s, p) => s + p.value, 0);
      const denom = boughtQty + opening;
      rate = denom > 0 ? (boughtValue + opening * master) / denom : master;
      value = onHand * rate;
    }

    value = Math.round(value * 100) / 100;
    total += value;
    units.set(key, {
      itemId: u.itemId,
      variantId: u.variantId,
      quantity,
      rate: Math.round(rate * 100) / 100,
      value,
    });
  }

  return { method: valuationMethod, asOf, total: total.toFixed(2), units };
}
