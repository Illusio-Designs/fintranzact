/**
 * Pending quantities on orders, delivery challans and goods receipt notes.
 *
 * A sales order is fulfilled by the delivery challans and sale invoices made
 * from it, a purchase order by the GRNs and purchase invoices made from it,
 * and a challan or GRN by the invoice that bills it. "Made from" means the
 * later document's referenceDocumentId points at the source (document.convert
 * sets it). Nothing is stored per line: what is pending is worked out from
 * the live (not cancelled, not deleted) documents each time, so editing,
 * cancelling or deleting a delivery puts the quantity back on the order.
 *
 * Lines are matched by item (variant, else item, else name), in base units.
 * When an order has the same item on several lines, deliveries fill them in
 * line order.
 *
 * Billed and free quantities are tracked apart: a "10 + 1" order is
 * fulfilled once 10 have been delivered billed and 1 free. On a GRN only the
 * accepted quantity counts; what was rejected stays pending on the purchase
 * order (and is shown as rejected there) until more arrives or the order is
 * short-closed.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { invoiceItems, invoices, parties, items } from "@fintranzact/db";
import type { DocumentType, PendingTrackedDocumentType } from "@fintranzact/shared";
import { money, pendingTrackedDocumentTypes } from "@fintranzact/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Documents with no accounting effect: they never count as sales, purchases, dues or tax. */
export const ORDER_DOCUMENT_TYPES = ["sales_order", "purchase_order", "goods_receipt_note"] as const;

/** Condition that leaves orders and GRNs out of money totals. */
export function notOrderDocument() {
  return sql`${invoices.documentType} NOT IN ('sales_order', 'purchase_order', 'goods_receipt_note')`;
}

/** What each pending-tracked document can be converted into, and so is fulfilled by. */
export const FULFILLED_BY: Record<PendingTrackedDocumentType, DocumentType[]> = {
  sales_order: ["delivery_challan", "invoice"],
  purchase_order: ["goods_receipt_note", "invoice"],
  goods_receipt_note: ["invoice"],
  delivery_challan: ["invoice"],
};

export function isPendingTracked(documentType: string): documentType is PendingTrackedDocumentType {
  return (pendingTrackedDocumentTypes as readonly string[]).includes(documentType);
}

export type FulfilmentStatus = "open" | "partial" | "fulfilled" | "closed" | "cancelled";

export type PendingLine = {
  lineId: string;
  documentId: string;
  itemId: string | null;
  variantId: string | null;
  itemName: string;
  description: string | null;
  selectedUnit: string | null;
  conversionFactor: string | null;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  /** In the line's own unit. */
  ordered: number;
  fulfilled: number;
  pending: number;
  /** Free quantity on the line, how much of it was delivered, and what is left. */
  freeOrdered: number;
  freeFulfilled: number;
  freePending: number;
  /** Purchase orders: received on its GRNs but rejected. GRNs: rejected on the line itself. */
  rejected: number;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

function lineFactor(li: { variantId: string | null; conversionFactor: string | null }) {
  if (li.variantId) return 1;
  const f = parseFloat(li.conversionFactor ?? "1");
  return Number.isFinite(f) && f > 0 ? f : 1;
}

function lineKey(li: { variantId: string | null; itemId: string | null; itemName: string }) {
  return li.variantId ?? li.itemId ?? `name:${li.itemName.trim().toLowerCase()}`;
}

/**
 * Lines of the given documents with how much of each was taken up by later
 * documents. Documents with no lines are left out of the map.
 */
export async function loadPendingLines(db: Db, businessId: string, documentIds: string[]) {
  const result = new Map<string, PendingLine[]>();
  if (documentIds.length === 0) return result;

  const [sourceLines, taken] = await Promise.all([
    db
      .select({
        id: invoiceItems.id,
        invoiceId: invoiceItems.invoiceId,
        itemId: invoiceItems.itemId,
        variantId: invoiceItems.variantId,
        itemName: invoiceItems.itemName,
        description: invoiceItems.description,
        quantity: invoiceItems.quantity,
        unitPrice: invoiceItems.unitPrice,
        taxPercent: invoiceItems.taxPercent,
        discountPercent: invoiceItems.discountPercent,
        selectedUnit: invoiceItems.selectedUnit,
        conversionFactor: invoiceItems.conversionFactor,
        sortOrder: invoiceItems.sortOrder,
        freeQuantity: invoiceItems.freeQuantity,
        rejectedQuantity: invoiceItems.rejectedQuantity,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(and(eq(invoices.businessId, businessId), inArray(invoiceItems.invoiceId, documentIds)))
      .orderBy(invoiceItems.invoiceId, invoiceItems.sortOrder),
    db.execute(sql`
      SELECT d.reference_document_id AS source_id,
             COALESCE(li.variant_id::text, li.item_id::text, 'name:' || lower(trim(li.item_name))) AS key,
             SUM(li.quantity::numeric
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END)::text AS qty,
             SUM(COALESCE(li.free_quantity, 0)::numeric
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END)::text AS free,
             SUM(CASE WHEN d.document_type = 'goods_receipt_note' THEN COALESCE(li.rejected_quantity, 0)::numeric ELSE 0 END
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END)::text AS rejected
      FROM invoices d
      JOIN invoices s ON s.id = d.reference_document_id
      JOIN invoice_items li ON li.invoice_id = d.id
      WHERE d.business_id = ${businessId}
        AND d.reference_document_id IN ${documentIds}
        AND d.deleted_at IS NULL
        AND d.status <> 'cancelled'
        AND (
          (s.document_type = 'sales_order' AND d.document_type IN ('delivery_challan', 'invoice'))
          OR (s.document_type = 'purchase_order' AND d.document_type IN ('goods_receipt_note', 'invoice'))
          OR (s.document_type IN ('goods_receipt_note', 'delivery_challan') AND d.document_type = 'invoice')
        )
      GROUP BY 1, 2
    `) as Promise<Array<{ source_id: string; key: string; qty: string; free: string; rejected: string }>>,
  ]);

  // Base-unit quantities taken (billed, free) and rejected per (source document, item key).
  const remaining = new Map<string, number>();
  const remainingFree = new Map<string, number>();
  const remainingRejected = new Map<string, number>();
  for (const t of taken as Array<{ source_id: string; key: string; qty: string; free: string; rejected: string }>) {
    remaining.set(`${t.source_id}|${t.key}`, parseFloat(t.qty));
    remainingFree.set(`${t.source_id}|${t.key}`, parseFloat(t.free ?? "0"));
    remainingRejected.set(`${t.source_id}|${t.key}`, parseFloat(t.rejected ?? "0"));
  }
  /** Take up to `cap` (line units) from a pool, in base units. */
  const draw = (pool: Map<string, number>, mapKey: string, cap: number, factor: number) => {
    const available = pool.get(mapKey) ?? 0;
    const takeBase = Math.min(available, cap * factor);
    pool.set(mapKey, available - takeBase);
    return round3(takeBase / factor);
  };

  const lastLineOfKey = new Map<string, PendingLine & { factor: number }>();
  for (const li of sourceLines as Array<{
    id: string; invoiceId: string; itemId: string | null; variantId: string | null; itemName: string;
    description: string | null; quantity: string; unitPrice: string; taxPercent: string; discountPercent: string;
    selectedUnit: string | null; conversionFactor: string | null; freeQuantity: string | null; rejectedQuantity: string | null;
  }>) {
    const factor = lineFactor(li);
    const mapKey = `${li.invoiceId}|${lineKey(li)}`;
    const ordered = parseFloat(li.quantity);
    const freeOrdered = parseFloat(li.freeQuantity ?? "0") || 0;
    const fulfilled = draw(remaining, mapKey, ordered, factor);
    const freeFulfilled = draw(remainingFree, mapKey, freeOrdered, factor);
    // Rejections only ever count against what is still pending.
    const rejectedOnGrns = draw(remainingRejected, mapKey, Math.max(ordered - fulfilled, 0), factor);
    const line = {
      lineId: li.id,
      documentId: li.invoiceId,
      itemId: li.itemId,
      variantId: li.variantId,
      itemName: li.itemName,
      description: li.description,
      selectedUnit: li.selectedUnit,
      conversionFactor: li.conversionFactor,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      discountPercent: li.discountPercent,
      ordered: round3(ordered),
      fulfilled,
      pending: Math.max(round3(ordered - fulfilled), 0),
      freeOrdered: round3(freeOrdered),
      freeFulfilled,
      freePending: Math.max(round3(freeOrdered - freeFulfilled), 0),
      rejected: rejectedOnGrns + (parseFloat(li.rejectedQuantity ?? "0") || 0),
    };
    const list = result.get(li.invoiceId) ?? [];
    list.push(line);
    result.set(li.invoiceId, list);
    lastLineOfKey.set(mapKey, Object.assign(line, { factor }));
  }

  // Anything delivered beyond the order shows on the item's last line.
  for (const [mapKey, line] of lastLineOfKey) {
    const extra = remaining.get(mapKey) ?? 0;
    if (extra > EPS) line.fulfilled = round3(line.fulfilled + extra / line.factor);
    const extraFree = remainingFree.get(mapKey) ?? 0;
    if (extraFree > EPS) line.freeFulfilled = round3(line.freeFulfilled + extraFree / line.factor);
    delete (line as Partial<typeof line>).factor;
  }

  return result;
}

export function fulfilmentStatus(
  doc: { status: string; deletedAt: Date | null; closedAt: Date | null },
  lines: PendingLine[] | undefined,
): FulfilmentStatus {
  if (doc.deletedAt || doc.status === "cancelled") return "cancelled";
  if (doc.closedAt) return "closed";
  const all = lines ?? [];
  if (all.length > 0 && all.every((l) => l.pending <= EPS && l.freePending <= EPS)) return "fulfilled";
  if (all.some((l) => l.fulfilled > EPS || l.freeFulfilled > EPS)) return "partial";
  return "open";
}

/** Fulfilment status of each document. */
export async function fulfilmentStatuses(
  db: Db,
  businessId: string,
  docs: Array<{ id: string; status: string; deletedAt: Date | null; closedAt: Date | null }>,
) {
  const lines = await loadPendingLines(db, businessId, docs.map((d) => d.id));
  return new Map(docs.map((d) => [d.id, fulfilmentStatus(d, lines.get(d.id))]));
}

/**
 * Open lines of every live, not short-closed document of one type, oldest
 * first: what customers are still owed, what suppliers still owe, and what
 * has moved but not been billed.
 */
export async function listPendingLines(
  db: Db,
  businessId: string,
  input: { documentType: PendingTrackedDocumentType; partyId?: string; itemId?: string; overdueOnly?: boolean },
) {
  const conditions = [
    eq(invoices.businessId, businessId),
    eq(invoices.documentType, input.documentType),
    isNull(invoices.deletedAt),
    isNull(invoices.closedAt),
    sql`${invoices.status} <> 'cancelled'`,
  ];
  if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));
  if (input.itemId) {
    conditions.push(sql`EXISTS (SELECT 1 FROM ${invoiceItems} WHERE ${invoiceItems.invoiceId} = ${invoices.id} AND ${invoiceItems.itemId} = ${input.itemId})`);
  }
  if (input.overdueOnly) conditions.push(sql`${invoices.dueDate} < now()`);

  const docs = (await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      partyId: invoices.partyId,
      partyName: parties.name,
    })
    .from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(...conditions))
    .orderBy(invoices.invoiceDate, invoices.createdAt)) as Array<{
      id: string; invoiceNumber: string; invoiceDate: Date; dueDate: Date | null; partyId: string; partyName: string;
    }>;

  const lines = await loadPendingLines(db, businessId, docs.map((d) => d.id));

  // Base unit of each linked item, for display when the line used it.
  const itemIds = [...new Set([...lines.values()].flat().map((l) => l.itemId).filter((id): id is string => !!id))];
  const units = new Map<string, string>();
  if (itemIds.length > 0) {
    const rows = await db.select({ id: items.id, unit: items.unit }).from(items).where(inArray(items.id, itemIds));
    for (const r of rows as Array<{ id: string; unit: string }>) units.set(r.id, r.unit);
  }

  const now = Date.now();
  const data = docs.flatMap((d) =>
    (lines.get(d.id) ?? [])
      .filter((l) => (l.pending > EPS || l.freePending > EPS) && (!input.itemId || l.itemId === input.itemId))
      .map((l) => {
        // Pending value before tax, at the line's rate after its discount.
        const rate = money.sub(l.unitPrice, money.percent(l.unitPrice, l.discountPercent || "0"));
        return {
          documentId: d.id,
          documentNumber: d.invoiceNumber,
          documentDate: d.invoiceDate,
          dueDate: d.dueDate,
          overdue: !!d.dueDate && d.dueDate.getTime() < now,
          partyId: d.partyId,
          partyName: d.partyName,
          lineId: l.lineId,
          itemId: l.itemId,
          itemName: l.itemName,
          unit: l.selectedUnit ?? (l.itemId ? units.get(l.itemId) ?? null : null),
          ordered: l.ordered,
          fulfilled: l.fulfilled,
          pending: l.pending,
          freePending: l.freePending,
          rejected: l.rejected,
          rate,
          pendingValue: money.mul(rate, l.pending),
        };
      }),
  );

  return {
    data,
    totals: {
      documents: new Set(data.map((r) => r.documentId)).size,
      value: money.sum(data.map((r) => r.pendingValue)),
    },
  };
}

export type RejectedLine = {
  lineId: string;
  itemId: string | null;
  variantId: string | null;
  itemName: string;
  selectedUnit: string | null;
  reason: string | null;
  /** In the line's own unit. */
  rejected: number;
  /** Sent back on purchase returns or debit notes made from the GRN. */
  returned: number;
  open: number;
};

/**
 * Goods a GRN rejected, and how much of that has gone back to the supplier
 * on purchase returns or debit notes made from it (live ones only).
 */
export async function loadRejectedLines(db: Db, businessId: string, grnId: string): Promise<RejectedLine[]> {
  const [lines, returned] = await Promise.all([
    db
      .select({
        id: invoiceItems.id,
        itemId: invoiceItems.itemId,
        variantId: invoiceItems.variantId,
        itemName: invoiceItems.itemName,
        selectedUnit: invoiceItems.selectedUnit,
        conversionFactor: invoiceItems.conversionFactor,
        rejectedQuantity: invoiceItems.rejectedQuantity,
        rejectionReason: invoiceItems.rejectionReason,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(and(eq(invoices.businessId, businessId), eq(invoiceItems.invoiceId, grnId)))
      .orderBy(invoiceItems.sortOrder),
    db.execute(sql`
      SELECT COALESCE(li.variant_id::text, li.item_id::text, 'name:' || lower(trim(li.item_name))) AS key,
             SUM((li.quantity::numeric + COALESCE(li.free_quantity, 0)::numeric)
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END)::text AS qty
      FROM invoices d
      JOIN invoice_items li ON li.invoice_id = d.id
      WHERE d.business_id = ${businessId}
        AND d.reference_document_id = ${grnId}
        AND d.document_type IN ('purchase_return', 'debit_note')
        AND d.deleted_at IS NULL
        AND d.status <> 'cancelled'
      GROUP BY 1
    `) as Promise<Array<{ key: string; qty: string }>>,
  ]);

  const pool = new Map<string, number>();
  for (const r of returned as Array<{ key: string; qty: string }>) pool.set(r.key, parseFloat(r.qty));

  const out: RejectedLine[] = [];
  for (const li of lines as Array<{
    id: string; itemId: string | null; variantId: string | null; itemName: string; selectedUnit: string | null;
    conversionFactor: string | null; rejectedQuantity: string; rejectionReason: string | null;
  }>) {
    const rejected = parseFloat(li.rejectedQuantity) || 0;
    if (rejected <= EPS) continue;
    const factor = lineFactor(li);
    const key = lineKey(li);
    const available = pool.get(key) ?? 0;
    const takeBase = Math.min(available, rejected * factor);
    pool.set(key, available - takeBase);
    const back = round3(takeBase / factor);
    out.push({
      lineId: li.id,
      itemId: li.itemId,
      variantId: li.variantId,
      itemName: li.itemName,
      selectedUnit: li.selectedUnit,
      reason: li.rejectionReason,
      rejected: round3(rejected),
      returned: back,
      open: Math.max(round3(rejected - back), 0),
    });
  }
  return out;
}
