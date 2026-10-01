/**
 * Renders an invoice in one of the designs from the approved gallery, one
 * page set per copy (Original / Duplicate / Triplicate), with the copy label
 * and "Page x of y" on every page.
 *
 * Bills of supply (composition dealers), export invoices and quotations /
 * proforma invoices always get their own layout, whatever design is chosen.
 */
import PDFDocument from "pdfkit";
import type { InvoiceTemplate } from "@fintranzact/shared";
import type { InvoicePDFData } from "../invoice-pdf.js";
import { Ctx, placeBlocks, registerFonts, type Block, type Doc, type PageSpec } from "./engine.js";
import { buildModel, type InvoiceModel } from "./model.js";
import { DESIGNS_A } from "./designs-a.js";
import { DESIGNS_B } from "./designs-b.js";
import { DESIGNS_C } from "./designs-c.js";

export type DesignId = Exclude<InvoiceTemplate, "classic"> | "bill_of_supply" | "export" | "estimate";

export interface Design {
  page: PageSpec | ((m: InvoiceModel) => PageSpec);
  /** Drawn on every page before its content (watermarks, bands). */
  paint?: (c: Ctx) => void;
  /** Full header on the first page of each copy; returns the y below it. */
  header: (c: Ctx, y: number) => number;
  /** Short header on the pages that follow. */
  contHeader: (c: Ctx, y: number) => number;
  /** The item table; calls newPage when it runs past the page. */
  items: (c: Ctx, y: number, newPage: (c: Ctx) => number) => number;
  /** Everything after the table, each block kept on one page. */
  blocks: (c: Ctx) => Block[];
  /** Copy label, page numbers and running footers, per page. */
  decorate: (c: Ctx, page: number, pages: number) => void;
}

export const DESIGNS: Record<DesignId, Design> = { ...DESIGNS_A, ...DESIGNS_B, ...DESIGNS_C } as Record<DesignId, Design>;

/** The layout a document actually prints in. */
export function designFor(m: InvoiceModel, template: InvoiceTemplate): DesignId | "classic" {
  if (m.kind === "estimate") return "estimate";
  if (m.kind === "bill_of_supply") return "bill_of_supply";
  if (m.kind === "export") return "export";
  return template;
}

export function renderDesign(data: InvoicePDFData, id: DesignId, m: InvoiceModel = buildModel(data, data.print?.copies ?? [])): Doc {
  const design = DESIGNS[id];
  const page = typeof design.page === "function" ? design.page(m) : design.page;
  const doc = new PDFDocument({
    size: page.size,
    margin: 0,
    bufferPages: true,
    info: {
      Title: `${m.title} ${data.invoiceNumber}`,
      Author: data.businessName,
      Subject: `${m.title} for ${data.partyName}`,
      Creator: "Fintranzact",
    },
  });
  registerFonts(doc);
  const c = new Ctx(doc, m, page);
  if (design.paint) c.setPagePainter(design.paint);

  const newPage = (cc: Ctx) => {
    cc.addPage();
    return design.contHeader(cc, cc.top);
  };

  const sets: Array<{ label: string; from: number; to: number }> = [];
  m.copies.forEach((label, k) => {
    if (k > 0) c.addPage();
    else c.paintPage();
    const from = doc.bufferedPageRange().count - 1;
    c.copy = label;
    let y = design.header(c, c.top);
    y = design.items(c, y, newPage);
    placeBlocks(c, y, design.blocks(c), newPage);
    sets.push({ label, from, to: doc.bufferedPageRange().count });
  });

  for (const set of sets) {
    const pages = set.to - set.from;
    for (let p = set.from; p < set.to; p++) {
      doc.switchToPage(p);
      c.copy = set.label;
      design.decorate(c, p - set.from + 1, pages);
    }
  }
  return doc;
}
