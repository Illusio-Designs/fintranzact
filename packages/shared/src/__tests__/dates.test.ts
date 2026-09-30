/**
 * Indian business calendar helpers. Every expectation is an absolute UTC
 * instant, so these hold whatever time zone the test process runs in.
 */
import { describe, it, expect } from "vitest";
import {
  financialYearLabel,
  financialYearOf,
  financialYearRange,
  formatIstDate,
  istDateParts,
  istPeriodRange,
  istReturnPeriod,
  istStartOfDay,
} from "../dates.js";

// A date picked as "1 April 2026" in an Indian browser reaches the API as
// local midnight: 2026-03-31T18:30:00.000Z.
const APR_1_IST_MIDNIGHT = new Date("2026-03-31T18:30:00.000Z");
const MAR_31_IST_LAST_MS = new Date("2026-03-31T18:29:59.999Z");

describe("istDateParts — calendar day in India", () => {
  it.each([
    ["2026-03-31T18:30:00.000Z", { year: 2026, month: 4, day: 1 }],
    ["2026-03-31T18:29:59.999Z", { year: 2026, month: 3, day: 31 }],
    ["2025-12-31T18:30:00.000Z", { year: 2026, month: 1, day: 1 }],
    ["2025-12-31T18:29:59.999Z", { year: 2025, month: 12, day: 31 }],
    ["2024-02-29T00:00:00.000Z", { year: 2024, month: 2, day: 29 }],
    ["2024-02-28T18:30:00.000Z", { year: 2024, month: 2, day: 29 }],
    ["2026-04-01T00:00:00.000Z", { year: 2026, month: 4, day: 1 }],
  ])("%s is %o in IST", (iso, parts) => {
    expect(istDateParts(new Date(iso))).toEqual(parts);
  });
});

describe("istStartOfDay / istPeriodRange — month boundaries at IST midnight", () => {
  it("a day starts at 18:30 UTC the day before", () => {
    expect(istStartOfDay(2026, 4, 1).toISOString()).toBe("2026-03-31T18:30:00.000Z");
  });

  it("month overflow rolls into the next year", () => {
    expect(istStartOfDay(2026, 13, 1).toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(istStartOfDay(2026, 0, 1).toISOString()).toBe("2025-11-30T18:30:00.000Z");
  });

  it.each([
    [2026, 4, "2026-03-31T18:30:00.000Z", "2026-04-30T18:29:59.999Z"],
    [2026, 3, "2026-02-28T18:30:00.000Z", "2026-03-31T18:29:59.999Z"],
    [2024, 2, "2024-01-31T18:30:00.000Z", "2024-02-29T18:29:59.999Z"], // leap year
    [2025, 2, "2025-01-31T18:30:00.000Z", "2025-02-28T18:29:59.999Z"],
    [2025, 12, "2025-11-30T18:30:00.000Z", "2025-12-31T18:29:59.999Z"],
    [2026, 1, "2025-12-31T18:30:00.000Z", "2026-01-31T18:29:59.999Z"],
  ])("%i-%i runs %s .. %s", (y, m, from, to) => {
    const r = istPeriodRange(y, m);
    expect(r.from.toISOString()).toBe(from);
    expect(r.to.toISOString()).toBe(to);
  });

  it("consecutive months tile with no gap and no overlap", () => {
    for (let m = 1; m <= 12; m++) {
      const a = istPeriodRange(2026, m);
      const b = istPeriodRange(2026, m + 1);
      expect(b.from.getTime() - a.to.getTime()).toBe(1);
    }
  });

  it("an invoice dated 1 April (IST midnight) is in April, not March", () => {
    const apr = istPeriodRange(2026, 4);
    const mar = istPeriodRange(2026, 3);
    expect(APR_1_IST_MIDNIGHT >= apr.from && APR_1_IST_MIDNIGHT <= apr.to).toBe(true);
    expect(APR_1_IST_MIDNIGHT <= mar.to).toBe(false);
    expect(MAR_31_IST_LAST_MS <= mar.to && MAR_31_IST_LAST_MS >= mar.from).toBe(true);
  });

  it("istPeriodRange covers a quarter", () => {
    const q = istPeriodRange(2025, 7, 3);
    expect(q.from.toISOString()).toBe("2025-06-30T18:30:00.000Z");
    expect(q.to.toISOString()).toBe("2025-09-30T18:29:59.999Z");
  });
});

describe("financial year helpers (April–March unless configured)", () => {
  it.each([
    ["2026-03-31T18:29:59.999Z", 2025], // 31 Mar 23:59:59.999 IST → FY 2025-26
    ["2026-03-31T18:30:00.000Z", 2026], // 1 Apr 00:00 IST → FY 2026-27
    ["2026-01-15T06:00:00.000Z", 2025],
    ["2025-12-31T18:30:00.000Z", 2025], // 1 Jan 2026 IST still FY 2025-26
    ["2026-09-30T12:00:00.000Z", 2026],
  ])("%s falls in FY starting %i", (iso, fy) => {
    expect(financialYearOf(new Date(iso))).toBe(fy);
  });

  it("honours a January-start financial year", () => {
    expect(financialYearOf(new Date("2025-12-31T18:30:00.000Z"), 1)).toBe(2026);
    expect(financialYearOf(new Date("2025-12-31T18:29:59.999Z"), 1)).toBe(2025);
  });

  it("financialYearRange spans 1 Apr 00:00 IST to 31 Mar 23:59:59.999 IST", () => {
    const r = financialYearRange(2025);
    expect(r.from.toISOString()).toBe("2025-03-31T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-31T18:29:59.999Z");
  });

  it("financialYearLabel is YYYY-YY, including across a century", () => {
    expect(financialYearLabel(2025)).toBe("2025-26");
    expect(financialYearLabel(2099)).toBe("2099-00");
  });
});

describe("formatIstDate / istReturnPeriod", () => {
  it("formats the Indian calendar date, not the UTC one", () => {
    expect(formatIstDate(APR_1_IST_MIDNIGHT, "/")).toBe("01/04/2026");
    expect(formatIstDate(MAR_31_IST_LAST_MS, "/")).toBe("31/03/2026");
    expect(formatIstDate("2026-03-31T18:30:00.000Z")).toBe("01-04-2026");
    expect(formatIstDate(APR_1_IST_MIDNIGHT, "-")).toBe("01-04-2026");
  });

  it("return period follows the IST month", () => {
    expect(istReturnPeriod(APR_1_IST_MIDNIGHT)).toBe("2026-04");
    expect(istReturnPeriod(MAR_31_IST_LAST_MS)).toBe("2026-03");
    expect(istReturnPeriod(new Date("2025-12-31T18:30:00.000Z"))).toBe("2026-01");
  });
});
