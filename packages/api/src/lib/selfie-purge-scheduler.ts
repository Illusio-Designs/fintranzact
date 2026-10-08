/**
 * Deletes attendance selfies older than each business's retention period (Payroll Phase 3,
 * docs/architecture/payroll-self-service.md). The punch itself is kept; only the photo goes.
 * Runs every six hours; deleting is harmless to repeat. Read-only organisations are purged too
 * (retention is a promise to the employees, not a feature of the plan).
 */

import { eq } from "drizzle-orm";
import { controlDb, getTenantDb, tenants } from "@fintranzact/db";
import { purgeExpiredSelfies } from "./payroll/punches.js";
import { logger } from "./logger.js";

const TICK_MS = 6 * 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

export async function purgeSelfiesEverywhere(now: Date = new Date()): Promise<number> {
  let total = 0;
  try {
    if (process.env.MULTI_TENANT !== "true") {
      total += await purgeExpiredSelfies(await getTenantDb("single"), now);
    } else {
      const active = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
      for (const t of active) {
        try {
          total += await purgeExpiredSelfies(await getTenantDb(t.id), now);
        } catch (err) {
          logger.error({ err, tenantId: t.id }, "[selfie-purge] organisation failed");
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "[selfie-purge] tick failed");
  }
  if (total > 0) logger.info({ deleted: total }, "[selfie-purge] expired attendance selfies deleted");
  return total;
}

export function startSelfiePurgeScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void purgeSelfiesEverywhere(), TICK_MS);
  timer.unref();
  // One pass shortly after start, so a restart never delays a purge by a whole interval.
  setTimeout(() => void purgeSelfiesEverywhere(), 5 * 60_000).unref();
}

export function stopSelfiePurgeScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
