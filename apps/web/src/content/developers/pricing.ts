import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const pricingEndpoints: EndpointGroup = {
  id: "pricing",
  title: "Pricing",
  description: "Resolves the selling price of sale lines from price levels (see Price Levels). Entry forms call `pricing.resolve` whenever the party, date, item, variant, unit or quantity of a sale line changes; purchases never use levels. Step 1, the level (once per request): the `priceLevelId` given, else the party's own level, else the business's default level; with no level every line gets the item's own price. Step 2, candidate entries on that level (per line, first that yields an entry wins): entries for the line's variant in the line's unit; then whole-item entries (`variantId` null) in the line's unit; then, for an alternate unit only, base-unit entries of the variant and then of the whole item, scaled by the unit's conversion factor (quantity converted to base units for slab matching, rate multiplied by the factor). Step 3, within the candidates: drop entries dated after the line date, keep only the latest revision (latest `effectiveFrom`; undated counts as oldest), and take the slab with the highest `minQuantity` the quantity reaches. Step 4, nothing matched: the item's own sale price (the variant's sale price, else the item's; for an alternate unit its own sale price, else base sale price × conversion factor). An entry with a `price` sets `unitPrice`; an entry with only a `discountPercent` keeps the item's own price and returns the discount for the line's discount field, as Tally does. `netPrice` is `unitPrice` less that discount.",
  endpoints: [
    {
      id: "pricing-resolve",
      method: "query",
      path: "pricing.resolve",
      title: "Resolve Sale Line Prices",
      description: "Resolve unit prices for up to 500 sale lines at once, following the precedence described above: explicit level → party's level → default level; best quantity slab of the latest revision on the date; else the item's own sale price. Returns the level used and one resolved price per input line, in the same order.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID) | null", required: false, description: "Customer whose price level applies. Ignored when `priceLevelId` is given. An unknown party, or one without a level, falls back to the default level." },
        { name: "priceLevelId", type: "string (UUID) | null", required: false, description: "Force a specific level (overrides the party's and the default level)." },
        { name: "date", type: "string | null", required: false, description: "Document date. Anything starting with `YYYY-MM-DD` (a date or ISO timestamp) is accepted; its first 10 characters are used. Max 40 chars.", default: "today (UTC)" },
        { name: "lines", type: "array", required: true, description: "Up to 500 lines to price." },
        { name: "lines[].itemId", type: "string (UUID)", required: true, description: "Item ID." },
        { name: "lines[].variantId", type: "string (UUID) | null", required: false, description: "Variant of the item. Ignored (treated as none) if it belongs to a different item." },
        { name: "lines[].unit", type: "string | null", required: false, description: "Unit the line is sold in (max 50 chars). Omit or pass the base unit for base-unit pricing; an alternate unit from the item's `unitVariants` switches to alternate-unit pricing." },
        { name: "lines[].quantity", type: "string | number | null", required: false, description: "Line quantity in the line's unit, used to pick the slab (string max 30 chars). Missing or unparseable = 1.", default: "1" },
      ],
      output: {
        description: "`priceLevel` is the level used (or `null`). Each line: `unitPrice` (in the line's unit, `null` when the item has no price at all), `discountPercent` (from the level entry, only when > 0), `netPrice` (after discount), `source` (`\"level\"` when an entry matched, else `\"item\"`), `minQuantity` of the matched slab, and `mrp` (scaled for alternate units).",
        example: {
          priceLevel: { id: "level-uuid-wholesale", name: "Wholesale" },
          lines: [
            {
              itemId: "item-uuid-atta",
              variantId: null,
              unit: null,
              unitPrice: "255.00",
              discountPercent: "2.00",
              netPrice: "249.90",
              source: "level",
              minQuantity: "20.000",
              mrp: "310.00",
            },
            {
              itemId: "item-uuid-atta",
              variantId: null,
              unit: "box",
              unitPrice: "2550.00",
              discountPercent: "2.00",
              netPrice: "2499.00",
              source: "level",
              minQuantity: "20.000",
              mrp: "3100.00",
            },
            {
              itemId: "item-uuid-tshirt",
              variantId: "variant-uuid-xl-black",
              unit: null,
              unitPrice: "599.00",
              discountPercent: null,
              netPrice: "599.00",
              source: "item",
              minQuantity: null,
              mrp: "799.00",
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/pricing.resolve?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%2C%22date%22%3A%222026-09-30%22%2C%22lines%22%3A%5B%7B%22itemId%22%3A%22item-uuid-atta%22%2C%22quantity%22%3A%2225%22%7D%5D%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { priceLevel, lines } = await trpc.pricing.resolve.query({
  partyId: "party-uuid",
  date: "2026-09-30",
  lines: [
    { itemId: "item-uuid-atta", quantity: "25" },
    { itemId: "item-uuid-atta", unit: "box", quantity: 2 },       // 1 box = 10 pcs
    { itemId: "item-uuid-tshirt", variantId: "variant-uuid-xl-black", quantity: 3 },
  ],
});

lines.forEach((l, i) => {
  // Fill the invoice line: rate + discount field
  form.lines[i].price = l.unitPrice;
  form.lines[i].discountPercent = l.discountPercent ?? "0";
});
console.log("Priced at level:", priceLevel?.name ?? "item prices");`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "`NOT_FOUND` — \"Price level not found\" only for an explicit `priceLevelId` outside the business. An unknown `partyId` is silently ignored (default level is used).",
        "`priceLevelId: null` means \"not given\", not \"no level\": it still falls back to the party's / default level. There is no way to request item prices when a default level exists.",
        "Only the **latest** revision on or before the date is considered. If that revision's slabs all start above the line quantity, older revisions are *not* consulted — resolution moves on to the next candidate (whole-item entries, scaled base-unit entries) and then the item's own price.",
        "Slabs are matched in the entry's unit: for scaled base-unit entries on an alternate-unit line, the quantity is multiplied by the conversion factor before comparing to `minQuantity`.",
        "An entry with only a discount returns the item's own price in `unitPrice` and the discount in `discountPercent` — apply the discount on the line rather than overwriting the rate with `netPrice`, or it will be counted twice.",
        "Unknown items return a line with every price field `null` and `source: \"item\"` rather than an error.",
        "A `unit` that is neither the base unit nor an alternate unit is priced as the base unit, but the given `unit` is echoed back in the output.",
        "An unparseable `date` silently falls back to today's UTC date.",
        "Results are returned in input order; duplicate items in `lines` are resolved independently.",
      ],
      relatedEndpoints: ["price-level-set-item-prices", "price-level-item-entries", "price-level-price-list", "party-update"],
    },
  ],
};
