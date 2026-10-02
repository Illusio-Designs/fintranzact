/**
 * tds.ts — TDS settings, previews, the TDS payable / receivable ledgers,
 * challans and the figures behind the quarterly returns.
 *
 * The tax itself is recorded by the payment procedures (payment.create /
 * update / delete write tax_deductions); this router reads and organises it:
 *   sections / updateSection / resetSection   rates and thresholds per year
 *   preview                                    what TDS a payment would carry
 *   deductions / summary                       the ledgers, with due dates
 *   challans / createChallan / deleteChallan   marking tax as deposited
 *
 * Sections, rates and thresholds change most Budgets: they are defaults in
 * code that each business can override per financial year. Verify with a CA.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { businesses, invoices, items, parties, taxChallans, taxDeductions, tdsSectionSettings } from "@fintranzact/db";
import {
  defaultTdsSectionRules,
  money,
  defaultTcsSectionRules,
  panFromGstin,
  tcsDepositDueDate,
  tcsReturnDueDate,
  tcsSectionCodes,
  tdsDepositDueDate,
  tdsFinancialYear,
  tdsReturnDueDate,
  tdsSectionCodes,
  type TdsSectionRule,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { withAudit } from "../lib/audit.js";
import { previewPartyTds } from "../lib/tds-service.js";
import { buildTdsReturn } from "../lib/tds-return.js";
import { loadTcsSectionRules, tcsForLines } from "../lib/tcs-service.js";

const fyInput = z.string().regex(/^\d{4}-\d{2}$/, "Use a financial year like 2026-27");
const rupees = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/);
const percent = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/).refine((v) => parseFloat(v) <= 100, "At most 100%");
const quarter = z.number().int().min(1).max(4);
/** The ledger the call is about: tax we deduct (TDS) or tax we collect on sales (TCS). */
const kindInput = z.enum(["tds", "tcs"]).default("tds");
const allSectionCodes = [...tdsSectionCodes, ...tcsSectionCodes] as [string, ...string[]];

/** Deposit and return due dates differ between TDS and TCS (no March exception; 27EQ dates). */
const depositDue = (kind: "tds" | "tcs", d: Date | string) => (kind === "tcs" ? tcsDepositDueDate(d) : tdsDepositDueDate(d));
const returnDue = (kind: "tds" | "tcs", fy: string, q: 1 | 2 | 3 | 4) => (kind === "tcs" ? tcsReturnDueDate(fy, q) : tdsReturnDueDate(fy, q));

/** The section defaults for a ledger, in one shape (TCS has no individual rate or yearly limit). */
function defaultRules(kind: "tds" | "tcs", fy: string): TdsSectionRule[] {
  if (kind === "tds") return defaultTdsSectionRules(fy);
  return defaultTcsSectionRules(fy).map((s) => ({
    code: s.code, label: s.label, rate: s.rate, rateWithoutPan: s.rateWithoutPan,
    singleThreshold: s.singleThreshold, aggregateThreshold: null, basis: "payments" as const, excessOnly: false, note: s.note,
  }));
}

/** "50000.00" → "50000", the same shape as the code defaults. */
const num = (v: string | null | undefined) => (v == null ? null : String(Number(v)));

function assertRealYear(fy: string): void {
  const start = parseInt(fy.slice(0, 4), 10);
  if (String((start + 1) % 100).padStart(2, "0") !== fy.slice(5)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A financial year runs April to March, e.g. 2026-27" });
  }
}

export const tdsRouter = router({
  // ── Settings ────────────────────────────────────────────────────

  /** Every section for a year, with this business's overrides applied and flagged. */
  sections: viewerProcedure
    .input(z.object({ financialYear: fyInput.optional(), kind: kindInput }).default({ kind: "tds" }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      const fy = input.financialYear ?? tdsFinancialYear(new Date());
      assertRealYear(fy);
      const overrides = await ctx.db
        .select()
        .from(tdsSectionSettings)
        .where(and(eq(tdsSectionSettings.businessId, ctx.businessId), eq(tdsSectionSettings.financialYear, fy)));
      const byCode = new Map(overrides.map((o) => [o.sectionCode, o]));

      const sections = defaultRules(input.kind ?? "tds", fy).map((def: TdsSectionRule) => {
        const o = byCode.get(def.code);
        return {
          ...def,
          rate: num(o?.rate) ?? def.rate,
          individualRate: num(o?.individualRate) ?? def.individualRate,
          rateWithoutPan: num(o?.rateWithoutPan) ?? def.rateWithoutPan,
          singleThreshold: o?.singleThreshold != null ? num(o.singleThreshold) : def.singleThreshold,
          aggregateThreshold: o?.aggregateThreshold != null ? num(o.aggregateThreshold) : def.aggregateThreshold,
          isActive: o?.isActive ?? true,
          overridden: !!o,
          defaults: def,
        };
      });
      return { financialYear: fy, kind: input.kind ?? "tds", sections };
    }),

  /** Override a section's rates / limits for one year, or switch it off. Unset fields keep the default. */
  updateSection: adminProcedure
    .input(z.object({
      financialYear: fyInput,
      sectionCode: z.enum(allSectionCodes),
      rate: percent.nullish(),
      individualRate: percent.nullish(),
      rateWithoutPan: percent.nullish(),
      singleThreshold: rupees.nullish(),
      aggregateThreshold: rupees.nullish(),
      isActive: z.boolean().optional(),
    }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Tds");
      assertRealYear(input.financialYear);
      const values = {
        rate: input.rate ?? null,
        individualRate: input.individualRate ?? null,
        rateWithoutPan: input.rateWithoutPan ?? null,
        singleThreshold: input.singleThreshold ?? null,
        aggregateThreshold: input.aggregateThreshold ?? null,
        isActive: input.isActive ?? true,
        updatedAt: new Date(),
      };
      const [row] = await ctx.db
        .insert(tdsSectionSettings)
        .values({ businessId: ctx.businessId, financialYear: input.financialYear, sectionCode: input.sectionCode, ...values })
        .onConflictDoUpdate({
          target: [tdsSectionSettings.businessId, tdsSectionSettings.financialYear, tdsSectionSettings.sectionCode],
          set: values,
        })
        .returning();
      return row!;
    }, (row, input) => ({
      action: "tds.updateSection",
      entityType: "tds_section_settings",
      entityId: row.id,
      metadata: { financialYear: input.financialYear, sectionCode: input.sectionCode },
    }))),

  /** Drop a year's override and go back to the defaults. */
  resetSection: adminProcedure
    .input(z.object({ financialYear: fyInput, sectionCode: z.enum(allSectionCodes) }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Tds");
      const [row] = await ctx.db
        .delete(tdsSectionSettings)
        .where(and(
          eq(tdsSectionSettings.businessId, ctx.businessId),
          eq(tdsSectionSettings.financialYear, input.financialYear),
          eq(tdsSectionSettings.sectionCode, input.sectionCode),
        ))
        .returning({ id: tdsSectionSettings.id });
      return { id: row?.id ?? null };
    }, (res, input) => (res.id ? {
      action: "tds.resetSection",
      entityType: "tds_section_settings",
      entityId: res.id,
      metadata: { financialYear: input.financialYear, sectionCode: input.sectionCode },
    } : null))),

  // ── Preview ─────────────────────────────────────────────────────

  /** What TDS paying `amount` to a party would carry, with their year to date. */
  preview: memberProcedure
    .input(z.object({
      partyId: z.string().uuid(),
      amount: rupees,
      paymentDate: z.string().datetime().optional(),
      sectionCode: z.enum(tdsSectionCodes).optional(),
      excludePaymentId: z.string().uuid().optional(),
      /** The expense being edited, so it is not counted against the year twice. */
      excludeExpenseId: z.string().uuid().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Payment");
      return previewPartyTds(ctx.db, ctx.businessId, {
        partyId: input.partyId,
        amount: input.amount,
        paymentDate: input.paymentDate ? new Date(input.paymentDate) : undefined,
        sectionCode: input.sectionCode,
        excludePaymentId: input.excludePaymentId,
        excludeExpenseId: input.excludeExpenseId,
      });
    }),

  /**
   * The TCS a sale would carry: for the lines entered on the invoice form (taxable value
   * excluding GST), on the items that have a TCS section, for this customer.
   */
  tcsPreview: memberProcedure
    .input(z.object({
      partyId: z.string().uuid(),
      invoiceDate: z.string().datetime().optional(),
      lines: z.array(z.object({ itemId: z.string().uuid().nullish(), taxable: rupees })).max(500),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const [party] = await ctx.db
        .select({ pan: parties.pan, gstin: parties.gstin })
        .from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);
      if (!party) throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      const hasPan = !!(party.pan?.trim() || panFromGstin(party.gstin));

      const ids = [...new Set(input.lines.map((l) => l.itemId).filter((id): id is string => !!id))];
      const itemRows = ids.length
        ? await ctx.db.select({ id: items.id, tcsSection: items.tcsSection }).from(items).where(and(inArray(items.id, ids), eq(items.businessId, ctx.businessId)))
        : [];
      const sectionOf = new Map(itemRows.map((r) => [r.id, r.tcsSection]));

      const fy = tdsFinancialYear(input.invoiceDate ? new Date(input.invoiceDate) : new Date());
      const rules = await loadTcsSectionRules(ctx.db, ctx.businessId, fy);
      const { amount, sections } = tcsForLines(
        rules,
        input.lines.map((l) => ({ tcsSection: l.itemId ? sectionOf.get(l.itemId) ?? null : null, taxable: l.taxable })),
        hasPan,
      );
      const warnings: string[] = [];
      if (sections.length > 0 && !hasPan) {
        warnings.push("The customer has no PAN or GSTIN: TCS is collected at the higher rate (s.206CC).");
      }
      return { financialYear: fy, hasPan, amount, sections: sections.map((s) => ({ ...s, label: rules.find((r) => r.code === s.sectionCode)?.label ?? s.sectionCode })), warnings };
    }),

  // ── Ledgers ─────────────────────────────────────────────────────

  /** The deduction rows behind the TDS payable / receivable ledgers. */
  deductions: viewerProcedure
    .input(z.object({
      financialYear: fyInput,
      kind: kindInput,
      direction: z.enum(["payable", "receivable"]).optional(),
      quarter: quarter.optional(),
      sectionCode: z.enum(allSectionCodes).optional(),
      partyId: z.string().uuid().optional(),
      deposited: z.boolean().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      const where = and(
        eq(taxDeductions.businessId, ctx.businessId),
        eq(taxDeductions.kind, input.kind),
        eq(taxDeductions.financialYear, input.financialYear),
        input.direction ? eq(taxDeductions.direction, input.direction) : undefined,
        input.quarter ? eq(taxDeductions.quarter, input.quarter) : undefined,
        input.sectionCode ? eq(taxDeductions.sectionCode, input.sectionCode) : undefined,
        input.partyId ? eq(taxDeductions.partyId, input.partyId) : undefined,
        input.deposited === undefined
          ? undefined
          : input.deposited ? sql`${taxDeductions.challanId} IS NOT NULL` : sql`${taxDeductions.challanId} IS NULL`,
      );
      const [data, [{ total }]] = await Promise.all([
        ctx.db
          .select({
            id: taxDeductions.id,
            direction: taxDeductions.direction,
            partyId: taxDeductions.partyId,
            partyName: parties.name,
            partyPan: parties.pan,
            paymentId: taxDeductions.paymentId,
            invoiceId: taxDeductions.invoiceId,
            sectionCode: taxDeductions.sectionCode,
            quarter: taxDeductions.quarter,
            baseAmount: taxDeductions.baseAmount,
            rate: taxDeductions.rate,
            amount: taxDeductions.amount,
            hasPan: taxDeductions.hasPan,
            deductedOn: taxDeductions.deductedOn,
            challanId: taxDeductions.challanId,
          })
          .from(taxDeductions)
          .innerJoin(parties, eq(parties.id, taxDeductions.partyId))
          .where(where)
          .orderBy(desc(taxDeductions.deductedOn))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit),
        ctx.db.select({ total: sql<number>`COUNT(*)::int` }).from(taxDeductions).where(where),
      ]);
      return {
        data: data.map((d) => ({ ...d, depositDueDate: depositDue(input.kind, d.deductedOn) })),
        total,
        page: input.page,
        limit: input.limit,
      };
    }),

  /**
   * The year at a glance: TDS payable by section and quarter with what is
   * deposited and what is still due (and by when), and TDS receivable.
   * Dates are due dates under the current rules — verify with a CA.
   */
  summary: viewerProcedure
    .input(z.object({ financialYear: fyInput.optional(), kind: kindInput }).default({ kind: "tds" }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      const kind = input.kind ?? "tds";
      const fy = input.financialYear ?? tdsFinancialYear(new Date());
      assertRealYear(fy);
      const base = and(
        eq(taxDeductions.businessId, ctx.businessId),
        eq(taxDeductions.kind, kind),
        eq(taxDeductions.financialYear, fy),
      );
      const deposited = sql<string>`COALESCE(SUM(${taxDeductions.amount}) FILTER (WHERE ${taxDeductions.challanId} IS NOT NULL), 0.00)::text`;
      const total = sql<string>`COALESCE(SUM(${taxDeductions.amount}), 0.00)::text`;

      const [bySection, byQuarter, byMonth, receivable] = await Promise.all([
        ctx.db
          .select({ sectionCode: taxDeductions.sectionCode, total, deposited })
          .from(taxDeductions)
          .where(and(base, eq(taxDeductions.direction, "payable")))
          .groupBy(taxDeductions.sectionCode)
          .orderBy(taxDeductions.sectionCode),
        ctx.db
          .select({ quarter: taxDeductions.quarter, total, deposited, count: sql<number>`COUNT(*)::int` })
          .from(taxDeductions)
          .where(and(base, eq(taxDeductions.direction, "payable")))
          .groupBy(taxDeductions.quarter)
          .orderBy(taxDeductions.quarter),
        ctx.db
          .select({
            month: sql<string>`to_char(${taxDeductions.deductedOn} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`,
            pending: sql<string>`COALESCE(SUM(${taxDeductions.amount}) FILTER (WHERE ${taxDeductions.challanId} IS NULL), 0.00)::text`,
          })
          .from(taxDeductions)
          .where(and(base, eq(taxDeductions.direction, "payable")))
          .groupBy(sql`1`)
          .orderBy(sql`1`),
        ctx.db
          .select({ sectionCode: taxDeductions.sectionCode, total })
          .from(taxDeductions)
          .where(and(base, eq(taxDeductions.direction, "receivable")))
          .groupBy(taxDeductions.sectionCode)
          .orderBy(taxDeductions.sectionCode),
      ]);

      const now = Date.now();
      const withPending = <T extends { total: string; deposited: string }>(r: T) => ({
        ...r,
        pending: money.sub(r.total, r.deposited),
      });
      return {
        financialYear: fy,
        kind,
        payable: {
          total: money.sum(bySection.map((s) => s.total)),
          deposited: money.sum(bySection.map((s) => s.deposited)),
          pending: money.sub(money.sum(bySection.map((s) => s.total)), money.sum(bySection.map((s) => s.deposited))),
          bySection: bySection.map(withPending),
          byQuarter: byQuarter.map((q) => ({
            ...withPending(q),
            returnDueDate: returnDue(kind, fy, q.quarter as 1 | 2 | 3 | 4),
          })),
          // Tax still to deposit, by the month it was deducted, with the day it is due.
          depositsDue: byMonth
            .filter((m) => money.isPositive(m.pending))
            .map((m) => {
              const dueDate = depositDue(kind, `${m.month}-15T12:00:00+05:30`);
              return { month: m.month, pending: m.pending, dueDate, overdue: dueDate.getTime() < now };
            }),
        },
        receivable: {
          total: money.sum(receivable.map((r) => r.total)),
          bySection: receivable,
        },
      };
    }),

  // ── Quarterly return data ───────────────────────────────────────

  /**
   * The figures for a quarter's TDS return: the deductee annexure (who, which
   * section, how much, deposited with which challan) and the challans, as data
   * and CSV, with the things to fix before filing. Data for preparing the
   * return, not a filed return.
   */
  returnData: viewerProcedure
    .input(z.object({ financialYear: fyInput, quarter, kind: kindInput }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      assertRealYear(input.financialYear);

      const [biz] = await ctx.db
        .select({ name: businesses.name, legalName: businesses.legalName, tan: businesses.tan, pan: businesses.pan, gstin: businesses.gstin })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      const rows = await ctx.db
        .select({
          partyName: parties.name,
          pan: parties.pan,
          hasPan: taxDeductions.hasPan,
          sectionCode: taxDeductions.sectionCode,
          deductedOn: taxDeductions.deductedOn,
          baseAmount: taxDeductions.baseAmount,
          rate: taxDeductions.rate,
          amount: taxDeductions.amount,
          invoiceNumber: invoices.invoiceNumber,
          challanBsr: taxChallans.bsrCode,
          challanNumber: taxChallans.challanNumber,
          challanDate: taxChallans.depositedOn,
        })
        .from(taxDeductions)
        .innerJoin(parties, eq(parties.id, taxDeductions.partyId))
        .leftJoin(invoices, eq(invoices.id, taxDeductions.invoiceId))
        .leftJoin(taxChallans, eq(taxChallans.id, taxDeductions.challanId))
        .where(and(
          eq(taxDeductions.businessId, ctx.businessId),
          eq(taxDeductions.kind, input.kind),
          eq(taxDeductions.direction, "payable"),
          eq(taxDeductions.financialYear, input.financialYear),
          eq(taxDeductions.quarter, input.quarter),
        ))
        .orderBy(parties.name, taxDeductions.deductedOn);

      const challans = await ctx.db
        .select({
          challanNumber: taxChallans.challanNumber,
          bsrCode: taxChallans.bsrCode,
          depositedOn: taxChallans.depositedOn,
          amount: taxChallans.amount,
          interest: taxChallans.interest,
          // Written with the table name, as in `challans` above.
          linked: sql<string>`COALESCE((SELECT SUM(d.amount) FROM tax_deductions d WHERE d.challan_id = tax_challans.id), 0.00)::text`,
        })
        .from(taxChallans)
        .where(and(
          eq(taxChallans.businessId, ctx.businessId),
          eq(taxChallans.kind, input.kind),
          eq(taxChallans.financialYear, input.financialYear),
          eq(taxChallans.quarter, input.quarter),
        ))
        .orderBy(taxChallans.depositedOn);

      return {
        ...buildTdsReturn({
          deductor: { name: biz?.legalName || biz?.name || "", tan: biz?.tan ?? null, pan: biz?.pan ?? null, gstin: biz?.gstin ?? null },
          financialYear: input.financialYear,
          quarter: input.quarter as 1 | 2 | 3 | 4,
          rows: rows.map((r) => ({
            partyName: r.partyName,
            pan: r.pan,
            hasPan: r.hasPan,
            sectionCode: r.sectionCode,
            deductedOn: r.deductedOn,
            baseAmount: r.baseAmount,
            rate: r.rate,
            amount: r.amount,
            invoiceNumber: r.invoiceNumber,
            challan: r.challanBsr ? { bsrCode: r.challanBsr, challanNumber: r.challanNumber!, depositedOn: r.challanDate! } : null,
          })),
          challans,
        }),
        kind: input.kind,
        returnDueDate: returnDue(input.kind, input.financialYear, input.quarter as 1 | 2 | 3 | 4),
      };
    }),

  // ── Challans ────────────────────────────────────────────────────

  challans: viewerProcedure
    .input(z.object({ financialYear: fyInput, quarter: quarter.optional(), kind: kindInput }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      const rows = await ctx.db
        .select({
          id: taxChallans.id,
          kind: taxChallans.kind,
          financialYear: taxChallans.financialYear,
          quarter: taxChallans.quarter,
          challanNumber: taxChallans.challanNumber,
          bsrCode: taxChallans.bsrCode,
          depositedOn: taxChallans.depositedOn,
          amount: taxChallans.amount,
          interest: taxChallans.interest,
          notes: taxChallans.notes,
          // Written with the table name: drizzle would render ${taxChallans.id} as a bare "id",
          // which inside these subqueries means the deduction's own id.
          linked: sql<string>`COALESCE((SELECT SUM(d.amount) FROM tax_deductions d WHERE d.challan_id = tax_challans.id), 0.00)::text`,
          deductionCount: sql<number>`(SELECT COUNT(*) FROM tax_deductions d WHERE d.challan_id = tax_challans.id)::int`,
        })
        .from(taxChallans)
        .where(and(
          eq(taxChallans.businessId, ctx.businessId),
          eq(taxChallans.kind, input.kind),
          eq(taxChallans.financialYear, input.financialYear),
          input.quarter ? eq(taxChallans.quarter, input.quarter) : undefined,
        ))
        .orderBy(desc(taxChallans.depositedOn));
      return rows;
    }),

  /**
   * Record a deposit (ITNS 281 challan) and mark the tax it pays as deposited.
   * Only TDS we owe (payable), for that year and quarter, that is not already
   * on a challan. The challan can be for more than the tax linked (interest).
   */
  createChallan: memberProcedure
    .input(z.object({
      financialYear: fyInput,
      quarter,
      kind: kindInput,
      challanNumber: z.string().trim().min(1).max(10),
      bsrCode: z.string().regex(/^\d{7}$/, "BSR code is 7 digits"),
      depositedOn: z.string().datetime(),
      amount: rupees.refine((v) => parseFloat(v) > 0, "Amount must be more than zero"),
      interest: rupees.default("0"),
      notes: z.string().max(500).optional(),
      deductionIds: z.array(z.string().uuid()).min(1).max(1000),
    }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Tds");
      assertRealYear(input.financialYear);
      return ctx.db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: taxDeductions.id, amount: taxDeductions.amount, challanId: taxDeductions.challanId, direction: taxDeductions.direction, financialYear: taxDeductions.financialYear, quarter: taxDeductions.quarter })
          .from(taxDeductions)
          .where(and(
            eq(taxDeductions.businessId, ctx.businessId),
            eq(taxDeductions.kind, input.kind),
            inArray(taxDeductions.id, input.deductionIds),
          ))
          .for("update");
        if (rows.length !== new Set(input.deductionIds).size) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Some of the selected TDS entries were not found" });
        }
        if (rows.some((r) => r.direction !== "payable")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: input.kind === "tcs" ? "Only TCS you collected can be deposited" : "Only TDS you deducted can be deposited — not TDS customers deducted from you" });
        }
        if (rows.some((r) => r.challanId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Some of the selected TDS is already on a challan" });
        }
        if (rows.some((r) => r.financialYear !== input.financialYear || r.quarter !== input.quarter)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A challan covers one quarter: some of the selected TDS is from another quarter or year" });
        }
        const linked = money.sum(rows.map((r) => r.amount));
        if (money.compare(linked, input.amount) > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `The selected TDS (${linked}) is more than the challan amount (${input.amount})` });
        }

        const [dup] = await tx
          .select({ id: taxChallans.id })
          .from(taxChallans)
          .where(and(
            eq(taxChallans.businessId, ctx.businessId),
            eq(taxChallans.kind, input.kind),
            eq(taxChallans.bsrCode, input.bsrCode),
            eq(taxChallans.challanNumber, input.challanNumber),
            eq(taxChallans.depositedOn, new Date(input.depositedOn)),
          ))
          .limit(1);
        if (dup) throw new TRPCError({ code: "CONFLICT", message: "A challan with this BSR code, number and date is already recorded" });

        const [challan] = await tx
          .insert(taxChallans)
          .values({
            businessId: ctx.businessId,
            kind: input.kind,
            financialYear: input.financialYear,
            quarter: input.quarter,
            challanNumber: input.challanNumber,
            bsrCode: input.bsrCode,
            depositedOn: new Date(input.depositedOn),
            amount: input.amount,
            interest: input.interest,
            notes: input.notes ?? null,
            createdByUserId: ctx.user!.id,
          })
          .returning();
        await tx.update(taxDeductions).set({ challanId: challan!.id }).where(inArray(taxDeductions.id, input.deductionIds));
        return { ...challan!, linkedCount: rows.length };
      });
    }, (c, input) => ({
      action: "tds.createChallan",
      entityType: "tax_challans",
      entityId: c.id,
      metadata: { financialYear: input.financialYear, quarter: input.quarter, amount: input.amount, linkedCount: c.linkedCount },
    }))),

  /** Remove a challan; its TDS goes back to "not yet deposited". */
  deleteChallan: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Tds");
      const [row] = await ctx.db
        .delete(taxChallans)
        .where(and(eq(taxChallans.id, input.id), eq(taxChallans.businessId, ctx.businessId)))
        .returning({ id: taxChallans.id, challanNumber: taxChallans.challanNumber });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Challan not found" });
      return row;
    }, (row) => ({
      action: "tds.deleteChallan",
      entityType: "tax_challans",
      entityId: row.id,
      metadata: { challanNumber: row.challanNumber },
    }))),
});
