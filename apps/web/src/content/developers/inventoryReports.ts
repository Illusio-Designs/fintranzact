import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const inventoryReportsEndpoints: EndpointGroup = {
  id: "inventory-reports",
  title: "Inventory Reports",
  description: "Read-only inventory reports built on the stock movement ledger: a per-item stock ledger (Tally's stock item register), movement summary, godown (warehouse) summary, stock ageing, reorder status, dead stock and a stock group summary. A stock unit is either a simple/alt-unit product or one variant of a variant item; services and deleted items never appear. Quantities are in each item's base unit and returned as plain numbers rounded to 3 decimals (values to 2 decimals). Values use the business's valuation method from inventory settings — `weighted_average` (average cost of all purchases up to the date, opening stock at the item's purchase price) or `fifo` (what is left is the most recent purchases; anything older than recorded purchases is priced at the item's purchase price). Purchases are costed at taxable value per base unit (GST excluded, it is input credit), manufactured stock counts as an inward at its production cost, and negative stock is valued at zero — so these figures agree with the stock summary, P&L and balance sheet. Stock that no warehouse accounts for (entered before warehouses existed, \"unplaced\" stock) is counted business-wide and is treated as sitting in the default (sales) warehouse. All procedures require the `Report:read` permission.",
  endpoints: [
    {
      id: "inventory-reports-stock-ledger",
      method: "query",
      path: "inventoryReports.stockLedger",
      title: "Stock Ledger (Item Register)",
      description: "Every stock movement of one item (or one variant) between two dates, with the opening balance, a running balance per line, and period inward/outward totals. Optionally restricted to a single warehouse. Each line gets a human-readable `particulars` label derived from its source (\"Sale INV-0042\", \"Transfer in\", \"Adjustment — Damaged\", \"Manufactured — journal MJ-3\", \"Opening stock\"...).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Item to report on" },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "Variant of a variant-mode item. Omit/null for simple and alt-unit items — when omitted only movements with no variant are matched." },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Restrict to one warehouse. Omit for the business-wide ledger." },
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Period start, inclusive (e.g. `2026-04-01T00:00:00.000Z`)" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "Period end, inclusive (e.g. `2026-09-30T23:59:59.999Z`)" },
      ],
      output: {
        description: "Opening, inward, outward and closing quantities plus the movement lines in date order. `documentId` is set only when the line came from a sales/purchase document (invoice, challan, GRN, return) so a UI can link to it. `free` is how much of a document's movement was free goods (\"10 + 1\"), in base units (0 otherwise). `truncated` is true when the 2000-line cap was hit.",
        example: {
          opening: 120,
          inward: 250,
          outward: 185.5,
          closing: 184.5,
          lines: [
            { id: "movement-uuid-1", date: "2026-04-03T10:15:00.000Z", particulars: "Purchase PUR-0018", party: "Shree Balaji Traders", warehouse: "Main Godown", documentId: "invoice-uuid-1", inward: 250, outward: 0, free: 10, balance: 370 },
            { id: "movement-uuid-2", date: "2026-04-11T14:02:00.000Z", particulars: "Sale INV-0412", party: "Sharma Textiles Pvt Ltd", warehouse: "Main Godown", documentId: "invoice-uuid-2", inward: 0, outward: 180, free: 0, balance: 190 },
            { id: "movement-uuid-3", date: "2026-05-02T09:00:00.000Z", particulars: "Adjustment — Damaged in transit", party: null, warehouse: "Main Godown", documentId: null, inward: 0, outward: 5.5, free: 0, balance: 184.5 },
          ],
          truncated: false,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.stockLedger?input=%7B%22json%22%3A%7B%22itemId%22%3A%22item-uuid%22%2C%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222026-09-30T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const ledger = await trpc.inventoryReports.stockLedger.query({
  itemId: "item-uuid",
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2026-09-30T23:59:59.999Z",
});

console.log(\`Opening \${ledger.opening}, closing \${ledger.closing}\`);
ledger.lines.forEach(l => console.log(l.date, l.particulars, l.inward || -l.outward, l.balance));
if (ledger.truncated) console.warn("More than 2000 movements — narrow the date range");`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {
    "itemId": "item-uuid",
    "fromDate": "2026-04-01T00:00:00.000Z",
    "toDate": "2026-09-30T23:59:59.999Z",
}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/inventoryReports.stockLedger?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission (not `Item:read`).",
        "`fromDate`/`toDate` must be full ISO datetimes — a bare `YYYY-MM-DD` fails zod validation.",
        "For a variant-mode item you must pass `variantId`; without it the query only matches movements with no variant and returns an empty ledger.",
        "Business-wide opening is computed as today's stock total minus every movement since `fromDate`, so stock with no movement history is still counted. With `warehouseId` the opening is the sum of recorded movements at that warehouse before `fromDate` only.",
        "Business-wide, `UNPLACED_STOCK` movements (unplaced stock being put into a warehouse) are hidden because they don't change the total; they are shown when a warehouse is selected. Transfers are shown in both modes.",
        "Capped at 2000 lines, ordered by movement date then creation time. Check `truncated` and narrow the range when it is true — `closing` is then the balance after the last returned line, not the true period close.",
        "Movements from manufacturing are labelled with the journal number; cancellations appear as \"Manufacturing MJ-n cancelled\".",
      ],
      relatedEndpoints: ["inventory-reports-movement-summary", "manufacturing-journal"],
    },
    {
      id: "inventory-reports-movement-summary",
      method: "query",
      path: "inventoryReports.movementSummary",
      title: "Stock Movement Summary",
      description: "Opening, inward, outward and closing quantity per stock unit for a period (Tally's stock summary with movements), plus closing value at the valuation rate as of `toDate`. Units with no movement in the period and zero closing stock are left out.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Period start, inclusive" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "Period end, inclusive. Also the valuation date." },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Restrict to one warehouse. Omit for business-wide figures." },
      ],
      output: {
        description: "One row per stock unit, the total closing value, and the valuation method used.",
        example: {
          data: [
            { itemId: "item-uuid-1", variantId: null, name: "Cotton Fabric 60s", unit: "m", category: "Raw Material", opening: 1200, inward: 3000, outward: 2650, closing: 1550, closingValue: 217000 },
            { itemId: "item-uuid-2", variantId: "variant-uuid-1", name: "Men's Kurta — White / L", unit: "pcs", category: "Finished Goods", opening: 40, inward: 120, outward: 96, closing: 64, closingValue: 28160 },
          ],
          totals: { closingValue: 245160 },
          valuationMethod: "weighted_average",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.movementSummary?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222026-09-30T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, totals, valuationMethod } = await trpc.inventoryReports.movementSummary.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2026-09-30T23:59:59.999Z",
});

console.log(\`Closing stock (\${valuationMethod}): ₹\${totals.closingValue}\`);`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Business-wide, `TRANSFER_IN`/`TRANSFER_OUT` and `UNPLACED_STOCK` movements are excluded because they cancel out; with `warehouseId` they are included so the warehouse's own flow is visible.",
        "Business-wide closing = current stock total minus movements after `toDate` (counts stock with no movement history). Per warehouse, closing is the sum of recorded movements up to `toDate`. Opening is derived as closing − inward + outward.",
        "`closingValue` values negative closing stock at zero and uses the unit's rate as of `toDate`. In a warehouse view the rate is still the business-wide rate.",
        "Quantities of different units are not converted — only compare rows, don't sum quantities across items.",
      ],
      relatedEndpoints: ["inventory-reports-stock-ledger", "inventory-reports-godown-summary"],
    },
    {
      id: "inventory-reports-godown-summary",
      method: "query",
      path: "inventoryReports.godownSummary",
      title: "Godown (Warehouse) Summary",
      description: "Current stock quantity, number of distinct stock units and value held in each warehouse. Stock that no warehouse accounts for (unplaced stock) is attributed to the default sales warehouse from inventory settings.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Every warehouse of the business (including inactive ones), sorted by name, with totals and the valuation method.",
        example: {
          data: [
            { id: "warehouse-uuid-1", name: "Main Godown", code: "WH-01", status: "active", premise: "Surat Factory", itemCount: 42, quantity: 5820.5, value: 684250.75 },
            { id: "warehouse-uuid-2", name: "Ahmedabad Showroom", code: "WH-02", status: "active", premise: null, itemCount: 18, quantity: 412, value: 131900 },
          ],
          totalValue: 816150.75,
          valuationMethod: "fifo",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.godownSummary" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, totalValue } = await trpc.inventoryReports.godownSummary.query();

data.forEach(w => console.log(\`\${w.name}: \${w.itemCount} items, ₹\${w.value}\`));
console.log("Total:", totalValue);`,
      },
      gotchas: [
        "Requires `Report:read` permission. Takes no input.",
        "Valued as of now at the business-wide valuation rate; negative balances reduce `quantity` but contribute zero to `value`.",
        "`quantity` adds up different units (pcs + kg + m) as-is — treat it as an indicator, not a physical measure.",
        "Warehouses with no stock are still listed with zeros; inactive warehouses are included (check `status`).",
      ],
      relatedEndpoints: ["inventory-reports-movement-summary"],
    },
    {
      id: "inventory-reports-ageing",
      method: "query",
      path: "inventoryReports.ageing",
      title: "Stock Ageing",
      description: "Stock on hand split into age buckets (0–30, 31–60, 61–90, 91–180 and over 180 days). The quantity on hand is assumed to be the most recent arrivals (first in, first out): arrivals are walked newest-first until the on-hand quantity is used up, and each arrival's quantity lands in the bucket for its age. Arrivals are positive movements of type PURCHASE, GOODS_RECEIPT_NOTE, OPENING, UNPLACED_STOCK, SALES_RETURN, ADJUSTMENT, PRODUCTION or BY_PRODUCT.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Bucket labels, one row per stock unit with positive stock (sorted oldest first), per-bucket value totals and the overall value.",
        example: {
          bucketLabels: ["0–30 days", "31–60 days", "61–90 days", "91–180 days", "Over 180 days"],
          data: [
            {
              itemId: "item-uuid-1",
              variantId: null,
              name: "Brass Door Handle 6in",
              unit: "pcs",
              quantity: 300,
              value: 54000,
              oldestDays: 214,
              buckets: [
                { quantity: 50, value: 9000 },
                { quantity: 0, value: 0 },
                { quantity: 100, value: 18000 },
                { quantity: 0, value: 0 },
                { quantity: 150, value: 27000 },
              ],
            },
          ],
          bucketTotals: [9000, 0, 18000, 0, 27000],
          totalValue: 54000,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.ageing" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const report = await trpc.inventoryReports.ageing.query();

report.data.forEach(row => {
  const old = row.buckets[4];
  if (old.quantity > 0) console.log(\`\${row.name}: \${old.quantity} \${row.unit} older than 180 days (₹\${old.value})\`);
});`,
      },
      gotchas: [
        "Requires `Report:read` permission. Takes no input; ages are measured from now.",
        "Stock on hand that is older than every recorded arrival (e.g. opening stock entered before warehouses) is put in the \"Over 180 days\" bucket and `oldestDays` is at least 181 — it may actually be younger.",
        "Transfers between warehouses do not reset an item's age; adjustments that add stock do.",
        "Every bucket is valued at the unit's single current valuation rate, not at the cost of that specific arrival.",
        "Units with zero or negative stock are omitted.",
      ],
      relatedEndpoints: ["inventory-reports-dead-stock"],
    },
    {
      id: "inventory-reports-reorder-status",
      method: "query",
      path: "inventoryReports.reorderStatus",
      title: "Reorder Status",
      description: "Stock units at or below their reorder level (the item's or variant's `lowStockAlert`), with average daily sales over the last 30 days, days of stock left and a suggested order quantity: `ceil(reorderLevel − onHand + dailySales × coverDays)`, never below zero.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "coverDays", type: "number (integer)", required: false, description: "Days of sales the suggested order should cover (1–365). The whole input object is optional.", default: "30" },
      ],
      output: {
        description: "Rows sorted by largest shortfall first, plus the `coverDays` used.",
        example: {
          data: [
            { itemId: "item-uuid-1", variantId: null, name: "Tata Salt 1kg", sku: "SALT-1KG", unit: "pcs", onHand: 12, reorderLevel: 100, shortfall: 88, dailySales: 9.2, daysLeft: 1, suggestedOrder: 502 },
            { itemId: "item-uuid-2", variantId: null, name: "Fortune Sunflower Oil 1L", sku: null, unit: "btl", onHand: 40, reorderLevel: 40, shortfall: 0, dailySales: 0, daysLeft: null, suggestedOrder: 0 },
          ],
          coverDays: 45,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.reorderStatus?input=%7B%22json%22%3A%7B%22coverDays%22%3A45%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data } = await trpc.inventoryReports.reorderStatus.query({ coverDays: 45 });

const toOrder = data.filter(r => r.suggestedOrder > 0);
toOrder.forEach(r => console.log(\`Order \${r.suggestedOrder} \${r.unit} of \${r.name}\`));`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Units without a `lowStockAlert` are never listed. A unit exactly at its level is listed with `shortfall: 0`.",
        "Daily sales = net quantity out through SALE and DELIVERY_CHALLAN movements in the last 30 days (their reversals net off) ÷ 30. The 30-day look-back is fixed; `coverDays` only changes the suggested order.",
        "`daysLeft` is null when there were no sales in the last 30 days.",
        "Reorder levels and stock are business-wide; there is no per-warehouse reorder view.",
      ],
      relatedEndpoints: ["inventory-reports-dead-stock"],
    },
    {
      id: "inventory-reports-dead-stock",
      method: "query",
      path: "inventoryReports.deadStock",
      title: "Dead Stock",
      description: "Stock units with positive stock that have not gone out to a customer in the last `days` days, or ever. \"Going out\" means a SALE, DELIVERY_CHALLAN or PURCHASE_RETURN movement — transfers, adjustments and manufacturing consumption don't count.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "days", type: "number (integer)", required: false, description: "Idle threshold in days (7–3650). The whole input object is optional.", default: "90" },
      ],
      output: {
        description: "Idle stock sorted by value (highest first), the threshold used and the total value. `lastSold` and `idleDays` are null for items that have never gone out.",
        example: {
          days: 180,
          data: [
            { itemId: "item-uuid-1", variantId: null, name: "Havells Ceiling Fan 1200mm", unit: "pcs", category: "Electricals", quantity: 24, value: 55200, lastSold: "2025-11-18T11:30:00.000Z", idleDays: 316 },
            { itemId: "item-uuid-2", variantId: null, name: "PVC Conduit 20mm", unit: "m", category: null, quantity: 600, value: 7800, lastSold: null, idleDays: null },
          ],
          totalValue: 63000,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.deadStock?input=%7B%22json%22%3A%7B%22days%22%3A180%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, totalValue } = await trpc.inventoryReports.deadStock.query({ days: 180 });
console.log(\`₹\${totalValue} tied up in stock idle for 180+ days\`);`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Values are current valuation values (as of now) under the business's valuation method.",
        "A cancelled sale still counts as the last outward movement — the reversal is a separate (positive) movement and is ignored here.",
      ],
      relatedEndpoints: ["inventory-reports-ageing", "inventory-reports-reorder-status"],
    },
    {
      id: "inventory-reports-stock-group-summary",
      method: "query",
      path: "inventoryReports.stockGroupSummary",
      title: "Stock Group Summary",
      description: "Tally's stock group summary: quantity and value per stock group as of a date, where each group's figures include every group below it. Also returns the ungrouped totals and the per-unit rows (with `groupId`) so a screen can drill into a group.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "asOf", type: "string (ISO datetime)", required: false, description: "Valuation date. The whole input object is optional.", default: "now" },
      ],
      output: {
        description: "Groups in tree order with `depth`, rolled-up `quantity`/`value`/`itemCount`, ungrouped totals, the stock unit rows, total value and valuation method.",
        example: {
          asOf: "2026-03-31T23:59:59.999Z",
          groups: [
            { id: "group-uuid-1", name: "Finished Goods", parentId: null, depth: 0, quantity: 460, value: 198400, itemCount: 6 },
            { id: "group-uuid-2", name: "Kurtas", parentId: "group-uuid-1", depth: 1, quantity: 320, value: 140800, itemCount: 4 },
            { id: "group-uuid-3", name: "Raw Material", parentId: null, depth: 0, quantity: 1550, value: 217000, itemCount: 3 },
          ],
          ungrouped: { quantity: 12, value: 1440, itemCount: 1 },
          items: [
            { itemId: "item-uuid-1", variantId: "variant-uuid-1", name: "Men's Kurta — White / L", unit: "pcs", groupId: "group-uuid-2", quantity: 64, rate: 440, value: 28160 },
          ],
          totalValue: 416840,
          valuationMethod: "weighted_average",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.stockGroupSummary?input=%7B%22json%22%3A%7B%22asOf%22%3A%222026-03-31T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const report = await trpc.inventoryReports.stockGroupSummary.query({
  asOf: "2026-03-31T23:59:59.999Z", // closing stock for FY 2025-26
});

report.groups.forEach(g => console.log(\`\${"  ".repeat(g.depth)}\${g.name}: ₹\${g.value}\`));
console.log("Ungrouped:", report.ungrouped.value);`,
      },
      gotchas: [
        "Requires `Report:read` permission (the stock group CRUD endpoints use `Item` permissions instead).",
        "Quantities of different units are added as they are, as Tally does — group quantities mix pcs, kg, m, etc.",
        "`itemCount` counts distinct items, so the variants of one item count once per group.",
        "Units with zero quantity and zero value at `asOf` are omitted. An item whose group no longer exists is reported as ungrouped.",
        "Quantity at `asOf` = today's total minus movements dated after it, so backdated reports reflect later corrections.",
      ],
      relatedEndpoints: ["stock-group-list", "inventory-reports-movement-summary"],
    },
    {
      id: "inventory-reports-batch-stock",
      method: "query",
      path: "inventoryReports.batchStock",
      title: "Batch-wise Stock",
      description: "Stock per batch and warehouse for items that track batches, with each batch's dates, days to expiry and value (valuation rate of the item). `status: \"expiring\"` narrows it to batches expiring within `days` (not yet expired); `status: \"expired\"` to expired stock still on hand. Only batches holding stock are listed, earliest expiry first.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "status", type: "string", required: false, description: "Which batches.", default: "all", enumValues: ["all", "expiring", "expired"] },
        { name: "days", type: "number (integer)", required: false, description: "Window for `expiring` (1–3650).", default: "30" },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Only this warehouse." },
        { name: "itemId", type: "string (UUID) | null", required: false, description: "Only this item." },
        { name: "search", type: "string | null", required: false, description: "Match item name, SKU or batch number." },
      ],
      output: {
        description: "Rows per batch and warehouse, with totals.",
        example: {
          data: [
            { batchId: "batch-uuid", batchNumber: "AMX2311", mfgDate: "2024-11-01", expiryDate: "2026-10-15", mrp: "85.00", itemId: "item-uuid", variantId: null, name: "Amoxicillin 250", sku: null, unit: "pcs", warehouseId: "wh-uuid", warehouseName: "Main warehouse", quantity: 40, value: 2400, daysToExpiry: 15, expired: false },
          ],
          asOf: "2026-09-30",
          status: "expiring",
          days: 30,
          totalQuantity: 40,
          totalValue: 2400,
          valuationMethod: "weighted_average",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/inventoryReports.batchStock?input=%7B%22json%22%3A%7B%22status%22%3A%22expiring%22%2C%22days%22%3A30%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data } = await trpc.inventoryReports.batchStock.query({ status: "expired" });
data.forEach((r) => console.log(r.name, r.batchNumber, r.quantity));`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Dates are judged in India time (IST).",
      ],
      relatedEndpoints: ["batch-list"],
    },
  ],
};
