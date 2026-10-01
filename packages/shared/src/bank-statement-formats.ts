/**
 * Bank statement converters for reconciliation imports.
 *
 * Bank reconciliation imports CSV. Banks also hand out Excel, OFX/QFX, QIF
 * and PDF statements, so the web app turns those into rows in the browser
 * and sends them as CSV text through the same upload. Everything here is
 * pure and dependency-free: the Excel and PDF readers live in the web app
 * and pass their raw cells / positioned text items to these helpers.
 *
 * Column names produced by the OFX and QIF converters ("Date",
 * "Description", "Reference", "Debit", "Credit") match the API's header
 * auto-detection, so the column mapping fills itself in.
 */

/** Columns produced by ofxToRows / qifToRows. */
export const STATEMENT_COLUMNS = ["Date", "Description", "Reference", "Debit", "Credit"] as const;

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Serialise rows to RFC 4180 CSV (CRLF line breaks, quotes only where needed). */
export function rowsToCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell ?? "";
          return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

// ── Shared helpers ───────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

function ddmmyyyy(year: number, month: number, day: number): string {
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

/** "-1,234.5" → { debit: "1234.50", credit: "" }; "250" → { credit: "250.00" }. */
function splitSignedAmount(raw: string): { debit: string; credit: string } {
  let s = raw.trim().replace(/[\s₹]/g, "");
  // Decimal comma ("12,50") when there is no dot; otherwise commas group thousands.
  if (/^[-+]?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n === 0) return { debit: "", credit: "" };
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? { debit: abs, credit: "" } : { debit: "", credit: abs };
}

function joinText(a: string, b: string): string {
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} - ${b}`;
}

// ── OFX / QFX ────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Leaf value of an OFX element. Works for SGML (no closing tag) and XML. */
function ofxValue(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([^<]*)`, "i"));
  return m ? decodeEntities(m[1]!.trim()) : "";
}

/** OFX date "20260401", "20260401120000.000[+5.30:IST]" → "01/04/2026". */
function ofxDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? ddmmyyyy(Number(m[1]), Number(m[2]), Number(m[3])) : "";
}

/**
 * Convert an OFX or QFX statement (OFX 1.x SGML or 2.x XML) to rows. The first
 * row is the header; one row per STMTTRN, in file order.
 */
export function ofxToRows(text: string): string[][] {
  const rows: string[][] = [[...STATEMENT_COLUMNS]];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  for (const block of blocks) {
    const date = ofxDate(ofxValue(block, "DTPOSTED") || ofxValue(block, "DTUSER"));
    if (!date) continue;
    const { debit, credit } = splitSignedAmount(ofxValue(block, "TRNAMT"));
    const description = joinText(ofxValue(block, "NAME") || ofxValue(block, "PAYEE"), ofxValue(block, "MEMO"));
    const reference = ofxValue(block, "FITID") || ofxValue(block, "CHECKNUM") || ofxValue(block, "REFNUM");
    rows.push([date, description, reference, debit, credit]);
  }
  return rows;
}

// ── QIF ──────────────────────────────────────────────────────────────────────

/**
 * QIF date → "DD/MM/YYYY". Accepts 01/04/2026, 1/4'26, 1/ 4/26, 01-04-2026,
 * 01.04.2026 and 2026-04-01. Day-first unless that is impossible (second part
 * over 12), since Indian exports are day-first; `order: "mdy"` flips it.
 */
export function parseQifDate(raw: string, order: "dmy" | "mdy" = "dmy"): string {
  const s = raw.trim().replace(/\s+/g, "");
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return ddmmyyyy(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-]|')(\d{2}|\d{4})$/);
  if (!m) return "";
  let a = Number(m[1]);
  let b = Number(m[2]);
  if (order === "mdy") [a, b] = [b, a];
  // a is the day, b the month — unless the month is impossible.
  if (b > 12 && a <= 12) [a, b] = [b, a];
  let year = Number(m[3]);
  if (m[3]!.length === 2) year += s.includes("'") || year < 50 ? 2000 : 1900;
  if (b < 1 || b > 12 || a < 1 || a > 31) return "";
  return ddmmyyyy(year, b, a);
}

const QIF_TRANSACTION_TYPES = new Set(["bank", "cash", "ccard", "oth a", "oth l"]);

/**
 * Convert a QIF file to rows. Reads bank-style records (!Type:Bank, Cash,
 * CCard, Oth A, Oth L): D date, T/U amount, P payee, M memo, N number, ^ end.
 */
export function qifToRows(text: string, order: "dmy" | "mdy" = "dmy"): string[][] {
  const rows: string[][] = [[...STATEMENT_COLUMNS]];
  // No !Type line at all: assume a bank register.
  let inTransactions = !/^!Type:/im.test(text);
  let rec: Record<string, string> = {};

  const flush = () => {
    const date = rec.D ? parseQifDate(rec.D, order) : "";
    if (inTransactions && date) {
      const { debit, credit } = splitSignedAmount(rec.T ?? rec.U ?? "");
      rows.push([date, joinText(rec.P ?? "", rec.M ?? ""), rec.N ?? "", debit, credit]);
    }
    rec = {};
  };

  for (const rawLine of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("!")) {
      flush();
      const type = line.match(/^!Type:(.*)$/i);
      if (type) inTransactions = QIF_TRANSACTION_TYPES.has(type[1]!.trim().toLowerCase());
      else if (/^!Account/i.test(line)) inTransactions = false;
      continue;
    }
    if (line.startsWith("^")) {
      flush();
      continue;
    }
    const code = line[0]!.toUpperCase();
    // Split lines (S/E/$) belong to the parent; keep the first value of each code.
    if ("DTUPMN".includes(code) && rec[code] === undefined) rec[code] = line.slice(1).trim();
  }
  flush();
  return rows;
}

// ── Header row detection (Excel and PDF) ─────────────────────────────────────

const DATE_HEADER = /\b(date|dt)\b/i;
const DEBIT_HEADER = /\b(debit|debits|withdrawal|withdrawals|dr)\b/i;
const CREDIT_HEADER = /\b(credit|credits|deposit|deposits|cr)\b/i;
const NARRATION_HEADER = /\b(narration|description|particulars|details|remarks)\b/i;
const AMOUNT_HEADER = /\bamount\b/i;

/** True when a row looks like a statement's column header row. */
export function isStatementHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => (c ?? "").trim()).filter(Boolean);
  // Title lines ("Statement from date … to …") are one or two long cells.
  if (cells.length < 3) return false;
  const has = (re: RegExp) => cells.some((c) => c.length <= 40 && re.test(c));
  return (
    has(DATE_HEADER) && (has(DEBIT_HEADER) || has(CREDIT_HEADER) || has(NARRATION_HEADER) || has(AMOUNT_HEADER))
  );
}

/** Index of the first header-looking row, or -1. */
export function findHeaderRowIndex(rows: string[][]): number {
  return rows.findIndex(isStatementHeaderRow);
}

const normaliseRow = (row: string[]) =>
  row
    .map((c) => (c ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");

/**
 * Tidy rows read from a spreadsheet or PDF: drop fully empty rows, drop the
 * title / account-info rows above the column header, and drop the header
 * when it repeats further down (one per page). Without a recognisable
 * header the rows are returned as they are, for the user to map.
 */
export function trimToHeaderRow(rows: string[][]): string[][] {
  const nonEmpty = rows.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  const idx = findHeaderRowIndex(nonEmpty);
  if (idx < 0) return nonEmpty;
  const header = nonEmpty[idx]!;
  const key = normaliseRow(header);
  const body = nonEmpty.slice(idx + 1).filter((r) => normaliseRow(r) !== key);
  return [header, ...body];
}

// ── Excel cells ──────────────────────────────────────────────────────────────

/**
 * Spreadsheet cell → text. Dates become DD/MM/YYYY (Excel dates carry no
 * time zone, so the calendar day is read in UTC); numbers become plain
 * decimals with no exponent or grouping.
 */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // Round to the nearest day so a stray time-zone offset can't shift it.
    const d = new Date(Math.round(value.getTime() / 86_400_000) * 86_400_000);
    return ddmmyyyy(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const s = String(value);
    return /e/i.test(s) ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 }) : s;
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).replace(/\s+/g, " ").trim();
}

/** Spreadsheet rows (first sheet, raw cells) → tidy statement rows. */
export function sheetToRows(cells: unknown[][]): string[][] {
  const rows = cells.map((row) => row.map(cellToString));
  // Trailing empty cells make rows ragged; trim them.
  for (const row of rows) while (row.length > 0 && row[row.length - 1] === "") row.pop();
  return trimToHeaderRow(rows);
}

// ── PDF text ─────────────────────────────────────────────────────────────────

/** A positioned text run from a PDF page. y grows downwards. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

type Line = { page: number; y: number; height: number; items: PdfTextItem[] };

function groupLines(items: PdfTextItem[]): Line[] {
  const sorted = items
    .filter((i) => i.str.trim() !== "")
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, Math.min(item.height || 10, last?.height || 10) * 0.5);
    if (last && last.page === item.page && Math.abs(item.y - last.y) <= tol) {
      last.items.push(item);
    } else {
      lines.push({ page: item.page, y: item.y, height: item.height || 10, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

type Span = { text: string; x0: number; x1: number };

/** Split a line into cells wherever the gap between runs is wider than a few spaces. */
function splitByGaps(items: PdfTextItem[]): Span[] {
  const spans: Span[] = [];
  for (const item of items) {
    const last = spans[spans.length - 1];
    const charWidth = item.str.length > 0 ? item.width / item.str.length : 5;
    const gap = Math.max(6, (item.height || 10) * 0.8, charWidth * 1.5);
    if (last && item.x - last.x1 <= gap) {
      last.text = `${last.text} ${item.str.trim()}`;
      last.x1 = Math.max(last.x1, item.x + item.width);
    } else {
      spans.push({ text: item.str.trim(), x0: item.x, x1: item.x + item.width });
    }
  }
  return spans;
}

/**
 * Turn positioned PDF text into statement rows. Lines are grouped by y and
 * split into cells by x gaps; the first line that looks like a column header
 * fixes the columns, and every later line's text is placed in the column it
 * overlaps most. Page furniture above a repeated header is dropped, and
 * wrapped narration lines (no date, close under the previous row) are joined
 * to the row above. Best effort: the user confirms the mapping next.
 */
export function pdfItemsToRows(items: PdfTextItem[]): string[][] {
  const lines = groupLines(items);
  if (lines.length === 0) return [];
  const cells = lines.map((l) => splitByGaps(l.items));
  const headerIdx = cells.findIndex((spans) => isStatementHeaderRow(spans.map((s) => s.text)));
  if (headerIdx < 0) return trimToHeaderRow(cells.map((spans) => spans.map((s) => s.text)));

  const columns = cells[headerIdx]!;
  const header = columns.map((c) => c.text);
  const headerKey = normaliseRow(header);
  const dateCol = header.findIndex((h) => DATE_HEADER.test(h));
  // Column bands: each runs halfway to its neighbours.
  const bands = columns.map((c, i) => ({
    left: i === 0 ? -Infinity : (columns[i - 1]!.x1 + c.x0) / 2,
    right: i === columns.length - 1 ? Infinity : (c.x1 + columns[i + 1]!.x0) / 2,
  }));

  const placeInColumns = (line: Line): string[] => {
    const row = header.map(() => "");
    for (const span of splitByGaps(line.items)) {
      let best = 0;
      let bestOverlap = -Infinity;
      bands.forEach((band, i) => {
        const overlap = Math.min(span.x1, band.right) - Math.max(span.x0, band.left);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = i;
        }
      });
      row[best] = row[best] ? `${row[best]} ${span.text}` : span.text;
    }
    return row;
  };

  // Pages whose own header repeats: skip the furniture above it.
  const repeatAt = new Map<number, number>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const key = normaliseRow(cells[i]!.map((s) => s.text));
    if (key === headerKey && !repeatAt.has(lines[i]!.page)) repeatAt.set(lines[i]!.page, i);
  }

  const rows: string[][] = [header];
  let prev: { line: Line; row: string[] } | null = null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const start = repeatAt.get(line.page);
    if (start !== undefined && i <= start) {
      prev = null;
      continue;
    }
    const row = placeInColumns(line);
    const isContinuation =
      prev !== null &&
      dateCol >= 0 &&
      row[dateCol] === "" &&
      prev.line.page === line.page &&
      line.y - prev.line.y <= Math.max(prev.line.height, line.height) * 2.2;
    if (isContinuation && prev) {
      row.forEach((text, c) => {
        if (text) prev!.row[c] = prev!.row[c] ? `${prev!.row[c]} ${text}` : text;
      });
      prev.line = line;
      continue;
    }
    rows.push(row);
    prev = { line, row };
  }
  return rows;
}
