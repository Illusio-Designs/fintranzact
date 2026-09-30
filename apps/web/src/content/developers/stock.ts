import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const stockEndpoints: EndpointGroup = {
  id: "stock",
  title: "Stock",
  description: "Warehouse-level stock: balances per warehouse, transfers between warehouses, stock adjustments, physical verification and barcode stock counts, plus the business-wide inventory policy. Stock has two layers: `items.stockQuantity` / `item_variants.stockQuantity` is the business-wide total every other screen reads, and `stock_balances` splits it by warehouse. Every write records a stock movement that updates both together. Data from before warehouses existed can leave stock no warehouse accounts for (\"unplaced\"); it is treated as sitting in the default warehouse (the sales warehouse in inventory settings) — read endpoints add it there, and write endpoints first move it there for real with an `OPENING_BALANCE` / `UNPLACED_STOCK` movement. Only product items carry stock; services are skipped, and a variant-mode item is tracked per variant. Quantities are strings with up to 3 decimals. Transfers and adjustments are gated by the caller's role (`Item:update`) and, for non-admins, by per-warehouse grants set with `warehouse.accessSet` (`canTransfer`, `canAdjust`); owners and admins work in every warehouse. The negative stock policy (`allow`, `warn`, `block`) governs documents such as invoices; transfers and manual adjustments always refuse to take a warehouse below zero. The valuation method (`weighted_average` or `fifo`) prices closing stock in the stock summary, P&L and balance sheet; nothing is posted to the ledger. None of these endpoints write an audit log entry; the stock movement and stock adjustment rows (with actor user and name) are the trail.",
  endpoints: [
    {
      id: "stock-setup",
      method: "mutation",
      path: "stock.setup",
      title: "Ensure Default Warehouse",
      description: "Make sure the business has inventory settings pointing at a warehouse. If it has none, reuses any active warehouse, or creates a \"Main premises\" premise and \"Main warehouse\" (both code `MAIN`, type `main`, address copied from the business), and sets it as the default for all six operations. Idempotent and safe to call concurrently.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Acknowledgement.",
        example: { ok: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stock.setup \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{}}'`,
        javascript: `await trpc.stock.setup.mutate();
const warehouses = await trpc.stock.warehouses.query();`,
      },
      gotchas: [
        "Requires only `Item:read` permission, even though it is a mutation that can create a premise, a warehouse and the settings row.",
        "New businesses already get this at registration; older businesses get it lazily the first time stock moves or `stock.settings` is read, so you rarely need to call it.",
        "Does nothing if a settings row exists — even one whose default warehouses were cleared to `null`.",
      ],
      relatedEndpoints: ["stock-settings", "stock-warehouses", "warehouse-inventory-settings-get"],
    },
    {
      id: "stock-warehouses",
      method: "query",
      path: "stock.warehouses",
      title: "Warehouses with Stock",
      description: "Every warehouse of the business (active and inactive, sorted by name) with its premise name, how many stock units it holds and its total quantity. The default warehouse is flagged and its quantity includes unplaced stock.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of warehouses. `units` is the number of non-zero balance rows (item or variant, per location) and excludes unplaced stock; `quantity` is the sum of all balances (plus unplaced stock for the default warehouse).",
        example: [
          {
            id: "wh-uuid",
            name: "Main warehouse",
            code: "MAIN",
            warehouseType: "main",
            address: "12 MG Road, Pune, Maharashtra, 411001",
            status: "active",
            premiseName: "Main premises",
            units: 148,
            quantity: "5320.500",
            isDefault: true,
          },
          {
            id: "wh-uuid-2",
            name: "Bhiwandi Finished Goods",
            code: "BHW-FG",
            warehouseType: "finished_goods",
            address: "Gala No. 14, Rahnal Village, Bhiwandi",
            status: "active",
            premiseName: "Bhiwandi Godown",
            units: 36,
            quantity: "1240.000",
            isDefault: false,
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.warehouses" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const warehouses = await trpc.stock.warehouses.query();
const def = warehouses.find(w => w.isDefault);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "`quantity` adds up every unit regardless of unit of measure (kg + pcs + litres), so treat it as an activity indicator, not a meaningful total.",
        "If no sales warehouse is configured, the first active warehouse by name is flagged `isDefault` and receives the unplaced stock in this view.",
      ],
      relatedEndpoints: ["stock-balances", "warehouse-warehouse-list", "stock-setup"],
    },
    {
      id: "stock-balances",
      method: "query",
      path: "stock.balances",
      title: "Stock Balances by Warehouse",
      description: "Paginated stock per stock unit, split by warehouse. A stock unit is a simple / alt-unit product item, or one variant of a variant-mode item (the parent item itself is not listed; the variant name is the item name plus its attribute values). Service items and deleted items are excluded. Sorted by name.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string | null", required: false, description: "Case-insensitive match on the unit name or SKU (max 100 chars)" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Rows per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated units. `total` (per row) is the business-wide stock; `byWarehouse` maps warehouse ID to quantity, with unplaced stock folded into `defaultWarehouseId`. `lowStock` is the item or variant low-stock alert threshold.",
        example: {
          data: [
            {
              itemId: "item-uuid",
              variantId: null,
              name: "Basmati Rice 25kg Bag",
              sku: "RICE-BAS-25",
              unit: "bag",
              total: "320.000",
              lowStock: "40.000",
              byWarehouse: { "wh-uuid": "200.000", "wh-uuid-2": "120.000" },
            },
            {
              itemId: "item-uuid-2",
              variantId: "variant-uuid",
              name: "Cotton Kurta — M / Indigo",
              sku: "KUR-M-IND",
              unit: "pcs",
              total: "45.000",
              lowStock: null,
              byWarehouse: { "wh-uuid": "45.000" },
            },
          ],
          total: 184,
          page: 1,
          limit: 20,
          defaultWarehouseId: "wh-uuid",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.balances?input=%7B%22json%22%3A%7B%22search%22%3A%22basmati%22%2C%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, defaultWarehouseId } = await trpc.stock.balances.query({ search: "basmati" });
for (const row of data) {
  for (const [warehouseId, qty] of Object.entries(row.byWarehouse)) {
    console.log(row.name, warehouseId, qty);
  }
}`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Warehouses holding none of a unit are simply absent from `byWarehouse` (not `\"0.000\"`). Look warehouse names up with `stock.warehouses`.",
        "`byWarehouse` sums all locations of a warehouse. If no sales (default) warehouse is configured, `defaultWarehouseId` is `null` and unplaced stock is not shown in any warehouse, so the values can add up to less than `total`.",
      ],
      relatedEndpoints: ["stock-warehouses", "stock-transfer", "stock-availability", "item-stock-movements"],
    },
    {
      id: "stock-transfer",
      method: "mutation",
      path: "stock.transfer",
      title: "Transfer Stock",
      description: "Move stock from one warehouse to another; one transfer can carry up to 100 lines. Each line records a `TRANSFER_OUT` movement at the source and a `TRANSFER_IN` at the destination under one shared `referenceId` (reference type `STOCK_TRANSFER`). The business-wide item total does not change. All lines succeed or none do.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "sourceWarehouseId", type: "string (UUID)", required: true, description: "Warehouse to take stock from (must be active)" },
        { name: "destinationWarehouseId", type: "string (UUID)", required: true, description: "Warehouse to put stock in (must be active and different from the source)" },
        { name: "date", type: "string (ISO 8601 datetime)", required: false, description: "Movement date", default: "now" },
        { name: "lines", type: "array", required: true, description: "1–100 lines to move" },
        { name: "lines[].itemId", type: "string (UUID)", required: true, description: "Product item" },
        { name: "lines[].variantId", type: "string (UUID) | null", required: false, description: "Variant, for variant-mode items" },
        { name: "lines[].quantity", type: "string (decimal)", required: true, description: "Quantity in the item's base unit, up to 3 decimals, must be > 0" },
      ],
      output: {
        description: "The reference ID shared by all movements of this transfer (it appears as `referenceId` in `stock.transfers`).",
        example: { referenceId: "transfer-ref-uuid" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stock.transfer \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "sourceWarehouseId": "wh-uuid",
      "destinationWarehouseId": "wh-uuid-2",
      "lines": [
        { "itemId": "item-uuid", "quantity": "50" },
        { "itemId": "item-uuid-2", "variantId": "variant-uuid", "quantity": "12" }
      ]
    }
  }'`,
        javascript: `const { referenceId } = await trpc.stock.transfer.mutate({
  sourceWarehouseId: "wh-uuid",
  destinationWarehouseId: "wh-uuid-2",
  lines: [
    { itemId: "item-uuid", quantity: "50" },
    { itemId: "item-uuid-2", variantId: "variant-uuid", quantity: "12" },
  ],
});`,
      },
      gotchas: [
        "Requires `Item:update` permission (owners, admins, seller managers). Non-admins additionally need a `canTransfer` grant on both warehouses, else `FORBIDDEN` (\"You don't have transfer permission for these warehouses\").",
        "`BAD_REQUEST` when source and destination are the same, a warehouse is inactive, a quantity is not > 0, the item is a service, or the source holds too little (\"Not enough stock to transfer: N available\"). `NOT_FOUND` for an unknown warehouse, item or variant.",
        "The availability check always applies, whatever the negative stock policy. It uses the source warehouse's location-less balance (plus unplaced stock if the source is the default warehouse); stock held against a location does not count.",
        "There is no endpoint to edit or reverse a transfer — post a transfer in the opposite direction.",
      ],
      relatedEndpoints: ["stock-transfers", "stock-balances", "warehouse-access-set"],
    },
    {
      id: "stock-transfers",
      method: "query",
      path: "stock.transfers",
      title: "Transfer Journal",
      description: "Past stock transfers, newest first, one row per `referenceId` with its lines. No filters besides pagination.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Rows per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated transfers. `date` is the earliest movement date of the transfer; `lines[].name` includes variant attribute values; quantities are positive.",
        example: {
          data: [
            {
              referenceId: "transfer-ref-uuid",
              date: "2026-06-12T09:30:00.000Z",
              sourceWarehouseId: "wh-uuid",
              sourceName: "Main warehouse",
              destinationWarehouseId: "wh-uuid-2",
              destinationName: "Bhiwandi Finished Goods",
              lineCount: 2,
              totalQuantity: "62.000",
              lines: [
                { name: "Basmati Rice 25kg Bag", unit: "bag", quantity: "50.000" },
                { name: "Cotton Kurta — M / Indigo", unit: "pcs", quantity: "12.000" },
              ],
            },
          ],
          total: 9,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.transfers?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.stock.transfers.query({ page: 1, limit: 20 });`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "`totalQuantity` sums lines across different units of measure.",
      ],
      relatedEndpoints: ["stock-transfer"],
    },
    {
      id: "stock-adjust",
      method: "mutation",
      path: "stock.adjust",
      title: "Adjust Stock",
      description: "Add or remove stock at one warehouse with a reason (damage, wastage, found stock, opening correction…). Each line creates a stock adjustment record and an `ADJUSTMENT` movement (reference type `STOCK_ADJUSTMENT`), changing both the warehouse balance and the item total. All lines succeed or none do.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Active warehouse to adjust" },
        { name: "date", type: "string (ISO 8601 datetime)", required: false, description: "Adjustment date", default: "now" },
        { name: "reason", type: "string", required: true, description: "Why the stock changed (1–500 chars); stored on every line" },
        { name: "lines", type: "array", required: true, description: "1–100 lines" },
        { name: "lines[].itemId", type: "string (UUID)", required: true, description: "Product item" },
        { name: "lines[].variantId", type: "string (UUID) | null", required: false, description: "Variant, for variant-mode items" },
        { name: "lines[].quantity", type: "string (decimal)", required: true, description: "Signed change, up to 3 decimals: positive adds, negative removes; zero is rejected" },
      ],
      output: {
        description: "Number of lines applied.",
        example: { count: 2 },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stock.adjust \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "warehouseId": "wh-uuid",
      "reason": "Water damage during monsoon",
      "lines": [
        { "itemId": "item-uuid", "quantity": "-3" },
        { "itemId": "item-uuid-3", "quantity": "2.5" }
      ]
    }
  }'`,
        javascript: `await trpc.stock.adjust.mutate({
  warehouseId: "wh-uuid",
  reason: "Water damage during monsoon",
  lines: [
    { itemId: "item-uuid", quantity: "-3" },     // 3 bags written off
    { itemId: "item-uuid-3", quantity: "2.5" },  // 2.5 kg found
  ],
});`,
      },
      gotchas: [
        "Requires `Item:update` permission. Non-admins also need a `canAdjust` grant on the warehouse, else `FORBIDDEN` (\"You don't have adjustment permission for this warehouse\").",
        "A negative line that would take the warehouse's location-less balance below zero is refused with `BAD_REQUEST` (\"Only N in stock at this warehouse\"), regardless of the negative stock policy.",
        "`NOT_FOUND` for an unknown warehouse, item or variant; `BAD_REQUEST` for an inactive warehouse or a service item.",
        "The adjustment record's `previousStock` / `newStock` are business-wide item totals, not the warehouse's balance.",
      ],
      relatedEndpoints: ["stock-adjustments", "stock-verify", "warehouse-access-set"],
    },
    {
      id: "stock-adjustments",
      method: "query",
      path: "stock.adjustments",
      title: "Adjustment Log",
      description: "All stock adjustments across items, newest first (by adjustment date, then creation time). Includes manual adjustments, physical verification and posted stock counts, and adjustments made from the item screen. Set `kind` to `physical` for verification/count adjustments only.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "kind", type: "enum", required: false, description: "Which adjustments to return", default: "all", enumValues: ["all", "physical"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Rows per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated adjustments. `quantity` is signed; `previousStock` / `newStock` are the business-wide totals around the change; `physical` is true for verification and count postings; `warehouseName` is `null` if no movement was linked.",
        example: {
          data: [
            {
              id: "adj-uuid",
              date: "2026-07-01T10:15:00.000Z",
              quantity: "-3.000",
              previousStock: "320.000",
              newStock: "317.000",
              reason: "Physical stock verification (scan): Quarterly count",
              createdByName: "Sunita Patil",
              itemName: "Basmati Rice 25kg Bag",
              unit: "bag",
              warehouseName: "Main warehouse",
              physical: true,
            },
          ],
          total: 57,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.adjustments?input=%7B%22json%22%3A%7B%22kind%22%3A%22physical%22%2C%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data } = await trpc.stock.adjustments.query({ kind: "physical" });`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "There is no date, item or warehouse filter — page through, or use `item.stockMovements` for one item's history.",
      ],
      relatedEndpoints: ["stock-adjust", "stock-verify", "stock-counts", "item-stock-movements"],
    },
    {
      id: "stock-verify",
      method: "mutation",
      path: "stock.verify",
      title: "Physical Stock Verification",
      description: "Post counted quantities for a warehouse (manual entry, no barcodes needed). For each line the difference between the counted quantity and the warehouse's book balance becomes an adjustment (reference type `PHYSICAL_STOCK`, reason \"Physical stock verification\" plus your note); lines that already match are skipped. All lines succeed or none do.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Active warehouse that was counted" },
        { name: "date", type: "string (ISO 8601 datetime)", required: false, description: "Adjustment date", default: "now" },
        { name: "note", type: "string", required: false, description: "Appended to the adjustment reason (max 300 chars)" },
        { name: "counts", type: "array", required: true, description: "1–500 counted units" },
        { name: "counts[].itemId", type: "string (UUID)", required: true, description: "Product item" },
        { name: "counts[].variantId", type: "string (UUID) | null", required: false, description: "Variant, for variant-mode items" },
        { name: "counts[].counted", type: "string (decimal)", required: true, description: "Quantity physically found, ≥ 0, up to 3 decimals" },
      ],
      output: {
        description: "How many lines were checked and how many produced an adjustment.",
        example: { checked: 42, adjusted: 5 },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stock.verify \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "warehouseId": "wh-uuid",
      "note": "March year-end count",
      "counts": [
        { "itemId": "item-uuid", "counted": "317" },
        { "itemId": "item-uuid-2", "variantId": "variant-uuid", "counted": "44" }
      ]
    }
  }'`,
        javascript: `const { checked, adjusted } = await trpc.stock.verify.mutate({
  warehouseId: "wh-uuid",
  note: "March year-end count",
  counts: [
    { itemId: "item-uuid", counted: "317" },
    { itemId: "item-uuid-2", variantId: "variant-uuid", counted: "44" },
  ],
});`,
      },
      gotchas: [
        "Requires `Item:update` permission, plus a `canAdjust` grant on the warehouse for non-admins (`FORBIDDEN` otherwise).",
        "Only the units you send are touched; anything not listed keeps its book quantity.",
        "The book figure is the warehouse's location-less balance (plus unplaced stock for the default warehouse), read at the moment of posting.",
      ],
      relatedEndpoints: ["stock-adjustments", "stock-count-finish", "stock-adjust"],
    },
    {
      id: "stock-settings",
      method: "query",
      path: "stock.settings",
      title: "Get Inventory Policy",
      description: "The business's negative stock policy, valuation method and default warehouses. Unlike `warehouse.inventorySettingsGet`, this ensures the settings row (and default warehouse) exist first, so it never returns `null`.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Policy, valuation method and default warehouse IDs. `negativeStockPolicy` is one of `allow` (documents may take stock below zero silently), `warn` (entry forms flag shortfalls, saving still works) or `block` (the server refuses to save documents that would go below zero).",
        example: {
          negativeStockPolicy: "warn",
          valuationMethod: "weighted_average",
          salesWarehouseId: "wh-uuid",
          purchaseWarehouseId: "wh-uuid",
          salesReturnWarehouseId: "wh-uuid",
          purchaseReturnWarehouseId: "wh-uuid",
          stockAdjustmentWarehouseId: "wh-uuid",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.settings" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { negativeStockPolicy, valuationMethod } = await trpc.stock.settings.query();`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Side effect on a read: if the business has no inventory settings yet, this query creates them (and possibly a Main premise and warehouse), exactly like `stock.setup`.",
        "`productionWarehouseId` is not included here — read it from `warehouse.inventorySettingsGet`.",
      ],
      relatedEndpoints: ["stock-update-settings", "warehouse-inventory-settings-get", "stock-setup"],
    },
    {
      id: "stock-update-settings",
      method: "mutation",
      path: "stock.updateSettings",
      title: "Update Inventory Policy",
      description: "Change the negative stock policy and/or the stock valuation method. Only the fields you send change. Default warehouses are set with `warehouse.inventorySettingsUpdate`.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "negativeStockPolicy", type: "enum", required: false, description: "How documents behave when a warehouse would go below zero", enumValues: ["allow", "warn", "block"] },
        { name: "valuationMethod", type: "enum", required: false, description: "Closing stock valuation used by the stock summary, P&L and balance sheet: average purchase cost, or FIFO (the latest purchases are what remain on the shelf)", enumValues: ["weighted_average", "fifo"] },
      ],
      output: {
        description: "Acknowledgement.",
        example: { ok: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stock.updateSettings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"negativeStockPolicy":"block","valuationMethod":"fifo"}}'`,
        javascript: `await trpc.stock.updateSettings.mutate({ negativeStockPolicy: "block" });`,
      },
      gotchas: [
        "Requires `Business:update` permission (owners and admins).",
        "`block` only affects documents (invoices, bills, returns…). `stock.transfer` and `stock.adjust` always refuse to go below zero at a warehouse, even under `allow`.",
        "Changing the valuation method revalues closing stock in reports retroactively; nothing is posted to the ledger.",
        "Creates the settings row and default warehouse first if they do not exist.",
      ],
      relatedEndpoints: ["stock-settings", "stock-availability"],
    },
    {
      id: "stock-availability",
      method: "query",
      path: "stock.availability",
      title: "Check Availability",
      description: "How much of each requested item a warehouse holds, for warning about shortfalls while a document is being entered. Defaults to the default (sales) warehouse, which also holds any unplaced stock. Returns the policy too, so the form knows whether to warn or block.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Warehouse to check; omitted or `null` uses the default warehouse" },
        { name: "lines", type: "array", required: true, description: "Up to 200 items to check (may be empty)" },
        { name: "lines[].itemId", type: "string (UUID)", required: true, description: "Item" },
        { name: "lines[].variantId", type: "string (UUID) | null", required: false, description: "Accepted but not used for filtering — see gotchas" },
      ],
      output: {
        description: "The warehouse used, the negative stock policy (`warn` if no settings exist) and one row per stock unit of the requested items.",
        example: {
          warehouseId: "wh-uuid",
          policy: "warn",
          lines: [
            { itemId: "item-uuid", variantId: null, available: "200.000" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.availability?input=%7B%22json%22%3A%7B%22warehouseId%22%3A%22wh-uuid%22%2C%22lines%22%3A%5B%7B%22itemId%22%3A%22item-uuid%22%7D%5D%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { policy, lines } = await trpc.stock.availability.query({
  warehouseId: "wh-uuid",
  lines: invoiceLines.map(l => ({ itemId: l.itemId, variantId: l.variantId })),
});
const avail = new Map(lines.map(r => [\`\${r.itemId}:\${r.variantId ?? ""}\`, parseFloat(r.available)]));`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Results are per stock unit of each requested item: for a variant-mode item you get a row for every variant, whatever `variantId` you sent. Match on `itemId` + `variantId` client-side. Service items return no rows.",
        "Returns an empty `lines` array (not an error) when no warehouse is given and no default is configured. The warehouse ID is not validated; an unknown ID just reports zero.",
        "Availability counts every location of the warehouse, whereas `stock.transfer` / `stock.adjust` check only the location-less balance.",
      ],
      relatedEndpoints: ["stock-balances", "stock-settings"],
    },

    // ── Barcode stock count ─────────────────────────────────────
    {
      id: "stock-count-sheet",
      method: "query",
      path: "stock.countSheet",
      title: "Stock Count Sheet",
      description: "Everything a barcode stock count at one warehouse expects, so a scanner screen can match scans instantly offline: every stock unit that has at least one code, with its book quantity and the codes that scan to it (with pack quantities), plus the units that hold stock but have no code and so cannot be counted by scanning.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Active warehouse being counted" },
      ],
      output: {
        description: "`units[].books` is the warehouse's location-less balance (plus unplaced stock if it is the default warehouse); `unitCost` is the purchase price (variant price falling back to the item's). `codes` holds the item/variant barcode (pack 1) and, in multi-barcode mode, extra codes with their pack quantity.",
        example: {
          units: [
            {
              itemId: "item-uuid",
              variantId: null,
              name: "Basmati Rice 25kg Bag",
              barcode: "8901234567890",
              unitCost: "1650.00",
              books: "200.000",
              codes: [
                { code: "8901234567890", packQty: 1 },
                { code: "8901234567906", packQty: 10 },
              ],
            },
          ],
          noBarcode: [
            { itemId: "item-uuid-4", variantId: null, name: "Loose Jaggery", books: "85.500" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.countSheet?input=%7B%22json%22%3A%7B%22warehouseId%22%3A%22wh-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const sheet = await trpc.stock.countSheet.query({ warehouseId: "wh-uuid" });
const byCode = new Map();
for (const u of sheet.units) for (const c of u.codes) byCode.set(c.code, { unit: u, packQty: c.packQty });`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Throws `PRECONDITION_FAILED` when barcodes are switched off for the business (Settings → Barcodes); `NOT_FOUND` / `BAD_REQUEST` for an unknown or inactive warehouse.",
        "The server also resolves scanned SKUs as a fallback (for labels printed before barcodes existed), but SKUs are not listed in `codes`; a unit with only a SKU appears under `noBarcode` even though scanning its SKU works.",
      ],
      relatedEndpoints: ["stock-count-preview", "stock-count-finish"],
    },
    {
      id: "stock-count-preview",
      method: "query",
      path: "stock.countPreview",
      title: "Preview Stock Count",
      description: "Build the books-vs-scanned report for a set of scans without saving anything. Scans are grouped by code; each code resolves to an item or variant (item/variant barcode first, then extra codes in multi mode, then SKU) and counts `count × packQty` units.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Active warehouse being counted" },
        { name: "scans", type: "array", required: true, description: "Grouped scans, at most 5000 distinct entries" },
        { name: "scans[].code", type: "string", required: true, description: "Scanned code, trimmed (1–64 chars)" },
        { name: "scans[].count", type: "number (integer)", required: true, description: "How many times it was scanned (1–100000)" },
      ],
      output: {
        description: "`lines` lists every unit that was scanned or has codes and non-zero books (so unscanned barcoded stock appears with `scanned: \"0.000\"`); `notCounted` lists units with stock but no code that were not scanned; `unknownCodes` lists codes that matched nothing.",
        example: {
          lines: [
            { itemId: "item-uuid", variantId: null, name: "Basmati Rice 25kg Bag", books: "200.000", scanned: "197.000", unitCost: "1650.00" },
            { itemId: "item-uuid-2", variantId: "variant-uuid", name: "Cotton Kurta — M / Indigo", books: "45.000", scanned: "0.000", unitCost: "420.00" },
          ],
          notCounted: [
            { itemId: "item-uuid-4", variantId: null, name: "Loose Jaggery", books: "85.500" },
          ],
          unknownCodes: [
            { code: "8909999000011", count: 2 },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.countPreview?input=%7B%22json%22%3A%7B%22warehouseId%22%3A%22wh-uuid%22%2C%22scans%22%3A%5B%7B%22code%22%3A%228901234567890%22%2C%22count%22%3A12%7D%5D%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const report = await trpc.stock.countPreview.query({
  warehouseId: "wh-uuid",
  scans: [
    { code: "8901234567890", count: 17 },
    { code: "8901234567906", count: 18 }, // carton of 10
  ],
});
const differences = report.lines.filter(l => l.books !== l.scanned);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Throws `PRECONDITION_FAILED` when barcodes are off, and `NOT_FOUND` / `BAD_REQUEST` for an unknown or inactive warehouse.",
        "This is a GET query, so the scans travel in the URL; very large scan sets can exceed URL length limits on proxies. Group scans by code before sending.",
      ],
      relatedEndpoints: ["stock-count-sheet", "stock-count-finish"],
    },
    {
      id: "stock-count-finish",
      method: "mutation",
      path: "stock.countFinish",
      title: "Finish Stock Count",
      description: "End a barcode count: build the report (as `stock.countPreview`), save it as a stock count record, and optionally post its differences straight away. With `post: true`, every report line whose scanned quantity differs from the current warehouse balance becomes a `PHYSICAL_STOCK` adjustment dated now, with reason \"Physical stock verification (scan)\" plus the note, and the count is saved as `posted`; otherwise it is saved as `saved` for review and later `stock.countPost`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Active warehouse counted" },
        { name: "startedAt", type: "string (ISO 8601 datetime)", required: true, description: "When scanning began (stored; the end time is set to now)" },
        { name: "scans", type: "array", required: true, description: "Grouped scans, at most 5000 distinct entries" },
        { name: "scans[].code", type: "string", required: true, description: "Scanned code, trimmed (1–64 chars)" },
        { name: "scans[].count", type: "number (integer)", required: true, description: "Times scanned (1–100000)" },
        { name: "note", type: "string", required: false, description: "Note stored on the count and appended to adjustment reasons (max 300 chars)" },
        { name: "post", type: "boolean", required: false, description: "Post the differences as adjustments now", default: "false" },
      ],
      output: {
        description: "The new count's ID and the number of adjustments posted (0 when `post` is false).",
        example: { id: "count-uuid", adjusted: 4 },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stock.countFinish \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "warehouseId": "wh-uuid",
      "startedAt": "2026-07-01T04:30:00.000Z",
      "scans": [
        { "code": "8901234567890", "count": 17 },
        { "code": "8901234567906", "count": 18 }
      ],
      "note": "Quarterly count",
      "post": false
    }
  }'`,
        javascript: `const { id } = await trpc.stock.countFinish.mutate({
  warehouseId: "wh-uuid",
  startedAt: scanStartedAt.toISOString(),
  scans,
  note: "Quarterly count",
  post: false, // review first, post later with stock.countPost
});`,
      },
      gotchas: [
        "Requires `Item:update` permission. With `post: true`, non-admins also need a `canAdjust` grant on the warehouse (`FORBIDDEN` otherwise); saving without posting needs no grant.",
        "Posting sets every report line to its scanned quantity — barcoded units that hold stock but were not scanned are included with `scanned: \"0.000\"` and will be written down to zero. Units without any code (`notCounted`) are left untouched.",
        "Throws `PRECONDITION_FAILED` when barcodes are off, and `NOT_FOUND` / `BAD_REQUEST` for an unknown or inactive warehouse. Everything runs in one transaction.",
      ],
      relatedEndpoints: ["stock-count-preview", "stock-count-post", "stock-counts"],
    },
    {
      id: "stock-count-post",
      method: "mutation",
      path: "stock.countPost",
      title: "Post Saved Stock Count",
      description: "Post a saved count's differences later. For each saved line, the scanned quantity is compared with the warehouse balance at the time of posting, and any difference becomes a `PHYSICAL_STOCK` adjustment dated now. The count is then marked `posted`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Stock count ID (from `stock.countFinish` or `stock.counts`)" },
      ],
      output: {
        description: "The count ID and how many adjustments were posted.",
        example: { id: "count-uuid", adjusted: 4 },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stock.countPost \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"count-uuid"}}'`,
        javascript: `const { adjusted } = await trpc.stock.countPost.mutate({ id: "count-uuid" });`,
      },
      gotchas: [
        "Requires `Item:update` permission, plus a `canAdjust` grant on the count's warehouse for non-admins.",
        "Throws `NOT_FOUND` (\"Count not found\"), `BAD_REQUEST` (\"This count is already posted\") — the row is locked so two concurrent posts cannot both apply — and `NOT_FOUND` / `BAD_REQUEST` if the warehouse is gone or now inactive.",
        "Differences are computed against the balance now, not the books at count time, so sales or receipts made since the count are overwritten by the scanned figure. Post promptly.",
        "Does not re-check that barcodes are still enabled.",
      ],
      relatedEndpoints: ["stock-count-finish", "stock-count", "stock-adjustments"],
    },
    {
      id: "stock-counts",
      method: "query",
      path: "stock.counts",
      title: "List Stock Counts",
      description: "Past barcode stock counts, newest first, with summary figures.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Rows per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated counts. `status` is `saved` or `posted`; `itemsChecked` is the number of report lines, `differences` how many had scanned ≠ books at count time, `unknownCount` the number of distinct unrecognised codes.",
        example: {
          data: [
            {
              id: "count-uuid",
              warehouseId: "wh-uuid",
              warehouseName: "Main warehouse",
              status: "saved",
              startedAt: "2026-07-01T04:30:00.000Z",
              endedAt: "2026-07-01T06:10:00.000Z",
              scanCount: 1450,
              adjustedCount: 0,
              createdByName: "Sunita Patil",
              itemsChecked: 142,
              differences: 6,
              unknownCount: 1,
            },
          ],
          total: 3,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.counts?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data } = await trpc.stock.counts.query({ page: 1, limit: 20 });
const pending = data.filter(c => c.status === "saved");`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "`scanCount` is the total number of scans (sum of `count`), not the number of distinct codes.",
      ],
      relatedEndpoints: ["stock-count", "stock-count-post"],
    },
    {
      id: "stock-count",
      method: "query",
      path: "stock.count",
      title: "Get Stock Count",
      description: "One saved stock count with its full report: lines (books vs scanned at count time), unknown codes and units that could not be counted.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Stock count ID" },
      ],
      output: {
        description: "The stock count record plus `warehouseName`.",
        example: {
          id: "count-uuid",
          businessId: "biz-uuid",
          warehouseId: "wh-uuid",
          status: "posted",
          startedAt: "2026-07-01T04:30:00.000Z",
          endedAt: "2026-07-01T06:10:00.000Z",
          scanCount: 1450,
          note: "Quarterly count",
          lines: [
            { itemId: "item-uuid", variantId: null, name: "Basmati Rice 25kg Bag", books: "200.000", scanned: "197.000", unitCost: "1650.00" },
          ],
          unknownCodes: [{ code: "8909999000011", count: 2 }],
          notCounted: [{ itemId: "item-uuid-4", variantId: null, name: "Loose Jaggery", books: "85.500" }],
          adjustedCount: 4,
          postedAt: "2026-07-01T07:00:00.000Z",
          createdByUserId: "user-uuid",
          createdByName: "Sunita Patil",
          createdAt: "2026-07-01T06:10:00.000Z",
          warehouseName: "Main warehouse",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stock.count?input=%7B%22json%22%3A%7B%22id%22%3A%22count-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const count = await trpc.stock.count.query({ id: "count-uuid" });
const shortValue = count.lines.reduce((s, l) =>
  s + (parseFloat(l.books) - parseFloat(l.scanned)) * parseFloat(l.unitCost ?? "0"), 0);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Throws `NOT_FOUND` (\"Count not found\") if the ID is not in the active business.",
        "`lines[].books` is a snapshot from when the count was finished; the adjustments actually posted (see `adjustedCount`) were computed against the balance at posting time.",
      ],
      relatedEndpoints: ["stock-counts", "stock-count-post"],
    },
    {
      id: "batch-list",
      method: "query",
      path: "batch.list",
      title: "List Item Batches",
      description: "An item's batches (lots) — for items with `trackBatches` on — earliest expiry first, with the stock each holds. Stock per batch is summed from the stock movement ledger: in one warehouse when `warehouseId` is given, otherwise in total with `byWarehouse` showing the split. `unbatched` is stock of the item that no batch accounts for (stock from before batch tracking was switched on).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "The item." },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "One variant of a variant item." },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Only stock in this warehouse." },
        { name: "includeEmpty", type: "boolean", required: false, description: "Also list batches that hold no stock.", default: "false" },
        { name: "asOf", type: "string (YYYY-MM-DD) | null", required: false, description: "Judge expiry as of this date (a document's date).", default: "today (IST)" },
      ],
      output: {
        description: "Batches with quantity, expiry state and days to expiry; the unbatched quantity and the date used.",
        example: {
          data: [
            { id: "batch-uuid-1", batchNumber: "PCM2407", mfgDate: "2025-07-01", expiryDate: "2027-06-30", mrp: "32.50", quantity: "140.000", byWarehouse: { "wh-uuid": "140.000" }, expired: false, daysToExpiry: 273, createdAt: "2025-08-02T10:00:00.000Z" },
          ],
          unbatched: "0.000",
          asOf: "2026-09-30",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/batch.list?input=%7B%22json%22%3A%7B%22itemId%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data } = await trpc.batch.list.query({ itemId: "item-uuid", warehouseId: "wh-uuid" });
const fefo = data.find((b) => !b.expired && parseFloat(b.quantity) > 0);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "A batch counts as expired the day after its expiry date.",
      ],
      relatedEndpoints: ["batch-create", "inventory-reports-batch-stock"],
    },
    {
      id: "batch-create",
      method: "mutation",
      path: "batch.create",
      title: "Create Batch",
      description: "Add a batch to an item by hand. Batches are usually created as they arrive: an inward document line (purchase, GRN, inward challan, sales return) with `batchNumber` and dates, an adjustment's `newBatch`, or `openingBatch` on `item.create`. Outward document lines name a `batchId`, or leave it out to have stock taken earliest expiry first (FEFO), split across batches if needed; an expired batch only goes out with `allowExpired: true` on the line, and no batch is ever taken below zero. `batch.update` corrects a batch's number, dates or MRP and `batch.delete` (admin) removes a batch nothing refers to.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "The item." },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "One variant of a variant item." },
        { name: "batchNumber", type: "string", required: true, description: "Batch / lot number, 1–60 characters, unique per item." },
        { name: "mfgDate", type: "string (YYYY-MM-DD) | null", required: false, description: "Manufacturing date." },
        { name: "expiryDate", type: "string (YYYY-MM-DD) | null", required: false, description: "Expiry date. Required when the item has `trackExpiry`." },
        { name: "mrp", type: "string | null", required: false, description: "MRP printed on this batch; shown on invoice lines instead of the item's." },
      ],
      output: {
        description: "The created batch row.",
        example: { id: "batch-uuid", businessId: "biz-uuid", itemId: "item-uuid", variantId: null, batchNumber: "PCM2407", mfgDate: "2025-07-01", expiryDate: "2027-06-30", mrp: "32.50" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/batch.create" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"itemId":"item-uuid","batchNumber":"PCM2407","expiryDate":"2027-06-30"}}'`,
        javascript: `await trpc.batch.create.mutate({ itemId: "item-uuid", batchNumber: "PCM2407", expiryDate: "2027-06-30" });

// Usually batches come in on the purchase itself:
await trpc.invoice.create.mutate({
  partyId: "supplier-uuid", type: "purchase",
  lineItems: [{ itemId: "item-uuid", itemName: "Paracetamol 500", quantity: "100", unitPrice: "18",
    batchNumber: "PCM2407", expiryDate: "2027-06-30" }],
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "Throws `CONFLICT` if the item already has a batch with that number.",
        "Expiry can't be before the manufacturing date.",
      ],
      relatedEndpoints: ["batch-list"],
    },
  ],
};
