import { describe, it, expect } from "vitest";
import {
  cmp08DueDate, compositionDefaultsFor, compositionInterest, compositionQuarterRange, compositionRateFor,
  defaultCompositionRules, gstr4DueDate, gstr4LateFee, resolveCompositionSettings,
} from "../composition.js";
import { formatIstDate } from "../dates.js";

describe("composition rates", () => {
  it("defaults to 1% / 5% / 6% by category", () => {
    expect(defaultCompositionRules("2026-27").map((r) => [r.code, r.rate])).toEqual([
      ["manufacturer_trader", "1"], ["restaurant", "5"], ["other_service", "6"],
    ]);
  });
  it("uses an override when set, even 0", () => {
    expect(compositionRateFor("restaurant")).toBe("5");
    expect(compositionRateFor("restaurant", "2.5")).toBe("2.5");
    expect(compositionRateFor("restaurant", "0.000")).toBe("0");
    expect(compositionRateFor("other_service", null)).toBe("6");
  });
});

describe("CMP-08 dates", () => {
  it("is due on the 18th of the month after the quarter, Q4 included", () => {
    expect(formatIstDate(cmp08DueDate("2026-27", 1)!)).toBe("18-07-2026");
    expect(formatIstDate(cmp08DueDate("2026-27", 2)!)).toBe("18-10-2026");
    expect(formatIstDate(cmp08DueDate("2026-27", 3)!)).toBe("18-01-2027");
    expect(formatIstDate(cmp08DueDate("2026-27", 4))).toBe("18-04-2027");
  });
  it("takes a different CMP-08 due day when given", () => {
    expect(formatIstDate(cmp08DueDate("2026-27", 1, 20))).toBe("20-07-2026");
    expect(formatIstDate(cmp08DueDate("2026-27", 4, 25))).toBe("25-04-2027");
  });
  it("GSTR-4 is due 30 June after the year from FY 2024-25, 30 April before", () => {
    expect(formatIstDate(gstr4DueDate("2026-27"))).toBe("30-06-2027");
    expect(formatIstDate(gstr4DueDate("2024-25"))).toBe("30-06-2025");
    expect(formatIstDate(gstr4DueDate("2023-24"))).toBe("30-04-2024");
  });
  it("GSTR-4 due date takes an override date or string", () => {
    expect(formatIstDate(gstr4DueDate("2026-27", "2027-07-31"))).toBe("31-07-2027");
  });
  it("quarters follow April-March and cut at midnight IST", () => {
    const q4 = compositionQuarterRange("2025-26", 4);
    expect(q4.from.toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(q4.to.toISOString()).toBe("2026-03-31T18:29:59.999Z");
  });
});

describe("composition interest", () => {
  const due = cmp08DueDate("2026-27", 1)!;
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 6));
  it("is nil on or before the due date or with no tax", () => {
    expect(compositionInterest("1000", due, at(2026, 7, 18))).toBe("0.00");
    expect(compositionInterest("1000", due, at(2026, 7, 1))).toBe("0.00");
    expect(compositionInterest("0", due, at(2026, 9, 1))).toBe("0.00");
  });
  it("is 18% a year, simple, on the days late", () => {
    // 365 days late on 1000 = 180.00
    expect(compositionInterest("1000", due, at(2027, 7, 18))).toBe("180.00");
    // 10 days late: 1000 x 18% x 10 / 365 = 4.93
    expect(compositionInterest("1000", due, at(2026, 7, 28))).toBe("4.93");
  });
});

describe("GSTR-4 late fee", () => {
  const due = gstr4DueDate("2026-27");
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 6));
  const rules = { perDay: "50", cap: "2000", nilPerDay: "20", nilCap: "500" };
  it("is nil on or before the due date", () => {
    expect(gstr4LateFee(due, at(2027, 6, 30), false, rules)).toMatchObject({ daysLate: 0, fee: "0.00", capped: false });
    expect(gstr4LateFee(due, at(2027, 6, 1), true, rules).fee).toBe("0.00");
  });
  it("is 50 a day (25 central + 25 state) for a non-nil return", () => {
    const f = gstr4LateFee(due, at(2027, 7, 10), false, rules);
    expect(f).toMatchObject({ daysLate: 10, fee: "500.00", centralTax: "250.00", stateTax: "250.00", capped: false });
  });
  it("is 20 a day for a nil return", () => {
    expect(gstr4LateFee(due, at(2027, 7, 10), true, rules)).toMatchObject({ fee: "200.00", perDay: "20", cap: "500" });
  });
  it("stops at the cap", () => {
    expect(gstr4LateFee(due, at(2027, 9, 30), false, rules)).toMatchObject({ fee: "2000.00", capped: true });
    expect(gstr4LateFee(due, at(2027, 9, 30), true, rules)).toMatchObject({ fee: "500.00", capped: true });
  });
  it("follows edited amounts", () => {
    const custom = { perDay: "200", cap: "5000", nilPerDay: "20", nilCap: "500" };
    expect(gstr4LateFee(due, at(2027, 7, 5), false, custom).fee).toBe("1000.00");
    expect(gstr4LateFee(due, at(2027, 8, 30), false, custom)).toMatchObject({ fee: "5000.00", capped: true });
  });
});

describe("year-versioned defaults and resolution", () => {
  it("picks the entry in force for the year, with review metadata", () => {
    expect(compositionDefaultsFor("2023-24").gstr4.dueMonth).toBe(4);
    expect(compositionDefaultsFor("2024-25").gstr4.dueMonth).toBe(6);
    expect(compositionDefaultsFor("2031-32").gstr4.dueMonth).toBe(6);
    expect(compositionDefaultsFor("2026-27").meta).toMatchObject({ lastReviewed: "2026-10-02", verifyWithCA: true });
    expect(compositionDefaultsFor("2026-27").meta.sourceNotes.length).toBeGreaterThan(0);
  });
  it("uses the built-in default when there is no override", () => {
    const r = resolveCompositionSettings("2026-27", "restaurant");
    expect(r).toMatchObject({ rate: "5", cmp08DueDay: 18, interestRatePercent: "18", lateFee: { perDay: "50", cap: "2000", nilPerDay: "20", nilCap: "500" } });
    expect(formatIstDate(r.gstr4DueDate)).toBe("30-06-2027");
    expect(Object.values(r.sources).every((x) => x === "default")).toBe(true);
  });
  it("lets the business override win, value by value, and says so", () => {
    const r = resolveCompositionSettings("2026-27", "manufacturer_trader", {
      rate: "0.5", gstr4DueDate: "2027-07-31", interestRate: "12", lateFeePerDay: "100", cmp08DueDay: 20,
    });
    expect(r.rate).toBe("0.5");
    expect(formatIstDate(r.gstr4DueDate)).toBe("31-07-2027");
    expect(r.interestRatePercent).toBe("12");
    expect(r.lateFee).toEqual({ perDay: "100", cap: "2000", nilPerDay: "20", nilCap: "500" });
    expect(r.cmp08DueDay).toBe(20);
    expect(r.sources).toMatchObject({
      rate: "override", gstr4DueDate: "override", interestRatePercent: "override", lateFeePerDay: "override",
      cmp08DueDay: "override", lateFeeCap: "default", lateFeeNilPerDay: "default", lateFeeNilCap: "default",
    });
    // the default stays visible beside the override
    expect(r.defaults.rate).toBe("1");
    expect(r.defaults.lateFee.perDay).toBe("50");
  });
  it("treats null and empty as no override, and 0 as a real override", () => {
    const r = resolveCompositionSettings("2026-27", "other_service", { rate: null, interestRate: "", lateFeeCap: "0" });
    expect(r.rate).toBe("6");
    expect(r.interestRatePercent).toBe("18");
    expect(r.lateFee.cap).toBe("0");
    expect(r.sources.lateFeeCap).toBe("override");
  });
});
