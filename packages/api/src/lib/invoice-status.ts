import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { invoices } from "@fintranzact/db";

/**
 * Notes and returns that take money off the invoice they reference. Their
 * totals count toward what is settled on it, alongside payments; the same
 * set limits how much can be credited or returned against an invoice.
 */
export const ADJUSTING_DOCUMENT_TYPES = ["credit_note", "sales_return", "purchase_return"] as const;

/** Documents whose changes can move the status of the invoice they reference. */
export const NOTE_DOCUMENT_TYPES = [...ADJUSTING_DOCUMENT_TYPES, "debit_note"] as const;

export function isNoteDocumentType(documentType: string): boolean {
  return (NOTE_DOCUMENT_TYPES as readonly string[]).includes(documentType);
}

type InvoiceStatus = "draft" | "unfulfilled" | "sent" | "paid" | "partial" | "overdue" | "cancelled" | "adjusted";

const TOLERANCE = 0.01;

/**
 * What an invoice's status should be, from its payments and its active
 * credit notes and returns:
 *   adjusted — the notes and returns alone cover it
 *   paid     — payments and notes together cover it
 *   partial  — part of it has been paid
 *   overdue  — nothing paid and the due date has passed
 *   sent     — nothing paid yet (an unfulfilled invoice stays unfulfilled)
 * A note or return covering only part of it leaves it sent or overdue, as
 * the invoice list and detail have always shown it.
 */
export function settledInvoiceStatus(input: {
  status: InvoiceStatus;
  totalAmount: string;
  amountPaid: string;
  adjusted: string;
  dueDate: Date | null;
  now?: Date;
}): InvoiceStatus {
  const total = parseFloat(input.totalAmount);
  const paid = parseFloat(input.amountPaid || "0");
  const adjusted = parseFloat(input.adjusted || "0");
  if (adjusted > 0 && adjusted >= total - TOLERANCE) return "adjusted";
  if (paid + adjusted > 0 && paid + adjusted >= total - TOLERANCE) return "paid";
  if (paid > 0) return "partial";
  if (input.status === "unfulfilled") return "unfulfilled";
  if (input.dueDate && input.dueDate.getTime() < (input.now ?? new Date()).getTime()) return "overdue";
  return "sent";
}

/**
 * Works an invoice's status out again from its current state, after a
 * payment or a note/return against it was added, changed, cancelled,
 * reinstated or deleted. Draft and cancelled invoices are left alone, unless
 * `promoteDraft` is set: recording a payment on a draft has always moved it
 * on to partial or paid. Only real invoices are touched; any other document
 * id is ignored. Returns the status now stored, or null when left alone.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recomputeInvoiceStatus(tx: any, businessId: string, invoiceId: string, opts: { promoteDraft?: boolean } = {}): Promise<InvoiceStatus | null> {
  const [inv] = await tx
    .select({
      status: invoices.status,
      documentType: invoices.documentType,
      totalAmount: invoices.totalAmount,
      amountPaid: invoices.amountPaid,
      dueDate: invoices.dueDate,
      deletedAt: invoices.deletedAt,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!inv || inv.documentType !== "invoice" || inv.deletedAt || inv.status === "cancelled") return null;

  const [{ adjusted }] = await tx
    .select({ adjusted: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text` })
    .from(invoices)
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.referenceDocumentId, invoiceId),
      inArray(invoices.documentType, [...ADJUSTING_DOCUMENT_TYPES]),
      sql`${invoices.status} <> 'cancelled'`,
      isNull(invoices.deletedAt),
    ));

  if (inv.status === "draft") {
    // A draft moves on only when a payment settles some of it.
    if (!opts.promoteDraft || parseFloat(inv.amountPaid || "0") <= 0) return null;
  }

  const next = settledInvoiceStatus({
    status: inv.status === "draft" ? "sent" : inv.status,
    totalAmount: inv.totalAmount,
    amountPaid: inv.amountPaid,
    adjusted,
    dueDate: inv.dueDate,
  });
  if (next !== inv.status) {
    await tx
      .update(invoices)
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)));
  }
  return next;
}

/**
 * Adds `delta` (negative to take a payment back) to what has been paid on an
 * invoice, never below zero, and works its status out again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyInvoicePayment(tx: any, businessId: string, invoiceId: string, delta: string): Promise<void> {
  await tx.execute(sql`
    UPDATE invoices SET
      amount_paid = GREATEST(amount_paid::numeric + ${delta}::numeric, 0),
      updated_at = NOW()
    WHERE id = ${invoiceId} AND business_id = ${businessId}
  `);
  await recomputeInvoiceStatus(tx, businessId, invoiceId, { promoteDraft: parseFloat(delta) > 0 });
}

/** After a note or return changes: re-work the status of the invoice it references. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recomputeReferencedInvoice(tx: any, businessId: string, doc: { documentType: string; referenceDocumentId: string | null }): Promise<void> {
  if (!doc.referenceDocumentId || !isNoteDocumentType(doc.documentType)) return;
  await recomputeInvoiceStatus(tx, businessId, doc.referenceDocumentId);
}
