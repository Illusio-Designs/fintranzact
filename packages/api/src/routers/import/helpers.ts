// ── Date parsing helper ──────────────────────────────────────────────────────
// Handles: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, "22 Mar 2026", ISO strings
export function parseFlexibleDate(str: string): Date | null {
  if (!str || !str.trim()) return null;
  const s = str.trim();

  // ISO format: YYYY-MM-DD or full datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = new Date(s);
    if (!isNaN(iso.getTime())) return iso;
  }

  // DD/MM/YYYY or DD-MM-YYYY (Indian format — most common in myBillBook exports)
  const ddmmyyyy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    if (!isNaN(d.getTime())) return d;
  }

  // "22 Mar 2026" or "22-Mar-2026"
  const dMonY = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})$/);
  if (dMonY) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }

  // Last resort — let JS try to parse it
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}
