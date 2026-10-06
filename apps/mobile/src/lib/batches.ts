/**
 * Batch / expiry helpers for document lines (mirrors the web's BatchFields).
 *
 * Inward lines (purchase invoice) type a batch number and dates; outward lines
 * (sale invoice, delivery challan) pick one of the item's batches, or leave it
 * on "earliest expiry first" and let the server split the quantity (FEFO).
 * Dates are YYYY-MM-DD strings, as the API takes them.
 */

/** Days before expiry at which a batch counts as "near expiry" (the web's 30-day badge). */
export const NEAR_EXPIRY_DAYS = 30;

export type BatchRow = {
  id: string;
  batchNumber: string;
  mfgDate: string | null;
  expiryDate: string | null;
  mrp: string | null;
  /** Stock in the document's warehouse, a decimal string. */
  quantity: string;
  expired: boolean;
  daysToExpiry: number | null;
};

export type ExpiryStatus = "none" | "ok" | "near" | "expired";

export function expiryStatus(b: { expired?: boolean; daysToExpiry: number | null }): ExpiryStatus {
  if (b.daysToExpiry === null) return "none";
  if (b.expired || b.daysToExpiry < 0) return "expired";
  return b.daysToExpiry <= NEAR_EXPIRY_DAYS ? "near" : "ok";
}

/** "Expired 3d ago", "Expires today", "12d left" or null when there is nothing to warn about. */
export function expiryWarning(b: { expired?: boolean; daysToExpiry: number | null }): string | null {
  const status = expiryStatus(b);
  if (status === "expired") return b.daysToExpiry === null ? "Expired" : `Expired ${-b.daysToExpiry}d ago`;
  if (status === "near") return b.daysToExpiry === 0 ? "Expires today" : `${b.daysToExpiry}d left`;
  return null;
}

/** Earliest expiry first; undated batches last, then by batch number. A copy, the input is left alone. */
export function sortBatchesFefo<T extends { expiryDate: string | null; batchNumber: string }>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    if (a.expiryDate && b.expiryDate && a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
    if (a.expiryDate && !b.expiryDate) return -1;
    if (!a.expiryDate && b.expiryDate) return 1;
    return a.batchNumber.localeCompare(b.batchNumber);
  });
}

export function formatQty(q: string | number, unit?: string | null): string {
  const n = typeof q === "number" ? q : parseFloat(q);
  const text = Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "0";
  return unit ? `${text} ${unit}` : text;
}

/** How FEFO would split `needed` across these batches (expired ones skipped unless `includeExpired`). */
export function fefoPreview(batches: BatchRow[], needed: number, includeExpired = false) {
  const pieces: Array<{ batchNumber: string; quantity: number }> = [];
  let left = needed;
  for (const b of sortBatchesFefo(batches)) {
    if (left <= 0.0005) break;
    if (b.expired && !includeExpired) continue;
    const q = Math.min(parseFloat(b.quantity), left);
    if (!(q > 0.0005)) continue;
    pieces.push({ batchNumber: b.batchNumber, quantity: q });
    left -= q;
  }
  return { pieces, short: Math.max(left, 0) };
}

/** Local-calendar YYYY-MM-DD (not UTC: the user picked a day on their phone). */
export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromDateOnly(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── Inward ─────────────────────────────────────────────────────

export type BatchInValue = {
  /**
   * A saved line's batch (editing a document, or a return made from an invoice),
   * sent as is. Typing a different batch number or date drops it.
   */
  batchId?: string;
  batchNumber?: string;
  mfgDate?: string;
  expiryDate?: string;
  batchMrp?: string;
};

/** First problem with an inward line's batch fields, or null. */
export function inwardBatchError(
  v: BatchInValue,
  opts: { trackExpiry: boolean; itemName?: string },
): string | null {
  if (v.batchId) return null;
  const of = opts.itemName ? ` for ${opts.itemName}` : "";
  const number = v.batchNumber?.trim();
  if (!number) return `Enter a batch number${of}`;
  if (number.length > 60) return `Batch number${of} is too long (60 characters at most)`;
  if (opts.trackExpiry && !v.expiryDate) return `Enter an expiry date for batch ${number}${of}`;
  if (v.mfgDate && v.expiryDate && v.expiryDate < v.mfgDate) return `Expiry must be after the manufacturing date for batch ${number}`;
  if (v.batchMrp && !/^\d{1,13}(\.\d{1,2})?$/.test(v.batchMrp.trim())) return `Batch MRP for ${number} must be an amount`;
  return null;
}

/** Fields to send on an inward line (the API's lineBatchFields): the saved batch, or the number typed in, or {}. */
export function inwardBatchPayload(v: BatchInValue | undefined) {
  if (v?.batchId) return { batchId: v.batchId };
  const batchNumber = v?.batchNumber?.trim();
  if (!v || !batchNumber) return {};
  return {
    batchNumber,
    mfgDate: v.mfgDate || undefined,
    expiryDate: v.expiryDate || undefined,
    batchMrp: v.batchMrp?.trim() || undefined,
  };
}

// ── Outward ────────────────────────────────────────────────────

export type BatchOutValue = {
  /** Empty = earliest expiry first (the server splits the quantity). */
  batchId?: string;
  allowExpired?: boolean;
};

/** First problem with an outward line's batch choice, or null. `needed` is in the item's base unit. */
export function outwardBatchError(
  v: BatchOutValue,
  batches: BatchRow[],
  needed: number,
  itemName?: string,
): string | null {
  if (!v.batchId) return null;
  const b = batches.find((x) => x.id === v.batchId);
  if (!b) return null;
  const of = itemName ? ` of ${itemName}` : "";
  if (b.expired && !v.allowExpired) return `Batch ${b.batchNumber}${of} has expired. Pick another batch or allow expired stock.`;
  if (needed - parseFloat(b.quantity) > 0.0005) return `Only ${formatQty(b.quantity)} left in batch ${b.batchNumber}${of}`;
  return null;
}

/** Fields to send on an outward line. Nothing picked: the server takes stock earliest expiry first. */
export function outwardBatchPayload(v: BatchOutValue | undefined) {
  if (!v?.batchId) return {};
  return { batchId: v.batchId, ...(v.allowExpired ? { allowExpired: true } : {}) };
}

/** The batch a saved line was posted from, and how much of it the line holds (base unit). */
export type SavedBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string | null;
  quantity: number;
};

/**
 * The item's batches with the saved line's own holding counted as available
 * again (the server does the same when it re-posts an edited document), and
 * the saved batch listed even when it has run to zero.
 */
export function withSavedBatch(rows: BatchRow[], saved: SavedBatch | undefined | null): BatchRow[] {
  if (!saved) return rows;
  const found = rows.some((r) => r.id === saved.id);
  if (found) {
    return rows.map((r) =>
      r.id === saved.id ? { ...r, quantity: String(Math.round((parseFloat(r.quantity) + saved.quantity) * 1000) / 1000) } : r,
    );
  }
  return [
    ...rows,
    {
      id: saved.id,
      batchNumber: saved.batchNumber,
      mfgDate: null,
      expiryDate: saved.expiryDate,
      mrp: null,
      quantity: String(saved.quantity),
      expired: false,
      daysToExpiry: null,
    },
  ];
}

/** The saved batch as an inward line value, from the batch a saved line carries (`line.batch`). */
export function batchInFromSaved(
  batchId: string | null | undefined,
  batch: { batchNumber: string; mfgDate: string | null; expiryDate: string | null; mrp: string | null } | null | undefined,
): BatchInValue | undefined {
  if (!batchId) return undefined;
  return {
    batchId,
    batchNumber: batch?.batchNumber ?? "",
    mfgDate: batch?.mfgDate ?? "",
    expiryDate: batch?.expiryDate ?? "",
    batchMrp: batch?.mrp ?? "",
  };
}

// ── Line-level glue ────────────────────────────────────────────

/** The batch.list input for an outward picker, shared by the picker and the submit check so they hit one cache entry. */
export function batchOutListInput(itemId: string, variantId: string | null | undefined, asOf: string) {
  return { itemId, variantId: variantId ?? null, warehouseId: null, asOf };
}

/** A line's tracking flags plus what the user entered. */
export type BatchLineState = {
  itemId?: string;
  variantId?: string;
  itemName: string;
  quantity: string;
  conversionFactor?: string;
  trackBatches?: boolean;
  trackExpiry?: boolean;
  batchIn?: BatchInValue;
  batchOut?: BatchOutValue;
  /** Editing: the batch this line already holds stock in. */
  savedBatch?: SavedBatch;
};

/** The line's quantity in the item's base unit (variants and base-unit lines have no factor). */
export function baseQuantity(l: Pick<BatchLineState, "quantity" | "conversionFactor" | "variantId">): number {
  const q = parseFloat(l.quantity);
  if (!(q > 0)) return 0;
  const f = l.variantId ? 1 : parseFloat(l.conversionFactor || "1");
  return q * (f > 0 ? f : 1);
}

/** Wire fields for one line: nothing for an untracked item or when the plan lacks batches. */
export function lineBatchPayload(l: BatchLineState, direction: "in" | "out", allowed: boolean) {
  if (!allowed || !l.trackBatches) return {};
  return direction === "in" ? inwardBatchPayload(l.batchIn) : outwardBatchPayload(l.batchOut);
}

/** First problem with any inward line's batch fields (tracked items only), or null. */
export function inwardLinesError(lines: BatchLineState[]): string | null {
  for (const l of lines) {
    if (!l.trackBatches) continue;
    const err = inwardBatchError(l.batchIn ?? {}, { trackExpiry: !!l.trackExpiry, itemName: l.itemName });
    if (err) return err;
  }
  return null;
}

/**
 * First problem with any outward line's picked batch: expired without
 * "allow expired", or more than the batch holds. `fetchBatches` reads the
 * item's batches (cached by the picker).
 */
export async function outwardLinesError(
  lines: BatchLineState[],
  asOf: string,
  fetchBatches: (input: ReturnType<typeof batchOutListInput>) => Promise<BatchRow[]>,
): Promise<string | null> {
  for (const l of lines) {
    if (!l.trackBatches || !l.itemId || !l.batchOut?.batchId) continue;
    const rows = withSavedBatch(await fetchBatches(batchOutListInput(l.itemId, l.variantId, asOf)), l.savedBatch);
    const err = outwardBatchError(l.batchOut, rows, baseQuantity(l), l.itemName);
    if (err) return err;
  }
  return null;
}
