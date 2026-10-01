import { describe, expect, it } from "vitest";
import { computeNextRunDate } from "../lib/recurring-invoice-generator.js";

/** 00:00 IST on an Indian calendar day, as an instant. */
const istMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d) - 330 * 60_000);

describe("computeNextRunDate", () => {
  // Regression (J8 journey): months were counted on the server's (UTC)
  // calendar, so a template due on the 1st (IST midnight is the previous
  // day in UTC) next ran on the 31st, then drifted earlier month by month.
  it("counts months on the Indian calendar", () => {
    expect(computeNextRunDate(istMidnight(2026, 10, 1), "monthly")).toEqual(istMidnight(2026, 11, 1));
    expect(computeNextRunDate(istMidnight(2026, 1, 1), "monthly")).toEqual(istMidnight(2026, 2, 1));
    expect(computeNextRunDate(istMidnight(2026, 2, 1), "monthly")).toEqual(istMidnight(2026, 3, 1));
    expect(computeNextRunDate(istMidnight(2026, 10, 1), "quarterly")).toEqual(istMidnight(2027, 1, 1));
    expect(computeNextRunDate(istMidnight(2026, 4, 1), "yearly")).toEqual(istMidnight(2027, 4, 1));
  });

  it("clamps to the end of a shorter month", () => {
    expect(computeNextRunDate(istMidnight(2026, 1, 31), "monthly")).toEqual(istMidnight(2026, 2, 28));
  });

  it("keeps the time of day", () => {
    const at = new Date("2026-10-01T08:30:00Z"); // 14:00 IST
    expect(computeNextRunDate(at, "monthly").toISOString()).toBe("2026-11-01T08:30:00.000Z");
    expect(computeNextRunDate(at, "weekly").toISOString()).toBe("2026-10-08T08:30:00.000Z");
  });
});
