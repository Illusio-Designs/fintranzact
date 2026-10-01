/**
 * Masters: the business itself, its warehouses, parties and items.
 */

import type { TableCoverage } from "../types.js";
import { GSTIN_PATTERN, GST_RATES, QTY_TOLERANCE, rule, userEntered } from "../sql-fragments.js";

const BUSINESS_SETUP = ["business.create (Onboarding / Settings → Business)", "business.update"];

export const masterTables: TableCoverage[] = [
  {
    table: "businesses",
    rules: [
      rule("businesses", "gstin-state-code", "error",
        "A business with a GSTIN has the GSTIN's state code (its first two digits) as state_code — every intra/inter-state (CGST+SGST vs IGST) decision compares state codes. Other-territory assessees use 97.",
        BUSINESS_SETUP,
        `SELECT b.id AS business_id, b.id::text AS row_id,
                'gstin ' || b.gstin || ' but state_code ' || COALESCE(b.state_code, 'NULL') AS detail
         FROM businesses b
         WHERE NULLIF(b.gstin, '') IS NOT NULL
           AND NOT b.assessee_of_other_territory
           AND b.state_code IS DISTINCT FROM LEFT(b.gstin, 2)`),
      rule("businesses", "registered-needs-state", "error",
        "A GST-registered business (regular/composition) has a state_code — without it no invoice can be split into CGST+SGST or IGST.",
        BUSINESS_SETUP,
        `SELECT b.id, b.id::text, 'gst_registration_type ' || b.gst_registration_type || ' with no state_code'
         FROM businesses b
         WHERE b.gst_registration_type IN ('regular', 'composition') AND NULLIF(b.state_code, '') IS NULL`),
      rule("businesses", "registered-needs-gstin", "warning",
        "A regular/composition business has a GSTIN (GSTR-1, e-invoice and e-way bill all need it).",
        BUSINESS_SETUP,
        `SELECT b.id, b.id::text, 'gst_registration_type ' || b.gst_registration_type || ' with no GSTIN'
         FROM businesses b
         WHERE b.gst_registration_type IN ('regular', 'composition') AND NULLIF(b.gstin, '') IS NULL`),
      rule("businesses", "gstin-format", "error",
        "A stored GSTIN has the 15-character GSTIN shape.",
        BUSINESS_SETUP,
        `SELECT b.id, b.id::text, 'gstin ' || b.gstin
         FROM businesses b
         WHERE NULLIF(b.gstin, '') IS NOT NULL AND b.gstin !~ ${GSTIN_PATTERN}`),
      rule("businesses", "pan-matches-gstin", "warning",
        "When both are set, the PAN is characters 3–12 of the GSTIN.",
        BUSINESS_SETUP,
        `SELECT b.id, b.id::text, 'pan ' || b.pan || ' vs gstin ' || b.gstin
         FROM businesses b
         WHERE NULLIF(b.gstin, '') IS NOT NULL AND NULLIF(b.pan, '') IS NOT NULL
           AND b.gstin ~ ${GSTIN_PATTERN} AND SUBSTRING(b.gstin FROM 3 FOR 10) <> b.pan`),
      rule("businesses", "setup-complete", "error",
        "business.create writes, in the same transaction: an admin business_member, inventory_settings (default warehouses), a Cash account, the Walk-in Customer party and the chart of accounts.",
        ["business.create"],
        `SELECT b.id, b.id::text, 'missing: ' || concat_ws(', ',
                  CASE WHEN NOT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = b.id AND m.role = 'admin') THEN 'admin member' END,
                  CASE WHEN NOT EXISTS (SELECT 1 FROM inventory_settings s WHERE s.business_id = b.id) THEN 'inventory_settings' END,
                  CASE WHEN NOT EXISTS (SELECT 1 FROM bank_accounts a WHERE a.business_id = b.id AND a.account_type = 'cash') THEN 'cash account' END,
                  CASE WHEN NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.business_id = b.id) THEN 'chart of accounts' END)
         FROM businesses b
         WHERE NOT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = b.id AND m.role = 'admin')
            OR NOT EXISTS (SELECT 1 FROM inventory_settings s WHERE s.business_id = b.id)
            OR NOT EXISTS (SELECT 1 FROM bank_accounts a WHERE a.business_id = b.id AND a.account_type = 'cash')
            OR NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.business_id = b.id)`),
    ],
  },
  {
    table: "business_members",
    rules: [],
    noExtraRequirements:
      "business_id is a real FK, role is an enum and (business_id, user_id) is unique. user_id points at the control-plane users table, which in cloud mode lives in another database, so it cannot be checked from here.",
  },
  {
    table: "inventory_settings",
    rules: [
      rule("inventory_settings", "defaults-complete", "error",
        "Every default warehouse (sales, purchase, both returns, production, adjustment) is set, belongs to the same business and is active — getDefaultWarehouse() throws for an operation whose default is missing.",
        ["business.create → ensureDefaultWarehouse", "warehouse.inventorySettingsUpdate (Warehouses → Settings)"],
        `SELECT s.business_id, s.id::text, 'bad default for ' || k.op || ': ' || COALESCE(k.wh::text, 'NULL')
         FROM inventory_settings s
         CROSS JOIN LATERAL (VALUES
           ('sale', s.sales_warehouse_id), ('purchase', s.purchase_warehouse_id),
           ('sales_return', s.sales_return_warehouse_id), ('purchase_return', s.purchase_return_warehouse_id),
           ('production', s.production_warehouse_id), ('stock_adjustment', s.stock_adjustment_warehouse_id)) AS k(op, wh)
         LEFT JOIN warehouses w ON w.id = k.wh
         WHERE k.wh IS NULL OR w.business_id <> s.business_id OR w.status <> 'active'`),
      rule("inventory_settings", "policy-values", "error",
        "negative_stock_policy is allow|warn|block and valuation_method is weighted_average|fifo (free-text columns read by stock and valuation code).",
        ["stock.updateSettings (Stock → Settings)"],
        `SELECT s.business_id, s.id::text, 'policy ' || s.negative_stock_policy || ', valuation ' || s.valuation_method
         FROM inventory_settings s
         WHERE s.negative_stock_policy NOT IN ('allow', 'warn', 'block')
            OR s.valuation_method NOT IN ('weighted_average', 'fifo')`),
    ],
  },
  {
    table: "warehouse_permissions",
    rules: [
      rule("warehouse_permissions", "same-business", "error",
        "The member and the warehouse a permission links belong to the permission's business.",
        ["warehouse.warehousePermissionCreate / warehouse.accessSet (Warehouses → Access)"],
        `SELECT p.business_id, p.id::text, 'member business ' || m.business_id || ', warehouse business ' || w.business_id
         FROM warehouse_permissions p
         JOIN business_members m ON m.id = p.business_member_id
         JOIN warehouses w ON w.id = p.warehouse_id
         WHERE m.business_id <> p.business_id OR w.business_id <> p.business_id`),
      rule("warehouse_permissions", "audit-trail", "error",
        "A warehouse permission was granted through warehouse.permissionCreate or warehouse.accessSet, which are audited.",
        ["warehouse.warehousePermissionCreate / accessSet (Warehouses → Access)"],
        `SELECT p.business_id, p.id::text, 'permission on warehouse ' || p.warehouse_id || ' has no audit entry'
         FROM warehouse_permissions p
         WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.business_id = p.business_id AND a.action LIKE 'warehouse.%'
                             AND (a.entity_id = p.id OR (a.entity_id = p.warehouse_id AND a.metadata LIKE '%' || p.business_member_id::text || '%')))`),
    ],
  },
  {
    table: "premises",
    rules: [
      rule("premises", "audit-trail", "error",
        "A premise someone added (not the default MAIN one ensureDefaultWarehouse makes) has a warehouse.premiseCreate audit entry. (Otherwise premises carry only descriptive fields.)",
        ["warehouse.premiseCreate (Warehouses)"],
        `SELECT x.business_id, x.id::text, x.code || ' ' || x.name || ' has no audit entry'
         FROM premises x WHERE NOT (x.code = 'MAIN' AND EXISTS (SELECT 1 FROM inventory_settings s WHERE s.business_id = x.business_id)) AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = x.id AND a.action LIKE 'warehouse.premiseCreate')`),
    ],
  },
  {
    table: "warehouses",
    rules: [
      rule("warehouses", "premise-same-business", "error",
        "A warehouse sits on a premise of its own business.",
        ["warehouse.warehouseCreate / warehouseUpdate (Warehouses)", "ensureDefaultWarehouse"],
        `SELECT w.business_id, w.id::text, 'premise ' || p.id || ' belongs to business ' || p.business_id
         FROM warehouses w JOIN premises p ON p.id = w.premise_id
         WHERE p.business_id <> w.business_id`),
      rule("warehouses", "audit-trail", "error",
        "A warehouse someone added (not the default MAIN one) has a warehouse.warehouseCreate audit entry.",
        ["warehouse.warehouseCreate (Warehouses)"],
        `SELECT x.business_id, x.id::text, x.code || ' ' || x.name || ' has no audit entry'
         FROM warehouses x WHERE NOT (x.code = 'MAIN' AND EXISTS (SELECT 1 FROM inventory_settings s WHERE s.business_id = x.business_id)) AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = x.id AND a.action LIKE 'warehouse.warehouseCreate')`),
    ],
  },
  {
    table: "warehouse_locations",
    rules: [
      rule("warehouse_locations", "parent-in-warehouse", "error",
        "parent_id has no FK: when set it must name another location of the same warehouse.",
        ["warehouse.locationCreate / locationUpdate (Warehouses → Locations)"],
        `SELECT w.business_id, l.id::text, 'parent ' || l.parent_id || ' ' ||
                CASE WHEN p.id IS NULL THEN 'does not exist' ELSE 'is in warehouse ' || p.warehouse_id END
         FROM warehouse_locations l
         JOIN warehouses w ON w.id = l.warehouse_id
         LEFT JOIN warehouse_locations p ON p.id = l.parent_id
         WHERE l.parent_id IS NOT NULL AND (p.id IS NULL OR p.warehouse_id <> l.warehouse_id OR p.id = l.id)`),
      rule("warehouse_locations", "audit-trail", "error",
        "A location has a warehouse.locationCreate audit entry.",
        ["warehouse.locationCreate (Warehouses → Locations)"],
        `SELECT w.business_id, l.id::text, l.code || ' ' || l.name || ' has no audit entry'
         FROM warehouse_locations l JOIN warehouses w ON w.id = l.warehouse_id
         WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = l.id AND a.action LIKE 'warehouse.locationCreate')`),
    ],
  },
  {
    table: "parties",
    rules: [
      rule("parties", "gstin-format", "error",
        "A stored GSTIN has the GSTIN shape (createPartySchema regex; imports must normalise too).",
        ["party.create / party.update (Parties)", "import.* parties"],
        `SELECT p.business_id, p.id::text, 'gstin ' || p.gstin
         FROM parties p WHERE NULLIF(p.gstin, '') IS NOT NULL AND p.gstin !~ ${GSTIN_PATTERN}`),
      rule("parties", "gstin-needs-state-code", "error",
        "A party with a GSTIN has a state_code: party.create derives it from the GSTIN when the form leaves it blank, and GST reports/ITC need it to pick CGST+SGST vs IGST.",
        ["party.create / party.update (Parties)", "party.merge", "import.* parties"],
        `SELECT p.business_id, p.id::text, 'gstin ' || p.gstin || ' with no state_code'
         FROM parties p WHERE NULLIF(p.gstin, '') IS NOT NULL AND NULLIF(p.state_code, '') IS NULL`),
      rule("parties", "state-code-matches-gstin", "warning",
        "The state_code equals the GSTIN's first two digits (the form only warns: 'GST will be split wrongly').",
        ["party.create / party.update (Parties)"],
        `SELECT p.business_id, p.id::text, 'gstin ' || p.gstin || ' but state_code ' || p.state_code
         FROM parties p
         WHERE NULLIF(p.gstin, '') IS NOT NULL AND p.gstin ~ ${GSTIN_PATTERN}
           AND NULLIF(p.state_code, '') IS NOT NULL AND p.state_code <> LEFT(p.gstin, 2)`),
      rule("parties", "pan-matches-gstin", "warning",
        "The PAN is characters 3–12 of the GSTIN (party.create derives it when blank).",
        ["party.create / party.update (Parties)"],
        `SELECT p.business_id, p.id::text, 'pan ' || COALESCE(p.pan, 'NULL') || ' vs gstin ' || p.gstin
         FROM parties p
         WHERE NULLIF(p.gstin, '') IS NOT NULL AND p.gstin ~ ${GSTIN_PATTERN}
           AND p.pan IS DISTINCT FROM SUBSTRING(p.gstin FROM 3 FOR 10)`),
      rule("parties", "registered-needs-gstin", "warning",
        "A party marked regular/composition/SEZ has a GSTIN (it decides B2B vs B2C in GSTR-1).",
        ["party.create / party.update (Parties)"],
        `SELECT p.business_id, p.id::text, 'gst_registration_type ' || p.gst_registration_type || ' with no GSTIN'
         FROM parties p WHERE p.gst_registration_type IN ('regular', 'composition', 'sez') AND NULLIF(p.gstin, '') IS NULL`),
      rule("parties", "price-level-same-business", "error",
        "A party's price level belongs to the party's business.",
        ["party.create / party.update (Parties)"],
        `SELECT p.business_id, p.id::text, 'price level of business ' || l.business_id
         FROM parties p JOIN price_levels l ON l.id = p.price_level_id WHERE l.business_id <> p.business_id`),
      rule("parties", "audit-trail", "error",
        "A party a user created (source NULL, not the Walk-in Customer seeded inside business.create) has a party.create audit entry.",
        ["party.create (Parties)"],
        `SELECT p.business_id, p.id::text, 'no party.create audit entry for ' || p.name
         FROM parties p JOIN businesses b ON b.id = p.business_id
         WHERE ${userEntered("p")} AND p.created_at <> b.created_at
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = p.id AND a.action = 'party.create')`),
    ],
  },
  {
    table: "stock_groups",
    rules: [
      rule("stock_groups", "parent-same-business", "error",
        "A group's parent is a group of the same business and the tree has no cycle.",
        ["stockGroup.create / stockGroup.move (Stock Groups)", "resolveItemGroup (item form category)"],
        `WITH RECURSIVE walk(id, business_id, parent_id, depth, path) AS (
           SELECT g.id, g.business_id, g.parent_id, 0, ARRAY[g.id] FROM stock_groups g
           UNION ALL
           SELECT w.id, w.business_id, p.parent_id, w.depth + 1, w.path || p.id
           FROM walk w JOIN stock_groups p ON p.id = w.parent_id
           WHERE w.depth < 50 AND NOT p.id = ANY(w.path)
         )
         SELECT g.business_id, g.id::text, 'parent ' || p.id || ' in business ' || p.business_id
         FROM stock_groups g JOIN stock_groups p ON p.id = g.parent_id WHERE p.business_id <> g.business_id
         UNION ALL
         SELECT w.business_id, w.id::text, 'cycle through ' || w.parent_id
         FROM walk w WHERE w.parent_id = w.id OR w.parent_id = ANY(w.path[2:])`),
    ],
  },
  {
    table: "items",
    rules: [
      rule("items", "category-mirrors-group", "error",
        "When an item hangs off a stock group, items.category equals the group's name (older readers — CLI, mobile, store — still read category).",
        ["item.create / item.update (Items)", "stockGroup.rename / stockGroup.delete"],
        `SELECT i.business_id, i.id::text, 'category ' || COALESCE(i.category, 'NULL') || ' vs group ' || g.name
         FROM items i JOIN stock_groups g ON g.id = i.stock_group_id
         WHERE i.category IS DISTINCT FROM g.name OR g.business_id <> i.business_id`),
      rule("items", "stock-equals-movements", "error",
        "An active product's stock_quantity (base unit, non-variant) equals the sum of its stock movements — every change goes through recordStockMovement(). A soft-deleted item's figure is frozen history (item.merge moves its movements to the target), so it is not held to this.",
        ["item.create (opening stock)", "invoice.* / document.* (syncDocumentStock)", "stock.adjust / stock.transfer", "manufacturing.manufacture"],
        `SELECT i.business_id, i.id::text, 'stock_quantity ' || i.stock_quantity || ' vs movements ' || COALESCE(m.qty, 0)
         FROM items i
         LEFT JOIN (SELECT item_id, SUM(quantity::numeric) AS qty FROM stock_movements WHERE variant_id IS NULL GROUP BY item_id) m
           ON m.item_id = i.id
         WHERE i.item_type = 'product' AND i.deleted_at IS NULL
           AND ABS(i.stock_quantity::numeric - COALESCE(m.qty, 0)) > ${QTY_TOLERANCE}`),
      rule("items", "service-holds-no-stock", "error",
        "Services don't carry stock (lockTotal refuses them; stock reports skip them): a service has zero stock_quantity.",
        ["invoice.create / document.* (syncDocumentStock)", "item.create / item.update"],
        `SELECT i.business_id, i.id::text, 'service ' || i.name || ' has stock_quantity ' || i.stock_quantity
         FROM items i WHERE i.item_type = 'service' AND i.stock_quantity::numeric <> 0`),
      rule("items", "variant-mode-has-variants", "warning",
        "An item in 'variants' mode names its variant attributes and has at least one active variant (otherwise it can't be billed or stocked).",
        ["item.create / item.createVariant (Items → Variants)"],
        `SELECT i.business_id, i.id::text, 'variants item with ' ||
                COALESCE(jsonb_array_length(i.variant_attributes), 0) || ' attributes and no active variant'
         FROM items i
         WHERE i.item_mode = 'variants' AND i.deleted_at IS NULL
           AND (COALESCE(jsonb_array_length(i.variant_attributes), 0) = 0
                OR NOT EXISTS (SELECT 1 FROM item_variants v WHERE v.item_id = i.id AND v.deleted_at IS NULL))`),
      rule("items", "alt-units-defined", "warning",
        "An 'alt_units' item lists its alternate units, each with a positive conversion factor.",
        ["item.create / item.update / item.switchBaseUnit (Items)"],
        `SELECT i.business_id, i.id::text, 'unit_variants ' || COALESCE(i.unit_variants::text, 'NULL')
         FROM items i
         WHERE i.item_mode = 'alt_units' AND i.deleted_at IS NULL
           AND (COALESCE(jsonb_array_length(i.unit_variants), 0) = 0
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(i.unit_variants) u
                           WHERE COALESCE((u->>'conversionFactor')::numeric, 0) <= 0 OR NULLIF(u->>'unit', '') IS NULL))`),
      rule("items", "gst-rate-valid", "warning",
        "An item's tax_percent is a GST rate (0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40).",
        ["item.create / item.update (Items)", "import.* items"],
        `SELECT i.business_id, i.id::text, 'tax_percent ' || i.tax_percent
         FROM items i WHERE i.deleted_at IS NULL AND i.tax_percent::numeric NOT IN ${GST_RATES}`),
      rule("items", "hsn-when-gst-registered", "warning",
        "A GST-registered business's taxable item has a 4–8 digit HSN/SAC — GSTR-1 table 12 otherwise reports it under '0000'.",
        ["item.create / item.update (Items)", "import.* items"],
        `SELECT i.business_id, i.id::text, 'hsn ' || COALESCE(i.hsn, 'NULL') || ' on ' || i.name
         FROM items i JOIN businesses b ON b.id = i.business_id
         WHERE b.gst_registration_type = 'regular' AND i.deleted_at IS NULL AND i.tax_percent::numeric > 0
           AND (NULLIF(i.hsn, '') IS NULL OR i.hsn !~ '^[0-9]{4}([0-9]{2}){0,2}$')`),
      rule("items", "sale-price-within-mrp", "warning",
        "The sale price does not exceed the printed MRP (Legal Metrology; mrpWarning).",
        ["item.create / item.update (Items)"],
        `SELECT i.business_id, i.id::text, 'sale ' || i.sale_price || ' > mrp ' || i.mrp
         FROM items i WHERE i.deleted_at IS NULL AND i.mrp::numeric > 0 AND i.sale_price::numeric > i.mrp::numeric + 0.0001`),
      rule("items", "audit-trail", "error",
        "An item a user created (source NULL) has an item.create audit entry.",
        ["item.create (Items)"],
        `SELECT i.business_id, i.id::text, 'no item.create audit entry for ' || i.name
         FROM items i
         WHERE i.source IS NULL
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = i.id AND a.action = 'item.create')`),
    ],
  },
  {
    table: "item_variants",
    rules: [
      rule("item_variants", "parent-is-variants-item", "error",
        "A variant belongs to an item in 'variants' mode.",
        ["item.create / item.createVariant (Items → Variants)"],
        `SELECT i.business_id, v.id::text, 'parent item mode ' || i.item_mode
         FROM item_variants v JOIN items i ON i.id = v.item_id
         WHERE v.deleted_at IS NULL AND i.item_mode <> 'variants'`),
      rule("item_variants", "attributes-match-item", "warning",
        "A variant's attribute names are the item's variant_attributes.",
        ["item.create / item.createVariant / item.updateVariant"],
        `SELECT i.business_id, v.id::text, 'attributes ' || v.attribute_values::text || ' vs item ' || COALESCE(i.variant_attributes::text, 'NULL')
         FROM item_variants v JOIN items i ON i.id = v.item_id
         WHERE v.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM jsonb_object_keys(v.attribute_values) k
                       WHERE NOT COALESCE(i.variant_attributes, '[]'::jsonb) ? k)`),
      rule("item_variants", "stock-equals-movements", "error",
        "An active variant's stock_quantity equals the sum of its stock movements.",
        ["item.create / item.createVariant (opening stock)", "invoice.* / document.*", "stock.adjust / stock.transfer"],
        `SELECT i.business_id, v.id::text, 'stock_quantity ' || v.stock_quantity || ' vs movements ' || COALESCE(m.qty, 0)
         FROM item_variants v JOIN items i ON i.id = v.item_id
         LEFT JOIN (SELECT variant_id, SUM(quantity::numeric) AS qty FROM stock_movements WHERE variant_id IS NOT NULL GROUP BY variant_id) m
           ON m.variant_id = v.id
         WHERE v.deleted_at IS NULL AND i.deleted_at IS NULL
           AND ABS(v.stock_quantity::numeric - COALESCE(m.qty, 0)) > ${QTY_TOLERANCE}`),
    ],
  },
  {
    table: "item_batches",
    rules: [
      rule("item_batches", "belongs-to-item", "error",
        "A batch belongs to an item of its business that tracks batches; a variant batch names a variant of that item, and a variants-mode item's batches always name the variant.",
        ["batch.create / batch.update (Items → Batches)", "resolveLineBatches / findOrCreateBatch (documents, adjustments, opening stock)"],
        `SELECT b.business_id, b.id::text, 'batch ' || b.batch_number || ' of ' || i.name ||
                CASE WHEN i.business_id <> b.business_id THEN ' (another business)'
                     WHEN v.id IS NOT NULL AND v.item_id <> b.item_id THEN ' (variant of another item)'
                     WHEN i.item_mode = 'variants' AND b.variant_id IS NULL THEN ' (no variant on a variants item)'
                     ELSE ' (item does not track batches)' END
         FROM item_batches b JOIN items i ON i.id = b.item_id LEFT JOIN item_variants v ON v.id = b.variant_id
         WHERE i.business_id <> b.business_id
            OR (b.variant_id IS NOT NULL AND v.item_id <> b.item_id)
            OR (i.item_mode = 'variants' AND b.variant_id IS NULL)
            OR (NOT i.track_batches AND i.deleted_at IS NULL
                AND EXISTS (SELECT 1 FROM stock_movements m WHERE m.batch_id = b.id)
                AND (SELECT SUM(m.quantity::numeric) FROM stock_movements m WHERE m.batch_id = b.id) <> 0)`),
      rule("item_batches", "dates", "error",
        "A batch expires on or after it was made; a batch of an item that tracks expiry has an expiry date once it has received stock.",
        ["findOrCreateBatch (lib/batches.ts)", "batch.update"],
        `SELECT b.business_id, b.id::text, 'batch ' || b.batch_number || ': mfg ' || COALESCE(b.mfg_date::text, '-') || ', expiry ' || COALESCE(b.expiry_date::text, 'NULL')
         FROM item_batches b JOIN items i ON i.id = b.item_id
         WHERE (b.mfg_date IS NOT NULL AND b.expiry_date IS NOT NULL AND b.expiry_date < b.mfg_date)
            OR (i.track_expiry AND b.expiry_date IS NULL
                AND EXISTS (SELECT 1 FROM stock_movements m WHERE m.batch_id = b.id AND m.quantity::numeric > 0))`),
      rule("item_batches", "stock-not-negative", "warning",
        "A batch's stock in a warehouse — the sum of the movements naming it there (no batch figure is stored) — is not negative. Documents under the 'block' policy refuse it; 'warn'/'allow' let it through.",
        ["syncDocumentStock / resolveLineBatches", "stock.adjust / stock.transfer"],
        `SELECT b.business_id, b.id::text || '@' || m.warehouse_id, 'batch ' || b.batch_number || ' holds ' || SUM(m.quantity::numeric) || ' in warehouse ' || m.warehouse_id
         FROM item_batches b JOIN stock_movements m ON m.batch_id = b.id
         GROUP BY b.id, b.business_id, b.batch_number, m.warehouse_id
         HAVING SUM(m.quantity::numeric) < -${QTY_TOLERANCE}`),
      rule("item_batches", "audit-trail", "error",
        "A batch someone created on the Batches screen has a batch.create audit entry; one created from a document line, adjustment or opening stock is traced by that line/movement instead.",
        ["batch.create (Items → Batches)"],
        `SELECT b.business_id, b.id::text, 'batch ' || b.batch_number || ' has no audit entry and no line or movement naming it'
         FROM item_batches b
         WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM invoice_items li WHERE li.batch_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.batch_id = b.id)`),
    ],
  },
  {
    table: "item_barcodes",
    rules: [
      rule("item_barcodes", "belongs-to-item", "error",
        "An extra code's business is its item's business, and its variant (if any) is a variant of that item.",
        ["barcode.addItemCode (Items → Barcodes)", "ensureBarcodeForStock (purchase invoice)"],
        `SELECT c.business_id, c.id::text, 'item business ' || i.business_id || COALESCE(', variant of ' || v.item_id, '')
         FROM item_barcodes c JOIN items i ON i.id = c.item_id
         LEFT JOIN item_variants v ON v.id = c.variant_id
         WHERE i.business_id <> c.business_id OR (c.variant_id IS NOT NULL AND v.item_id <> c.item_id)`),
      rule("item_barcodes", "code-unique-in-business", "error",
        "A code scans to exactly one thing: no extra code repeats an item's or variant's own barcode in the same business (assertCodeFree).",
        ["barcode.addItemCode", "item.create / item.update"],
        `SELECT c.business_id, c.id::text, 'code ' || c.code || ' is also the barcode of item ' || i.id
         FROM item_barcodes c JOIN items i ON i.business_id = c.business_id AND i.barcode = c.code AND i.deleted_at IS NULL
         UNION ALL
         SELECT c.business_id, c.id::text, 'code ' || c.code || ' is also the barcode of variant ' || v.id
         FROM item_barcodes c JOIN items i ON i.business_id = c.business_id
         JOIN item_variants v ON v.item_id = i.id AND v.barcode = c.code AND v.deleted_at IS NULL`),
      rule("item_barcodes", "pack-qty-positive", "error",
        "pack_qty (pieces per scan) is positive.",
        ["barcode.addItemCode"],
        `SELECT c.business_id, c.id::text, 'pack_qty ' || c.pack_qty FROM item_barcodes c WHERE c.pack_qty::numeric <= 0`),
    ],
  },
  {
    table: "price_levels",
    rules: [],
    noExtraRequirements:
      "name is NOT NULL, (business_id, name) is unique and at most one default per business is enforced by a partial unique index; description and sort_order are cosmetic.",
  },
  {
    table: "price_list_entries",
    rules: [
      rule("price_list_entries", "price-or-discount", "error",
        "An entry sets a price, a discount, or both (priceSlabSchema refine) — one with neither prices nothing.",
        ["priceLevel.bulkUpdate / priceLevel.setItemPrices (Price Levels)"],
        `SELECT e.business_id, e.id::text, 'no price and no discount'
         FROM price_list_entries e WHERE e.price IS NULL AND e.discount_percent IS NULL`),
      rule("price_list_entries", "same-business", "error",
        "The entry's level and item belong to its business, and its variant (if any) is a variant of the item.",
        ["priceLevel.* (Price Levels)"],
        `SELECT e.business_id, e.id::text, 'level business ' || l.business_id || ', item business ' || i.business_id
         FROM price_list_entries e
         JOIN price_levels l ON l.id = e.price_level_id JOIN items i ON i.id = e.item_id
         LEFT JOIN item_variants v ON v.id = e.variant_id
         WHERE l.business_id <> e.business_id OR i.business_id <> e.business_id
            OR (e.variant_id IS NOT NULL AND v.item_id <> e.item_id)`),
      rule("price_list_entries", "discount-range", "error",
        "discount_percent is between 0 and 100 and min_quantity is not negative.",
        ["priceLevel.*"],
        `SELECT e.business_id, e.id::text, 'discount ' || COALESCE(e.discount_percent::text, 'NULL') || ', min qty ' || e.min_quantity
         FROM price_list_entries e
         WHERE e.discount_percent::numeric NOT BETWEEN 0 AND 100 OR e.min_quantity::numeric < 0`),
    ],
  },
];
