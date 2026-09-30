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
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(and(eq(invoices.businessId, businessId), inArray(invoiceItems.invoiceId, documentIds)))
      .orderBy(invoiceItems.invoiceId, invoiceItems.sortOrder),
    db.execute(sql`
      SELECT d.reference_document_id AS source_id,
             COALESCE(li.variant_id::text, li.item_id::text, 'name:' || lower(trim(li.item_name))) AS key,
             SUM(li.quantity::numeric
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END)::text AS qty
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
    `) as Promise<Array<{ source_id: string; key: string; qty: string }>>,
  ]);

  // Base-unit quantity taken per (source document, item key).
  const remaining = new Map<string, number>();
  for (const t of taken as Array<{ source_id: string; key: string; qty: string }>) {
    remaining.set(`${t.source_id}|${t.key}`, parseFloat(t.qty));
  }

  const lastLineOfKey = new Map<string, PendingLine & { factor: number }>();
  for (const li of sourceLines as Array<{
    id: string; invoiceId: string; itemId: string | null; variantId: string | null; itemName: string;
    description: string | null; quantity: string; unitPrice: string; taxPercent: string; discountPercent: string;
    selectedUnit: string | null; conversionFactor: string | null;
  }>) {
    const factor = lineFactor(li);
    const mapKey = `${li.invoiceId}|${lineKey(li)}`;
    const ordered = parseFloat(li.quantity);
    const available = remaining.get(mapKey) ?? 0;
    const takeBase = Math.min(available, ordered * factor);
    remaining.set(mapKey, available - takeBase);
    const fulfilled = round3(takeBase / factor);
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
  if (all.length > 0 && all.every((l) => l.pending <= EPS)) return "fulfilled";
  if (all.some((l) => l.fulfilled > EPS)) return "partial";
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
      .filter((l) => l.pending > EPS && (!input.itemId || l.itemId === input.itemId))
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
