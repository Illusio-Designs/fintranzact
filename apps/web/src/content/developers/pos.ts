import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const posEndpoints: EndpointGroup = {
  id: "pos",
  title: "Point of Sale",
  description: "Catalogue for the point-of-sale register. The register rings up sales through `invoice.create` with `source: \"pos\"` (usually against the walk-in party from `business.ensureWalkInParty`); the POS router only serves the product grid. POS is switched on per business with `business.setPosEnabled`.",
  endpoints: [
    {
      id: "pos-catalog",
      method: "query",
      path: "pos.catalog",
      title: "POS Catalogue",
      description: "Flat list of sellable tiles for the register grid — one tile per billable SKU, so the client doesn't have to handle three item layouts. A simple item gives one tile (its sale price, stock and unit). An `alt_units` item gives one tile per configured alternate unit, each with its own price and the stock converted into that unit (with no units configured it still gets one base-unit tile). A `variants` item gives one tile per non-deleted variant with the variant's SKU, price and stock, and a display name that joins the attribute values (\"T-Shirt — Red / L\"). Only non-deleted products are included (services are left out), most recently updated first. Pagination applies to items, so a page can hold more tiles than `limit`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string | null", required: false, description: "Case-insensitive match on item name, barcode or SKU" },
        { name: "page", type: "number", required: false, description: "Page of items (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (max 200)", default: "60" },
      ],
      output: {
        description: "Tiles plus the paging echo. `tileKey` is stable (`i:<itemId>`, `u:<itemId>:<unit>`, `v:<variantId>`); `conversionFactor` is what the server multiplies by to decrement base-unit stock. Prices, stock and tax are strings.",
        example: {
          tiles: [
            {
              tileKey: "u:item-uuid:kg",
              itemId: "item-uuid",
              variantId: null,
              displayName: "Toor Dal (kg)",
              unit: "kg",
              unitPrice: "140.00",
              stockQuantity: "62.500",
              taxPercent: "5.00",
              conversionFactor: "1",
              itemMode: "alt_units",
              sku: "TD-001",
            },
            {
              tileKey: "v:variant-uuid",
              itemId: "item-uuid-2",
              variantId: "variant-uuid",
              displayName: "Cotton T-Shirt — Red / L",
              unit: "pcs",
              unitPrice: "499.00",
              stockQuantity: "18",
              taxPercent: "5.00",
              conversionFactor: "1",
              itemMode: "variants",
              sku: "TS-RED-L",
            },
          ],
          page: 1,
          limit: 60,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/pos.catalog?input=%7B%22json%22%3A%7B%22search%22%3A%22dal%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { tiles } = await trpc.pos.catalog.query({ search: scannedCode, limit: 60 });

// Add a tile to the cart, then bill it
await trpc.invoice.create.mutate({
  partyId: walkInPartyId,
  type: "sale",
  source: "pos",
  lineItems: [{
    itemId: tiles[0].itemId,
    variantId: tiles[0].variantId,
    itemName: tiles[0].displayName,
    quantity: "1",
    unitPrice: tiles[0].unitPrice,
    taxPercent: tiles[0].taxPercent,
    selectedUnit: tiles[0].unit,
    conversionFactor: tiles[0].conversionFactor,
  }],
});`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Stock is the item's (or variant's) overall stock, not a single warehouse's balance — use `stock.availability` for per-warehouse figures.",
        "Tile prices are the item's own sale prices; price levels are not applied here (use `pricing.resolve`).",
      ],
      relatedEndpoints: ["invoice-create", "business-set-pos-enabled", "business-ensure-walk-in-party", "pricing-resolve"],
    },
  ],
};
