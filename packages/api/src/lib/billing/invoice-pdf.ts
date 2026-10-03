/**
 * GST invoice from Finvera Solutions LLP for one subscription payment.
 *
 * Rendered on demand from a captured billing_payments row — the row IS the
 * invoice register (number, amounts, frozen customer details); this file only
 * draws it. Tax split: a customer GSTIN from the seller's own state gets
 * CGST + SGST, other states get IGST; a customer without a GSTIN is taxed by
 * its billing state (same rule), and by IGST when that is unknown too (see
 * billingPlaceOfSupply in @fintranzact/shared). Seller GSTIN / state come
 * from env so they can be set when registration lands.
 * Rates and the SAC code are to be verified with the CA before go-live.
 */

import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PLAN_GST_RATE_PERCENT, billingPlaceOfSupply, stateByCode } from "@fintranzact/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../../fonts/NotoSans-Bold.ttf");

// ── Seller (us) ────────────────────────────────────────────────────────────

export const BILLING_SELLER = {
  name: "Finvera Solutions LLP",
  product: "Fintranzact",
  // Set FINVERA_GSTIN once GST registration is done; invoices show
  // "Registration applied for" until then.
  gstin: () => process.env.FINVERA_GSTIN || null,
  /** First two digits of the seller's GSTIN state ("24" = Gujarat). */
  stateCode: () => process.env.FINVERA_STATE_CODE || "24",
  address: () => process.env.FINVERA_ADDRESS || "Ahmedabad, Gujarat, India",
  email: "billing@fintranzact.com",
  /** SAC for online software services — verify with the CA before go-live. */
  sac: "998315",
};

export interface BillingInvoiceData {
  invoiceNumber: string;
  date: Date;
  description: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  method: string | null;
  providerPaymentId: string | null;
  customer: {
    name: string;
    gstin: string | null;
    address: string | null;
    /** GST state code frozen with the payment (null = not given). */
    state?: string | null;
  };
  isCreditNote: boolean;
}

const fmtPaise = (paise: number) =>
  "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(paise) / 100);

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(d);

/**
 * CGST+SGST when the place of supply is the seller's state, IGST otherwise.
 * The customer's GSTIN decides when it has a valid one; else its billing
 * state; with neither (or an invalid GSTIN and no state) it is IGST.
 */
export function gstSplit(
  customer: { gstin?: string | null; state?: string | null },
  gstPaise: number,
  sellerStateCode: string = BILLING_SELLER.stateCode(),
): Array<{ label: string; paise: number }> {
  const intraState = billingPlaceOfSupply(customer, sellerStateCode).intraState;
  if (!intraState) return [{ label: `IGST (${PLAN_GST_RATE_PERCENT}%)`, paise: gstPaise }];
  const half = Math.floor(gstPaise / 2);
  return [
    { label: `CGST (${PLAN_GST_RATE_PERCENT / 2}%)`, paise: half },
    { label: `SGST (${PLAN_GST_RATE_PERCENT / 2}%)`, paise: gstPaise - half },
  ];
}

export function generateBillingInvoicePDF(data: BillingInvoiceData): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.registerFont("NotoSans", FONT_REGULAR);
    doc.registerFont("NotoSans-Bold", FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    doc.on("error", reject);

    const margin = 48;
    const pageW = 595.28;
    const contentW = pageW - margin * 2;
    const ink = "#1a1a2e";
    const muted = "#6b7280";
    const border = "#dee2e6";
    const accent = "#3b5eaa";
    let y = margin;

    // ── Header ──
    doc.font("NotoSans-Bold").fontSize(18).fillColor(ink).text(BILLING_SELLER.name, margin, y);
    doc.font("NotoSans").fontSize(9).fillColor(muted)
      .text(BILLING_SELLER.address(), margin, doc.y + 2)
      .text(`GSTIN: ${BILLING_SELLER.gstin() ?? "Registration applied for"}  ·  ${BILLING_SELLER.email}`, margin, doc.y + 2);

    doc.font("NotoSans-Bold").fontSize(13).fillColor(accent)
      .text(data.isCreditNote ? "CREDIT NOTE" : "TAX INVOICE", margin, margin, { width: contentW, align: "right" });
    doc.font("NotoSans").fontSize(9).fillColor(muted)
      .text(`No: ${data.invoiceNumber}`, margin, doc.y + 2, { width: contentW, align: "right" })
      .text(`Date: ${fmtDate(data.date)}`, margin, doc.y + 2, { width: contentW, align: "right" });

    y = Math.max(doc.y, 130) + 16;
    doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(border).lineWidth(1).stroke();
    y += 16;

    // ── Customer ──
    doc.font("NotoSans").fontSize(8).fillColor(muted).text(data.isCreditNote ? "ISSUED TO" : "BILLED TO", margin, y);
    doc.font("NotoSans-Bold").fontSize(11).fillColor(ink).text(data.customer.name, margin, doc.y + 3);
    doc.font("NotoSans").fontSize(9).fillColor(muted);
    if (data.customer.address) doc.text(data.customer.address, margin, doc.y + 2, { width: contentW * 0.6 });
    doc.text(`GSTIN: ${data.customer.gstin ?? "Unregistered"}`, margin, doc.y + 2);
    const supply = billingPlaceOfSupply(data.customer, BILLING_SELLER.stateCode());
    const supplyState = stateByCode(supply.stateCode);
    const supplyText = supplyState ? `${supplyState.name} (${supplyState.code})` : null;
    if (supplyText) doc.text(`State: ${supplyText}`, margin, doc.y + 2);
    doc.text(`Place of supply: ${supplyText ?? "Not specified (taxed as IGST)"}`, margin, doc.y + 2);
    y = doc.y + 20;

    // ── Line table ──
    const colDesc = margin;
    const colSac = margin + contentW * 0.55;
    const colAmt = margin + contentW * 0.75;
    doc.rect(margin, y, contentW, 22).fillColor("#f3f4f6").fill();
    doc.font("NotoSans-Bold").fontSize(8).fillColor(muted);
    doc.text("DESCRIPTION", colDesc + 8, y + 7);
    doc.text("SAC", colSac, y + 7);
    doc.text("AMOUNT", colAmt, y + 7, { width: contentW * 0.25 - 8, align: "right" });
    y += 22;

    const period =
      data.periodStart && data.periodEnd ? `\nPeriod: ${fmtDate(data.periodStart)} – ${fmtDate(data.periodEnd)}` : "";
    doc.font("NotoSans").fontSize(10).fillColor(ink);
    doc.text(`${BILLING_SELLER.product} — ${data.description}${period}`, colDesc + 8, y + 8, { width: contentW * 0.5 });
    const lineBottom = doc.y + 8;
    doc.text(BILLING_SELLER.sac, colSac, y + 8);
    doc.text(fmtPaise(data.basePaise), colAmt, y + 8, { width: contentW * 0.25 - 8, align: "right" });
    y = Math.max(lineBottom, y + 30);
    doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(border).stroke();
    y += 10;

    // ── Totals ──
    const totalsX = margin + contentW * 0.55;
    const totalsW = contentW * 0.45;
    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "NotoSans-Bold" : "NotoSans").fontSize(bold ? 11 : 9).fillColor(bold ? ink : muted);
      doc.text(label, totalsX, y, { width: totalsW * 0.6 });
      doc.text(value, totalsX + totalsW * 0.6, y, { width: totalsW * 0.4, align: "right" });
      y += bold ? 20 : 16;
    };
    totalRow("Taxable value", fmtPaise(data.basePaise));
    for (const part of gstSplit(data.customer, data.gstPaise)) totalRow(part.label, fmtPaise(part.paise));
    doc.moveTo(totalsX, y).lineTo(pageW - margin, y).strokeColor(border).stroke();
    y += 8;
    totalRow(data.isCreditNote ? "Total credit" : "Total", fmtPaise(data.totalPaise), true);

    // ── Payment reference ──
    y += 10;
    doc.font("NotoSans").fontSize(8).fillColor(muted);
    if (data.providerPaymentId) {
      doc.text(`Payment reference: ${data.providerPaymentId}`, margin, y);
      y = doc.y + 2;
    }
    if (data.method) {
      doc.text(`Paid by: ${data.method}`, margin, y);
      y = doc.y + 2;
    }

    // ── Footer ──
    doc.font("NotoSans").fontSize(7.5).fillColor(muted).text(
      "Computer-generated invoice; no signature required. Amounts are in Indian Rupees. " +
        "Questions? Write to " + BILLING_SELLER.email + ".",
      margin,
      770,
      { width: contentW, align: "center" },
    );

    doc.end();
  });
}
