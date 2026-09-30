import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import { encodeCode128, encodeEan13, isValidEan13 } from "./barcode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../fonts/NotoSans-Bold.ttf");

/**
 * label-pdf.ts — barcode label sheets for inventory.
 *
 * WHY TWO OUTPUT SHAPES:
 * Shops print labels on two very different devices. A sheet preset lays
 * labels out in a grid on A4 for an office printer feeding adhesive label
 * stock; a roll preset emits one label per page sized to the media, which is
 * what a dedicated thermal label printer expects. Same drawing code,
 * different page geometry.
 *
 * Everything is in PDF points (1/72 inch), converted from the millimetre
 * dimensions that label stock is actually sold in.
 */

const MM = 72 / 25.4;

export interface LabelPreset {
  id: string;
  name: string;
  /** "A4", or explicit page dimensions in points for roll media. */
  page: "A4" | { width: number; height: number };
  columns: number;
  rows: number;
  labelWidth: number;
  labelHeight: number;
  marginX: number;
  marginY: number;
  gapX: number;
  gapY: number;
}

export const LABEL_PRESETS: Record<string, LabelPreset> = {
  // 63.5 x 38.1 mm, 3 across x 7 down — the most widely stocked A4 sheet.
  a4_21: {
    id: "a4_21",
    name: "A4 sheet, 21 labels (63.5 x 38.1 mm)",
    page: "A4",
    columns: 3,
    rows: 7,
    labelWidth: 63.5 * MM,
    labelHeight: 38.1 * MM,
    marginX: 7.2 * MM,
    marginY: 15.1 * MM,
    gapX: 2.5 * MM,
    gapY: 0,
  },
  // 38.1 x 21.2 mm, 5 across x 13 down — small price labels.
  a4_65: {
    id: "a4_65",
    name: "A4 sheet, 65 labels (38.1 x 21.2 mm)",
    page: "A4",
    columns: 5,
    rows: 13,
    labelWidth: 38.1 * MM,
    labelHeight: 21.2 * MM,
    marginX: 5.7 * MM,
    marginY: 10.7 * MM,
    gapX: 2.5 * MM,
    gapY: 0,
  },
  // Fixed label per barcode type (Settings → Barcodes). One label per page
  // at the exact roll size, so a thermal printer's driver needs no scaling.
  type_ean13: {
    id: "type_ean13",
    name: "EAN-13 label, 50 x 25 mm",
    page: { width: 50 * MM, height: 25 * MM },
    columns: 1,
    rows: 1,
    labelWidth: 50 * MM,
    labelHeight: 25 * MM,
    marginX: 0,
    marginY: 0,
    gapX: 0,
    gapY: 0,
  },
  type_code128: {
    id: "type_code128",
    name: "Code 128 label, 75 x 25 mm",
    page: { width: 75 * MM, height: 25 * MM },
    columns: 1,
    rows: 1,
    labelWidth: 75 * MM,
    labelHeight: 25 * MM,
    marginX: 0,
    marginY: 0,
    gapX: 0,
    gapY: 0,
  },
  // 38 x 25 mm labels two across a 78 mm roll (2 mm gap between them).
  type_qr: {
    id: "type_qr",
    name: "QR label, 38 x 25 mm, 2 across",
    page: { width: 78 * MM, height: 25 * MM },
    columns: 2,
    rows: 1,
    labelWidth: 38 * MM,
    labelHeight: 25 * MM,
    marginX: 0,
    marginY: 0,
    gapX: 2 * MM,
    gapY: 0,
  },
  // Continuous roll: one label per page.
  roll_50x25: {
    id: "roll_50x25",
    name: "Thermal roll, 50 x 25 mm",
    page: { width: 50 * MM, height: 25 * MM },
    columns: 1,
    rows: 1,
    labelWidth: 50 * MM,
    labelHeight: 25 * MM,
    marginX: 0,
    marginY: 0,
    gapX: 0,
    gapY: 0,
  },
};

export interface LabelItem {
  name: string;
  barcode: string;
  /** Pre-formatted for display; the caller owns currency and rounding. */
  price?: string;
  /** e.g. "Size: M, Color: Red" */
  variantLabel?: string;
  /** How many copies of this label to print. */
  quantity: number;
}

export type LabelSymbology = "code128" | "ean13" | "qr";

/** Preset used for each barcode type's fixed label. */
export const TYPE_PRESET: Record<LabelSymbology, string> = {
  ean13: "type_ean13",
  code128: "type_code128",
  qr: "type_qr",
};

export interface LabelSheetData {
  businessName: string;
  presetId: string;
  /**
   * How to draw codes. EAN-13 draws real EAN bars when the code is a valid
   * EAN-13 and falls back to Code 128 otherwise (a supplier's UPC or SKU
   * code still scans to the same value). Defaults to Code 128.
   */
  symbology?: LabelSymbology;
  items: LabelItem[];
  showPrice: boolean;
  showName: boolean;
}

/** A label that could not be printed, and why. */
export interface SkippedLabel {
  name: string;
  reason: string;
}

export interface LabelSheetResult {
  pdf: Buffer;
  printed: number;
  skipped: SkippedLabel[];
}

/** Hard ceiling per item, so one bad quantity cannot spool thousands of pages. */
const MAX_COPIES_PER_ITEM = 500;

/** One printer dot at 203 dpi (the common thermal head), in points. */
const DOT_203 = 72 / 203;

/**
 * Round a module width down to whole 203-dpi printer dots. Bars that fall
 * between dots print unevenly and scan badly; a whole-dot module keeps every
 * bar the same width. Below one dot the raw width is kept.
 */
function snapModule(width: number) {
  const dots = Math.floor(width / DOT_203);
  return dots >= 1 ? dots * DOT_203 : width;
}

/** "2000000000039" → "2 000000 000039", as printed under retail EAN bars. */
function eanHumanText(code: string) {
  return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
}

/** QR on the left, name / code / price on the right. */
function drawQrLabel(
  doc: InstanceType<typeof PDFDocument>,
  item: LabelItem,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { showPrice: boolean; showName: boolean },
) {
  const pad = Math.min(4, h * 0.08);
  const qr = QRCode.create(item.barcode, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  // The symbol plus a 2-module quiet zone must fit the label height.
  const moduleW = snapModule((h - pad * 2) / (size + 4));
  const side = moduleW * size;
  const qx = x + pad + moduleW * 2;
  const qy = y + (h - side) / 2;
  doc.fillColor("#000000");
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.modules.get(r, c)) doc.rect(qx + c * moduleW, qy + r * moduleW, moduleW, moduleW).fill();
    }
  }

  const tx = qx + side + moduleW * 2;
  const tw = x + w - pad - tx;
  let cursorY = y + pad + 1;
  if (opts.showName && item.name) {
    const nameSize = Math.max(5, Math.min(7, h * 0.1));
    doc.font("NotoSans-Bold").fontSize(nameSize).fillColor("#000000");
    doc.text(item.name, tx, cursorY, { width: tw, height: nameSize * 2.6, ellipsis: true });
    cursorY += nameSize * 2.7;
    if (item.variantLabel) {
      doc.font("NotoSans").fontSize(nameSize - 1).fillColor("#444444");
      doc.text(item.variantLabel, tx, cursorY, { width: tw, lineBreak: false, ellipsis: true });
      cursorY += nameSize * 1.3;
    }
  }
  const codeSize = Math.max(4.5, Math.min(6, h * 0.08));
  doc.font("NotoSans").fontSize(codeSize).fillColor("#000000");
  doc.text(item.barcode, tx, cursorY, { width: tw, lineBreak: false, ellipsis: true });
  cursorY += codeSize * 1.4;
  if (opts.showPrice && item.price) {
    const priceSize = Math.max(6, Math.min(9, h * 0.13));
    doc.font("NotoSans-Bold").fontSize(priceSize);
    doc.text(item.price, tx, cursorY, { width: tw, lineBreak: false, ellipsis: true });
  }
}

/**
 * Draw one label into the box at (x, y).
 *
 * Layout is top-down and deliberately forgiving: the name clips to one line,
 * the barcode takes whatever vertical space is left, and the human-readable
 * value always sits directly beneath the bars — that is what a cashier reads
 * out when a scan fails, so it never gets squeezed out by a long name.
 */
function drawLabel(
  doc: InstanceType<typeof PDFDocument>,
  item: LabelItem,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { showPrice: boolean; showName: boolean; symbology?: LabelSymbology },
) {
  if (opts.symbology === "qr") {
    drawQrLabel(doc, item, x, y, w, h, opts);
    return;
  }
  const padX = Math.min(4, w * 0.06);
  const padY = Math.min(3, h * 0.06);
  const innerW = w - padX * 2;

  let cursorY = y + padY;

  if (opts.showName && item.name) {
    const nameSize = Math.max(5, Math.min(7.5, h * 0.09));
    doc.font("NotoSans-Bold").fontSize(nameSize).fillColor("#000000");
    doc.text(item.name, x + padX, cursorY, {
      width: innerW,
      lineBreak: false,
      ellipsis: true,
    });
    cursorY += nameSize * 1.3;

    if (item.variantLabel) {
      const varSize = Math.max(4.5, nameSize - 1.5);
      doc.font("NotoSans").fontSize(varSize).fillColor("#444444");
      doc.text(item.variantLabel, x + padX, cursorY, {
        width: innerW,
        lineBreak: false,
        ellipsis: true,
      });
      cursorY += varSize * 1.25;
    }
  }

  // Reserve the bottom strip for the readable code and price, then give the
  // bars everything left in between.
  const codeSize = Math.max(4.5, Math.min(6.5, h * 0.08));
  const priceSize = Math.max(6, Math.min(9, h * 0.12));
  const footerH =
    codeSize * 1.3 + (opts.showPrice && item.price ? priceSize * 1.25 : 0);
  const barsH = Math.max(6, y + h - padY - footerH - cursorY);

  const ean = opts.symbology === "ean13" && isValidEan13(item.barcode);
  const encoded = ean ? encodeEan13(item.barcode) : encodeCode128(item.barcode);
  const moduleW = snapModule(innerW / encoded.modules);
  // Centre the symbol: snapping the module to printer dots leaves spare room.
  const left = x + padX + (innerW - moduleW * encoded.modules) / 2;

  doc.fillColor("#000000");
  for (const bar of encoded.bars) {
    doc.rect(left + bar.x * moduleW, cursorY, bar.width * moduleW, barsH).fill();
  }
  cursorY += barsH + 1;

  doc.font("NotoSans").fontSize(codeSize).fillColor("#000000");
  doc.text(ean ? eanHumanText(item.barcode) : item.barcode, x + padX, cursorY, {
    width: innerW,
    align: "center",
    lineBreak: false,
    ellipsis: true,
  });
  cursorY += codeSize * 1.3;

  if (opts.showPrice && item.price) {
    doc.font("NotoSans-Bold").fontSize(priceSize).fillColor("#000000");
    doc.text(item.price, x + padX, cursorY, {
      width: innerW,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });
  }
}

export function generateLabelSheetPDF(
  data: LabelSheetData,
): Promise<LabelSheetResult> {
  const preset = LABEL_PRESETS[data.presetId] ?? LABEL_PRESETS.a4_21;

  // Expand quantities into one entry per physical label, dropping anything
  // that cannot be encoded rather than failing the whole sheet — a single bad
  // code should not cost the user the other sixty labels. What was dropped is
  // reported back so the UI can say so.
  const skipped: SkippedLabel[] = [];
  const slots: LabelItem[] = [];

  for (const item of data.items) {
    if (!item.barcode?.trim()) {
      skipped.push({ name: item.name, reason: "no barcode set" });
      continue;
    }
    try {
      if (data.symbology === "qr") QRCode.create(item.barcode, { errorCorrectionLevel: "M" });
      else if (!(data.symbology === "ean13" && isValidEan13(item.barcode))) encodeCode128(item.barcode);
    } catch (err) {
      skipped.push({
        name: item.name,
        reason: err instanceof Error ? err.message : "cannot be encoded",
      });
      continue;
    }
    const copies = Math.max(0, Math.min(item.quantity, MAX_COPIES_PER_ITEM));
    for (let i = 0; i < copies; i++) slots.push(item);
  }

  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({
      size:
        preset.page === "A4" ? "A4" : [preset.page.width, preset.page.height],
      margin: 0,
      bufferPages: true,
      info: {
        Title: "Barcode labels",
        Author: data.businessName,
        Creator: "Fintranzact",
      },
    });

    doc.registerFont("NotoSans", FONT_REGULAR);
    doc.registerFont("NotoSans-Bold", FONT_BOLD);

    const perPage = preset.columns * preset.rows;
    const opts = { showPrice: data.showPrice, showName: data.showName, symbology: data.symbology };

    slots.forEach((item, index) => {
      const slot = index % perPage;
      if (index > 0 && slot === 0) doc.addPage();

      const col = slot % preset.columns;
      const row = Math.floor(slot / preset.columns);
      const x = preset.marginX + col * (preset.labelWidth + preset.gapX);
      const y = preset.marginY + row * (preset.labelHeight + preset.gapY);

      drawLabel(doc, item, x, y, preset.labelWidth, preset.labelHeight, opts);
    });

    // An empty run still yields a valid single blank page, so callers surface
    // `skipped` rather than handling a special "nothing to print" case.
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () =>
      resolvePromise({
        pdf: Buffer.concat(chunks),
        printed: slots.length,
        skipped,
      }),
    );
    doc.on("error", reject);
    doc.end();
  });
}
