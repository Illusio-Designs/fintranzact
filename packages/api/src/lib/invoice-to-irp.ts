/**
 * invoice-to-irp.ts — Transform Fintranzact invoice to IRP JSON Schema v1.1.
 *
 * WHY THIS FILE EXISTS:
 * The NIC IRP has a specific JSON schema that differs from Fintranzact's internal
 * data model. This module handles all field mapping, UQC code translation,
 * GST split (CGST/SGST for intra-state, IGST for inter-state), and
 * document type mapping (invoice → INV, credit_note → CRN, debit_note → DBN).
 *
 * Money: all internal amounts are strings (NUMERIC(15,2)), IRP requires numbers.
 * We parse only at the boundary here — never accumulate JS floats.
 */

import {
  calcLineItem, chargeSupplyOf, formatIstDate, gstStateCode, gstUqcForUnit, placeOfSupplyCode, splitIntraStateTax,
} from "@fintranzact/shared";
import type { IRPInvoiceJson } from "./irp-client.js";

// ── Types (subset of what we need from DB rows) ────────────────────────────────

export interface IRPBusiness {
  gstin: string | null;
  legalName: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export interface IRPParty {
  gstin: string | null;
  name: string;
  billingAddress: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  /**
   * parties.gst_registration_type — regular | composition | unregistered |
   * sez | overseas | uin. Only "sez" and "overseas" change the supply type;
   * everything else is an ordinary B2B supply.
   */
  gstRegistrationType?: string | null;
}

export interface IRPInvoice {
  invoiceNumber: string;
  invoiceDate: Date;
  type: string; // "sale" | "purchase"
  documentType: string; // "invoice" | "credit_note" | "debit_note" etc.
  subtotal: string;
  taxAmount: string;
  discountAmount: string | null;
  additionalCharges: string | null;
  roundOff: string | null;
  /** TCS (s.206C) collected with the sale; part of the total, reported as other charges. */
  tcsAmount?: string | null;
  totalAmount: string;
  isReverseCharge: boolean;
}

export interface IRPLineItem {
  /** Required snapshot of the item name at billing time. */
  itemName: string;
  /** Optional free-text line notes (from invoice_items.description). */
  description: string | null;
  quantity: string;
  /** Free goods on the line ("10 + 1"): reported as FreeQty, no value. */
  freeQuantity?: string | null;
  unitPrice: string;
  taxPercent: string;
  taxAmount: string;
  discountPercent: string;
  totalAmount: string;
  selectedUnit: string | null;
  itemType?: string | null; // "product" | "service"
  itemHsn?: string | null;
}

// ── UQC mapping (Fintranzact unit → IRP UQC code) ─────────────────────────────────
// Reference: https://einvoice1.gst.gov.in/Others/MasterCodes — the same UQC
// master as the GSTR-1 HSN summary, so both use the shared mapping.

function toUQC(unit: string | null | undefined): string {
  return gstUqcForUnit(unit, "OTH");
}

// ── Document type mapping ──────────────────────────────────────────────────────

function toIRPDocType(documentType: string): string {
  switch (documentType) {
    case "credit_note":
    case "sales_return":
      return "CRN";
    case "debit_note":
    case "purchase_return":
      return "DBN";
    default:
      return "INV";
  }
}

// ── Date formatting ────────────────────────────────────────────────────────────

function toIRPDate(date: Date): string {
  // IRP requires DD/MM/YYYY — the calendar day in India, whatever the
  // server's timezone (midnight IST is the previous day in UTC)
  return formatIstDate(date, "/");
}

// ── Number helpers ─────────────────────────────────────────────────────────────

function n(s: string | null | undefined): number {
  if (!s) return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : Math.round(v * 100) / 100;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── Main mapping function ──────────────────────────────────────────────────────

/**
 * Map a Fintranzact invoice to the NIC IRP JSON Schema v1.1.
 *
 * @param invoice   - Invoice row from DB
 * @param lineItems - Invoice line items
 * @param party     - Customer/supplier party
 * @param business  - Seller business (must have GSTIN)
 */
export function mapInvoiceToIRP(
  invoice: IRPInvoice,
  lineItems: IRPLineItem[],
  party: IRPParty,
  business: IRPBusiness,
): IRPInvoiceJson {
  if (!business.gstin) {
    throw new Error("Business GSTIN is required for e-invoicing");
  }
  const regType = party.gstRegistrationType?.toLowerCase() ?? null;
  // An export is a supply to a recipient without an Indian GSTIN. A party
  // typed "overseas" that does hold one (the GSTIN lookup maps IRP taxpayer
  // type NRT, a non-resident taxable person registered here, to "overseas")
  // is an ordinary registered buyer: B2B, taxed by its state.
  const isExport = regType === "overseas" && !party.gstin;
  const isSez = regType === "sez";

  if (!party.gstin && !isExport) {
    throw new Error("Party GSTIN is required for e-invoicing (B2B only)");
  }

  const sellerStateCode = gstStateCode(business) ?? "00";
  // Place of supply: the buyer's state code, else its GSTIN's prefix, else —
  // state unknown — the seller's own (the shared place-of-supply rule).
  // Exports use "96" (Other Country).
  const buyerStateCode = isExport
    ? "96"
    : placeOfSupplyCode(business, party) ?? sellerStateCode;
  // Supplies to SEZ units and exports are zero-rated inter-state supplies
  // (IGST Act s.16) — IGST applies even when the SEZ is in the seller's state.
  const isInterState = isExport || isSez || sellerStateCode !== buyerStateCode;

  // Inter-state is NOT an export: an ordinary registered buyer in another
  // state is still B2B (with IGST). Only SEZ / overseas buyers get the
  // SEZ*/EXP* supply types, "with payment" when IGST is actually charged.
  const chargesTax = lineItems.some((li) => n(li.taxPercent) > 0);
  const supplyType = isExport
    ? chargesTax ? "EXPWP" : "EXPWOP"
    : isSez
      ? chargesTax ? "SEZWP" : "SEZWOP"
      : "B2B";

  const heads = (tax: number) =>
    isInterState ? { IgstAmt: tax, CgstAmt: 0, SgstAmt: 0 } : (() => {
      const { cgst, sgst } = splitIntraStateTax(tax);
      return { IgstAmt: 0, CgstAmt: cgst, SgstAmt: sgst };
    })();

  // Map line items. Each line's saved tax and total already carry its share
  // of the document discount, so AssAmt is the saved taxable value and the
  // item Discount is the line discount plus that share (TotAmt − AssAmt).
  const itemList = lineItems.map((li, idx) => {
    const qty = n(li.quantity);
    const unitPrice = n(li.unitPrice);
    const taxPct = n(li.taxPercent);

    // Gross in the invoice's own paise maths (float qty × price rounded
    // differently: 1.5 × 10.03 → 15.04, the invoice has 15.05).
    const grossAmt = n(calcLineItem({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent || "0",
      discountPercent: li.discountPercent || "0",
    }).subtotal);
    const totalTax = n(li.taxAmount);
    const assAmt = round2(n(li.totalAmount) - totalTax);
    const discAmt = round2(grossAmt - assAmt);

    return {
      SlNo: String(idx + 1),
      // IRP PrdDesc is the product-line display — use itemName (required
      // snapshot). The free-text notes field is intentionally NOT included
      // here, as IRP's PrdDesc is meant to identify the product, not capture
      // per-line comments.
      PrdDesc: li.itemName.slice(0, 300),
      IsServc: li.itemType === "service" ? "Y" : "N",
      HsnCd: li.itemHsn ?? "9999",
      Qty: qty,
      FreeQty: n(li.freeQuantity ?? "0"),
      Unit: toUQC(li.selectedUnit),
      UnitPrice: unitPrice,
      TotAmt: grossAmt,
      Discount: discAmt,
      AssAmt: assAmt,
      GstRt: taxPct,
      ...heads(totalTax),
      TotItemVal: round2(assAmt + totalTax),
    };
  });

  // Charges billed with the supply (freight, packing…) are part of its value
  // and taxed at the principal supply's rate. NIC wants taxable charges as an
  // item (in AssAmt), not in OthChrg, so they go in as a line under the
  // principal line's HSN; untaxed charges (a nil/exempt-only invoice, or one
  // saved before charges were taxed) stay in OthChrg.
  const charge = chargeSupplyOf(invoice, lineItems);
  const chargeValue = n(charge.taxableValue);
  const chargeTaxAmt = n(charge.taxAmount);
  let othChrg = chargeValue;
  if (chargeValue > 0 && chargeTaxAmt !== 0 && lineItems.length > 0) {
    const principal = lineItems.reduce((a, b) => (n(b.taxPercent) > n(a.taxPercent) ? b : a));
    itemList.push({
      SlNo: String(itemList.length + 1),
      PrdDesc: "Additional charges",
      IsServc: principal.itemType === "service" ? "Y" : "N",
      HsnCd: principal.itemHsn ?? "9999",
      Qty: 1,
      FreeQty: 0,
      Unit: "OTH",
      UnitPrice: chargeValue,
      TotAmt: chargeValue,
      Discount: 0,
      AssAmt: chargeValue,
      GstRt: n(charge.rate),
      ...heads(chargeTaxAmt),
      TotItemVal: round2(chargeValue + chargeTaxAmt),
    });
    othChrg = 0;
  }

  // TCS is collected on top of the goods and GST: the IRP wants it as other charges so the
  // invoice value still adds up.
  othChrg = round2(othChrg + n(invoice.tcsAmount));

  // Aggregate ValDtls from itemList (sum of individual items)
  const assVal = round2(itemList.reduce((sum, item) => sum + item.AssAmt, 0));
  const cgstVal = round2(itemList.reduce((sum, item) => sum + item.CgstAmt, 0));
  const sgstVal = round2(itemList.reduce((sum, item) => sum + item.SgstAmt, 0));
  const igstVal = round2(itemList.reduce((sum, item) => sum + item.IgstAmt, 0));
  // The document discount is already out of each item's AssAmt (it reduces
  // the taxable value), so ValDtls.Discount stays 0 — counting it here too
  // would take it off twice.
  const invoiceDiscount = 0;
  const rndOffAmt = n(invoice.roundOff);
  const totInvVal = n(invoice.totalAmount);

  const sellerPin = parseInt(business.pincode ?? "000000", 10);
  const buyerPin = parseInt(party.pincode ?? "000000", 10);

  return {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: supplyType,
      RegRev: invoice.isReverseCharge ? "Y" : "N",
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: toIRPDocType(invoice.documentType),
      No: invoice.invoiceNumber,
      Dt: toIRPDate(invoice.invoiceDate),
    },
    SellerDtls: {
      Gstin: business.gstin,
      LglNm: (business.legalName ?? business.name).slice(0, 100),
      TrdNm: business.name.slice(0, 100),
      Addr1: (business.address ?? "").slice(0, 100),
      Loc: (business.city ?? business.state ?? "").slice(0, 50),
      Pin: isNaN(sellerPin) ? 0 : sellerPin,
      Stcd: sellerStateCode,
      Ph: business.phone ?? undefined,
      Em: business.email ?? undefined,
    },
    BuyerDtls: {
      // Unregistered overseas recipients are reported as "URP".
      Gstin: party.gstin ?? "URP",
      LglNm: party.name.slice(0, 100),
      TrdNm: party.name.slice(0, 100),
      Pos: buyerStateCode,
      Addr1: (party.billingAddress ?? "").slice(0, 100),
      Loc: (party.city ?? party.state ?? "").slice(0, 50),
      Pin: isExport ? 999999 : isNaN(buyerPin) ? 0 : buyerPin,
      Stcd: buyerStateCode,
      Ph: party.phone ?? undefined,
      Em: party.email ?? undefined,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: assVal,
      CgstVal: cgstVal,
      SgstVal: sgstVal,
      IgstVal: igstVal,
      Discount: invoiceDiscount,
      OthChrg: othChrg > 0 ? othChrg : undefined,
      RndOffAmt: rndOffAmt !== 0 ? rndOffAmt : undefined,
      TotInvVal: totInvVal,
    },
  };
}
