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

/** Format `date` as DD<sep>MM<sep>YYYY in India Standard Time. */
export function formatIstDate(date: Date | string, sep: "-" | "/" = "-"): string {
  const { dd, mm, yyyy } = istDateParts(date);
  return `${dd}${sep}${mm}${sep}${yyyy}`;
}
