import { useState, useCallback } from "react";
import { istDateParts, istPeriodRange, istStartOfDay } from "@fintranzact/shared";
import { toISOString, toISOStringEndOfDay } from "@/lib/utils";

export type DatePreset = "this-month" | "last-month" | "last-30" | "this-fy" | "last-fy" | "custom" | "all";

/**
 * ISO strings for the boundaries of a preset period, cut on the Indian
 * calendar (00:00 IST), the same way the API reads business dates and GST
 * periods (@fintranzact/shared dates.ts).
 *
 * A date picked in an Indian browser is stored as local midnight — 18:30 UTC
 * the day before — so a month cut at UTC midnight dropped invoices dated the
 * 1st (stored on the previous UTC day) from "This Month" and pulled the next
 * month's 1st into it. A date stored at UTC midnight (a browser running on
 * UTC) is 05:30 IST the same day, so it falls in the same period either way.
 * "Today" is also read in India: at 00:05 IST on the 1st it is already the
 * new month.
 *
 * Public contract: the {fromDate, toDate} strings this returns are always
 * ISO-8601 instants (toDate inclusive, to the millisecond), or empty strings
 * for the "all" preset.
 */
export function getDatePreset(preset: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const { year, month } = istDateParts(now);
  const iso = (d: Date) => d.toISOString();
  // Start year of the Indian financial year (April–March) we are in
  const fyYear = month >= 4 ? year : year - 1;

  switch (preset) {
    case "this-month": {
      const { from, to } = istPeriodRange(year, month);
      return { fromDate: iso(from), toDate: iso(to) };
    }
    case "last-month": {
      const { from, to } = istPeriodRange(year, month - 1);
      return { fromDate: iso(from), toDate: iso(to) };
    }
    case "last-30": {
      return {
        fromDate: iso(new Date(now.getTime() - 30 * 86_400_000)),
        toDate: iso(now),
      };
    }
    case "this-fy": {
      return {
        fromDate: iso(istStartOfDay(fyYear, 4, 1)),
        toDate: iso(now),
      };
    }
    case "last-fy": {
      const { from, to } = istPeriodRange(fyYear - 1, 4, 12);
      return { fromDate: iso(from), toDate: iso(to) };
    }
    case "all":
    default:
      return { fromDate: "", toDate: "" };
  }
}

export const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "last-30", label: "Last 30 Days" },
  { value: "this-fy", label: "This FY" },
  { value: "last-fy", label: "Last FY" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All" },
];

export function getGranularity(preset: string): "week" | "month" | "fy" {
  switch (preset) {
    case "this-month":
    case "last-month":
    case "last-30":
      return "week";
    case "this-fy":
    case "last-fy":
    case "this-quarter":
      return "month";
    case "all":
      return "fy";
    default:
      return "month"; // custom ranges default to monthly
  }
}

export function useDateRange(pageKey: string, defaultPreset: DatePreset = "all") {
  const storageKey = `fintranzact-daterange-${pageKey}`;

  const [preset, setPresetState] = useState<DatePreset>(() => {
    if (typeof window === "undefined") return defaultPreset;
    return (localStorage.getItem(storageKey) as DatePreset) || defaultPreset;
  });

  const [dateRange, setDateRange] = useState(() => getDatePreset(preset));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const setPreset = useCallback(
    (p: DatePreset) => {
      setPresetState(p);
      localStorage.setItem(storageKey, p);
      if (p !== "custom") {
        setDateRange(getDatePreset(p));
      }
    },
    [storageKey]
  );

  const setCustomRange = useCallback((from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setDateRange({
      fromDate: toISOString(from) ?? "",
      toDate: toISOStringEndOfDay(to) ?? "",
    });
  }, []);

  return {
    preset,
    setPreset,
    dateRange,
    customFrom,
    customTo,
    setCustomRange,
    fromDate: dateRange.fromDate || undefined,
    toDate: dateRange.toDate || undefined,
  };
}
