/**
 * What is still owed on each bill — the Outstanding report's rows and the
 * dashboard's "To collect" / "To pay" — worked out one way for both.
 *
 *   A bill (an invoice, or a debit note raising a customer's dues) is owed
 *   its total less what was paid against it and less the credit notes and
 *   returns made against it (the invoice detail's "CN/SR adjusted").
 *   A note or return that is not made against a bill counted here takes its
 *   value off what the party owes as a row of its own (negative).
 *
 * Cancelled and deleted documents never count; drafts only when asked (the
 * dashboard has always counted them, the Outstanding report never has).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { invoices, parties } from "@fintranzact/db";
import { ADJUSTING_DOCUMENT_TYPES } from "./invoice-status.js";
import { billDocument, reducingDocument } from "./order-fulfilment.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const adjustingList = sql.join(ADJUSTING_DOCUMENT_TYPES.map((t) => sql`${t}`), sql`, `);

/** Credit notes and returns made against the bill in the current row. */
const adjustedOnBill = sql`COALESCE((
  SELECT SUM(n.total_amount::numeric) FROM invoices n
  WHERE n.reference_document_id = ${invoices.id}
    AND n.business_id = ${invoices.businessId}
    AND n.document_type IN (${adjustingList})
    AND n.status <> 'cancelled' AND n.deleted_at IS NULL
), 0)`;

/** Whether the current row is a note made against a live bill (counted on that bill instead). */
const madeAgainstBill = sql`EXISTS (
  SELECT 1 FROM invoices b
  WHERE b.id = ${invoices.referenceDocumentId}
    AND b.document_type = 'invoice'
    AND b.status <> 'cancelled' AND b.deleted_at IS NULL
)`;

/** Signed amount owed on the current row (see the module comment). */
export const outstandingOnRow = sql<string>`(CASE
  WHEN ${reducingDocument()} THEN -(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)
  ELSE ${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric - ${adjustedOnBill}
END)`;

/** Conditions selecting the rows that make up what is outstanding on one side. */
export function outstandingConditions(businessId: string, side: "sale" | "purchase", opts: { includeDrafts: boolean }) {
  return and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, side),
    billDocument(),
    isNull(invoices.deletedAt),
    opts.includeDrafts ? sql`${invoices.status} <> 'cancelled'` : sql`${invoices.status} NOT IN ('cancelled', 'draft')`,
    // A note against a bill is already taken off that bill
    sql`NOT (${reducingDocument()} AND ${invoices.documentType} IN (${adjustingList}) AND ${madeAgainstBill})`,
    sql`${outstandingOnRow} <> 0`,
  );
}

/** Total outstanding on one side (receivable for "sale", payable for "purchase"). */
export async function outstandingTotal(db: Db, businessId: string, side: "sale" | "purchase", opts: { includeDrafts: boolean }) {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${outstandingOnRow}), 0)::text` })
    .from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(outstandingConditions(businessId, side, opts));
  return (row?.total ?? "0") as string;
}
