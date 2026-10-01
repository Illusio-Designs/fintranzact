import { describe, it, expect } from "vitest";
import {
  EMPTY_LOCK_STATE,
  formatLockDate,
  formatReturnPeriod,
  indianDay,
  lockViolation,
  returnPeriodViolation,
  type PeriodLockState,
} from "../lib/period-lock.js";

const booksLocked = (through: string, by: string | null = "Rishi Soni"): PeriodLockState => ({
  booksLockedThrough: through,
  booksLock: { by, at: "2026-04-05T06:30:00.000Z", note: null },
  gstMonths: new Map(),
});
const gstLocked = (...months: string[]): PeriodLockState => ({
  booksLockedThrough: null,
  booksLock: null,
  gstMonths: new Map(months.map((m) => [m, { by: "Meera (CA)", at: "2026-09-20T06:30:00.000Z", note: null }])),
});

describe("indianDay", () => {
  it("is the Indian calendar day, not the UTC day", () => {
    expect(indianDay(new Date("2026-03-31T18:45:00Z"))).toBe("2026-04-01");
    expect(indianDay(new Date("2026-03-31T18:15:00Z"))).toBe("2026-03-31");
    expect(indianDay("2026-04-01T00:00:00+05:30")).toBe("2026-04-01");
  });
  it("passes a plain date through unchanged", () => {
    expect(indianDay("2026-03-31")).toBe("2026-03-31");
  });
});

describe("formatting", () => {
  it("formats dates and return months for messages", () => {
    expect(formatLockDate("2026-03-31")).toBe("31 Mar 2026");
    expect(formatLockDate("2026-12-01")).toBe("1 Dec 2026");
    expect(formatReturnPeriod("2026-08")).toBe("Aug 2026");
  });
});

describe("lockViolation — books locked through a date", () => {
  const state = booksLocked("2026-03-31");

  it("allows nothing on or before the date, and everything after it", () => {
    expect(lockViolation(state, "2026-03-31")).not.toBeNull();
    expect(lockViolation(state, "2026-01-15")).not.toBeNull();
    expect(lockViolation(state, "2026-04-01")).toBeNull();
    expect(lockViolation(state, new Date("2026-09-01T06:30:00Z"))).toBeNull();
  });

  it("reads the date as an Indian day", () => {
    // 18:45 UTC on 31 March is 1 April in India: open.
    expect(lockViolation(state, new Date("2026-03-31T18:45:00Z"))).toBeNull();
    // 18:15 UTC on 31 March is still 31 March in India: locked.
    expect(lockViolation(state, new Date("2026-03-31T18:15:00Z"))?.kind).toBe("books");
  });

  it("says what is locked, who locked it and what to do", () => {
    const v = lockViolation(state, "2026-02-10")!;
    expect(v.kind).toBe("books");
    expect(v.message).toContain("This period is locked.");
    expect(v.message).toContain("locked through 31 Mar 2026");
    expect(v.message).toContain("set by Rishi Soni on 5 Apr 2026");
    expect(v.message).toContain("entries dated 10 Feb 2026 can't be added, changed or deleted");
    expect(v.message).toContain("Ask the business owner to unlock");
  });

  it("still reads clearly when nobody is recorded as the locker", () => {
    expect(lockViolation(booksLocked("2026-03-31", null), "2026-02-10")!.message).toContain("(set on 5 Apr 2026)");
  });
});

describe("lockViolation — GST months marked as filed", () => {
  const state = gstLocked("2026-08", "2026-09");

  it("blocks only the filed months", () => {
    expect(lockViolation(state, "2026-08-01")?.kind).toBe("gst");
    expect(lockViolation(state, "2026-08-31")?.kind).toBe("gst");
    expect(lockViolation(state, "2026-09-15")?.kind).toBe("gst");
    expect(lockViolation(state, "2026-07-31")).toBeNull();
    expect(lockViolation(state, "2026-10-01")).toBeNull();
  });

  it("names the month and the person", () => {
    const v = lockViolation(state, "2026-08-20")!;
    expect(v.message).toContain("GST returns for Aug 2026 are marked as filed");
    expect(v.message).toContain("locked by Meera (CA) on 20 Sep 2026");
    expect(v.message).toContain("Ask the business owner to unlock the month");
  });

  it("uses the Indian day to pick the month", () => {
    // 19:00 UTC on 31 August is 1 September in India: September is locked here, August is not.
    const augOnly = gstLocked("2026-08");
    expect(lockViolation(augOnly, new Date("2026-08-31T19:00:00Z"))).toBeNull();
    expect(lockViolation(augOnly, new Date("2026-08-31T17:00:00Z"))?.kind).toBe("gst");
  });
});

describe("lockViolation — both kinds together", () => {
  it("reports the books lock first when a date is under both", () => {
    const state: PeriodLockState = { ...booksLocked("2026-08-31"), gstMonths: gstLocked("2026-08").gstMonths };
    expect(lockViolation(state, "2026-08-10")?.kind).toBe("books");
    // After the books lock a filed month still blocks.
    const sep: PeriodLockState = { ...booksLocked("2026-08-31"), gstMonths: gstLocked("2026-09").gstMonths };
    expect(lockViolation(sep, "2026-09-10")?.kind).toBe("gst");
    expect(lockViolation(sep, "2026-10-10")).toBeNull();
  });

  it("allows everything when nothing is locked", () => {
    expect(lockViolation(EMPTY_LOCK_STATE, "2019-01-01")).toBeNull();
  });
});

describe("returnPeriodViolation", () => {
  it("blocks a filed month", () => {
    const v = returnPeriodViolation(gstLocked("2026-08"), "2026-08")!;
    expect(v.kind).toBe("gst");
    expect(v.message).toContain("input tax credit and returns data can't be changed");
    expect(returnPeriodViolation(gstLocked("2026-08"), "2026-09")).toBeNull();
  });

  it("blocks a month wholly inside the locked books, and not one the lock only part-covers", () => {
    const state = booksLocked("2026-03-31");
    expect(returnPeriodViolation(state, "2026-03")?.kind).toBe("books");
    expect(returnPeriodViolation(state, "2026-02")?.kind).toBe("books");
    expect(returnPeriodViolation(state, "2026-04")).toBeNull();
    const mid = booksLocked("2026-03-15");
    expect(returnPeriodViolation(mid, "2026-03")).toBeNull(); // March is only half locked
    expect(returnPeriodViolation(mid, "2026-02")?.kind).toBe("books");
  });

  it("handles February in a leap year", () => {
    expect(returnPeriodViolation(booksLocked("2028-02-29"), "2028-02")?.kind).toBe("books");
    expect(returnPeriodViolation(booksLocked("2028-02-28"), "2028-02")).toBeNull();
  });
});
