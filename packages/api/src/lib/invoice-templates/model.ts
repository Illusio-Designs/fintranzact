/**
 * The numbers and words every invoice design prints, worked out once from
 * InvoicePDFData so all designs agree: per-line taxable value and tax heads,
 * rate-wise and HSN-wise summaries, round-off, grand total and amounts in
 * words (Indian lakh/crore system).
 *
 * Amounts are carried in paise (integers) and only formatted at the end.
 */
import { formatIstDate, splitIntraStateTax, chargeSupplyOf, copyLabel, isIntraStateSupply, type InvoiceCopy } from "@fintranzact/shared";
import type { InvoicePDFData } from "../invoice-pdf.js";

function isSameState(d: InvoicePDFData): boolean {
  return isIntraStateSupply(
    { stateCode: d.businessStateCode, state: d.businessState, gstin: d.businessGstin },
    { stateCode: d.partyStateCode, state: d.partyState, gstin: d.partyGstin },
  );
}

// ── Formatting ────────────────────────────────────────────────

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const paise = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** 1234567.5 → "12,34,567.50" (amounts in paise). */
export function inr(p: number): string {
  return INR.format(p / 100);
}

/** 1234567.5 → "₹12,34,567.50" (amounts in paise). */
export function rs(p: number): string {
  return (p < 0 ? "-₹" : "₹") + INR.format(Math.abs(p) / 100);
}

/** Quantity without trailing zeros, Indian grouping: "1,200", "2.5". */
export function qty(q: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(q);
}

/** A percentage without trailing zeros: 18 → "18", 2.5 → "2.5". */
export function pct(r: number): string {
  return String(Math.round(r * 100) / 100);
}

/** dd-mm-yyyy in India time; "" for missing dates. */
export function date(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "" : formatIstDate(t);
}

/** dd-mm-yyyy hh:mm in India time. */
export function dateTime(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  return `${formatIstDate(t)} ${time}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function two(n: number): string {
  return n < 20 ? ONES[n]! : TENS[Math.floor(n / 10)]! + (n % 10 ? " " + ONES[n % 10] : "");
}
function three(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return (h ? ONES[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
}

/** Whole number in words, Indian system: 1,23,45,678 → "One Crore Twenty Three Lakh …". */
export function indianWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(indianWords(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (th) parts.push(two(th) + " Thousand");
  if (n) parts.push(three(n));
  return parts.join(" ");
}

/** "INR Twelve Thousand Three Hundred and Fifty Paise Only" style, from paise. */
export function amountInWords(p: number, unit = "Rupees"): string {
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100), sub = abs % 100;
  return `${p < 0 ? "Minus " : ""}${unit} ${indianWords(whole)}${sub ? ` and ${two(sub)} Paise` : ""} Only`;
}

// ── Model ─────────────────────────────────────────────────────

export interface ModelLine {
  i: number;
  name: string;
  /** Free-text line notes (no batch / MRP / free qty — those have their own fields). */
  note: string;
  hsn: string;
  qty: number;
  unit: string;
  /** Rate per unit, paise. */
  rate: number;
  discPct: number;
  /** qty × rate, paise. */
  gross: number;
  /** Line discount, paise (gross − taxable, so it includes any share of a bill discount). */
  discAmt: number;
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  mrp: number | null;
  freeQty: number;
  batch: string;
  expiry: string;
  rejected: string;
}

export interface RateRow { rate: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number }
export interface HsnRow extends RateRow { hsn: string }

export interface PartyBlock {
  name: string;
  /** Address lines, already split for printing. */
  address: string[];
  gstin: string;
  state: string;
  stateCode: string;
  phone: string;
  email: string;
}

/** What kind of document this is, which decides the automatic layouts. */
export type DocKind = "tax_invoice" | "bill_of_supply" | "export" | "estimate" | "plain";

export interface InvoiceModel {
  data: InvoicePDFData;
  kind: DocKind;
  /** Heading as printed: "Tax Invoice", "Bill of Supply", "Credit Note", "Quotation"… */
  title: string;
  /** GST-registered supplier (regular or composition). */
  registered: boolean;
  /** CGST + SGST rather than IGST. */
  intra: boolean;
  services: boolean;
  seller: PartyBlock & { pan: string; legalName: string; city: string };
  buyer: PartyBlock;
  shipTo: { name: string; address: string[] } | null;
  /** "Gujarat (24)" */
  placeOfSupply: string;
  number: string;
  date: string;
  dueDate: string;
  lines: ModelLine[];
  qtyTotal: number;
  /** Sum of line values after line discounts, before any bill discount (paise). */
  subtotal: number;
  billDiscount: number;
  charges: number;
  chargeRate: number;
  chargeTax: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  /** TCS (s.206C) collected with the sale, included in grand (paise). */
  tcs: number;
  roundOff: number;
  grand: number;
  paid: number;
  balance: number;
  byRate: RateRow[];
  byHsn: HsnRow[];
  words: string;
  taxWords: string;
  /** Copy labels to print, one page set each ("" = no label). */
  copies: string[];
  hasTax: boolean;
  jurisdiction: string;
}

function splitAddress(...parts: Array<string | null | undefined>): string[] {
  return parts
    .flatMap((p) => (p ?? "").split(/\r?\n/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function titleFor(d: InvoicePDFData, kind: DocKind): string {
  switch (d.documentType) {
    case "quotation": return "Quotation";
    case "proforma": return "Proforma Invoice";
    case "credit_note": return "Credit Note";
    case "debit_note": return "Debit Note";
    case "delivery_challan": return "Delivery Challan";
    case "sales_return": return "Sales Return";
    case "purchase_return": return "Purchase Return";
    case "purchase_order": return "Purchase Order";
    case "sales_order": return "Sales Order";
    case "goods_receipt_note": return "Goods Receipt Note";
  }
  if (d.type === "purchase") return "Purchase Invoice";
  if (kind === "bill_of_supply") return "Bill of Supply";
  if (kind === "export") return "Export Invoice";
  if (kind === "plain") return "Invoice";
  return "Tax Invoice";
}

/** Which automatic layout a document gets, whatever design is chosen. */
export function docKindOf(d: InvoicePDFData): DocKind {
  const docType = d.documentType ?? "invoice";
  if (docType === "quotation" || docType === "proforma") return "estimate";
  const registered = d.gstRegistrationType === "regular" || d.gstRegistrationType === "composition";
  if (!registered) return "plain";
  if (d.type === "sale" && docType === "invoice") {
    if (d.gstRegistrationType === "composition") return "bill_of_supply";
    if (d.partyGstRegistrationType === "overseas" && !d.partyGstin) return "export";
  }
  return "tax_invoice";
}

export function buildModel(d: InvoicePDFData, copies: InvoiceCopy[] = [], defaultLabel = true): InvoiceModel {
  const kind = docKindOf(d);
  const registered = d.gstRegistrationType === "regular" || d.gstRegistrationType === "composition";
  const intra = kind === "export" ? false : isSameState(d);
  const services = !!d.isServices;

  const lines: ModelLine[] = d.lineItems.map((li, idx) => {
    const q = parseFloat(li.quantity) || 0;
    const rate = paise(li.unitPrice);
    const total = paise(li.totalAmount);
    const tax = paise(li.taxAmount);
    const taxable = total - tax;
    const gross = Math.round(q * rate);
    const gstRate = parseFloat(li.taxPercent) || 0;
    const split = intra ? splitIntraStateTax(tax / 100) : { cgst: 0, sgst: 0 };
    const [y, m] = (li.expiryDate ?? "").split("-");
    const rejectedQty = parseFloat(li.rejectedQuantity ?? "0") || 0;
    return {
      i: idx + 1,
      name: li.itemName,
      note: (li.description ?? "").trim(),
      hsn: d.lineItemHsn?.[idx] || "",
      qty: q,
      unit: li.unit ?? "",
      rate,
      discPct: parseFloat(li.discountPercent) || 0,
      gross,
      discAmt: Math.max(0, gross - taxable),
      taxable,
      gstRate,
      cgst: Math.round(split.cgst * 100),
      sgst: Math.round(split.sgst * 100),
      igst: intra ? 0 : tax,
      tax,
      total,
      mrp: li.mrp && parseFloat(li.mrp) > 0 ? paise(li.mrp) : null,
      freeQty: parseFloat(li.freeQuantity ?? "0") || 0,
      batch: li.batchNumber ?? "",
      expiry: y && m ? `${m}/${y}` : "",
      rejected: rejectedQty > 0
        ? `Rejected ${qty(rejectedQty)}${li.unit ? " " + li.unit : ""}${li.rejectionReason?.trim() ? ` (${li.rejectionReason.trim()})` : ""}`
        : "",
    };
  });

  // Charges billed with the supply are part of its value, at the main rate.
  const charge = chargeSupplyOf(d, d.lineItems);
  const charges = paise(charge.taxableValue);
  const chargeTax = paise(charge.taxAmount);
  const chargeRate = parseFloat(charge.rate) || 0;

  // Rate-wise summary; intra-state CGST/SGST split per rate (as the books do).
  const rateMap = new Map<number, { taxable: number; tax: number }>();
  const addRate = (r: number, taxable: number, tax: number) => {
    const e = rateMap.get(r) ?? { taxable: 0, tax: 0 };
    e.taxable += taxable; e.tax += tax; rateMap.set(r, e);
  };
  for (const l of lines) addRate(l.gstRate, l.taxable, l.tax);
  if (charges !== 0 || chargeTax !== 0) addRate(chargeRate, charges, chargeTax);
  const headsOf = (tax: number) => {
    if (!intra) return { cgst: 0, sgst: 0, igst: tax };
    const s = splitIntraStateTax(tax / 100);
    return { cgst: Math.round(s.cgst * 100), sgst: Math.round(s.sgst * 100), igst: 0 };
  };
  const byRate: RateRow[] = [...rateMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, e]) => ({ rate, taxable: e.taxable, tax: e.tax, ...headsOf(e.tax) }));

  const hsnMap = new Map<string, { hsn: string; rate: number; taxable: number; tax: number }>();
  for (const l of lines) {
    const key = `${l.hsn}|${l.gstRate}`;
    const e = hsnMap.get(key) ?? { hsn: l.hsn || "—", rate: l.gstRate, taxable: 0, tax: 0 };
    e.taxable += l.taxable; e.tax += l.tax; hsnMap.set(key, e);
  }
  if (charges !== 0 || chargeTax !== 0) hsnMap.set("charges", { hsn: "Charges", rate: chargeRate, taxable: charges, tax: chargeTax });
  const byHsn: HsnRow[] = [...hsnMap.values()].map((e) => ({ ...e, ...headsOf(e.tax) }));

  const taxable = lines.reduce((s, l) => s + l.taxable, 0) + charges;
  const tax = paise(d.taxAmount);
  const cgst = byRate.reduce((s, r) => s + r.cgst, 0);
  const sgst = byRate.reduce((s, r) => s + r.sgst, 0);
  const igst = intra ? 0 : tax;
  const grand = paise(d.totalAmount);
  const tcs = paise(d.tcsAmount ?? "0");
  const roundOff = d.roundOff !== undefined ? paise(d.roundOff) : grand - taxable - tax - tcs;
  const paid = paise(d.amountPaid);

  const sellerAddr = splitAddress(d.businessAddress, [d.businessCity, d.businessState, d.businessPincode].filter(Boolean).join(", "));
  const buyerAddr = splitAddress(d.partyBillingAddress, [d.partyCity, d.partyState, d.partyPincode].filter(Boolean).join(", "));
  const shipAddr = splitAddress(d.partyShippingAddress);
  const posState = d.partyState || d.businessState || "";
  const posCode = d.partyStateCode || (d.partyGstin ? d.partyGstin.slice(0, 2) : "") || d.businessStateCode || "";
  const placeOfSupply = kind === "export"
    ? "Outside India (96)"
    : [posState, posCode ? `(${posCode})` : ""].filter(Boolean).join(" ");

  const title = titleFor(d, kind);
  const labels = kind === "estimate"
    ? [""]
    : copies.length
      ? copies.map((c) => copyLabel(c, services)).filter((l): l is string => !!l)
      : [defaultLabel && (kind === "tax_invoice" || kind === "bill_of_supply" || kind === "export") ? "ORIGINAL FOR RECIPIENT" : ""];

  return {
    data: d,
    kind,
    title,
    registered,
    intra,
    services,
    seller: {
      name: d.businessName,
      legalName: d.businessLegalName || d.businessName,
      address: sellerAddr,
      gstin: registered ? d.businessGstin ?? "" : "",
      state: d.businessState ?? "",
      stateCode: d.businessStateCode ?? (d.businessGstin ? d.businessGstin.slice(0, 2) : ""),
      phone: d.businessPhone ?? "",
      email: d.businessEmail ?? "",
      pan: d.businessPan ?? "",
      city: d.businessCity ?? "",
    },
    buyer: {
      name: d.partyName,
      address: buyerAddr,
      gstin: d.partyGstin ?? "",
      state: d.partyState ?? "",
      stateCode: d.partyStateCode ?? (d.partyGstin ? d.partyGstin.slice(0, 2) : ""),
      phone: d.partyPhone ?? "",
      email: d.partyEmail ?? "",
    },
    shipTo: shipAddr.length ? { name: d.partyName, address: shipAddr } : null,
    placeOfSupply,
    number: d.invoiceNumber,
    date: date(d.invoiceDate),
    dueDate: date(d.dueDate),
    lines,
    qtyTotal: lines.reduce((s, l) => s + l.qty, 0),
    subtotal: paise(d.subtotal),
    billDiscount: paise(d.discountAmount),
    charges,
    chargeRate,
    chargeTax,
    taxable,
    cgst,
    sgst,
    igst,
    tax,
    tcs,
    roundOff,
    grand,
    paid,
    balance: Math.max(0, grand - paid),
    byRate,
    byHsn,
    words: amountInWords(grand),
    taxWords: amountInWords(tax),
    copies: labels.length ? labels : [""],
    hasTax: tax !== 0,
    jurisdiction: d.businessCity || d.businessState || "",
  };
}

/** Sub-line under an item name: notes, batch/expiry, MRP, free and rejected quantities. */
export function lineNote(l: ModelLine, skip: { batch?: boolean; mrp?: boolean; free?: boolean } = {}): string {
  const parts: string[] = [];
  if (l.note) parts.push(l.note);
  if (!skip.batch && l.batch) parts.push(`Batch ${l.batch}${l.expiry ? ` · Exp ${l.expiry}` : ""}`);
  if (!skip.mrp && l.mrp) parts.push(`MRP ${rs(l.mrp)}`);
  if (!skip.free && l.freeQty > 0) parts.push(`+ ${qty(l.freeQty)}${l.unit ? " " + l.unit : ""} free`);
  if (l.rejected) parts.push(l.rejected);
  return parts.join(" · ");
}

export function qtyUnit(l: ModelLine): string {
  return l.unit ? `${qty(l.qty)} ${l.unit}` : qty(l.qty);
}

/** "Road · GJ05 BX 4471" from the e-way bill. */
export function dispatchedThrough(d: InvoicePDFData): string {
  const e = d.eWayBill;
  if (!e) return "";
  const mode = transportModeName(e.transportMode);
  return [mode, e.vehicleNumber].filter(Boolean).join(" · ");
}

export function transportModeName(m?: string | null): string {
  switch ((m ?? "").toString()) {
    case "1": case "road": return "Road";
    case "2": case "rail": return "Rail";
    case "3": case "air": return "Air";
    case "4": case "ship": return "Ship";
    default: return m ? String(m) : "";
  }
}
