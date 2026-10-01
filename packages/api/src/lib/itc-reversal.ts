import { and, eq } from "drizzle-orm";
import { businesses, invoices, itcLedgerEntries, parties } from "@fintranzact/db";
import { isIntraStateSupply, istReturnPeriod, splitIntraStateTax } from "@fintranzact/shared";
import { reducesBalance } from "./order-fulfilment.js";

/**
 * Splits a tax amount the way a purchase invoice's ITC entry does (shared
 * splitIntraStateTax): CGST and SGST halves within the state, else IGST.
 */
export function splitItc(taxAmount: string, sameState: boolean): { cgst: number; sgst: number; igst: number } {
  if (!sameState) return { cgst: 0, sgst: 0, igst: Math.round(parseFloat(taxAmount) * 100) / 100 };
  return { ...splitIntraStateTax(taxAmount), igst: 0 };
}

/**
 * Keeps the ITC ledger in step with a purchase-side document that takes ITC
 * back: the supplier's credit note, goods returned to the supplier, or our
 * debit note. While it stands it has one "available" entry with the negative
 * of its tax in its own return period, so the ITC dashboard and GSTR-3B table
 * 4(A)(5) are net of it — the same netting the GSTR-3B report does. Cancelled
 * or deleted, the entry goes. Anything else is left alone.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncReversingItc(tx: any, businessId: string, documentId: string): Promise<void> {
  const [doc] = await tx
    .select({
      id: invoices.id,
      type: invoices.type,
      documentType: invoices.documentType,
      status: invoices.status,
      deletedAt: invoices.deletedAt,
      taxAmount: invoices.taxAmount,
      invoiceDate: invoices.invoiceDate,
      isReverseCharge: invoices.isReverseCharge,
      partyStateCode: parties.stateCode,
      partyState: parties.state,
      partyGstin: parties.gstin,
    })
    .from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(eq(invoices.id, documentId), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!doc || doc.type !== "purchase" || !reducesBalance(doc.documentType, doc.type)) return;

  await tx
    .delete(itcLedgerEntries)
    .where(and(eq(itcLedgerEntries.businessId, businessId), eq(itcLedgerEntries.invoiceId, documentId)));
  if (doc.status === "cancelled" || doc.deletedAt || !(parseFloat(doc.taxAmount) > 0)) return;

  const [biz] = await tx
    .select({
      gstRegistrationType: businesses.gstRegistrationType,
      stateCode: businesses.stateCode,
      state: businesses.state,
      gstin: businesses.gstin,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  // A composition business takes no ITC, so has none to give back.
  if (!biz || biz.gstRegistrationType === "composition") return;

  // Same place-of-supply rule as the purchase invoice's own entry.
  const sameState = isIntraStateSupply(biz, { stateCode: doc.partyStateCode, state: doc.partyState, gstin: doc.partyGstin });
  const { cgst, sgst, igst } = splitItc(doc.taxAmount, sameState);
  const neg = (n: number) => (n === 0 ? "0" : (-n).toFixed(2));
  await tx.insert(itcLedgerEntries).values({
    businessId,
    invoiceId: documentId,
    returnPeriod: istReturnPeriod(doc.invoiceDate),
    status: "available",
    cgst: neg(cgst),
    sgst: neg(sgst),
    igst: neg(igst),
    cess: "0",
    isReverseCharge: doc.isReverseCharge ?? false,
    notes: `ITC taken back: ${doc.documentType.replace(/_/g, " ")}`,
  });
}
