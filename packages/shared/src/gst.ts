import { istStartOfDay } from "./dates.js";

/**
 * GST place-of-supply rules shared by the ledger, GST returns, printed
 * invoices, e-invoices and e-way bills, so a supply is intra- or inter-state
 * the same way everywhere.
 */

export interface GstStateParty {
  stateCode?: string | null;
  state?: string | null;
  gstin?: string | null;
}

/** 2-digit GST state code: the saved code, else the GSTIN's prefix, else null. */
export function gstStateCode(p: GstStateParty): string | null {
  const code = p.stateCode?.trim();
  if (code) return code;
  const prefix = p.gstin?.trim().slice(0, 2);
  return prefix && /^\d{2}$/.test(prefix) ? prefix : null;
}

/**
 * Whether a supply is intra-state (CGST + SGST) rather than inter-state
 * (IGST). State codes decide when both sides have one (a GSTIN's prefix
 * counts); otherwise state names, compared case-insensitively. When the
 * buyer's state is not known (a walk-in customer with no state and no GSTIN)
 * the place of supply is the supplier's own location, so it is intra-state.
 */
export function isIntraStateSupply(seller: GstStateParty, buyer: GstStateParty): boolean {
  const sellerCode = gstStateCode(seller);
  const buyerCode = gstStateCode(buyer);
  if (sellerCode && buyerCode) return sellerCode === buyerCode;
  const sellerState = seller.state?.trim();
  const buyerState = buyer.state?.trim();
  if (sellerState && buyerState) return sellerState.toLowerCase() === buyerState.toLowerCase();
  return true;
}

/**
 * Place-of-supply state code for a domestic supply: the buyer's state code
 * (or GSTIN prefix), else — buyer's state unknown — the seller's own.
 */
export function placeOfSupplyCode(seller: GstStateParty, buyer: GstStateParty): string | null {
  return gstStateCode(buyer) ?? gstStateCode(seller);
}

/**
 * Split an intra-state tax amount into CGST and SGST: CGST is half, rounded
 * to the paisa (half up); SGST is the rest, so the two always add up to the
 * tax exactly. Documents saved since intra-state tax is taken as two halves
 * rounded on their own (calc.ts taxOn) carry an even number of paise, so
 * they split equally; an odd paisa only shows on older documents.
 */
export function splitIntraStateTax(tax: number | string): { cgst: number; sgst: number } {
  const p = Math.round(Number(tax || 0) * 100);
  const c = Math.round(p / 2);
  return { cgst: c / 100, sgst: (p - c) / 100 };
}

/**
 * Invoice value above which an inter-state supply to an unregistered person
 * is reported invoice-wise in B2CL (and its credit/debit notes in CDNUR)
 * rather than netted in B2CS. Notification 12/2024-Central Tax lowered it
 * from ₹2,50,000 to ₹1,00,000 for invoices dated on or after 1 Aug 2024.
 */
export const B2CL_INVOICE_THRESHOLD = 100000;
/** The B2CL limit for invoices dated before 1 Aug 2024. */
export const B2CL_INVOICE_THRESHOLD_BEFORE_AUG_2024 = 250000;
/** 1 Aug 2024, 00:00 IST — the day the lower B2CL limit applies from. */
const B2CL_THRESHOLD_CHANGE = istStartOfDay(2024, 8, 1).getTime();

/** The B2CL invoice-value limit for an invoice dated `invoiceDate`. */
export function b2clThresholdFor(invoiceDate: Date): number {
  return invoiceDate.getTime() >= B2CL_THRESHOLD_CHANGE
    ? B2CL_INVOICE_THRESHOLD
    : B2CL_INVOICE_THRESHOLD_BEFORE_AUG_2024;
}

export type Gstr1Section = "b2b" | "b2cLarge" | "b2cSmall";

/**
 * GSTR-1 section of an outward invoice: B2B when the buyer has a GSTIN;
 * B2CL when unregistered, inter-state and above the B2CL limit; else B2CS.
 */
export function gstr1Section(input: {
  partyGstin: string | null | undefined;
  intraState: boolean;
  invoiceValue: number;
  invoiceDate: Date;
}): Gstr1Section {
  if (input.partyGstin) return "b2b";
  if (!input.intraState && input.invoiceValue > b2clThresholdFor(input.invoiceDate)) return "b2cLarge";
  return "b2cSmall";
}
