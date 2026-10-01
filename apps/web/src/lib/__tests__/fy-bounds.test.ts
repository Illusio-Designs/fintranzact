import { describe, expect, it, vi, afterEach } from "vitest";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getCurrentFYBounds, getPreviousFYBounds } from "../fy-bounds";

dayjs.extend(utc);

afterEach(() => vi.useRealTimers());

describe("financial year bounds", () => {
  it("stay the same from one render to the next (a query input that changed refetched forever)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T09:15:30.123Z"));
    const first = getCurrentFYBounds();
    vi.setSystemTime(new Date("2026-10-01T09:15:31.456Z"));
    expect(getCurrentFYBounds()).toEqual(first);
    expect(getPreviousFYBounds()).toEqual(getPreviousFYBounds());
  });

  it("run from April 1 to the end of today, and the year before that", () => {
    const now = dayjs.utc("2026-10-01T09:15:30Z");
    expect(getCurrentFYBounds(now)).toEqual({
      start: "2026-04-01T00:00:00.000Z",
      end: "2026-10-01T23:59:59.999Z",
      year: 2026,
    });
    expect(getPreviousFYBounds(now)).toEqual({
      start: "2025-04-01T00:00:00.000Z",
      end: "2026-03-31T23:59:59.999Z",
      year: 2025,
    });
  });

  it("put January to March in the year that began the April before", () => {
    const now = dayjs.utc("2027-02-10T12:00:00Z");
    expect(getCurrentFYBounds(now)).toMatchObject({ start: "2026-04-01T00:00:00.000Z", year: 2026 });
    expect(getPreviousFYBounds(now)).toMatchObject({ start: "2025-04-01T00:00:00.000Z", end: "2026-03-31T23:59:59.999Z" });
  });
});
