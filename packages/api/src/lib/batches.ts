/**
 * Batch / lot numbers and expiry.
 *
 * An item that tracks batches holds its stock per batch. The batch master
 * (item_batches) carries the number, dates and MRP; how much of a batch sits
 * in a warehouse is never stored — it is the sum of the stock movements that
 * name the batch there, so it follows every document, cancel, reinstate, edit
 * and delete exactly like the item's own stock does.
 *
 * Document lines name their batch (invoice_items.batch_id). Before a document
 * is written its lines go through resolveLineBatches:
 *   - inward lines (purchase, GRN, inward challan, sales return) pick an
 *     existing batch or create one from the number and dates typed in;
 *   - outward lines (sale, challan, purchase return) keep a batch the user
 *     picked — refusing one that has expired by the document date unless the
 *     user said so — or, with no batch picked, are split across batches
 *     first-expiry-first-out (FEFO), never taking expired stock.
 * syncDocumentStock then posts movements per batch and refuses to take a
 * batch below zero on any change a user makes.
 *
 * Stock of a tracked item that no batch accounts for (it was there before
 * tracking was switched on) is the "unbatched" pool: movements with no batch.
 * FEFO uses it after every dated batch.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { inventorySettings, itemBatches, items, itemVariants } from "@fintranzact/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const EPS = 0.0005;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => round3(n).toFixed(3).replace(/\.?0+$/, "") || "0";

/** A calendar date (YYYY-MM-DD) as seen in India, where the books are kept. */
export function businessDay(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** DD/MM/YYYY for messages and printouts. */
export function formatBatchDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export type BatchRow = typeof itemBatches.$inferSelect;

/** Whether a batch has expired as of `day` (it can still go out on its expiry date). */
export function isExpired(batch: { expiryDate: string | null }, day: string) {
  return !!batch.expiryDate && batch.expiryDate < day;
}

export type BatchFields = {
  batchNumber: string;
  mfgDate?: string | null;
  expiryDate?: string | null;
  mrp?: string | null;
};

/** Check a batch's own fields: sensible dates. */
export function assertBatchFields(f: { mfgDate?: string | null; expiryDate?: string | null }) {
  if (f.mfgDate && f.expiryDate && f.expiryDate < f.mfgDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Expiry date can't be before the manufacturing date" });
  }
}

/** Items (by id) with the fields batch handling needs. */
async function loadItems(tx: Tx, businessId: string, itemIds: string[]) {
  const map = new Map<string, { id: string; name: string; trackBatches: boolean; trackExpiry: boolean; itemType: string }>();
  if (itemIds.length === 0) return map;
  const rows = await tx
    .select({ id: items.id, name: items.name, trackBatches: items.trackBatches, trackExpiry: items.trackExpiry, itemType: items.itemType })
    .from(items)
    .where(and(eq(items.businessId, businessId), inArray(items.id, itemIds)));
  for (const r of rows) map.set(r.id, r);
  return map;
}

/**
 * Find a batch of an item by number, or create it. Dates and MRP given for an
 * existing batch fill in what it lacks; a date that contradicts what the batch
 * already has is refused rather than silently ignored.
 */
export async function findOrCreateBatch(
  tx: Tx,
  input: { businessId: string; itemId: string; variantId?: string | null; itemName?: string; requireExpiry?: boolean } & BatchFields,
): Promise<BatchRow> {
  const batchNumber = input.batchNumber.trim();
  if (!batchNumber) throw new TRPCError({ code: "BAD_REQUEST", message: "Batch number can't be blank" });
  assertBatchFields(input);
  const variantCond = input.variantId
    ? eq(itemBatches.variantId, input.variantId)
    : sql`${itemBatches.variantId} IS NULL`;
  const [existing] = await tx
    .select()
    .from(itemBatches)
    .where(and(
      eq(itemBatches.businessId, input.businessId),
      eq(itemBatches.itemId, input.itemId),
      variantCond,
      eq(itemBatches.batchNumber, batchNumber),
    ))
    .limit(1);

  if (existing) {
    const patch: Record<string, unknown> = {};
    const label = `Batch ${batchNumber}${input.itemName ? ` of ${input.itemName}` : ""}`;
    if (input.expiryDate) {
      if (!existing.expiryDate) patch.expiryDate = input.expiryDate;
      else if (existing.expiryDate !== input.expiryDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${label} already exists with expiry ${formatBatchDate(existing.expiryDate)}`,
        });
      }
    }
    if (input.mfgDate && !existing.mfgDate) patch.mfgDate = input.mfgDate;
    if (input.mrp && !existing.mrp) patch.mrp = input.mrp;
    if (Object.keys(patch).length === 0) return existing;
    const merged = { mfgDate: existing.mfgDate, expiryDate: existing.expiryDate, ...patch } as { mfgDate: string | null; expiryDate: string | null };
    assertBatchFields(merged);
    const [updated] = await tx
      .update(itemBatches)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(itemBatches.id, existing.id))
      .returning();
    return updated;
  }

  if (input.requireExpiry && !input.expiryDate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Enter an expiry date for batch ${batchNumber}${input.itemName ? ` of ${input.itemName}` : ""}`,
    });
  }
  const [created] = await tx
    .insert(itemBatches)
    .values({
      businessId: input.businessId,
      itemId: input.itemId,
      variantId: input.variantId ?? null,
      batchNumber,
      mfgDate: input.mfgDate || null,
      expiryDate: input.expiryDate || null,
      mrp: input.mrp || null,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost a race with another writer creating the same batch: use theirs.
  const [raced] = await tx
    .select()
    .from(itemBatches)
    .where(and(
      eq(itemBatches.businessId, input.businessId),
      eq(itemBatches.itemId, input.itemId),
      variantCond,
      eq(itemBatches.batchNumber, batchNumber),
    ))
    .limit(1);
  return raced;
}

/**
 * How much of each batch of an item (or variant) sits in one warehouse, from
 * the movement ledger. The key null is the unbatched pool. Movements of
 * `excludeReferenceId` are left out, so a document being edited can count
 * the stock it already holds as available again.
 */
export async function batchStockAt(
  tx: Tx,
  input: { businessId: string; warehouseId: string; itemId: string; variantId?: string | null; excludeReferenceId?: string | null },
): Promise<Map<string | null, number>> {
  const rows = (await tx.execute(sql`
    SELECT batch_id, SUM(quantity::numeric)::text AS qty
    FROM stock_movements
    WHERE business_id = ${input.businessId}
      AND warehouse_id = ${input.warehouseId}
      AND item_id = ${input.itemId}
      AND ${input.variantId ? sql`variant_id = ${input.variantId}` : sql`variant_id IS NULL`}
      ${input.excludeReferenceId ? sql`AND reference_id IS DISTINCT FROM ${input.excludeReferenceId}::uuid` : sql``}
    GROUP BY batch_id
  `)) as unknown as Array<{ batch_id: string | null; qty: string }>;
  const map = new Map<string | null, number>();
  for (const r of rows) map.set(r.batch_id, parseFloat(r.qty));

  // Stock on the item that no warehouse accounts for yet (data from before
  // warehouses) sits in the default warehouse, unbatched.
  const [settings] = await tx
    .select({ defaultId: inventorySettings.salesWarehouseId })
    .from(inventorySettings)
    .where(eq(inventorySettings.businessId, input.businessId))
    .limit(1);
  if (settings?.defaultId === input.warehouseId) {
    const [u] = (await tx.execute(sql`
      SELECT (COALESCE((
          ${input.variantId
            ? sql`SELECT stock_quantity::numeric FROM item_variants WHERE id = ${input.variantId}`
            : sql`SELECT stock_quantity::numeric FROM items WHERE id = ${input.itemId}`}
        ), 0)
        - COALESCE((SELECT SUM(quantity::numeric) FROM stock_balances
            WHERE business_id = ${input.businessId} AND item_id = ${input.itemId}
              AND ${input.variantId ? sql`variant_id = ${input.variantId}` : sql`variant_id IS NULL`}), 0))::text AS qty
    `)) as unknown as Array<{ qty: string }>;
    const unplaced = parseFloat(u?.qty ?? "0");
    if (Math.abs(unplaced) >= EPS) map.set(null, (map.get(null) ?? 0) + unplaced);
  }
  return map;
}

/** Balance of one batch in one warehouse, from the movement ledger. */
export async function batchBalance(tx: Tx, businessId: string, warehouseId: string, batchId: string) {
  const [row] = (await tx.execute(sql`
    SELECT COALESCE(SUM(quantity::numeric), 0)::text AS qty
    FROM stock_movements
    WHERE business_id = ${businessId} AND warehouse_id = ${warehouseId} AND batch_id = ${batchId}
  `)) as unknown as Array<{ qty: string }>;
  return parseFloat(row?.qty ?? "0");
}

export type Allocation = { batchId: string | null; quantity: number };

/**
 * Split an outgoing base quantity across an item's batches in one warehouse,
 * first expiry first out: dated batches by expiry, then undated ones oldest
 * first, then the unbatched pool. Expired batches are skipped unless
 * `includeExpired` (transfers and write-offs move expired stock too).
 * `claimed` is stock already promised to other lines of the same change.
 * Returns what it could place and the shortfall.
 */
export async function allocateFefo(
  tx: Tx,
  input: {
    businessId: string;
    warehouseId: string;
    itemId: string;
    variantId?: string | null;
    quantity: number;
    day: string;
    includeExpired?: boolean;
    excludeReferenceId?: string | null;
    claimed?: Map<string | null, number>;
  },
): Promise<{ allocations: Allocation[]; shortfall: number }> {
  const stock = await batchStockAt(tx, input);
  const batches = await tx
    .select()
    .from(itemBatches)
    .where(and(
      eq(itemBatches.businessId, input.businessId),
      eq(itemBatches.itemId, input.itemId),
      input.variantId ? eq(itemBatches.variantId, input.variantId) : sql`${itemBatches.variantId} IS NULL`,
    ))
    .orderBy(sql`${itemBatches.expiryDate} ASC NULLS LAST`, itemBatches.createdAt, itemBatches.batchNumber);

  const sources: Array<string | null> = [
    ...batches
      .filter((b: BatchRow) => input.includeExpired || !isExpired(b, input.day))
      .map((b: BatchRow) => b.id),
    null,
  ];

  let remaining = round3(input.quantity);
  const allocations: Allocation[] = [];
  for (const id of sources) {
    if (remaining < EPS) break;
    const free = round3((stock.get(id) ?? 0) - (input.claimed?.get(id) ?? 0));
    if (free < EPS) continue;
    const take = Math.min(free, remaining);
    allocations.push({ batchId: id, quantity: round3(take) });
    remaining = round3(remaining - take);
  }
  return { allocations, shortfall: Math.max(remaining, 0) };
}

/** Fields a document line may carry about its batch. */
export type LineBatchInput = {
  itemId?: string | null;
  variantId?: string | null;
  itemName: string;
  quantity: string;
  /** Free goods on top of the billed quantity: they move stock (and so
   *  come from, or go into, the line's batch) with the billed quantity. */
  freeQuantity?: string | null;
  conversionFactor?: string | null;
  batchId?: string | null;
  batchNumber?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  batchMrp?: string | null;
  allowExpired?: boolean | null;
};

/**
 * Give every line of a batch-tracked item its batch before the document is
 * written (see the file comment). Lines of other items pass through. A line
 * whose outgoing quantity spans several batches is split into one line per
 * batch at the same price.
 *
 * `strict` is for changes a user makes: an inward line must name its batch,
 * and FEFO that runs short fails under the "block" negative stock policy.
 * Background writers (recurring invoices, store orders) pass false: what
 * can't be placed in a batch goes to the unbatched pool.
 */
export async function resolveLineBatches<T extends LineBatchInput>(
  tx: Tx,
  input: {
    businessId: string;
    lines: T[];
    /** Stock direction of the document: +1 in, -1 out, 0 none. */
    direction: -1 | 0 | 1;
    /** Warehouse the document moves stock through; null when it moves none. */
    warehouseId: string | null;
    documentDate: Date;
    /** When editing: the document's own holdings count as available. */
    documentId?: string | null;
    strict: boolean;
  },
): Promise<Array<T & { batchId: string | null }>> {
  const { businessId } = input;

  // Parent item of every line.
  const variantIds = [...new Set(input.lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const variantParent = new Map<string, string>();
  if (variantIds.length > 0) {
    const rows = await tx
      .select({ id: itemVariants.id, itemId: itemVariants.itemId })
      .from(itemVariants)
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(and(inArray(itemVariants.id, variantIds), eq(items.businessId, businessId)));
    for (const r of rows) variantParent.set(r.id, r.itemId);
  }
  const itemOf = (l: LineBatchInput) => l.itemId || (l.variantId ? variantParent.get(l.variantId) ?? null : null);
  const itemMap = await loadItems(tx, businessId, [...new Set(input.lines.map(itemOf).filter((v): v is string => !!v))]);

  // Batches the lines name.
  const pickedIds = [...new Set(input.lines.map((l) => l.batchId).filter((v): v is string => !!v))];
  const picked = new Map<string, BatchRow>();
  if (pickedIds.length > 0) {
    const rows = await tx
      .select()
      .from(itemBatches)
      .where(and(eq(itemBatches.businessId, businessId), inArray(itemBatches.id, pickedIds)));
    for (const r of rows) picked.set(r.id, r);
  }
  for (const l of input.lines) {
    if (!l.batchId) continue;
    const b = picked.get(l.batchId);
    if (!b || b.itemId !== itemOf(l) || (b.variantId ?? null) !== (l.variantId ?? null)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `That batch doesn't belong to ${l.itemName}` });
    }
  }

  const day = businessDay(input.documentDate);
  const moves = input.direction !== 0 && !!input.warehouseId;

  // Documents taking the same batch-tracked items queue up here, so two
  // bills can't both be handed the last of a batch.
  const trackedIds = [...itemMap.values()].filter((i) => i.trackBatches).map((i) => i.id);
  if (moves && input.direction === -1 && trackedIds.length > 0) {
    await tx.select({ id: items.id }).from(items).where(inArray(items.id, trackedIds.sort())).for("update");
  }
  const out: Array<T & { batchId: string | null }> = [];

  // Stock promised to earlier lines, per item/variant and batch.
  const claims = new Map<string, Map<string | null, number>>();
  const claimKey = (itemId: string, variantId?: string | null) => `${itemId}:${variantId ?? ""}`;
  const claim = (itemId: string, variantId: string | null | undefined, batchId: string | null, qty: number) => {
    const key = claimKey(itemId, variantId);
    const m = claims.get(key) ?? new Map<string | null, number>();
    m.set(batchId, (m.get(batchId) ?? 0) + qty);
    claims.set(key, m);
  };
  // What the line moves, in the item's base unit: billed plus free goods.
  // (Goods rejected on a GRN never come in, so they don't count.)
  const lineUnits = (l: LineBatchInput) => parseFloat(l.quantity || "0") + parseFloat(l.freeQuantity || "0");
  const baseQty = (l: LineBatchInput) =>
    round3(lineUnits(l) * (l.variantId ? 1 : parseFloat(l.conversionFactor || "1")));

  // Picked batches claim their stock before FEFO shares out the rest.
  if (moves && input.direction === -1) {
    for (const l of input.lines) {
      const itemId = itemOf(l);
      if (l.batchId && itemId) claim(itemId, l.variantId, l.batchId, baseQty(l));
    }
  }

  for (const l of input.lines) {
    const itemId = itemOf(l);
    const item = itemId ? itemMap.get(itemId) : undefined;
    const tracked = !!item?.trackBatches && item.itemType !== "service";

    if (l.batchId) {
      const b = picked.get(l.batchId)!;
      if (moves && input.direction === -1 && isExpired(b, day) && !l.allowExpired) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Batch ${b.batchNumber} of ${l.itemName} expired on ${formatBatchDate(b.expiryDate)}. Pick another batch, or allow expired stock on this line.`,
        });
      }
      out.push({ ...l, batchId: l.batchId });
      continue;
    }

    if (!tracked || !itemId) {
      out.push({ ...l, batchId: null });
      continue;
    }

    const number = l.batchNumber?.trim();

    // Inward, or a document that moves no stock: name the batch by number.
    // A GRN line that was rejected in full brings nothing in, so it needs none.
    if (!moves || input.direction === 1) {
      if (!number && moves && baseQty(l) < EPS) {
        out.push({ ...l, batchId: null });
        continue;
      }
      if (number) {
        const batch = await findOrCreateBatch(tx, {
          businessId,
          itemId,
          variantId: l.variantId ?? null,
          itemName: l.itemName,
          batchNumber: number,
          mfgDate: l.mfgDate ?? null,
          expiryDate: l.expiryDate ?? null,
          mrp: l.batchMrp ?? null,
          requireExpiry: moves && input.strict && item.trackExpiry,
        });
        out.push({ ...l, batchId: batch.id });
      } else if (moves && input.strict) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Enter a batch number for ${l.itemName}` });
      } else {
        out.push({ ...l, batchId: null });
      }
      continue;
    }

    // Outward with a batch number typed in: it must exist.
    if (number) {
      const [b] = await tx
        .select()
        .from(itemBatches)
        .where(and(
          eq(itemBatches.businessId, businessId),
          eq(itemBatches.itemId, itemId),
          l.variantId ? eq(itemBatches.variantId, l.variantId) : sql`${itemBatches.variantId} IS NULL`,
          eq(itemBatches.batchNumber, number),
        ))
        .limit(1);
      if (!b) throw new TRPCError({ code: "BAD_REQUEST", message: `${l.itemName} has no batch ${number}` });
      if (isExpired(b, day) && !l.allowExpired) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Batch ${b.batchNumber} of ${l.itemName} expired on ${formatBatchDate(b.expiryDate)}. Pick another batch, or allow expired stock on this line.`,
        });
      }
      claim(itemId, l.variantId, b.id, baseQty(l));
      out.push({ ...l, batchId: b.id });
      continue;
    }

    // Outward with no batch: first expiry first out.
    const factor = l.variantId ? 1 : parseFloat(l.conversionFactor || "1");
    const need = baseQty(l);
    const { allocations, shortfall } = await allocateFefo(tx, {
      businessId,
      warehouseId: input.warehouseId!,
      itemId,
      variantId: l.variantId ?? null,
      quantity: need,
      day,
      excludeReferenceId: input.documentId ?? null,
      claimed: claims.get(claimKey(itemId, l.variantId)),
    });
    if (shortfall >= EPS) {
      if (input.strict) {
        const [settings] = await tx
          .select({ policy: inventorySettings.negativeStockPolicy })
          .from(inventorySettings)
          .where(eq(inventorySettings.businessId, businessId))
          .limit(1);
        if (settings?.policy === "block") {
          const have = round3(need - shortfall);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Not enough stock of ${l.itemName} in unexpired batches — ${fmt(have)} available, ${fmt(need)} needed`,
          });
        }
      }
      // What no batch covers comes out of the unbatched pool.
      const pool = allocations.find((a) => a.batchId === null);
      if (pool) pool.quantity = round3(pool.quantity + shortfall);
      else allocations.push({ batchId: null, quantity: shortfall });
    }
    for (const a of allocations) claim(itemId, l.variantId, a.batchId, a.quantity);

    if (allocations.length <= 1) {
      out.push({ ...l, batchId: allocations[0]?.batchId ?? null });
      continue;
    }
    // One line per batch, in the line's own unit; the last takes the rest so
    // the quantities add up to exactly what was entered. Billed goods fill the
    // earliest batches first and free goods follow, so each split line keeps
    // "billed + free" and the priced total is unchanged.
    const str = (n: number) => n.toFixed(3).replace(/\.?0+$/, "") || "0";
    let billedLeft = round3(parseFloat(l.quantity || "0"));
    let freeLeft = round3(parseFloat(l.freeQuantity || "0"));
    allocations.forEach((a, idx) => {
      const last = idx === allocations.length - 1;
      const q = last ? round3(billedLeft + freeLeft) : round3(a.quantity / factor);
      const billed = last ? billedLeft : round3(Math.min(q, billedLeft));
      const free = last ? freeLeft : round3(Math.min(q - billed, freeLeft));
      billedLeft = round3(billedLeft - billed);
      freeLeft = round3(freeLeft - free);
      out.push({
        ...l,
        quantity: str(billed),
        ...(l.freeQuantity !== undefined || free > 0 ? { freeQuantity: str(free) } : {}),
        batchId: a.batchId,
      });
    });
  }
  return out;
}
