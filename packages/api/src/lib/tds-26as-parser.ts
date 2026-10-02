/**
 * tds-26as-parser.ts — reads a Form 26AS / AIS TDS export the user uploads.
 *
 * SUPPORTED FORMAT: a CSV (comma, or tab) with a header row. Columns are matched
 * case-insensitively, ignoring punctuation, with a few common aliases:
 *
 *   Deductor TAN             required   (also: TAN, TAN of Deductor)
 *   Section                  required   (also: Section Code)
 *   Transaction Date         required   (also: Date of Transaction, Date of Payment/Credit,
 *                                        Date of Booking, Date)
 *   Tax Deducted             required   (also: Total Tax Deducted, TDS Deducted)
 *   Deductor Name            optional   (also: Name of Deductor)
 *   Amount Paid/Credited     optional   (also: Total Amount Paid/Credited, Amount Paid)
 *   TDS Deposited            optional   (also: Total TDS Deposited, Tax Deposited)
 *
 * Dates may be dd-MMM-yyyy (15-Jun-2025, as TRACES prints them), dd/mm/yyyy,
 * dd-mm-yyyy or yyyy-mm-dd. Indian-style amounts ("1,23,456.00") are accepted.
 *
 * NOT SUPPORTED: the raw TRACES Form 26AS text file ('^'-delimited records) and
 * AIS JSON. Their field layouts are not implemented here because they cannot be
 * done faithfully without the official specification, and guessing field
 * positions would silently mis-read tax credits. Such files are rejected with a
 * clear message; export or copy the TDS section into a CSV with the columns
 * above instead.
 *
 * Pure: no database, no clock.
 */

import { money } from "@fintranzact/shared";

export interface Tds26asRow {
  deductorTan: string;
  deductorName: string | null;
  /** As printed in the file, trimmed ("194C", "194J(b)"). */
  section: string;
  /** Instant of the transaction date (start of that day in India). */
  txnDate: Date;
  amountPaid: string;
  taxDeducted: string;
  /** Null when the file has no deposited column. */
  taxDeposited: string | null;
}

export interface Tds26asSkipped {
  /** 1-based line number in the file. */
  line: number;
  reason: string;
}

export interface Tds26asParseResult {
  rows: Tds26asRow[];
  skipped: Tds26asSkipped[];
}

const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;

const COLUMN_ALIASES = {
  tan: ["deductor_tan", "tan", "tan_of_deductor", "tan_of_the_deductor", "tan_of_deductor_collector", "deductor_tan_no"],
  name: ["deductor_name", "name_of_deductor", "name_of_the_deductor", "deductor", "name_of_deductor_collector"],
  section: ["section", "section_code", "tds_section"],
  date: ["transaction_date", "date_of_transaction", "date_of_payment_credit", "date_of_booking", "date_of_payment", "txn_date", "date"],
  paid: ["amount_paid_credited", "total_amount_paid_credited", "amount_paid", "amount_credited", "amount_paid_credited_rs"],
  deducted: ["tax_deducted", "total_tax_deducted", "tds_deducted", "tax_deducted_tds", "total_tds_deducted", "tax_deducted_rs"],
  deposited: ["tds_deposited", "total_tds_deposited", "tax_deposited", "total_tax_deposited", "tds_deposited_rs"],
} as const;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const normaliseHeader = (h: string) =>
  h.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

/** Start of an Indian calendar day (IST is UTC+05:30, no DST). */
function istDay(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - (5 * 60 + 30) * 60_000);
  // Reject 31-Feb style dates that rolled over.
  const back = new Date(d.getTime() + (5 * 60 + 30) * 60_000);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return d;
}

/** Parse one of the supported date spellings; null when it is none of them. */
export function parse26asDate(raw: string): Date | null {
  const v = raw.trim();
  let m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]+(\d{4})$/.exec(v);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase()];
    return mon ? istDay(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (m) return istDay(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
  if (m) return istDay(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** "1,23,456.5" → "123456.50"; null for anything that is not a plain non-negative amount. */
export function parse26asAmount(raw: string | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim().replace(/^(?:rs\.?|inr|₹)\s*/i, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return money.add(v, "0");
}

function splitLine(line: string, sep: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; } else inQuote = !inQuote;
    } else if (ch === sep && !inQuote) {
      cols.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

/**
 * Parse a 26AS / AIS TDS CSV. Throws a plain Error (shown to the user) when the
 * file is not a supported format or lacks a required column. Rows that cannot
 * be read (bad TAN, date or amount, a total line) are returned in `skipped`
 * with their line number rather than failing the whole file.
 */
export function parse26asCsv(content: string): Tds26asParseResult {
  const text = content.replace(/^﻿/, "");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const headerIdx = lines.findIndex((l) => l.trim().length > 0);
  if (headerIdx < 0) throw new Error("The file is empty");

  // The raw TRACES text file: '^'-delimited records. Not supported (see header).
  const firstLine = lines[headerIdx]!;
  if (firstLine.includes("^") || /^\s*[[{]/.test(text)) {
    throw new Error(
      "This looks like the TRACES Form 26AS text file or an AIS JSON file. Only CSV is supported: " +
        "put the TDS rows in a CSV with the columns Deductor Name, Deductor TAN, Section, Transaction Date, " +
        "Amount Paid/Credited, Tax Deducted, TDS Deposited.",
    );
  }

  const sep = firstLine.includes("\t") ? "\t" : ",";
  const headers = splitLine(firstLine, sep).map(normaliseHeader);
  const find = (aliases: readonly string[]) => {
    for (const a of aliases) {
      const i = headers.indexOf(a);
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = {
    tan: find(COLUMN_ALIASES.tan),
    name: find(COLUMN_ALIASES.name),
    section: find(COLUMN_ALIASES.section),
    date: find(COLUMN_ALIASES.date),
    paid: find(COLUMN_ALIASES.paid),
    deducted: find(COLUMN_ALIASES.deducted),
    deposited: find(COLUMN_ALIASES.deposited),
  };
  const missing: string[] = [];
  if (col.tan < 0) missing.push("Deductor TAN");
  if (col.section < 0) missing.push("Section");
  if (col.date < 0) missing.push("Transaction Date");
  if (col.deducted < 0) missing.push("Tax Deducted");
  if (missing.length > 0) throw new Error(`The CSV is missing required column(s): ${missing.join(", ")}`);

  const rows: Tds26asRow[] = [];
  const skipped: Tds26asSkipped[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const cols = splitLine(raw, sep);
    const line = i + 1;
    if (cols.every((c) => c === "")) continue;

    const tan = (cols[col.tan] ?? "").replace(/\s+/g, "").toUpperCase();
    if (!TAN_RE.test(tan)) {
      skipped.push({ line, reason: tan ? `"${tan}" is not a valid TAN` : "No TAN (a total or blank row)" });
      continue;
    }
    const section = (cols[col.section] ?? "").trim();
    if (!section) { skipped.push({ line, reason: "No section" }); continue; }
    const txnDate = parse26asDate(cols[col.date] ?? "");
    if (!txnDate) { skipped.push({ line, reason: `Unreadable transaction date "${cols[col.date] ?? ""}"` }); continue; }
    const taxDeducted = parse26asAmount(cols[col.deducted]);
    if (taxDeducted == null) { skipped.push({ line, reason: `Unreadable tax deducted "${cols[col.deducted] ?? ""}"` }); continue; }

    let amountPaid = "0.00";
    if (col.paid >= 0 && (cols[col.paid] ?? "") !== "") {
      const p = parse26asAmount(cols[col.paid]);
      if (p == null) { skipped.push({ line, reason: `Unreadable amount paid "${cols[col.paid]}"` }); continue; }
      amountPaid = p;
    }
    let taxDeposited: string | null = null;
    if (col.deposited >= 0 && (cols[col.deposited] ?? "") !== "") {
      const d = parse26asAmount(cols[col.deposited]);
      if (d == null) { skipped.push({ line, reason: `Unreadable TDS deposited "${cols[col.deposited]}"` }); continue; }
      taxDeposited = d;
    }

    rows.push({
      deductorTan: tan,
      deductorName: col.name >= 0 ? (cols[col.name] || null) : null,
      section,
      txnDate,
      amountPaid,
      taxDeducted,
      taxDeposited,
    });
  }
  return { rows, skipped };
}
