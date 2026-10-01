/**
 * Bank statement converters: OFX/QFX, QIF, spreadsheet cells and PDF text
 * become rows, then CSV for the existing bank reconciliation upload.
 */
import { describe, it, expect } from "vitest";
import {
  cellToString,
  findHeaderRowIndex,
  ofxToRows,
  parseQifDate,
  pdfItemsToRows,
  qifToRows,
  rowsToCsv,
  sheetToRows,
  trimToHeaderRow,
  type PdfTextItem,
} from "../bank-statement-formats.js";

const HEADER = ["Date", "Description", "Reference", "Debit", "Credit"];

describe("rowsToCsv", () => {
  it("quotes only cells that need it, doubling quotes", () => {
    const csv = rowsToCsv([
      ["Date", "Description", "Debit"],
      ["01/04/2026", 'NEFT, "ACME" Ltd', "1,250.00"],
      ["02/04/2026", "line one\nline two", ""],
      ["03/04/2026", " padded ", "5"],
    ]);
    expect(csv).toBe(
      [
        "Date,Description,Debit",
        '01/04/2026,"NEFT, ""ACME"" Ltd","1,250.00"',
        '02/04/2026,"line one\nline two",',
        '03/04/2026," padded ",5',
      ].join("\r\n"),
    );
  });

  it("returns an empty string for no rows", () => {
    expect(rowsToCsv([])).toBe("");
  });
});

describe("ofxToRows", () => {
  it("reads OFX 1.x SGML with unclosed leaf tags", () => {
    const sgml = [
      "OFXHEADER:100",
      "DATA:OFXSGML",
      "VERSION:102",
      "",
      "<OFX>",
      "<BANKMSGSRSV1><STMTTRNRS><STMTRS>",
      "<CURDEF>INR",
      "<BANKTRANLIST>",
      "<DTSTART>20260401",
      "<STMTTRN>",
      "<TRNTYPE>DEBIT",
      "<DTPOSTED>20260402100000.000[+5.30:IST]",
      "<TRNAMT>-1,250.50",
      "<FITID>N123456",
      "<NAME>NEFT ACME &amp; CO",
      "<MEMO>Rent April",
      "</STMTTRN>",
      "<STMTTRN>",
      "<TRNTYPE>CREDIT",
      "<DTPOSTED>20260405",
      "<TRNAMT>50000.00",
      "<CHECKNUM>000123",
      "<NAME>UPI/9876/Customer",
      "</STMTTRN>",
      "</BANKTRANLIST>",
      "<LEDGERBAL><BALAMT>48749.50<DTASOF>20260430</LEDGERBAL>",
      "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
      "</OFX>",
    ].join("\r\n");
    expect(ofxToRows(sgml)).toEqual([
      HEADER,
      ["02/04/2026", "NEFT ACME & CO - Rent April", "N123456", "1250.50", ""],
      ["05/04/2026", "UPI/9876/Customer", "000123", "", "50000.00"],
    ]);
  });

  it("reads OFX 2.x XML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
  <STMTTRN>
    <TRNTYPE>DEBIT</TRNTYPE>
    <DTPOSTED>20260315</DTPOSTED>
    <TRNAMT>-99.9</TRNAMT>
    <FITID>XYZ1</FITID>
    <NAME>Bank charges</NAME>
    <MEMO>Bank charges</MEMO>
  </STMTTRN>
  <stmttrn><dtposted>20260316</dtposted><trnamt>10</trnamt><refnum>R9</refnum><memo>Interest</memo></stmttrn>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(ofxToRows(xml)).toEqual([
      HEADER,
      ["15/03/2026", "Bank charges", "XYZ1", "99.90", ""],
      ["16/03/2026", "Interest", "R9", "", "10.00"],
    ]);
  });

  it("returns only the header when there are no transactions", () => {
    expect(ofxToRows("<OFX></OFX>")).toEqual([HEADER]);
  });
});

describe("parseQifDate", () => {
  it.each([
    ["01/04/2026", "01/04/2026"],
    ["1/4'26", "01/04/2026"],
    ["1/ 4'26", "01/04/2026"],
    ["31/12/25", "31/12/2025"],
    ["01-04-2026", "01/04/2026"],
    ["01.04.2026", "01/04/2026"],
    ["2026-04-01", "01/04/2026"],
    ["4/25/2026", "25/04/2026"], // month-first is the only reading
    ["nonsense", ""],
  ])("%s → %s", (raw, expected) => {
    expect(parseQifDate(raw)).toBe(expected);
  });

  it("reads month-first when asked", () => {
    expect(parseQifDate("4/1/2026", "mdy")).toBe("01/04/2026");
  });
});

describe("qifToRows", () => {
  it("reads bank records and skips account and category lists", () => {
    const qif = [
      "!Account",
      "NHDFC Current",
      "TBank",
      "^",
      "!Type:Bank",
      "D01/04/2026",
      "T-1,234.56",
      "PACME Supplies",
      "MInvoice 42",
      "N000777",
      "^",
      "D2/4'26",
      "U25,000.00",
      "T25,000.00",
      "PCustomer receipt",
      "^",
      "!Type:Cat",
      "NOffice",
      "^",
    ].join("\n");
    expect(qifToRows(qif)).toEqual([
      HEADER,
      ["01/04/2026", "ACME Supplies - Invoice 42", "000777", "1234.56", ""],
      ["02/04/2026", "Customer receipt", "", "", "25000.00"],
    ]);
  });

  it("keeps a last record with no closing caret", () => {
    expect(qifToRows("!Type:Bank\r\nD03/04/2026\r\nT500\r\nPCash deposit")).toEqual([
      HEADER,
      ["03/04/2026", "Cash deposit", "", "", "500.00"],
    ]);
  });
});

describe("header row detection", () => {
  const sheet = [
    ["HDFC BANK Ltd."],
    ["Statement of account from date 01/04/2026 to 30/04/2026"],
    ["Account No", "50100012345678", "Branch", "Pune"],
    [],
    ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
    ["01/04/26", "NEFT CR", "N1", "01/04/26", "", "5000", "5000"],
    ["", "", "", "", "", "", ""],
    ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
    ["02/04/26", "ATM WDL", "", "02/04/26", "1000", "", "4000"],
  ];

  it("finds the first row naming a date and an amount or narration column", () => {
    expect(findHeaderRowIndex(sheet)).toBe(4);
    expect(findHeaderRowIndex([["Txn Date", "Description", "Amount", "Dr/Cr"]])).toBe(0);
    expect(findHeaderRowIndex([["Tran Date", "Particulars", "Debit", "Credit", "Balance"]])).toBe(0);
  });

  it("ignores title lines that merely mention a date", () => {
    expect(findHeaderRowIndex([["Statement from date 01/04/2026 to 30/04/2026 debit credit"]])).toBe(-1);
    expect(findHeaderRowIndex([["Account", "Branch", "Date"]])).toBe(-1);
  });

  it("drops title rows, empty rows and repeated headers", () => {
    expect(trimToHeaderRow(sheet)).toEqual([sheet[4], sheet[5], sheet[8]]);
  });

  it("keeps every non-empty row when no header is found", () => {
    expect(trimToHeaderRow([["a", "b"], [], ["c", ""]])).toEqual([["a", "b"], ["c", ""]]);
  });
});

describe("cellToString / sheetToRows", () => {
  it("formats dates, numbers and text", () => {
    expect(cellToString(new Date(Date.UTC(2026, 3, 1)))).toBe("01/04/2026");
    // A local-midnight date in India (18:30 UTC the day before) still reads as the 1st.
    expect(cellToString(new Date("2026-03-31T18:30:00.000Z"))).toBe("01/04/2026");
    expect(cellToString(1250.5)).toBe("1250.5");
    expect(cellToString(50100012345678)).toBe("50100012345678");
    expect(cellToString(1e21)).toBe("1000000000000000000000");
    expect(cellToString(null)).toBe("");
    expect(cellToString("  NEFT\n CR  ")).toBe("NEFT CR");
    expect(cellToString(true)).toBe("TRUE");
  });

  it("finds the header and tidies ragged rows", () => {
    expect(
      sheetToRows([
        ["Statement of Account", null, null],
        [null, null, null],
        ["Txn Date", "Description", "Debit", "Credit", null],
        [new Date(Date.UTC(2026, 3, 2)), "Rent", 15000, null, null],
      ]),
    ).toEqual([
      ["Txn Date", "Description", "Debit", "Credit"],
      ["02/04/2026", "Rent", "15000"],
    ]);
  });
});

describe("pdfItemsToRows", () => {
  // Builds a text run; width is 5 units per character.
  const t = (str: string, x: number, y: number, page = 1): PdfTextItem => ({
    str,
    x,
    y,
    width: str.length * 5,
    height: 10,
    page,
  });
  // Columns: Date @40, Narration @110, Withdrawal @300 (right-aligned to ~360), Deposit @380, Balance @460
  const header = (y: number, page: number) => [
    t("Date", 40, y, page),
    t("Narration", 110, y, page),
    t("Withdrawal", 300, y, page),
    t("Deposit", 380, y, page),
    t("Balance", 460, y, page),
  ];

  it("keeps rows from the header on, by column, across pages", () => {
    const items: PdfTextItem[] = [
      t("STATE BANK OF INDIA", 40, 20),
      t("Account Number: 1234", 40, 35),
      ...header(80, 1),
      t("01/04/2026", 40, 100),
      t("NEFT ACME", 110, 100),
      t("SUPPLIES PVT LTD", 110, 111), // wrapped narration
      t("1,250.00", 320, 100),
      t("8,750.00", 460, 100),
      t("02/04/2026", 40, 130),
      t("UPI CUSTOMER", 110, 130),
      t("500.00", 385, 130),
      t("9,250.00", 460, 130),
      // Page 2: furniture, repeated header, one row.
      t("STATE BANK OF INDIA", 40, 20, 2),
      t("Page 2", 460, 20, 2),
      ...header(80, 2),
      t("03/04/2026", 40, 100, 2),
      t("ATM", 110, 100, 2),
      t("100.00", 330, 100, 2),
      t("9,150.00", 460, 100, 2),
    ];
    expect(pdfItemsToRows(items)).toEqual([
      ["Date", "Narration", "Withdrawal", "Deposit", "Balance"],
      ["01/04/2026", "NEFT ACME SUPPLIES PVT LTD", "1,250.00", "", "8,750.00"],
      ["02/04/2026", "UPI CUSTOMER", "", "500.00", "9,250.00"],
      ["03/04/2026", "ATM", "100.00", "", "9,150.00"],
    ]);
  });

  it("joins runs split mid-word and keeps far-apart text separate", () => {
    const rows = pdfItemsToRows([
      t("Txn", 40, 50),
      t("Date", 60, 50),
      t("Description", 110, 50),
      t("Amount", 300, 50),
      t("05/04/2026", 40, 70),
      t("Interest", 110, 70),
      t("42.00", 305, 70),
    ]);
    expect(rows).toEqual([
      ["Txn Date", "Description", "Amount"],
      ["05/04/2026", "Interest", "42.00"],
    ]);
  });

  it("returns nothing for a PDF with no text", () => {
    expect(pdfItemsToRows([])).toEqual([]);
  });

  it("falls back to gap-split lines when no header is found", () => {
    expect(pdfItemsToRows([t("Hello", 40, 10), t("World", 300, 10)])).toEqual([["Hello", "World"]]);
  });
});
