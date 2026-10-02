import { describe, it, expect } from "vitest";
import {
  cmp08DueDate, compositionInterest, compositionQuarterRange, compositionRateFor, defaultCompositionRules,
  gstr4DueDate,
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
  it("is due on the 18th of the month after the quarter; none for Q4", () => {
    expect(formatIstDate(cmp08DueDate("2026-27", 1)!)).toBe("18-07-2026");
    expect(formatIstDate(cmp08DueDate("2026-27", 2)!)).toBe("18-10-2026");
    expect(formatIstDate(cmp08DueDate("2026-27", 3)!)).toBe("18-01-2027");
    expect(cmp08DueDate("2026-27", 4)).toBeNull();
  });
  it("GSTR-4 is due 30 April after the year", () => {
    expect(formatIstDate(gstr4DueDate("2026-27"))).toBe("30-04-2027");
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
