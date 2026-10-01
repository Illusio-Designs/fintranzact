/**
 * Gallery designs 1–3 and 13: Tally Classic, Modern GST, Corporate
 * Letterhead and the composition Bill of Supply (Tally's boxes, no tax).
 */
import { A4, Ctx, drawTable, image, line, rect, text, textHeight, upiQr, type Cell, type Column, type Row } from "./engine.js";
import { amountInWords, inr, lineNote, pct, qty, qtyUnit, type InvoiceModel } from "./model.js";
import {
  bankLines, bankOneLine, contHeader, decorateDefault, drawTotals, einvoiceBlock, ewbLine, hasPayment, hsnTable,
  partyLines, rateTable, signatureBlock, taxRows, termsBlock, transportPairs, vehicleLine,
} from "./pieces.js";
import type { Design } from "./render.js";
import { COMPOSITION_NOTICE } from "./notices.js";

// ── Shared: a label-over-value cell ───────────────────────────

interface Para { s: string; size: number; bold?: boolean; color?: string }

function parasHeight(c: Ctx, ps: Para[], w: number): number {
  return ps.reduce((h, p) => h + (p.s ? textHeight(c.doc, p.s, { w, size: p.size, bold: p.bold }) : 0), 0);
}
function drawParas(c: Ctx, ps: Para[], x: number, y: number, w: number): number {
  for (const p of ps) if (p.s) y += text(c.doc, p.s, x, y, { w, size: p.size, bold: p.bold, color: p.color });
  return y;
}

// ════════════════════════════════════════════════════════════
// 1. Tally Classic
// ════════════════════════════════════════════════════════════

const T_SIZE = 7.6;
const T_LBL = 6.6;
const T_PAD = 3.5;
const BLACK = "#000000";

function tallyTitle(c: Ctx, y: number, title: string): number {
  return y + text(c.doc, title, c.x0, y, { w: c.cw, size: 10.5, bold: true, align: "center" }) + 4;
}

function sellerParas(m: InvoiceModel): Para[] {
  const ps: Para[] = [{ s: m.seller.name, size: 9.5, bold: true }];
  if (m.seller.legalName !== m.seller.name) ps.push({ s: m.seller.legalName, size: T_SIZE });
  for (const l of m.seller.address) ps.push({ s: l, size: T_SIZE });
  if (m.seller.gstin) ps.push({ s: `GSTIN/UIN: ${m.seller.gstin}`, size: T_SIZE });
  if (m.seller.state) ps.push({ s: `State Name: ${m.seller.state}${m.seller.stateCode ? `, Code: ${m.seller.stateCode}` : ""}`, size: T_SIZE });
  if (m.seller.phone) ps.push({ s: `Ph: ${m.seller.phone}`, size: T_SIZE });
  if (m.seller.email) ps.push({ s: `E-Mail: ${m.seller.email}`, size: T_SIZE });
  return ps;
}

function buyerParas(m: InvoiceModel, label: string, ship: boolean): Para[] {
  const ps: Para[] = [{ s: label, size: T_LBL, color: "#222222" }, { s: m.buyer.name, size: 8.2, bold: true }];
  const addr = ship && m.shipTo ? m.shipTo.address : m.buyer.address;
  for (const l of addr) ps.push({ s: l, size: T_SIZE });
  if (m.buyer.gstin) ps.push({ s: `GSTIN/UIN: ${m.buyer.gstin}`, size: T_SIZE });
  if (m.buyer.state) ps.push({ s: `State Name: ${m.buyer.state}${m.buyer.stateCode ? `, Code: ${m.buyer.stateCode}` : ""}`, size: T_SIZE });
  if (!ship && m.placeOfSupply) ps.push({ s: `Place of Supply: ${m.placeOfSupply}`, size: T_SIZE });
  return ps;
}

function lv(label: string, value: string): Para[] {
  return [{ s: label, size: T_LBL, color: "#222222" }, { s: value || " ", size: T_SIZE, bold: true }];
}

/** Tally's header grid: seller and invoice fields, consignee / buyer and dispatch fields, e-invoice. */
function tallyGrid(c: Ctx, y: number): number {
  const m = c.m;
  const x = c.x0;
  const lw = c.cw * 0.52;
  const rw = (c.cw - lw) / 2;
  const doc = c.doc;
  const pw = (w: number) => w - 2 * T_PAD;

  // Section 1: seller | 3 rows of invoice fields
  const seller = sellerParas(m);
  const right1: Array<[Para[], Para[]]> = [
    [lv("Invoice No.", m.number), lv("Dated", m.date)],
    [lv("Delivery Note", ""), lv("Mode/Terms of Payment", m.dueDate ? `Due by ${m.dueDate}` : "")],
    [lv("Reverse Charge", m.data.isReverseCharge ? "Yes" : "No"), lv("Place of Supply", m.placeOfSupply)],
  ];
  const rowH = right1.map(([a, b]) => Math.max(parasHeight(c, a, pw(rw)), parasHeight(c, b, pw(rw))) + 2 * T_PAD);
  const leftH = parasHeight(c, seller, pw(lw)) + 2 * T_PAD;
  const h1 = Math.max(leftH, rowH.reduce((s, h) => s + h, 0));
  rowH[rowH.length - 1]! += h1 - rowH.reduce((s, h) => s + h, 0);
  rect(doc, x, y, c.cw, h1, { stroke: BLACK, lw: 0.75 });
  line(doc, x + lw, y, x + lw, y + h1, BLACK, 0.75);
  line(doc, x + lw + rw, y, x + lw + rw, y + h1, BLACK, 0.75);
  const logoW = 54;
  const hasLogo = image(doc, m.data.logoBuffer, x + lw - T_PAD - logoW, y + T_PAD, logoW, 36, "right");
  drawParas(c, seller, x + T_PAD, y + T_PAD, pw(lw) - (hasLogo ? logoW + 4 : 0));
  let ry = y;
  right1.forEach(([a, b], i) => {
    drawParas(c, a, x + lw + T_PAD, ry + T_PAD, pw(rw));
    drawParas(c, b, x + lw + rw + T_PAD, ry + T_PAD, pw(rw));
    ry += rowH[i]!;
    if (i < right1.length - 1) line(doc, x + lw, ry, x + c.cw, ry, BLACK, 0.75);
  });
  y += h1;

  // Section 2: consignee + buyer | dispatch row + e-invoice / delivery terms
  const consignee = buyerParas(m, "Consignee (Ship to)", true);
  const buyer = buyerParas(m, "Buyer (Bill to)", false);
  const cH = parasHeight(c, consignee, pw(lw)) + 2 * T_PAD;
  const bH = parasHeight(c, buyer, pw(lw)) + 2 * T_PAD;
  const disp: [Para[], Para[]] = [lv("Dispatch Doc No. (e-Way Bill)", ewbLine(m)), lv("Dispatched through", vehicleLine(m))];
  const dH = Math.max(parasHeight(c, disp[0], pw(rw)), parasHeight(c, disp[1], pw(rw))) + 2 * T_PAD;
  const irn = m.data.eInvoice?.irn;
  const irnH = irn ? c.measure((p, yy) => einvoiceBlock(p, x + lw + T_PAD, yy, 2 * rw - 2 * T_PAD, { qr: 62, size: 6.6 })) + 2 * T_PAD : 0;
  const termsP: Para[] = [{ s: "Terms of Delivery", size: T_LBL, color: "#222222" }];
  const right2H = dH + Math.max(irnH, parasHeight(c, termsP, pw(rw)) + 2 * T_PAD);
  const h2 = Math.max(cH + bH, right2H);
  const cH2 = cH + (h2 - cH - bH) / 2;
  rect(doc, x, y, c.cw, h2, { stroke: BLACK, lw: 0.75 });
  line(doc, x + lw, y, x + lw, y + h2, BLACK, 0.75);
  line(doc, x, y + cH2, x + lw, y + cH2, BLACK, 0.75);
  drawParas(c, consignee, x + T_PAD, y + T_PAD, pw(lw));
  drawParas(c, buyer, x + T_PAD, y + cH2 + T_PAD, pw(lw));
  line(doc, x + lw + rw, y, x + lw + rw, y + dH, BLACK, 0.75);
  line(doc, x + lw, y + dH, x + c.cw, y + dH, BLACK, 0.75);
  drawParas(c, disp[0], x + lw + T_PAD, y + T_PAD, pw(rw));
  drawParas(c, disp[1], x + lw + rw + T_PAD, y + T_PAD, pw(rw));
  if (irn) einvoiceBlock(c, x + lw + T_PAD, y + dH + T_PAD, 2 * rw - 2 * T_PAD, { qr: 62, size: 6.6 });
  else drawParas(c, termsP, x + lw + T_PAD, y + dH + T_PAD, pw(rw));
  return y + h2;
}

function tallyItems(c: Ctx, y: number, newPage: (c: Ctx) => number, o: { bos?: boolean } = {}): number {
  const m = c.m;
  const cols: Column[] = o.bos
    ? [
        { header: "Sl", w: 22, align: "center" },
        { header: "Description of Goods", w: 0 },
        { header: "HSN/SAC", w: 50, align: "center" },
        { header: "Quantity", w: 64, align: "right", headerAlign: "center" },
        { header: "Rate", w: 58, align: "right", headerAlign: "center" },
        { header: "per", w: 30, align: "center" },
        { header: "Amount", w: 72, align: "right", headerAlign: "center" },
      ]
    : [
        { header: "Sl", w: 22, align: "center" },
        { header: "Description of Goods", w: 0 },
        { header: "HSN/SAC", w: 50, align: "center" },
        { header: "Quantity", w: 60, align: "right", headerAlign: "center" },
        { header: "Rate", w: 54, align: "right", headerAlign: "center" },
        { header: "per", w: 28, align: "center" },
        { header: "Disc. %", w: 34, align: "center" },
        { header: "Amount", w: 68, align: "right", headerAlign: "center" },
      ];
  const amountCol = cols.length - 1;
  const rows: Row[] = m.lines.map((l) => {
    const amount = o.bos ? l.total : l.taxable;
    const base: Cell[] = [String(l.i), { text: l.name, bold: true, sub: lineNote(l) || undefined }, l.hsn, { text: qtyUnit(l), bold: true }, inr(l.rate), l.unit];
    return { cells: o.bos ? [...base, { text: inr(amount), bold: true }] : [...base, l.discPct ? `${pct(l.discPct)} %` : "", { text: inr(amount), bold: true }], carry: amount };
  });
  const empty = () => cols.map(() => "") as Cell[];
  const labelRow = (label: string, value: string, opts: { bold?: boolean } = {}): Row => {
    const cells = empty();
    cells[1] = { text: label, align: "right", oblique: !opts.bold, bold: opts.bold };
    cells[amountCol] = { text: value, bold: opts.bold };
    return { cells };
  };
  const tail: Row[] = [];
  if (!o.bos) {
    if (m.charges !== 0) tail.push(labelRow("Charges", inr(m.charges)));
    for (const [label, v] of taxRows(m)) tail.push(labelRow(label, inr(v)));
  } else if (m.charges !== 0) {
    tail.push(labelRow("Charges", inr(m.charges)));
  }
  if (m.roundOff !== 0) tail.push(labelRow("Round Off", inr(m.roundOff)));
  const units = new Set(m.lines.map((l) => l.unit));
  const total = empty();
  total[1] = { text: "Total", align: "right", bold: true };
  total[3] = { text: `${qty(m.qtyTotal)}${units.size === 1 && m.lines[0]?.unit ? " " + m.lines[0].unit : ""}`, bold: true };
  total[amountCol] = { text: `₹ ${inr(m.grand)}`, bold: true };
  tail.push({ cells: total, topLine: { w: 0.75, c: BLACK } });
  return drawTable(c, y, {
    columns: cols,
    rows,
    tail,
    blank: 40,
    carry: { col: amountCol, labelCol: 1 },
    style: { size: T_SIZE, subSize: 6.6, padX: 3, padY: 2.2, verticals: { w: 0.75, c: BLACK }, headerBold: true, headerPadY: 3, color: "#000000", subColor: "#333333" },
    newPage,
  });
}

function tallyWords(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const w = c.cw - 2 * T_PAD;
  const ps: Para[] = [{ s: "Amount Chargeable (in words)", size: T_LBL }, { s: amountInWords(m.grand, "INR"), size: 8, bold: true }];
  const h = parasHeight(c, ps, w) + 2 * T_PAD;
  rect(doc, c.x0, y, c.cw, h, { stroke: BLACK, lw: 0.75 });
  drawParas(c, ps, c.x0 + T_PAD, y + T_PAD, w);
  text(doc, "E. & O.E", c.x0 + T_PAD, y + T_PAD, { w, size: T_LBL, align: "right" });
  return y + h;
}

function tallyHsn(c: Ctx, y: number): number {
  const m = c.m;
  if (!m.registered || !m.hasTax) return y;
  y = hsnTable(c, c.x0, y, c.cw, { size: 6.8, padX: 3, padY: 2, grid: { w: 0.75, c: BLACK }, headerBold: true, color: "#000000" });
  const ps: Para[] = [{ s: `Tax Amount (in words): ${amountInWords(m.tax, "INR")}`, size: T_SIZE, bold: true }];
  const h = parasHeight(c, ps, c.cw - 2 * T_PAD) + 2 * T_PAD;
  rect(c.doc, c.x0, y, c.cw, h, { stroke: BLACK, lw: 0.75 });
  drawParas(c, ps, c.x0 + T_PAD, y + T_PAD, c.cw - 2 * T_PAD);
  return y + h;
}

function tallyFoot(c: Ctx, y: number, o: { declaration?: boolean } = {}): number {
  const m = c.m;
  const doc = c.doc;
  const lw = c.cw * 0.55;
  const rw = c.cw - lw;
  const left: Para[] = [];
  if (m.seller.pan) left.push({ s: `Company's PAN: ${m.seller.pan}`, size: T_SIZE, bold: true });
  if (o.declaration !== false) {
    left.push({ s: " ", size: 4 }, { s: "Declaration", size: T_SIZE, bold: true });
    left.push({ s: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.", size: T_SIZE });
  }
  const leftH = c.measure((p, yy) => termsBlock(p, c.x0, drawParas(p, left, c.x0, yy, lw - 2 * T_PAD) + 4, lw - 2 * T_PAD, { size: 6.8, color: "#222222" }));
  const bank = bankLines(m);
  const qr = 54;
  const rightH = c.measure((p, yy) => {
    let ry = yy;
    if (hasPayment(m)) {
      ry += text(p.doc, "Company's Bank Details", 0, ry, { w: rw, size: T_LBL });
      const bh = bank.reduce((s, l) => s + textHeight(p.doc, l, { w: rw - qr - 3 * T_PAD, size: T_SIZE }), 0);
      ry += Math.max(bh, m.data.upiQrDataUrl ? qr : 0) + 4;
    }
    return signatureBlock(p, 0, ry, rw - 2 * T_PAD, { size: T_SIZE });
  });
  const h = Math.max(leftH, rightH) + 2 * T_PAD;
  rect(doc, c.x0, y, c.cw, h, { stroke: BLACK, lw: 0.75 });
  line(doc, c.x0 + lw, y, c.x0 + lw, y + h, BLACK, 0.75);
  const ly = drawParas(c, left, c.x0 + T_PAD, y + T_PAD, lw - 2 * T_PAD);
  termsBlock(c, c.x0 + T_PAD, ly + 4, lw - 2 * T_PAD, { size: 6.8, color: "#222222" });
  let ry = y + T_PAD;
  const rx = c.x0 + lw + T_PAD;
  if (hasPayment(m)) {
    ry += text(doc, "Company's Bank Details", rx, ry, { w: rw - 2 * T_PAD, size: T_LBL });
    const hasQr = upiQr(c, c.x1 - T_PAD - qr, ry, qr);
    let by = ry;
    for (const l of bank) by += text(doc, l, rx, by, { w: rw - 2 * T_PAD - (hasQr ? qr + T_PAD : 0), size: T_SIZE });
    ry = Math.max(by, hasQr ? ry + qr : by) + 4;
  }
  signatureBlock(c, rx, Math.max(ry, y + h - T_PAD - c.measure((p, yy) => signatureBlock(p, 0, yy, rw - 2 * T_PAD, { size: T_SIZE }))), rw - 2 * T_PAD, { size: T_SIZE });
  y += h + 4;
  const jur = m.jurisdiction ? `SUBJECT TO ${m.jurisdiction.toUpperCase()} JURISDICTION` : "";
  if (jur) y += text(doc, jur, c.x0, y, { w: c.cw, size: 6.8, align: "center" });
  y += text(doc, "This is a Computer Generated Invoice", c.x0, y, { w: c.cw, size: 6.8, align: "center" });
  return y;
}

const TALLY_PAGE = { size: A4, margins: { t: 30, r: 30, b: 34, l: 30 } };

const tally: Design = {
  page: TALLY_PAGE,
  header: (c, y) => tallyGrid(c, tallyTitle(c, y, c.m.title)),
  contHeader: (c, y) => contHeader(c, y, { rule: BLACK, color: "#000000" }),
  items: (c, y, np) => tallyItems(c, y, np),
  blocks: () => [tallyWords, tallyHsn, (c, y) => tallyFoot(c, y)],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 12, pageY: c.H - 24 }),
};

// ════════════════════════════════════════════════════════════
// 13. Bill of Supply (composition) — Tally boxes, no tax anywhere
// ════════════════════════════════════════════════════════════


function bosHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  y = tallyTitle(c, y, "Bill of Supply");
  const nh = textHeight(doc, COMPOSITION_NOTICE, { w: c.cw - 16, size: 8.2, bold: true }) + 9;
  rect(doc, c.x0, y, c.cw, nh, { stroke: "#222222", lw: 1.1 });
  text(doc, COMPOSITION_NOTICE, c.x0 + 8, y + 4.5, { w: c.cw - 16, size: 8.2, bold: true, align: "center" });
  y += nh + 9;
  // Seller | bill no / date / transport
  const lw = c.cw * 0.55;
  const rw = c.cw - lw;
  const seller = sellerParas(m);
  const right: Para[] = [
    { s: "Bill No.", size: T_LBL }, { s: m.number, size: 8.2, bold: true },
    { s: "Date", size: T_LBL }, { s: m.date, size: 8.2, bold: true },
  ];
  const ewb = ewbLine(m);
  if (ewb) right.push({ s: "e-Way Bill", size: T_LBL }, { s: ewb, size: T_SIZE, bold: true });
  const veh = vehicleLine(m);
  if (veh) right.push({ s: "Dispatched through", size: T_LBL }, { s: veh, size: T_SIZE, bold: true });
  if (m.dueDate) right.push({ s: "Due Date", size: T_LBL }, { s: m.dueDate, size: T_SIZE, bold: true });
  const h1 = Math.max(parasHeight(c, seller, lw - 2 * T_PAD), parasHeight(c, right, rw - 2 * T_PAD)) + 2 * T_PAD;
  rect(doc, c.x0, y, c.cw, h1, { stroke: BLACK, lw: 0.75 });
  line(doc, c.x0 + lw, y, c.x0 + lw, y + h1, BLACK, 0.75);
  drawParas(c, seller, c.x0 + T_PAD, y + T_PAD, lw - 2 * T_PAD);
  drawParas(c, right, c.x0 + lw + T_PAD, y + T_PAD, rw - 2 * T_PAD);
  y += h1;
  const buyer = buyerParas(m, "Buyer (Bill to)", false);
  const h2 = parasHeight(c, buyer, c.cw - 2 * T_PAD) + 2 * T_PAD;
  rect(doc, c.x0, y, c.cw, h2, { stroke: BLACK, lw: 0.75 });
  drawParas(c, buyer, c.x0 + T_PAD, y + T_PAD, c.cw - 2 * T_PAD);
  return y + h2;
}

const billOfSupply: Design = {
  page: TALLY_PAGE,
  header: bosHeader,
  contHeader: (c, y) => contHeader(c, y, { rule: BLACK, color: "#000000" }),
  items: (c, y, np) => tallyItems(c, y, np, { bos: true }),
  blocks: () => [tallyWords, (c, y) => tallyFoot(c, y)],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 12, pageY: c.H - 24 }),
};

// ════════════════════════════════════════════════════════════
// 2. Modern GST
// ════════════════════════════════════════════════════════════

const M_ACC = "#1f6f5c";
const M_TINT = "#f2f7f5";
const M_K = "#5d6b66";
const M_SIZE = 8;
const M_SMALL = 7.2;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

function modernHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  const x = c.x0;
  const logo = 34;
  if (!image(doc, m.data.logoBuffer, x, y, logo, logo)) {
    rect(doc, x, y, logo, logo, { fill: M_ACC, radius: 8 });
    text(doc, initials(m.seller.name), x, y + 9.5, { w: logo, size: 12.5, bold: true, color: "#ffffff", align: "center" });
  }
  const tx = x + logo + 9;
  const tw = c.cw * 0.58 - logo - 9;
  let ly = y;
  ly += text(doc, m.seller.name, tx, ly, { w: tw, size: 11, bold: true });
  ly += text(doc, m.seller.address.join(", "), tx, ly, { w: tw, size: M_SMALL, color: "#555555" });
  const idLine = [m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "", m.seller.phone].filter(Boolean).join(" · ");
  ly += text(doc, idLine, tx, ly, { w: tw, size: M_SMALL });
  if (m.seller.email) ly += text(doc, m.seller.email, tx, ly, { w: tw, size: M_SMALL, color: "#555555" });
  const rw = c.cw * 0.42;
  const rx = c.x1 - rw;
  let ry = y;
  ry += text(doc, m.title.toUpperCase(), rx, ry, { w: rw, size: 19, bold: true, color: M_ACC, align: "right", spacing: 0.8 }) + 1;
  ry += text(doc, `# ${m.number}`, rx, ry, { w: rw, size: M_SMALL + 0.5, bold: true, align: "right" });
  ry += text(doc, `Date ${m.date}${m.dueDate ? ` · Due ${m.dueDate}` : ""}`, rx, ry, { w: rw, size: M_SMALL, align: "right" });
  y = Math.max(ly, ry, y + logo) + 10;
  rect(doc, x, y, c.cw, 3.75, { fill: M_ACC });
  y += 3.75 + 12;

  // Three tinted cards
  const gap = 9;
  const cw = (c.cw - 2 * gap) / 3;
  const pad = 8;
  const details: string[] = [];
  if (m.placeOfSupply) details.push(`Place of supply: ${m.placeOfSupply}`);
  for (const [k, v] of transportPairs(m)) details.push(`${k}: ${v}`);
  if (m.registered) details.push(`Reverse charge: ${m.data.isReverseCharge ? "Yes" : "No"}`);
  const cards: Array<{ k: string; name: string; lines: string[] }> = [
    { k: "Bill to", name: m.buyer.name, lines: partyLines(m.buyer, { phone: true }) },
    { k: "Ship to", name: m.shipTo ? m.shipTo.name : m.buyer.name, lines: m.shipTo ? m.shipTo.address : ["Same as billing address"] },
    { k: "Details", name: "", lines: details },
  ];
  const cardContent = (cc: Ctx, card: (typeof cards)[number], cx: number, cy: number) => {
    let yy = cy;
    yy += text(cc.doc, card.k.toUpperCase(), cx, yy, { w: cw - 2 * pad, size: 6.6, bold: true, color: M_K, spacing: 0.6 }) + 1;
    if (card.name) yy += text(cc.doc, card.name, cx, yy, { w: cw - 2 * pad, size: M_SIZE, bold: true });
    for (const l of card.lines) yy += text(cc.doc, l, cx, yy, { w: cw - 2 * pad, size: M_SMALL });
    return yy;
  };
  const ch = Math.max(...cards.map((card) => c.measure((p, yy) => cardContent(p, card, 0, yy)))) + 2 * pad;
  cards.forEach((card, i) => {
    const cx = x + i * (cw + gap);
    rect(doc, cx, y, cw, ch, { fill: M_TINT, radius: 6 });
    cardContent(c, card, cx + pad, y + pad);
  });
  y += ch + 12;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, x, y, c.cw, { qr: 56, size: 6.8 }) + 10;
  return y;
}

function modernItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "#", w: 18 },
    { header: "Item", w: 0 },
    { header: "HSN", w: 42 },
    { header: "Qty", w: 50, align: "right" },
    { header: "Rate", w: 52, align: "right" },
    { header: "Disc", w: 30, align: "right" },
    { header: "Taxable", w: 60, align: "right" },
    { header: "GST", w: 30, align: "right" },
    { header: "Amount", w: 62, align: "right" },
  ];
  const rows: Row[] = m.lines.map((l) => ({
    cells: [String(l.i), { text: l.name, bold: true, sub: lineNote(l) || undefined }, l.hsn, qtyUnit(l), inr(l.rate), l.discPct ? `${pct(l.discPct)}%` : "—", inr(l.taxable), `${pct(l.gstRate)}%`, { text: inr(l.total), bold: true }],
    carry: l.total,
  }));
  return drawTable(c, y, {
    columns: cols,
    rows,
    carry: { col: 8, labelCol: 1 },
    style: { size: M_SIZE, subSize: 6.8, padX: 5, padY: 5, headerFill: M_ACC, headerColor: "#ffffff", headerBold: true, rowLine: { w: 0.6, c: "#e3ebe8" }, zebra: "#f7faf9", subColor: "#5d6b66" },
    newPage,
  });
}

function modernBottom(c: Ctx, y: number): number {
  const m = c.m;
  y += 12;
  const lw = (c.cw - 14) * 0.55;
  const rw = c.cw - 14 - lw;
  let ly = y;
  if (m.registered && m.hasTax) {
    ly = rateTable(c, c.x0, ly, lw, { size: 7.2, padX: 3, padY: 3, headerSize: 6.4, headerUpper: true, headerColor: M_K, headerBottom: { w: 0.6, c: "#cfdcd7" }, rowLine: { w: 0.5, c: "#eef3f1" } }) + 8;
  }
  ly += text(c.doc, "AMOUNT IN WORDS", c.x0, ly, { w: lw, size: 6.6, bold: true, color: M_K, spacing: 0.6 }) + 1;
  ly += text(c.doc, m.words, c.x0, ly, { w: lw, size: M_SIZE, bold: true });
  const ry = drawTotals(c, c.x0 + lw + 14, y, rw, { size: M_SIZE, rowGap: 3, labelColor: "#333333", grand: { size: 9.8, fill: M_ACC, color: "#ffffff", padY: 5.5 } });
  return Math.max(ly, ry);
}

function modernFoot(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  y += 14;
  line(doc, c.x0, y, c.x1, y, "#e3ebe8", 0.75);
  y += 10;
  const qr = 64;
  const hasQr = hasPayment(m) && !!m.data.upiQrDataUrl;
  const sigW = 130;
  const tx = c.x0 + (hasQr ? qr + 12 : 0);
  const tw = c.x1 - sigW - 12 - tx;
  if (hasQr) upiQr(c, c.x0, y, qr);
  let ty = y;
  if (hasPayment(m)) {
    if (m.data.upiId) {
      ty += text(doc, "SCAN TO PAY WITH ANY UPI APP", tx, ty, { w: tw, size: 6.6, bold: true, color: M_K, spacing: 0.6 });
      ty += text(doc, m.data.upiId, tx, ty, { w: tw, size: M_SMALL }) + 4;
    }
    const bank = bankOneLine(m);
    if (bank) {
      ty += text(doc, "BANK", tx, ty, { w: tw, size: 6.6, bold: true, color: M_K, spacing: 0.6 });
      ty += text(doc, bank, tx, ty, { w: tw, size: M_SMALL }) + 4;
    }
  }
  ty = termsBlock(c, tx, ty, tw, { size: 6.8, color: "#555555" });
  const sy = signatureBlock(c, c.x1 - sigW, Math.max(y, Math.max(ty, hasQr ? y + qr : y) - 60), sigW, { size: M_SMALL, align: "center" });
  return Math.max(ty, sy, hasQr ? y + qr : y);
}

const modern: Design = {
  page: { size: A4, margins: { t: 32, r: 31.5, b: 36, l: 31.5 } },
  header: modernHeader,
  contHeader: (c, y) => contHeader(c, y, { rule: M_ACC }),
  items: modernItems,
  blocks: () => [modernBottom, modernFoot],
  decorate: (c, p, n) => decorateDefault(c, p, n, { labelY: 12, pageY: c.H - 24 }),
};

// ════════════════════════════════════════════════════════════
// 3. Corporate Letterhead
// ════════════════════════════════════════════════════════════

const L_ACC = "#6b1d2a";
const L_SIZE = 8;

function letterHeader(c: Ctx, y: number): number {
  const m = c.m;
  const doc = c.doc;
  if (image(doc, m.data.logoBuffer, c.x0 + c.cw / 2 - 60, y, 120, 36, "center")) y += 40;
  y += text(doc, m.seller.legalName.toUpperCase(), c.x0, y, { w: c.cw, size: 17, bold: true, color: L_ACC, align: "center", spacing: 0.4 });
  const d = m.data;
  const ids = [
    m.seller.gstin ? `GSTIN ${m.seller.gstin}` : "",
    m.seller.pan ? `PAN ${m.seller.pan}` : "",
    d.businessCin ? `CIN ${d.businessCin}` : d.businessLlpin ? `LLPIN ${d.businessLlpin}` : "",
    m.seller.email, m.seller.phone,
  ].filter(Boolean).join(" · ");
  y += text(doc, ids, c.x0, y + 2, { w: c.cw, size: 7, color: "#444444", align: "center" }) + 9;
  line(doc, c.x0, y, c.x1, y, L_ACC, 0.9);
  line(doc, c.x0, y + 2.4, c.x1, y + 2.4, L_ACC, 0.9);
  y += 14;
  y += text(doc, m.title.toUpperCase(), c.x0, y, { w: c.cw, size: 11, bold: true, color: "#222222", align: "center", spacing: 2.2 }) + 10;

  // Billed to | details list
  const gap = 15;
  const half = (c.cw - gap) / 2;
  let ly = y;
  ly += text(doc, "Billed to", c.x0, ly, { w: half, size: 7.2, color: "#666666" }) + 1;
  ly += text(doc, m.buyer.name, c.x0, ly, { w: half, size: L_SIZE, bold: true });
  for (const l of partyLines(m.buyer, { phone: true })) ly += text(doc, l, c.x0, ly, { w: half, size: L_SIZE });
  if (m.shipTo) {
    ly += 4;
    ly += text(doc, "Shipped to", c.x0, ly, { w: half, size: 7.2, color: "#666666" }) + 1;
    for (const l of m.shipTo.address) ly += text(doc, l, c.x0, ly, { w: half, size: L_SIZE });
  }
  const pairs: Array<[string, string]> = [["Invoice No.", m.number], ["Invoice date", m.date]];
  if (m.dueDate) pairs.push([m.kind === "estimate" ? "Valid till" : "Due date", m.dueDate]);
  if (m.placeOfSupply) pairs.push(["Place of supply", m.placeOfSupply]);
  if (m.registered) pairs.push(["Reverse charge", m.data.isReverseCharge ? "Yes" : "No"]);
  pairs.push(...transportPairs(m));
  const rx = c.x0 + half + gap;
  const kw = 72;
  let ry = y;
  for (const [k, v] of pairs) {
    text(doc, k, rx, ry, { w: kw, size: L_SIZE, color: "#666666" });
    ry += Math.max(textHeight(doc, k, { w: kw, size: L_SIZE }), text(doc, v, rx + kw + 6, ry, { w: half - kw - 6, size: L_SIZE, bold: true })) + 2;
  }
  y = Math.max(ly, ry) + 12;
  if (m.data.eInvoice?.irn) y = einvoiceBlock(c, c.x0, y, c.cw, { qr: 56, size: 6.8 }) + 10;
  return y;
}

function letterItems(c: Ctx, y: number, newPage: (c: Ctx) => number): number {
  const m = c.m;
  const cols: Column[] = [
    { header: "S.No.", w: 34 },
    { header: "Description", w: 0 },
    { header: "HSN", w: 42 },
    { header: "Qty", w: 46, align: "right" },
    { header: "Rate (₹)", w: 54, align: "right" },
    { header: "Taxable (₹)", w: 64, align: "right" },
  ];
  if (m.intra) cols.push({ header: "CGST", w: 52, align: "right" }, { header: "SGST", w: 52, align: "right" });
  else cols.push({ header: "IGST", w: 64, align: "right" });
  const rows: Row[] = m.lines.map((l) => ({
    cells: [
      String(l.i), { text: l.name, sub: lineNote(l) || undefined }, l.hsn, qtyUnit(l), inr(l.rate),
      { text: inr(l.taxable), sub: l.discPct ? `after ${pct(l.discPct)}% disc.` : undefined },
      ...(m.intra
        ? [{ text: inr(l.cgst), sub: `${pct(l.gstRate / 2)}%` }, { text: inr(l.sgst), sub: `${pct(l.gstRate / 2)}%` }]
        : [{ text: inr(l.igst), sub: `${pct(l.gstRate)}%` }]),
    ],
    carry: l.taxable,
  }));
  return drawTable(c, y, {
    columns: cols,
    rows,
    carry: { col: 5, labelCol: 1 },
    style: { size: L_SIZE, subSize: 6.6, padX: 4.5, padY: 4.5, headerBold: true, headerTop: { w: 0.75, c: "#222222" }, headerBottom: { w: 0.75, c: "#222222" }, rowLine: { w: 0.5, c: "#e6e1e2" }, subColor: "#666666" },
    newPage,
  });
}

function letterTotals(c: Ctx, y: number): number {
  const w = c.cw * 0.46;
  y += 8;
  y = drawTotals(c, c.x1 - w, y, w, { size: L_SIZE, rowGap: 2.5, labelColor: "#333333", grand: { size: 9.4, topLine: "#222222", doubleBottom: "#222222", padY: 3 } }, {});
  y += 6;
  y += text(c.doc, c.m.words, c.x0, y, { w: c.cw, size: L_SIZE, oblique: true });
  return y;
}

function letterSign(c: Ctx, y: number): number {
  const m = c.m;
  y += 20;
  const lw = c.cw * 0.58;
  let ly = y;
  if (hasPayment(m)) {
    const hasQr = upiQr(c, c.x0, ly, 56);
    const tx = c.x0 + (hasQr ? 64 : 0);
    let by = ly;
    for (const l of bankLines(m)) by += text(c.doc, l, tx, by, { w: lw - (tx - c.x0), size: 7.2 });
    ly = Math.max(by, hasQr ? ly + 56 : by) + 6;
  }
  ly = termsBlock(c, c.x0, ly, lw, { size: 6.8 });
  const sy = signatureBlock(c, c.x0 + lw + 20, y, c.cw - lw - 20, { size: L_SIZE, align: "center" });
  return Math.max(ly, sy);
}

const letterhead: Design = {
  page: { size: A4, margins: { t: 30, r: 31.5, b: 50, l: 31.5 } },
  header: letterHeader,
  contHeader: (c, y) => contHeader(c, y, { rule: L_ACC, color: L_ACC }),
  items: letterItems,
  blocks: () => [letterTotals, letterSign],
  decorate: (c, p, n) => {
    const m = c.m;
    const fy = c.H - 38;
    line(c.doc, c.x0, fy, c.x1, fy, L_ACC, 0.75);
    const reg = `Registered office: ${m.seller.address.join(", ")}${m.jurisdiction ? ` · This invoice is subject to ${m.jurisdiction} jurisdiction.` : ""}`;
    text(c.doc, reg, c.x0, fy + 4, { w: c.cw, size: 6.6, color: "#555555", align: "center" });
    decorateDefault(c, p, n, { labelY: 12, pageY: fy - 11 });
  },
};

export const DESIGNS_A = { tally, bill_of_supply: billOfSupply, modern, letterhead } satisfies Record<string, Design>;

