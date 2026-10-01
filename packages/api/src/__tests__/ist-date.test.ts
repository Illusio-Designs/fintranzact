/**
 * ist-date.test.ts — GST periods and payload dates follow the calendar in
 * India, whatever the server's timezone. Invoices entered in India are stored
 * at midnight IST, which is 18:30 UTC on the previous day.
 */

import { describe, it, expect } from "vitest";
import { formatIstDate, istPeriodRange, istReturnPeriod } from "@fintranzact/shared";

describe("istPeriodRange", () => {
  it("cuts a month at midnight IST on both edges", () => {
    const { from, to } = istPeriodRange(2026, 8);
    expect(from.toISOString()).toBe("2026-07-31T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-08-31T18:29:59.999Z");
  });

  it("covers a quarter and rolls over the year", () => {
    const { from, to } = istPeriodRange(2025, 10, 3);
    expect(from.toISOString()).toBe("2025-09-30T18:30:00.000Z");
    expect(to.toISOString()).toBe("2025-12-31T18:29:59.999Z");
  });

  it("puts an invoice dated midnight IST on the 1st in that month, not the previous one", () => {
    const firstOfMonth = new Date("2026-08-01T00:00:00+05:30");
    const aug = istPeriodRange(2026, 8);
    const jul = istPeriodRange(2026, 7);
    expect(firstOfMonth >= aug.from && firstOfMonth <= aug.to).toBe(true);
    expect(firstOfMonth >= jul.from && firstOfMonth <= jul.to).toBe(false);
  });

  it("puts an invoice dated early on the 1st (IST) in that month, though it is still the previous day in UTC", () => {
    const earlySep = new Date("2026-09-01T02:00:00+05:30"); // 2026-08-31T20:30Z
    const aug = istPeriodRange(2026, 8);
    const sep = istPeriodRange(2026, 9);
    expect(earlySep <= aug.to).toBe(false);
    expect(earlySep >= sep.from).toBe(true);
  });
});

describe("istReturnPeriod", () => {
  it("names the month by the calendar in India", () => {
    expect(istReturnPeriod(new Date("2026-09-30T20:00:00Z"))).toBe("2026-10");
    expect(istReturnPeriod(new Date("2026-09-30T18:29:59Z"))).toBe("2026-09");
  });
});

describe("formatIstDate", () => {
  it("formats the calendar day in India", () => {
    expect(formatIstDate(new Date("2025-08-24T18:30:00Z"))).toBe("25-08-2025");
    expect(formatIstDate("2025-08-24T18:29:59Z", "/")).toBe("24/08/2025");
  });
});
