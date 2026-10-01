/**
 * Statement files → CSV for the bank reconciliation upload: format by
 * extension, a real .xlsx through read-excel-file, and the PDF password and
 * no-text paths (pdfjs mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { File as NodeFile } from "node:buffer";
import JSZip from "jszip";

const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: unknown[]) => getDocument(...args),
}));

import {
  MAX_STATEMENT_CSV_LENGTH,
  StatementFileError,
  statementFileToCsv,
  statementFormatOf,
} from "../bank-statement-file";

/** A one-sheet .xlsx: string cells inline, numbers in `n` cells, dates via numFmt 14. */
async function buildXlsx(rows: (string | number | { date: number })[][]): Promise<Uint8Array> {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${col(c)}${r + 1}`;
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          if (typeof v === "object") return `<c r="${ref}" s="1"><v>${v.date}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

// jsdom's File has no text()/arrayBuffer(); Node's does.
const fileOf = (content: string | Uint8Array, name: string) => new NodeFile([content], name) as unknown as File;

beforeEach(() => getDocument.mockReset());

describe("statementFormatOf", () => {
  it("picks the format from the extension", () => {
    expect(statementFormatOf("hdfc.CSV")).toBe("csv");
    expect(statementFormatOf("sbi.xlsx")).toBe("xlsx");
    expect(statementFormatOf("icici.qfx")).toBe("ofx");
    expect(statementFormatOf("axis.ofx")).toBe("ofx");
    expect(statementFormatOf("money.qif")).toBe("qif");
    expect(statementFormatOf("kotak.pdf")).toBe("pdf");
  });

  it("explains old .xls files and rejects anything else", () => {
    expect(() => statementFormatOf("old.xls")).toThrow(/\.xls/);
    expect(() => statementFormatOf("notes.txt")).toThrow(StatementFileError);
  });
});

describe("statementFileToCsv", () => {
  it("passes CSV through", async () => {
    expect(await statementFileToCsv(fileOf("Date,Narration\n01/04/2026,X", "s.csv"))).toBe(
      "Date,Narration\n01/04/2026,X",
    );
  });

  it("reads an Excel statement from its header row", async () => {
    // 46113 = 1 April 2026 as an Excel serial date.
    const xlsx = await buildXlsx([
      ["State Bank of India"],
      ["Account No", "12345"],
      ["Txn Date", "Description", "Ref No", "Debit", "Credit", "Balance"],
      [{ date: 46113 }, "NEFT ACME, PUNE", "N1", 1250.5, "", 8749.5],
    ]);
    expect(await statementFileToCsv(fileOf(xlsx, "sbi.xlsx"))).toBe(
      'Txn Date,Description,Ref No,Debit,Credit,Balance\r\n01/04/2026,"NEFT ACME, PUNE",N1,1250.5,,8749.5',
    );
  });

  it("converts OFX", async () => {
    const ofx = "<OFX><STMTTRN><DTPOSTED>20260402<TRNAMT>-10<FITID>F1<NAME>Fee</STMTTRN></OFX>";
    expect(await statementFileToCsv(fileOf(ofx, "s.ofx"))).toBe(
      "Date,Description,Reference,Debit,Credit\r\n02/04/2026,Fee,F1,10.00,",
    );
  });

  it("says when a file has no transactions", async () => {
    await expect(statementFileToCsv(fileOf("!Type:Bank\n^", "s.qif"))).rejects.toMatchObject({ code: "no_rows" });
  });

  it("rejects CSV over the upload limit", async () => {
    const big = fileOf("a".repeat(MAX_STATEMENT_CSV_LENGTH + 1), "big.csv");
    await expect(statementFileToCsv(big)).rejects.toMatchObject({ code: "too_large" });
  });

  it("asks for a PDF password, then reports a wrong one", async () => {
    const passwordError = Object.assign(new Error("No password given"), { name: "PasswordException", code: 1 });
    getDocument.mockImplementation(() => {
      const promise = Promise.reject(passwordError);
      promise.catch(() => {});
      return { promise };
    });
    const pdf = fileOf("%PDF-1.7", "s.pdf");
    await expect(statementFileToCsv(pdf)).rejects.toMatchObject({ code: "password_required" });
    await expect(statementFileToCsv(pdf, { password: "01011990" })).rejects.toMatchObject({
      code: "password_incorrect",
    });
    expect(getDocument).toHaveBeenLastCalledWith(expect.objectContaining({ password: "01011990" }));
  });

  it("tells the user a scanned PDF has no text", async () => {
    const page = {
      getViewport: () => ({ height: 800 }),
      getTextContent: async () => ({ items: [] }),
    };
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy: async () => {} }),
    });
    await expect(statementFileToCsv(fileOf("%PDF-1.7", "scan.pdf"))).rejects.toMatchObject({
      code: "no_text",
      message: expect.stringContaining("This PDF has no text"),
    });
  });

  it("builds rows from PDF text positions", async () => {
    const item = (str: string, x: number, y: number) => ({
      str,
      transform: [10, 0, 0, 10, x, 800 - y],
      width: str.length * 5,
      height: 10,
    });
    const page = {
      getViewport: () => ({ height: 800 }),
      getTextContent: async () => ({
        items: [
          item("Date", 40, 50),
          item("Particulars", 110, 50),
          item("Debit", 300, 50),
          item("Credit", 380, 50),
          item("01/04/2026", 40, 70),
          item("Rent", 110, 70),
          item("15,000.00", 300, 70),
        ],
      }),
    };
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy: async () => {} }),
    });
    expect(await statementFileToCsv(fileOf("%PDF-1.7", "s.pdf"))).toBe(
      'Date,Particulars,Debit,Credit\r\n01/04/2026,Rent,"15,000.00",',
    );
  });
});
