/**
 * period-lock.ts — locked periods: books locked through a date, and GST months
 * marked as filed.
 *
 * Every writer of dated books entries (invoices, payments, expenses, journals,
 * stock documents, bank entries, imports…) calls assertPeriodOpen() with the
 * dates it is about to add, change or remove — both the old and the new date
 * of an edit. Writers sit behind the API, so this applies to the web app,
 * mobile, the CLI, MCP and imports alike.
 *
 * Dates are Indian calendar days, like everything else in the books: an
 * invoice stamped 18:45 UTC on 31 March is already 1 April in India.
 */

import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { periodLocks } from "@fintranzact/db";
import { istDateParts, istReturnPeriod } from "@fintranzact/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface LockInfo {
  /** Who set the lock, and when (ISO). */
  by: string | null;
  at: string;
  note: string | null;
}

export interface PeriodLockState {
  /** Last locked Indian calendar day, "YYYY-MM-DD", or null when books are open. */
  booksLockedThrough: string | null;
  booksLock: LockInfo | null;
  /** Return months marked as filed ("2026-08"). */
  gstMonths: Map<string, LockInfo>;
}

export const EMPTY_LOCK_STATE: PeriodLockState = { booksLockedThrough: null, booksLock: null, gstMonths: new Map() };

export interface LockViolation {
  kind: "books" | "gst";
  message: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-31" → "31 Mar 2026". */
export function formatLockDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "2026-08" → "Aug 2026". */
export function formatReturnPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** The Indian calendar day of an instant (or a plain "YYYY-MM-DD") as "YYYY-MM-DD". */
export function indianDay(date: Date | string): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const { year, month, day } = istDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const who = (info: LockInfo) => `${info.by ? `by ${info.by} ` : ""}on ${formatLockDate(info.at.slice(0, 10))}`;

/** Why an entry dated `date` cannot be added, changed or deleted, or null if the date is open. */
export function lockViolation(state: PeriodLockState, date: Date | string): LockViolation | null {
  const day = indianDay(date);
  if (state.booksLockedThrough && day <= state.booksLockedThrough) {
    const lock = state.booksLock;
    return {
      kind: "books",
      message:
        `This period is locked. Your books are locked through ${formatLockDate(state.booksLockedThrough)}` +
        `${lock ? ` (set ${who(lock)})` : ""}, so entries dated ${formatLockDate(day)} can't be added, changed or deleted.` +
        ` Ask the business owner to unlock the period if this needs to change.`,
    };
  }
  const month = istReturnPeriod(`${day}T12:00:00+05:30`);
  const gst = state.gstMonths.get(month);
  if (gst) {
    return {
      kind: "gst",
      message:
        `This period is locked. GST returns for ${formatReturnPeriod(month)} are marked as filed (locked ${who(gst)}), ` +
        `so entries dated in that month can't be added, changed or deleted.` +
        ` Ask the business owner to unlock the month if a correction is needed.`,
    };
  }
  return null;
}

/** A whole return month is locked: marked as filed, or entirely inside the locked books. */
export function returnPeriodViolation(state: PeriodLockState, period: string): LockViolation | null {
  const gst = state.gstMonths.get(period);
  if (gst) {
    return {
      kind: "gst",
      message: `This period is locked. GST returns for ${formatReturnPeriod(period)} are marked as filed (locked ${who(gst)}), so its input tax credit and returns data can't be changed. Ask the business owner to unlock the month.`,
    };
  }
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  if (state.booksLockedThrough && monthEnd <= state.booksLockedThrough) {
    return {
      kind: "books",
      message: `This period is locked. Your books are locked through ${formatLockDate(state.booksLockedThrough)}, which covers ${formatReturnPeriod(period)}. Ask the business owner to unlock the period.`,
    };
  }
  return null;
}

export async function loadPeriodLockState(db: Db, businessId: string): Promise<PeriodLockState> {
  const rows = await db.select().from(periodLocks).where(eq(periodLocks.businessId, businessId));
  const state: PeriodLockState = { booksLockedThrough: null, booksLock: null, gstMonths: new Map() };
  for (const r of rows) {
    const info: LockInfo = { by: r.lockedByName ?? null, at: new Date(r.createdAt).toISOString(), note: r.note ?? null };
    if (r.kind === "books" && r.lockedThrough) {
      state.booksLockedThrough = String(r.lockedThrough).slice(0, 10);
      state.booksLock = { ...info, at: new Date(r.updatedAt).toISOString() };
    } else if (r.kind === "gst" && r.returnPeriod) {
      state.gstMonths.set(r.returnPeriod, info);
    }
  }
  return state;
}

/**
 * Throws if any of the dates falls in a locked period. Pass every date the
 * change touches: the date being added, the old and the new date of an edit,
 * the date of what is deleted. null / undefined entries are ignored.
 */
export async function assertPeriodOpen(
  db: Db,
  businessId: string,
  dates: Array<Date | string | null | undefined>,
): Promise<void> {
  const real = dates.filter((d): d is Date | string => d != null && d !== "");
  if (real.length === 0) return;
  const state = await loadPeriodLockState(db, businessId);
  if (!state.booksLockedThrough && state.gstMonths.size === 0) return;
  for (const d of real) {
    const v = lockViolation(state, d);
    if (v) throw new TRPCError({ code: "FORBIDDEN", message: v.message });
  }
}

/** Like assertPeriodOpen, for something dated by return month ("2026-08") such as an ITC entry. */
export async function assertReturnPeriodOpen(db: Db, businessId: string, periods: Array<string | null | undefined>): Promise<void> {
  const real = periods.filter((p): p is string => !!p);
  if (real.length === 0) return;
  const state = await loadPeriodLockState(db, businessId);
  for (const p of real) {
    const v = returnPeriodViolation(state, p);
    if (v) throw new TRPCError({ code: "FORBIDDEN", message: v.message });
  }
}

/** True when any lock exists: used to protect figures that apply to the whole history (opening balances). */
export async function hasAnyLock(db: Db, businessId: string): Promise<boolean> {
  const [row] = await db.select({ id: periodLocks.id }).from(periodLocks).where(eq(periodLocks.businessId, businessId)).limit(1);
  return !!row;
}

/** The message shown when something that applies to the whole history is changed while books are locked. */
export const LOCKED_BOOKS_OPENING_BALANCE_MESSAGE =
  "This period is locked. Opening balances are part of closed books and can't be changed while a period is locked. Ask the business owner to unlock the period.";

