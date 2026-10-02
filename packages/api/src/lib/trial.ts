/**
 * Trial storage: tenants.trial_ends_at. Nothing starts trials on its own yet;
 * a platform admin sets or clears one (platform.setTrial). Past the end with
 * no live plan subscription the organisation is read-only (deriveAccess).
 */

import { eq } from "drizzle-orm";
import { controlDb, tenants } from "@fintranzact/db";
import { invalidateEntitlements } from "./entitlements-cache.js";
import { recordBillingEvent } from "./billing/service.js";

/** Set the trial end (or clear it with null). Returns null when the organisation does not exist. */
export async function setTrial(
  tenantId: string,
  endsAt: Date | null,
  opts: { actorUserId?: string } = {},
): Promise<{ id: string; trialEndsAt: Date | null } | null> {
  const [before] = await controlDb.select({ trialEndsAt: tenants.trialEndsAt }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!before) return null;
  const [row] = await controlDb
    .update(tenants)
    .set({ trialEndsAt: endsAt, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning({ id: tenants.id, trialEndsAt: tenants.trialEndsAt });
  invalidateEntitlements(tenantId);
  await recordBillingEvent({
    provider: "local",
    type: "tenant.trial_set",
    tenantId,
    payload: {
      from: before.trialEndsAt?.toISOString() ?? null,
      to: endsAt?.toISOString() ?? null,
      actorUserId: opts.actorUserId ?? null,
    },
  });
  return row ?? null;
}
