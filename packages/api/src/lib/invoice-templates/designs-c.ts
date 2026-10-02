/**
 * Gallery designs 8, 11, 12 and 14: Compact A5, Export Invoice,
 * Professional Services and the Estimate / Quotation treatment.
 */
import { A4, A5, Ctx, drawTable, image, line, rect, text, textHeight, textWidth, upiQr, type Column, type Row } from "./engine.js";
import { inr, lineNote, pct, qty, qtyUnit, rs } from "./model.js";
import {
  bankLines, bankOneLine, contHeader, decorateDefault, drawTotals, einvoiceBlock, hasPayment, signatureBlock, termsBlock,
  transportPairs,
} from "./pieces.js";
import type { Design } from "./render.js";
import { NOT_A_TAX_INVOICE } from "./notices.js";

// ════════════════════════════════════════════════════════════
// 8. Compact A5
// ════════════════════════════════════════════════════════════

const A5_SIZE = 7.5;

function a5Header(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  if (image(doc, m.data.logoBuffer, c.x0 + c.cw / 2 - 50, y, 100, 28, "center")) y += 31;
  y += text(doc, m.seller.name, c.x0, y, { w: c.cw, size: 11, bold: true, align: "center" });
  y += text(doc, m.seller.address.join(", "), c.x0, y, { w: c.cw, size: A5_SIZE, align: "center" });
  y += text(doc, [m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "", m.seller.phone].filter(Boolean).join(" · "), c.x0, y, { w: c.cw, size: A5_SIZE, align: "center" });
  y += text(doc, m.title.toUpperCase(), c.x0, y + 1, { w: c.cw, size: A5_SIZE + 0.5, bold: true, align: "center" }) + 5;
  line(doc, c.x0, y, c.x1, y, "#222222", 0.75);
  y += 4.5;
  const noW = textWidth(doc, "No. ", A5_SIZE);
  text(doc, "No. ", c.x0, y, { w: noW + 1, size: A5_SIZE });
  text(doc, m.number, c.x0 + noW, y, { w: c.cw / 2, size: A5_SIZE, bold: true });
  y += text(doc, `${m.date}${m.dueDate ? ` · Due ${m.dueDate}` : ""}`, c.x0 + c.cw / 2, y, { w: c.cw / 2, size: A5_SIZE, align: "right" }) + 4.5;
  line(doc, c.x0, y, c.x1, y, "#888888", 0.6, [2, 2]);
  y += 4;
  const to = [`To: ${m.buyer.name}`, m.buyer.address.join(", "), m.buyer.gstin ? `GSTIN ${m.buyer.gstin}` : ""].filter(Boolean).join(" · ");
  y += text(doc, to, c.x0, y, { w: c.cw, size: A5_SIZE });
  const extra = [m.placeOfSupply ? `Place of supply ${m.placeOfSupply}` : "", ...transportPairs(m).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(" · ");
  if (extra) y += text(doc, extra, c.x0, y, { w: c.cw, size: 6.8, color: "#444444" });
  y += 5;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, c.x0, y, c.cw, { qr: 48, size: 6.4 }) + 6;
  return y;
}

function a5Items(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "Item", w: 0 },
    { header: "Qty", w: 46, align: "right" },
    { header: "Rate", w: 50, align: "right" },
    { header: "GST", w: 28, align: "right" },
    { header: "Amt", w: 58, align: "right" },
  ];
  const rows: Row[] = m.lines.map((l) => ({
    cells: [
      { text: l.name, sub: [l.hsn ? `HSN ${l.hsn}` : "", l.discPct ? `${pct(l.discPct)}% off` : "", lineNote(l)].filter(Boolean).join(" · ") || undefined },
      qtyUnit(l), inr(l.rate), `${pct(l.gstRate)}%`, inr(l.taxable),
    ],
    carry: l.taxable,
  }));
  return drawTable(c, y, {
    columns: cols,
    rows,
    carry: { col: 4, labelCol: 0 },
    style: { size: A5_SIZE, subSize: 6.3, padX: 2.2, padY: 3, headerBold: true, headerBottom: { w: 0.75, c: "#222222" }, rowLine: { w: 0.5, c: "#bbbbbb", dash: [1, 1.5] }, subColor: "#555555" },
    newPage,
  });
}

function a5Totals(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  y += 5;
  const lines: string[] = [];
  if (m.billDiscount > 0) lines.push(`Discount ${inr(m.billDiscount)}`);
  if (m.charges !== 0) lines.push(`Charges ${inr(m.charges)}`);
  for (const r of m.byRate) {
    if (!m.registered) break;
    lines.push(m.intra
      ? `GST ${pct(r.rate)}% on ${inr(r.taxable)}: CGST ${inr(r.cgst)} + SGST ${inr(r.sgst)}`
      : `GST ${pct(r.rate)}% on ${inr(r.taxable)}: IGST ${inr(r.igst)}`);
  }
  if (!m.registered && m.hasTax) lines.push(`Tax ${inr(m.tax)}`);
  for (const l of lines) y += text(doc, l, c.x0, y, { w: c.cw, size: 6.6 });
  y += 5;
  const gv = rs(m.grand);
  const gw = textWidth(doc, gv, 10, true) + 16;
  const gh = 10 * 1.35 + 9;
  const lw = c.cw - gw - 10;
  let ly = y;
  ly += text(doc, m.words, c.x0, ly, { w: lw, size: 6.6 });
  if (m.tcs > 0) ly += text(doc, `TCS (s.206C) ${inr(m.tcs)}`, c.x0, ly, { w: lw, size: 6.6 });
  if (m.roundOff !== 0) ly += text(doc, `Round off ${inr(m.roundOff)}`, c.x0, ly, { w: lw, size: 6.6 });
  if (m.paid > 0) ly += text(doc, `Paid ${rs(m.paid)} · Balance ${rs(m.balance)}`, c.x0, ly, { w: lw, size: 6.6, bold: true });
  const gy = Math.max(y, ly - gh);
  rect(doc, c.x1 - gw, gy, gw, gh, { stroke: "#222222", lw: 1.5 });
  text(doc, gv, c.x1 - gw, gy + 4.5, { w: gw - 8, size: 10, bold: true, align: "right" });
  return Math.max(ly, gy + gh);
}

function a5Foot(c: Ctx, y: number): number {
  const m = c.m;
  y += 9;
  const qr = 48;
  const hasQr = hasPayment(m) && upiQr(c, c.x0, y, qr);
  const tx = c.x0 + (hasQr ? qr + 8 : 0);
  const sigW = 110;
  const tw = c.x1 - sigW - 8 - tx;
  let ty = y;
  if (hasPayment(m)) for (const l of bankLines(m)) ty += text(c.doc, l, tx, ty, { w: tw, size: 6.4 });
  ty = termsBlock(c, tx, ty + 3, tw, { size: 6.2 });
  const sy = signatureBlock(c, c.x1 - sigW, y, sigW, { size: 6.8, align: "center", gap: 22 });
  return Math.max(ty, sy, hasQr ? y + qr : y);
}

const compactA5: Design = {
  page: { size: A5, margins: { t: 22, r: 21, b: 26, l: 21 } },
  header: a5Header,
  contHeader: (c, y) => contHeader(c, y, { size: 7, rule: "#222222" }),
  items: a5Items,
  blocks: () => [a5Totals, a5Foot],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 7, pageY: c.H - 18 }),
};

// ════════════════════════════════════════════════════════════
// 12. Professional Services
// ════════════════════════════════════════════════════════════

const S_ACC = "#5b3fa3";
const S_K = "#7a6f99";
const S_SIZE = 8;

function svcK(c: Ctx, s: string, x: number, y: number, w: number): number {
  return text(c.doc, s.toUpperCase(), x, y, { w, size: 6.4, color: S_K, spacing: 0.6 }) + 1;
}

function serviceHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const boxW = 170;
  const lw = c.cw - boxW - 12;
  let ly = y;
  if (image(doc, m.data.logoBuffer, c.x0, ly, 90, 30)) ly += 34;
  ly += text(doc, m.seller.name, c.x0, ly, { w: lw, size: 13.5, bold: true });
  ly += text(doc, m.seller.address.join(", "), c.x0, ly, { w: lw, size: 7.2, color: "#555555" });
  ly += text(doc, [m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "", m.seller.pan ? `PAN ${m.seller.pan}` : "", m.seller.phone].filter(Boolean).join(" · "), c.x0, ly, { w: lw, size: 7.2, color: "#555555" });
  // Amount-due callout
  const bx = c.x1 - boxW;
  const pad = 9;
  const due = m.dueDate ? `Amount due by ${m.dueDate}` : "Amount due";
  const inner = (cc: Ctx, yy: number) => {
    let by = yy;
    by += text(cc.doc, due, bx + pad, by, { w: boxW - 2 * pad, size: 7.2, align: "right" });
    by += text(cc.doc, rs(m.balance), bx + pad, by, { w: boxW - 2 * pad, size: 15, bold: true, color: S_ACC, align: "right" });
    by += text(cc.doc, `${m.title} ${m.number}`, bx + pad, by, { w: boxW - 2 * pad, size: 7.2, align: "right" });
    return by;
  };
  const bh = c.measure(inner) + 2 * pad - 2;
  rect(doc, bx, y, boxW, bh, { fill: "#f3f0fb", stroke: "#ddd3f3", radius: 7.5, lw: 0.75 });
  inner(c, y + pad - 1);
  y = Math.max(ly, y + bh) + 14;

  // Reference row
  line(doc, c.x0, y, c.x1, y, "#e6e1f3", 0.75);
  y += 7.5;
  const gap = 8;
  const w = (c.cw - 3 * gap) / 4;
  const col = (i: number) => c.x0 + i * (w + gap);
  const heads = m.registered ? (m.intra ? "CGST + SGST" : "IGST") : "";
  const cells: Array<[string, (x: number, yy: number) => number]> = [
    ["Client", (x, yy) => {
      let h = text(doc, m.buyer.name, x, yy, { w, size: S_SIZE, bold: true });
      for (const l of [...m.buyer.address, m.buyer.gstin ? `GSTIN ${m.buyer.gstin}` : ""].filter(Boolean)) h += text(doc, l, x, yy + h, { w, size: 6.8 });
      return h;
    }],
    ["Invoice date", (x, yy) => text(doc, m.date, x, yy, { w, size: S_SIZE })],
    ["Place of supply", (x, yy) => text(doc, [m.placeOfSupply, heads].filter(Boolean).join(" · "), x, yy, { w, size: S_SIZE })],
    [m.data.eWayBill ? "E-way bill" : "Reverse charge", (x, yy) => text(doc, m.data.eWayBill ? transportPairs(m).map(([, v]) => v).join(" · ") : m.data.isReverseCharge ? "Yes" : "No", x, yy, { w, size: S_SIZE })],
  ];
  let bottom = y;
  cells.forEach(([k, draw], i) => {
    const kh = svcK(c, k, col(i), y, w);
    bottom = Math.max(bottom, y + kh + draw(col(i), y + kh));
  });
  y = bottom + 7.5;
  line(doc, c.x0, y, c.x1, y, "#e6e1f3", 0.75);
  y += 12;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, c.x0, y, c.cw, { qr: 54, size: 6.8 }) + 10;
  return y;
}

function serviceItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "Service", w: 0 },
    { header: "SAC", w: 44 },
    { header: "Hrs / period", w: 56, align: "right" },
    { header: "Rate", w: 58, align: "right" },
    { header: "Taxable", w: 62, align: "right" },
    ...(m.intra ? [{ header: "CGST", w: 50, align: "right" }, { header: "SGST", w: 50, align: "right" }] as Column[] : [{ header: "IGST", w: 58, align: "right" }] as Column[]),
    { header: "Amount", w: 64, align: "right" },
  ];
  const last = cols.length - 1;
  const rows: Row[] = m.lines.map((l) => ({
    cells: [
      { text: l.name, bold: true, sub: [l.discPct ? `${pct(l.discPct)}% discount` : "", lineNote(l)].filter(Boolean).join(" · ") || undefined },
      l.hsn, qtyUnit(l), inr(l.rate), inr(l.taxable),
      ...(m.intra
        ? [{ text: inr(l.cgst), sub: `${pct(l.gstRate / 2)}%` }, { text: inr(l.sgst), sub: `${pct(l.gstRate / 2)}%` }]
        : [{ text: inr(l.igst), sub: `${pct(l.gstRate)}%` }]),
      inr(l.total),
    ],
    carry: l.total,
  }));
  return drawTable(c, y, {
    columns: cols,
    rows,
    carry: { col: last, labelCol: 0 },
    style: { size: S_SIZE, subSize: 6.6, padX: 4.5, padY: 6.5, headerSize: 7.1, headerColor: S_K, headerBold: true, headerBottom: { w: 0.75, c: "#cfc6e8" }, rowLine: { w: 0.6, c: "#f0edf8" }, subColor: S_K },
    newPage,
  });
}

function serviceTotals(c: Ctx, y: number): number {
  const m = c.m;
  y += 10;
  const rw = c.cw * 0.42;
  const lw = c.cw - rw - 20;
  let ly = y;
  ly += text(c.doc, m.words, c.x0, ly, { w: lw, size: 7.4 });
  if (m.registered) ly += text(c.doc, `Reverse charge: ${m.data.isReverseCharge ? "Yes" : "No"}.`, c.x0, ly + 2, { w: lw, size: 7, color: "#666666" }) + 2;
  ly = termsBlock(c, c.x0, ly + 4, lw, { size: 6.8, color: "#666666" });
  const ry = drawTotals(c, c.x1 - rw, y, rw, { size: S_SIZE, rowGap: 3, labelColor: "#333333", grand: { size: 9.5, topLine: "#cfc6e8", padY: 4, label: "Total" } });
  return Math.max(ly, ry);
}

function servicePay(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  y += 12;
  if (hasPayment(m)) {
    const pad = 9;
    const qr = 60;
    const inner = (cc: Ctx, yy: number) => {
      const hasQr = !!m.data.upiQrDataUrl && (cc.measuring ? true : upiQr(cc, c.x0 + pad, yy, qr));
      const tx = c.x0 + pad + (hasQr ? qr + 12 : 0);
      const tw = c.x1 - pad - tx;
      const pay = ["Pay now", m.data.upiId ? `UPI ${m.data.upiId}` : "", bankOneLine(m) ? `or bank transfer to ${bankOneLine(m)}` : ""].filter(Boolean).join(" · ");
      let ty = yy + (hasQr ? Math.max(0, (qr - 24) / 2) : 0);
      ty += text(cc.doc, pay, tx, ty, { w: tw, size: S_SIZE });
      ty += text(cc.doc, `Please quote ${m.number} in the payment reference.`, tx, ty + 1, { w: tw, size: 7, color: "#666666" });
      return Math.max(ty, hasQr ? yy + qr : ty);
    };
    const h = c.measure(inner) + 2 * pad;
    rect(doc, c.x0, y, c.cw, h, { fill: "#faf9fd", stroke: "#ece7f7", radius: 7.5, lw: 0.75 });
    inner(c, y + pad);
    y += h + 14;
  }
  return signatureBlock(c, c.x1 - 160, y, 160, { size: S_SIZE });
}

const service: Design = {
  page: { size: A4, margins: { t: 30, r: 31.5, b: 36, l: 31.5 } },
  header: serviceHeader,
  contHeader: (c, y) => contHeader(c, y, { rule: S_ACC }),
  items: serviceItems,
  blocks: () => [serviceTotals, servicePay],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 12, pageY: c.H - 24 }),
};

// ════════════════════════════════════════════════════════════
// 11. Export Invoice
// ════════════════════════════════════════════════════════════

const E_ACC = "#0d4f8b";
const E_SIZE = 7.5;

export function lutEndorsement(m: Ctx["m"]): string {
  const arn = m.data.businessLutArn;
  return m.hasTax
    ? "SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX"
    : `SUPPLY MEANT FOR EXPORT UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX${arn ? ` · LUT ARN ${arn}` : ""}`;
}

function exportHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const lw = c.cw * 0.62;
  let ly = y;
  ly += text(doc, m.seller.name, c.x0, ly, { w: lw, size: 10.5, bold: true });
  ly += text(doc, m.seller.address.join(", "), c.x0, ly, { w: lw, size: E_SIZE });
  ly += text(doc, [m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "", m.data.businessIecCode ? `IEC ${m.data.businessIecCode}` : "", m.seller.phone].filter(Boolean).join(" · "), c.x0, ly, { w: lw, size: E_SIZE });
  const th = text(doc, "EXPORT INVOICE", c.x0 + lw, y + Math.max(0, (ly - y) / 2 - 9), { w: c.cw - lw, size: 15, bold: true, color: E_ACC, align: "right", spacing: 0.9 });
  y = Math.max(ly, y + th) + 6;
  line(doc, c.x0, y, c.x1, y, E_ACC, 1.5);
  y += 7.5;
  const lut = lutEndorsement(m);
  const lh = textHeight(doc, lut, { w: c.cw - 12, size: 7.1, bold: true }) + 8;
  rect(doc, c.x0, y, c.cw, lh, { stroke: E_ACC, lw: 1.1 });
  text(doc, lut, c.x0 + 6, y + 4, { w: c.cw - 12, size: 7.1, bold: true, color: E_ACC, align: "center" });
  y += lh + 7.5;

  // Detail grid, four columns
  const cells: Array<[string, string]> = [
    ["Invoice no. / date", `${m.number} · ${m.date}`],
    ["Buyer", [m.buyer.name, ...m.buyer.address].join(", ")],
    ["Consignee", m.shipTo ? [m.shipTo.name, ...m.shipTo.address].join(", ") : "Same as buyer"],
    ["Country of destination", m.buyer.state || "—"],
    ["Place of supply", m.placeOfSupply],
    ["Currency", "INR (₹)"],
    ["E-way bill", transportPairs(m).map(([, v]) => v).join(" · ") || "—"],
    ["Reverse charge", m.data.isReverseCharge ? "Yes" : "No"],
  ];
  if (m.dueDate) cells.push(["Due date", m.dueDate]);
  if (m.data.businessLutArn) cells.push(["LUT ARN", m.data.businessLutArn]);
  while (cells.length % 4) cells.push(["", ""]);
  const w = c.cw / 4;
  const pad = 5;
  for (let r = 0; r < cells.length; r += 4) {
    const row = cells.slice(r, r + 4);
    const h = Math.max(...row.map(([k, v]) => textHeight(doc, k.toUpperCase(), { w: w - 2 * pad, size: 6.4 }) + textHeight(doc, v, { w: w - 2 * pad, size: E_SIZE }))) + 2 * pad;
    row.forEach(([k, v], i) => {
      const x = c.x0 + i * w;
      rect(doc, x, y, w, h, { stroke: "#bbbbbb", lw: 0.5 });
      const kh = text(doc, k.toUpperCase(), x + pad, y + pad, { w: w - 2 * pad, size: 6.4, color: "#667788", spacing: 0.4 });
      text(doc, v, x + pad, y + pad + kh, { w: w - 2 * pad, size: E_SIZE });
    });
    y += h;
  }
  y += 10;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, c.x0, y, c.cw, { qr: 54, size: 6.8 }) + 10;
  return y;
}

function exportItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "#", w: 18 },
    { header: "Description", w: 0 },
    { header: "HSN", w: 50 },
    { header: "Qty", w: 52, align: "right" },
    { header: "Rate (₹)", w: 56, align: "right" },
    { header: "Amount (₹)", w: 66, align: "right" },
    { header: "IGST", w: 58, align: "right" },
    { header: "Total (₹)", w: 66, align: "right" },
  ];
  const rows: Row[] = m.lines.map((l) => ({
    cells: [String(l.i), { text: l.name, sub: lineNote(l) || undefined }, l.hsn, qtyUnit(l), inr(l.rate), inr(l.taxable),
      l.igst ? { text: inr(l.igst), sub: `${pct(l.gstRate)}%` } : "0% (LUT)", inr(l.total)],
    carry: l.total,
  }));
  const tail: Row[] = [{
    bold: true,
    topLine: { w: 0.75, c: "#9db6cf" },
    cells: ["", "Total value", "", qty(m.qtyTotal), "", inr(m.lines.reduce((s, l) => s + l.taxable, 0)), rs(m.lines.reduce((s, l) => s + l.igst, 0)), rs(m.lines.reduce((s, l) => s + l.total, 0))],
  }];
  return drawTable(c, y, {
    columns: cols,
    rows,
    tail,
    carry: { col: 7, labelCol: 1 },
    style: { size: E_SIZE, subSize: 6.4, padX: 4.5, padY: 4.5, headerFill: "#eaf1f8", headerColor: "#0d3a63", headerBold: true, headerBottom: { w: 0.75, c: "#9db6cf" }, rowLine: { w: 0.5, c: "#e3e9f0" } },
    newPage,
  });
}

function exportBottom(c: Ctx, y: number): number {
  const m = c.m;
  y += 8;
  const rw = c.cw * 0.4;
  const lw = c.cw - rw - 20;
  let ly = y;
  ly += text(c.doc, m.words, c.x0, ly, { w: lw, size: E_SIZE + 0.3, bold: true }) + 8;
  if (hasPayment(m)) {
    ly += text(c.doc, "BANK FOR REMITTANCE", c.x0, ly, { w: lw, size: 6.4, color: "#667788", spacing: 0.4 });
    for (const l of bankLines(m)) ly += text(c.doc, l, c.x0, ly, { w: lw, size: 7 });
    ly += 6;
  }
  ly += text(c.doc, "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.", c.x0, ly, { w: lw, size: 7 }) + 4;
  ly = termsBlock(c, c.x0, ly, lw, { size: 6.8 });
  let ry = drawTotals(c, c.x1 - rw, y, rw, { size: E_SIZE, rowGap: 2.5, grand: { size: 9.4, topLine: E_ACC, padY: 3.5, color: E_ACC } });
  ry = signatureBlock(c, c.x1 - rw, ry + 14, rw, { size: E_SIZE, align: "center" });
  return Math.max(ly, ry);
}

const exportInvoice: Design = {
  page: { size: A4, margins: { t: 30, r: 31.5, b: 36, l: 31.5 } },
  header: exportHeader,
  contHeader: (c, y) => contHeader(c, y, { rule: E_ACC }),
  items: exportItems,
  blocks: () => [exportBottom],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 12, pageY: c.H - 24 }),
};

// ════════════════════════════════════════════════════════════
// 14. Estimate / Quotation (quotations and proforma invoices)
// ════════════════════════════════════════════════════════════


function watermark(c: Ctx) {
  const word = c.m.data.documentType === "proforma" ? "PROFORMA" : "ESTIMATE";
  const doc = c.doc;
  doc.save();
  doc.translate(c.W / 2, c.H / 2).rotate(-28);
  doc.font("NotoSans-Bold").fontSize(word.length > 8 ? 72 : 82).fillColor("#b41e1e").fillOpacity(0.07);
  const w = doc.widthOfString(word, { characterSpacing: 8 });
  doc.text(word, -w / 2, -45, { lineBreak: false, characterSpacing: 8 });
  doc.restore();
}

function estimateHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const lw = c.cw * 0.55;
  let ly = y;
  ly += text(doc, m.seller.name, c.x0, ly, { w: lw, size: 12, bold: true });
  for (const l of [m.seller.phone, m.seller.address.join(", "), m.seller.gstin ? `GSTIN ${m.seller.gstin}` : ""].filter(Boolean)) ly += text(doc, l, c.x0, ly, { w: lw, size: 7.5 });
  const rx = c.x0 + lw;
  const rw = c.cw - lw;
  let ry = y;
  ry += text(doc, m.title.toUpperCase(), rx, ry, { w: rw, size: 13.5, bold: true, align: "right", spacing: 1 });
  ry += text(doc, `No. ${m.number} · ${m.date}`, rx, ry, { w: rw, size: 8, align: "right" });
  if (m.dueDate) ry += text(doc, `Valid till ${m.dueDate}`, rx, ry, { w: rw, size: 8, align: "right", bold: true });
  y = Math.max(ly, ry) + 14;
  const toW = textWidth(doc, "To ", 8.5);
  text(doc, "To ", c.x0, y, { w: toW + 1, size: 8.5 });
  y += text(doc, [m.buyer.name, ...m.buyer.address].join(", ") + (m.buyer.gstin ? ` · GSTIN ${m.buyer.gstin}` : ""), c.x0 + toW, y, { w: c.cw - toW, size: 8.5, oblique: true }) + 10;
  return y;
}

function estimateItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "#", w: 22 },
    { header: "Item", w: 0 },
    { header: "Qty", w: 60, align: "right" },
    { header: "Rate", w: 66, align: "right" },
    { header: "Amount", w: 76, align: "right" },
  ];
  const rows: Row[] = m.lines.map((l) => ({
    cells: [String(l.i), { text: l.name, sub: [l.hsn ? `HSN ${l.hsn}` : "", l.discPct ? `${pct(l.discPct)}% off` : "", m.registered ? `GST ${pct(l.gstRate)}%` : "", lineNote(l)].filter(Boolean).join(" · ") || undefined },
      qtyUnit(l), inr(l.rate), inr(l.taxable)],
    carry: l.taxable,
  }));
  const tail: Row[] = [];
  if (m.charges !== 0) tail.push({ cells: ["", { text: "Charges", align: "right" }, "", "", inr(m.charges)] });
  if (m.hasTax) tail.push({ cells: ["", { text: "Estimated GST", align: "right" }, "", "", inr(m.tax)] });
  if (m.tcs > 0) tail.push({ cells: ["", { text: "TCS (s.206C)", align: "right" }, "", "", inr(m.tcs)] });
  if (m.roundOff !== 0) tail.push({ cells: ["", { text: "Round off", align: "right" }, "", "", inr(m.roundOff)] });
  tail.push({ bold: true, cells: ["", { text: "Estimated total", align: "right" }, "", "", rs(m.grand)] });
  return drawTable(c, y, {
    columns: cols,
    rows,
    tail,
    carry: { col: 4, labelCol: 1 },
    style: { size: 8, subSize: 6.6, padX: 3, padY: 6, headerBold: true, headerBottom: { w: 1.5, c: "#9fb3cf" }, rowLine: { w: 0.75, c: "#c9d6e8" }, subColor: "#5a6b85" },
    newPage,
  });
}

function estimateFoot(c: Ctx, y: number): number {
  const m = c.m;
  y += 14;
  const d = m.data;
  for (const s of [d.notes, d.termsAndConditions].filter(Boolean) as string[]) y += text(c.doc, s, c.x0, y, { w: c.cw, size: 8, oblique: true }) + 4;
  y += text(c.doc, NOT_A_TAX_INVOICE, c.x0, y + 4, { w: c.cw, size: 8.5, bold: true, color: "#aa1111" }) + 4;
  return signatureBlock(c, c.x1 - 160, y + 20, 160, { size: 8, label: "Signature" });
}

const estimate: Design = {
  page: { size: A4, margins: { t: 30, r: 31.5, b: 36, l: 31.5 }, background: "#fffef8" },
  paint: watermark,
  header: estimateHeader,
  contHeader: (c, y) => contHeader(c, y, { rule: "#9fb3cf" }),
  items: estimateItems,
  blocks: () => [estimateFoot],
  decorate: (c, p, n) => decorateDefault(c, p, n, { pageY: c.H - 24 }),
};

export const DESIGNS_C = { compact_a5: compactA5, service, export: exportInvoice, estimate } satisfies Record<string, Design>;
