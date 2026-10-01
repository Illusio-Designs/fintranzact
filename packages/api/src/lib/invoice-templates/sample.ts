/**
 * A realistic sample invoice for the design picker's "Preview PDF" (and the
 * tests): the gallery's electricals wholesaler billing a Surat customer.
 * The business's own name, address, GSTIN, logo, signature and bank details
 * replace the sample seller's when given.
 */
import QRCode from "qrcode";
import { calcLineItem, money } from "@fintranzact/shared";
import type { InvoicePDFData } from "../invoice-pdf.js";

type Line = { name: string; hsn: string; q: number; unit: string; rate: number; disc: number; gst: number; batch?: string; exp?: string; mrp?: number; note?: string };

export const SAMPLE_LINES: Line[] = [
  { name: "LED Bulb 9W Cool Daylight (B22)", hsn: "8539", q: 200, unit: "NOS", rate: 85, disc: 0, gst: 18, batch: "LB2609", mrp: 140 },
  { name: "PVC Insulated Wire 1.5 sq mm, 90 m coil", hsn: "8544", q: 25, unit: "NOS", rate: 1150, disc: 5, gst: 18, batch: "WR0926", mrp: 1690 },
  { name: "MCB 32A Double Pole C-Curve", hsn: "8536", q: 40, unit: "NOS", rate: 410, disc: 0, gst: 18, batch: "MC2608", mrp: 620 },
  { name: "Solar LED Lantern with USB charging", hsn: "8513", q: 12, unit: "NOS", rate: 640, disc: 0, gst: 5, batch: "SL2607", exp: "2028-07-31", mrp: 899 },
];

export interface SampleOptions {
  /** Buyer in another state (IGST). Default: same state (CGST + SGST). */
  interState?: boolean;
  /** Repeat the sample lines up to this many lines. */
  lines?: number;
  withIrn?: boolean;
  withEwayBill?: boolean;
  withUpi?: boolean;
  gstRegistrationType?: InvoicePDFData["gstRegistrationType"];
  documentType?: string;
  export?: boolean;
  services?: boolean;
}

/** Synchronous part: everything except QR images. */
export function sampleInvoiceData(o: SampleOptions = {}, base: Partial<InvoicePDFData> = {}): InvoicePDFData {
  const intra = !o.interState && !o.export;
  const src: Line[] = o.services
    ? [
        { name: "GST return filing (GSTR-1, GSTR-3B) — Jul–Sep 2026", hsn: "998231", q: 1, unit: "QTR", rate: 9000, disc: 0, gst: 18 },
        { name: "Bookkeeping and monthly MIS — Sep 2026", hsn: "998222", q: 1, unit: "MON", rate: 12000, disc: 0, gst: 18 },
        { name: "Advisory call: e-invoicing readiness", hsn: "998231", q: 3, unit: "HRS", rate: 2500, disc: 0, gst: 18 },
      ]
    : SAMPLE_LINES;
  const n = o.lines ?? src.length;
  const composition = o.gstRegistrationType === "composition";
  const lines = Array.from({ length: n }, (_, i) => {
    const s = src[i % src.length]!;
    const name = i < src.length ? s.name : `${s.name} — lot ${Math.floor(i / src.length) + 1}`;
    const rate = composition ? 0 : o.export ? 0 : s.gst;
    const r = calcLineItem({ quantity: String(s.q), unitPrice: String(s.rate), taxPercent: String(rate), discountPercent: String(s.disc), intraState: intra });
    return {
      itemName: name,
      description: s.note ?? null,
      quantity: String(s.q),
      unit: s.unit,
      unitPrice: money.add(s.rate, 0),
      mrp: s.mrp ? money.add(s.mrp, 0) : null,
      batchNumber: s.batch ?? null,
      expiryDate: s.exp ?? null,
      taxPercent: String(rate),
      taxAmount: r.taxAmount,
      discountPercent: String(s.disc),
      totalAmount: r.total,
      hsn: s.hsn,
    };
  });
  const subtotal = money.sum(lines.map((l) => money.sub(l.totalAmount, l.taxAmount)));
  const tax = money.sum(lines.map((l) => l.taxAmount));
  const exact = money.add(subtotal, tax);
  const grand = String(Math.round(parseFloat(exact)));
  const roundOff = money.sub(grand, exact);

  const data: InvoicePDFData = {
    businessName: "Shree Ganesh Electricals",
    businessLegalName: "Shree Ganesh Electricals LLP",
    businessGstin: "24AAKFS4821M1Z3",
    businessPan: "AAKFS4821M",
    businessPhone: "+91 98250 41177",
    businessEmail: "accounts@ganeshelectricals.in",
    businessAddress: "14, Sardar Patel Market, Relief Road",
    businessCity: "Ahmedabad",
    businessState: "Gujarat",
    businessPincode: "380001",
    businessStateCode: "24",
    businessLutArn: o.export ? "AD240326009871P" : undefined,
    businessIecCode: o.export ? "AAKFS4821M" : undefined,
    partyName: o.export ? "Harbor Supply LLC" : o.interState ? "Bengaluru Power Traders" : "Patel Power Solutions",
    partyGstin: o.export ? undefined : o.interState ? "29AABCB7781K1Z5" : "24AAJFP7788L1Z9",
    partyBillingAddress: o.export ? "Jebel Ali Free Zone, Dubai" : o.interState ? "22 Residency Road" : "Shop 7, Ring Road, Udhna",
    partyCity: o.export ? undefined : o.interState ? "Bengaluru" : "Surat",
    partyState: o.export ? "United Arab Emirates" : o.interState ? "Karnataka" : "Gujarat",
    partyStateCode: o.export ? undefined : o.interState ? "29" : "24",
    partyPincode: o.export ? undefined : o.interState ? "560025" : "394210",
    partyShippingAddress: o.export ? undefined : o.interState ? undefined : "Plot 22, GIDC Sachin, Surat, Gujarat 394230",
    partyGstRegistrationType: o.export ? "overseas" : "regular",
    partyPhone: "+91 98980 22110",
    invoiceNumber: o.documentType === "quotation" ? "QT/26-27/052" : "GE/25-26/0418",
    invoiceDate: "2026-10-01T06:12:00.000Z",
    dueDate: "2026-10-31T00:00:00.000Z",
    type: "sale",
    documentType: o.documentType ?? "invoice",
    lineItems: lines.map(({ hsn: _hsn, ...l }) => l),
    lineItemHsn: lines.map((l) => l.hsn),
    subtotal,
    taxAmount: tax,
    discountAmount: "0.00",
    additionalCharges: "0.00",
    roundOff,
    totalAmount: grand,
    amountPaid: "0.00",
    termsAndConditions: "Payment within 30 days. Goods once sold will be taken back only if defective.",
    bankName: "HDFC Bank",
    bankAccountNumber: "50200041872213",
    bankIfsc: "HDFC0000132",
    bankAccountName: "Shree Ganesh Electricals LLP",
    upiId: o.withUpi === false ? undefined : "ganeshelec@hdfcbank",
    gstRegistrationType: o.gstRegistrationType ?? "regular",
    isServices: !!o.services,
    isPaidPlan: true,
    status: "sent",
    ...(o.withEwayBill
      ? { eWayBill: { number: "181744026633", date: "2026-10-01T06:30:00.000Z", validUpto: "2026-10-02T18:29:00.000Z", vehicleNumber: "GJ05BX4471", transportMode: "road", distance: 265 } }
      : {}),
    ...(o.withIrn
      ? { eInvoice: { irn: "8f3c1e2a7d65b0c4e91a2f3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c9b04d7", ackNumber: "152625318840217", ackDate: "2026-10-01T06:12:00.000Z" } }
      : {}),
    ...base,
  };
  return data;
}

/** Adds the UPI and e-invoice QR images (async: QR rendering). */
export async function withSampleQrs(d: InvoicePDFData): Promise<InvoicePDFData> {
  const out = { ...d };
  if (d.upiId && !d.upiQrDataUrl) {
    out.upiQrDataUrl = await QRCode.toDataURL(`upi://pay?pa=${encodeURIComponent(d.upiId)}&pn=${encodeURIComponent(d.businessName)}&am=${d.totalAmount}&cu=INR`, { width: 200, margin: 1 });
  }
  if (d.eInvoice && !d.eInvoice.qrDataUrl) {
    out.eInvoice = { ...d.eInvoice, qrDataUrl: await QRCode.toDataURL(`IRN:${d.eInvoice.irn}`, { width: 200, margin: 1 }) };
  }
  return out;
}
