import { describe, it, expect } from "vitest";
import { assessmentYear, buildCertificateData, certificateToBuffer, NOT_TRACES_NOTICE, type CertificateRow } from "../lib/tds-certificate.js";

const challan = { bsrCode: "0510308", challanNumber: "00041", depositedOn: new Date("2026-11-05T06:30:00Z") };
const row = (over: Partial<CertificateRow> = {}): CertificateRow => ({
  sectionCode: "194J_PROF",
  deductedOn: new Date("2026-10-15T06:30:00Z"),
  baseAmount: "60000.00",
  amount: "6000.00",
  challan,
  ...over,
});
const base = {
  kind: "tds" as const,
  deductor: { name: "Acme Traders", tan: "MUMA12345B", pan: "AABCA1234A", address: "1 Main Rd, Mumbai" },
  deductee: { name: "CA Associates", pan: "AABCS1234D" },
  financialYear: "2026-27",
  quarter: 3 as const,
};

describe("buildCertificateData", () => {
  it("sorts rows by date and totals deposited vs pending", () => {
    const d = buildCertificateData({
      ...base,
      rows: [
        row({ deductedOn: new Date("2026-12-10T06:30:00Z"), amount: "1000.00", baseAmount: "10000.00", challan: null }),
        row(),
      ],
      sectionLabels: { "194J_PROF": "Professional fees" },
    });
    expect(d.lines.map((l) => l.status)).toEqual(["deposited", "pending"]);
    expect(d.lines[0]!.sectionLabel).toBe("Professional fees");
    expect(d.totals).toEqual({ paid: "70000.00", tax: "7000.00", deposited: "6000.00", pending: "1000.00" });
    expect(d.sections).toEqual(["194J_PROF"]);
    expect(d.assessmentYear).toBe("2027-28");
    expect(d.notes[0]).toBe(NOT_TRACES_NOTICE);
    expect(d.notes.some((n) => n.includes("not yet linked"))).toBe(true);
  });

  it("leaves absent TAN and PAN blank and says so, never inventing values", () => {
    const d = buildCertificateData({
      ...base,
      deductor: { name: "Acme", tan: null, pan: null, address: null },
      deductee: { name: "X", pan: null },
      rows: [row()],
    });
    expect(d.deductor.tan).toBe("");
    expect(d.deductee.pan).toBe("");
    expect(d.notes.some((n) => n.includes("TAN is not set"))).toBe(true);
    expect(d.notes.some((n) => n.includes("PAN is not recorded"))).toBe(true);
  });

  it("titles TCS as a Form 27D style statement for the buyer", () => {
    const d = buildCertificateData({ ...base, kind: "tcs", rows: [row({ sectionCode: "206C_1H" })] });
    expect(d.title).toContain("27D");
    expect(d.notes.join(" ")).not.toContain("deductee");
  });

  it("computes the assessment year across the century digit", () => {
    expect(assessmentYear("2098-99")).toBe("2099-00");
  });
});

describe("certificateToBuffer", () => {
  it("renders a PDF", async () => {
    const buf = await certificateToBuffer(buildCertificateData({ ...base, rows: [row(), row({ challan: null })] }));
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a PDF for a party with no rows", async () => {
    const buf = await certificateToBuffer(buildCertificateData({ ...base, rows: [] }));
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
