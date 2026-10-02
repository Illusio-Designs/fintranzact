/**
 * POS thermal receipts on 58 mm and 80 mm rolls, laid out like the gallery's
 * thermal designs: black only, about 32 / 48 characters a line, a
 * double-height shop name and total, dashed separators, long item names on
 * their own line, a rate-wise tax table and the UPI QR.
 *
 * The page is exactly as long as the receipt: it is laid out once on a
 * scratch document to measure it, then drawn for real.
 */
import PDFDocument from "pdfkit";
import type { ThermalWidth } from "@fintranzact/shared";
import type { InvoicePDFData } from "../invoice-pdf.js";
import { image, line, registerFonts, text, type Doc } from "./engine.js";
import { buildModel, dateTime, inr, pct, qty, rs, lineNote, type InvoiceModel } from "./model.js";
import { ewbLine } from "./pieces.js";
import { COMPOSITION_NOTICE } from "./notices.js";

const MM = 72 / 25.4;

interface Geo { W: number; x0: number; x1: number; cw: number; size: number; big: number; small: number; wide: boolean }

function geometry(width: ThermalWidth): Geo {
  const W = width * MM;
  const margin = width === 58 ? 6 : 8;
  // 8 pt Noto Sans averages ~4.4 pt a character: ~34 a line on 58 mm, ~48 on 80 mm.
  return { W, x0: margin, x1: W - margin, cw: W - 2 * margin, size: 8, big: 12.4, small: 7, wide: width === 80 };
}

function draw(doc: Doc, m: InvoiceModel, g: Geo, y: number): number {
  const d = m.data;
  const { x0, x1, cw } = g;
  const C = (s: string, o: { size?: number; bold?: boolean } = {}) => {
    y += text(doc, s, x0, y, { w: cw, size: o.size ?? g.size, bold: o.bold, align: "center", color: "#000000" });
  };
  const LR = (l: string, r: string, o: { size?: number; bold?: boolean; indent?: number } = {}) => {
    const size = o.size ?? g.size;
    const rw = Math.min(cw * 0.62, doc.font(o.bold ? "NotoSans-Bold" : "NotoSans").fontSize(size).widthOfString(r) + 2);
    const lh = text(doc, l, x0 + (o.indent ?? 0), y, { w: cw - rw - 4 - (o.indent ?? 0), size, bold: o.bold, color: "#000000" });
    const rh = text(doc, r, x1 - rw, y, { w: rw, size, bold: o.bold, align: "right", color: "#000000" });
    y += Math.max(lh, rh);
  };
  const hr = () => {
    y += 2;
    line(doc, x0, y, x1, y, "#111111", 0.6, [2, 1.6]);
    y += 4;
  };

  // ── Header ────────────────────────────────────────────────
  const logoW = g.wide ? 120 : 90;
  const logoH = g.wide ? 40 : 30;
  if (image(doc, d.logoBuffer, x0 + (cw - logoW) / 2, y, logoW, logoH, "center")) y += logoH + 4;
  C(m.seller.name.toUpperCase(), { size: g.big, bold: true });
  for (const l of m.seller.address) C(l, { size: g.small });
  if (m.seller.phone) C(`Ph ${m.seller.phone}`, { size: g.small });
  if (m.seller.gstin) C(`GSTIN ${m.seller.gstin}`, { size: g.small });
  y += 1;
  C(m.title.toUpperCase(), { bold: true });
  if (m.kind === "bill_of_supply") C(COMPOSITION_NOTICE, { size: g.small - 0.5 });
  if (m.kind === "estimate") C("Not a tax invoice", { size: g.small });
  hr();
  LR(`Bill: ${m.number}`, dateTime(d.invoiceDate));
  const status = d.status === "paid" ? "Paid" : m.paid > 0 ? "Part paid" : "";
  LR(`To: ${m.buyer.name}`, status);
  if (m.buyer.gstin) LR(`GSTIN ${m.buyer.gstin}`, "", { size: g.small });
  if (m.placeOfSupply && m.registered && !m.intra) LR(`Place of supply: ${m.placeOfSupply}`, "", { size: g.small });
  hr();

  // ── Items ─────────────────────────────────────────────────
  const amtW = g.wide ? 54 : 46;
  const amountRight = (left: string, mid: string, amt: string, o: { bold?: boolean; indent?: number } = {}) => {
    const size = g.size;
    const leftW = mid ? cw * 0.4 : cw - amtW - 4;
    const h1 = text(doc, left, x0 + (o.indent ?? 0), y, { w: leftW, size, bold: o.bold, color: "#000000" });
    const h2 = mid ? text(doc, mid, x0 + cw * 0.3, y, { w: cw * 0.7 - amtW - 4, size, bold: o.bold, align: "right", color: "#000000" }) : 0;
    const h3 = text(doc, amt, x1 - amtW, y, { w: amtW, size, bold: o.bold, align: "right", color: "#000000" });
    y += Math.max(h1, h2, h3);
  };
  if (g.wide) {
    amountRight("Item", "Qty x Rate", "Amt", { bold: true });
    hr();
  }
  for (const l of m.lines) {
    const name = g.wide && l.hsn ? `${l.name} (${l.hsn})` : l.name;
    y += text(doc, name, x0, y, { w: cw, size: g.size, color: "#000000" });
    const note = lineNote(l);
    if (note) y += text(doc, note, x0 + 6, y, { w: cw - 6, size: g.small - 0.5, color: "#000000" });
    const qr = `${qty(l.qty)}${l.unit && g.wide ? " " + l.unit : ""} x ${inr(l.rate)}${l.discPct ? ` -${pct(l.discPct)}%` : ""}`;
    if (g.wide) amountRight(m.registered ? `  GST ${pct(l.gstRate)}%` : "", qr, inr(l.total));
    else amountRight(` ${qr}`, "", inr(l.total));
    y += 1.5;
  }
  hr();
  LR(`Items: ${m.lines.length}  Qty: ${qty(m.qtyTotal)}`, "", { size: g.small });

  // ── Tax summary by rate ───────────────────────────────────
  if (m.registered && m.hasTax) {
    const cols = m.intra ? ["GST%", "Taxable", "CGST", "SGST"] : ["GST%", "Taxable", "IGST"];
    const fr = m.intra ? [0.6, 1.3, 1, 1] : [0.6, 1.4, 1.2];
    const tot = fr.reduce((a, b) => a + b, 0);
    const ws = fr.map((f) => (cw * f) / tot);
    const row = (cells: string[], bold = false) => {
      let x = x0;
      let h = 0;
      cells.forEach((s, i) => {
        h = Math.max(h, text(doc, s, x, y, { w: ws[i]!, size: g.small, bold, align: i === 0 ? "left" : "right", color: "#000000" }));
        x += ws[i]!;
      });
      y += h;
    };
    y += 2;
    row(cols, true);
    for (const r of m.byRate) row(m.intra ? [pct(r.rate), inr(r.taxable), inr(r.cgst), inr(r.sgst)] : [pct(r.rate), inr(r.taxable), inr(r.igst)]);
  } else if (m.hasTax) {
    LR("Tax", inr(m.tax), { size: g.small });
  }
  hr();

  // ── Totals ────────────────────────────────────────────────
  if (m.billDiscount > 0) LR("Discount", `-${inr(m.billDiscount)}`);
  if (m.charges !== 0) LR("Charges", inr(m.charges));
  if (m.tcs > 0) LR("TCS (s.206C)", inr(m.tcs));
  if (m.roundOff !== 0) LR("Round off", inr(m.roundOff));
  LR("TOTAL", rs(m.grand), { size: g.big, bold: true });
  if (m.paid > 0) {
    LR("Paid", rs(m.paid));
    if (m.balance > 0) LR("Balance due", rs(m.balance), { bold: true });
  }
  hr();

  // ── E-way bill, e-invoice, payment ────────────────────────
  if (d.eWayBill) LR(`e-Way Bill ${ewbLine(m)}`, "", { size: g.small });
  if (d.eInvoice?.irn) {
    const qrS = g.wide ? 96 : 80;
    if (image(doc, d.eInvoice.qrDataUrl, x0 + (cw - qrS) / 2, y + 2, qrS, qrS)) y += qrS + 4;
    C(`IRN ${d.eInvoice.irn}`, { size: g.small - 1 });
    if (d.eInvoice.ackNumber) C(`Ack No. ${d.eInvoice.ackNumber}`, { size: g.small - 1 });
    y += 2;
  }
  if (d.upiQrDataUrl && d.type === "sale") {
    const qrS = g.wide ? 86 : 64;
    if (image(doc, d.upiQrDataUrl, x0 + (cw - qrS) / 2, y + 2, qrS, qrS)) {
      if (d.upiPayUrl) doc.link(x0 + (cw - qrS) / 2, y + 2, qrS, qrS, d.upiPayUrl);
      y += qrS + 4;
      if (d.upiId) C(`Scan to pay: ${d.upiId}`, { size: g.small });
    }
  }
  for (const s of [d.notes, d.termsAndConditions].filter(Boolean) as string[]) C(s, { size: g.small - 0.5 });
  C("Thank you! Visit again.", { size: g.small });
  C("Computer generated invoice", { size: g.small - 1.5 });
  if (!d.isPaidPlan) C("Fintranzact", { size: g.small - 1.5 });
  return y;
}

export function thermalHeight(m: InvoiceModel, width: ThermalWidth): number {
  const g = geometry(width);
  const scratch = new PDFDocument({ size: [g.W, 100_000], margin: 0 });
  registerFonts(scratch);
  return draw(scratch, m, g, g.x0) + g.x0 + 6;
}

export function renderThermal(data: InvoicePDFData, width: ThermalWidth = 80): Doc {
  const m = buildModel(data, [], false);
  const g = geometry(width);
  const height = Math.max(200, thermalHeight(m, width));
  const doc = new PDFDocument({
    size: [g.W, height],
    margin: 0,
    bufferPages: true,
    info: { Title: `Receipt ${data.invoiceNumber}`, Author: data.businessName, Creator: "Fintranzact" },
  });
  registerFonts(doc);
  draw(doc, m, g, g.x0);
  return doc;
}

