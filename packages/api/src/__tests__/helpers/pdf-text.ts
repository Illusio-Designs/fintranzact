/**
 * Reads a generated PDF back with pdfjs (a dev dependency): page count, the size of the first page and the text of each page.
 * Used by the register PDF tests to prove the PDF parses and carries the header row, the label and the page numbers.
 */

export interface ParsedPdf {
  pages: number;
  /** [width, height] of the first page, points. */
  size: [number, number];
  text: string[];
}

export async function readPdf(buf: Buffer): Promise<ParsedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const text: string[] = [];
  let size: [number, number] = [0, 0];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    if (i === 1) {
      const v = page.getViewport({ scale: 1 });
      size = [Math.round(v.width), Math.round(v.height)];
    }
    const content = await page.getTextContent();
    text.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { pages, size, text };
}
