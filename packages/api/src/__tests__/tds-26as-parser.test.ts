import { describe, it, expect } from "vitest";
import { parse26asAmount, parse26asCsv, parse26asDate } from "../lib/tds-26as-parser.js";

const HEADER = "Deductor Name,Deductor TAN,Section,Transaction Date,Amount Paid/Credited,Tax Deducted,TDS Deposited";

describe("parse26asDate", () => {
  it("reads TRACES, slash, dash and ISO dates as Indian calendar days", () => {
    const want = new Date("2025-06-14T18:30:00Z"); // 15 Jun 2025 00:00 IST
    expect(parse26asDate("15-Jun-2025")).toEqual(want);
    expect(parse26asDate("15/06/2025")).toEqual(want);
    expect(parse26asDate("15-06-2025")).toEqual(want);
    expect(parse26asDate("2025-06-15")).toEqual(want);
  });
  it("rejects impossible or unknown spellings", () => {
    expect(parse26asDate("31-02-2025")).toBeNull();
    expect(parse26asDate("June 2025")).toBeNull();
    expect(parse26asDate("")).toBeNull();
  });
});

describe("parse26asAmount", () => {
  it("accepts Indian grouping and currency marks, normalises to 2 places", () => {
    expect(parse26asAmount("1,23,456.5")).toBe("123456.50");
    expect(parse26asAmount("₹ 2,000")).toBe("2000.00");
  });
  it("rejects blanks, negatives and text", () => {
    expect(parse26asAmount("")).toBeNull();
    expect(parse26asAmount("-5")).toBeNull();
    expect(parse26asAmount("n/a")).toBeNull();
    expect(parse26asAmount(undefined)).toBeNull();
  });
});

describe("parse26asCsv", () => {
  it("parses the standard columns", () => {
    const r = parse26asCsv(`${HEADER}\nAcme Pvt Ltd,MUMA12345B,194C,15-Jun-2025,"1,00,000.00",2000.00,2000.00\n`);
    expect(r.skipped).toEqual([]);
    expect(r.rows).toEqual([{
      deductorTan: "MUMA12345B",
      deductorName: "Acme Pvt Ltd",
      section: "194C",
      txnDate: new Date("2025-06-14T18:30:00Z"),
      amountPaid: "100000.00",
      taxDeducted: "2000.00",
      taxDeposited: "2000.00",
    }]);
  });

  it("matches headers case-insensitively with aliases, in any order, with BOM and CRLF", () => {
    const csv = "﻿TAN OF DEDUCTOR,date of payment/credit,SECTION,Total Tax Deducted\r\nmuma12345b,2025-07-01,194J(b),500\r\n";
    const r = parse26asCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ deductorTan: "MUMA12345B", deductorName: null, section: "194J(b)", amountPaid: "0.00", taxDeducted: "500.00", taxDeposited: null });
  });

  it("handles quoted commas and tab separators", () => {
    const r = parse26asCsv(`${HEADER}\n"Smith, Jones & Co",MUMA12345B,194H,01/08/2025,10000,200,\n`);
    expect(r.rows[0]!.deductorName).toBe("Smith, Jones & Co");
    expect(r.rows[0]!.taxDeposited).toBeNull();
    const t = parse26asCsv("Deductor TAN\tSection\tTransaction Date\tTax Deducted\nMUMA12345B\t194C\t01/08/2025\t75");
    expect(t.rows[0]!.taxDeducted).toBe("75.00");
  });

  it("skips unreadable rows with their line number instead of failing the file", () => {
    const r = parse26asCsv([
      HEADER,
      "Good,MUMA12345B,194C,15-Jun-2025,1000,20,20",
      "Total,,,,,20,",
      "Bad TAN,12345,194C,15-Jun-2025,1000,20,20",
      "Bad date,MUMA12345B,194C,someday,1000,20,20",
      "Bad tax,MUMA12345B,194C,15-Jun-2025,1000,abc,20",
      "No section,MUMA12345B,,15-Jun-2025,1000,20,20",
    ].join("\n"));
    expect(r.rows).toHaveLength(1);
    expect(r.skipped.map((s) => s.line)).toEqual([3, 4, 5, 6, 7]);
  });

  it("rejects a file missing a required column, naming it", () => {
    expect(() => parse26asCsv("Deductor Name,Section\nA,194C")).toThrow(/Deductor TAN.*Transaction Date.*Tax Deducted/);
  });

  it("rejects the TRACES '^' text file and AIS JSON with a clear message instead of guessing", () => {
    expect(() => parse26asCsv("^1^Name^TAN^\n^2^x^y^")).toThrow(/Only CSV is supported/);
    expect(() => parse26asCsv('{"tds": []}')).toThrow(/Only CSV is supported/);
  });

  it("rejects an empty file", () => {
    expect(() => parse26asCsv("  \n\n")).toThrow(/empty/);
  });
});
