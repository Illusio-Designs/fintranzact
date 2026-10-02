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
 *   import26as / reconciliation26as / link26as / ignore26as
 *                                              Form 26AS / AIS (CSV) vs TDS receivable
 *
 * Sections, rates and thresholds change most Budgets: they are defaults in
 * code that each business can override per financial year. Verify with a CA.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { businesses, invoices, items, parties, taxChallans, taxDeductions, tds26asEntries, tdsSectionSettings } from "@fintranzact/db";
import {
  defaultTdsSectionRules,
  money,
  defaultTcsSectionRules,
  panFromGstin,
  tcsSectionCodes,
  tdsFinancialYear,
  tdsFinancialYearRange,
  tdsQuarter,
  tdsSectionCodes,
  type TdsSectionRule,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { withAudit } from "../lib/audit.js";
import { previewPartyTds } from "../lib/tds-service.js";
import { buildTdsReturn } from "../lib/tds-return.js";
import { loadTcsSectionRules, tcsForLines } from "../lib/tcs-service.js";
import { depositDue, depositsDueFromMonths, loadTdsReminders, returnDue } from "../lib/tds-reminders.js";
import { parse26asCsv } from "../lib/tds-26as-parser.js";
import { reconcile26as } from "../lib/tds-26as.js";
import { buildCertificateData, certificateToBuffer } from "../lib/tds-certificate.js";

const fyInput = z.string().regex(/^\d{4}-\d{2}$/, "Use a financial year like 2026-27");
const rupees = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/);
const percent = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/).refine((v) => parseFloat(v) <= 100, "At most 100%");
const quarter = z.number().int().min(1).max(4);
/** The ledger the call is about: tax we deduct (TDS) or tax we collect on sales (TCS). */
const kindInput = z.enum(["tds", "tcs"]).default("tds");
const allSectionCodes = [...tdsSectionCodes, ...tcsSectionCodes] as [string, ...string[]];

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

      const [bySection, byQuarter, byMonth, receivable, sectionQuarter] = await Promise.all([
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
        // Section x quarter, for the Reports hub.
        ctx.db
          .select({ sectionCode: taxDeductions.sectionCode, quarter: taxDeductions.quarter, total, deposited })
          .from(taxDeductions)
          .where(and(base, eq(taxDeductions.direction, "payable")))
          .groupBy(taxDeductions.sectionCode, taxDeductions.quarter)
          .orderBy(taxDeductions.sectionCode, taxDeductions.quarter),
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
          bySectionQuarter: sectionQuarter.map(withPending),
          byQuarter: byQuarter.map((q) => ({
            ...withPending(q),
            returnDueDate: returnDue(kind, fy, q.quarter as 1 | 2 | 3 | 4),
          })),
          // Tax still to deposit, by the month it was deducted, with the day it is due.
          depositsDue: depositsDueFromMonths(kind, byMonth, now),
        },
        receivable: {
          total: money.sum(receivable.map((r) => r.total)),
          bySection: receivable,
        },
      };
    }),

    /**
   * Upcoming and overdue deposits and returns (TDS and TCS) for the business:
   * the same items the due-date reminder emails are about. Due dates follow the
   * current rules: verify with a CA.
   */
  reminders: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Tds");
    const items = await loadTdsReminders(ctx.db, ctx.businessId);
    return { items, note: "Verify due dates with your CA." };
  }),

  // ── Certificates (statements from the books, not TRACES) ────────

  /** Parties with tax deducted (TDS) or collected (TCS) in a quarter, with their totals. */
  certificateParties: viewerProcedure
    .input(z.object({ kind: kindInput, financialYear: fyInput, quarter }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      assertRealYear(input.financialYear);
      const rows = await ctx.db
        .select({
          partyId: parties.id,
          partyName: parties.name,
          pan: parties.pan,
          count: sql<number>`COUNT(*)::int`,
          total: sql<string>`COALESCE(SUM(${taxDeductions.amount}), 0.00)::text`,
          deposited: sql<string>`COALESCE(SUM(${taxDeductions.amount}) FILTER (WHERE ${taxDeductions.challanId} IS NOT NULL), 0.00)::text`,
        })
        .from(taxDeductions)
        .innerJoin(parties, eq(parties.id, taxDeductions.partyId))
        .where(and(
          eq(taxDeductions.businessId, ctx.businessId),
          eq(taxDeductions.kind, input.kind),
          eq(taxDeductions.direction, "payable"),
          eq(taxDeductions.financialYear, input.financialYear),
          eq(taxDeductions.quarter, input.quarter),
        ))
        .groupBy(parties.id, parties.name, parties.pan)
        .orderBy(parties.name);
      return rows.map((r) => ({ ...r, pending: money.sub(r.total, r.deposited) }));
    }),

  /**
   * One party's statement for a quarter as a base64 PDF: Form 16A style (TDS)
   * or Form 27D style (TCS), generated from the books. Not the TRACES-issued
   * certificate, which exists only after the return is filed.
   */
  certificate: viewerProcedure
    .input(z.object({ kind: kindInput, partyId: z.string().uuid(), financialYear: fyInput, quarter }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      assertRealYear(input.financialYear);

      const [[biz], [party], rows] = await Promise.all([
        ctx.db
          .select({
            name: businesses.name, legalName: businesses.legalName, tan: businesses.tan, pan: businesses.pan,
            address: businesses.address, addressLine1: businesses.addressLine1, addressLine2: businesses.addressLine2,
            city: businesses.city, state: businesses.state, pincode: businesses.pincode,
          })
          .from(businesses)
          .where(eq(businesses.id, ctx.businessId))
          .limit(1),
        ctx.db
          .select({ name: parties.name, pan: parties.pan })
          .from(parties)
          .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
          .limit(1),
        ctx.db
          .select({
            sectionCode: taxDeductions.sectionCode,
            deductedOn: taxDeductions.deductedOn,
            baseAmount: taxDeductions.baseAmount,
            amount: taxDeductions.amount,
            challanBsr: taxChallans.bsrCode,
            challanNumber: taxChallans.challanNumber,
            challanDate: taxChallans.depositedOn,
          })
          .from(taxDeductions)
          .leftJoin(taxChallans, eq(taxChallans.id, taxDeductions.challanId))
          .where(and(
            eq(taxDeductions.businessId, ctx.businessId),
            eq(taxDeductions.partyId, input.partyId),
            eq(taxDeductions.kind, input.kind),
            eq(taxDeductions.direction, "payable"),
            eq(taxDeductions.financialYear, input.financialYear),
            eq(taxDeductions.quarter, input.quarter),
          )),
      ]);
      if (!party || !biz) throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No tax was recorded for this party in that quarter" });
      }

      const address = [biz.addressLine1 || biz.address, biz.addressLine2, biz.city, biz.state, biz.pincode].filter(Boolean).join(", ");
      const data = buildCertificateData({
        kind: input.kind,
        deductor: { name: biz.legalName || biz.name, tan: biz.tan, pan: biz.pan, address },
        deductee: { name: party.name, pan: party.pan },
        financialYear: input.financialYear,
        quarter: input.quarter as 1 | 2 | 3 | 4,
        sectionLabels: Object.fromEntries(defaultRules(input.kind, input.financialYear).map((r) => [r.code, r.label])),
        rows: rows.map((r) => ({
          sectionCode: r.sectionCode,
          deductedOn: r.deductedOn,
          baseAmount: r.baseAmount,
          amount: r.amount,
          challan: r.challanBsr ? { bsrCode: r.challanBsr, challanNumber: r.challanNumber!, depositedOn: r.challanDate! } : null,
        })),
      });
      const pdf = await certificateToBuffer(data);
      const safe = party.name.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "party";
      return {
        filename: `${input.kind}-statement-${safe}-Q${input.quarter}-${input.financialYear}.pdf`,
        contentType: "application/pdf" as const,
        base64: pdf.toString("base64"),
        totals: data.totals,
        notes: data.notes,
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

  // ── Form 26AS / AIS reconciliation (TDS receivable) ─────────────

  /**
   * Import a Form 26AS / AIS TDS export (CSV only: see lib/tds-26as-parser.ts for
   * the columns; the TRACES text file and AIS JSON are rejected). Replaces any
   * rows imported earlier for the same financial year; customer links made on
   * earlier rows are carried over by TAN. Rows dated outside the year are skipped.
   */
  import26as: adminProcedure
    .input(z.object({
      financialYear: fyInput,
      content: z.string().min(1).max(20_000_000),
      fileName: z.string().min(1).max(255),
      format: z.enum(["csv"]).default("csv"),
    }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Tds");
      assertRealYear(input.financialYear);
      let parsed;
      try {
        parsed = parse26asCsv(input.content);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Could not read the file" });
      }
      const range = tdsFinancialYearRange(input.financialYear);
      const skipped = [...parsed.skipped];
      const rows = parsed.rows.filter((r) => {
        if (r.txnDate >= range.from && r.txnDate <= range.to) return true;
        skipped.push({ line: 0, reason: `${r.deductorTan} ${r.section}: transaction date is outside ${input.financialYear}` });
        return false;
      });
      if (rows.length === 0) {
        const why = skipped.slice(0, 3).map((x) => x.reason).join("; ");
        throw new TRPCError({ code: "BAD_REQUEST", message: `No usable rows for ${input.financialYear}${why ? `: ${why}` : ""}` });
      }

      const batchId = crypto.randomUUID();
      const inserted = await ctx.db.transaction(async (tx) => {
        // Customers linked by hand before, by TAN, from any year.
        const linked = await tx
          .select({ tan: tds26asEntries.deductorTan, partyId: tds26asEntries.partyId })
          .from(tds26asEntries)
          .where(and(eq(tds26asEntries.businessId, ctx.businessId), sql`${tds26asEntries.partyId} IS NOT NULL`));
        const tanLinks = new Map<string, string>();
        for (const l of linked) if (l.partyId && !tanLinks.has(l.tan)) tanLinks.set(l.tan, l.partyId);

        await tx
          .delete(tds26asEntries)
          .where(and(eq(tds26asEntries.businessId, ctx.businessId), eq(tds26asEntries.financialYear, input.financialYear)));

        const values = rows.map((r) => ({
          businessId: ctx.businessId,
          importBatchId: batchId,
          financialYear: input.financialYear,
          quarter: tdsQuarter(r.txnDate),
          deductorTan: r.deductorTan,
          deductorName: r.deductorName,
          section: r.section,
          txnDate: r.txnDate,
          amountPaid: r.amountPaid,
          taxDeducted: r.taxDeducted,
          taxDeposited: r.taxDeposited,
          partyId: tanLinks.get(r.deductorTan) ?? null,
        }));
        for (let i = 0; i < values.length; i += 500) await tx.insert(tds26asEntries).values(values.slice(i, i + 500));
        return values.length;
      });
      return { batchId, financialYear: input.financialYear, fileName: input.fileName, imported: inserted, skipped: skipped.slice(0, 50), skippedCount: skipped.length };
    }, (r) => ({
      action: "tds.import26as",
      entityType: "tds_26as_entries",
      entityId: r.batchId,
      metadata: { financialYear: r.financialYear, fileName: r.fileName, imported: r.imported, skipped: r.skippedCount },
    }))),

  /**
   * 26AS rows vs the books' TDS receivable for a year, per customer + section +
   * quarter: matched / amount_differs / missing_in_books / missing_in_26as, plus
   * ignored rows. Computed live, so it follows later edits to the books.
   */
  reconciliation26as: viewerProcedure
    .input(z.object({ financialYear: fyInput }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Tds");
      assertRealYear(input.financialYear);
      const [entries, partyRows, books] = await Promise.all([
        ctx.db
          .select()
          .from(tds26asEntries)
          .where(and(eq(tds26asEntries.businessId, ctx.businessId), eq(tds26asEntries.financialYear, input.financialYear))),
        ctx.db
          .select({ id: parties.id, name: parties.name, legalName: parties.legalName, tradeName: parties.tradeName })
          .from(parties)
          .where(eq(parties.businessId, ctx.businessId)),
        ctx.db
          .select({
            partyId: taxDeductions.partyId,
            sectionCode: taxDeductions.sectionCode,
            quarter: taxDeductions.quarter,
            amount: sql<string>`SUM(${taxDeductions.amount})::text`,
          })
          .from(taxDeductions)
          .where(and(
            eq(taxDeductions.businessId, ctx.businessId),
            eq(taxDeductions.kind, "tds"),
            eq(taxDeductions.direction, "receivable"),
            eq(taxDeductions.financialYear, input.financialYear),
          ))
          .groupBy(taxDeductions.partyId, taxDeductions.sectionCode, taxDeductions.quarter),
      ]);
      const result = reconcile26as({
        entries: entries.map((e) => ({
          id: e.id,
          deductorTan: e.deductorTan,
          deductorName: e.deductorName,
          section: e.section,
          quarter: e.quarter,
          taxDeducted: e.taxDeducted,
          partyId: e.partyId,
          status: e.status,
        })),
        parties: partyRows,
        books,
      });
      const importedAt = entries.reduce<Date | null>((latest, e) => (!latest || e.createdAt > latest ? e.createdAt : latest), null);
      return { financialYear: input.financialYear, entryCount: entries.length, importedAt, ...result };
    }),

  /** Point 26AS rows at a customer (or clear the link with partyId null). A link also covers other rows with the same TAN. */
  link26as: adminProcedure
    .input(z.object({ entryIds: z.array(z.string().uuid()).min(1).max(500), partyId: z.string().uuid().nullable() }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Tds");
      if (input.partyId) {
        const [party] = await ctx.db
          .select({ id: parties.id })
          .from(parties)
          .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
          .limit(1);
        if (!party) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }
      const rows = await ctx.db
        .update(tds26asEntries)
        .set({ partyId: input.partyId })
        .where(and(eq(tds26asEntries.businessId, ctx.businessId), inArray(tds26asEntries.id, input.entryIds)))
        .returning({ id: tds26asEntries.id });
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "26AS rows not found" });
      return { updated: rows.length, partyId: input.partyId, entryIds: rows.map((r) => r.id) };
    }, (r) => ({
      action: "tds.link26as",
      entityType: "tds_26as_entries",
      entityId: r.entryIds[0]!,
      metadata: { updated: r.updated, partyId: r.partyId },
    }))),

  /** Leave 26AS rows out of the reconciliation (or put them back with ignored false). */
  ignore26as: adminProcedure
    .input(z.object({ entryIds: z.array(z.string().uuid()).min(1).max(500), ignored: z.boolean().default(true) }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Tds");
      const rows = await ctx.db
        .update(tds26asEntries)
        .set({ status: input.ignored ? "ignored" : "pending" })
        .where(and(eq(tds26asEntries.businessId, ctx.businessId), inArray(tds26asEntries.id, input.entryIds)))
        .returning({ id: tds26asEntries.id });
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "26AS rows not found" });
      return { updated: rows.length, ignored: input.ignored, entryIds: rows.map((r) => r.id) };
    }, (r) => ({
      action: "tds.ignore26as",
      entityType: "tds_26as_entries",
      entityId: r.entryIds[0]!,
      metadata: { updated: r.updated, ignored: r.ignored },
    }))),
});
