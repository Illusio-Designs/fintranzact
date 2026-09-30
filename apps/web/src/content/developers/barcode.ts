import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const barcodeEndpoints: EndpointGroup = {
  id: "barcodes",
  title: "Barcodes",
  description: "Barcode setup for the business (Settings → Barcodes), extra item codes, code generation, on-screen symbol previews and label PDFs. A business switches barcodes on (`enabled`), picks one symbology (`type`: `ean13`, `code128` or `qr`) and one mode (`mode`: `single` = one barcode per item, `multi` = an item may also carry extra codes), and then locks the type and mode for good with `barcode.lock`. Every code the system creates and every label it prints follows that choice, and each type has a fixed label size: EAN-13 50 × 25 mm, Code 128 75 × 25 mm, QR 38 × 25 mm two across a 78 mm roll. The primary code of an item or variant is its own `barcode` field (set via `item.create` / `item.update` / variant endpoints) and is the one printed on labels. In `multi` mode, extra codes (supplier codes, old codes, box/carton codes with a `packQty`) also scan to the item; they are ignored by scanning in `single` mode. A code is unique across item barcodes, variant barcodes and extra codes within a business. Generated codes: for EAN-13, a GS1 in-store code (prefix 2, an 11-digit sequence from the business's barcode counter, and a GTIN check digit, e.g. `2000000001234`) that can never collide with a manufacturer's GTIN; for Code 128 and QR, the item's SKU when it is at most 14 printable characters and not already in use, otherwise `FT` + a 6-digit sequence (e.g. `FT000123`). With `autoGenerate` on, a purchase invoice that adds stock gives every item/variant without a barcode a generated one. Scanning (`item.lookupByCode`, stock scans) matches item/variant barcodes first, then extra codes (multi mode only), then SKU.",
  endpoints: [
    {
      id: "barcode-setup",
      method: "query",
      path: "barcode.setup",
      title: "Get Barcode Setup",
      description: "The business's barcode setup plus the fixed label size (mm) and labels-across for its barcode type.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Barcode setup. `lockedAt` / `lockedBy` are null until `barcode.lock` is called; `lockedBy` is the locking user's name (or email). `label` is the fixed label for `type`.",
        example: {
          enabled: true,
          type: "ean13",
          mode: "multi",
          autoGenerate: true,
          lockedAt: "2026-08-14T05:32:10.000Z",
          lockedBy: "Priya Sharma",
          label: { width: 50, height: 25, across: 1 },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/barcode.setup" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const setup = await trpc.barcode.setup.query();
if (!setup.enabled) console.log("Barcodes are off for this business");`,
      },
      gotchas: [
        "Requires `Business:read` permission.",
        "An unrecognised stored type is reported as `ean13`, and any mode other than `multi` as `single`.",
      ],
      relatedEndpoints: ["barcode-update", "barcode-lock"],
    },
    {
      id: "barcode-update",
      method: "mutation",
      path: "barcode.update",
      title: "Update Barcode Setup",
      description: "Change the barcode setup. `enabled` and `autoGenerate` can change at any time; `type` and `mode` only until the setup is locked. Only the fields you send are changed. Writes a `barcode.updateSetup` audit log entry.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "enabled", type: "boolean", required: false, description: "Switch barcodes on or off for the business." },
        { name: "autoGenerate", type: "boolean", required: false, description: "Give items/variants without a barcode a generated one when stock arrives on a purchase invoice." },
        { name: "type", type: "enum", required: false, description: "Symbology for generated codes and labels.", enumValues: ["ean13", "code128", "qr"] },
        { name: "mode", type: "enum", required: false, description: "`single` = one barcode per item; `multi` = items may carry extra codes.", enumValues: ["single", "multi"] },
      ],
      output: {
        description: "The updated setup, same shape as `barcode.setup`.",
        example: {
          enabled: true,
          type: "code128",
          mode: "single",
          autoGenerate: true,
          lockedAt: null,
          lockedBy: null,
          label: { width: 75, height: 25, across: 1 },
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/barcode.update" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"enabled":true,"autoGenerate":true,"type":"code128"}}'`,
        javascript: `const setup = await trpc.barcode.update.mutate({
  enabled: true,
  autoGenerate: true,
  type: "code128",
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission (admins only by default).",
        "`FORBIDDEN` — \"Barcode type and barcodes-per-item are locked for this business\" when the setup is locked and `type` or `mode` would change. Sending the current locked values is allowed.",
        "Changing `type` before locking doesn't rewrite existing codes; only codes generated afterwards use the new type.",
      ],
      relatedEndpoints: ["barcode-setup", "barcode-lock"],
    },
    {
      id: "barcode-lock",
      method: "mutation",
      path: "barcode.lock",
      title: "Lock Barcode Setup",
      description: "Fix the barcode type and barcodes-per-item mode for good. Sets `type` and `mode`, switches barcodes on, and records who locked it and when. Writes a `barcode.lockSetup` audit log entry.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "type", type: "enum", required: true, description: "Symbology to lock in.", enumValues: ["ean13", "code128", "qr"] },
        { name: "mode", type: "enum", required: true, description: "Barcodes-per-item mode to lock in.", enumValues: ["single", "multi"] },
      ],
      output: {
        description: "The locked setup, same shape as `barcode.setup`.",
        example: {
          enabled: true,
          type: "ean13",
          mode: "multi",
          autoGenerate: false,
          lockedAt: "2026-09-30T07:05:41.000Z",
          lockedBy: "Priya Sharma",
          label: { width: 50, height: 25, across: 1 },
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/barcode.lock" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"type":"ean13","mode":"multi"}}'`,
        javascript: `await trpc.barcode.lock.mutate({ type: "ean13", mode: "multi" });`,
      },
      gotchas: [
        "Requires `Business:manage` permission (admins only by default).",
        "`CONFLICT` — \"Barcode setup is already locked\" on a second call; a locked setup is never changed silently.",
        "There is no unlock endpoint: afterwards only `enabled` and `autoGenerate` can be changed.",
        "Locking always sets `enabled: true`, even if barcodes were switched off.",
      ],
      relatedEndpoints: ["barcode-setup", "barcode-update"],
    },
    {
      id: "barcode-item-codes",
      method: "query",
      path: "barcode.itemCodes",
      title: "List Extra Item Codes",
      description: "The extra codes on one item (all its variants included), oldest first. The item's and variants' primary `barcode` fields are not included.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Item ID." },
      ],
      output: {
        description: "Extra codes. `variantId` null = the code scans to the item itself. `packQty` is the number of pieces one scan stands for. `source` is `supplier`, `manual`, `old` or `generated`.",
        example: [
          { id: "code-uuid-1", variantId: null, code: "8901063142206", packQty: "1.000", label: null, source: "supplier" },
          { id: "code-uuid-2", variantId: null, code: "2000000004563", packQty: "12.000", label: "Box of 12", source: "generated" },
          { id: "code-uuid-3", variantId: "variant-uuid-m-blue", code: "TS-M-BLU-OLD", packQty: "1.000", label: null, source: "old" },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/barcode.itemCodes?input=%7B%22json%22%3A%7B%22itemId%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const codes = await trpc.barcode.itemCodes.query({ itemId: "item-uuid" });
const cartons = codes.filter((c) => parseFloat(c.packQty) > 1);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "The item is not validated: an unknown item returns an empty array.",
        "Codes are returned even when the business is in `single` mode, although scanning ignores them in that mode.",
      ],
      relatedEndpoints: ["barcode-add-item-code", "barcode-remove-item-code"],
    },
    {
      id: "barcode-add-item-code",
      method: "mutation",
      path: "barcode.addItemCode",
      title: "Add Extra Item Code",
      description: "Add an extra code to an item or one of its variants: type one in `code`, or set `generate: true` to create one in the business's barcode type. Only available when barcodes are on and the business uses `multi` mode. A box or carton code can stand for several pieces via `packQty`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Item ID (must not be deleted)." },
        { name: "variantId", type: "string (UUID) | null", required: false, description: "Variant of the item the code scans to; omit for the item itself." },
        { name: "code", type: "string", required: false, description: "The code, trimmed, 1–64 printable ASCII characters. Required unless `generate` is true; wins over `generate` when both are sent." },
        { name: "generate", type: "boolean", required: false, description: "Create a new code in the business's barcode type instead of typing one." },
        { name: "packQty", type: "string (decimal)", required: false, description: "Pieces one scan stands for; up to 9 digits and 3 decimals, must be > 0.", default: "\"1\"" },
        { name: "label", type: "string", required: false, description: "Short label, e.g. \"Box of 12\" (max 60 chars)." },
        { name: "source", type: "enum", required: false, description: "Where a typed code came from. Generated codes are always stored as `generated`.", default: "manual", enumValues: ["supplier", "manual", "old"] },
      ],
      output: {
        description: "The created extra code row.",
        example: {
          id: "code-uuid-2",
          businessId: "business-uuid",
          itemId: "item-uuid",
          variantId: null,
          code: "2000000004563",
          packQty: "12.000",
          label: "Box of 12",
          source: "generated",
          createdAt: "2026-09-30T09:48:12.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/barcode.addItemCode" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"itemId":"item-uuid","code":"8901063142206","source":"supplier"}}'`,
        javascript: `// Supplier's printed code
await trpc.barcode.addItemCode.mutate({
  itemId: "item-uuid",
  code: "8901063142206",
  source: "supplier",
});

// Generated carton code: one scan = 12 pieces
await trpc.barcode.addItemCode.mutate({
  itemId: "item-uuid",
  generate: true,
  packQty: "12",
  label: "Box of 12",
});`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`PRECONDITION_FAILED` — \"Barcodes are switched off for this business…\" or \"This business uses one barcode per item\" (mode is `single`).",
        "`BAD_REQUEST` — \"Pack quantity must be more than 0\" or \"Enter a barcode\" (neither `code` nor `generate`).",
        "`NOT_FOUND` — \"Item not found\" / \"Variant not found\".",
        "`CONFLICT` — \"Barcode <code> is already used by <item name>\" when the code is any item's or variant's barcode or another extra code in the business, including this same item's own primary barcode.",
        "Generated Code 128 / QR codes here never reuse the SKU (they are always `FT` + sequence); EAN-13 codes use the in-store `2…` range. Each generation advances the business's barcode counter.",
        "Not written to the audit log.",
      ],
      relatedEndpoints: ["barcode-item-codes", "barcode-remove-item-code", "barcode-generate"],
    },
    {
      id: "barcode-remove-item-code",
      method: "mutation",
      path: "barcode.removeItemCode",
      title: "Remove Extra Item Code",
      description: "Delete one extra code by its ID. The item's and variants' primary barcodes are edited through the item endpoints instead.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Extra code ID (from `barcode.itemCodes`)." },
      ],
      output: {
        description: "The ID of the deleted code.",
        example: { id: "code-uuid-3" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/barcode.removeItemCode" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"id":"code-uuid-3"}}'`,
        javascript: `await trpc.barcode.removeItemCode.mutate({ id: "code-uuid-3" });`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`NOT_FOUND` — \"Barcode not found\" when the ID isn't an extra code of the active business.",
        "Works even when barcodes are switched off or the business is in `single` mode, so stale codes can always be cleaned up.",
        "Not written to the audit log.",
      ],
      relatedEndpoints: ["barcode-item-codes", "barcode-add-item-code"],
    },
    {
      id: "barcode-generate",
      method: "mutation",
      path: "barcode.generate",
      title: "Generate Barcode",
      description: "Create a new, currently unused code in the business's barcode type — the item form's \"Create code\" button. The code is only returned, not saved: store it on the item or variant via `item.create` / `item.update`. EAN-13 businesses get an in-store GS1 code (`2` + 11-digit sequence + check digit). Code 128 / QR businesses get the `sku` when it is at most 14 printable characters and not already used as a code, otherwise `FT` + a 6-digit sequence.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "sku", type: "string | null", required: false, description: "The item's SKU (max 50 chars), reused as the code for Code 128 / QR when short enough and free. Ignored for EAN-13." },
      ],
      output: {
        description: "The generated code.",
        example: { code: "2000000001234" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/barcode.generate" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"sku":"ATTA-5KG"}}'`,
        javascript: `const { code } = await trpc.barcode.generate.mutate({ sku: "ATTA-5KG" });
await trpc.item.update.mutate({ id: "item-uuid", data: { barcode: code } });`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`PRECONDITION_FAILED` — \"Barcodes are switched off for this business. Turn them on in Settings → Barcodes.\"",
        "`INTERNAL_SERVER_ERROR` — \"Could not create a free barcode\" if five consecutive candidates are already taken.",
        "The code is not reserved: generating advances the business's barcode counter (so sequence numbers can be skipped if the code is never saved), and a SKU-based code can be returned again until it is actually saved on an item.",
        "The input object is required even when empty: send `{}`.",
      ],
      relatedEndpoints: ["barcode-add-item-code", "barcode-symbol", "item-update"],
    },
    {
      id: "barcode-symbol",
      method: "query",
      path: "barcode.symbol",
      title: "Barcode Symbol Preview",
      description: "Bars or QR modules for an on-screen preview, drawn by the same encoders the printed labels use. `type` defaults to the business's barcode type. For EAN-13, a valid 13-digit EAN is drawn as EAN-13 bars; any other code is drawn as Code 128, as the label does. Linear codes are returned as a string of module bits (`1` = bar) including quiet zones (EAN-13: 11 modules left, 7 right; Code 128 subset B: 10 each side). QR codes use error-correction level M and are returned as rows of module bits.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "code", type: "string", required: true, description: "Code to draw: trimmed, 1–64 printable ASCII characters." },
        { name: "type", type: "enum", required: false, description: "Symbology to draw with.", default: "business's barcode type", enumValues: ["ean13", "code128", "qr"] },
      ],
      output: {
        description: "Either `{ kind: \"bars\", type: \"ean13\" | \"code128\", modules, text }` or `{ kind: \"matrix\", type: \"qr\", rows, text }`. For EAN-13, `text` is grouped as printed under retail bars.",
        example: {
          kind: "bars",
          type: "ean13",
          modules: "00000000000101000110100011010100111010011100011010100111010101110010111001011001101101100100001010111001010000000",
          text: "2 000000 001234",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/barcode.symbol?input=%7B%22json%22%3A%7B%22code%22%3A%222000000001234%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const sym = await trpc.barcode.symbol.query({ code: "2000000001234" });

if (sym.kind === "bars") {
  // Draw one 2px-wide rect per "1"
  [...sym.modules].forEach((bit, x) => { if (bit === "1") ctx.fillRect(x * 2, 0, 2, 60); });
} else {
  sym.rows.forEach((row, y) =>
    [...row].forEach((bit, x) => { if (bit === "1") ctx.fillRect(x * 4, y * 4, 4, 4); }));
}`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "The returned `type` can differ from the requested one: an invalid EAN-13 (wrong length or check digit) comes back as `code128`.",
        "`BAD_REQUEST` with the encoder's message when the code cannot be drawn.",
        "Codes may not start or end with a space; the input is trimmed before validation.",
      ],
      relatedEndpoints: ["barcode-generate", "barcode-print-labels"],
    },
    {
      id: "barcode-print-labels",
      method: "mutation",
      path: "POST /api/items/labels",
      title: "Print Barcode Labels (PDF)",
      description: `Raw HTTP endpoint (not tRPC) that returns a barcode label sheet as a PDF: POST ${API_BASE_URL}/api/items/labels with a JSON body. The client sends only item/variant IDs and copy counts; names, primary barcodes and sale prices are read server-side, so a tampered request can't print arbitrary text. Each label shows the item's (or variant's) primary barcode drawn in the business's symbology (EAN-13 falls back to Code 128 for non-EAN codes), the name and variant attributes, and the sale price as ₹<price>. Lines that can't be printed (no barcode, or not encodable) are skipped rather than failing the sheet and reported in the X-Labels-Skipped header; X-Labels-Printed holds the number of labels printed. Authenticate with a session (the session_id cookie or Authorization: Bearer <session token>) plus the x-business-id header. Presets: a4_21 (A4, 21 labels 63.5 × 38.1 mm), a4_65 (A4, 65 labels 38.1 × 21.2 mm), type_ean13 (50 × 25 mm), type_code128 (75 × 25 mm), type_qr (38 × 25 mm, 2 across a 78 mm roll), roll_50x25 (thermal roll 50 × 25 mm). Omitting presetId uses the fixed label for the business's barcode type.`,
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "presetId", type: "enum", required: false, description: "Label layout. Omit for the fixed label of the business's barcode type.", enumValues: ["a4_21", "a4_65", "type_ean13", "type_code128", "type_qr", "roll_50x25"] },
        { name: "showPrice", type: "boolean", required: false, description: "Print the sale price.", default: "true" },
        { name: "showName", type: "boolean", required: false, description: "Print the item name.", default: "true" },
        { name: "lines", type: "array", required: true, description: "1–500 lines." },
        { name: "lines[].itemId", type: "string (UUID)", required: true, description: "Item ID." },
        { name: "lines[].variantId", type: "string (UUID)", required: false, description: "Variant to print (its barcode and price). Omit rather than sending null." },
        { name: "lines[].quantity", type: "integer", required: true, description: "Number of copies, 1–500." },
      ],
      output: {
        description: "200 with Content-Type application/pdf (inline; filename=\"labels.pdf\", Cache-Control: no-store). X-Labels-Printed is the label count; X-Labels-Skipped is a URI-encoded JSON array of { name, reason }. Errors are JSON { error } with status 400 (invalid body, with a detail field; no organization or business selected), 401 (no or expired session), 403 (organization suspended, business not found, or barcodes switched off) or 429 (PDF rate limit).",
        example: {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "X-Labels-Printed": "36",
            "X-Labels-Skipped": "%5B%7B%22name%22%3A%22Loose%20Jaggery%22%2C%22reason%22%3A%22no%20barcode%20set%22%7D%5D",
          },
          body: "<PDF bytes>",
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/items/labels" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"presetId":"a4_21","lines":[{"itemId":"item-uuid-atta","quantity":24},{"itemId":"item-uuid-tshirt","variantId":"variant-uuid-m-blue","quantity":12}]}' \\
  -o labels.pdf -D -`,
        javascript: `const res = await fetch("${API_BASE_URL}/api/items/labels", {
  method: "POST",
  credentials: "include", // or an Authorization: Bearer <session token> header
  headers: { "Content-Type": "application/json", "x-business-id": businessId },
  body: JSON.stringify({
    lines: [
      { itemId: "item-uuid-atta", quantity: 24 },
      { itemId: "item-uuid-tshirt", variantId: "variant-uuid-m-blue", quantity: 12 },
    ],
  }),
});
if (!res.ok) throw new Error((await res.json()).error);

const printed = Number(res.headers.get("X-Labels-Printed"));
const skipped = JSON.parse(decodeURIComponent(res.headers.get("X-Labels-Skipped") ?? "%5B%5D"));
skipped.forEach((s) => console.warn(\`Skipped \${s.name}: \${s.reason}\`));
window.open(URL.createObjectURL(await res.blob()));`,
      },
      gotchas: [
        "No role/permission check beyond a valid session with access to the business: any member, including read-only roles, can print labels.",
        "Session-only: API keys (`fintranzact_key_…`) and short-lived `at_…` access tokens are not accepted as Bearer tokens here.",
        "The body is plain JSON — not wrapped in `{\"json\": …}` like tRPC calls.",
        "403 \"Barcodes are switched off for this business\" when barcodes are disabled.",
        "Unknown or deleted items, and variants that don't belong to the line's item, are dropped silently — they appear in neither the PDF nor X-Labels-Skipped. Compare X-Labels-Printed with the copies you asked for.",
        "Only the primary barcode is printed; extra codes from `barcode.addItemCode` are never used on labels. Generate a primary code first (`barcode.generate`) for items without one.",
        "The price printed is the item's/variant's own sale price, not a price-level price.",
        "Shares the PDF rate limit of 30 requests per minute per IP (429 \"Too many PDF requests. Try again later.\").",
        "A run where every line is skipped still returns a valid one-page blank PDF with X-Labels-Printed: 0.",
      ],
      relatedEndpoints: ["barcode-setup", "barcode-generate", "barcode-symbol"],
    },
  ],
};
