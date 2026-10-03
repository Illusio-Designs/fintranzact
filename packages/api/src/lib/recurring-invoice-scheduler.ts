/**
 * In-process scheduler for recurring invoices.
 * Ticks every 60 seconds, finds due templates, and generates invoices.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for concurrency safety.
 */

import { eq, and, sql, gte, lte } from "drizzle-orm";
import { getTenantDb, controlDb, tenants, recurringInvoiceTemplates, recurringInvoiceRuns } from "@fintranzact/db";
import { generateInvoiceFromTemplate, nextRunDateAfter } from "./recurring-invoice-generator.js";
import { getEntitlements } from "./entitlements.js";
import { logger } from "./logger.js";
import { RECURRING_RUNS_PER_MONTH_SELF_HOSTED, getLimits } from "./plan-limits.js";

const TICK_MS = 60_000; // 60 seconds
const MAX_CATCHUP = 12; // Max invoices per template per tick to prevent runaway loops
const isMultiTenant = process.env.MULTI_TENANT === "true";
let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  try {
    if (!isMultiTenant) {
      // Self-hosted: single tenant DB
      const db = await getTenantDb("single");
      await processDueTemplates(db);
    } else {
      // Multi-tenant: iterate all active tenants
      const activeTenants = await controlDb
        .select({ id: tenants.id, plan: tenants.plan })
        .from(tenants)
        .where(eq(tenants.status, "active"));

      for (const tenant of activeTenants) {
        try {
          await tickTenant(tenant.id, {
            readOnly: async (id) => (await getEntitlements(id)).readOnly,
            runsPerMonth: async () => (await getLimits(tenant.plan ?? "starter")).recurringRunsPerMonth,
            getDb: getTenantDb,
            process: processDueTemplates,
            skip: skipDueTemplates,
          });
        } catch (err) {
          console.error(`[recurring-scheduler] tenant ${tenant.id} error:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[recurring-scheduler] tick error:", err);
  }
}

type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;

export interface TenantTickDeps {
  readOnly: (tenantId: string) => Promise<boolean>;
  runsPerMonth: () => Promise<number>;
  getDb: (tenantId: string) => Promise<TenantDb>;
  process: (db: TenantDb, runsPerMonth: number) => Promise<void>;
  skip: (db: TenantDb) => Promise<void>;
}

/**
 * One organisation's turn in the scheduler. A read-only organisation (trial
 * over, payment failed, plan ended) generates nothing: its due templates are
 * moved on to their next future date (skipDueTemplates), no run is recorded
 * and nothing is marked failed. (Suspended organisations never get here: the
 * tick only lists tenants whose status is active.) Takes its dependencies so
 * the decision can be tested without a database.
 */
export async function tickTenant(tenantId: string, deps: TenantTickDeps): Promise<"skipped" | "processed"> {
  if (await deps.readOnly(tenantId)) {
    logger.debug({ tenantId }, "[recurring-scheduler] organisation is read-only; skipping its due templates");
    await deps.skip(await deps.getDb(tenantId));
    return "skipped";
  }
  await deps.process(await deps.getDb(tenantId), await deps.runsPerMonth());
  return "processed";
}

/**
 * Move due active templates past now WITHOUT generating invoices. The skipped
 * occurrences are dropped for good (decision: a recovered organisation must not
 * get a burst of back-dated invoices, so lapsed periods are not made up).
 * totalRuns and lastRunDate are untouched; a template whose end date passes is
 * completed, as the generator would.
 */
export async function skipDueTemplates(db: TenantDb): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const due = await tx.select()
      .from(recurringInvoiceTemplates)
      .where(and(
        eq(recurringInvoiceTemplates.status, "active"),
        lte(recurringInvoiceTemplates.nextRunDate, now),
      ))
      .limit(200)
      .for("update", { skipLocked: true });
    for (const tpl of due) {
      const next = nextRunDateAfter(tpl.nextRunDate, tpl.frequency, tpl.customIntervalDays, now);
      await tx.update(recurringInvoiceTemplates)
        .set({
          nextRunDate: next,
          status: tpl.endDate && next > tpl.endDate ? "completed" : undefined,
          updatedAt: now,
        })
        .where(eq(recurringInvoiceTemplates.id, tpl.id));
    }
  });
}

/**
 * @param runsPerMonth successful runs allowed per business per calendar month
 *   (the tenant's plan limit; Infinity = unlimited). Self-hosted installs use
 *   the original free-plan allowance.
 */
export async function processDueTemplates(
  db: Awaited<ReturnType<typeof getTenantDb>>,
  runsPerMonth: number = RECURRING_RUNS_PER_MONTH_SELF_HOSTED,
) {
  // Find active templates that are due, using FOR UPDATE SKIP LOCKED
  // to prevent duplicate processing in multi-instance deployments.
  const dueTemplates = await db.transaction(async (tx) => {
    return tx.select()
      .from(recurringInvoiceTemplates)
      .where(and(
        eq(recurringInvoiceTemplates.status, "active"),
        lte(recurringInvoiceTemplates.nextRunDate, new Date()),
      ))
      .limit(50)
      .for("update", { skipLocked: true });
  });

  for (const tpl of dueTemplates) {
    let catchupCount = 0;
    let currentNextRunDate = tpl.nextRunDate;
    let currentTotalRuns = tpl.totalRuns;

    while (currentNextRunDate <= new Date() && catchupCount < MAX_CATCHUP) {
      try {
        // Check plan limit: count successful runs this month for this business
        const limited = Number.isFinite(runsPerMonth);
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const [{ count }] = limited
          ? await db.select({ count: sql<number>`count(*)::int` })
            .from(recurringInvoiceRuns)
            .where(and(
              eq(recurringInvoiceRuns.businessId, tpl.businessId),
              eq(recurringInvoiceRuns.status, "success"),
              gte(recurringInvoiceRuns.executedAt, monthStart),
            ))
          : [{ count: 0 }];

        if (limited && count >= runsPerMonth) {
          // Record skipped run
          await db.insert(recurringInvoiceRuns).values({
            templateId: tpl.id,
            businessId: tpl.businessId,
            status: "skipped_limit",
            errorMessage: `Monthly limit of ${runsPerMonth} runs reached`,
          });
          // Still advance nextRunDate so we don't retry every tick
          const { computeNextRunDate } = await import("./recurring-invoice-generator.js");
          const nextRun = computeNextRunDate(currentNextRunDate, tpl.frequency, tpl.customIntervalDays);
          await db.update(recurringInvoiceTemplates)
            .set({ nextRunDate: nextRun, updatedAt: new Date() })
            .where(eq(recurringInvoiceTemplates.id, tpl.id));
          break; // Plan limit exhausted for this business this month — stop catch-up
        }

        await generateInvoiceFromTemplate(db, {
          ...tpl,
          nextRunDate: currentNextRunDate,
          totalRuns: currentTotalRuns,
          lineItems: tpl.lineItems as Parameters<typeof generateInvoiceFromTemplate>[1]["lineItems"],
          charges: tpl.charges as Parameters<typeof generateInvoiceFromTemplate>[1]["charges"],
        });
      } catch (err) {
        console.error(`[recurring-scheduler] Failed to generate invoice for template ${tpl.id}:`, err);
        // Record failed run
        await db.insert(recurringInvoiceRuns).values({
          templateId: tpl.id,
          businessId: tpl.businessId,
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch(() => {}); // Don't let logging failure crash the loop
        break; // Stop catch-up on error to avoid cascading failures
      }

      catchupCount++;

      // Re-read template to get the updated nextRunDate and totalRuns (the generator advances both)
      const [updated] = await db.select({
        nextRunDate: recurringInvoiceTemplates.nextRunDate,
        totalRuns: recurringInvoiceTemplates.totalRuns,
        status: recurringInvoiceTemplates.status,
        endDate: recurringInvoiceTemplates.endDate,
      })
        .from(recurringInvoiceTemplates)
        .where(eq(recurringInvoiceTemplates.id, tpl.id))
        .limit(1);

      if (!updated || updated.status !== "active") break;
      if (updated.endDate && updated.endDate <= new Date()) break;

      currentNextRunDate = updated.nextRunDate;
      currentTotalRuns = updated.totalRuns;
    }
  }
}

export function startRecurringScheduler() {
  if (timer) return;
  console.log("[recurring-scheduler] Started (60s interval)");
  timer = setInterval(tick, TICK_MS);
  timer.unref(); // Don't keep process alive just for this timer
}

export function stopRecurringScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[recurring-scheduler] Stopped");
  }
}
