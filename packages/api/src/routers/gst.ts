import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { businesses, compositionSettings } from "@fintranzact/db";
import {
  compositionCategories, compositionRateFor, defaultCompositionRules, financialYearLabel, financialYearOf,
} from "@fintranzact/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { loadCmp08Quarter, loadCompositionSetting } from "../lib/cmp08.js";
import { requireCan } from "../lib/permissions.js";
import { generateGSTR1, generateGSTR3B, gstr1ToCSV, gstr1ToPortalJson } from "../lib/gst-reports.js";
import { generateGSTR9, gstr9ToPortalJson } from "../lib/gstr9-generator.js";

const fyInput = z.string().regex(/^\d{4}-\d{2}$/, "Use a financial year like 2026-27");
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
        dueDate: q.dueDate?.toISOString() ?? null,
      };
    }),

  /** All four quarters of a financial year (Q4 has no CMP-08: its tax goes in GSTR-4). */
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
          dueDate: q.dueDate?.toISOString() ?? null,
        });
      }
      return { financialYear: fy, quarters };
    }),

  /** The composition category and rate for a year, with the defaults to pick from. */
  compositionSettings: viewerProcedure
    .input(z.object({ financialYear: fyInput.optional() }).default({}))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const fy = input.financialYear ?? financialYearLabel(financialYearOf(new Date(), 4));
      assertRealYear(fy);
      const setting = await loadCompositionSetting(ctx.db, ctx.businessId, fy);
      return {
        financialYear: fy,
        category: setting.category,
        rateOverride: setting.rateOverride,
        configured: setting.configured,
        rate: compositionRateFor(setting.category, setting.rateOverride, fy),
        categories: defaultCompositionRules(fy),
      };
    }),

  /** Set the composition category (and, if the rate changed, the rate) for a financial year. */
  updateCompositionSettings: adminProcedure
    .input(z.object({
      financialYear: fyInput,
      category: z.enum(compositionCategories),
      /** Percent; leave out to use the category default. */
      rate: percent.nullish(),
    }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Business");
      assertRealYear(input.financialYear);
      const values = { category: input.category, rate: input.rate ?? null, updatedAt: new Date() };
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
      metadata: { financialYear: input.financialYear, category: input.category, rate: input.rate ?? null },
    }))),
});
