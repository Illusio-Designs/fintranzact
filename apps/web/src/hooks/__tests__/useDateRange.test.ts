import { renderHook, act } from "@testing-library/react";
import { getDatePreset, getGranularity, useDateRange } from "@/hooks/useDateRange";

// Pin "now" to 2025-07-15 05:30 IST (00:00 UTC): July, after April, so the
// current FY starts in 2025 and the last one in 2024.
const FIXED_NOW = new Date("2025-07-15T00:00:00.000Z");

// Periods are cut at 00:00 IST (18:30 UTC the day before), the way the API
// stores business dates and reads GST periods.
describe("getDatePreset (pure helper)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("this-month: 1st 00:00 IST to the last instant of the month in India", () => {
    expect(getDatePreset("this-month")).toEqual({
      fromDate: "2025-06-30T18:30:00.000Z",
      toDate: "2025-07-31T18:29:59.999Z",
    });
  });

  it("last-month: the previous calendar month in India", () => {
    expect(getDatePreset("last-month")).toEqual({
      fromDate: "2025-05-31T18:30:00.000Z",
      toDate: "2025-06-30T18:29:59.999Z",
    });
  });

  it("this-fy: from 1 April 00:00 IST of the current FY to now", () => {
    expect(getDatePreset("this-fy")).toEqual({
      fromDate: "2025-03-31T18:30:00.000Z",
      toDate: FIXED_NOW.toISOString(),
    });
  });

  it("last-fy: 1 April to 31 March of the previous FY, in India", () => {
    expect(getDatePreset("last-fy")).toEqual({
      fromDate: "2024-03-31T18:30:00.000Z",
      toDate: "2025-03-31T18:29:59.999Z",
    });
  });

  it("all: returns empty strings", () => {
    const { fromDate, toDate } = getDatePreset("all");
    expect(fromDate).toBe("");
    expect(toDate).toBe("");
  });

  it("last-30: fromDate is exactly 30 days before 'now', toDate is 'now'", () => {
    const { fromDate, toDate } = getDatePreset("last-30");
    expect(toDate).toBe(FIXED_NOW.toISOString());
    const expectedFrom = new Date(FIXED_NOW);
    expectedFrom.setUTCDate(expectedFrom.getUTCDate() - 30);
    expect(fromDate).toBe(expectedFrom.toISOString());
  });

  it("unknown preset: falls back to empty strings (default branch)", () => {
    const { fromDate, toDate } = getDatePreset("not-a-real-preset");
    expect(fromDate).toBe("");
    expect(toDate).toBe("");
  });

  // ── MONTH-BOUNDARY REGRESSION TESTS ────────────────────────────────────
  // Bug: presets were cut at UTC midnight. An invoice dated the 1st in an
  // Indian browser is stored at 18:30 UTC the day before, so "This Month"
  // left it out (and took in the next month's 1st).

  it("REGRESSION: an invoice dated the 1st (stored 18:30 UTC the day before) is in that month", () => {
    const firstOfJuly = new Date("2025-06-30T18:30:00.000Z"); // 1 Jul 00:00 IST
    const firstOfAugust = new Date("2025-07-31T18:30:00.000Z"); // 1 Aug 00:00 IST
    const { fromDate, toDate } = getDatePreset("this-month");
    expect(firstOfJuly >= new Date(fromDate) && firstOfJuly <= new Date(toDate)).toBe(true);
    expect(firstOfAugust <= new Date(toDate)).toBe(false);
  });

  it("REGRESSION: at 00:05 IST on the 1st it is already the new month (UTC still says the 31st)", () => {
    vi.setSystemTime(new Date("2025-07-31T18:35:00.000Z")); // 1 Aug 00:05 IST
    expect(getDatePreset("this-month").fromDate).toBe("2025-07-31T18:30:00.000Z");
    expect(getDatePreset("last-month")).toEqual({
      fromDate: "2025-06-30T18:30:00.000Z",
      toDate: "2025-07-31T18:29:59.999Z",
    });
  });

  it("REGRESSION: a date stored at UTC midnight (a UTC browser) still falls in its month", () => {
    const firstOfJulyUtc = new Date("2025-07-01T00:00:00.000Z"); // 05:30 IST, 1 Jul
    const { fromDate, toDate } = getDatePreset("this-month");
    expect(firstOfJulyUtc >= new Date(fromDate) && firstOfJulyUtc <= new Date(toDate)).toBe(true);
  });

  it("this-fy when month < April: FY starts previous calendar year", () => {
    vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
    expect(getDatePreset("this-fy").fromDate).toBe("2025-03-31T18:30:00.000Z");
  });

  it("this-fy at 00:05 IST on 1 April: the new FY has started", () => {
    vi.setSystemTime(new Date("2025-03-31T18:35:00.000Z"));
    expect(getDatePreset("this-fy").fromDate).toBe("2025-03-31T18:30:00.000Z");
  });

  it("last-fy when month < April: last FY starts two calendar years back", () => {
    vi.setSystemTime(new Date("2026-02-15T00:00:00.000Z"));
    expect(getDatePreset("last-fy")).toEqual({
      fromDate: "2024-03-31T18:30:00.000Z",
      toDate: "2025-03-31T18:29:59.999Z",
    });
  });

  it("last-month in January: December of the previous year", () => {
    vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
    expect(getDatePreset("last-month")).toEqual({
      fromDate: "2025-11-30T18:30:00.000Z",
      toDate: "2025-12-31T18:29:59.999Z",
    });
  });
});

describe("getGranularity", () => {
  it("this-month and last-month use weekly granularity", () => {
    expect(getGranularity("this-month")).toBe("week");
    expect(getGranularity("last-month")).toBe("week");
  });

  it("last-30 uses weekly granularity", () => {
    expect(getGranularity("last-30")).toBe("week");
  });

  it("FY presets use monthly granularity", () => {
    expect(getGranularity("this-fy")).toBe("month");
    expect(getGranularity("last-fy")).toBe("month");
  });

  it("all uses FY granularity", () => {
    expect(getGranularity("all")).toBe("fy");
  });

  it("custom defaults to monthly", () => {
    expect(getGranularity("custom")).toBe("month");
  });
});

describe("useDateRange (hook)", () => {
  const PAGE_KEY = "test-page";
  const STORAGE_KEY = `fintranzact-daterange-${PAGE_KEY}`;

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("initializes with default preset when localStorage is empty", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));
    expect(result.current.preset).toBe("all");
    expect(result.current.fromDate).toBeUndefined();
    expect(result.current.toDate).toBeUndefined();
  });

  it("reads saved preset from localStorage on mount", () => {
    localStorage.setItem(STORAGE_KEY, "this-month");
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));
    expect(result.current.preset).toBe("this-month");
  });

  it("setPreset updates the preset state", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setPreset("last-month");
    });

    expect(result.current.preset).toBe("last-month");
  });

  it("setPreset persists the selection to localStorage", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setPreset("this-fy");
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("this-fy");
  });

  it("setPreset updates dateRange for non-custom presets", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    // "all" starts with empty dates
    expect(result.current.fromDate).toBeUndefined();

    act(() => {
      result.current.setPreset("this-month");
    });

    // After switching to this-month we should have actual date strings
    expect(result.current.fromDate).toBeDefined();
    expect(result.current.toDate).toBeDefined();
  });

  it("setPreset to custom does NOT call getDatePreset (dateRange stays as-is)", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "this-month"));

    const fromBefore = result.current.fromDate;

    act(() => {
      result.current.setPreset("custom");
    });

    expect(result.current.preset).toBe("custom");
    // dateRange should be unchanged because setPreset skips getDatePreset for "custom"
    expect(result.current.fromDate).toBe(fromBefore);
  });

  it("setCustomRange updates dateRange and custom date strings", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setCustomRange("2025-01-01", "2025-03-31");
    });

    expect(result.current.customFrom).toBe("2025-01-01");
    expect(result.current.customTo).toBe("2025-03-31");
    expect(result.current.fromDate).toBeDefined();
    expect(result.current.toDate).toBeDefined();

    const from = new Date(result.current.fromDate!);
    const to = new Date(result.current.toDate!);

    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(0); // January
    expect(from.getDate()).toBe(1);

    expect(to.getFullYear()).toBe(2025);
    expect(to.getMonth()).toBe(2); // March
    expect(to.getDate()).toBe(31);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getSeconds()).toBe(59);
  });

  it("setCustomRange with empty strings yields undefined fromDate/toDate", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setCustomRange("", "");
    });

    expect(result.current.fromDate).toBeUndefined();
    expect(result.current.toDate).toBeUndefined();
  });
});
