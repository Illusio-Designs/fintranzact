/**
 * gstReturns.ts — file GSTR-1 / GSTR-3B and pull GSTR-2B through Sandbox.co.in.
 *
 * Session: requestOtp (GST portal texts the registered mobile) -> verifyOtp
 * (in-memory taxpayer session, valid 6 h).
 * GSTR-1:  saveGstr1 -> pollReturnStatus -> proceedGstr1 -> pollReturnStatus ->
 *          fetchGstr1Summary -> requestEvcOtp -> fileGstr1.
 *          Nil: proceedGstr1 {nil, confirmNil} -> pollReturnStatus -> requestEvcOtp -> fileGstr1.
 * GSTR-3B: saveGstr3b -> pollReturnStatus -> checkLedgerGstr3b (proposal) ->
 *          postOffsetGstr3b (user-confirmed) -> pollReturnStatus ->
 *          fetchGstr3bDetails -> requestEvcOtp -> fileGstr3b.
 *          Nil: requestEvcOtp {nil, confirmNil} -> fileGstr3b.
 * The step-by-step state lives in lib/gst-return-flow.ts (persisted per period),
 * the decisions in lib/gst-filing.ts. Filing is Sandbox-only, refuses months
 * already marked as filed, and never happens without the user's EVC OTP.
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
import { SandboxGstReturnsClient, GstReturnsError, toGstnPeriod } from "../lib/sandbox/gst-returns.js";
import { generateGSTR1, generateGSTR3B } from "../lib/gst-reports.js";
import { loadPeriodLockState, formatReturnPeriod } from "../lib/period-lock.js";
import { recordGovUsage } from "../lib/gov-usage.js";
import { withAudit } from "../lib/audit.js";
import { importGstr2b } from "./gstr2b.js";
import { GstFiling, FilingRefusal } from "../lib/gst-filing.js";
import {
  FlowError,
  GSTR1_PREREQUISITE,
  GSTR3B_PREREQUISITE,
  loadAttempt,
  publicAttempt,
  resolvePan,
  saveAttempt,
} from "../lib/gst-return-flow.js";

const periodInput = z.object({
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12),
});
const panInput = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter the PAN tied to the GST registration");
const evcOtpInput = z.string().regex(/^\d{4,8}$/, "Enter the EVC OTP sent to the registered mobile or email");
const kindInput = z.enum(["gstr1", "gstr3b"]);
const kindPeriodInput = periodInput.extend({ kind: kindInput });
const otpInput = z.object({
  username: z.string().trim().min(1).max(100),
  otp: z.string().regex(/^\d{4,8}$/, "Enter the OTP sent to the registered mobile"),
});
const turnoverInput = z.number().min(0).max(1e13);

const ym = (i: { year: number; month: number }) => `${i.year}-${String(i.month).padStart(2, "0")}`;
const gstnPeriod = (i: { year: number; month: number }) => toGstnPeriod(ym(i));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (i: { year: number; month: number }) => `${MONTHS[i.month - 1]} ${i.year}`;

/** Business GSTIN + a returns client; throws a clear tRPC error when filing is not possible. */
async function returnsClient(db: TenantDatabase, businessId: string, username = "") {
  const sandbox = useSandboxProvider() ? getSandboxClient() : null;
  if (!sandbox) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "GST return filing needs the Sandbox.co.in integration, which is not enabled on this server.",
    });
  }
  const [biz] = await db.select({ gstin: businesses.gstin, pan: businesses.pan }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.gstin) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add the business GSTIN in Settings before filing returns." });
  }
  return { gstin: biz.gstin, businessPan: biz.pan, client: new SandboxGstReturnsClient(sandbox, { gstin: biz.gstin, username }) };
}

type FilingCtx = { db: TenantDatabase; businessId: string; user: { id: string } | null };

/** The filing orchestrator for one period, wired to this business's data and journal. */
async function filingFor(ctx: FilingCtx, input: { year: number; month: number }) {
  const { gstin, businessPan, client } = await returnsClient(ctx.db, ctx.businessId);
  const userId = ctx.user!.id;
  const filing = new GstFiling({
    gstin,
    client,
    store: {
      load: (kind, period) => loadAttempt(ctx.db, ctx.businessId, kind, period),
      save: (attempt) => saveAttempt(ctx.db, ctx.businessId, userId, attempt),
    },
    gstr1Report: () => generateGSTR1(ctx.businessId, input.year, input.month, ctx.db),
    gstr3bReport: () => generateGSTR3B(ctx.businessId, input.year, input.month, ctx.db),
    pan: (explicit) => resolvePan({ input: explicit, business: businessPan, gstin }),
    periodLabel: label(input),
  });
  return { gstin, filing, fp: gstnPeriod(input) };
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
  if (err instanceof FilingRefusal) {
    throw new TRPCError({ code: err.kind === "bad_input" ? "BAD_REQUEST" : "PRECONDITION_FAILED", message: err.message, cause: err });
  }
  if (err instanceof FlowError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message, cause: err });
  }
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

const audit = (action: string) => (_r: unknown, input: { year: number; month: number }) => ({
  action,
  entityType: "gst_return",
  metadata: { period: ym(input) },
});

export const gstReturnsRouter = router({
  /** Ask the GST portal to send an OTP to the registered mobile. */
  requestOtp: adminProcedure
    .input(z.object({ username: z.string().trim().min(1).max(100) }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      const { client } = await returnsClient(ctx.db, ctx.businessId, input.username);
      await guarded(() => client.requestOtp());
      return { sent: true };
    }, () => ({ action: "gstReturns.requestOtp", entityType: "gst_return" }))),

  verifyOtp: adminProcedure.input(otpInput).mutation(withAudit(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    const { client } = await returnsClient(ctx.db, ctx.businessId, input.username);
    await guarded(() => client.verifyOtp(input.otp));
    return { verified: true };
  }, () => ({ action: "gstReturns.verifyOtp", entityType: "gst_return" }))),

  /** Where a return stands (persisted step, errors, proposal) plus whether a nil return may be offered. */
  filingAttempt: adminProcedure.input(kindPeriodInput).query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "GstReport");
    const fp = gstnPeriod(input);
    const attempt = await loadAttempt(ctx.db, ctx.businessId, input.kind, fp);
    let nilBlockers: string[] | null = null;
    try {
      const { filing } = await filingFor(ctx, input);
      nilBlockers = input.kind === "gstr1" ? await filing.gstr1NilBlockers() : await filing.gstr3bNilBlockers();
    } catch {
      nilBlockers = null; // no Sandbox / GSTIN: the books-only guard cannot run, nil stays unavailable
    }
    return {
      ...publicAttempt(attempt, input.kind, fp),
      prerequisite: input.kind === "gstr1" ? GSTR1_PREREQUISITE : GSTR3B_PREREQUISITE,
      nilEligible: nilBlockers !== null && nilBlockers.length === 0,
      nilBlockers: nilBlockers ?? [],
    };
  }),

  // ── GSTR-1 ───────────────────────────────────────────────────

  /** Step 2: save every section. `gt` / `curGt`: gross turnover (preceding FY / current FY so far). */
  saveGstr1: adminProcedure
    .input(periodInput.extend({ gt: turnoverInput, curGt: turnoverInput }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      await assertNotFiled(ctx.db, ctx.businessId, ym(input));
      const { filing, fp } = await filingFor(ctx, input);
      const res = await guarded(() => filing.saveGstr1(fp, { gt: input.gt, curGt: input.curGt }));
      return { ...res, period: fp, prerequisite: GSTR1_PREREQUISITE };
    }, (r, input) => ({ action: "gstReturns.saveGstr1", entityType: "gst_return", metadata: { period: ym(input), referenceId: r.referenceId } }))),

  /** Step 3 (normal), or step 2 of a nil return (`nil` + `confirmNil`). */
  proceedGstr1: adminProcedure
    .input(periodInput.extend({ nil: z.boolean().default(false), confirmNil: z.boolean().default(false) }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      await assertNotFiled(ctx.db, ctx.businessId, ym(input));
      const { filing, fp } = await filingFor(ctx, input);
      const res = await guarded(() => filing.proceedGstr1(fp, { nil: input.nil, confirmNil: input.confirmNil }));
      return { ...res, period: fp, nil: input.nil };
    }, (r, input) => ({ action: "gstReturns.proceedGstr1", entityType: "gst_return", metadata: { period: ym(input), referenceId: r.referenceId, nil: r.nil } }))),

  /** Step 4: sec_sum + chksum are stored with the attempt; only the section summary comes back. */
  fetchGstr1Summary: adminProcedure.input(periodInput).mutation(withAudit(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    const { filing, fp } = await filingFor(ctx, input);
    const res = await guarded(() => filing.fetchGstr1Summary(fp));
    return { ...res, period: fp };
  }, audit("gstReturns.fetchGstr1Summary"))),

  /** Check the GST Return Status of the last save / proceed / offset. At most one portal call per 12 s. */
  pollReturnStatus: adminProcedure
    .input(kindPeriodInput.extend({ restart: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      const { filing, fp } = await filingFor(ctx, input);
      return guarded(() => filing.pollStatus(input.kind, fp, { restart: input.restart }));
    }),

  /** Send the EVC OTP (the PAN defaults to the business PAN, then the one inside the GSTIN). */
  requestEvcOtp: adminProcedure
    .input(kindPeriodInput.extend({ pan: panInput.optional(), nil: z.boolean().default(false), confirmNil: z.boolean().default(false) }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      await assertNotFiled(ctx.db, ctx.businessId, ym(input));
      const { filing, fp } = await filingFor(ctx, input);
      const res = await guarded(() => filing.requestEvcOtp(input.kind, fp, { nil: input.nil, confirmNil: input.confirmNil, pan: input.pan }));
      return { ...res, period: fp, kind: input.kind };
    }, (r, input) => ({ action: "gstReturns.requestEvcOtp", entityType: "gst_return", metadata: { period: ym(input), kind: r.kind, nil: r.nil } }))),

  /** Final step. The OTP is passed through and never stored or logged. */
  fileGstr1: adminProcedure
    .input(periodInput.extend({ evcOtp: evcOtpInput, pan: panInput.optional() }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      await assertNotFiled(ctx.db, ctx.businessId, ym(input));
      const { gstin, filing, fp } = await filingFor(ctx, input);
      const res = await guarded(() => filing.file("gstr1", fp, input.evcOtp, input.pan));
      if (ctx.tenantId) {
        await recordGovUsage({ tenantId: ctx.tenantId, businessId: ctx.businessId, gstin, kind: "gstr1_filed", reference: fp });
      }
      return { filed: true, period: fp, referenceId: res.referenceId, nil: res.nil };
    }, (r) => ({ action: "gstReturns.fileGstr1", entityType: "gst_return", metadata: { period: r.period, referenceId: r.referenceId, nil: r.nil } }))),

  // ── GSTR-3B ──────────────────────────────────────────────────

  saveGstr3b: adminProcedure.input(periodInput).mutation(withAudit(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    await assertNotFiled(ctx.db, ctx.businessId, ym(input));
    const { filing, fp } = await filingFor(ctx, input);
    const res = await guarded(() => filing.saveGstr3b(fp));
    return { ...res, period: fp };
  }, (r, input) => ({ action: "gstReturns.saveGstr3b", entityType: "gst_return", metadata: { period: ym(input), referenceId: r.referenceId } }))),

  /** Step 4: ledger balances and the PROPOSED set-off. Posts nothing. */
  checkLedgerGstr3b: adminProcedure.input(periodInput).mutation(withAudit(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    const { filing, fp } = await filingFor(ctx, input);
    const res = await guarded(() => filing.checkLedger(fp));
    return { ...res, period: fp };
  }, audit("gstReturns.checkLedgerGstr3b"))),

  /** Step 5: post the set-off. `confirm` must be true and `proposalKey` the one the user was shown. */
  postOffsetGstr3b: adminProcedure
    .input(periodInput.extend({ confirm: z.literal(true), proposalKey: z.string().min(2).max(4000) }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      await assertNotFiled(ctx.db, ctx.businessId, ym(input));
      const { filing, fp } = await filingFor(ctx, input);
      const res = await guarded(() => filing.postOffset(fp, input.proposalKey));
      return { ...res, period: fp };
    }, (r, input) => ({ action: "gstReturns.postOffsetGstr3b", entityType: "gst_return", metadata: { period: ym(input), referenceId: r.referenceId } }))),

  /** Step 6: fetch the updated 3B data (tx_pmt), kept with the attempt. */
  fetchGstr3bDetails: adminProcedure.input(periodInput).mutation(withAudit(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "GstReport");
    const { filing, fp } = await filingFor(ctx, input);
    const res = await guarded(() => filing.fetchDetails(fp));
    return { ...res, period: fp };
  }, audit("gstReturns.fetchGstr3bDetails"))),

  fileGstr3b: adminProcedure
    .input(periodInput.extend({ evcOtp: evcOtpInput, pan: panInput.optional() }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");
      await assertNotFiled(ctx.db, ctx.businessId, ym(input));
      const { gstin, filing, fp } = await filingFor(ctx, input);
      const res = await guarded(() => filing.file("gstr3b", fp, input.evcOtp, input.pan));
      if (ctx.tenantId) {
        await recordGovUsage({ tenantId: ctx.tenantId, businessId: ctx.businessId, gstin, kind: "gstr3b_filed", reference: fp });
      }
      return { filed: true, period: fp, referenceId: res.referenceId, nil: res.nil };
    }, (r) => ({ action: "gstReturns.fileGstr3b", entityType: "gst_return", metadata: { period: r.period, referenceId: r.referenceId, nil: r.nil } }))),

  /** Download GSTR-2B from the portal and run it through the existing import + reconciliation. */
  pull2b: adminProcedure.input(periodInput).mutation(withAudit(async ({ input, ctx }) => {
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
  }, (_r, input) => ({ action: "gstReturns.pull2b", entityType: "gst_return", metadata: { period: ym(input) } }))),
});
