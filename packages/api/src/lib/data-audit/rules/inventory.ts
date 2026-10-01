/**
 * Inventory: warehouse balances and the movement journal behind them, stock
 * adjustments and physical counts, bills of materials and manufacturing.
 */

import type { TableCoverage } from "../types.js";
import { MONEY_TOLERANCE, QTY_TOLERANCE, rule } from "../sql-fragments.js";

const MOVEMENT_WRITERS = [
  "recordStockMovement / syncDocumentStock (invoices & documents)",
  "stock.adjust / stock.transfer / stock.countPost",
  "item.create (opening stock)",
  "manufacturing.manufacture / cancel",
];

/**
 * Movement types, the reference type each is recorded under and the sign its
 * quantity must have. Kept in step with inventory-service.ts, stock.ts and
 * manufacturing.ts.
 */
const MOVEMENT_SIGNS = `(VALUES
  ('SALE', -1), ('PURCHASE', 1), ('DELIVERY_CHALLAN', 0), ('SALES_RETURN', 1), ('PURCHASE_RETURN', -1),
  ('GOODS_RECEIPT_NOTE', 1), ('OPENING', 1), ('UNPLACED_STOCK', 0), ('ADJUSTMENT', 0),
  ('TRANSFER_OUT', -1), ('TRANSFER_IN', 1), ('CONSUMPTION', -1), ('PRODUCTION', 1), ('BY_PRODUCT', 1)
) AS s(movement_type, sign)`;

export const inventoryTables: TableCoverage[] = [
  {
    table: "stock_balances",
    rules: [
      rule("stock_balances", "equals-movements", "error",
        "A warehouse balance (per warehouse, location, item, variant) is the sum of the movements posted there.",
        MOVEMENT_WRITERS,
        `SELECT b.business_id, b.id::text, 'balance ' || b.quantity || ' vs movements ' || COALESCE(m.qty, 0) || ' for item ' || b.item_id
         FROM stock_balances b
         LEFT JOIN (SELECT business_id, warehouse_id, location_id, item_id, variant_id, SUM(quantity::numeric) AS qty
                    FROM stock_movements GROUP BY 1, 2, 3, 4, 5) m
           ON m.business_id = b.business_id AND m.warehouse_id = b.warehouse_id AND m.item_id = b.item_id
          AND m.location_id IS NOT DISTINCT FROM b.location_id AND m.variant_id IS NOT DISTINCT FROM b.variant_id
         WHERE ABS(b.quantity::numeric - COALESCE(m.qty, 0)) > ${QTY_TOLERANCE}`),
      rule("stock_balances", "movements-have-balance", "error",
        "Every (warehouse, location, item, variant) that has movements has a balance row.",
        MOVEMENT_WRITERS,
        `SELECT m.business_id, m.warehouse_id || '/' || m.item_id || '/' || COALESCE(m.variant_id::text, '-'), 'movements net ' || SUM(m.quantity::numeric) || ' but no balance row'
         FROM stock_movements m
         WHERE NOT EXISTS (SELECT 1 FROM stock_balances b WHERE b.business_id = m.business_id AND b.warehouse_id = m.warehouse_id
                             AND b.item_id = m.item_id AND b.location_id IS NOT DISTINCT FROM m.location_id
                             AND b.variant_id IS NOT DISTINCT FROM m.variant_id)
         GROUP BY m.business_id, m.warehouse_id, m.item_id, m.variant_id`),
      rule("stock_balances", "same-business", "error",
        "A balance's warehouse and item belong to its business, and its variant to its item.",
        MOVEMENT_WRITERS,
        `SELECT b.business_id, b.id::text, 'warehouse business ' || w.business_id || ', item business ' || i.business_id
         FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id JOIN items i ON i.id = b.item_id
         LEFT JOIN item_variants v ON v.id = b.variant_id
         WHERE w.business_id <> b.business_id OR i.business_id <> b.business_id OR (b.variant_id IS NOT NULL AND v.item_id <> b.item_id)`),
    ],
  },
  {
    table: "stock_movements",
    rules: [
      rule("stock_movements", "same-business", "error",
        "A movement's warehouse(s) and item belong to its business and its variant to its item.",
        MOVEMENT_WRITERS,
        `SELECT m.business_id, m.id::text, m.movement_type || ': warehouse business ' || w.business_id || ', item business ' || i.business_id
         FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id JOIN items i ON i.id = m.item_id
         LEFT JOIN item_variants v ON v.id = m.variant_id
         LEFT JOIN warehouses sw ON sw.id = m.source_warehouse_id LEFT JOIN warehouses dw ON dw.id = m.destination_warehouse_id
         WHERE w.business_id <> m.business_id OR i.business_id <> m.business_id
            OR (m.variant_id IS NOT NULL AND v.item_id <> m.item_id)
            OR sw.business_id <> m.business_id OR dw.business_id <> m.business_id`),
      rule("stock_movements", "batch-of-item", "error",
        "A movement's batch is a batch of the moved item (and variant) in the same business, and an item that doesn't track batches moves no batch (except stock left in batches from before tracking was switched off, which may only go out).",
        ["syncDocumentStock (per-batch)", "stock.adjust / stock.transfer / stock.countPost", "item.create (opening batch)"],
        `SELECT m.business_id, m.id::text, m.movement_type || ' ' || m.quantity || ' of ' || i.name || ' in batch ' || b.batch_number ||
                CASE WHEN NOT i.track_batches THEN ' (item does not track batches)' ELSE ' (batch of item ' || b.item_id || ')' END
         FROM stock_movements m JOIN item_batches b ON b.id = m.batch_id JOIN items i ON i.id = m.item_id
         WHERE b.business_id <> m.business_id OR b.item_id <> m.item_id OR b.variant_id IS DISTINCT FROM m.variant_id
            OR (NOT i.track_batches AND m.quantity::numeric > 0)`),
      rule("stock_movements", "product-only", "error",
        "Only products move stock — services carry none (lockTotal refuses them and stock reports skip them).",
        MOVEMENT_WRITERS,
        `SELECT m.business_id, m.id::text, m.movement_type || ' ' || m.quantity || ' of service ' || i.name
         FROM stock_movements m JOIN items i ON i.id = m.item_id WHERE i.item_type = 'service'`),
      rule("stock_movements", "type-and-sign", "error",
        "The movement type is a known one and its quantity has that type's sign (reversals the opposite); quantities are never zero.",
        MOVEMENT_WRITERS,
        `SELECT m.business_id, m.id::text, m.movement_type || ' with quantity ' || m.quantity
         FROM stock_movements m
         LEFT JOIN ${MOVEMENT_SIGNS} ON s.movement_type = regexp_replace(m.movement_type, '_REVERSAL$', '')
         WHERE m.quantity::numeric = 0 OR s.movement_type IS NULL
            OR (s.sign <> 0 AND sign(m.quantity::numeric) <> s.sign * CASE WHEN m.movement_type LIKE '%\\_REVERSAL' THEN -1 ELSE 1 END)`),
      rule("stock_movements", "source-document", "error",
        "A movement links the document that caused it: invoice/document movements a stock-moving document of the business, adjustments their stock_adjustments row, manufacturing its journal, opening stock the item/variant it was opened for; only unplaced-stock placement has no reference. (item.merge re-homes movements onto the target item, so the referenced adjustment/opening may name the merged-away item.)",
        MOVEMENT_WRITERS,
        `SELECT m.business_id, m.id::text, m.reference_type || ' ' || m.movement_type || ' → ' || COALESCE(m.reference_id::text, 'NULL') || ' does not resolve'
         FROM stock_movements m
         WHERE (m.reference_id IS NULL AND m.movement_type <> 'UNPLACED_STOCK')
            OR (m.reference_type LIKE 'INVOICE%' AND NOT EXISTS (
                  SELECT 1 FROM invoices i WHERE i.id = m.reference_id AND i.business_id = m.business_id AND i.document_type = 'invoice'))
            OR (m.reference_type LIKE 'DOCUMENT%' AND NOT EXISTS (
                  SELECT 1 FROM invoices i WHERE i.id = m.reference_id AND i.business_id = m.business_id
                    AND i.document_type IN ('delivery_challan', 'sales_return', 'purchase_return', 'goods_receipt_note')))
            OR (m.reference_type IN ('STOCK_ADJUSTMENT', 'PHYSICAL_STOCK') AND NOT EXISTS (
                  SELECT 1 FROM stock_adjustments a WHERE a.id = m.reference_id AND a.business_id = m.business_id))
            OR (m.reference_type LIKE 'MANUFACTURING%' AND NOT EXISTS (
                  SELECT 1 FROM manufacturing_journals j WHERE j.id = m.reference_id AND j.business_id = m.business_id))
            OR (m.reference_type = 'OPENING_BALANCE' AND m.movement_type = 'OPENING'
                AND NOT EXISTS (SELECT 1 FROM items i WHERE i.id = m.reference_id AND i.business_id = m.business_id)
                AND NOT EXISTS (SELECT 1 FROM item_variants v JOIN items i ON i.id = v.item_id
                                WHERE v.id = m.reference_id AND i.business_id = m.business_id))
            OR m.reference_type NOT SIMILAR TO '(INVOICE|DOCUMENT|STOCK_ADJUSTMENT|PHYSICAL_STOCK|STOCK_TRANSFER|MANUFACTURING|OPENING_BALANCE)%'`),
      rule("stock_movements", "direction-matches-document", "error",
        "A document movement goes the document's way: sale invoices, sales challans and purchase returns take stock out; purchases, inward challans, GRNs and sales returns bring it in (reversals the opposite).",
        ["syncDocumentStock", "postNewDocumentsStock (imports)"],
        `SELECT m.business_id, m.id::text, i.document_type || '/' || i.type || ' ' || i.invoice_number || ': ' || m.movement_type || ' ' || m.quantity
         FROM stock_movements m JOIN invoices i ON i.id = m.reference_id
         WHERE (m.reference_type LIKE 'INVOICE%' OR m.reference_type LIKE 'DOCUMENT%')
           AND sign(m.quantity::numeric) * CASE WHEN m.movement_type LIKE '%\\_REVERSAL' THEN -1 ELSE 1 END <>
               (CASE WHEN i.document_type IN ('invoice', 'delivery_challan') THEN CASE WHEN i.type = 'sale' THEN -1 ELSE 1 END
                     WHEN i.document_type = 'purchase_return' THEN -1
                     WHEN i.document_type IN ('sales_return', 'goods_receipt_note') THEN 1 ELSE 0 END)`),
      rule("stock_movements", "transfer-paired", "error",
        "A stock transfer moves the same quantity out of the source and into the destination warehouse, and both legs name both warehouses.",
        ["stock.transfer (Stock Transfers)"],
        `SELECT m.business_id, m.reference_id::text || '/' || m.item_id, 'transfer nets ' || SUM(m.quantity::numeric) ||
                ' over ' || COUNT(*) || ' legs'
         FROM stock_movements m WHERE m.reference_type = 'STOCK_TRANSFER'
         GROUP BY m.business_id, m.reference_id, m.item_id, m.variant_id
         HAVING ABS(SUM(m.quantity::numeric)) > ${QTY_TOLERANCE}
             OR bool_or(m.source_warehouse_id IS NULL OR m.destination_warehouse_id IS NULL OR m.source_warehouse_id = m.destination_warehouse_id)
             OR bool_or(m.movement_type = 'TRANSFER_OUT' AND m.warehouse_id <> m.source_warehouse_id)
             OR bool_or(m.movement_type = 'TRANSFER_IN' AND m.warehouse_id <> m.destination_warehouse_id)`),
      rule("stock_movements", "actor-recorded", "warning",
        "A movement a person caused records who (actor_user_id); only unplaced-stock placement is anonymous.",
        MOVEMENT_WRITERS,
        `SELECT m.business_id, m.id::text, m.reference_type || ' ' || m.movement_type || ' has no actor'
         FROM stock_movements m
         LEFT JOIN invoices i ON i.id = m.reference_id AND (m.reference_type LIKE 'INVOICE%' OR m.reference_type LIKE 'DOCUMENT%')
         WHERE m.actor_user_id IS NULL AND m.movement_type <> 'UNPLACED_STOCK'
           AND (i.id IS NULL OR i.source IS NULL OR i.source = 'pos')`),
      rule("stock_movements", "transfer-audited", "error",
        "A stock transfer has a stock.transfer audit entry for its reference id.",
        ["stock.transfer (Stock Transfers)"],
        `SELECT m.business_id, m.reference_id::text, 'transfer ' || m.reference_id || ' has no audit entry'
         FROM stock_movements m
         WHERE m.reference_type = 'STOCK_TRANSFER' AND m.movement_type = 'TRANSFER_OUT'
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = m.reference_id AND a.action LIKE 'stock.transfer')
         GROUP BY m.business_id, m.reference_id`),
    ],
  },
  {
    table: "stock_adjustments",
    rules: [
      rule("stock_adjustments", "arithmetic", "error",
        "new_stock = previous_stock + quantity, the quantity is not zero, and exactly one movement carries it.",
        ["stock.adjust (Stock Adjustments)", "stock.countPost / verify (Physical Stock)", "item.update (stock edit → setStockTotal)"],
        `SELECT a.business_id, a.id::text, 'prev ' || a.previous_stock || ' + ' || a.quantity || ' = ' || a.new_stock || ', movements ' ||
                (SELECT COUNT(*) FROM stock_movements m WHERE m.reference_id = a.id AND m.reference_type IN ('STOCK_ADJUSTMENT', 'PHYSICAL_STOCK'))
         FROM stock_adjustments a
         WHERE ABS(a.previous_stock::numeric + a.quantity::numeric - a.new_stock::numeric) > ${QTY_TOLERANCE}
            OR a.quantity::numeric = 0
            OR (SELECT COUNT(*) FROM stock_movements m WHERE m.reference_id = a.id AND m.reference_type IN ('STOCK_ADJUSTMENT', 'PHYSICAL_STOCK')) <> 1`),
      rule("stock_adjustments", "reason-and-user", "error",
        "An adjustment records why and by whom (stock.adjust requires a reason).",
        ["stock.adjust", "stock.countPost", "item.update (stock edit)"],
        `SELECT a.business_id, a.id::text, 'reason ' || COALESCE(a.reason, 'NULL') || ', by ' || COALESCE(a.created_by_user_id::text, 'NULL')
         FROM stock_adjustments a WHERE NULLIF(a.reason, '') IS NULL OR a.created_by_user_id IS NULL`),
      rule("stock_adjustments", "audit-trail", "error",
        "Every stock adjustment someone made is in the audit log (stock.adjust, stock.verify, stock.countPost/countFinish, item.adjustStock, or the item edit that changed the stock).",
        ["stock.adjust (Stock Adjustments)", "stock.verify / countFinish / countPost (Physical Stock)", "item.update / item.updateVariant / item.adjustStock"],
        `SELECT s.business_id, s.id::text, 'adjustment of ' || s.quantity || ' (' || COALESCE(s.reason, '') || ') has no audit entry'
         FROM stock_adjustments s
         WHERE s.created_by_user_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.business_id = s.business_id
                             AND (a.entity_id = s.id OR a.metadata LIKE '%' || s.id::text || '%'))`),
    ],
  },
  {
    table: "physical_stock_counts",
    rules: [
      rule("physical_stock_counts", "status-consistent", "error",
        "A count is 'saved' or 'posted'; a posted one has posted_at; it ends after it starts; its warehouse is the business's.",
        ["stock.countFinish / countPost (Physical Stock)"],
        `SELECT c.business_id, c.id::text, c.status || ': posted_at ' || COALESCE(c.posted_at::text, 'NULL') || ', ' || c.started_at || ' → ' || c.ended_at
         FROM physical_stock_counts c JOIN warehouses w ON w.id = c.warehouse_id
         WHERE c.status NOT IN ('saved', 'posted') OR (c.status = 'posted' AND c.posted_at IS NULL)
            OR (c.status = 'saved' AND c.posted_at IS NOT NULL) OR c.ended_at < c.started_at OR w.business_id <> c.business_id`),
      rule("physical_stock_counts", "audit-trail", "error",
        "A barcode count has a stock.countFinish / stock.countPost audit entry.",
        ["stock.countFinish / countPost (Physical Stock)"],
        `SELECT c.business_id, c.id::text, 'count of ' || c.scan_count || ' scans has no audit entry'
         FROM physical_stock_counts c WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = c.id AND a.action LIKE 'stock.count%')`),
    ],
  },
  {
    table: "boms",
    rules: [
      rule("boms", "complete", "error",
        "A BOM makes a positive quantity of an item of its business, has at least one component, and an item has at most one default BOM.",
        ["manufacturing.bomCreate / bomUpdate (Bill of Materials)"],
        `SELECT b.business_id, b.id::text, b.name || ': output ' || b.output_quantity || ', components ' ||
                (SELECT COUNT(*) FROM bom_components c WHERE c.bom_id = b.id)
         FROM boms b JOIN items i ON i.id = b.item_id
         WHERE b.output_quantity::numeric <= 0 OR i.business_id <> b.business_id
            OR NOT EXISTS (SELECT 1 FROM bom_components c WHERE c.bom_id = b.id)
            OR (b.is_default AND EXISTS (SELECT 1 FROM boms o WHERE o.is_default AND o.id <> b.id AND o.item_id = b.item_id
                                          AND o.variant_id IS NOT DISTINCT FROM b.variant_id))`),
      rule("boms", "audit-trail", "error",
        "A BOM has a manufacturing.bomCreate audit entry.",
        ["manufacturing.bomCreate (Bill of Materials)"],
        `SELECT b.business_id, b.id::text, 'BOM ' || b.name || ' has no audit entry'
         FROM boms b WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = b.id AND a.action LIKE 'manufacturing.bomCreate')`),
    ],
  },
  {
    table: "bom_components",
    rules: [
      rule("bom_components", "valid", "error",
        "A component is a positive quantity of another item of the business, with wastage between 0 and 100 %.",
        ["manufacturing.bomCreate / bomUpdate"],
        `SELECT b.business_id, c.id::text, b.name || ': component qty ' || c.quantity || ', wastage ' || c.wastage_percent
         FROM bom_components c JOIN boms b ON b.id = c.bom_id JOIN items i ON i.id = c.item_id
         WHERE c.quantity::numeric <= 0 OR c.wastage_percent::numeric NOT BETWEEN 0 AND 100
            OR i.business_id <> b.business_id
            OR (c.item_id = b.item_id AND c.variant_id IS NOT DISTINCT FROM b.variant_id)`),
    ],
  },
  {
    table: "bom_by_products",
    rules: [
      rule("bom_by_products", "valid", "error",
        "A by-product is a positive quantity of an item of the business.",
        ["manufacturing.bomCreate / bomUpdate"],
        `SELECT b.business_id, p.id::text, b.name || ': by-product qty ' || p.quantity
         FROM bom_by_products p JOIN boms b ON b.id = p.bom_id JOIN items i ON i.id = p.item_id
         WHERE p.quantity::numeric <= 0 OR i.business_id <> b.business_id`),
    ],
  },
  {
    table: "manufacturing_journals",
    rules: [
      rule("manufacturing_journals", "costing", "error",
        "components_cost = Σ component line amounts, additional_cost_total = Σ additional costs, total_cost = the two together, unit_cost = total ÷ quantity.",
        ["manufacturing.manufacture (Manufacturing)"],
        `SELECT j.business_id, j.id::text, j.journal_number || ': components ' || j.components_cost || '/' || COALESCE(l.amount, 0) ||
                ', additional ' || j.additional_cost_total || '/' || a.total || ', total ' || j.total_cost || ', unit ' || j.unit_cost
         FROM manufacturing_journals j
         LEFT JOIN (SELECT journal_id, SUM(amount::numeric) AS amount FROM manufacturing_journal_lines WHERE kind = 'component' GROUP BY journal_id) l
           ON l.journal_id = j.id
         CROSS JOIN LATERAL (SELECT COALESCE(SUM((e->>'amount')::numeric), 0) AS total FROM jsonb_array_elements(j.additional_costs) e) a
         WHERE ABS(j.components_cost::numeric - COALESCE(l.amount, 0)) > ${MONEY_TOLERANCE}
            OR ABS(j.additional_cost_total::numeric - a.total) > ${MONEY_TOLERANCE}
            OR ABS(j.total_cost::numeric - (j.components_cost::numeric + j.additional_cost_total::numeric)) > ${MONEY_TOLERANCE}
            OR j.quantity::numeric <= 0
            OR ABS(j.unit_cost::numeric - j.total_cost::numeric / NULLIF(j.quantity::numeric, 0)) > 0.0001`),
      rule("manufacturing_journals", "status-and-stock", "error",
        "A posted journal has at least one component and its movements net to −consumed per component and +produced for the finished item and by-products; a cancelled one has cancelled_at and nets to zero.",
        ["manufacturing.manufacture / cancel"],
        `WITH want AS (
           SELECT j.id AS journal_id, l.item_id, l.variant_id,
                  SUM(CASE WHEN l.kind = 'component' THEN -l.quantity::numeric ELSE l.quantity::numeric END) AS qty
           FROM manufacturing_journals j JOIN manufacturing_journal_lines l ON l.journal_id = j.id
           WHERE j.status = 'posted' GROUP BY 1, 2, 3
           UNION ALL
           SELECT j.id, j.item_id, j.variant_id, j.quantity::numeric FROM manufacturing_journals j WHERE j.status = 'posted'
         ),
         want_n AS (SELECT journal_id, item_id, variant_id, SUM(qty) AS qty FROM want GROUP BY 1, 2, 3),
         have AS (
           SELECT m.reference_id AS journal_id, m.item_id, m.variant_id, SUM(m.quantity::numeric) AS qty
           FROM stock_movements m WHERE m.reference_type LIKE 'MANUFACTURING%' GROUP BY 1, 2, 3
         )
         SELECT j.business_id, j.id::text, j.journal_number || ' (' || j.status || '): item ' || x.item_id || ' should net ' || COALESCE(x.want, 0) ||
                ', movements ' || COALESCE(x.have, 0)
         FROM (SELECT COALESCE(w.journal_id, h.journal_id) AS journal_id, COALESCE(w.item_id, h.item_id) AS item_id, w.qty AS want, h.qty AS have
               FROM want_n w FULL OUTER JOIN have h
                 ON h.journal_id = w.journal_id AND h.item_id = w.item_id AND h.variant_id IS NOT DISTINCT FROM w.variant_id) x
         JOIN manufacturing_journals j ON j.id = x.journal_id
         WHERE ABS(COALESCE(x.want, 0) - COALESCE(x.have, 0)) > ${QTY_TOLERANCE}
         UNION ALL
         SELECT j.business_id, j.id::text, j.journal_number || ': status ' || j.status || ', cancelled_at ' || COALESCE(j.cancelled_at::text, 'NULL') ||
                ', components ' || (SELECT COUNT(*) FROM manufacturing_journal_lines l WHERE l.journal_id = j.id AND l.kind = 'component')
         FROM manufacturing_journals j
         WHERE j.status NOT IN ('posted', 'cancelled')
            OR (j.status = 'cancelled' AND j.cancelled_at IS NULL)
            OR (j.status = 'posted' AND j.cancelled_at IS NOT NULL)
            OR NOT EXISTS (SELECT 1 FROM manufacturing_journal_lines l WHERE l.journal_id = j.id AND l.kind = 'component')`),
      rule("manufacturing_journals", "audit-trail", "error",
        "A production run has a manufacturing.manufacture audit entry, and a cancelled one a manufacturing.cancel entry.",
        ["manufacturing.manufacture / cancel (Manufacturing)"],
        `SELECT j.business_id, j.id::text, j.journal_number || ' (' || j.status || ') is missing its audit entry'
         FROM manufacturing_journals j
         WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = j.id AND a.action LIKE 'manufacturing.manufacture')
            OR (j.status = 'cancelled' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = j.id AND a.action LIKE 'manufacturing.cancel'))`),
    ],
  },
  {
    table: "manufacturing_journal_lines",
    rules: [
      rule("manufacturing_journal_lines", "line-cost", "error",
        "A component line's amount is quantity × unit cost; quantities are positive; kind is component or by_product.",
        ["manufacturing.manufacture"],
        `SELECT j.business_id, l.id::text, j.journal_number || ' ' || l.kind || ': ' || l.quantity || ' × ' || l.unit_cost || ' = ' || l.amount
         FROM manufacturing_journal_lines l JOIN manufacturing_journals j ON j.id = l.journal_id
         WHERE l.kind NOT IN ('component', 'by_product') OR l.quantity::numeric <= 0
            OR (l.kind = 'component' AND ABS(l.amount::numeric - ROUND(l.quantity::numeric * l.unit_cost::numeric, 2)) > ${MONEY_TOLERANCE})`),
    ],
  },
];
