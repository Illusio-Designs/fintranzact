import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { businesses, compositionSettings } from "@fintranzact/db";
import {
  compositionCategories, defaultCompositionRules, financialYearLabel, financialYearOf, istDateParts,
} from "@fintranzact/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { loadCmp08Quarter, loadCompositionSetting } from "../lib/cmp08.js";
import { Gstr4NotApplicableError, loadGstr4 } from "../lib/gstr4.js";
import { gstr4ToPortalJson } from "../lib/gstr4-json.js";
import { requireCan } from "../lib/permissions.js";
import { recordCaExport } from "../lib/access-events.js";
import { generateGSTR1, generateGSTR3B, gstr1ToCSV, gstr1ToPortalJson } from "../lib/gst-reports.js";
import { generateGSTR9, gstr9ToPortalJson } from "../lib/gstr9-generator.js";

const fyInput = z.string().regex(/^\d{4}-\d{2}$/, "Use a financial year like 2026-27");
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Use an amount like 50 or 2000.00");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-06-30");
const cmp08PaidInput = z.object({
  1: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  2: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  3: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  4: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
}).optional();
const percent = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/).refine((v) => parseFloat(v) <= 100, "At most 100%");

function assertRealYear(fy: string): void {
  const start = parseInt(fy.slice(0, 4), 10);
  if (String((start + 1) % 100).padStart(2, "0") !== fy.slice(5)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A financial year runs April to March, e.g. 2026-27" });
  }
}

export const gstRouter = router({
  // Reports are available for ALL businesses — GST-registered get GST terminology,
  // non-GST get generic financial report terminology. The data engine is identical.
  gstr1: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      return generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);
    }),

  gstr3b: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      return generateGSTR3B(ctx.businessId, input.year, input.month, ctx.db);
    }),

  gstr1CSV: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const report = await generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);
      await recordCaExport(ctx, "gst.gstr1CSV");
      return { csv: gstr1ToCSV(report), filename: `GSTR1_${report.period.replace(" ", "_")}.csv` };
    }),

  // GSTR-1 portal JSON — produces the exact JSON schema accepted by the GST portal's
  // offline tool. Users can download this JSON and upload it directly to gstn.gov.in
  // instead of manually entering invoice data.
  gstr1Json: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const report = await generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);

      const [biz] = await ctx.db
        .select({ gstin: businesses.gstin, financialYearStart: businesses.financialYearStart })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      const fp = String(input.month).padStart(2, "0") + String(input.year);
      const fyStart = biz?.financialYearStart ?? 4;
      const fy = input.month >= fyStart
        ? `${input.year}-${String(input.year + 1).slice(2)}`
        : `${input.year - 1}-${String(input.year).slice(2)}`;

      const portalJson = gstr1ToPortalJson(report, biz?.gstin ?? "", fy, fp);
      await recordCaExport(ctx, "gst.gstr1Json");
      return {
        json: portalJson,
        filename: `GSTR1_${report.period.replace(" ", "_")}_portal.json`,
      };
    }),

  // GSTR-9: Annual return consolidating 12 months of GSTR-1 + GSTR-3B data.
  // Filed once per financial year (April–March). Tables 4-9 are generated from
  // the monthly report data — no separate data entry required.
  gstr9: viewerProcedure
    .input(z.object({
      financialYear: z.number().int().min(2020).max(2099), // Start year, e.g. 2025 for FY 2025-26
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");
      return generateGSTR9(ctx.businessId, input.financialYear, ctx.db);
    }),

  // GSTR-9 portal JSON — produces the JSON schema accepted by the GST portal's
  // offline tool. Users can download this and upload directly to gstn.gov.in.
  gstr9Json: viewerProcedure
    .input(z.object({
      financialYear: z.number().int().min(2020).max(2099),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");
      const report = await generateGSTR9(ctx.businessId, input.financialYear, ctx.db);
      const portalJson = gstr9ToPortalJson(report);
      const fyLabel = report.financialYear.replace("-", "_");
      await recordCaExport(ctx, "gst.gstr9Json");
      return {
        json: portalJson,
        filename: `GSTR9_FY${fyLabel}_portal.json`,
      };
    }),

  // CMP-08: Quarterly statement for composition scheme dealers.
  // A composition dealer pays a flat percent of turnover instead of collecting
  // GST. The rate comes from the category set for the financial year
  // (gst.compositionSettings): 1% manufacturers and traders, 5% restaurants,
  // 6% other service providers, unless the business overrides it.
  cmp08: viewerProcedure
    .input(z.object({
      /** Start year of the financial year: 2025 for FY 2025-26. */
      year: z.number().int().min(2020).max(2099),
      /** Financial-year quarter: Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar (next year). */
      quarter: z.number().int().min(1).max(4),
      /** When the tax was paid, to work out interest on a late payment. */
      paidOn: z.coerce.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const q = await loadCmp08Quarter(
        ctx.db, ctx.businessId, financialYearLabel(input.year), input.quarter as 1 | 2 | 3 | 4, input.paidOn,
      );
      return {
        ...q,
        quarterStart: q.quarterStart.toISOString(),
        quarterEnd: q.quarterEnd.toISOString(),
        dueDate: q.dueDate.toISOString(),
      };
    }),

  /** All four quarters of a financial year (CMP-08 is filed for all four quarters, Q4 included). */
  cmp08Year: viewerProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2099) }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const fy = financialYearLabel(input.year);
      const quarters = [];
      for (const quarter of [1, 2, 3, 4] as const) {
        const q = await loadCmp08Quarter(ctx.db, ctx.businessId, fy, quarter);
        quarters.push({
          ...q,
          quarterStart: q.quarterStart.toISOString(),
          quarterEnd: q.quarterEnd.toISOString(),
          dueDate: q.dueDate.toISOString(),
        });
      }
      return { financialYear: fy, quarters };
    }),

  /**
   * GSTR-4 annual return tables for a composition taxpayer. `cmp08Paid` is the
   * total actually paid through CMP-08 per quarter, Q1-Q4 (the app has no payment
   * tracking); a missing quarter is assumed paid in full and `paidAssumed` says so.
   * Return: `{ ...report, dueDate, cmp08Summary.quarters[].dueDate }` as ISO strings.
   */
  gstr4: viewerProcedure
    .input(z.object({
      financialYear: fyInput,
      cmp08Paid: cmp08PaidInput,
      /** When GSTR-4 is filed and the balance paid: interest on the balance and the late fee are worked out only with it. */
      filedOn: z.coerce.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      assertRealYear(input.financialYear);
      try {
        const r = await loadGstr4(ctx.db, ctx.businessId, input.financialYear, input.cmp08Paid, input.filedOn);
        return {
          ...r,
          dueDate: r.dueDate.toISOString(),
          cmp08Summary: {
            ...r.cmp08Summary,
            quarters: r.cmp08Summary.quarters.map((q) => ({ ...q, dueDate: q.dueDate.toISOString() })),
          },
        };
      } catch (e) {
        if (e instanceof Gstr4NotApplicableError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        }
        throw e;
      }
    }),

  /**
   * GSTR-4 as a JSON file in the shape of the GST offline tool. BEST EFFORT: the
   * table and field keys are not verified against the portal schema (see
   * lib/gstr4-json.ts and docs/GSTR-4.md); check before uploading.
   */
  gstr4Json: viewerProcedure
    .input(z.object({
      financialYear: fyInput,
      cmp08Paid: cmp08PaidInput,
      /** When GSTR-4 is filed and the balance paid: interest on the balance and the late fee are worked out only with it. */
      filedOn: z.coerce.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      assertRealYear(input.financialYear);
      try {
        const r = await loadGstr4(ctx.db, ctx.businessId, input.financialYear, input.cmp08Paid, input.filedOn);
        const [biz] = await ctx.db.select({ gstin: businesses.gstin }).from(businesses)
          .where(eq(businesses.id, ctx.businessId)).limit(1);
        await recordCaExport(ctx, "gst.gstr4Json");
        return {
          filename: `GSTR4_FY${input.financialYear.replace("-", "_")}_portal.json`,
          json: gstr4ToPortalJson(r, { gstin: biz?.gstin ?? "", fy: input.financialYear }),
        };
      } catch (e) {
        if (e instanceof Gstr4NotApplicableError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        }
        throw e;
      }
    }),

  /**
   * The composition category and every compliance value for a year: the
   * effective value, whether it is the built-in default or this business's
   * override, the default itself, and when the defaults were last reviewed.
   */
  compositionSettings: viewerProcedure
    .input(z.object({ financialYear: fyInput.optional() }).default({}))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const fy = input.financialYear ?? financialYearLabel(financialYearOf(new Date(), 4));
      assertRealYear(fy);
      const setting = await loadCompositionSetting(ctx.db, ctx.businessId, fy);
      const r = setting.resolved;
      const day = (d: Date) => {
        const p = istDateParts(d);
        return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
      };
      return {
        financialYear: fy,
        category: setting.category,
        rateOverride: setting.rateOverride,
        configured: setting.configured,
        rate: r.rate,
        categories: defaultCompositionRules(fy),
        effective: {
          rate: r.rate,
          cmp08DueDay: r.cmp08DueDay,
          gstr4DueDate: day(r.gstr4DueDate),
          interestRatePercent: r.interestRatePercent,
          lateFeePerDay: r.lateFee.perDay,
          lateFeeCap: r.lateFee.cap,
          lateFeeNilPerDay: r.lateFee.nilPerDay,
          lateFeeNilCap: r.lateFee.nilCap,
        },
        defaults: {
          rate: r.defaults.rate,
          cmp08DueDay: r.defaults.cmp08DueDay,
          gstr4DueDate: day(r.defaults.gstr4DueDate),
          interestRatePercent: r.defaults.interestRatePercent,
          lateFeePerDay: r.defaults.lateFee.perDay,
          lateFeeCap: r.defaults.lateFee.cap,
          lateFeeNilPerDay: r.defaults.lateFee.nilPerDay,
          lateFeeNilCap: r.defaults.lateFee.nilCap,
        },
        sources: r.sources,
        meta: r.meta,
      };
    }),

  /**
   * Set the composition category and the per-year overrides of the built-in
   * compliance defaults. For every override, null resets it to the built-in
   * default and leaving it out keeps what is saved (`rate` is the exception:
   * leaving it out resets it, as before).
   */
  updateCompositionSettings: adminProcedure
    .input(z.object({
      financialYear: fyInput,
      category: z.enum(compositionCategories),
      /** Percent; leave out to use the category default. */
      rate: percent.nullish(),
      gstr4DueDate: isoDay.nullish(),
      interestRate: percent.nullish(),
      lateFeePerDay: amount.nullish(),
      lateFeeCap: amount.nullish(),
      lateFeeNilPerDay: amount.nullish(),
      lateFeeNilCap: amount.nullish(),
      cmp08DueDay: z.number().int().min(1).max(28).nullish(),
    }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Business");
      assertRealYear(input.financialYear);
      if (input.gstr4DueDate) {
        const [y, m, d] = input.gstr4DueDate.split("-").map(Number);
        const check = new Date(Date.UTC(y!, m! - 1, d!));
        if (check.getUTCMonth() !== m! - 1 || check.getUTCDate() !== d!) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "GSTR-4 due date is not a real date" });
        }
      }
      const values = {
        category: input.category,
        rate: input.rate ?? null,
        ...(input.gstr4DueDate !== undefined && { gstr4DueDate: input.gstr4DueDate }),
        ...(input.interestRate !== undefined && { interestRate: input.interestRate }),
        ...(input.lateFeePerDay !== undefined && { lateFeePerDay: input.lateFeePerDay }),
        ...(input.lateFeeCap !== undefined && { lateFeeCap: input.lateFeeCap }),
        ...(input.lateFeeNilPerDay !== undefined && { lateFeeNilPerDay: input.lateFeeNilPerDay }),
        ...(input.lateFeeNilCap !== undefined && { lateFeeNilCap: input.lateFeeNilCap }),
        ...(input.cmp08DueDay !== undefined && { cmp08DueDay: input.cmp08DueDay }),
        updatedAt: new Date(),
      };
      const [row] = await ctx.db
        .insert(compositionSettings)
        .values({ businessId: ctx.businessId, financialYear: input.financialYear, ...values })
        .onConflictDoUpdate({ target: [compositionSettings.businessId, compositionSettings.financialYear], set: values })
        .returning();
      return row!;
    }, (row, input) => ({
      action: "gst.updateCompositionSettings",
      entityType: "composition_settings",
      entityId: row.id,
      metadata: {
        financialYear: input.financialYear, category: input.category, rate: input.rate ?? null,
        gstr4DueDate: row.gstr4DueDate, interestRate: row.interestRate,
        lateFeePerDay: row.lateFeePerDay, lateFeeCap: row.lateFeeCap,
        lateFeeNilPerDay: row.lateFeeNilPerDay, lateFeeNilCap: row.lateFeeNilCap,
        cmp08DueDay: row.cmp08DueDay,
      },
    }))),
});
