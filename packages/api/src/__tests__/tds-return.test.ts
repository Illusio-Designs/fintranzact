import { describe, it, expect } from "vitest";
import { buildTdsReturn, type ReturnDeducteeRow } from "../lib/tds-return.js";

const deductor = { name: "Acme Traders", tan: "MUMA12345B", pan: "AABCA1234A", gstin: "27AABCA1234A1Z5" };
const challan = { bsrCode: "0510308", challanNumber: "00041", depositedOn: new Date("2026-11-05T06:30:00Z") };

const row = (over: Partial<ReturnDeducteeRow> = {}): ReturnDeducteeRow => ({
  partyName: "CA Associates",
  pan: "AABCS1234D",
  hasPan: true,
  sectionCode: "194J_PROF",
  deductedOn: new Date("2026-10-15T06:30:00Z"),
  baseAmount: "60000.00",
  rate: "10.000",
  amount: "6000.00",
  invoiceNumber: "INV-00007",
  challan,
  ...over,
});

const base = { deductor, financialYear: "2026-27", quarter: 3 as const, challans: [] };

describe("buildTdsReturn totals", () => {
  it("adds up what was deducted, deposited and is still pending", () => {
    const r = buildTdsReturn({ ...base, rows: [row(), row({ amount: "1000.00", challan: null })] });
    expect(r.totals).toEqual({ deducted: "7000.00", deposited: "6000.00", pending: "1000.00", deducteeCount: 1 });
  });

  it("counts a deductee once however many deductions they have", () => {
    const r = buildTdsReturn({
      ...base,
      rows: [row(), row(), row({ partyName: "Rent Co", pan: "AAACR1111C" })],
    });
    expect(r.totals.deducteeCount).toBe(2);
  });

  it("is all zero with no deductions", () => {
    const r = buildTdsReturn({ ...base, rows: [] });
    expect(r.totals).toEqual({ deducted: "0.00", deposited: "0.00", pending: "0.00", deducteeCount: 0 });
    expect(r.warnings).toEqual([]);
  });
});

describe("buildTdsReturn warnings", () => {
  it("is quiet when everything is in order", () => {
    expect(buildTdsReturn({ ...base, rows: [row()] }).warnings).toEqual([]);
  });

  it("asks for the TAN, without which no return can be prepared", () => {
    const r = buildTdsReturn({ ...base, deductor: { ...deductor, tan: null }, rows: [row()] });
    expect(r.warnings[0]).toMatch(/TAN is not set/);
    expect(buildTdsReturn({ ...base, deductor: { ...deductor, tan: "  " }, rows: [] }).warnings[0]).toMatch(/TAN/);
  });

  it("names deductees with no PAN, once each, and shortens a long list", () => {
    const noPan = (name: string) => row({ partyName: name, pan: null, hasPan: false });
    const one = buildTdsReturn({ ...base, rows: [noPan("Cash Contractor"), noPan("Cash Contractor")] });
    expect(one.warnings.join(" ")).toContain("1 deductee has no PAN (Cash Contractor)");
    const many = buildTdsReturn({ ...base, rows: ["A", "B", "C", "D", "E"].map(noPan) });
    expect(many.warnings.join(" ")).toContain("5 deductees have no PAN (A, B, C, …)");
  });

  it("flags deductions that are not on a challan, with their total", () => {
    const r = buildTdsReturn({ ...base, rows: [row({ challan: null }), row({ challan: null, amount: "500.00" })] });
    expect(r.warnings.join(" ")).toMatch(/2 deductions are not on a challan yet \(6500\.00\)/);
    expect(buildTdsReturn({ ...base, rows: [row({ challan: null })] }).warnings.join(" ")).toMatch(/1 deduction is not on a challan/);
  });
});

describe("buildTdsReturn deductee CSV", () => {
  it("has a header, one line per deduction in IST dates, and a total", () => {
    const r = buildTdsReturn({ ...base, rows: [row()] });
    const lines = r.deducteeCsv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Sr No,Deductee name,PAN,Section,Date of payment / credit,Amount paid / credited,TDS rate %,TDS deducted,Higher rate (no PAN),Bill number,BSR code,Challan serial no,Challan deposit date");
    expect(lines[1]).toBe("1,CA Associates,AABCS1234D,194J_PROF,15/10/2026,60000.00,10,6000.00,No,INV-00007,0510308,00041,05/11/2026");
    expect(lines[2]).toBe(",Total,,,,60000.00,,6000.00,,,,,");
  });

  it("uses PANNOTAVBL and marks the higher rate when there is no PAN", () => {
    const r = buildTdsReturn({ ...base, rows: [row({ pan: null, hasPan: false, rate: "20.000", challan: null })] });
    expect(r.deducteeCsv.split("\n")[1]).toBe("1,CA Associates,PANNOTAVBL,194J_PROF,15/10/2026,60000.00,20,6000.00,Yes,INV-00007,,,");
  });

  it("quotes names with commas or quotes so the columns stay aligned", () => {
    const r = buildTdsReturn({ ...base, rows: [row({ partyName: 'Sharma, Verma & "Co"' })] });
    expect(r.deducteeCsv.split("\n")[1]).toMatch(/^1,"Sharma, Verma & ""Co""",AABCS1234D,/);
  });

  it("reads the date as the Indian day, not the UTC day", () => {
    // 18:45 UTC on 31 Oct is already 1 Nov in India.
    const r = buildTdsReturn({ ...base, rows: [row({ deductedOn: new Date("2026-10-31T18:45:00Z") })] });
    expect(r.deducteeCsv.split("\n")[1]).toContain(",01/11/2026,");
  });

  it("leaves the bill number blank for a deduction on an advance payment", () => {
    const r = buildTdsReturn({ ...base, rows: [row({ invoiceNumber: null })] });
    expect(r.deducteeCsv.split("\n")[1]).toContain(",No,,0510308,");
  });
});

describe("buildTdsReturn challan CSV", () => {
  it("lists each challan with the TDS it covers and totals", () => {
    const r = buildTdsReturn({
      ...base,
      rows: [],
      challans: [
        { bsrCode: "0510308", challanNumber: "00041", depositedOn: new Date("2026-11-05T06:30:00Z"), amount: "6050.00", interest: "50.00", linked: "6000.00" },
        { bsrCode: "0510309", challanNumber: "00042", depositedOn: new Date("2026-12-05T06:30:00Z"), amount: "1000.00", interest: "0.00", linked: "1000.00" },
      ],
    });
    const lines = r.challanCsv.split("\n");
    expect(lines[0]).toBe("Sr No,BSR code,Challan serial no,Date deposited,Challan amount,Interest / fee,TDS covered");
    expect(lines[1]).toBe("1,0510308,00041,05/11/2026,6050.00,50.00,6000.00");
    expect(lines[2]).toBe("2,0510309,00042,05/12/2026,1000.00,0.00,1000.00");
    expect(lines[3]).toBe(",Total,,,7050.00,50.00,7000.00");
  });
});

describe("recorded deductions keep their stored rate", () => {
  it("prints the rate stored on the row, not today's default for that year", () => {
    // A scrap sale recorded at 1% in 2025-26 stays 1% in the return even though the 2026-27 default is 2%.
    const r = buildTdsReturn({
      ...base, financialYear: "2025-26", quarter: 4 as const,
      rows: [row({ sectionCode: "206C_SCRAP", rate: "1.000", baseAmount: "100000.00", amount: "1000.00" })],
    });
    expect(r.deducteeCsv).toContain("1000.00");
    expect(r.deducteeCsv).not.toContain("2000.00");
  });
});
