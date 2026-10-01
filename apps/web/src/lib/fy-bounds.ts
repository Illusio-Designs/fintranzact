import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

// All boundaries are UTC — the DB stores UTC timestamps and local-time
// construction in IST would shift April 1 → March 31 UTC, pulling the
// previous March into the current FY.

/**
 * The current financial year (April to March) up to the end of today. The
 * end is the end of the day, not "now": reports use these as query inputs,
 * and a value that changed on every render made a new query each time — the
 * trial balance and balance sheet refetched forever and never showed.
 */
export function getCurrentFYBounds(now = dayjs.utc()): { start: string; end: string; year: number } {
  const fyYear = now.month() >= 3 ? now.year() : now.year() - 1;
  return {
    start: dayjs.utc(Date.UTC(fyYear, 3, 1)).toISOString(),
    end: now.endOf("day").toISOString(),
    year: fyYear,
  };
}

/** The financial year before the current one, April 1 to March 31. */
export function getPreviousFYBounds(now = dayjs.utc()): { start: string; end: string; year: number } {
  const prevFyYear = now.month() >= 3 ? now.year() - 1 : now.year() - 2;
  return {
    start: dayjs.utc(Date.UTC(prevFyYear, 3, 1)).toISOString(),
    end: dayjs.utc(Date.UTC(prevFyYear + 1, 2, 31)).endOf("day").toISOString(),
    year: prevFyYear,
  };
}
