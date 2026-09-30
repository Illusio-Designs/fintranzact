/**
 * Calendar dates for GST, e-invoice and e-way bill payloads.
 *
 * Business dates are stored as timestamptz. The web app picks a date in the
 * user's (Indian) local time, so an invoice dated 25 Aug is stored as
 * 2025-08-24T18:30:00Z. Reading its day with `toISOString()` or the server's
 * local-time getters (servers run in UTC) gives 24 Aug. These helpers read
 * the calendar day in Asia/Kolkata, which is what the government portals
 * expect whatever timezone the server runs in.
 */

const IST_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Year, month and day of `date` in India Standard Time, zero padded. */
export function istDateParts(date: Date | string): { dd: string; mm: string; yyyy: string } {
  const d = typeof date === "string" ? new Date(date) : date;
  let dd = "", mm = "", yyyy = "";
  for (const part of IST_PARTS.formatToParts(d)) {
    if (part.type === "day") dd = part.value;
    else if (part.type === "month") mm = part.value;
    else if (part.type === "year") yyyy = part.value;
  }
  return { dd, mm, yyyy };
}

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The instant of midnight IST at the start of the given calendar day (month 1-12; overflow rolls over). */
function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

/**
 * The range of instants covering `months` calendar months in India, starting
 * with `month` (1-12) of `year`: from midnight IST on the 1st to the last
 * millisecond before midnight IST on the 1st of the following period. GST
 * returns are filed per Indian calendar month, so period filters must cut
 * there, not at the server's (UTC) midnight — otherwise an invoice dated the
 * 1st (stored as 18:30 UTC the previous day) lands in the previous return.
 */
export function istPeriodRange(year: number, month: number, months = 1): { from: Date; to: Date } {
  const from = istMidnight(year, month, 1);
  const to = new Date(istMidnight(year, month + months, 1).getTime() - 1);
  return { from, to };
}

/** The GST return period ("YYYY-MM") that `date` falls in, by the calendar in India. */
export function istReturnPeriod(date: Date | string): string {
  const { mm, yyyy } = istDateParts(date);
  return `${yyyy}-${mm}`;
}

/** Format `date` as DD<sep>MM<sep>YYYY in India Standard Time. */
export function formatIstDate(date: Date | string, sep: "-" | "/" = "-"): string {
  const { dd, mm, yyyy } = istDateParts(date);
  return `${dd}${sep}${mm}${sep}${yyyy}`;
}
