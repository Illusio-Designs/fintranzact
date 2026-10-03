/**
 * A small layout engine on top of PDFKit for the invoice designs: text that
 * wraps and reports its height, a table that repeats its header on every
 * page and carries the running total forward, blocks that are kept together
 * (moved whole to the next page when they don't fit), copy labels and
 * "Page x of y" on every page.
 *
 * Documents are created with zero PDFKit margins and the engine keeps its own
 * content box, so PDFKit never starts a page by itself.
 */
import PDFDocument from "pdfkit";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { InvoiceModel } from "./model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/api/fonts, from src/lib/invoice-templates (source), dist/lib (the
// bundled PDF worker) or dist (the bundled server).
function fontPath(file: string): string {
  const candidates = ["../../../fonts", "../../fonts", "../fonts"].map((d) => resolve(__dirname, d, file));
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

export type Doc = InstanceType<typeof PDFDocument>;

export const R = "NotoSans";
export const B = "NotoSans-Bold";

export function registerFonts(doc: Doc) {
  doc.registerFont(R, fontPath("NotoSans-Regular.ttf"));
  doc.registerFont(B, fontPath("NotoSans-Bold.ttf"));
}

export interface PageSpec {
  size: [number, number];
  margins: { t: number; r: number; b: number; l: number };
  /** Paper colour, filled on every page (the estimate's cream). */
  background?: string;
}

export const A4: [number, number] = [595.28, 841.89];
export const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
export const A5: [number, number] = [419.53, 595.28];

// ── Text ──────────────────────────────────────────────────────

export interface TextOpts {
  w: number;
  size?: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "right" | "center" | "justify";
  oblique?: boolean;
  spacing?: number;
  lineGap?: number;
  /** Single line: clip to the width instead of wrapping (used for labels only). */
  oneLine?: boolean;
  /** Makes the text a link to this URL. */
  link?: string;
}

/** Draw text and return its height. Wraps within `w`; never truncates. */
export function text(doc: Doc, s: string, x: number, y: number, o: TextOpts): number {
  if (!s) return 0;
  doc.font(o.bold ? B : R).fontSize(o.size ?? 8).fillColor(o.color ?? "#111111");
  const opts = {
    width: o.w,
    align: o.align ?? "left",
    oblique: o.oblique ? 10 : undefined,
    characterSpacing: o.spacing,
    lineGap: o.lineGap ?? 0,
    lineBreak: !o.oneLine,
    height: o.oneLine ? (o.size ?? 8) * 1.4 : undefined,
    ellipsis: o.oneLine ? true : undefined,
  };
  doc.text(s, x, y, o.link ? { ...opts, link: o.link } : opts);
  return o.oneLine ? (o.size ?? 8) * 1.36 : doc.heightOfString(s, opts);
}

/** Height `text` would take, without drawing. */
export function textHeight(doc: Doc, s: string, o: TextOpts): number {
  if (!s) return 0;
  if (o.oneLine) return (o.size ?? 8) * 1.36;
  doc.font(o.bold ? B : R).fontSize(o.size ?? 8);
  return doc.heightOfString(s, { width: o.w, characterSpacing: o.spacing, lineGap: o.lineGap ?? 0 });
}

export function textWidth(doc: Doc, s: string, size: number, bold = false, spacing = 0): number {
  doc.font(bold ? B : R).fontSize(size);
  return doc.widthOfString(s, { characterSpacing: spacing });
}

// ── Shapes ────────────────────────────────────────────────────

export function line(doc: Doc, x1: number, y1: number, x2: number, y2: number, color = "#000000", w = 0.5, dash?: [number, number]) {
  doc.save();
  doc.lineWidth(w).strokeColor(color);
  if (dash) doc.dash(dash[0], { space: dash[1] });
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  doc.restore();
}

export function rect(doc: Doc, x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; lw?: number; radius?: number }) {
  doc.save();
  if (o.radius) doc.roundedRect(x, y, w, h, o.radius);
  else doc.rect(x, y, w, h);
  if (o.fill && o.stroke) doc.lineWidth(o.lw ?? 0.5).fillAndStroke(o.fill, o.stroke);
  else if (o.fill) doc.fill(o.fill);
  else if (o.stroke) doc.lineWidth(o.lw ?? 0.5).stroke(o.stroke);
  doc.restore();
}

/** An image from bytes or a data URL, fitted into the box; false when it can't be read. */
export function image(doc: Doc, src: Buffer | Uint8Array | string | undefined, x: number, y: number, w: number, h: number, align?: "center" | "right"): boolean {
  if (!src || src.length === 0) return false;
  try {
    const buf = typeof src === "string"
      ? Buffer.from(src.split(",")[1] ?? "", "base64")
      : Buffer.isBuffer(src) ? src : Buffer.from(src);
    if (buf.length === 0) return false;
    doc.image(buf, x, y, align ? { fit: [w, h], align } : { fit: [w, h] });
    return true;
  } catch {
    return false;
  }
}

// ── Context ───────────────────────────────────────────────────

export class Ctx {
  doc: Doc;
  readonly m: InvoiceModel;
  readonly spec: PageSpec;
  /** Copy label of the page set being drawn ("" for none). */
  copy = "";
  private scratchDoc: Doc | null = null;
  private onPage: ((c: Ctx) => void) | null = null;

  constructor(doc: Doc, m: InvoiceModel, spec: PageSpec) {
    this.doc = doc;
    this.m = m;
    this.spec = spec;
  }

  get W() { return this.spec.size[0]; }
  get H() { return this.spec.size[1]; }
  get x0() { return this.spec.margins.l; }
  get x1() { return this.spec.size[0] - this.spec.margins.r; }
  get cw() { return this.x1 - this.x0; }
  get top() { return this.spec.margins.t; }
  get bottom() { return this.spec.size[1] - this.spec.margins.b; }

  /** True while measuring on the scratch document. */
  measuring = false;

  /** Called for every new page, before anything else is drawn on it. */
  setPagePainter(fn: (c: Ctx) => void) { this.onPage = fn; }

  paintPage() {
    if (this.spec.background) rect(this.doc, 0, 0, this.W, this.H, { fill: this.spec.background });
    this.onPage?.(this);
  }

  addPage() {
    this.doc.addPage({ size: this.spec.size, margin: 0 });
    this.paintPage();
  }

  /** Height a drawing function takes, measured on a throwaway document. */
  measure(fn: (c: Ctx, y: number) => number): number {
    if (!this.scratchDoc) {
      this.scratchDoc = new PDFDocument({ size: [this.W, 50_000], margin: 0 });
      registerFonts(this.scratchDoc);
    }
    const probe = Object.create(this) as Ctx;
    probe.doc = this.scratchDoc;
    probe.measuring = true;
    const start = 100;
    return fn(probe, start) - start;
  }
}

// ── Table ─────────────────────────────────────────────────────

export type Cell = string | { text: string; bold?: boolean; sub?: string; color?: string; size?: number; oblique?: boolean; align?: "left" | "right" | "center" };

export interface Column {
  header: string;
  /** Fixed width in points; 0 takes a share of what is left. */
  w: number;
  flex?: number;
  align?: "left" | "right" | "center";
  headerAlign?: "left" | "right" | "center";
}

export interface Row {
  cells: Cell[];
  bold?: boolean;
  fill?: string;
  /** Line above this row (totals). */
  topLine?: { w: number; c: string; double?: boolean };
  /** Running total carried to the next page. */
  carry?: number;
  /** Cells spanning: index → number of columns (cell drawn across them). */
  span?: Record<number, number>;
  color?: string;
}

export interface TableStyle {
  size: number;
  subSize?: number;
  padX: number;
  padY: number;
  color?: string;
  subColor?: string;
  headerSize?: number;
  headerBold?: boolean;
  headerColor?: string;
  headerFill?: string;
  headerUpper?: boolean;
  headerSpacing?: number;
  headerPadY?: number;
  headerTop?: { w: number; c: string };
  headerBottom?: { w: number; c: string };
  rowLine?: { w: number; c: string; dash?: [number, number] };
  zebra?: string;
  /** Full grid: box, verticals and a line under every row. */
  grid?: { w: number; c: string };
  /** Box and verticals only (Tally's item table). */
  verticals?: { w: number; c: string };
  /** First column text bold (item names). */
  boldCol?: number;
}

export interface TableSpec {
  x?: number;
  w?: number;
  columns: Column[];
  rows: Row[];
  /** Rows drawn together after the body (tax lines, totals). */
  tail?: Row[];
  style: TableStyle;
  /** Empty space before the tail so the column rules run down (Tally). */
  blank?: number;
  /** Column that shows the carried-forward total, and its label column. */
  carry?: { col: number; labelCol: number };
  /** Start a new page and return the y to continue at. */
  newPage: (c: Ctx) => number;
}

export function columnWidths(cols: Column[], total: number): number[] {
  const fixed = cols.reduce((s, c) => s + (c.w || 0), 0);
  const flexTotal = cols.reduce((s, c) => s + (c.w ? 0 : c.flex ?? 1), 0);
  const left = Math.max(0, total - fixed);
  return cols.map((c) => (c.w ? c.w : (left * (c.flex ?? 1)) / (flexTotal || 1)));
}

function cellOf(c: Cell): Exclude<Cell, string> {
  return typeof c === "string" ? { text: c } : c;
}

export function drawTable(c: Ctx, y: number, t: TableSpec): number {
  const doc = () => c.doc;
  const x = t.x ?? c.x0;
  const W = t.w ?? c.cw;
  const s = t.style;
  const widths = columnWidths(t.columns, W);
  const xs: number[] = [];
  widths.reduce((acc, w) => { xs.push(acc); return acc + w; }, x);
  const color = s.color ?? "#111111";
  const subColor = s.subColor ?? "#555555";
  const subSize = s.subSize ?? s.size - 1;
  const headerSize = s.headerSize ?? s.size;
  const headerPadY = s.headerPadY ?? s.padY;

  const spanWidth = (row: Row, i: number) => {
    const n = row.span?.[i] ?? 1;
    let w = 0;
    for (let k = i; k < i + n && k < widths.length; k++) w += widths[k]!;
    return w;
  };
  const skipped = (row: Row) => {
    const set = new Set<number>();
    for (const [k, n] of Object.entries(row.span ?? {})) for (let j = Number(k) + 1; j < Number(k) + n; j++) set.add(j);
    return set;
  };

  const rowHeight = (row: Row): number => {
    let h = 0;
    const skip = skipped(row);
    row.cells.forEach((raw, i) => {
      if (skip.has(i)) return;
      const cell = cellOf(raw);
      const w = spanWidth(row, i) - 2 * s.padX;
      const bold = cell.bold ?? (row.bold || s.boldCol === i);
      let ch = textHeight(doc(), cell.text, { w, size: cell.size ?? s.size, bold });
      if (!cell.text) ch = (cell.size ?? s.size) * 1.2;
      if (cell.sub) ch += textHeight(doc(), cell.sub, { w, size: subSize });
      h = Math.max(h, ch);
    });
    return h + 2 * s.padY;
  };

  const headerHeight = () => {
    let h = 0;
    t.columns.forEach((col, i) => {
      const label = s.headerUpper ? col.header.toUpperCase() : col.header;
      h = Math.max(h, textHeight(doc(), label, { w: widths[i]! - 2 * s.padX, size: headerSize, bold: s.headerBold ?? true, spacing: s.headerSpacing }));
    });
    return h + 2 * headerPadY;
  };

  let segTop = y;
  const drawHeader = (yy: number): number => {
    const h = headerHeight();
    if (s.headerFill) rect(doc(), x, yy, W, h, { fill: s.headerFill });
    t.columns.forEach((col, i) => {
      const label = s.headerUpper ? col.header.toUpperCase() : col.header;
      text(doc(), label, xs[i]! + s.padX, yy + headerPadY, {
        w: widths[i]! - 2 * s.padX,
        size: headerSize,
        bold: s.headerBold ?? true,
        color: s.headerColor ?? color,
        align: col.headerAlign ?? col.align ?? "left",
        spacing: s.headerSpacing,
      });
    });
    if (s.headerTop) line(doc(), x, yy, x + W, yy, s.headerTop.c, s.headerTop.w);
    if (s.headerBottom) line(doc(), x, yy + h, x + W, yy + h, s.headerBottom.c, s.headerBottom.w);
    if (s.grid || s.verticals) line(doc(), x, yy + h, x + W, yy + h, (s.grid ?? s.verticals)!.c, (s.grid ?? s.verticals)!.w);
    return yy + h;
  };

  const closeSegment = (yy: number) => {
    const g = s.grid ?? s.verticals;
    if (!g) return;
    rect(doc(), x, segTop, W, yy - segTop, { stroke: g.c, lw: g.w });
    for (let i = 1; i < xs.length; i++) line(doc(), xs[i]!, segTop, xs[i]!, yy, g.c, g.w);
  };

  let zebra = 0;
  const drawRow = (row: Row, yy: number, h: number) => {
    if (row.fill) rect(doc(), x, yy, W, h, { fill: row.fill });
    else if (s.zebra && zebra % 2 === 1) rect(doc(), x, yy, W, h, { fill: s.zebra });
    if (row.topLine) {
      line(doc(), x, yy, x + W, yy, row.topLine.c, row.topLine.w);
      if (row.topLine.double) line(doc(), x, yy + 1.6, x + W, yy + 1.6, row.topLine.c, row.topLine.w);
    }
    const skip = skipped(row);
    row.cells.forEach((raw, i) => {
      if (skip.has(i)) return;
      const cell = cellOf(raw);
      const w = spanWidth(row, i) - 2 * s.padX;
      const bold = cell.bold ?? (row.bold || s.boldCol === i);
      const align = cell.align ?? t.columns[i]!.align ?? "left";
      const th = text(doc(), cell.text, xs[i]! + s.padX, yy + s.padY, {
        w, size: cell.size ?? s.size, bold, color: cell.color ?? row.color ?? color, align, oblique: cell.oblique,
      });
      if (cell.sub) text(doc(), cell.sub, xs[i]! + s.padX, yy + s.padY + th, { w, size: subSize, color: subColor, align });
    });
    if (s.grid) line(doc(), x, yy + h, x + W, yy + h, s.grid.c, s.grid.w);
    else if (s.rowLine) line(doc(), x, yy + h, x + W, yy + h, s.rowLine.c, s.rowLine.w, s.rowLine.dash);
  };

  const carryRow = (label: string, amount: number): Row => {
    const cells: Cell[] = t.columns.map(() => "");
    if (t.carry) {
      cells[t.carry.labelCol] = { text: label, oblique: true };
      cells[t.carry.col] = { text: new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100), bold: true };
    }
    return { cells };
  };

  segTop = y;
  y = drawHeader(y);
  let running = 0;
  const carryH = t.carry ? rowHeight(carryRow("Carried forward", 0)) : 0;
  const tail = t.tail ?? [];
  const tailH = tail.reduce((h, r) => h + rowHeight(r), 0);

  const breakPage = () => {
    if (t.carry) { const r = carryRow("Carried forward", running); const h = rowHeight(r); drawRow(r, y, h); y += h; }
    closeSegment(y);
    y = t.newPage(c);
    segTop = y;
    y = drawHeader(y);
    if (t.carry) { const r = carryRow("Brought forward", running); const h = rowHeight(r); drawRow(r, y, h); y += h; }
  };

  t.rows.forEach((row, idx) => {
    const h = rowHeight(row);
    const isLast = idx === t.rows.length - 1;
    // The last row must leave room for the tail rows too (they stay with it).
    const need = h + (isLast ? tailH : 0) + carryH;
    if (y + need > c.bottom && y > segTop + headerHeight() + 0.1) breakPage();
    drawRow(row, y, h);
    running += row.carry ?? 0;
    zebra++;
    y += h;
  });

  if (tail.length) {
    if (y + tailH > c.bottom) breakPage();
    const blank = Math.min(t.blank ?? 0, Math.max(0, c.bottom - y - tailH));
    y += blank;
    for (const row of tail) {
      const h = rowHeight(row);
      drawRow(row, y, h);
      y += h;
    }
  }
  closeSegment(y);
  return y;
}

// ── Blocks kept together ──────────────────────────────────────

export type Block = (c: Ctx, y: number) => number;

/** Place blocks one after another, moving any that doesn't fit to a new page. */
export function placeBlocks(c: Ctx, y: number, blocks: Block[], newPage: (c: Ctx) => number): number {
  for (const block of blocks) {
    const h = c.measure(block);
    if (h <= 0) continue;
    if (y + h > c.bottom) {
      const fresh = newPage(c);
      // A block taller than a page is drawn anyway from the top.
      y = fresh;
    }
    y = block(c, y);
  }
  return y;
}

/** The UPI "scan to pay" QR, when the invoice has one. Returns true if drawn. */
export function upiQr(c: Ctx, x: number, y: number, size: number): boolean {
  const d = c.m.data;
  if (!d.upiQrDataUrl) return false;
  const ok = image(c.doc, d.upiQrDataUrl, x, y, size, size);
  if (ok && d.upiPayUrl && !c.measuring) c.doc.link(x, y, size, size, d.upiPayUrl);
  return ok;
}

/** The IRP's signed QR, when the invoice has an IRN. */
export function irnQr(c: Ctx, x: number, y: number, size: number): boolean {
  return image(c.doc, c.m.data.eInvoice?.qrDataUrl, x, y, size, size);
}
