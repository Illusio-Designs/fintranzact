/**
 * barcode-setup.ts — the business's barcode rules, code minting and scan lookup.
 *
 * A business picks one barcode type (EAN-13, Code 128 or QR) and one mode
 * (one barcode per item, or many) and then locks them. Every code the system
 * creates, and every label it prints, follows that choice. Label sizes are
 * fixed per type so every counter prints the same label.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { businesses, itemBarcodes, items, itemVariants } from "@fintranzact/db";
import { internalBarcodeFor } from "./internal-barcode.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const BARCODE_TYPES = ["ean13", "code128", "qr"] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];
export const BARCODE_MODES = ["single", "multi"] as const;
export type BarcodeMode = (typeof BARCODE_MODES)[number];

/** Fixed label size (mm) per barcode type, and how many sit across the roll. */
export const LABEL_SIZES: Record<BarcodeType, { width: number; height: number; across: number }> = {
  ean13: { width: 50, height: 25, across: 1 },
  code128: { width: 75, height: 25, across: 1 },
  qr: { width: 38, height: 25, across: 2 },
};

/** Code 128 / QR codes we create stay short enough for a 75 mm label. */
export const MAX_TEXT_CODE_LENGTH = 14;

export interface BarcodeSetup {
  enabled: boolean;
  type: BarcodeType;
  mode: BarcodeMode;
  autoGenerate: boolean;
  lockedAt: Date | null;
  lockedBy: string | null;
}

export function asBarcodeType(value: string | null | undefined): BarcodeType {
  return (BARCODE_TYPES as readonly string[]).includes(value ?? "") ? (value as BarcodeType) : "ean13";
}

export async function getBarcodeSetup(db: Db, businessId: string): Promise<BarcodeSetup> {
  const [row] = await db
    .select({
      enabled: businesses.barcodesEnabled,
      type: businesses.barcodeType,
      mode: businesses.barcodeMode,
      autoGenerate: businesses.autoGenerateBarcodes,
      lockedAt: businesses.barcodeSetupLockedAt,
      lockedBy: businesses.barcodeSetupLockedBy,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  return {
    enabled: row.enabled,
    type: asBarcodeType(row.type),
    mode: row.mode === "multi" ? "multi" : "single",
    autoGenerate: row.autoGenerate,
    lockedAt: row.lockedAt ?? null,
    lockedBy: row.lockedBy ?? null,
  };
}

export function requireBarcodesEnabled(setup: BarcodeSetup) {
  if (!setup.enabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Barcodes are switched off for this business. Turn them on in Settings → Barcodes.",
    });
  }
}

/** Printable ASCII, the range Code 128 subset B and our QR payloads carry. */
export function isPrintableCode(code: string) {
  return /^[!-~](?:[ -~]*[!-~])?$/.test(code);
}

/**
 * True when `code` is already used by another item, variant or extra code in
 * this business. `except` names the owner the code is being (re)saved on.
 */
export async function findCodeOwner(
  db: Db,
  businessId: string,
  code: string,
): Promise<{ itemId: string; variantId: string | null; name: string } | null> {
  const [item] = await db
    .select({ itemId: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.businessId, businessId), eq(items.barcode, code), isNull(items.deletedAt)))
    .limit(1);
  if (item) return { itemId: item.itemId, variantId: null, name: item.name };

  const [variant] = await db
    .select({ itemId: items.id, variantId: itemVariants.id, name: items.name })
    .from(itemVariants)
    .innerJoin(items, eq(items.id, itemVariants.itemId))
    .where(and(
      eq(items.businessId, businessId),
      eq(itemVariants.barcode, code),
      isNull(items.deletedAt),
      isNull(itemVariants.deletedAt),
    ))
    .limit(1);
  if (variant) return { itemId: variant.itemId, variantId: variant.variantId, name: variant.name };

  const [extra] = await db
    .select({ itemId: itemBarcodes.itemId, variantId: itemBarcodes.variantId, name: items.name })
    .from(itemBarcodes)
    .innerJoin(items, eq(items.id, itemBarcodes.itemId))
    .where(and(eq(itemBarcodes.businessId, businessId), eq(itemBarcodes.code, code), isNull(items.deletedAt)))
    .limit(1);
  if (extra) return { itemId: extra.itemId, variantId: extra.variantId ?? null, name: extra.name };

  return null;
}

export async function assertCodeFree(
  db: Db,
  businessId: string,
  code: string,
  owner: { itemId?: string; variantId?: string | null },
) {
  const found = await findCodeOwner(db, businessId, code);
  if (!found) return;
  const same = owner.itemId === found.itemId && (owner.variantId ?? null) === found.variantId;
  if (same) return;
  throw new TRPCError({ code: "CONFLICT", message: `Barcode ${code} is already used by ${found.name}` });
}

/** Reserve the next number from the business's barcode counter. */
async function nextSequence(tx: Db, businessId: string) {
  const [counter] = await tx
    .update(businesses)
    .set({ nextBarcodeNumber: sql`${businesses.nextBarcodeNumber} + 1` })
    .where(eq(businesses.id, businessId))
    .returning({ next: businesses.nextBarcodeNumber });
  // RETURNING gives the post-increment value.
  return (counter?.next ?? 2) - 1;
}

/**
 * Create a new code in the business's barcode type.
 *
 * EAN-13 uses the GS1 in-store range (prefix 2). Code 128 and QR reuse the
 * item's SKU when it is short, printable and not already a barcode — so the
 * label reads the same as the catalogue — and otherwise fall back to a
 * numbered "FT000123" code.
 */
export async function mintBarcode(
  tx: Db,
  businessId: string,
  type: BarcodeType,
  sku?: string | null,
): Promise<string> {
  if (type === "ean13") {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = internalBarcodeFor(await nextSequence(tx, businessId));
      if (!(await findCodeOwner(tx, businessId, code))) return code;
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create a free barcode" });
  }

  const candidate = sku?.trim();
  if (
    candidate &&
    candidate.length <= MAX_TEXT_CODE_LENGTH &&
    isPrintableCode(candidate) &&
    !(await findCodeOwner(tx, businessId, candidate))
  ) {
    return candidate;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `FT${String(await nextSequence(tx, businessId)).padStart(6, "0")}`;
    if (!(await findCodeOwner(tx, businessId, code))) return code;
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create a free barcode" });
}

/**
 * Give an item (or variant) a code if it has none. Only fills a gap — a
 * supplier's printed barcode always wins. Returns the new code, or null.
 */
export async function ensureBarcodeForStock(
  tx: Db,
  businessId: string,
  itemId: string,
  variantId: string | null,
): Promise<string | null> {
  const setup = await getBarcodeSetup(tx, businessId);
  if (!setup.enabled || !setup.autoGenerate) return null;

  let sku: string | null = null;
  if (variantId) {
    const [variant] = await tx
      .select({ barcode: itemVariants.barcode, sku: itemVariants.sku })
      .from(itemVariants)
      .where(eq(itemVariants.id, variantId))
      .limit(1);
    if (!variant || variant.barcode) return null;
    sku = variant.sku;
  } else {
    const [item] = await tx
      .select({ barcode: items.barcode, sku: items.sku })
      .from(items)
      .where(eq(items.id, itemId))
      .limit(1);
    if (!item || item.barcode) return null;
    sku = item.sku;
  }

  const barcode = await mintBarcode(tx, businessId, setup.type, sku);
  if (variantId) {
    await tx.update(itemVariants).set({ barcode, updatedAt: new Date() }).where(eq(itemVariants.id, variantId));
  } else {
    await tx.update(items).set({ barcode, updatedAt: new Date() }).where(eq(items.id, itemId));
  }
  return barcode;
}

export interface ResolvedCode {
  itemId: string;
  variantId: string | null;
  /** Pieces one scan of this code stands for (box / carton codes > 1). */
  packQty: number;
  matchedOn: "barcode" | "extra" | "sku";
}

/**
 * Resolve many scanned codes in three queries. Item and variant barcodes win,
 * then extra codes (only honoured in "many" mode), then SKU for labels printed
 * before barcodes existed.
 */
export async function resolveCodes(
  db: Db,
  businessId: string,
  codes: string[],
  mode: BarcodeMode,
): Promise<Map<string, ResolvedCode>> {
  const out = new Map<string, ResolvedCode>();
  const wanted = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (wanted.length === 0) return out;

  const itemRows = (await db.execute(sql`
    SELECT id AS "itemId", barcode, sku FROM items
    WHERE business_id = ${businessId} AND deleted_at IS NULL
      AND (barcode IN ${wanted} OR sku IN ${wanted})
  `)) as unknown as Array<{ itemId: string; barcode: string | null; sku: string | null }>;
  const variantRows = (await db.execute(sql`
    SELECT v.item_id AS "itemId", v.id AS "variantId", v.barcode
    FROM item_variants v JOIN items i ON i.id = v.item_id
    WHERE i.business_id = ${businessId} AND i.deleted_at IS NULL AND v.deleted_at IS NULL
      AND v.barcode IN ${wanted}
  `)) as unknown as Array<{ itemId: string; variantId: string; barcode: string }>;
  const extraRows = mode === "multi"
    ? ((await db.execute(sql`
        SELECT b.item_id AS "itemId", b.variant_id AS "variantId", b.code, b.pack_qty::text AS "packQty"
        FROM item_barcodes b JOIN items i ON i.id = b.item_id
        WHERE b.business_id = ${businessId} AND i.deleted_at IS NULL AND b.code IN ${wanted}
      `)) as unknown as Array<{ itemId: string; variantId: string | null; code: string; packQty: string }>)
    : [];

  for (const r of itemRows) {
    if (r.barcode && wanted.includes(r.barcode)) {
      out.set(r.barcode, { itemId: r.itemId, variantId: null, packQty: 1, matchedOn: "barcode" });
    }
  }
  for (const r of variantRows) {
    if (!out.has(r.barcode)) {
      out.set(r.barcode, { itemId: r.itemId, variantId: r.variantId, packQty: 1, matchedOn: "barcode" });
    }
  }
  for (const r of extraRows) {
    if (!out.has(r.code)) {
      out.set(r.code, { itemId: r.itemId, variantId: r.variantId ?? null, packQty: parseFloat(r.packQty) || 1, matchedOn: "extra" });
    }
  }
  for (const r of itemRows) {
    if (r.sku && wanted.includes(r.sku) && !out.has(r.sku)) {
      out.set(r.sku, { itemId: r.itemId, variantId: null, packQty: 1, matchedOn: "sku" });
    }
  }
  return out;
}
