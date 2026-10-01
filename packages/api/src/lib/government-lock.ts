import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { ewayBills, invoices } from "@fintranzact/db";
import type { TenantDatabase } from "../trpc.js";

type Db = Pick<TenantDatabase, "select">;

/** Why a document is locked by a government filing, or null when it isn't. */
export type GovernmentLock = { kind: "e_invoice"; irn: string } | { kind: "eway_bill"; ewbNumber: string | null; ewayBillId: string };

/**
 * A document reported to the government (an e-invoice IRN or a live e-way
 * bill) can't be edited, deleted or cancelled in the books until that filing
 * is cancelled first; otherwise the books and the portal disagree.
 */
export async function getGovernmentLock(db: Db, businessId: string, documentId: string): Promise<GovernmentLock | null> {
  const [doc] = await db.select({ eInvoiceStatus: invoices.eInvoiceStatus, irn: invoices.irn })
    .from(invoices)
    .where(and(eq(invoices.id, documentId), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!doc) return null;
  if (doc.eInvoiceStatus === "generated" && doc.irn) return { kind: "e_invoice", irn: doc.irn };

  const [bill] = await db.select({ id: ewayBills.id, ewbNumber: ewayBills.ewbNumber })
    .from(ewayBills)
    .where(and(
      eq(ewayBills.businessId, businessId),
      eq(ewayBills.invoiceId, documentId),
      inArray(ewayBills.status, ["generated", "active"]),
    ))
    .limit(1);
  return bill ? { kind: "eway_bill", ewbNumber: bill.ewbNumber, ewayBillId: bill.id } : null;
}

export async function assertNotLockedByGovernment(
  db: Db,
  businessId: string,
  documentId: string,
  action: "edit" | "delete" | "cancel",
): Promise<void> {
  const lock = await getGovernmentLock(db, businessId, documentId);
  if (!lock) return;
  const message = lock.kind === "e_invoice"
    ? `This invoice has an e-invoice (IRN). Cancel the e-invoice first, then ${action} it.`
    : `This document has an active e-way bill${lock.ewbNumber ? ` (${lock.ewbNumber})` : ""}. Cancel the e-way bill first, then ${action} it.`;
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
