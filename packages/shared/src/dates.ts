/**
 * Business calendar helpers in Indian Standard Time — the one place GST
 * periods, financial years and portal/e-invoice/e-way bill dates are read.
 *
 * Business dates are stored as instants. A date picked in an Indian browser
 * is sent as local midnight, i.e. 18:30 UTC the day before, so reading the
 * calendar day, month or financial year with the server's own time zone
 * (UTC in our containers) puts it on the wrong day. These helpers read and
 * build dates in Asia/Kolkata whatever the process time zone is. India has
 * no daylight saving, so the offset is fixed at +05:30.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;

const toDate = (date: Date | string) => (typeof date === "string" ? new Date(date) : date);

/** Calendar parts of an instant as seen in India. `month` is 1-12. */
export function istDateParts(date: Date | string): { year: number; month: number; day: number } {
  const shifted = new Date(toDate(date).getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The instant an Indian calendar day starts (00:00 IST). `month` is 1-12 and may overflow. */
export function istStartOfDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

/**
 * First and last instant (inclusive, to the millisecond) of `months` Indian
 * calendar months starting with `month` (1-12, may overflow) of `year`. GST
 * returns are filed per Indian calendar month, so period filters must cut
 * at midnight IST — otherwise an invoice dated the 1st (stored as 18:30 UTC
 * the previous day) lands in the previous return.
 */
export function istPeriodRange(year: number, month: number, months = 1): { from: Date; to: Date } {
  return {
    from: istStartOfDay(year, month, 1),
    to: new Date(istStartOfDay(year, month + months, 1).getTime() - 1),
  };
}

/**
 * Start year of the financial year an instant falls in, e.g. 2025 for any
 * moment in FY 2025-26. `fyStartMonth` is 1-12 (4 = April, the Indian FY).
 */
export function financialYearOf(date: Date | string, fyStartMonth = 4): number {
  const { year, month } = istDateParts(date);
  return month < fyStartMonth ? year - 1 : year;
}

/** First and last instant of the financial year starting in `startYear`. */
export function financialYearRange(startYear: number, fyStartMonth = 4): { from: Date; to: Date } {
  return istPeriodRange(startYear, fyStartMonth, 12);
}

/** "2025-26" for the financial year starting in 2025. */
export function financialYearLabel(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/** The Indian calendar date of an instant as DD<sep>MM<sep>YYYY. */
export function formatIstDate(date: Date | string, sep: "-" | "/" = "-"): string {
  const { year, month, day } = istDateParts(date);
  return `${String(day).padStart(2, "0")}${sep}${String(month).padStart(2, "0")}${sep}${year}`;
}

/** The GST return period ("YYYY-MM") an instant falls in, by the calendar in India. */
export function istReturnPeriod(date: Date | string): string {
  const { year, month } = istDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}
