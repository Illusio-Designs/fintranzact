import type { EndpointGroup } from "./types";
const API_BASE_URL = (import.meta.env.API_URL || (typeof window !== "undefined" ? window.location.origin : "https://fintranzact-production.up.railway.app")).replace(/\/$/, "");

export const manufacturingEndpoints: EndpointGroup = {
  id: "manufacturing",
  title: "Manufacturing (BOM)",
  description: "Bills of material and the manufacturing journal (Tally's BOM and Manufacturing Journal). A BOM says what goes into `outputQuantity` of a finished stock item (or one variant): its components (each with a quantity and optional wastage %) and optional by-products. An item can have several BOMs; one active BOM is its default (an item's first active BOM becomes default automatically). The production plan (`manufacturing.plan`) scales a BOM to a quantity — `component qty × (qty ÷ outputQuantity) × (1 + wastage% ÷ 100)` — and reports stock at the source warehouse and cost at current valuation rates, so a form can show shortages before posting. Manufacturing posts a journal (`MJ-1`, `MJ-2`, ...) in one transaction: components leave the source warehouse as `CONSUMPTION` movements, the finished item arrives in the destination warehouse as `PRODUCTION` and by-products as `BY_PRODUCT`, all under reference type `MANUFACTURING`. Each component is costed at its current valuation rate (weighted average or FIFO, per inventory settings); the run's total cost is components plus any additional costs (labour, power...), and `unitCost = totalCost ÷ quantity` is carried on the PRODUCTION movement so stock valuation prices finished goods like a purchase. By-products carry no cost. Cancelling a journal posts the opposite `*_REVERSAL` movements under `MANUFACTURING_CANCEL` and marks it `cancelled`; valuation stops counting the run from the cancellation date. Nothing is posted to the accounting ledger. Services can't be used anywhere in a BOM or journal. BOM/journal changes are not written to the audit log.",
  endpoints: [
    {
      id: "manufacturing-boms",
      method: "query",
      path: "manufacturing.boms",
      title: "List BOMs",
      description: "Paginated bills of material, optionally for one item, only active ones, or matching a search term. Ordered by item name, then default BOM first, then BOM name.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string | null", required: false, description: "Case-insensitive match on BOM name or finished item name (max 100 chars)" },
        { name: "itemId", type: "string (UUID) | null", required: false, description: "Only BOMs for this finished item (all its variants)" },
        { name: "activeOnly", type: "boolean", required: false, description: "Only active BOMs", default: "false" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Rows per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated BOM summaries. `itemName` includes the variant's attributes (\"Men's Kurta — White / L\").",
        example: {
          data: [
            {
              id: "bom-uuid-1",
              name: "Standard Kurta (Cotton)",
              itemId: "item-uuid-1",
              variantId: "variant-uuid-1",
              itemName: "Men's Kurta — White / L",
              unit: "pcs",
              outputQuantity: "10.000",
              isDefault: true,
              isActive: true,
              componentCount: 3,
              byProductCount: 1,
              updatedAt: "2026-09-12T08:20:00.000Z",
            },
          ],
          total: 14,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/manufacturing.boms?input=%7B%22json%22%3A%7B%22search%22%3A%22kurta%22%2C%22activeOnly%22%3Atrue%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.manufacturing.boms.query({ search: "kurta", activeOnly: true });
data.forEach(b => console.log(\`\${b.name} → \${b.outputQuantity} \${b.unit} of \${b.itemName}\${b.isDefault ? " (default)" : ""}\`));`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "The input object is required (send `{}` for defaults), unlike some report endpoints.",
      ],
      relatedEndpoints: ["manufacturing-bom", "manufacturing-bom-create"],
    },
    {
      id: "manufacturing-bom",
      method: "query",
      path: "manufacturing.bom",
      title: "Get BOM",
      description: "One BOM with its components and by-products in their saved order.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "BOM ID" },
      ],
      output: {
        description: "The BOM header plus `components` and `byProducts` arrays. Quantities are strings with 3 decimals; `wastagePercent` has 2.",
        example: {
          id: "bom-uuid-1",
          name: "Standard Kurta (Cotton)",
          itemId: "item-uuid-1",
          variantId: "variant-uuid-1",
          itemName: "Men's Kurta — White / L",
          unit: "pcs",
          outputQuantity: "10.000",
          isDefault: true,
          isActive: true,
          notes: "Cutting as per pattern KT-L-02",
          components: [
            { id: "bom-line-uuid-1", itemId: "item-uuid-10", variantId: null, name: "Cotton Fabric 60s", unit: "m", quantity: "25.000", wastagePercent: "4.00" },
            { id: "bom-line-uuid-2", itemId: "item-uuid-11", variantId: null, name: "Shell Buttons", unit: "pcs", quantity: "60.000", wastagePercent: "0.00" },
            { id: "bom-line-uuid-3", itemId: "item-uuid-12", variantId: null, name: "Polyester Thread 500m", unit: "pcs", quantity: "2.000", wastagePercent: "0.00" },
          ],
          byProducts: [
            { id: "bom-bp-uuid-1", itemId: "item-uuid-13", variantId: null, name: "Fabric Offcuts", unit: "kg", quantity: "0.800" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/manufacturing.bom?input=%7B%22json%22%3A%7B%22id%22%3A%22bom-uuid-1%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const bom = await trpc.manufacturing.bom.query({ id: "bom-uuid-1" });
bom.components.forEach(c => console.log(\`\${c.quantity} \${c.unit} \${c.name} (+\${c.wastagePercent}% wastage)\`));`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "NOT_FOUND `BOM not found` if the id doesn't belong to the active business.",
      ],
      relatedEndpoints: ["manufacturing-bom-update", "manufacturing-plan"],
    },
    {
      id: "manufacturing-bom-create",
      method: "mutation",
      path: "manufacturing.bomCreate",
      title: "Create BOM",
      description: "Create a bill of material for a finished stock item (or one of its variants). All items are validated: they must be non-deleted products of this business, with a variant exactly when the item is variant-mode. Duplicate lines, the finished item appearing as its own component or by-product, an item being both a component and a by-product, and cycles through other BOMs (A needs B, B needs A) are all refused.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Finished item" },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "Finished variant — required when the item is variant-mode, forbidden otherwise" },
        { name: "name", type: "string", required: true, description: "BOM name, trimmed, 1–200 chars" },
        { name: "outputQuantity", type: "string (decimal)", required: false, description: "Quantity of the finished item the BOM makes; > 0, up to 3 decimals", default: "\"1\"" },
        { name: "isDefault", type: "boolean", required: false, description: "Make this the item's default BOM (clears the flag on its other BOMs)", default: "false" },
        { name: "isActive", type: "boolean", required: false, description: "Inactive BOMs can't be used to manufacture", default: "true" },
        { name: "notes", type: "string | null", required: false, description: "Free-text notes (max 1000 chars)" },
        { name: "components", type: "array", required: true, description: "1–200 component lines" },
        { name: "components[].itemId", type: "string (UUID)", required: true, description: "Component item" },
        { name: "components[].variantId", type: "string (UUID) | null", required: false, description: "Component variant (for variant-mode items)" },
        { name: "components[].quantity", type: "string (decimal)", required: true, description: "Quantity per `outputQuantity`; > 0, up to 3 decimals, in the component's base unit" },
        { name: "components[].wastagePercent", type: "string (decimal)", required: false, description: "Extra % consumed on top of the quantity; up to 2 decimals, max 1000", default: "\"0\"" },
        { name: "byProducts", type: "array", required: false, description: "0–50 by-product lines", default: "[]" },
        { name: "byProducts[].itemId", type: "string (UUID)", required: true, description: "By-product item" },
        { name: "byProducts[].variantId", type: "string (UUID) | null", required: false, description: "By-product variant" },
        { name: "byProducts[].quantity", type: "string (decimal)", required: true, description: "Quantity per `outputQuantity`; > 0, up to 3 decimals" },
      ],
      output: {
        description: "The new BOM's id.",
        example: { id: "bom-uuid-1" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/manufacturing.bomCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "itemId": "item-uuid-1",
      "variantId": "variant-uuid-1",
      "name": "Standard Kurta (Cotton)",
      "outputQuantity": "10",
      "components": [
        { "itemId": "item-uuid-10", "quantity": "25", "wastagePercent": "4" },
        { "itemId": "item-uuid-11", "quantity": "60" }
      ],
      "byProducts": [
        { "itemId": "item-uuid-13", "quantity": "0.8" }
      ]
    }
  }'`,
        javascript: `const { id } = await trpc.manufacturing.bomCreate.mutate({
  itemId: "item-uuid-1",
  variantId: "variant-uuid-1",
  name: "Standard Kurta (Cotton)",
  outputQuantity: "10",
  components: [
    { itemId: "item-uuid-10", quantity: "25", wastagePercent: "4" }, // 25 m fabric + 4% wastage
    { itemId: "item-uuid-11", quantity: "60" },                      // buttons
  ],
  byProducts: [{ itemId: "item-uuid-13", quantity: "0.8" }],         // offcuts, kg
});`,
      },
      gotchas: [
        "Requires `Item:update` permission (there is no separate BOM subject; creating a BOM counts as updating items).",
        "Quantities and wastage are strings, not numbers: `\"25\"`, `\"0.8\"`, `\"4.5\"`.",
        "An item's first active BOM becomes its default even if `isDefault` is false. An inactive BOM is never made default automatically, but `isDefault: true` with `isActive: false` is stored as given on create.",
        "BAD_REQUEST messages: `X is a service — services don't carry stock`, `Pick a variant of X`, `X has no variants`, `X is listed twice among the components`, `X can't be a component of itself`, `The finished item can't also be a by-product`, `X can't be both a component and a by-product`, `X is already used to make Y, so it can't be made from it` (cycle). NOT_FOUND for unknown items/variants.",
        "Runs in a transaction; nothing is written to the audit log.",
      ],
      relatedEndpoints: ["manufacturing-bom-update", "manufacturing-plan", "manufacturing-manufacture"],
    },
    {
      id: "manufacturing-bom-update",
      method: "mutation",
      path: "manufacturing.bomUpdate",
      title: "Update BOM",
      description: "Replace a BOM entirely: header fields are overwritten and all component and by-product lines are deleted and re-inserted from the input. Same validation as create (cycle detection ignores this BOM's old lines).",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "BOM to update" },
        { name: "itemId", type: "string (UUID)", required: true, description: "Finished item (can be changed)" },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "Finished variant" },
        { name: "name", type: "string", required: true, description: "BOM name, 1–200 chars" },
        { name: "outputQuantity", type: "string (decimal)", required: false, description: "Output quantity; > 0, up to 3 decimals", default: "\"1\"" },
        { name: "isDefault", type: "boolean", required: false, description: "Default BOM for the item. Only kept when `isActive` is also true.", default: "false" },
        { name: "isActive", type: "boolean", required: false, description: "Active flag", default: "true" },
        { name: "notes", type: "string | null", required: false, description: "Notes (max 1000 chars); blank clears" },
        { name: "components", type: "array", required: true, description: "Full list of 1–200 components (same shape as `bomCreate`)" },
        { name: "byProducts", type: "array", required: false, description: "Full list of 0–50 by-products (same shape as `bomCreate`)", default: "[]" },
      ],
      output: {
        description: "The BOM's id.",
        example: { id: "bom-uuid-1" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/manufacturing.bomUpdate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"bom-uuid-1","itemId":"item-uuid-1","variantId":"variant-uuid-1","name":"Standard Kurta (Cotton) v2","outputQuantity":"10","isDefault":true,"components":[{"itemId":"item-uuid-10","quantity":"24","wastagePercent":"3"},{"itemId":"item-uuid-11","quantity":"60"}]}}'`,
        javascript: `// Fetch, modify, send back the whole BOM
const bom = await trpc.manufacturing.bom.query({ id: "bom-uuid-1" });
await trpc.manufacturing.bomUpdate.mutate({
  id: bom.id,
  itemId: bom.itemId,
  variantId: bom.variantId,
  name: bom.name,
  outputQuantity: bom.outputQuantity,
  isDefault: bom.isDefault,
  isActive: bom.isActive,
  notes: bom.notes,
  components: bom.components.map(c => ({
    itemId: c.itemId, variantId: c.variantId,
    quantity: c.itemId === "item-uuid-10" ? "24" : c.quantity,
    wastagePercent: c.wastagePercent,
  })),
  byProducts: bom.byProducts.map(b => ({ itemId: b.itemId, variantId: b.variantId, quantity: b.quantity })),
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "This is a full replace, not a patch — omitted fields fall back to their defaults (`isDefault: false`, `isActive: true`, `outputQuantity: \"1\"`, `byProducts: []`). Always send the complete BOM.",
        "Unlike create, update does not auto-promote a BOM to default; saving the current default with `isDefault: false` (or `isActive: false`) leaves the item with no flagged default — `plan`/manufacturing then fall back to the most recently updated active BOM.",
        "Existing manufacturing journals are unaffected — they keep their own lines.",
        "NOT_FOUND `BOM not found`; BAD_REQUEST for the same validation errors as create.",
      ],
      relatedEndpoints: ["manufacturing-bom", "manufacturing-bom-create"],
    },
    {
      id: "manufacturing-bom-delete",
      method: "mutation",
      path: "manufacturing.bomDelete",
      title: "Delete BOM",
      description: "Permanently delete a BOM and its lines. Journals made from it keep their own component/by-product lines; their `bomId` is cleared.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "BOM to delete" },
      ],
      output: {
        description: "Success flag.",
        example: { ok: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/manufacturing.bomDelete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"bom-uuid-1"}}'`,
        javascript: `await trpc.manufacturing.bomDelete.mutate({ id: "bom-uuid-1" });`,
      },
      gotchas: [
        "Requires `Item:update` permission — not `Item:delete`, so anyone who can edit items (e.g. `seller_manager`) can delete BOMs.",
        "Hard delete, no audit log entry. Returns `{ ok: true }` (not `success`).",
        "Deleting the default BOM does not promote another one; the item's most recently updated active BOM is used as the fallback default.",
        "NOT_FOUND `BOM not found` if it doesn't exist in this business.",
      ],
      relatedEndpoints: ["manufacturing-boms"],
    },
    {
      id: "manufacturing-plan",
      method: "query",
      path: "manufacturing.plan",
      title: "Production Plan",
      description: "Preview a production run without posting anything: the BOM's components and by-products scaled to `quantity` (components include wastage), with stock available at the source warehouse and each component's current valuation rate and amount. Without `bomId`, the item's default active BOM is used (explicit default first, else the most recently updated active BOM); with neither a BOM nor an item, only `extra` lines are described.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "bomId", type: "string (UUID) | null", required: false, description: "BOM to plan from. Takes precedence over `itemId`." },
        { name: "itemId", type: "string (UUID) | null", required: false, description: "Finished item — used to find its default BOM when `bomId` is omitted" },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "Finished variant (with `itemId`)" },
        { name: "quantity", type: "string (decimal)", required: true, description: "Quantity to make; > 0, up to 3 decimals" },
        { name: "sourceWarehouseId", type: "string (UUID) | null", required: false, description: "Warehouse components will come from. When omitted, `available` is null on every line." },
        { name: "extra", type: "array", required: false, description: "Up to 200 extra units (`{ itemId, variantId? }`) to report stock and rate for — lines added by hand on the form. Units already among the components are dropped.", default: "[]" },
      ],
      output: {
        description: "BOM summary (or null), the finished unit (or null), scaled component lines, extra lines (standard quantity 0), scaled by-products and the components' total cost. Quantities are 3-decimal strings, `rate`/`amount`/`componentsCost` 2-decimal strings.",
        example: {
          bom: { id: "bom-uuid-1", name: "Standard Kurta (Cotton)", outputQuantity: "10.000", isActive: true },
          finished: { itemId: "item-uuid-1", variantId: "variant-uuid-1", name: "Men's Kurta — White / L", unit: "pcs" },
          components: [
            { itemId: "item-uuid-10", variantId: null, name: "Cotton Fabric 60s", unit: "m", standardQuantity: "130.000", available: "1550.000", rate: "140.00", amount: "18200.00" },
            { itemId: "item-uuid-11", variantId: null, name: "Shell Buttons", unit: "pcs", standardQuantity: "300.000", available: "240.000", rate: "1.50", amount: "450.00" },
          ],
          extra: [],
          byProducts: [
            { itemId: "item-uuid-13", variantId: null, name: "Fabric Offcuts", unit: "kg", standardQuantity: "4.000" },
          ],
          componentsCost: "18650.00",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/manufacturing.plan?input=%7B%22json%22%3A%7B%22itemId%22%3A%22item-uuid-1%22%2C%22variantId%22%3A%22variant-uuid-1%22%2C%22quantity%22%3A%2250%22%2C%22sourceWarehouseId%22%3A%22warehouse-uuid-1%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const plan = await trpc.manufacturing.plan.query({
  itemId: "item-uuid-1",
  variantId: "variant-uuid-1",
  quantity: "50",
  sourceWarehouseId: "warehouse-uuid-1",
});

const short = plan.components.filter(c => c.available !== null && +c.available < +c.standardQuantity);
short.forEach(c => console.log(\`Short: \${c.name} needs \${c.standardQuantity}, has \${c.available}\`));
console.log("Material cost ₹", plan.componentsCost);`,
      },
      gotchas: [
        "Requires `Item:read` permission. Read-only — no stock or journal is touched.",
        "`available` at the default (sales) warehouse includes unplaced stock (stock no warehouse accounts for), matching what `manufacture` will place there before consuming.",
        "`componentsCost` covers BOM components only, not `extra` lines or additional costs.",
        "An inactive BOM passed as `bomId` is still planned (`bom.isActive` is false) — but `manufacture` will reject it.",
        "Rates are the current business-wide valuation rates; a unit with no purchase history or purchase price has rate `\"0.00\"`.",
        "NOT_FOUND `BOM not found` / `Item not found`; BAD_REQUEST for services or missing/unexpected variants.",
      ],
      relatedEndpoints: ["manufacturing-manufacture", "manufacturing-bom"],
    },
    {
      id: "manufacturing-manufacture",
      method: "mutation",
      path: "manufacturing.manufacture",
      title: "Manufacture (Post Journal)",
      description: "Post a manufacturing journal in one transaction. Component and by-product quantities default to the BOM scaled to `quantity` (components with wastage); pass `components` / `byProducts` to record what was actually used or produced instead (the BOM's scaled quantity is kept on each line as `standardQuantity` for variance). Unplaced stock of each component is first placed in the default warehouse, then — under the \"block\" negative-stock policy — the source warehouse must hold enough of every component. Components are costed at their current valuation rate; `CONSUMPTION` movements leave the source warehouse, and `PRODUCTION` (at `unitCost`) and `BY_PRODUCT` movements arrive in the destination warehouse.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "bomId", type: "string (UUID) | null", required: false, description: "BOM to manufacture from (must be active). Either this or `itemId` is required." },
        { name: "itemId", type: "string (UUID) | null", required: false, description: "Finished item. Without `bomId`, no BOM is used (the default BOM is NOT looked up) and `components` must be given." },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "Finished variant" },
        { name: "quantity", type: "string (decimal)", required: true, description: "Quantity made; > 0, up to 3 decimals" },
        { name: "date", type: "string (ISO datetime)", required: false, description: "Journal and movement date", default: "now" },
        { name: "sourceWarehouseId", type: "string (UUID)", required: true, description: "Active warehouse components are consumed from" },
        { name: "destinationWarehouseId", type: "string (UUID)", required: true, description: "Active warehouse finished goods and by-products go to (may equal the source)" },
        { name: "components", type: "array", required: false, description: "Actual components used (max 200), overriding the BOM. Lines with quantity 0 are dropped." },
        { name: "components[].itemId", type: "string (UUID)", required: true, description: "Component item" },
        { name: "components[].variantId", type: "string (UUID) | null", required: false, description: "Component variant" },
        { name: "components[].quantity", type: "string (decimal)", required: true, description: "Quantity used; ≥ 0, up to 3 decimals" },
        { name: "byProducts", type: "array", required: false, description: "Actual by-products (max 50), same shape as `components`, overriding the BOM" },
        { name: "additionalCosts", type: "array", required: false, description: "Up to 20 extra costs added to the run's cost", default: "[]" },
        { name: "additionalCosts[].label", type: "string", required: true, description: "Cost name, e.g. \"Stitching labour\" (1–100 chars)" },
        { name: "additionalCosts[].amount", type: "string (decimal)", required: true, description: "Amount, up to 2 decimals" },
        { name: "notes", type: "string | null", required: false, description: "Notes (max 1000 chars)" },
      ],
      output: {
        description: "The posted journal's id, number and costs. `componentsCost`/`totalCost` have 2 decimals, `unitCost` 4.",
        example: {
          id: "journal-uuid-1",
          journalNumber: "MJ-7",
          componentsCost: "18650.00",
          totalCost: "21150.00",
          unitCost: "423.0000",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/manufacturing.manufacture \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "bomId": "bom-uuid-1",
      "quantity": "50",
      "sourceWarehouseId": "warehouse-uuid-1",
      "destinationWarehouseId": "warehouse-uuid-2",
      "additionalCosts": [
        { "label": "Stitching labour", "amount": "2000" },
        { "label": "Electricity", "amount": "500" }
      ],
      "notes": "Batch for Diwali orders"
    }
  }'`,
        javascript: `// Plan first to show shortages, then post
const plan = await trpc.manufacturing.plan.query({
  bomId: "bom-uuid-1", quantity: "50", sourceWarehouseId: "warehouse-uuid-1",
});

const journal = await trpc.manufacturing.manufacture.mutate({
  bomId: "bom-uuid-1",
  quantity: "50",
  sourceWarehouseId: "warehouse-uuid-1",
  destinationWarehouseId: "warehouse-uuid-2",
  // Record actual usage (fabric came out a little higher than standard)
  components: plan.components.map(c => ({
    itemId: c.itemId,
    variantId: c.variantId,
    quantity: c.itemId === "item-uuid-10" ? "134" : c.standardQuantity,
  })),
  additionalCosts: [{ label: "Stitching labour", amount: "2000" }],
});
console.log(\`\${journal.journalNumber}: ₹\${journal.unitCost} per piece\`);`,
      },
      gotchas: [
        "Requires `Item:update` permission. Non-admin members additionally need the per-warehouse `canAdjust` grant on both warehouses (FORBIDDEN `You don't have adjustment permission for this warehouse`).",
        "BAD_REQUEST: `This BOM is inactive`, `That BOM is for a different item` (when both `bomId` and a mismatching `itemId`/`variantId` are sent), `Pick a BOM or the item to make`, `Add the components used` (no non-zero components), `X can't be used to make itself`, duplicate lines, services, `That warehouse is inactive`. NOT_FOUND `Warehouse not found`.",
        "Under the \"block\" negative-stock policy: BAD_REQUEST `Not enough stock — Cotton Fabric 60s: 120 m available, 130 needed; ...`. Under \"warn\"/\"allow\" the run posts and stock may go negative.",
        "Journal numbers are sequential per business (`MJ-<count+1>`); journals are serialised by locking the business's inventory settings row.",
        "Components are valued at the rate as of the later of `date` and now — backdating does not use a historical rate. Component rate × quantity gives each line's amount; `unitCost = (componentsCost + additional costs) ÷ quantity`. By-products are costed at zero.",
        "Unplaced component stock is moved into the default warehouse first (an `OPENING_BALANCE`/`UNPLACED_STOCK` movement), which can appear in stock ledgers alongside the run.",
        "No accounting entries and no audit log are written; the stock movements are the record.",
      ],
      relatedEndpoints: ["manufacturing-plan", "manufacturing-journal", "manufacturing-cancel", "inventory-reports-stock-ledger"],
    },
    {
      id: "manufacturing-journals",
      method: "query",
      path: "manufacturing.journals",
      title: "List Manufacturing Journals",
      description: "Paginated manufacturing journals, newest first (by journal date, then creation time), including cancelled ones. Also returns the business's default production warehouse from inventory settings so a form can preselect it.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Rows per page (1–100)", default: "20" },
      ],
      output: {
        description: "Journal summaries with pagination and `productionWarehouseId` (null when not configured).",
        example: {
          data: [
            {
              id: "journal-uuid-1",
              journalNumber: "MJ-7",
              date: "2026-09-28T10:00:00.000Z",
              status: "posted",
              itemId: "item-uuid-1",
              variantId: "variant-uuid-1",
              itemName: "Men's Kurta — White / L",
              unit: "pcs",
              quantity: "50.000",
              totalCost: "21150.00",
              unitCost: "423.0000",
              sourceName: "Main Godown",
              destinationName: "Finished Goods Store",
              bomName: "Standard Kurta (Cotton)",
              componentCount: 3,
            },
          ],
          total: 7,
          page: 1,
          limit: 20,
          productionWarehouseId: "warehouse-uuid-1",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/manufacturing.journals?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.manufacturing.journals.query({ page: 1, limit: 20 });
data.filter(j => j.status === "posted").forEach(j => console.log(j.journalNumber, j.itemName, j.quantity));`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "`status` is `posted` or `cancelled`. There are no filters — filter client-side.",
        "`bomName` is null when the journal was posted without a BOM or its BOM was later deleted.",
      ],
      relatedEndpoints: ["manufacturing-journal", "manufacturing-manufacture"],
    },
    {
      id: "manufacturing-journal",
      method: "query",
      path: "manufacturing.journal",
      title: "Get Manufacturing Journal",
      description: "One journal with its header, costs, additional costs and its component and by-product lines. Each line keeps `standardQuantity` (what the BOM called for, or null when the line wasn't in the BOM) next to the actual `quantity`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Journal ID" },
      ],
      output: {
        description: "Journal header plus `components` and `byProducts`. By-product lines have `unitCost` and `amount` of 0.",
        example: {
          id: "journal-uuid-1",
          journalNumber: "MJ-7",
          date: "2026-09-28T10:00:00.000Z",
          status: "posted",
          bomId: "bom-uuid-1",
          bomName: "Standard Kurta (Cotton)",
          itemId: "item-uuid-1",
          variantId: "variant-uuid-1",
          itemName: "Men's Kurta — White / L",
          unit: "pcs",
          quantity: "50.000",
          sourceWarehouseId: "warehouse-uuid-1",
          sourceName: "Main Godown",
          destinationWarehouseId: "warehouse-uuid-2",
          destinationName: "Finished Goods Store",
          componentsCost: "18650.00",
          additionalCosts: [{ label: "Stitching labour", amount: "2000.00" }, { label: "Electricity", amount: "500.00" }],
          additionalCostTotal: "2500.00",
          totalCost: "21150.00",
          unitCost: "423.0000",
          notes: "Batch for Diwali orders",
          createdByName: "Rakesh Patel",
          cancelledAt: null,
          components: [
            { id: "mj-line-uuid-1", kind: "component", itemId: "item-uuid-10", variantId: null, name: "Cotton Fabric 60s", unit: "m", standardQuantity: "130.000", quantity: "130.000", unitCost: "140.0000", amount: "18200.00" },
            { id: "mj-line-uuid-2", kind: "component", itemId: "item-uuid-11", variantId: null, name: "Shell Buttons", unit: "pcs", standardQuantity: "300.000", quantity: "300.000", unitCost: "1.5000", amount: "450.00" },
          ],
          byProducts: [
            { id: "mj-line-uuid-3", kind: "by_product", itemId: "item-uuid-13", variantId: null, name: "Fabric Offcuts", unit: "kg", standardQuantity: "4.000", quantity: "4.200", unitCost: "0.0000", amount: "0.00" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/manufacturing.journal?input=%7B%22json%22%3A%7B%22id%22%3A%22journal-uuid-1%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const j = await trpc.manufacturing.journal.query({ id: "journal-uuid-1" });

// Usage variance against the BOM
j.components.forEach(c => {
  if (c.standardQuantity !== null) {
    console.log(c.name, "variance:", (+c.quantity - +c.standardQuantity).toFixed(3), c.unit);
  }
});`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "NOT_FOUND `Manufacturing journal not found`.",
        "`additionalCosts` is a JSON array stored on the journal, not separate lines.",
      ],
      relatedEndpoints: ["manufacturing-journals", "manufacturing-cancel"],
    },
    {
      id: "manufacturing-cancel",
      method: "mutation",
      path: "manufacturing.cancel",
      title: "Cancel Manufacturing Journal",
      description: "Reverse a posted journal: components go back to the source warehouse and the finished goods and by-products come out of the destination warehouse, as `CONSUMPTION_REVERSAL`, `PRODUCTION_REVERSAL` and `BY_PRODUCT_REVERSAL` movements under reference type `MANUFACTURING_CANCEL`, dated now. The journal is marked `cancelled` with `cancelledAt`. Under the \"block\" negative-stock policy, cancellation is refused if the goods made have already moved on (sold or transferred) so the destination no longer holds them.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Journal to cancel" },
      ],
      output: {
        description: "The cancelled journal's id.",
        example: { id: "journal-uuid-1" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/manufacturing.cancel \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"journal-uuid-1"}}'`,
        javascript: `try {
  await trpc.manufacturing.cancel.mutate({ id: "journal-uuid-1" });
} catch (err) {
  // e.g. "Can't cancel — the goods made have already moved on. Men's Kurta — White / L: 12 pcs available, 50 needed"
  console.error(err.message);
}`,
      },
      gotchas: [
        "Requires `Item:update` permission, plus the per-warehouse `canAdjust` grant on both warehouses for non-admin members (FORBIDDEN otherwise).",
        "BAD_REQUEST `This journal is already cancelled`; NOT_FOUND `Manufacturing journal not found`; BAD_REQUEST `That warehouse is inactive` if either warehouse has since been deactivated; NOT_FOUND `Warehouse not found`.",
        "The reversal is computed from the journal's actual stock movements, not its lines, and is dated at cancellation time, not the journal date — stock ledgers show the run in its original period and the reversal in the current one.",
        "Stock valuation stops counting the run's production cost from the cancellation date. Reversal movements carry no unit cost.",
        "The journal is kept (status `cancelled`), not deleted, so its number is never reused. No audit log entry is written.",
      ],
      relatedEndpoints: ["manufacturing-journal", "manufacturing-manufacture"],
    },
  ],
};
