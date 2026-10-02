/**
 * invoice-to-ewb.ts — Map a Fintranzact invoice to NIC E-Way Bill generation payload.
 *
 * WHY THIS FILE EXISTS:
 * The NIC EWB API expects a very specific JSON shape with numeric codes (state
 * codes, transport mode codes, etc.) whereas Fintranzact stores human-readable text.
 * This module isolates that transformation so the router stays clean.
 *
 * Key mappings:
 *   - Invoice type  → supplyType ("O" outward / "I" inward)
 *   - Document type → docType    ("INV" / "CRN" / "DBN")
 *   - Transport mode string → NIC code ("1"=road, "2"=rail …)
 *   - GST tax percent → CGST/SGST/IGST split based on same-state vs inter-state
 *   - Monetary values: string → number (NIC API expects numeric JSON values)
 */

import { chargeSupplyOf, formatIstDate, isIntraStateSupply, money, splitIntraStateTax } from "@fintranzact/shared";
import type { GenerateEWBPayload, EWBItemPayload } from "./ewb-client.js";
import { transportModeCode } from "./ewb-client.js";

// ── Input types ───────────────────────────────────────────────────────────────

export interface InvoiceForEWB {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  type: "sale" | "purchase";
  documentType: string;
  subtotal: string;
  /** Document-level discount (reduces the taxable value). */
  discountAmount?: string | null;
  /** Charges billed with the supply (part of its value, taxed at the main rate). */
  additionalCharges?: string | null;
  taxAmount: string;
  /** TCS (s.206C) collected with the sale; reported as other value. */
  tcsAmount?: string | null;
  totalAmount: string;
  isReverseCharge: boolean;
  // Party
  partyGstin: string | null;
  partyName: string;
  partyAddress: string | null;
  partyCity: string | null;
  partyPincode: string | null;
  partyStateCode: string | null;
  // Business
  businessGstin: string | null;
  businessName: string;
  businessAddress: string | null;
  businessCity: string | null;
  businessPincode: string | null;
  businessStateCode: string | null;
}

export interface LineItemForEWB {
  /** Required snapshot of the item name (mapped to EWB productName/productDesc). */
  itemName: string;
  /** Optional free-text line notes — not used by EWB payload. */
  description: string | null;
  quantity: string;
  /** Free goods travel with the consignment, so they count in its quantity (not its value). */
  freeQuantity?: string | null;
  unitPrice: string;
  taxPercent: string;
  taxAmount: string;
  totalAmount: string;
  hsn: string | null;
  unit: string | null;
  itemType: "product" | "service" | null;
}

export interface TransportDetails {
  transporterId?: string;
  transporterName?: string;
  vehicleNumber: string;
  vehicleType: "regular" | "over_dimensional";
  transportMode: "road" | "rail" | "air" | "ship";
  distance: number;
  fromAddress?: string;
  fromPincode?: string;
  toAddress?: string;
  toPincode?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function docTypeCode(documentType: string, _invoiceType: "sale" | "purchase"): "INV" | "CRN" | "DBN" {
  switch (documentType) {
    case "credit_note":   return "CRN";
    case "debit_note":    return "DBN";
    default:              return "INV";
  }
}

/**
 * Format Date to DD/MM/YYYY as required by NIC — the calendar day in India,
 * whatever the server's timezone (midnight IST is the previous day in UTC).
 */
function formatNICDate(date: Date): string {
  return formatIstDate(date, "/");
}

/**
 * Split tax amount into CGST/SGST/IGST based on supply type.
 * Intra-state: CGST is half rounded to the paisa, SGST the rest (they add up
 * to the tax exactly). Inter-state: all IGST.
 */
function splitTax(
  taxAmount: number,
  interState: boolean,
): { cgst: number; sgst: number; igst: number } {
  if (interState) {
    return { cgst: 0, sgst: 0, igst: taxAmount };
  }
  return { ...splitIntraStateTax(taxAmount), igst: 0 };
}

/**
 * Split tax rate into CGST/SGST/IGST rates.
 */
function splitTaxRate(
  taxPercent: number,
  interState: boolean,
): { cgstRate: number; sgstRate: number; igstRate: number } {
  if (interState) {
    return { cgstRate: 0, sgstRate: 0, igstRate: taxPercent };
  }
  const half = taxPercent / 2;
  return { cgstRate: half, sgstRate: half, igstRate: 0 };
}

/**
 * Pad pincode to 6 digits or return 0 if missing.
 */
function parsePincode(pincode: string | null | undefined): number {
  if (!pincode) return 0;
  const n = parseInt(pincode, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse state code to number (NIC expects integer).
 */
function parseStateCode(code: string | null | undefined): number {
  if (!code) return 0;
  const n = parseInt(code, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Map item unit to NIC-recognised unit code.
 * NIC has ~40 units; we map our enum values to the closest NIC code.
 */
function mapUnit(unit: string | null): string {
  if (!unit) return "OTH";
  const map: Record<string, string> = {
    pcs: "NOS",
    kg:  "KGS",
    g:   "GMS",
    l:   "LTR",
    ml:  "MLT",
    m:   "MTR",
    cm:  "CMS",
    ft:  "FT",
    in:  "INH",
    box: "BOX",
    dozen: "DOZ",
    pair:  "PAR",
    set:   "SET",
    pkt:   "PKT",
    bag:   "BAG",
    ton:   "TNE",
    btl:   "BTL",
    bun:   "BDL",
    jar:   "JAR",
    pack:  "PAC",
    other: "OTH",
  };
  return map[unit] ?? "OTH";
}

// ── Main mapper ───────────────────────────────────────────────────────────────

/**
 * Map a Fintranzact invoice to the NIC EWB generation payload.
 *
 * @param invoice      - invoice header (type, numbers, dates, GSTIN, address)
 * @param lineItems    - invoice line items
 * @param transport    - transport details provided by user at EWB generation time
 */
export function mapInvoiceToEWB(
  invoice: InvoiceForEWB,
  lineItems: LineItemForEWB[],
  transport: TransportDetails,
): GenerateEWBPayload {
  const isSale = invoice.type === "sale";

  // Determine from/to parties based on supply direction
  const fromGstin = isSale ? (invoice.businessGstin ?? "URP") : (invoice.partyGstin ?? "URP");
  const fromName  = isSale ? invoice.businessName           : invoice.partyName;
  const fromAddr  = isSale
    ? (transport.fromAddress ?? invoice.businessAddress ?? "")
    : (transport.fromAddress ?? invoice.partyAddress ?? "");
  const fromCity  = isSale ? (invoice.businessCity ?? "") : (invoice.partyCity ?? "");
  const fromPin   = isSale
    ? parsePincode(transport.fromPincode ?? invoice.businessPincode)
    : parsePincode(transport.fromPincode ?? invoice.partyPincode);
  const fromState = isSale
    ? parseStateCode(invoice.businessStateCode)
    : parseStateCode(invoice.partyStateCode);

  const toGstin   = isSale ? (invoice.partyGstin ?? "URP")    : (invoice.businessGstin ?? "URP");
  const toName    = isSale ? invoice.partyName                 : invoice.businessName;
  const toAddr    = isSale
    ? (transport.toAddress ?? invoice.partyAddress ?? "")
    : (transport.toAddress ?? invoice.businessAddress ?? "");
  const toCity    = isSale ? (invoice.partyCity ?? "") : (invoice.businessCity ?? "");
  const toPin     = isSale
    ? parsePincode(transport.toPincode ?? invoice.partyPincode)
    : parsePincode(transport.toPincode ?? invoice.businessPincode);
  const toState   = isSale
    ? parseStateCode(invoice.partyStateCode)
    : parseStateCode(invoice.businessStateCode);

  // Inter-state detection — the shared place-of-supply rule: state codes (a
  // GSTIN's prefix counts); a party whose state is unknown is intra-state.
  const interState = !isIntraStateSupply(
    { stateCode: invoice.businessStateCode, gstin: invoice.businessGstin },
    { stateCode: invoice.partyStateCode, gstin: invoice.partyGstin },
  );

  // Aggregate tax values
  let totalTax = 0;
  const itemList: EWBItemPayload[] = lineItems.map((li) => {
    const taxPct   = parseFloat(li.taxPercent) || 0;
    const qty      = parseFloat(li.quantity) || 0;
    const taxAmt   = parseFloat(li.taxAmount) || 0;
    // Taxable value is the saved line total less its tax: after the line
    // discount and the line's share of the document discount.
    const taxable  = (parseFloat(li.totalAmount) || 0) - taxAmt;

    totalTax += taxAmt;

    const rates = splitTaxRate(taxPct, interState);

    return {
      // EWB payload needs a human-readable product name — use itemName
      // (required). productDesc historically mirrored productName in our
      // payload; keep that behaviour.
      productName: li.itemName.slice(0, 100),
      productDesc: li.itemName.slice(0, 100),
      hsnCode: li.hsn ?? "",
      quantity: qty + (parseFloat(li.freeQuantity ?? "0") || 0),
      qtyUnit: mapUnit(li.unit),
      cgstRate: rates.cgstRate,
      sgstRate: rates.sgstRate,
      igstRate: rates.igstRate,
      cessRate: 0,
      taxableAmount: Math.round(taxable * 100) / 100,
    };
  });

  // Charges billed with the goods are part of their value: one more item at
  // the principal line's rate and HSN (0% when untaxed).
  const charge = chargeSupplyOf(invoice, lineItems);
  const chargeValue = parseFloat(charge.taxableValue) || 0;
  if (chargeValue > 0 && lineItems.length > 0) {
    const principal = lineItems.reduce((a, b) => ((parseFloat(b.taxPercent) || 0) > (parseFloat(a.taxPercent) || 0) ? b : a));
    const rates = splitTaxRate(parseFloat(charge.rate) || 0, interState);
    totalTax += parseFloat(charge.taxAmount) || 0;
    itemList.push({
      productName: "Additional charges",
      productDesc: "Additional charges",
      hsnCode: principal.hsn ?? "",
      quantity: 0,
      qtyUnit: "OTH",
      cgstRate: rates.cgstRate,
      sgstRate: rates.sgstRate,
      igstRate: rates.igstRate,
      cessRate: 0,
      taxableAmount: Math.round(chargeValue * 100) / 100,
    });
  }

  const totalTaxRounded = Math.round(totalTax * 100) / 100;
  const taxSplit = splitTax(totalTaxRounded, interState);
  // Taxable value of the consignment: lines less the document discount, plus charges
  const totalValue = money.toNumber(
    money.add(money.sub(invoice.subtotal, invoice.discountAmount || "0"), invoice.additionalCharges || "0"),
  );

  return {
    supplyType:     isSale ? "O" : "I",
    subSupplyType:  "1", // 1 = Supply (default for regular invoices)
    docType:        docTypeCode(invoice.documentType, invoice.type),
    docNo:          invoice.invoiceNumber,
    docDate:        formatNICDate(invoice.invoiceDate),
    fromGstin,
    fromTrdName:    fromName.slice(0, 100),
    fromAddr1:      fromAddr.slice(0, 120),
    fromPlace:      fromCity.slice(0, 50),
    fromPincode:    fromPin,
    fromStateCode:  fromState,
    toGstin,
    toTrdName:      toName.slice(0, 100),
    toAddr1:        toAddr.slice(0, 120),
    toPlace:        toCity.slice(0, 50),
    toPincode:      toPin,
    toStateCode:    toState,
    totalValue:     Math.round(totalValue * 100) / 100,
    cgstValue:      taxSplit.cgst,
    sgstValue:      taxSplit.sgst,
    igstValue:      taxSplit.igst,
    cessValue:      0,
    ...(money.isPositive(invoice.tcsAmount || "0") ? { otherValue: money.toNumber(money.add(invoice.tcsAmount || "0", 0)) } : {}),
    transMode:      transportModeCode(transport.transportMode),
    transDistance:  transport.distance,
    transporterId:  transport.transporterId,
    transporterName: transport.transporterName,
    vehicleNo:      transport.vehicleNumber,
    vehicleType:    transport.vehicleType === "over_dimensional" ? "O" : "R",
    itemList,
  };
}
