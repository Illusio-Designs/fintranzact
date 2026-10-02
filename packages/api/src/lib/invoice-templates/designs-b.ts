/**
 * Gallery designs 4–7: Bold Header Band, Minimal, Spreadsheet (Batch & MRP)
 * and Landscape Wide.
 */
import { A4, A4_LANDSCAPE, Ctx, drawTable, line, rect, text, textHeight, textWidth, upiQr, type Column, type Row } from "./engine.js";
import { inr, lineNote, pct, qty, qtyUnit, rs } from "./model.js";
import {
  bankLines, bankOneLine, branding, contHeader, decorateDefault, drawTotals, einvoiceBlock, hasPayment, hsnTable,
  partyLines, rateTable, signatureBlock, taxRows, termsBlock, transportPairs,
} from "./pieces.js";
import type { Design } from "./render.js";

// ════════════════════════════════════════════════════════════
// 4. Bold Header Band
// ════════════════════════════════════════════════════════════

const BB_DARK = "#1b1b3a";
const BB_ACC = "#e4572e";
const BB_SIZE = 8;

function boldBand(c: Ctx): number {
  const m = c.m;
  const doc = c.doc;
  const padX = 31.5;
  const w = c.W - 2 * padX;
  const big = m.kind === "tax_invoice" ? "Invoice" : m.title;
  const measureBand = (cc: Ctx, y0: number) => {
    let y = y0 + 22;
    y += text(cc.doc, big, padX, y, { w: w * 0.7, size: 25, bold: true, color: "#ffffff" });
    y += text(cc.doc, [m.seller.name, m.seller.gstin ? `GSTIN ${m.seller.gstin}` : ""].filter(Boolean).join(" · "), padX, y, { w: w * 0.7, size: 8, color: "#d6d6e4" }) + 10;
    return y + 6.75 * 1.4 + 13.5 * 1.4 + 18;
  };
  const bandH = c.measure((p, y) => measureBand(p, y));
  rect(doc, 0, 0, c.W, bandH, { fill: BB_DARK });
  let y = 22;
  y += text(doc, big, padX, y, { w: w * 0.7, size: 25, bold: true, color: "#ffffff" });
  y += text(doc, [m.seller.name, m.seller.gstin ? `GSTIN ${m.seller.gstin}` : ""].filter(Boolean).join(" · "), padX, y, { w: w * 0.7, size: 8, color: "#d6d6e4" }) + 10;
  const groups: Array<[string, string, string?]> = [["Invoice no.", m.number], ["Issued", m.date]];
  if (m.dueDate && m.kind !== "estimate") groups.push(["Due", m.dueDate]);
  groups.push(["Amount due", rs(m.balance), "#ffb199"]);
  let gx = padX;
  for (const [k, v, color] of groups) {
    text(doc, k.toUpperCase(), gx, y, { w: 140, size: 6.75, color: "#bdbdd0", spacing: 0.9 });
    text(doc, v, gx, y + 6.75 * 1.4, { w: 160, size: 13.5, bold: true, color: color ?? "#ffffff" });
    gx += Math.max(textWidth(doc, v, 13.5, true), textWidth(doc, k.toUpperCase(), 6.75, false, 0.9)) + 21;
  }
  // Right: copy label and the document heading
  let ry = 24;
  if (c.copy) ry += text(doc, c.copy, c.W - padX - 200, ry, { w: 200, size: 7, color: "#ffffff", align: "right", spacing: 0.4 }) + 8;
  text(doc, m.title.toUpperCase(), c.W - padX - 200, ry, { w: 200, size: 7, color: "#ffffff", align: "right", spacing: 0.4, bold: true });
  return bandH;
}

function boldHeader(c: Ctx, _y: number): number {
  const m = c.m;
  const doc = c.doc;
  let y = boldBand(c) + 16.5;
  const gap = 18;
  const half = (c.cw - gap) / 2;
  const k = (s: string, x: number, yy: number) => text(doc, s.toUpperCase(), x, yy, { w: half, size: 6.75, bold: true, color: BB_ACC, spacing: 0.9 }) + 1;
  let ly = y;
  ly += k("Billed to", c.x0, ly);
  ly += text(doc, m.buyer.name, c.x0, ly, { w: half, size: 9.75, bold: true });
  for (const l of partyLines(m.buyer, { phone: true })) ly += text(doc, l, c.x0, ly, { w: half, size: BB_SIZE });
  if (m.shipTo) ly += text(doc, `Ship to: ${m.shipTo.address.join(", ")}`, c.x0, ly + 2, { w: half, size: BB_SIZE, color: "#555555" }) + 2;
  const rx = c.x0 + half + gap;
  let ry = y;
  ry += k("From", rx, ry);
  ry += text(doc, m.seller.name, rx, ry, { w: half, size: 9.75, bold: true });
  for (const l of m.seller.address) ry += text(doc, l, rx, ry, { w: half, size: BB_SIZE });
  if (m.placeOfSupply) ry += text(doc, `Place of supply: ${m.placeOfSupply}`, rx, ry, { w: half, size: BB_SIZE });
  for (const [kk, v] of transportPairs(m)) ry += text(doc, `${kk}: ${v}`, rx, ry, { w: half, size: BB_SIZE });
  if (m.registered) ry += text(doc, `Reverse charge: ${m.data.isReverseCharge ? "Yes" : "No"}`, rx, ry, { w: half, size: BB_SIZE });
  y = Math.max(ly, ry) + 14;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, c.x0, y, c.cw, { qr: 56, size: 6.8 }) + 10;
  return y;
}

function boldCont(c: Ctx, _y: number): number {
  const h = 30;
  rect(c.doc, 0, 0, c.W, h, { fill: BB_DARK });
  text(c.doc, c.m.seller.name, 31.5, 10, { w: c.W / 2, size: 9, bold: true, color: "#ffffff" });
  text(c.doc, `${c.copy ? c.copy + " · " : ""}Invoice ${c.m.number} (continued)`, c.W / 2 - 31.5, 11, { w: c.W / 2, size: 7.5, color: "#ffffff", align: "right" });
  return h + 14;
}

function boldItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "Item", w: 0 },
    { header: "HSN", w: 44 },
    { header: "Qty", w: 52, align: "right" },
    { header: "Price", w: 56, align: "right" },
    { header: "Taxable", w: 62, align: "right" },
    { header: "GST", w: 32, align: "right" },
    { header: "Total", w: 66, align: "right" },
  ];
  const rows: Row[] = m.lines.map((l) => {
    const sub = [l.discPct ? `${pct(l.discPct)}% off` : "", lineNote(l)].filter(Boolean).join(" · ");
    return { cells: [{ text: l.name, bold: true, sub: sub || undefined }, l.hsn, qtyUnit(l), inr(l.rate), inr(l.taxable), `${pct(l.gstRate)}%`, inr(l.total)], carry: l.total };
  });
  return drawTable(c, y, {
    columns: cols,
    rows,
    carry: { col: 6, labelCol: 0 },
    style: { size: BB_SIZE, subSize: 6.8, padX: 4.5, padY: 8, headerSize: 7, headerUpper: true, headerColor: "#777777", headerSpacing: 0.6, headerPadY: 6, headerBottom: { w: 1.5, c: BB_DARK }, rowLine: { w: 0.6, c: "#eeeeee" }, subColor: "#777777" },
    newPage,
  });
}

function boldTotals(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  y += 12;
  const rw = 200;
  const lw = c.cw - rw - 20;
  const parts = [`Taxable ${rs(m.taxable)}`, ...taxRows(m).map(([l, v]) => `${l} ${rs(v)}`)];
  if (m.charges !== 0) parts.splice(1, 0, `incl. charges ${rs(m.charges)}`);
  if (m.billDiscount > 0) parts.splice(0, 0, `Discount ${rs(m.billDiscount)}`);
  if (m.tcs > 0) parts.push(`TCS (s.206C) ${rs(m.tcs)}`);
  if (m.roundOff !== 0) parts.push(`Round off ${inr(m.roundOff)}`);
  let ly = y;
  ly += text(doc, parts.join(" · "), c.x0, ly, { w: lw, size: 7.2, color: "#666666" });
  ly += text(doc, m.words, c.x0, ly + 2, { w: lw, size: 7.2, color: "#666666" }) + 2;
  if (m.registered && m.byRate.filter((r) => r.tax !== 0).length > 1) {
    ly = rateTable(c, c.x0, ly + 6, Math.min(lw, 300), { size: 6.8, padX: 3, padY: 2.5, headerSize: 6.4, headerUpper: true, headerColor: "#777777", headerBottom: { w: 0.6, c: "#cccccc" }, rowLine: { w: 0.4, c: "#eeeeee" } });
  }
  const label = "TOTAL";
  const gw = textWidth(doc, rs(m.grand), 19.5, true);
  text(doc, label, c.x1 - gw - 12 - 40, y + 9, { w: 40, size: 6.75, bold: true, color: BB_ACC, spacing: 0.9, align: "right" });
  let ry = y + text(doc, rs(m.grand), c.x1 - gw - 4, y, { w: gw + 4, size: 19.5, bold: true, color: BB_DARK, align: "right" });
  if (m.paid > 0) {
    ry += text(doc, `Paid ${rs(m.paid)}${m.balance > 0 ? ` · Balance due ${rs(m.balance)}` : ""}`, c.x1 - rw, ry, { w: rw, size: 7.5, align: "right", color: "#444444" });
  }
  return Math.max(ly, ry);
}

function boldPay(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  y += 20;
  const sigW = 140;
  const qr = 64;
  const hasQr = hasPayment(m) && upiQr(c, c.x0, y, qr);
  const tx = c.x0 + (hasQr ? qr + 14 : 0);
  const tw = c.x1 - sigW - 14 - tx;
  let ty = y;
  if (hasPayment(m)) {
    ty += text(doc, "PAY INSTANTLY", tx, ty, { w: tw, size: 6.75, bold: true, color: BB_ACC, spacing: 0.9 }) + 1;
    if (m.data.upiId) ty += text(doc, `Scan with any UPI app · ${m.data.upiId}`, tx, ty, { w: tw, size: BB_SIZE });
    const bank = bankOneLine(m);
    if (bank) ty += text(doc, bank, tx, ty, { w: tw, size: 7.2, color: "#555555" });
    ty += 4;
  }
  ty = termsBlock(c, tx, ty, tw, { size: 6.8, color: "#777777" });
  const sy = signatureBlock(c, c.x1 - sigW, y, sigW, { size: 7.5 });
  return Math.max(ty, sy, hasQr ? y + qr : y);
}

const bold: Design = {
  page: { size: A4, margins: { t: 0, r: 31.5, b: 34, l: 31.5 } },
  header: boldHeader,
  contHeader: boldCont,
  items: boldItems,
  blocks: () => [boldTotals, boldPay],
  decorate: (c, p, n) => {
    if (n > 1) text(c.doc, `Page ${p} of ${n}`, 0, c.H - 24, { w: c.W, size: 7, color: "#666666", align: "center" });
    if (p === n) branding(c);
  },
};

// ════════════════════════════════════════════════════════════
// 5. Minimal
// ════════════════════════════════════════════════════════════

const MN_GREY = "#8a8f99";
const MN_ACC = "#3b5eaa";
const MN_SIZE = 8;

function minK(c: Ctx, s: string, x: number, y: number, w: number): number {
  return text(c.doc, s.toUpperCase(), x, y, { w, size: 6.75, color: MN_GREY, spacing: 1.3 }) + 3;
}

function minimalHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const t = m.title.charAt(0) + m.title.slice(1).toLowerCase() + " ";
  const tw = textWidth(doc, t, 22, false);
  text(doc, t, c.x0, y, { w: tw + 2, size: 22, color: "#222222" });
  const h = text(doc, m.number, c.x0 + tw, y, { w: c.cw - tw - 110, size: 22, color: MN_ACC });
  text(doc, m.date, c.x1 - 110, y + 8, { w: 110, size: MN_SIZE, align: "right", color: "#222222" });
  y += Math.max(h, 30) + 22;
  const gap = 18;
  const w = (c.cw - 2 * gap) / 3;
  const col = (i: number) => c.x0 + i * (w + gap);
  let a = y + minK(c, "From", col(0), y, w);
  a += text(doc, m.seller.name, col(0), a, { w, size: MN_SIZE, bold: true, color: "#222222" });
  for (const l of [...m.seller.address, m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "", m.seller.phone].filter(Boolean)) a += text(doc, l, col(0), a, { w, size: MN_SIZE, color: "#222222", lineGap: 1 });
  let b = y + minK(c, "Billed to", col(1), y, w);
  b += text(doc, m.buyer.name, col(1), b, { w, size: MN_SIZE, bold: true, color: "#222222" });
  for (const l of partyLines(m.buyer)) b += text(doc, l, col(1), b, { w, size: MN_SIZE, color: "#222222", lineGap: 1 });
  if (m.shipTo) b += text(doc, `Ship to: ${m.shipTo.address.join(", ")}`, col(1), b + 2, { w, size: 7.2, color: MN_GREY });
  let d = y + minK(c, "Details", col(2), y, w);
  const details = [
    m.dueDate ? `Due ${m.dueDate}` : "",
    m.placeOfSupply ? `Place of supply ${m.placeOfSupply}` : "",
    m.registered ? `Reverse charge: ${m.data.isReverseCharge ? "Yes" : "No"}` : "",
    ...transportPairs(m).map(([k, v]) => `${k} ${v}`),
  ].filter(Boolean);
  for (const l of details) d += text(doc, l, col(2), d, { w, size: MN_SIZE, color: "#222222", lineGap: 1 });
  y = Math.max(a, b, d) + 26;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, c.x0, y, c.cw, { qr: 54, size: 6.8, color: "#555555" }) + 12;
  return y;
}

function minimalItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "Description", w: 0 },
    { header: "HSN", w: 50 },
    { header: "Qty", w: 56, align: "right" },
    { header: "Rate", w: 62, align: "right" },
    { header: "Disc", w: 36, align: "right" },
    { header: "GST", w: 34, align: "right" },
    { header: "Amount", w: 72, align: "right" },
  ];
  const rows: Row[] = m.lines.map((l) => ({
    cells: [{ text: l.name, sub: lineNote(l) || undefined }, l.hsn, qtyUnit(l), inr(l.rate), l.discPct ? `${pct(l.discPct)}%` : "", `${pct(l.gstRate)}%`, inr(l.taxable)],
    carry: l.taxable,
  }));
  return drawTable(c, y, {
    columns: cols,
    rows,
    carry: { col: 6, labelCol: 0 },
    style: { size: MN_SIZE, subSize: 6.8, padX: 0.1, padY: 7, color: "#222222", subColor: MN_GREY, headerSize: 7.1, headerColor: MN_GREY, headerBold: true, headerPadY: 6, headerBottom: { w: 0.75, c: "#222222" } },
    newPage,
  });
}

function minimalTotals(c: Ctx, y: number): number {
  const w = c.cw * 0.42;
  y += 8;
  line(c.doc, c.x1 - w, y, c.x1, y, "#222222", 0.75);
  y = drawTotals(c, c.x1 - w, y + 5, w, { size: MN_SIZE, rowGap: 3.5, labelColor: "#222222", grand: { size: 12, padY: 5 } });
  y += text(c.doc, c.m.words, c.x0, y + 2, { w: c.cw, size: 7.5, color: MN_GREY, align: "right" }) + 2;
  return y;
}

function minimalPay(c: Ctx, y: number): number {
  const m = c.m;
  y += 30;
  const sigW = 140;
  const lw = c.cw - sigW - 20;
  let ly = y;
  if (hasPayment(m)) {
    ly += minK(c, "Payment", c.x0, ly, lw);
    const qr = 50;
    const hasQr = upiQr(c, c.x0, ly, qr);
    const tx = c.x0 + (hasQr ? qr + 10 : 0);
    const pay = [m.data.upiId ? `UPI ${m.data.upiId}` : "", bankOneLine(m)].filter(Boolean).join(" · ");
    const th = text(c.doc, pay, tx, ly, { w: lw - (tx - c.x0), size: MN_SIZE, color: "#222222" });
    ly += Math.max(th, hasQr ? qr : 0) + 8;
  }
  ly = termsBlock(c, c.x0, ly, lw, { size: 7, color: MN_GREY, headColor: MN_GREY });
  const sy = signatureBlock(c, c.x1 - sigW, y, sigW, { size: 7.5, color: "#222222" });
  return Math.max(ly, sy);
}

const minimal: Design = {
  page: { size: A4, margins: { t: 42, r: 45, b: 56, l: 45 } },
  header: minimalHeader,
  contHeader: (c, y) => contHeader(c, y, { rule: "#dddddd", color: "#222222" }),
  items: minimalItems,
  blocks: () => [minimalTotals, minimalPay],
  decorate: (c, p, n) => {
    const m = c.m;
    if (c.copy) text(c.doc, c.copy, c.x1 - 220, 18, { w: 220, size: 7, color: MN_GREY, align: "right", spacing: 0.4, bold: true });
    const fy = c.H - 34;
    const legal = [m.seller.name, m.seller.pan ? `PAN ${m.seller.pan}` : "", m.jurisdiction ? `Subject to ${m.jurisdiction} jurisdiction` : ""].filter(Boolean).join(" · ");
    text(c.doc, legal, c.x0, fy, { w: c.cw * 0.7, size: 6.75, color: MN_GREY });
    if (n > 1) text(c.doc, `Page ${p} of ${n}`, c.x0 + c.cw * 0.7, fy, { w: c.cw * 0.3, size: 6.75, color: MN_GREY, align: "right" });
    if (p === n) branding(c);
  },
};

// ════════════════════════════════════════════════════════════
// 6. Spreadsheet (Batch & MRP)
// ════════════════════════════════════════════════════════════

const D_SIZE = 6.6;
const D_LINE = "#999999";
const D_HEAD = "#eceff3";

function denseHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const fr = [1.2, 1, 1];
  const total = fr.reduce((a, b) => a + b, 0);
  const ws = fr.map((f) => (c.cw * f) / total);
  const pad = 5;
  const boxes: Array<Array<[string, { bold?: boolean; size?: number }]>> = [
    [[m.seller.name, { bold: true, size: 9 }], ...m.seller.address.map((l) => [l, {}] as [string, object]),
      [[m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "", m.seller.pan ? `PAN ${m.seller.pan}` : ""].filter(Boolean).join(" · "), {}],
      [[m.seller.phone, m.seller.email].filter(Boolean).join(" · "), {}]],
    [["Buyer", { bold: true }], [m.buyer.name, {}], ...partyLines(m.buyer, { phone: true }).map((l) => [l, {}] as [string, object]),
      ...(m.shipTo ? [[`Ship to: ${m.shipTo.address.join(", ")}`, {}] as [string, object]] : [])],
    [[`Invoice ${m.number}`, { bold: true }], [`Date ${m.date}${m.dueDate ? ` · Due ${m.dueDate}` : ""}`, {}],
      [m.placeOfSupply ? `Place of supply ${m.placeOfSupply}` : "", {}],
      ...transportPairs(m).map(([k, v]) => [`${k} ${v}`, {}] as [string, object]),
      [m.registered ? `Reverse charge: ${m.data.isReverseCharge ? "Yes" : "No"}` : "", {}]],
  ];
  const heights = boxes.map((b, i) => b.reduce((h, [s, o]) => h + textHeight(doc, s, { w: ws[i]! - 2 * pad, size: o.size ?? 7, bold: o.bold }), 0));
  const h = Math.max(...heights) + 2 * pad;
  rect(doc, c.x0, y, c.cw, h, { stroke: "#333333", lw: 0.75 });
  let x = c.x0;
  boxes.forEach((b, i) => {
    let yy = y + pad;
    for (const [s, o] of b) yy += text(doc, s, x + pad, yy, { w: ws[i]! - 2 * pad, size: o.size ?? 7, bold: o.bold });
    x += ws[i]!;
    if (i < boxes.length - 1) line(doc, x, y, x, y + h, "#333333", 0.75);
  });
  y += h + 4.5;
  const th = 13;
  rect(doc, c.x0, y, c.cw, th, { fill: "#333333" });
  text(doc, m.title.toUpperCase(), c.x0, y + 2.6, { w: c.cw, size: 7.5, bold: true, color: "#ffffff", align: "center", spacing: 1.2 });
  y += th + 4;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, c.x0, y, c.cw, { qr: 50, size: 6.6 }) + 6;
  return y;
}

function denseItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const intra = m.intra;
  const cols: Column[] = [
    { header: "#", w: 14 },
    { header: "Product", w: 0 },
    { header: "HSN", w: 34 },
    { header: "Batch", w: 34 },
    { header: "Exp", w: 32 },
    { header: "MRP", w: 34, align: "right" },
    { header: "Qty", w: 32, align: "right" },
    { header: "Free", w: 20, align: "right" },
    { header: "Rate", w: 38, align: "right" },
    { header: "Disc%", w: 24, align: "right" },
    { header: "Taxable", w: 44, align: "right" },
    ...(intra
      ? [{ header: "CGST%", w: 25, align: "right" }, { header: "CGST", w: 36, align: "right" }, { header: "SGST%", w: 25, align: "right" }, { header: "SGST", w: 36, align: "right" }] as Column[]
      : [{ header: "IGST%", w: 25, align: "right" }, { header: "IGST", w: 44, align: "right" }] as Column[]),
    { header: "Total", w: 46, align: "right" },
  ];
  const totalCol = cols.length - 1;
  const rows: Row[] = m.lines.map((l) => ({
    cells: [
      String(l.i), { text: l.name, sub: lineNote(l, { batch: true, mrp: true, free: true }) || undefined }, l.hsn, l.batch, l.expiry,
      l.mrp ? inr(l.mrp) : "", { text: qty(l.qty), sub: l.unit || undefined }, l.freeQty ? qty(l.freeQty) : "0", inr(l.rate), pct(l.discPct), inr(l.taxable),
      ...(intra ? [pct(l.gstRate / 2), inr(l.cgst), pct(l.gstRate / 2), inr(l.sgst)] : [pct(l.gstRate), inr(l.igst)]),
      inr(l.total),
    ],
    carry: l.total,
  }));
  const tot = cols.map(() => "") as Row["cells"];
  tot[1] = "Total";
  tot[6] = qty(m.qtyTotal);
  tot[10] = inr(m.lines.reduce((s, l) => s + l.taxable, 0));
  if (intra) { tot[12] = inr(m.lines.reduce((s, l) => s + l.cgst, 0)); tot[14] = inr(m.lines.reduce((s, l) => s + l.sgst, 0)); }
  else tot[12] = inr(m.lines.reduce((s, l) => s + l.igst, 0));
  tot[totalCol] = inr(m.lines.reduce((s, l) => s + l.total, 0));
  return drawTable(c, y, {
    columns: cols,
    rows,
    tail: [{ cells: tot, bold: true }],
    carry: { col: totalCol, labelCol: 1 },
    style: { size: D_SIZE, subSize: 5.8, padX: 2.5, padY: 2.2, grid: { w: 0.5, c: D_LINE }, headerFill: D_HEAD, headerBold: true, zebra: "#fafbfc", subColor: "#555555" },
    newPage,
  });
}

function denseSummary(c: Ctx, y: number): number {
  const m = c.m;
  y += 6;
  const gap = 7.5;
  const lw = (c.cw - gap) * (1.4 / 2.4);
  const rw = c.cw - gap - lw;
  const style = { size: D_SIZE, padX: 3, padY: 2.2, grid: { w: 0.5, c: D_LINE }, headerFill: D_HEAD, headerBold: true };
  const ly = m.registered && m.hasTax ? hsnTable(c, c.x0, y, lw, style) : y;
  const rows: Row[] = [];
  if (m.billDiscount > 0) rows.push({ cells: ["Discount", `-${inr(m.billDiscount)}`] });
  if (m.charges !== 0) rows.push({ cells: ["Charges", inr(m.charges)] });
  rows.push({ cells: ["Taxable", inr(m.taxable)] });
  for (const [l, v] of taxRows(m)) rows.push({ cells: [l, inr(v)] });
  if (m.tcs > 0) rows.push({ cells: ["TCS (s.206C)", inr(m.tcs)] });
  if (m.roundOff !== 0) rows.push({ cells: ["Round off", inr(m.roundOff)] });
  rows.push({ cells: ["Net payable", rs(m.grand)], bold: true });
  if (m.paid > 0) { rows.push({ cells: ["Paid", inr(m.paid)] }); rows.push({ cells: ["Balance due", rs(m.balance)], bold: true }); }
  const ry = drawTable(c, y, { x: c.x0 + lw + gap, w: rw, columns: [{ header: "Summary", w: 0, flex: 1.3 }, { header: "", w: 0, align: "right" }], rows, style, newPage: (cc) => cc.top });
  y = Math.max(ly, ry) + 5;
  y += text(c.doc, m.words, c.x0, y, { w: c.cw, size: 7.2, bold: true });
  return y;
}

function denseFoot(c: Ctx, y: number): number {
  const m = c.m;
  y += 12;
  const sigW = 150;
  const lw = c.cw - sigW - 20;
  let ly = y;
  const qr = 54;
  const hasQr = hasPayment(m) && upiQr(c, c.x0, ly, qr);
  const tx = c.x0 + (hasQr ? qr + 8 : 0);
  let by = ly;
  if (hasPayment(m)) for (const l of bankLines(m)) by += text(c.doc, l, tx, by, { w: lw - (tx - c.x0), size: 7 });
  ly = Math.max(by, hasQr ? ly + qr : by) + 4;
  ly = termsBlock(c, c.x0, ly, lw, { size: 6.8 });
  const sy = signatureBlock(c, c.x1 - sigW, y, sigW, { size: 7.2, align: "center" });
  return Math.max(ly, sy);
}

const dense: Design = {
  page: { size: A4, margins: { t: 24, r: 22.5, b: 30, l: 22.5 } },
  header: denseHeader,
  contHeader: (c, y) => contHeader(c, y, { size: 7.5, rule: "#333333" }),
  items: denseItems,
  blocks: () => [denseSummary, denseFoot],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 8, pageY: c.H - 22 }),
};

// ════════════════════════════════════════════════════════════
// 7. Landscape Wide
// ════════════════════════════════════════════════════════════

const LS_SIZE = 7;
const LS_LINE = "#222222";

function landscapeHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const fr = [1.1, 1, 1, 0.9];
  const total = fr.reduce((a, b) => a + b, 0);
  const ws = fr.map((f) => (c.cw * f) / total);
  const pad = 6;
  type L = [string, { bold?: boolean; size?: number; spacing?: number }];
  const boxes: L[][] = [
    [[m.title.toUpperCase(), { bold: true, size: 11, spacing: 0.8 }], [m.seller.name, { bold: true }], ...m.seller.address.map((l) => [l, {}] as L),
      [m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "", {}], [m.seller.phone, {}]],
    [["Bill to", { bold: true }], [m.buyer.name, {}], ...partyLines(m.buyer, { phone: true }).map((l) => [l, {}] as L)],
    [["Ship to", { bold: true }], [m.shipTo ? m.shipTo.name : m.buyer.name, {}], ...(m.shipTo ? m.shipTo.address : m.buyer.address).map((l) => [l, {}] as L)],
    [[`Invoice ${m.number}`, { bold: true }], [`Date ${m.date}`, {}], [m.dueDate ? `Due ${m.dueDate}` : "", {}],
      [m.placeOfSupply ? `Place of supply ${m.placeOfSupply}` : "", {}], ...transportPairs(m).map(([k, v]) => [`${k} ${v}`, {}] as L),
      [m.registered ? `Reverse charge: ${m.data.isReverseCharge ? "Yes" : "No"}` : "", {}]],
  ];
  const heights = boxes.map((b, i) => b.reduce((h, [s, o]) => h + textHeight(doc, s, { w: ws[i]! - 2 * pad, size: o.size ?? LS_SIZE, bold: o.bold, spacing: o.spacing }), 0));
  const h = Math.max(...heights) + 2 * pad;
  rect(doc, c.x0, y, c.cw, h, { stroke: LS_LINE, lw: 0.75 });
  let x = c.x0;
  boxes.forEach((b, i) => {
    let yy = y + pad;
    for (const [s, o] of b) yy += text(doc, s, x + pad, yy, { w: ws[i]! - 2 * pad, size: o.size ?? LS_SIZE, bold: o.bold, spacing: o.spacing });
    x += ws[i]!;
    if (i < boxes.length - 1) line(doc, x, y, x, y + h, LS_LINE, 0.75);
  });
  y += h;
  if (m.data.eInvoice?.irn) {
    const eh = c.measure((p, yy) => einvoiceBlock(p, c.x0 + pad, yy, c.cw - 2 * pad, { qr: 46, size: 6.6 })) + 2 * 4;
    rect(doc, c.x0, y, c.cw, eh, { stroke: LS_LINE, lw: 0.75 });
    einvoiceBlock(c, c.x0 + pad, y + 4, c.cw - 2 * pad, { qr: 46, size: 6.6 });
    y += eh;
  }
  return y;
}

function landscapeItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const intra = m.intra;
  const cols: Column[] = [
    { header: "#", w: 16 },
    { header: "Description", w: 0 },
    { header: "HSN", w: 42 },
    { header: "Batch", w: 42 },
    { header: "Qty", w: 38, align: "right" },
    { header: "Unit", w: 30 },
    { header: "MRP", w: 46, align: "right" },
    { header: "Rate", w: 50, align: "right" },
    { header: "Gross", w: 56, align: "right" },
    { header: "Disc %", w: 30, align: "right" },
    { header: "Disc", w: 46, align: "right" },
    { header: "Taxable", w: 58, align: "right" },
    { header: "GST %", w: 30, align: "right" },
    ...(intra ? [{ header: "CGST", w: 48, align: "right" }, { header: "SGST", w: 48, align: "right" }] as Column[] : [{ header: "IGST", w: 60, align: "right" }] as Column[]),
    { header: "Amount", w: 60, align: "right" },
  ];
  const last = cols.length - 1;
  const rows: Row[] = m.lines.map((l) => ({
    cells: [
      String(l.i), { text: l.name, sub: lineNote(l, { batch: true, mrp: true }) || undefined }, l.hsn,
      { text: l.batch, sub: l.expiry ? `Exp ${l.expiry}` : undefined }, qty(l.qty), l.unit, l.mrp ? inr(l.mrp) : "",
      inr(l.rate), inr(l.gross), pct(l.discPct), inr(l.discAmt), inr(l.taxable), pct(l.gstRate),
      ...(intra ? [inr(l.cgst), inr(l.sgst)] : [inr(l.igst)]), inr(l.total),
    ],
    carry: l.total,
  }));
  const tot = cols.map(() => "") as Row["cells"];
  tot[1] = "Total";
  tot[4] = qty(m.qtyTotal);
  tot[8] = inr(m.lines.reduce((s, l) => s + l.gross, 0));
  tot[10] = inr(m.lines.reduce((s, l) => s + l.discAmt, 0));
  tot[11] = inr(m.lines.reduce((s, l) => s + l.taxable, 0));
  if (intra) { tot[13] = inr(m.lines.reduce((s, l) => s + l.cgst, 0)); tot[14] = inr(m.lines.reduce((s, l) => s + l.sgst, 0)); }
  else tot[13] = inr(m.lines.reduce((s, l) => s + l.igst, 0));
  tot[last] = inr(m.lines.reduce((s, l) => s + l.total, 0));
  return drawTable(c, y, {
    columns: cols,
    rows,
    tail: [{ cells: tot, bold: true }],
    carry: { col: last, labelCol: 1 },
    style: { size: LS_SIZE, subSize: 6, padX: 3, padY: 2.6, grid: { w: 0.6, c: LS_LINE }, headerFill: "#f0f0f0", headerBold: true, subColor: "#555555" },
    newPage,
  });
}

function landscapeBottom(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const fr = [1.6, 1, 1];
  const total = fr.reduce((a, b) => a + b, 0);
  const ws = fr.map((f) => (c.cw * f) / total);
  const pad = 6;
  const xs = [c.x0, c.x0 + ws[0]!, c.x0 + ws[0]! + ws[1]!];
  const box1 = (cc: Ctx, yy: number) => {
    let by = yy;
    if (m.registered && m.hasTax) by = rateTable(cc, xs[0]! + pad, by, ws[0]! - 2 * pad, { size: 6.6, padX: 2.5, padY: 1.8, grid: { w: 0.5, c: "#aaaaaa" }, headerBold: true }) + 4;
    by += text(cc.doc, m.words, xs[0]! + pad, by, { w: ws[0]! - 2 * pad, size: LS_SIZE, bold: true }) + 4;
    return termsBlock(cc, xs[0]! + pad, by, ws[0]! - 2 * pad, { size: 6.6 });
  };
  const box2 = (cc: Ctx, yy: number) => {
    let by = yy;
    const qr = 56;
    const hasQr = hasPayment(m) && upiQr(cc, xs[1]! + ws[1]! - pad - qr, by, qr);
    const tw = ws[1]! - 2 * pad - (hasQr ? qr + 6 : 0);
    if (hasPayment(m)) for (const l of bankLines(m)) by += text(cc.doc, l, xs[1]! + pad, by, { w: tw, size: LS_SIZE });
    return Math.max(by, hasQr ? yy + qr : by);
  };
  const box3 = (cc: Ctx, yy: number) => {
    let by = yy;
    const w = ws[2]! - 2 * pad;
    for (const t of [...(m.billDiscount > 0 ? [`Discount ${rs(m.billDiscount)}`] : []), `Taxable ${rs(m.taxable)}`, ...taxRows(m).map(([l, v]) => `${l} ${rs(v)}`)]) {
      by += text(cc.doc, t, xs[2]! + pad, by, { w, size: LS_SIZE, align: "right" });
    }
    const gl = "Grand total ";
    const gw = textWidth(cc.doc, gl, LS_SIZE);
    const gv = rs(m.grand);
    const vw = textWidth(cc.doc, gv, 11, true);
    text(cc.doc, gl, xs[2]! + pad + w - vw - gw - 2, by + 3, { w: gw + 2, size: LS_SIZE });
    by += text(cc.doc, gv, xs[2]! + pad + w - vw - 1, by, { w: vw + 2, size: 11, bold: true, align: "right" });
    if (m.tcs > 0) by += text(cc.doc, `(incl. TCS s.206C ${inr(m.tcs)})`, xs[2]! + pad, by, { w, size: 6.6, align: "right" });
    if (m.roundOff !== 0) by += text(cc.doc, `(incl. round off ${inr(m.roundOff)})`, xs[2]! + pad, by, { w, size: 6.6, align: "right" });
    if (m.paid > 0) by += text(cc.doc, `Paid ${rs(m.paid)} · Balance ${rs(m.balance)}`, xs[2]! + pad, by, { w, size: 6.6, align: "right" });
    return signatureBlock(cc, xs[2]! + pad, by + 8, w, { size: LS_SIZE, gap: 24 });
  };
  const h = Math.max(c.measure(box1), c.measure(box2), c.measure(box3)) + 2 * pad;
  rect(doc, c.x0, y, c.cw, h, { stroke: LS_LINE, lw: 0.75 });
  line(doc, xs[1]!, y, xs[1]!, y + h, LS_LINE, 0.75);
  line(doc, xs[2]!, y, xs[2]!, y + h, LS_LINE, 0.75);
  box1(c, y + pad);
  box2(c, y + pad);
  box3(c, y + pad);
  return y + h;
}

const landscape: Design = {
  page: { size: A4_LANDSCAPE, margins: { t: 24, r: 25.5, b: 28, l: 25.5 } },
  header: landscapeHeader,
  contHeader: (c, y) => contHeader(c, y, { size: 7.5, rule: LS_LINE }),
  items: landscapeItems,
  blocks: () => [landscapeBottom],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 9, pageY: c.H - 20 }),
};

export const DESIGNS_B = { bold, minimal, dense, landscape } satisfies Record<string, Design>;
