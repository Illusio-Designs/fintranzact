/**
 * Reads a bank statement file in the browser and returns CSV text for the
 * bank reconciliation upload. CSV passes through; Excel (.xlsx), OFX/QFX,
 * QIF and PDF are turned into rows first (see @fintranzact/shared
 * bank-statement-formats), so the API keeps taking CSV only.
 *
 * The Excel and PDF readers are loaded only when such a file is picked.
 */
import {
  ofxToRows,
  pdfItemsToRows,
  qifToRows,
  rowsToCsv,
  sheetToRows,
  type PdfTextItem,
} from "@fintranzact/shared";

/** The upload API's limit on CSV text. */
export const MAX_STATEMENT_CSV_LENGTH = 10_000_000;

export const STATEMENT_FILE_ACCEPT = ".csv,.xlsx,.ofx,.qfx,.qif,.pdf";

export type StatementFileErrorCode =
  | "unsupported"
  | "old_excel"
  | "password_required"
  | "password_incorrect"
  | "no_text"
  | "no_rows"
  | "too_large";

const MESSAGES: Record<StatementFileErrorCode, string> = {
  unsupported: "Upload a CSV, Excel (.xlsx), OFX, QFX, QIF or PDF statement.",
  old_excel: "Old Excel (.xls) files aren't supported. Save it as .xlsx or download the CSV statement instead.",
  password_required: "This PDF is password protected. Enter its password.",
  password_incorrect: "That password didn't open the PDF. Try again.",
  no_text: "This PDF has no text — download the Excel or CSV statement from net banking instead.",
  no_rows: "No transactions found in this file.",
  too_large: "This statement is over 10 MB once converted. Upload a shorter date range.",
};

export class StatementFileError extends Error {
  constructor(public code: StatementFileErrorCode) {
    super(MESSAGES[code]);
    this.name = "StatementFileError";
  }
}

export type StatementFormat = "csv" | "xlsx" | "ofx" | "qif" | "pdf";

export function statementFormatOf(fileName: string): StatementFormat {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "xlsx") return "xlsx";
  if (ext === "ofx" || ext === "qfx") return "ofx";
  if (ext === "qif") return "qif";
  if (ext === "pdf") return "pdf";
  if (ext === "xls") throw new StatementFileError("old_excel");
  throw new StatementFileError("unsupported");
}

/**
 * Convert a statement file to CSV text. Throws StatementFileError with a
 * user-facing message; for a protected PDF, call again with `password`.
 */
export async function statementFileToCsv(file: File, options: { password?: string } = {}): Promise<string> {
  const format = statementFormatOf(file.name);
  let csv: string;
  if (format === "csv") {
    csv = await file.text();
  } else {
    const rows = await readRows(file, format, options.password);
    // Header plus at least one line.
    if (rows.length < 2) throw new StatementFileError("no_rows");
    csv = rowsToCsv(rows);
  }
  if (csv.length > MAX_STATEMENT_CSV_LENGTH) throw new StatementFileError("too_large");
  return csv;
}

async function readRows(file: File, format: Exclude<StatementFormat, "csv">, password?: string): Promise<string[][]> {
  switch (format) {
    case "ofx":
      return ofxToRows(await file.text());
    case "qif":
      return qifToRows(await file.text());
    case "xlsx": {
      const { readSheet } = await import("read-excel-file/browser");
      // First sheet.
      return sheetToRows(await readSheet(await file.arrayBuffer()));
    }
    case "pdf":
      return pdfItemsToRows(await readPdfText(file, password));
  }
}

async function readPdfText(file: File, password?: string): Promise<PdfTextItem[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise;
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new StatementFileError(password ? "password_incorrect" : "password_required");
    }
    throw err;
  }

  const items: PdfTextItem[] = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          // PDF y runs upwards from the bottom; flip it.
          y: height - item.transform[5],
          width: item.width,
          height: item.height || Math.abs(item.transform[3]) || 10,
          page: pageNum,
        });
      }
    }
  } finally {
    void pdf.destroy();
  }
  if (items.length === 0) throw new StatementFileError("no_text");
  return items;
}
