import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const priceLevelEndpoints: EndpointGroup = {
  id: "price-levels",
  title: "Price Levels",
  description: "Named selling-price levels (Tally's \"Price Levels / Price Lists\") such as Retail, Wholesale or Dealer. Levels only price sales; purchases keep using the item's purchase price. A price level has a `name` (unique per business), optional `description` and a `sortOrder`; at most one level per business is the default (`isDefault`), and marking a level default clears the flag on the others in the same transaction. A party carries an optional `priceLevelId` (set via `party.create` / `party.update`): sales to that party are priced at its level, parties without one use the default level, and with no default level items sell at their own sale price. Deleting a level sets `priceLevelId` to null on its parties. Prices live in price list entries, one per level / item / optional variant (`variantId` null = every variant) / optional alternate unit (`unit` null = base unit) / quantity slab (`minQuantity`, the quantity from which the entry applies; \"0\" = from the first unit) / optional `effectiveFrom` date (null = always). Each entry has a `price`, a `discountPercent` or both. Entries of one level/item/variant/unit that share an effective date form a revision; the latest revision on or before the document date applies. The plain price is the entry with no unit, no date and `minQuantity` 0: the one cell the Price Levels grid (`priceLevel.grid` / `priceLevel.setGridPrices`) edits. Slabs, alternate-unit prices and dated revisions are managed per item with `priceLevel.setItemPrices`. Use `pricing.resolve` to see the price a sale line actually gets.",
  endpoints: [
    {
      id: "price-level-list",
      method: "query",
      path: "priceLevel.list",
      title: "List Price Levels",
      description: "All price levels of the active business, ordered by `sortOrder` then `name`, with the number of price list entries on each level and the number of parties assigned to it.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of price levels with usage counts.",
        example: [
          { id: "level-uuid-retail", name: "Retail", description: "Walk-in customers", isDefault: true, sortOrder: 0, entryCount: 184, partyCount: 0 },
          { id: "level-uuid-wholesale", name: "Wholesale", description: "Kirana stores, min. 1 carton", isDefault: false, sortOrder: 1, entryCount: 212, partyCount: 37 },
          { id: "level-uuid-dealer", name: "Dealer", description: null, isDefault: false, sortOrder: 2, entryCount: 96, partyCount: 8 },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/priceLevel.list" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const levels = await trpc.priceLevel.list.query();
const defaultLevel = levels.find((l) => l.isDefault);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "`entryCount` counts every entry on the level — slabs, alternate-unit prices and dated revisions included — not the number of distinct items.",
        "Not paginated; businesses typically have only a handful of levels.",
      ],
      relatedEndpoints: ["price-level-create", "price-level-grid"],
    },
    {
      id: "price-level-create",
      method: "mutation",
      path: "priceLevel.create",
      title: "Create Price Level",
      description: "Create a new price level. When `isDefault` is true, the default flag is removed from any other level of the business in the same transaction. Writes a `priceLevel.create` audit log entry.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "name", type: "string", required: true, description: "Level name, 1–100 chars (trimmed). Must be unique within the business." },
        { name: "description", type: "string | null", required: false, description: "Free-text description, up to 500 chars." },
        { name: "isDefault", type: "boolean", required: false, description: "Make this the business's default level (used for parties without their own level).", default: "false" },
        { name: "sortOrder", type: "integer", required: false, description: "Display order, 0–10000.", default: "0" },
      ],
      output: {
        description: "The created price level row.",
        example: {
          id: "level-uuid-wholesale",
          businessId: "business-uuid",
          name: "Wholesale",
          description: "Kirana stores, min. 1 carton",
          isDefault: false,
          sortOrder: 1,
          createdAt: "2026-09-30T06:12:44.120Z",
          updatedAt: "2026-09-30T06:12:44.120Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/priceLevel.create" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"name":"Wholesale","description":"Kirana stores, min. 1 carton","sortOrder":1}}'`,
        javascript: `const level = await trpc.priceLevel.create.mutate({
  name: "Wholesale",
  description: "Kirana stores, min. 1 carton",
  sortOrder: 1,
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`CONFLICT` — \"A price level with this name already exists\" when the name is taken (unique per business).",
        "A new level has no prices: until entries are added, every item sells at its own sale price on this level.",
      ],
      relatedEndpoints: ["price-level-update", "price-level-set-grid-prices", "price-level-bulk-update"],
    },
    {
      id: "price-level-update",
      method: "mutation",
      path: "priceLevel.update",
      title: "Update Price Level",
      description: "Partially update a level's name, description, default flag or sort order. Setting `isDefault: true` clears the flag on the business's other levels in the same transaction.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Price level ID." },
        { name: "data.name", type: "string", required: false, description: "New name, 1–100 chars (trimmed); must stay unique." },
        { name: "data.description", type: "string | null", required: false, description: "New description (max 500 chars); `null` clears it." },
        { name: "data.isDefault", type: "boolean", required: false, description: "`true` makes this the default level; `false` un-sets it (leaving the business with no default level)." },
        { name: "data.sortOrder", type: "integer", required: false, description: "Display order, 0–10000." },
      ],
      output: {
        description: "The updated price level row.",
        example: {
          id: "level-uuid-wholesale",
          businessId: "business-uuid",
          name: "Wholesale",
          description: "Kirana stores, min. 1 carton",
          isDefault: true,
          sortOrder: 1,
          createdAt: "2026-09-30T06:12:44.120Z",
          updatedAt: "2026-09-30T08:40:02.511Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/priceLevel.update" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"id":"level-uuid-wholesale","data":{"isDefault":true}}}'`,
        javascript: `// Make Wholesale the default level for parties without their own level
await trpc.priceLevel.update.mutate({
  id: "level-uuid-wholesale",
  data: { isDefault: true },
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`NOT_FOUND` — \"Price level not found\" when the ID doesn't belong to the active business.",
        "`CONFLICT` — \"A price level with this name already exists\" on a duplicate name.",
        "Un-setting the default (`isDefault: false`) means parties without a level fall back to the items' own sale prices.",
        "Unlike create/delete, updates are not written to the audit log.",
      ],
      relatedEndpoints: ["price-level-list", "price-level-create"],
    },
    {
      id: "price-level-delete",
      method: "mutation",
      path: "priceLevel.delete",
      title: "Delete Price Level",
      description: "Delete a price level together with all its price list entries (cascade). Parties assigned to it have their `priceLevelId` set to `null`, so they fall back to the default level. Writes a `priceLevel.delete` audit log entry.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Price level ID." },
      ],
      output: {
        description: "Success flag.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/priceLevel.delete" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"id":"level-uuid-dealer"}}'`,
        javascript: `await trpc.priceLevel.delete.mutate({ id: "level-uuid-dealer" });`,
      },
      gotchas: [
        "Requires `Item:delete` permission (admins only by default).",
        "`NOT_FOUND` — \"Price level not found\" when the ID doesn't belong to the active business.",
        "Irreversible: every slab, alternate-unit price and dated revision on the level is deleted.",
        "Deleting the default level leaves the business with no default; it is not reassigned automatically.",
        "Invoices already created keep their line prices — deletion only affects future pricing.",
      ],
      relatedEndpoints: ["price-level-list"],
    },
    {
      id: "price-level-item-entries",
      method: "query",
      path: "priceLevel.itemEntries",
      title: "Item Price Entries",
      description: "Every price list entry of one item across all levels — plain prices, quantity slabs, alternate units, per-variant prices and dated revisions. Ordered by level, then `effectiveFrom`, then `minQuantity`. Used by the item form's price-levels tab.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Item ID." },
      ],
      output: {
        description: "Raw `price_list_entries` rows. `unit: null` means the item's base unit; `variantId: null` means all variants; `effectiveFrom: null` means always.",
        example: [
          {
            id: "entry-uuid-1",
            businessId: "business-uuid",
            priceLevelId: "level-uuid-wholesale",
            itemId: "item-uuid",
            variantId: null,
            unit: null,
            minQuantity: "0.000",
            price: "92.00",
            discountPercent: null,
            effectiveFrom: null,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z",
          },
          {
            id: "entry-uuid-2",
            businessId: "business-uuid",
            priceLevelId: "level-uuid-wholesale",
            itemId: "item-uuid",
            variantId: null,
            unit: null,
            minQuantity: "50.000",
            price: "88.50",
            discountPercent: null,
            effectiveFrom: null,
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z",
          },
          {
            id: "entry-uuid-3",
            businessId: "business-uuid",
            priceLevelId: "level-uuid-wholesale",
            itemId: "item-uuid",
            variantId: null,
            unit: "box",
            minQuantity: "0.000",
            price: "1050.00",
            discountPercent: null,
            effectiveFrom: "2026-10-01",
            createdAt: "2026-09-25T10:00:00.000Z",
            updatedAt: "2026-09-25T10:00:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/priceLevel.itemEntries?input=%7B%22json%22%3A%7B%22itemId%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const entries = await trpc.priceLevel.itemEntries.query({ itemId: "item-uuid" });

// Group into revisions: level / variant / unit / effectiveFrom
const key = (e) => [e.priceLevelId, e.variantId, e.unit, e.effectiveFrom].join("|");`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "The item is not validated — an unknown or deleted item ID returns an empty array rather than `NOT_FOUND`.",
        "Returns every revision, including future-dated ones and superseded ones; use `pricing.resolve` to find the price that applies on a date.",
      ],
      relatedEndpoints: ["price-level-set-item-prices", "pricing-resolve"],
    },
    {
      id: "price-level-set-item-prices",
      method: "mutation",
      path: "priceLevel.setItemPrices",
      title: "Set Item Price Slabs",
      description: "Replace the slabs of one **revision** — the entries of one level / item / variant / unit that share an `effectiveFrom` date. All existing entries of that revision are deleted and the given slabs inserted in one transaction. Passing an empty `slabs` array removes the revision.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "priceLevelId", type: "string (UUID)", required: true, description: "Price level ID." },
        { name: "itemId", type: "string (UUID)", required: true, description: "Item ID (must not be deleted)." },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "Variant of the item. Omit / `null` for a price that applies to every variant." },
        { name: "unit", type: "string | null", required: false, description: "Unit the slabs are priced in (1–50 chars). Omit, `null` or the item's base unit = base unit; otherwise must be one of the item's alternate units (`unitVariants`)." },
        { name: "effectiveFrom", type: "string (YYYY-MM-DD) | null", required: false, description: "Date the revision takes effect. Omit / `null` = always." },
        { name: "slabs", type: "array", required: true, description: "Up to 50 slabs. Empty array deletes the revision." },
        { name: "slabs[].minQuantity", type: "string (decimal)", required: false, description: "Quantity (in `unit`) from which the slab applies; up to 12 digits and 3 decimals. Must be distinct across slabs.", default: "\"0\"" },
        { name: "slabs[].price", type: "string (decimal) | null", required: false, description: "Rate per unit (up to 13 digits, 2 decimals)." },
        { name: "slabs[].discountPercent", type: "string (decimal) | null", required: false, description: "Discount %, 0–100 with up to 2 decimals. With no `price`, the discount applies to the item's own sale price." },
      ],
      output: {
        description: "The inserted entry rows (empty array when `slabs` was empty).",
        example: [
          {
            id: "entry-uuid-10",
            businessId: "business-uuid",
            priceLevelId: "level-uuid-wholesale",
            itemId: "item-uuid",
            variantId: null,
            unit: null,
            minQuantity: "0.000",
            price: "92.00",
            discountPercent: null,
            effectiveFrom: "2026-10-01",
            createdAt: "2026-09-30T09:15:00.000Z",
            updatedAt: "2026-09-30T09:15:00.000Z",
          },
          {
            id: "entry-uuid-11",
            businessId: "business-uuid",
            priceLevelId: "level-uuid-wholesale",
            itemId: "item-uuid",
            variantId: null,
            unit: null,
            minQuantity: "50.000",
            price: "88.50",
            discountPercent: "2.00",
            effectiveFrom: "2026-10-01",
            createdAt: "2026-09-30T09:15:00.000Z",
            updatedAt: "2026-09-30T09:15:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/priceLevel.setItemPrices" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"priceLevelId":"level-uuid-wholesale","itemId":"item-uuid","effectiveFrom":"2026-10-01","slabs":[{"minQuantity":"0","price":"92.00"},{"minQuantity":"50","price":"88.50","discountPercent":"2"}]}}'`,
        javascript: `// Wholesale rate from 1 Oct: ₹92 per pc, ₹88.50 less 2% from 50 pcs
await trpc.priceLevel.setItemPrices.mutate({
  priceLevelId: "level-uuid-wholesale",
  itemId: "item-uuid",
  effectiveFrom: "2026-10-01",
  slabs: [
    { minQuantity: "0", price: "92.00" },
    { minQuantity: "50", price: "88.50", discountPercent: "2" },
  ],
});

// Remove that dated revision again
await trpc.priceLevel.setItemPrices.mutate({
  priceLevelId: "level-uuid-wholesale",
  itemId: "item-uuid",
  effectiveFrom: "2026-10-01",
  slabs: [],
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "Each slab needs a `price` or a `discountPercent` (\"Give a price or a discount\"); a discount above 100 is rejected.",
        "`BAD_REQUEST` — \"Two slabs start at the same quantity\" when `minQuantity` values repeat (compared numerically, so `\"5\"` and `\"5.0\"` clash).",
        "`BAD_REQUEST` — \"<unit> is not a unit of this item\" when `unit` is neither the base unit nor one of the item's alternate units; \"Variant not found on this item\" for a foreign variant.",
        "`NOT_FOUND` — \"Price level not found\" / \"Item not found\" (deleted items count as not found).",
        "The base unit is stored as `unit: null` so an item's base unit can be renamed without orphaning prices.",
        "A revision is keyed by its exact `effectiveFrom`; calling with a different date creates a new revision and leaves the old one in place.",
        "Include a `minQuantity: \"0\"` slab if smaller quantities should also get a level price — without it, quantities below the lowest slab fall through to the next match (the all-variant entries, then the item's own price).",
        "Not written to the audit log.",
      ],
      relatedEndpoints: ["price-level-item-entries", "pricing-resolve", "price-level-set-grid-prices"],
    },
    {
      id: "price-level-grid",
      method: "query",
      path: "priceLevel.grid",
      title: "Price Grid",
      description: "Data for the Price Levels page grid: all levels, plus one row per product item and one per variant, with each row's **plain price** (base unit, no slab, no effective date) on every level. `slabCount[levelId]` counts that row's other entries on the level (slabs, alternate units, dated revisions) which the grid doesn't show.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string", required: false, description: "Case-insensitive match on item name (max 100 chars)." },
        { name: "category", type: "string", required: false, description: "Exact item category filter (max 100 chars)." },
      ],
      output: {
        description: "`levels` are full price level rows; `rows` are keyed per item/variant with `prices` and `slabCount` maps keyed by level ID. Variant rows are named `<item> (<attr values joined by \" / \">)` and inherit the item's sale price/MRP when they have none.",
        example: {
          levels: [
            { id: "level-uuid-retail", businessId: "business-uuid", name: "Retail", description: null, isDefault: true, sortOrder: 0, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z" },
            { id: "level-uuid-wholesale", businessId: "business-uuid", name: "Wholesale", description: null, isDefault: false, sortOrder: 1, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z" },
          ],
          rows: [
            {
              itemId: "item-uuid-atta",
              variantId: null,
              name: "Aashirvaad Atta 5kg",
              unit: "pcs",
              category: "Grocery",
              salePrice: "285.00",
              mrp: "310.00",
              prices: { "level-uuid-retail": "285.00", "level-uuid-wholesale": "262.00" },
              slabCount: { "level-uuid-retail": 0, "level-uuid-wholesale": 2 },
            },
            {
              itemId: "item-uuid-tshirt",
              variantId: "variant-uuid-m-blue",
              name: "Cotton T-Shirt (M / Blue)",
              unit: "pcs",
              category: "Apparel",
              salePrice: "599.00",
              mrp: "799.00",
              prices: { "level-uuid-retail": null, "level-uuid-wholesale": "420.00" },
              slabCount: { "level-uuid-retail": 0, "level-uuid-wholesale": 0 },
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/priceLevel.grid?input=%7B%22json%22%3A%7B%22category%22%3A%22Grocery%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { levels, rows } = await trpc.priceLevel.grid.query({ search: "atta" });

for (const row of rows) {
  for (const level of levels) {
    console.log(row.name, level.name, row.prices[level.id] ?? "(item price)");
  }
}`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Only `product` items are included (services are excluded), capped at the first 1000 items by name — narrow with `search` / `category` for large catalogues.",
        "A `null` price means the row has no plain price on that level; it may still be priced by slabs/dated entries counted in `slabCount`, or falls back to the item's own sale price.",
        "The whole input object is optional.",
      ],
      relatedEndpoints: ["price-level-set-grid-prices", "price-level-bulk-update", "price-level-price-list"],
    },
    {
      id: "price-level-set-grid-prices",
      method: "mutation",
      path: "priceLevel.setGridPrices",
      title: "Save Grid Prices",
      description: "Save edited grid cells in one transaction. Each cell sets the **plain price** (base unit, `minQuantity` 0, no effective date) of an item or variant on a level, creating or updating that entry; a `null` price deletes it. Other entries (slabs, alternate units, dated revisions) are untouched.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "cells", type: "array", required: true, description: "1–2000 cells to save." },
        { name: "cells[].priceLevelId", type: "string (UUID)", required: true, description: "Price level ID." },
        { name: "cells[].itemId", type: "string (UUID)", required: true, description: "Item ID." },
        { name: "cells[].variantId", type: "string (UUID) | null", required: false, description: "Variant ID, or omit / `null` for the item-level (all variants) price." },
        { name: "cells[].price", type: "string (decimal) | null", required: true, description: "New plain price (up to 13 digits, 2 decimals), or `null` to clear it." },
      ],
      output: {
        description: "Number of cells processed.",
        example: { updated: 3 },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/priceLevel.setGridPrices" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"cells":[{"priceLevelId":"level-uuid-wholesale","itemId":"item-uuid-atta","price":"262.00"},{"priceLevelId":"level-uuid-wholesale","itemId":"item-uuid-tshirt","variantId":"variant-uuid-m-blue","price":"420.00"},{"priceLevelId":"level-uuid-retail","itemId":"item-uuid-atta","price":null}]}}'`,
        javascript: `await trpc.priceLevel.setGridPrices.mutate({
  cells: [
    { priceLevelId: "level-uuid-wholesale", itemId: "item-uuid-atta", price: "262.00" },
    { priceLevelId: "level-uuid-wholesale", itemId: "item-uuid-tshirt", variantId: "variant-uuid-m-blue", price: "420.00" },
    { priceLevelId: "level-uuid-retail", itemId: "item-uuid-atta", price: null }, // clear
  ],
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`NOT_FOUND` — \"Price level or item not found\" if any referenced level or item isn't in the active business; nothing is saved in that case.",
        "`price` is required on every cell — send `null` explicitly to clear; there is no \"leave unchanged\" value.",
        "`updated` is the number of cells sent, not the number of rows that actually changed.",
        "Unlike `setItemPrices`, the variant is not checked against the item, and deleted items are not rejected — send only IDs taken from `priceLevel.grid`.",
        "Not written to the audit log.",
      ],
      relatedEndpoints: ["price-level-grid", "price-level-set-item-prices"],
    },
    {
      id: "price-level-bulk-update",
      method: "mutation",
      path: "priceLevel.bulkUpdate",
      title: "Bulk Adjust Level Prices",
      description: "Raise or lower a level's prices by a percentage, optionally limited to one item category. With basis `current`, every existing entry on the level that has a `price` is adjusted (plain prices, slabs, alternate units and dated revisions alike; discount-only entries are skipped). With basis `salePrice`, each item's and each variant's plain price on the level is set to its own sale price adjusted by the percentage, creating entries as needed (items/variants without a sale price are skipped). New price = old + old × percent / 100, floored at 0, and rounded to the nearest whole rupee with `round: \"rupee\"`. Writes a `priceLevel.bulkUpdate` audit log entry with the basis, percent and count.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "priceLevelId", type: "string (UUID)", required: true, description: "Price level to adjust." },
        { name: "basis", type: "enum", required: true, description: "What to adjust from.", enumValues: ["current", "salePrice"] },
        { name: "percent", type: "number", required: true, description: "Percentage change, -100 to 1000 (e.g. `-10` = 10% lower, `5` = 5% higher)." },
        { name: "round", type: "enum", required: false, description: "Rounding of the new price.", default: "none", enumValues: ["none", "rupee"] },
        { name: "category", type: "string", required: false, description: "Only items in this exact category (max 100 chars)." },
      ],
      output: {
        description: "Number of entries updated (basis `current`) or plain prices set (basis `salePrice`).",
        example: { updated: 148 },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/priceLevel.bulkUpdate" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"priceLevelId":"level-uuid-wholesale","basis":"salePrice","percent":-8,"round":"rupee","category":"Grocery"}}'`,
        javascript: `// Wholesale = sale price less 8%, rounded to whole rupees, for groceries
const { updated } = await trpc.priceLevel.bulkUpdate.mutate({
  priceLevelId: "level-uuid-wholesale",
  basis: "salePrice",
  percent: -8,
  round: "rupee",
  category: "Grocery",
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`NOT_FOUND` — \"Price level not found\".",
        "Basis `salePrice` overwrites existing plain prices on the level for every matched item — manual prices are lost. It does not touch slabs or dated revisions.",
        "Basis `salePrice` covers services as well as products (unlike `priceLevel.grid`, which lists only products), and sets both an item-level price and a price per variant for variant items.",
        "Basis `current` also re-prices future-dated and superseded revisions, not just the prices in force today.",
        "Runs row by row in one transaction — large catalogues can take a few seconds.",
      ],
      relatedEndpoints: ["price-level-grid", "price-level-price-list"],
    },
    {
      id: "price-level-price-list",
      method: "query",
      path: "priceLevel.priceList",
      title: "Price List Report",
      description: "Price List report: every item and variant of the business with its own sale price, MRP and its price on each level **as of a date**, resolved exactly like a sale line of quantity 1 in the base unit (see `pricing.resolve`). A level price is the net price after the level's discount.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "date", type: "string (YYYY-MM-DD)", required: false, description: "As-of date for dated revisions.", default: "today (UTC)" },
        { name: "category", type: "string", required: false, description: "Exact item category filter (max 100 chars)." },
      ],
      output: {
        description: "`levels` (id, name, isDefault) and one row per item/variant. `prices[levelId]` is the level's net price, or `null` when the level has no applicable entry (the item's own `salePrice` would be used).",
        example: {
          date: "2026-09-30",
          levels: [
            { id: "level-uuid-retail", name: "Retail", isDefault: true },
            { id: "level-uuid-wholesale", name: "Wholesale", isDefault: false },
          ],
          rows: [
            {
              itemId: "item-uuid-atta",
              variantId: null,
              name: "Aashirvaad Atta 5kg",
              hsn: "11010000",
              category: "Grocery",
              unit: "pcs",
              salePrice: "285.00",
              mrp: "310.00",
              prices: { "level-uuid-retail": "285.00", "level-uuid-wholesale": "262.00" },
            },
            {
              itemId: "item-uuid-tshirt",
              variantId: "variant-uuid-m-blue",
              name: "Cotton T-Shirt (M / Blue)",
              hsn: "61091000",
              category: "Apparel",
              unit: "pcs",
              salePrice: "599.00",
              mrp: "799.00",
              prices: { "level-uuid-retail": null, "level-uuid-wholesale": "420.00" },
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/priceLevel.priceList?input=%7B%22json%22%3A%7B%22date%22%3A%222026-10-01%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const report = await trpc.priceLevel.priceList.query({ date: "2026-10-01", category: "Grocery" });
console.log(\`Price list as of \${report.date}: \${report.rows.length} rows\`);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Prices are for quantity 1 in the base unit: a level whose only entries are slabs starting above 1, or alternate-unit prices, shows `null` here.",
        "Includes services as well as products, and is not paginated or capped (unlike `priceLevel.grid`).",
        "The level price shown is the **net** price (after any level discount), whereas `salePrice` is the item's own price.",
        "The whole input object is optional; `date` defaults to today's UTC date.",
      ],
      relatedEndpoints: ["pricing-resolve", "price-level-grid"],
    },
  ],
};
