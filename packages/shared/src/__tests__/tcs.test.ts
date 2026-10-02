import { describe, it, expect } from "vitest";
import {
  computeTcs,
  defaultTcsSectionRules,
  tcsDepositDueDate,
  tcsRateForSection,
  tcsReturnDueDate,
  tcsSectionCodes,
  type TcsSectionRule,
} from "../tcs.js";
import { formatIstDate } from "../dates.js";

const rule = (code: string): TcsSectionRule => defaultTcsSectionRules("2026-27").find((s) => s.code === code)!;

describe("defaultTcsSectionRules", () => {
  it("covers each s.206C case with its rate", () => {
    const rates = Object.fromEntries(defaultTcsSectionRules("2026-27").map((s) => [s.code, s.rate]));
    expect(rates).toEqual({
      "206C_ALCOHOL": "1", "206C_TENDU": "5", "206C_TIMBER_LEASE": "2.5", "206C_TIMBER_OTHER": "2.5", "206C_FOREST": "2.5",
      "206C_SCRAP": "1", "206C_MINERALS": "1", "206C_PARKING": "2", "206C_VEHICLE": "1",
    });
    expect(tcsSectionCodes).toHaveLength(9);
  });

  it("uses twice the rate, or 5%, whichever is higher, when the buyer has no PAN (s.206CC)", () => {
    expect(tcsRateForSection(rule("206C_SCRAP"), false)).toBe("5"); // 2 x 1 = 2, under 5
    expect(tcsRateForSection(rule("206C_TENDU"), false)).toBe("10"); // 2 x 5 = 10
    expect(tcsRateForSection(rule("206C_TIMBER_LEASE"), false)).toBe("5"); // 2 x 2.5 = 5
    expect(tcsRateForSection(rule("206C_SCRAP"), true)).toBe("1");
  });

  it("only limits motor vehicles, at ₹10 lakh", () => {
    const limits = defaultTcsSectionRules("2026-27").filter((s) => s.singleThreshold != null).map((s) => [s.code, s.singleThreshold]);
    expect(limits).toEqual([["206C_VEHICLE", "1000000"]]);
  });
});

describe("computeTcs", () => {
  it("collects the rate on the taxable value", () => {
    expect(computeTcs({ section: rule("206C_SCRAP"), hasPan: true, taxable: "100000" })).toEqual({ applicable: true, base: "100000.00", rate: "1", tcs: "1000.00" });
  });

  it("uses the higher rate without a PAN", () => {
    expect(computeTcs({ section: rule("206C_SCRAP"), hasPan: false, taxable: "100000" })).toMatchObject({ rate: "5", tcs: "5000.00" });
  });

  it("rounds to the nearest rupee", () => {
    // 2.5% of 12,345.67 = 308.64
    expect(computeTcs({ section: rule("206C_FOREST"), hasPan: true, taxable: "12345.67" }).tcs).toBe("309.00");
  });

  it("collects nothing on a motor vehicle at or below ₹10 lakh, and tax on the whole value above it", () => {
    expect(computeTcs({ section: rule("206C_VEHICLE"), hasPan: true, taxable: "1000000" }).applicable).toBe(false);
    expect(computeTcs({ section: rule("206C_VEHICLE"), hasPan: true, taxable: "850000" })).toMatchObject({ applicable: false, tcs: "0.00" });
    expect(computeTcs({ section: rule("206C_VEHICLE"), hasPan: true, taxable: "1200000" })).toEqual({ applicable: true, base: "1200000.00", rate: "1", tcs: "12000.00" });
  });

  it("collects nothing on a zero or negative value", () => {
    expect(computeTcs({ section: rule("206C_SCRAP"), hasPan: true, taxable: "0" }).applicable).toBe(false);
    expect(computeTcs({ section: rule("206C_SCRAP"), hasPan: true, taxable: "-5" }).applicable).toBe(false);
  });

  it("collects nothing when the tax rounds to zero", () => {
    expect(computeTcs({ section: rule("206C_SCRAP"), hasPan: true, taxable: "40" })).toMatchObject({ applicable: false, tcs: "0.00" });
  });
});

describe("TCS due dates", () => {
  const due = (d: string) => formatIstDate(tcsDepositDueDate(`${d}T12:00:00+05:30`));
  it("deposit is due on the 7th of the next month", () => {
    expect(due("2026-10-15")).toBe("07-11-2026");
    expect(due("2026-12-20")).toBe("07-01-2027");
  });
  it("March is also the 7th of April (no 30 April exception, unlike TDS)", () => {
    expect(due("2027-03-10")).toBe("07-04-2027");
  });
  it("return due dates are the 15th of the month after the quarter", () => {
    expect(formatIstDate(tcsReturnDueDate("2026-27", 1))).toBe("15-07-2026");
    expect(formatIstDate(tcsReturnDueDate("2026-27", 2))).toBe("15-10-2026");
    expect(formatIstDate(tcsReturnDueDate("2026-27", 3))).toBe("15-01-2027");
    expect(formatIstDate(tcsReturnDueDate("2026-27", 4))).toBe("15-05-2027");
  });
});
