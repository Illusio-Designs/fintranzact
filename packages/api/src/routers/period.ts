/**
 * period.ts — locked periods and year-end close.
 *
 *   status                     what is locked, who can lock / unlock
 *   lockBooks / unlockBooks    lock everything on or before a date
 *   lockGstMonth / unlockGstMonth   mark a month's GST return as filed
 *   closeYearPreview / closeYear / reopenYear   year-end close
 *   closes / closeDetail       closed years and their frozen balances
 *
 * Locking is for owners, admins and accountants (the `PeriodLock` permission).
 * Unlocking and reopening a year are OWNER-ONLY, need a written reason, and are
 * recorded in the audit log. What a lock blocks is enforced by every writer via
 * lib/period-lock.ts, so it holds on web, mobile, the API, CLI, MCP and imports.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { businesses, financialYearCloses, periodLocks } from "@fintranzact/db";
import { financialYearRange, istDateParts, istReturnPeriod } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { withAudit } from "../lib/audit.js";
import { formatLockDate, formatReturnPeriod, indianDay, loadPeriodLockState } from "../lib/period-lock.js";
import { buildYearCloseSnapshot, startYearOf, yearBounds, yearCloseWarnings } from "../lib/year-close.js";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-31");
const returnPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a return month like 2026-08");
const fyLabel = z.string().regex(/^\d{4}-\d{2}$/, "Use a financial year like 2025-26");
const reason = z.string().trim().min(10, "Say why, in at least 10 characters").max(500);
const note = z.string().trim().max(300).optional();

const OWNER_ONLY = "Only the business owner can unlock a period or reopen a year.";

function assertOwner(role: string | undefined): void {
  if (role !== "superadmin") throw new TRPCError({ code: "FORBIDDEN", message: OWNER_ONLY });
}

/** Today in India, "YYYY-MM-DD". */
const today = () => indianDay(new Date());

function yesterday(): string {
  const { year, month, day } = istDateParts(new Date());
  const d = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

function assertRealDate(d: string): void {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m! - 1 || dt.getUTCDate() !== day) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${d} is not a real date` });
  }
}

function assertRealYear(fy: string): void {
  const start = parseInt(fy.slice(0, 4), 10);
  if (String((start + 1) % 100).padStart(2, "0") !== fy.slice(5)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A financial year looks like 2025-26" });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fyStartMonth(db: any, businessId: string): Promise<number> {
  const [b] = await db.select({ m: businesses.financialYearStart }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return b?.m ?? 4;
}

export const periodRouter = router({
  // ── What is locked ──────────────────────────────────────────────

  /** What is locked and what the caller can do. Open to every member: it is what an edit screen needs to explain a block. */
  status: viewerProcedure.query(async ({ ctx }) => {
    const state = await loadPeriodLockState(ctx.db, ctx.businessId);
    const canLock = ctx.ability.can("create", "PeriodLock");
    const closes = await ctx.db
      .select({ financialYear: financialYearCloses.financialYear, closedAt: financialYearCloses.closedAt, closedByName: financialYearCloses.closedByName })
      .from(financialYearCloses)
      .where(eq(financialYearCloses.businessId, ctx.businessId))
      .orderBy(desc(financialYearCloses.financialYear));
    return {
      booksLockedThrough: state.booksLockedThrough,
      booksLock: state.booksLock,
      gstMonths: [...state.gstMonths.entries()]
        .map(([period, info]) => ({ returnPeriod: period, ...info }))
        .sort((a, b) => b.returnPeriod.localeCompare(a.returnPeriod)),
      closedYears: closes,
      canLock,
      canUnlock: ctx.role === "superadmin",
      today: today(),
      latestLockableDate: yesterday(),
    };
  }),

  // ── Books lock ──────────────────────────────────────────────────

  /** Lock everything dated on or before `through` (a past day). Extends an existing lock; going back needs `unlockBooks`. */
  lockBooks: memberProcedure
    .input(z.object({ through: ymd, note }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "PeriodLock");
      assertRealDate(input.through);
      if (input.through > yesterday()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Books can be locked up to yesterday (${formatLockDate(yesterday())}) at the latest, not ${formatLockDate(input.through)}.` });
      }
      const state = await loadPeriodLockState(ctx.db, ctx.businessId);
      if (state.booksLockedThrough && input.through <= state.booksLockedThrough) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Books are already locked through ${formatLockDate(state.booksLockedThrough)}. Only the owner can unlock earlier dates.` });
      }
      const values = { lockedThrough: input.through, note: input.note ?? null, lockedByUserId: ctx.user!.id, lockedByName: ctx.user!.name, updatedAt: new Date() };
      const [row] = state.booksLockedThrough
        ? await ctx.db.update(periodLocks).set(values).where(and(eq(periodLocks.businessId, ctx.businessId), eq(periodLocks.kind, "books"))).returning()
        : await ctx.db.insert(periodLocks).values({ businessId: ctx.businessId, kind: "books", ...values }).returning();
      return { id: row!.id, lockedThrough: input.through, previous: state.booksLockedThrough };
    }, (r) => ({
      action: "period.lockBooks",
      entityType: "period_locks",
      entityId: r.id,
      metadata: { lockedThrough: r.lockedThrough, previous: r.previous },
    }))),

  /** Owner only. Lower the books lock to `through`, or remove it (`through: null`). A closed year must be reopened instead. */
  unlockBooks: memberProcedure
    .input(z.object({ through: ymd.nullable(), reason }))
    .mutation(withAudit(async ({ input, ctx }) => {
      assertOwner(ctx.role);
      if (input.through) assertRealDate(input.through);
      const state = await loadPeriodLockState(ctx.db, ctx.businessId);
      if (!state.booksLockedThrough) throw new TRPCError({ code: "BAD_REQUEST", message: "The books are not locked." });
      if (input.through && input.through >= state.booksLockedThrough) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Books are locked through ${formatLockDate(state.booksLockedThrough)}. Unlock to an earlier date, or lock to a later one.` });
      }

      const floor = input.through ?? "0000-00-00";
      const closes = await ctx.db.select({ fy: financialYearCloses.financialYear, snapshot: financialYearCloses.snapshot }).from(financialYearCloses).where(eq(financialYearCloses.businessId, ctx.businessId));
      const blocking = closes.find((c) => indianDay((c.snapshot as { to: string }).to) > floor);
      if (blocking) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Financial year ${blocking.fy} is closed. Reopen the year instead of unlocking part of it.` });
      }

      let id: string;
      if (input.through) {
        const [row] = await ctx.db.update(periodLocks).set({ lockedThrough: input.through, lockedByUserId: ctx.user!.id, lockedByName: ctx.user!.name, updatedAt: new Date() })
          .where(and(eq(periodLocks.businessId, ctx.businessId), eq(periodLocks.kind, "books"))).returning({ id: periodLocks.id });
        id = row!.id;
      } else {
        const [row] = await ctx.db.delete(periodLocks).where(and(eq(periodLocks.businessId, ctx.businessId), eq(periodLocks.kind, "books"))).returning({ id: periodLocks.id });
        id = row!.id;
      }
      return { id, from: state.booksLockedThrough, to: input.through, reason: input.reason };
    }, (r) => ({
      action: "period.unlockBooks",
      entityType: "period_locks",
      entityId: r.id,
      metadata: { from: r.from, to: r.to, reason: r.reason },
    }))),

  // ── GST month lock ──────────────────────────────────────────────

  /** Mark a past month's GST return as filed: nothing dated in it can change. */
  lockGstMonth: memberProcedure
    .input(z.object({ returnPeriod, note }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "PeriodLock");
      if (input.returnPeriod >= istReturnPeriod(new Date())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${formatReturnPeriod(input.returnPeriod)} isn't over yet, so its return can't be marked as filed.` });
      }
      const state = await loadPeriodLockState(ctx.db, ctx.businessId);
      if (state.gstMonths.has(input.returnPeriod)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${formatReturnPeriod(input.returnPeriod)} is already marked as filed.` });
      }
      const [row] = await ctx.db.insert(periodLocks).values({
        businessId: ctx.businessId, kind: "gst", returnPeriod: input.returnPeriod, note: input.note ?? null,
        lockedByUserId: ctx.user!.id, lockedByName: ctx.user!.name,
      }).returning({ id: periodLocks.id });
      return { id: row!.id, returnPeriod: input.returnPeriod };
    }, (r) => ({ action: "period.lockGstMonth", entityType: "period_locks", entityId: r.id, metadata: { returnPeriod: r.returnPeriod } }))),

  /** Owner only. Reopen a month marked as filed. */
  unlockGstMonth: memberProcedure
    .input(z.object({ returnPeriod, reason }))
    .mutation(withAudit(async ({ input, ctx }) => {
      assertOwner(ctx.role);
      const [row] = await ctx.db.delete(periodLocks)
        .where(and(eq(periodLocks.businessId, ctx.businessId), eq(periodLocks.kind, "gst"), eq(periodLocks.returnPeriod, input.returnPeriod)))
        .returning({ id: periodLocks.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `${formatReturnPeriod(input.returnPeriod)} is not marked as filed.` });
      return { id: row.id, returnPeriod: input.returnPeriod, reason: input.reason };
    }, (r) => ({ action: "period.unlockGstMonth", entityType: "period_locks", entityId: r.id, metadata: { returnPeriod: r.returnPeriod, reason: r.reason } }))),

  // ── Year-end close ──────────────────────────────────────────────

  /** What closing a year would do: its balances, and what to fix first. */
  closeYearPreview: memberProcedure
    .input(z.object({ financialYear: fyLabel }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "PeriodLock");
      assertRealYear(input.financialYear);
      const startMonth = await fyStartMonth(ctx.db, ctx.businessId);
      const y = yearBounds(startYearOf(input.financialYear), startMonth);
      const [already] = await ctx.db.select({ id: financialYearCloses.id }).from(financialYearCloses)
        .where(and(eq(financialYearCloses.businessId, ctx.businessId), eq(financialYearCloses.financialYear, input.financialYear))).limit(1);
      const warnings = await yearCloseWarnings(ctx.db, ctx.businessId, y);
      const ended = y.to.getTime() < Date.now();
      const snapshot = await buildYearCloseSnapshot(ctx.db, ctx.businessId, { label: y.label, from: y.from, to: y.to });
      return { financialYear: input.financialYear, from: y.from, to: y.to, ended, alreadyClosed: !!already, warnings, snapshot };
    }),

  /** Close a finished year: freeze its closing balances and lock the books through its last day. */
  closeYear: memberProcedure
    .input(z.object({ financialYear: fyLabel, note, force: z.boolean().default(false) }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "PeriodLock");
      assertRealYear(input.financialYear);
      const startMonth = await fyStartMonth(ctx.db, ctx.businessId);
      const y = yearBounds(startYearOf(input.financialYear), startMonth);
      if (y.to.getTime() >= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Financial year ${input.financialYear} isn't over yet (it ends on ${formatLockDate(indianDay(y.to))}).` });
      }
      const [already] = await ctx.db.select({ id: financialYearCloses.id }).from(financialYearCloses)
        .where(and(eq(financialYearCloses.businessId, ctx.businessId), eq(financialYearCloses.financialYear, input.financialYear))).limit(1);
      if (already) throw new TRPCError({ code: "CONFLICT", message: `Financial year ${input.financialYear} is already closed.` });

      const warnings = await yearCloseWarnings(ctx.db, ctx.businessId, y);
      if (warnings.length > 0 && !input.force) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${warnings.join(" ")} Fix this, or close anyway.` });
      }

      return ctx.db.transaction(async (tx) => {
        const snapshot = await buildYearCloseSnapshot(tx, ctx.businessId, { label: y.label, from: y.from, to: y.to });
        const [close] = await tx.insert(financialYearCloses).values({
          businessId: ctx.businessId, financialYear: input.financialYear, closedByUserId: ctx.user!.id, closedByName: ctx.user!.name,
          note: input.note ?? null, snapshot,
        }).returning({ id: financialYearCloses.id });

        // Lock the books through the year's last day (never lowering an existing, later lock).
        const through = indianDay(y.to);
        const state = await loadPeriodLockState(tx, ctx.businessId);
        if (!state.booksLockedThrough || through > state.booksLockedThrough) {
          const values = { lockedThrough: through, note: `Year ${input.financialYear} closed`, lockedByUserId: ctx.user!.id, lockedByName: ctx.user!.name, updatedAt: new Date() };
          if (state.booksLockedThrough) {
            await tx.update(periodLocks).set(values).where(and(eq(periodLocks.businessId, ctx.businessId), eq(periodLocks.kind, "books")));
          } else {
            await tx.insert(periodLocks).values({ businessId: ctx.businessId, kind: "books", ...values });
          }
        }
        return { id: close!.id, financialYear: input.financialYear, lockedThrough: through, forced: input.force && warnings.length > 0 };
      });
    }, (r) => ({ action: "period.closeYear", entityType: "financial_year_closes", entityId: r.id, metadata: { financialYear: r.financialYear, lockedThrough: r.lockedThrough, forced: r.forced } }))),

  /** Owner only. Reopen a closed year: its snapshot is removed and the books are unlocked from its start. Later closed years must be reopened first. */
  reopenYear: memberProcedure
    .input(z.object({ financialYear: fyLabel, reason }))
    .mutation(withAudit(async ({ input, ctx }) => {
      assertOwner(ctx.role);
      assertRealYear(input.financialYear);
      const closes = await ctx.db.select().from(financialYearCloses).where(eq(financialYearCloses.businessId, ctx.businessId));
      const target = closes.find((c: { financialYear: string }) => c.financialYear === input.financialYear);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: `Financial year ${input.financialYear} is not closed.` });
      const later = closes.filter((c: { financialYear: string }) => c.financialYear > input.financialYear).sort((a: { financialYear: string }, b: { financialYear: string }) => a.financialYear.localeCompare(b.financialYear));
      if (later.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Financial year ${later[0].financialYear} is closed after it. Reopen the later year first.` });
      }
      const earlier = closes.filter((c: { financialYear: string }) => c.financialYear < input.financialYear).sort((a: { financialYear: string }, b: { financialYear: string }) => b.financialYear.localeCompare(a.financialYear));
      const lockTo: string | null = earlier.length > 0 ? indianDay((earlier[0].snapshot as { to: string }).to) : null;

      await ctx.db.delete(financialYearCloses).where(eq(financialYearCloses.id, target.id));
      if (lockTo) {
        await ctx.db.update(periodLocks).set({ lockedThrough: lockTo, note: `Year ${earlier[0].financialYear} closed`, lockedByUserId: ctx.user!.id, lockedByName: ctx.user!.name, updatedAt: new Date() })
          .where(and(eq(periodLocks.businessId, ctx.businessId), eq(periodLocks.kind, "books")));
      } else {
        await ctx.db.delete(periodLocks).where(and(eq(periodLocks.businessId, ctx.businessId), eq(periodLocks.kind, "books")));
      }
      return { id: target.id as string, financialYear: input.financialYear, lockedThrough: lockTo, reason: input.reason };
    }, (r) => ({ action: "period.reopenYear", entityType: "financial_year_closes", entityId: r.id, metadata: { financialYear: r.financialYear, lockedThrough: r.lockedThrough, reason: r.reason } }))),

  /** Closed years with their headline figures. */
  closes: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Report");
    const rows = await ctx.db.select().from(financialYearCloses)
      .where(eq(financialYearCloses.businessId, ctx.businessId)).orderBy(desc(financialYearCloses.financialYear));
    return rows.map((r) => {
      const s = r.snapshot as { ledger: { yearProfit: string }; stock: { totalValue: string }; outstanding: { receivable: string; payable: string } };
      return {
        id: r.id, financialYear: r.financialYear, closedAt: r.closedAt, closedByName: r.closedByName, note: r.note,
        yearProfit: s.ledger.yearProfit, stockValue: s.stock.totalValue, receivable: s.outstanding.receivable, payable: s.outstanding.payable,
      };
    });
  }),

  /** The frozen closing balances of one year, and the opening balances it hands to the next. */
  closeDetail: viewerProcedure
    .input(z.object({ financialYear: fyLabel }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const [row] = await ctx.db.select().from(financialYearCloses)
        .where(and(eq(financialYearCloses.businessId, ctx.businessId), eq(financialYearCloses.financialYear, input.financialYear))).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Financial year ${input.financialYear} is not closed.` });
      return { id: row.id, financialYear: row.financialYear, closedAt: row.closedAt, closedByName: row.closedByName, note: row.note, snapshot: row.snapshot as import("../lib/year-close.js").YearCloseSnapshot };
    }),
});

// Keeps the unused-import linter quiet for helpers kept for symmetry.
void financialYearRange;
void sql;
