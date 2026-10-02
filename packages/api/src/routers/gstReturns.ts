/**
 * gstReturns.ts — file GSTR-1 / GSTR-3B and pull GSTR-2B through Sandbox.co.in.
 *
 * Flow: requestOtp (GST portal texts the registered mobile) -> verifyOtp
 * (in-memory taxpayer session, ~6 h) -> saveGstr1 / saveGstr3b (push the
 * books' figures as the draft) -> fileGstr1 / fileGstr3b (EVC OTP + signatory
 * PAN). Filing is Sandbox-only and refuses months already marked as filed.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { businesses } from "@fintranzact/db";
import { gstr2bUploadSchema } from "@fintranzact/shared";
import { router, adminProcedure, type TenantDatabase } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { useSandboxProvider } from "../lib/gov-provider.js";
import { getSandboxClient } from "../lib/sandbox/client.js";
import {
  SandboxGstReturnsClient,
  GstReturnsError,
  gstr1ToSections,
  gstr3bToGstn,
  toGstnPeriod,
} from "../lib/sandbox/gst-returns.js";
import { generateGSTR1, generateGSTR3B } from "../lib/gst-reports.js";
import { loadPeriodLockState, formatReturnPeriod } from "../lib/period-lock.js";
import { recordGovUsage } from "../lib/gov-usage.js";
import { importGstr2b } from "./gstr2b.js";

const periodInput = z.object({
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12),
});
const filingInput = periodInput.extend({
  evcOtp: z.string().regex(/^\d{4,8}$/, "Enter the OTP sent to the authorised signatory"),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter the authorised signatory's PAN"),
});
const otpInput = z.object({
  username: z.string().trim().min(1).max(100),
  otp: z.string().regex(/^\d{4,8}$/, "Enter the OTP sent to the registered mobile"),
});

const ym = (i: { year: number; month: number }) => `${i.year}-${String(i.month).padStart(2, "0")}`;
const gstnPeriod = (i: { year: number; month: number }) => toGstnPeriod(ym(i));

/** Business GSTIN + a returns client; throws a clear tRPC error when filing is not possible. */
async function returnsClient(db: TenantDatabase, businessId: string, username = "") {
  const sandbox = useSandboxProvider() ? getSandboxClient() : null;
  if (!sandbox) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "GST return filing needs the Sandbox.co.in integration, which is not enabled on this server.",
    });
  }
  const [biz] = await db.select({ gstin: businesses.gstin }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.gstin) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add the business GSTIN in Settings before filing returns." });
  }
  return { gstin: biz.gstin, client: new SandboxGstReturnsClient(sandbox, { gstin: biz.gstin, username }) };
}

/** Refuse changes to a month already marked as filed (period lock). */
async function assertNotFiled(db: TenantDatabase, businessId: string, period: string) {
  const state = await loadPeriodLockState(db, businessId);
  if (state.gstMonths.has(period)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `GST returns for ${formatReturnPeriod(period)} are already marked as filed. Unlock the month first if a correction is needed.`,
    });
  }
}

function toTrpc(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof GstReturnsError) {
    throw new TRPCError({
      code: err.code === "no_session" ? "UNAUTHORIZED" : err.retryable ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return toTrpc(err);
  }
}

export const gstReturnsRouter = router({
  /** Ask the GST portal to send an OTP to the registered mobile. */
  requestOtp: adminProcedure
    .input(z.object({ username: z.string().trim().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      const { client } = await returnsClient(ctx.db, ctx.businessId, input.username);
      await guarded(() => client.requestOtp());
      return { sent: true };
    }),

  verifyOtp: adminProcedure.input(otpInput).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    const { client } = await returnsClient(ctx.db, ctx.businessId, input.username);
    await guarded(() => client.verifyOtp(input.otp));
    return { verified: true };
  }),

  saveGstr1: adminProcedure.input(periodInput).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    await assertNotFiled(ctx.db, ctx.businessId, ym(input));
    const { gstin, client } = await returnsClient(ctx.db, ctx.businessId);
    const report = await generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);
    const fp = gstnPeriod(input);
    const sections = gstr1ToSections(report, gstin, fp);
    await guarded(async () => {
      for (const [name, payload] of Object.entries(sections)) {
        await client.saveGstr1Section(fp, name, payload);
      }
    });
    return { saved: Object.keys(sections) };
  }),

  fileGstr1: adminProcedure.input(filingInput).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    await assertNotFiled(ctx.db, ctx.businessId, ym(input));
    const { gstin, client } = await returnsClient(ctx.db, ctx.businessId);
    const fp = gstnPeriod(input);
    const res = await guarded(() => client.fileGstr1(fp, input.evcOtp, input.pan));
    if (ctx.tenantId) {
      await recordGovUsage({ tenantId: ctx.tenantId, businessId: ctx.businessId, gstin, kind: "gstr1_filed", reference: fp });
    }
    return { filed: true, period: fp, referenceId: res.referenceId };
  }),

  saveGstr3b: adminProcedure.input(periodInput).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    await assertNotFiled(ctx.db, ctx.businessId, ym(input));
    const { gstin, client } = await returnsClient(ctx.db, ctx.businessId);
    const report = await generateGSTR3B(ctx.businessId, input.year, input.month, ctx.db);
    const fp = gstnPeriod(input);
    await guarded(() => client.saveGstr3b(fp, gstr3bToGstn(report, gstin, fp)));
    return { saved: true };
  }),

  fileGstr3b: adminProcedure.input(filingInput).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    await assertNotFiled(ctx.db, ctx.businessId, ym(input));
    const { gstin, client } = await returnsClient(ctx.db, ctx.businessId);
    const fp = gstnPeriod(input);
    const res = await guarded(() => client.fileGstr3b(fp, input.evcOtp, input.pan));
    if (ctx.tenantId) {
      await recordGovUsage({ tenantId: ctx.tenantId, businessId: ctx.businessId, gstin, kind: "gstr3b_filed", reference: fp });
    }
    return { filed: true, period: fp, referenceId: res.referenceId };
  }),

  /** Download GSTR-2B from the portal and run it through the existing import + reconciliation. */
  pull2b: adminProcedure.input(periodInput).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    const { client } = await returnsClient(ctx.db, ctx.businessId);
    const fp = gstnPeriod(input);
    const json = await guarded(() => client.fetchGstr2b(fp));
    const upload: z.infer<typeof gstr2bUploadSchema> = {
      returnPeriod: ym(input),
      content: JSON.stringify(json),
      fileName: `GSTR2B_${fp}_sandbox.json`,
      format: "json",
    };
    try {
      return await importGstr2b(ctx, upload);
    } catch (err) {
      return toTrpc(err);
    }
  }),
});
