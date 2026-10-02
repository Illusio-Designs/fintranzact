/**
 * tds-26as.ts — reconciles TDS our customers deducted (Form 26AS / AIS rows)
 * with the TDS receivable recorded in the books. Pure: no database.
 *
 * The comparison is by sums, not row by row: a customer's 26AS rows are added
 * up per customer + section family + quarter and compared with the books'
 * receivable deductions for the same key, within a small tolerance. (Customers
 * deposit and report TDS on their own dates, so one books entry rarely lines up
 * with exactly one 26AS row.)
 *
 * Customers (parties) carry no TAN in this system, so the deductor is resolved to a
 * customer, in order, by: a manual link on the row, a link made earlier on another
 * row with the same TAN, then an unambiguous, close name match. Anything else is
 * left unresolved ("missing in books") for the user to link by hand.
 */

import { money } from "@fintranzact/shared";

export type Tds26asStatus = "matched" | "amount_differs" | "missing_in_books" | "missing_in_26as" | "ignored";

export interface Tds26asEntryIn {
  id: string;
  deductorTan: string;
  deductorName: string | null;
  section: string;
  quarter: number;
  taxDeducted: string;
  /** A manual link (or one carried over by TAN from an earlier import). */
  partyId: string | null;
  /** "pending" (reconcile) or "ignored" (left out of the sums). */
  status: string;
}

export interface Tds26asPartyIn {
  id: string;
  name: string;
  legalName?: string | null;
  tradeName?: string | null;
}

/** Books receivable TDS for one customer, books section code and quarter. */
export interface Tds26asBookIn {
  partyId: string;
  sectionCode: string;
  quarter: number;
  amount: string;
}

export interface Tds26asRow {
  key: string;
  status: Tds26asStatus;
  partyId: string | null;
  partyName: string | null;
  /** How the customer was found: "link" (manual), "tan" (linked earlier by TAN), "name", or null. */
  matchedVia: "link" | "tan" | "name" | null;
  deductorTan: string | null;
  deductorName: string | null;
  /** Section family: "194J" covers the books' 194J_TECH / 194J_PROF and 26AS "194J(a)" / "194J(b)". */
  section: string;
  quarter: number;
  amount26as: string;
  booksAmount: string;
  /** 26AS minus books. */
  difference: string;
  entryIds: string[];
}

export interface Tds26asReconciliation {
  rows: Tds26asRow[];
  counts: Record<Tds26asStatus, number>;
  total26as: string;
  totalBooks: string;
}

/** Differences up to this (rupees) still count as a match: rounding in either place. */
export const TDS_26AS_TOLERANCE = "1.00";

/**
 * Section family used to compare 26AS sections with the books' codes:
 * "194J(b)" / "194JB" / "194J_PROF" → "194J"; "194I(a)" / "194I_LB" → "194I".
 * Other sections are upper-cased with spaces and brackets removed ("194C").
 * "194IA" / "194IB" (property, rent by individuals) are different sections and stay as they are.
 */
export function sectionFamily(code: string): string {
  const c = code.trim().toUpperCase().replace(/\s+/g, "");
  if (/^194J(\([AB]\)|[AB]|_.*)?$/.test(c)) return "194J";
  if (/^194I(\([AB]\)|_.*)$/.test(c) || c === "194I") return "194I";
  return c.replace(/[()]/g, "").replace(/_/g, "");
}

const NAME_NOISE = new Set([
  "pvt", "private", "ltd", "limited", "llp", "inc", "co", "company", "corp", "corporation", "the", "and", "of", "m", "s", "ms",
]);

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/&/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t && !NAME_NOISE.has(t)),
  );
}

/** 0..1 — 1 when the names have the same words (ignoring Pvt/Ltd and order), else word-overlap (Jaccard). */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}

/** Names at least this alike (and clearly better than any other customer) are matched automatically. */
export const NAME_MATCH_THRESHOLD = 0.8;

/** The one customer whose name is clearly the deductor's, or null when none is or several tie. */
export function matchPartyByName(name: string | null, parties: readonly Tds26asPartyIn[]): string | null {
  if (!name || !name.trim()) return null;
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const p of parties) {
    const score = Math.max(
      ...[p.name, p.legalName, p.tradeName].filter((n): n is string => !!n).map((n) => nameSimilarity(name, n)),
    );
    if (score < NAME_MATCH_THRESHOLD) continue;
    if (!best || score > best.score) { best = { id: p.id, score }; tie = false; }
    else if (score === best.score && p.id !== best.id) tie = true;
  }
  return best && !tie ? best.id : null;
}

export interface ResolvedParty {
  partyId: string | null;
  via: "link" | "tan" | "name" | null;
}

/** Customer behind one 26AS row: its own link, else a link on another row with the same TAN, else the name. */
export function resolveParty(
  entry: Pick<Tds26asEntryIn, "partyId" | "deductorTan" | "deductorName">,
  tanLinks: ReadonlyMap<string, string>,
  parties: readonly Tds26asPartyIn[],
): ResolvedParty {
  if (entry.partyId) return { partyId: entry.partyId, via: "link" };
  const byTan = tanLinks.get(entry.deductorTan);
  if (byTan) return { partyId: byTan, via: "tan" };
  const byName = matchPartyByName(entry.deductorName, parties);
  return byName ? { partyId: byName, via: "name" } : { partyId: null, via: null };
}

const ZERO_COUNTS = (): Record<Tds26asStatus, number> => ({
  matched: 0, amount_differs: 0, missing_in_books: 0, missing_in_26as: 0, ignored: 0,
});

/**
 * Compare 26AS rows with the books. `tolerance` is rupees. Rows come back
 * grouped (customer, section family, quarter), 26AS groups first, then
 * books-only groups, each ordered by quarter then name.
 */
export function reconcile26as(input: {
  entries: readonly Tds26asEntryIn[];
  parties: readonly Tds26asPartyIn[];
  books: readonly Tds26asBookIn[];
  tolerance?: string;
}): Tds26asReconciliation {
  const tolerance = input.tolerance ?? TDS_26AS_TOLERANCE;
  const partyById = new Map(input.parties.map((p) => [p.id, p]));

  // A link made on any row applies to every row with that TAN.
  const tanLinks = new Map<string, string>();
  for (const e of input.entries) if (e.partyId && !tanLinks.has(e.deductorTan)) tanLinks.set(e.deductorTan, e.partyId);

  // Books by customer + section family + quarter.
  const booksByKey = new Map<string, { partyId: string; section: string; quarter: number; amount: string }>();
  for (const b of input.books) {
    const section = sectionFamily(b.sectionCode);
    const key = `${b.partyId}|${section}|${b.quarter}`;
    const cur = booksByKey.get(key);
    if (cur) cur.amount = money.add(cur.amount, b.amount);
    else booksByKey.set(key, { partyId: b.partyId, section, quarter: b.quarter, amount: b.amount });
  }

  interface Group {
    key: string;
    ignored: boolean;
    partyId: string | null;
    via: ResolvedParty["via"];
    tan: string;
    names: string[];
    section: string;
    quarter: number;
    amount: string;
    ids: string[];
  }
  const groups = new Map<string, Group>();
  for (const e of input.entries) {
    const ignored = e.status === "ignored";
    const { partyId, via } = resolveParty(e, tanLinks, input.parties);
    const section = sectionFamily(e.section);
    const base = partyId ? `${partyId}|${section}|${e.quarter}` : `tan:${e.deductorTan}|${section}|${e.quarter}`;
    const key = ignored ? `${base}|ignored` : base;
    let g = groups.get(key);
    if (!g) {
      g = { key, ignored, partyId, via, tan: e.deductorTan, names: [], section, quarter: e.quarter, amount: "0.00", ids: [] };
      groups.set(key, g);
    }
    g.amount = money.add(g.amount, e.taxDeducted);
    g.ids.push(e.id);
    if (e.deductorName && !g.names.includes(e.deductorName)) g.names.push(e.deductorName);
  }

  const counts = ZERO_COUNTS();
  const rows: Tds26asRow[] = [];
  const seenBooks = new Set<string>();
  let total26as = "0.00";

  for (const g of groups.values()) {
    const party = g.partyId ? partyById.get(g.partyId) : undefined;
    const books = g.partyId && !g.ignored ? booksByKey.get(`${g.partyId}|${g.section}|${g.quarter}`) : undefined;
    if (books) seenBooks.add(`${g.partyId}|${g.section}|${g.quarter}`);
    const booksAmount = books?.amount ?? "0.00";
    let status: Tds26asStatus;
    if (g.ignored) status = "ignored";
    else if (!books) status = "missing_in_books";
    else status = Math.abs(money.toNumber(money.sub(g.amount, booksAmount))) <= money.toNumber(tolerance) ? "matched" : "amount_differs";
    if (!g.ignored) total26as = money.add(total26as, g.amount);
    counts[status]++;
    rows.push({
      key: g.key,
      status,
      partyId: g.partyId,
      partyName: party?.name ?? null,
      matchedVia: g.via,
      deductorTan: g.tan,
      deductorName: g.names[0] ?? null,
      section: g.section,
      quarter: g.quarter,
      amount26as: g.amount,
      booksAmount,
      difference: money.sub(g.amount, booksAmount),
      entryIds: g.ids,
    });
  }

  // Books deductions nothing in the 26AS covers.
  let totalBooks = "0.00";
  for (const [key, b] of booksByKey) {
    totalBooks = money.add(totalBooks, b.amount);
    if (seenBooks.has(key)) continue;
    if (!money.isPositive(b.amount)) continue;
    counts.missing_in_26as++;
    rows.push({
      key: `books:${key}`,
      status: "missing_in_26as",
      partyId: b.partyId,
      partyName: partyById.get(b.partyId)?.name ?? null,
      matchedVia: null,
      deductorTan: null,
      deductorName: null,
      section: b.section,
      quarter: b.quarter,
      amount26as: "0.00",
      booksAmount: b.amount,
      difference: money.sub("0", b.amount),
      entryIds: [],
    });
  }

  const order = (r: Tds26asRow) => (r.status === "missing_in_26as" ? 1 : 0);
  rows.sort((a, b) =>
    order(a) - order(b) || a.quarter - b.quarter ||
    (a.partyName ?? a.deductorName ?? "").localeCompare(b.partyName ?? b.deductorName ?? "") ||
    a.section.localeCompare(b.section),
  );
  return { rows, counts, total26as, totalBooks };
}
