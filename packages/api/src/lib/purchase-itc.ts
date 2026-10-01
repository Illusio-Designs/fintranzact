import { and, eq, inArray } from "drizzle-orm";
import { businesses, invoices, itcLedgerEntries, parties } from "@fintranzact/db";
import { isIntraStateSupply, istReturnPeriod, money, splitIntraStateTax } from "@fintranzact/shared";

/**
 * Keep a purchase invoice's live ITC entry equal to the invoice after an edit:
 * the claim is its tax, split CGST+SGST for a supplier in the business's
 * state and IGST otherwise, in the invoice's month. Mirrors the entry
 * invoice.create writes. Reversed/utilised entries are history and left alone.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncPurchaseItc(tx: any, businessId: string, invoiceId: string) {
  const [inv] = await tx.select({
    type: invoices.type,
    documentType: invoices.documentType,
    taxAmount: invoices.taxAmount,
    invoiceDate: invoices.invoiceDate,
    isReverseCharge: invoices.isReverseCharge,
    partyStateCode: parties.stateCode,
    partyState: parties.state,
    partyGstin: parties.gstin,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!inv || inv.type !== "purchase" || inv.documentType !== "invoice") return;

  const [biz] = await tx.select({
    gstRegistrationType: businesses.gstRegistrationType,
    stateCode: businesses.stateCode,
    state: businesses.state,
    gstin: businesses.gstin,
  }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (biz?.gstRegistrationType === "composition") return;

  // Same place-of-supply and CGST/SGST rules as invoice.create (shared).
  const sameState = isIntraStateSupply(biz ?? {}, { stateCode: inv.partyStateCode, state: inv.partyState, gstin: inv.partyGstin });
  const taxPaise = Math.round(parseFloat(inv.taxAmount) * 100);
  const intra = splitIntraStateTax(inv.taxAmount);
  const split = sameState
    ? { cgst: intra.cgst.toFixed(2), sgst: intra.sgst.toFixed(2), igst: "0" }
    : { cgst: "0", sgst: "0", igst: money.add(inv.taxAmount, 0) };
  const returnPeriod = istReturnPeriod(inv.invoiceDate);

  const live = await tx.update(itcLedgerEntries)
    .set({ ...split, returnPeriod, isReverseCharge: inv.isReverseCharge, updatedAt: new Date() })
    .where(and(
      eq(itcLedgerEntries.invoiceId, invoiceId),
      eq(itcLedgerEntries.businessId, businessId),
      inArray(itcLedgerEntries.status, ["available", "blocked"]),
    ))
    .returning({ id: itcLedgerEntries.id });
  if (live.length === 0 && taxPaise > 0) {
    await tx.insert(itcLedgerEntries).values({
      businessId, invoiceId, returnPeriod, status: "available", ...split, cess: "0", isReverseCharge: inv.isReverseCharge,
    });
  }
}
