/**
 * gov-usage.ts — metering for documents sent to NIC/GSTN through Sandbox.co.in.
 *
 * Two separate counters:
 *  1. gov_api_usage — one row per successfully generated document (e-invoice,
 *     e-way bill, filed return) per tenant. This is what the customer is billed
 *     for, per document after the month ends, with no advance. Failed calls are
 *     never recorded, so they are never charged. A unique (tenant, kind,
 *     reference) index makes a retried call charge once.
 *  2. sandbox_call_counters — every successful (2xx) gateway call across the
 *     whole deployment, which is what Sandbox's monthly plan counts. Raises an
 *     alert as the plan quota (SANDBOX_MONTHLY_QUOTA) fills up.
 *
 * Metering must never break filing: every function here swallows and logs its
 * own errors.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { controlDb, govApiUsage, sandboxCallCounters, billingEvents } from "@fintranzact/db";
import { gstOnPaise } from "@fintranzact/shared";
import { logger } from "./logger.js";
import { isWalletOrQuotaError } from "./sandbox/funding.js";

export type GovDocKind = "e_invoice" | "e_way_bill" | "gstr1_filed" | "gstr3b_filed";

export const GOV_DOC_LABELS: Record<GovDocKind, string> = {
  e_invoice: "E-invoice (IRN)",
  e_way_bill: "E-way bill",
  gstr1_filed: "GSTR-1 filing",
  gstr3b_filed: "GSTR-3B filing",
};

/** Default per-document prices in paise, before GST. Override per deployment. */
const DEFAULT_RATE_PAISE: Record<GovDocKind, number> = {
  e_invoice: 200,
  e_way_bill: 200,
  gstr1_filed: 0,
  gstr3b_filed: 0,
};

const RATE_ENV: Record<GovDocKind, string> = {
  e_invoice: "GOV_RATE_E_INVOICE_PAISE",
  e_way_bill: "GOV_RATE_E_WAY_BILL_PAISE",
  gstr1_filed: "GOV_RATE_GSTR1_PAISE",
  gstr3b_filed: "GOV_RATE_GSTR3B_PAISE",
};

export function govRatePaise(kind: GovDocKind, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[RATE_ENV[kind]];
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return DEFAULT_RATE_PAISE[kind];
}

/** Calendar month ("YYYY-MM") of an instant, in IST. */
export function istPeriod(at: Date = new Date()): string {
  const ist = new Date(at.getTime() + 330 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** True once the IST month has ended, i.e. it can be billed. */
export function periodIsClosed(period: string, now: Date = new Date()): boolean {
  return period < istPeriod(now);
}

// ── Per-document metering ─────────────────────────────────────

export async function recordGovUsage(opts: {
  tenantId: string;
  businessId?: string | null;
  gstin?: string | null;
  kind: GovDocKind;
  reference: string;
}): Promise<void> {
  try {
    await controlDb
      .insert(govApiUsage)
      .values({
        tenantId: opts.tenantId,
        businessId: opts.businessId ?? null,
        gstin: opts.gstin ?? null,
        kind: opts.kind,
        reference: opts.reference,
        ratePaise: govRatePaise(opts.kind),
        period: istPeriod(),
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.error({ err, tenantId: opts.tenantId, kind: opts.kind }, "Could not record government API usage");
  }
}

export interface UsageLine {
  kind: GovDocKind;
  label: string;
  count: number;
  ratePaise: number;
  amountPaise: number;
}

export interface UsageSummary {
  period: string;
  lines: UsageLine[];
  documents: number;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  /** True when the month has ended and the amount is final. */
  closed: boolean;
}

/** Documents, rates and amount so far for one tenant and month. */
export async function usageSummary(tenantId: string, period: string = istPeriod()): Promise<UsageSummary> {
  const rows = await controlDb
    .select({
      kind: govApiUsage.kind,
      ratePaise: govApiUsage.ratePaise,
      count: sql<number>`count(*)::int`,
    })
    .from(govApiUsage)
    .where(and(eq(govApiUsage.tenantId, tenantId), eq(govApiUsage.period, period)))
    .groupBy(govApiUsage.kind, govApiUsage.ratePaise);

  const lines: UsageLine[] = rows
    .map((r) => ({
      kind: r.kind as GovDocKind,
      label: GOV_DOC_LABELS[r.kind as GovDocKind] ?? r.kind,
      count: r.count,
      ratePaise: r.ratePaise,
      amountPaise: r.count * r.ratePaise,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.ratePaise - b.ratePaise);

  const basePaise = lines.reduce((n, l) => n + l.amountPaise, 0);
  const gstPaise = gstOnPaise(basePaise);
  return {
    period,
    lines,
    documents: lines.reduce((n, l) => n + l.count, 0),
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
    closed: periodIsClosed(period),
  };
}

/** Months (newest first) in which the tenant sent any documents. */
export async function usagePeriods(tenantId: string, limit = 12): Promise<string[]> {
  const rows = await controlDb
    .selectDistinct({ period: govApiUsage.period })
    .from(govApiUsage)
    .where(eq(govApiUsage.tenantId, tenantId))
    .orderBy(sql`${govApiUsage.period} desc`)
    .limit(limit);
  return rows.map((r) => r.period);
}

/** Tenants with unbilled usage in a closed month. */
export async function tenantsWithUnbilledUsage(period: string): Promise<string[]> {
  const rows = await controlDb
    .selectDistinct({ tenantId: govApiUsage.tenantId })
    .from(govApiUsage)
    .where(and(eq(govApiUsage.period, period), isNull(govApiUsage.statementPaymentId)));
  return rows.map((r) => r.tenantId);
}

// ── Deployment-wide Sandbox quota ─────────────────────────────

const ALERT_THRESHOLDS = [80, 100] as const;

export function sandboxMonthlyQuota(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number(env.SANDBOX_MONTHLY_QUOTA);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Called for every successful gateway call. Never throws. */
export async function trackSandboxCall(): Promise<void> {
  try {
    const period = istPeriod();
    const [row] = await controlDb
      .insert(sandboxCallCounters)
      .values({ period, calls: 1 })
      .onConflictDoUpdate({
        target: sandboxCallCounters.period,
        set: { calls: sql`${sandboxCallCounters.calls} + 1`, updatedAt: new Date() },
      })
      .returning();
    const quota = sandboxMonthlyQuota();
    if (!row || !quota) return;

    const percent = Math.floor((row.calls / quota) * 100);
    const crossed = [...ALERT_THRESHOLDS].reverse().find((t) => percent >= t);
    if (crossed && crossed > row.alertedPercent) {
      await controlDb
        .update(sandboxCallCounters)
        .set({ alertedPercent: crossed })
        .where(eq(sandboxCallCounters.period, period));
      await raiseSandboxAlert(
        "sandbox.quota",
        `Sandbox plan quota is ${percent}% used (${row.calls} of ${quota} calls in ${period}).`,
        { period, calls: row.calls, quota, threshold: crossed },
      );
    }
  } catch (err) {
    logger.error({ err }, "Could not update Sandbox call counter");
  }
}

export interface QuotaStatus {
  period: string;
  calls: number;
  quota: number | null;
  percent: number | null;
}

export async function sandboxQuotaStatus(): Promise<QuotaStatus> {
  const period = istPeriod();
  const [row] = await controlDb.select().from(sandboxCallCounters).where(eq(sandboxCallCounters.period, period)).limit(1);
  const calls = row?.calls ?? 0;
  const quota = sandboxMonthlyQuota();
  return { period, calls, quota, percent: quota ? Math.floor((calls / quota) * 100) : null };
}

// ── Wallet / quota failures ───────────────────────────────────

let lastWalletAlertAt = 0;
const WALLET_ALERT_GAP_MS = 60 * 60 * 1000;

// The pure check lives in sandbox/funding.ts (no DB import) so the client and smoke script can use it.
export { isWalletOrQuotaError };

/** Alert (at most hourly) that filing is blocked because our Sandbox balance or quota ran out. */
export async function noteSandboxFundingFailure(httpStatus: number | undefined, message: string): Promise<void> {
  if (!isWalletOrQuotaError(httpStatus, message)) return;
  const now = Date.now();
  if (now - lastWalletAlertAt < WALLET_ALERT_GAP_MS) return;
  lastWalletAlertAt = now;
  await raiseSandboxAlert(
    "sandbox.wallet_or_quota_blocked",
    `Sandbox rejected a call for balance or quota: ${message}. E-invoices, e-way bills, GST filing and GSTIN/HSN lookups may be failing for customers. Top up the Sandbox wallet at console.sandbox.co.in (or raise the plan).`,
    { httpStatus, rawMessage: message },
  );
}

async function raiseSandboxAlert(type: string, message: string, payload: Record<string, unknown>): Promise<void> {
  logger.error({ ...payload, alert: type }, message);
  try {
    await controlDb.insert(billingEvents).values({ provider: "local", type, payload: { message, ...payload } });
  } catch (err) {
    logger.error({ err }, "Could not store Sandbox alert");
  }
}
