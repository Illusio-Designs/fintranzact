/**
 * Building blocks shared by the invoice designs: totals, tax summaries,
 * e-invoice and e-way bill details, bank / UPI, terms and the signature.
 */
import { Ctx, drawTable, image, irnQr, line, rect, text, type Column, type Row, type TableStyle } from "./engine.js";
import { date, dateTime, dispatchedThrough, inr, pct, rs, type InvoiceModel } from "./model.js";

// ── Text helpers ──────────────────────────────────────────────

export function partyLines(p: { address: string[]; gstin: string; state: string; stateCode: string; phone?: string }, o: { gstinLabel?: string; state?: boolean; phone?: boolean } = {}): string[] {
  const out = [...p.address];
  if (p.gstin) out.push(`${o.gstinLabel ?? "GSTIN"}: ${p.gstin}`);
  if (o.state !== false && p.state) out.push(`State: ${p.state}${p.stateCode ? `, Code: ${p.stateCode}` : ""}`);
  if (o.phone && p.phone) out.push(`Ph: ${p.phone}`);
  return out;
}

/** "e-Way Bill 1817 4402 6633 dt. 01-10-2026" */
export function ewbLine(m: InvoiceModel): string {
  const e = m.data.eWayBill;
  if (!e) return "";
  return `${e.number}${e.date ? ` dt. ${date(e.date)}` : ""}`;
}

export function vehicleLine(m: InvoiceModel): string {
  return dispatchedThrough(m.data);
}

export function bankLines(m: InvoiceModel): string[] {
  const d = m.data;
  const out: string[] = [];
  if (d.bankAccountNumber) {
    if (d.bankName) out.push(`Bank: ${d.bankName}`);
    out.push(`A/c No.: ${d.bankAccountNumber}`);
    if (d.bankIfsc) out.push(`IFSC: ${d.bankIfsc}`);
    if (d.bankAccountName) out.push(`A/c Name: ${d.bankAccountName}`);
  }
  if (d.upiId) out.push(`UPI: ${d.upiId}`);
  return out;
}

export function bankOneLine(m: InvoiceModel): string {
  const d = m.data;
  const parts: string[] = [];
  if (d.bankAccountNumber) {
    parts.push([d.bankName, `A/c ${d.bankAccountNumber}`, d.bankIfsc ? `IFSC ${d.bankIfsc}` : ""].filter(Boolean).join(" · "));
  }
  return parts.join(" · ");
}

export function hasPayment(m: InvoiceModel): boolean {
  return m.data.type === "sale" && !!(m.data.bankAccountNumber || m.data.upiId);
}

/** Tax head labels: "CGST @ 9%" style rows for each rate charged. */
export function taxRows(m: InvoiceModel): Array<[string, number]> {
  if (!m.hasTax) return [];
  if (!m.registered) return [["Tax", m.tax]];
  const rows: Array<[string, number]> = [];
  for (const r of m.byRate) {
    if (r.tax === 0) continue;
    if (m.intra) {
      rows.push([`CGST @ ${pct(r.rate / 2)}%`, r.cgst]);
      rows.push([`SGST @ ${pct(r.rate / 2)}%`, r.sgst]);
    } else {
      rows.push([`IGST @ ${pct(r.rate)}%`, r.igst]);
    }
  }
  return rows;
}

export interface TotalLine { label: string; value: string; grand?: boolean; strong?: boolean }

/** Every line of the totals block, in print order. */
export function totalLines(m: InvoiceModel, o: { withPaid?: boolean } = {}): TotalLine[] {
  const out: TotalLine[] = [];
  if (m.billDiscount > 0) {
    out.push({ label: "Sub-total", value: rs(m.subtotal) });
    out.push({ label: "Less: Discount", value: `-${rs(m.billDiscount)}` });
  }
  if (m.charges !== 0) out.push({ label: "Charges", value: rs(m.charges) });
  out.push({ label: "Taxable value", value: rs(m.taxable) });
  for (const [label, v] of taxRows(m)) out.push({ label, value: rs(v) });
  if (m.tcs > 0) out.push({ label: "TCS (s.206C)", value: rs(m.tcs) });
  if (m.roundOff !== 0) out.push({ label: "Round off", value: `${m.roundOff > 0 ? "+" : ""}${inr(m.roundOff)}` });
  out.push({ label: "Grand total", value: rs(m.grand), grand: true });
  if (o.withPaid !== false && m.paid > 0) {
    out.push({ label: "Amount paid", value: rs(m.paid) });
    if (m.balance > 0) out.push({ label: "Balance due", value: rs(m.balance), strong: true });
  }
  return out;
}

export interface TotalsStyle {
  size: number;
  labelColor?: string;
  valueColor?: string;
  rowGap?: number;
  grand: { size: number; fill?: string; color?: string; topLine?: string; doubleBottom?: string; padY?: number; label?: string };
}

export function drawTotals(c: Ctx, x: number, y: number, w: number, s: TotalsStyle, o: { withPaid?: boolean } = {}): number {
  const doc = c.doc;
  const gap = s.rowGap ?? 3;
  for (const t of totalLines(c.m, o)) {
    if (t.grand) {
      const g = s.grand;
      const padY = g.padY ?? 4;
      const h = g.size * 1.35 + padY * 2;
      if (g.fill) rect(doc, x, y, w, h, { fill: g.fill });
      if (g.topLine) line(doc, x, y, x + w, y, g.topLine, 0.75);
      const pad = g.fill ? 6 : 0;
      text(doc, g.label ?? "Grand total", x + pad, y + padY, { w: w / 2, size: g.size, bold: true, color: g.color ?? "#111111" });
      text(doc, t.value, x + w / 3, y + padY, { w: (w * 2) / 3 - pad, size: g.size, bold: true, color: g.color ?? "#111111", align: "right" });
      y += h;
      if (g.doubleBottom) {
        line(doc, x, y, x + w, y, g.doubleBottom, 0.75);
        line(doc, x, y + 2, x + w, y + 2, g.doubleBottom, 0.75);
        y += 4;
      }
      y += gap;
      continue;
    }
    const lh = text(doc, t.label, x, y, { w: w * 0.6, size: s.size, color: s.labelColor ?? "#444444", bold: t.strong });
    text(doc, t.value, x + w * 0.35, y, { w: w * 0.65, size: s.size, color: s.valueColor ?? "#111111", align: "right", bold: t.strong });
    y += lh + gap;
  }
  return y;
}

// ── Tax summaries ─────────────────────────────────────────────

const noBreak = (c: Ctx) => { c.addPage(); return c.top; };

export function rateTable(c: Ctx, x: number, y: number, w: number, style: TableStyle, o: { total?: boolean; label?: string } = {}): number {
  const m = c.m;
  const cols: Column[] = [{ header: o.label ?? "GST rate", w: 0, flex: 1 }, { header: "Taxable", w: 0, flex: 1.4, align: "right" }];
  if (m.intra) cols.push({ header: "CGST", w: 0, flex: 1.2, align: "right" }, { header: "SGST", w: 0, flex: 1.2, align: "right" });
  else cols.push({ header: "IGST", w: 0, flex: 1.2, align: "right" });
  cols.push({ header: "Total tax", w: 0, flex: 1.2, align: "right" });
  const rows: Row[] = m.byRate.map((r) => ({
    cells: [`${pct(r.rate)}%`, inr(r.taxable), ...(m.intra ? [inr(r.cgst), inr(r.sgst)] : [inr(r.igst)]), inr(r.tax)],
  }));
  if (o.total) rows.push({ bold: true, cells: ["Total", inr(m.taxable), ...(m.intra ? [inr(m.cgst), inr(m.sgst)] : [inr(m.igst)]), inr(m.tax)] });
  return drawTable(c, y, { x, w, columns: cols, rows, style, newPage: noBreak });
}

export function hsnTable(c: Ctx, x: number, y: number, w: number, style: TableStyle): number {
  const m = c.m;
  const cols: Column[] = [{ header: "HSN/SAC", w: 0, flex: 1.3 }, { header: "Taxable Value", w: 0, flex: 1.4, align: "right" }];
  if (m.intra) {
    cols.push(
      { header: "CGST Rate", w: 0, flex: 0.8, align: "center" }, { header: "CGST Amount", w: 0, flex: 1.2, align: "right" },
      { header: "SGST Rate", w: 0, flex: 0.8, align: "center" }, { header: "SGST Amount", w: 0, flex: 1.2, align: "right" },
    );
  } else {
    cols.push({ header: "IGST Rate", w: 0, flex: 0.8, align: "center" }, { header: "IGST Amount", w: 0, flex: 1.2, align: "right" });
  }
  cols.push({ header: "Total Tax Amount", w: 0, flex: 1.3, align: "right" });
  const rows: Row[] = m.byHsn.map((h) => ({
    cells: [
      h.hsn, inr(h.taxable),
      ...(m.intra ? [`${pct(h.rate / 2)}%`, inr(h.cgst), `${pct(h.rate / 2)}%`, inr(h.sgst)] : [`${pct(h.rate)}%`, inr(h.igst)]),
      inr(h.tax),
    ],
  }));
  rows.push({ bold: true, cells: ["Total", inr(m.taxable), ...(m.intra ? ["", inr(m.cgst), "", inr(m.sgst)] : ["", inr(m.igst)]), inr(m.tax)] });
  return drawTable(c, y, { x, w, columns: cols, rows, style, newPage: noBreak });
}

// ── E-invoice, e-way bill ─────────────────────────────────────

/** QR + IRN / Ack lines. Returns the bottom y (y when there is no IRN). */
export function einvoiceBlock(c: Ctx, x: number, y: number, w: number, o: { qr?: number; size?: number; color?: string; title?: boolean } = {}): number {
  const e = c.m.data.eInvoice;
  if (!e?.irn) return y;
  const qr = o.qr ?? 64;
  const size = o.size ?? 7;
  const drew = irnQr(c, x, y, qr);
  const tx = drew ? x + qr + 8 : x;
  const tw = w - (tx - x);
  let ty = y;
  if (o.title !== false) ty += text(c.doc, "e-Invoice", tx, ty, { w: tw, size: size + 0.5, bold: true, color: o.color });
  ty += text(c.doc, `IRN: ${e.irn}`, tx, ty, { w: tw, size, color: o.color });
  if (e.ackNumber) ty += text(c.doc, `Ack No.: ${e.ackNumber}`, tx, ty, { w: tw, size, color: o.color });
  if (e.ackDate) ty += text(c.doc, `Ack Date: ${dateTime(e.ackDate)}`, tx, ty, { w: tw, size, color: o.color });
  return Math.max(ty, drew ? y + qr : ty);
}

/** "E-way bill …", "Vehicle …" detail pairs for designs with a details list. */
export function transportPairs(m: InvoiceModel): Array<[string, string]> {
  const e = m.data.eWayBill;
  if (!e) return [];
  const out: Array<[string, string]> = [["E-way bill", ewbLine(m)]];
  const v = vehicleLine(m);
  if (v) out.push(["Vehicle", v]);
  return out;
}

// ── Bank, terms, signature ────────────────────────────────────

export function termsBlock(c: Ctx, x: number, y: number, w: number, o: { size?: number; color?: string; headColor?: string } = {}): number {
  const d = c.m.data;
  const size = o.size ?? 7;
  if (d.termsAndConditions) {
    y += text(c.doc, "Terms & Conditions", x, y, { w, size, bold: true, color: o.headColor ?? o.color ?? "#333333" });
    y += text(c.doc, d.termsAndConditions, x, y, { w, size, color: o.color ?? "#555555" }) + 4;
  }
  if (d.notes) {
    y += text(c.doc, "Notes", x, y, { w, size, bold: true, color: o.headColor ?? o.color ?? "#333333" });
    y += text(c.doc, d.notes, x, y, { w, size, color: o.color ?? "#555555" }) + 4;
  }
  return y;
}

/** "for <business>", the signature image, "Authorised Signatory". */
export function signatureBlock(c: Ctx, x: number, y: number, w: number, o: { size?: number; align?: "left" | "right" | "center"; label?: string; color?: string; gap?: number } = {}): number {
  const size = o.size ?? 7.5;
  const align = o.align ?? "right";
  y += text(c.doc, `for ${c.m.seller.name}`, x, y, { w, size, bold: true, align, color: o.color });
  const gap = o.gap ?? 28;
  const imgW = Math.min(w, 120);
  const imgX = align === "right" ? x + w - imgW : align === "center" ? x + (w - imgW) / 2 : x;
  image(c.doc, c.m.data.signatureBuffer, imgX, y + 2, imgW, gap - 4, align === "left" ? undefined : align);
  y += gap;
  y += text(c.doc, o.label ?? "Authorised Signatory", x, y, { w, size, align, color: o.color });
  return y;
}

/** Small "Powered by Fintranzact" line for free plans, on the last page of a copy. */
export function branding(c: Ctx, y?: number) {
  if (c.m.data.isPaidPlan) return;
  text(c.doc, "Powered by Fintranzact", 0, y ?? c.H - 12, { w: c.W, size: 5.5, color: "#a0a0a8", align: "center" });
}

/** Generic continuation header: seller · title · number, with a rule. */
export function contHeader(c: Ctx, y: number, o: { color?: string; size?: number; rule?: string } = {}): number {
  const size = o.size ?? 8;
  const m = c.m;
  text(c.doc, m.seller.name, c.x0, y, { w: c.cw * 0.6, size, bold: true, color: o.color });
  text(c.doc, `${m.title} ${m.number} · ${m.date} (continued)`, c.x0 + c.cw * 0.35, y, { w: c.cw * 0.65, size: size - 0.5, align: "right", color: o.color });
  y += size * 1.5 + 2;
  line(c.doc, c.x0, y, c.x1, y, o.rule ?? "#999999", 0.5);
  return y + 6;
}

/** Copy label and "Page x of y" — the default page decoration. */
export function decorateDefault(c: Ctx, page: number, pages: number, o: { labelY?: number; labelX1?: number; labelColor?: string; pageY?: number; pageColor?: string } = {}) {
  if (c.copy) {
    const x1 = o.labelX1 ?? c.x1;
    text(c.doc, c.copy, x1 - 220, o.labelY ?? Math.max(8, c.top - 18), { w: 220, size: 7, bold: true, align: "right", color: o.labelColor ?? "#111111", spacing: 0.4 });
  }
  if (pages > 1) {
    text(c.doc, `Page ${page} of ${pages}`, 0, o.pageY ?? c.H - c.spec.margins.b / 2 - 4, { w: c.W, size: 7, color: o.pageColor ?? "#666666", align: "center" });
  }
  if (page === pages) branding(c);
}


