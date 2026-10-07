/**
 * AI question quota: what an organisation may still ask, and the race-safe
 * consume / refund of one question.
 *
 * Where the numbers live (control database, organisation level):
 *  - ai_quota_counters: questions used per counter key (the IST month for the
 *    paid tiers; one key for the whole Full Access Trial),
 *  - ai_credit_grants: extra-pack credits (a platform admin grants them now; the
 *    purchase flow belongs to the AI add-on billing work),
 *  - ai_usage: one ledger row per question (see service.ts).
 *
 * Consuming is one atomic upsert that only increments while under the limit, so
 * two questions asked at the same moment can never both take the last slot.
 * Credits are taken only once the included questions are used up. A refund puts
 * the question back where it came from.
 */

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { aiCreditGrants, aiQuotaCounters, billingSubscriptions, controlDb } from "@fintranzact/db";
import { aiCounterKey, computeAiAllowance, deriveAiTier, type AiAllowance, type AiTier } from "@fintranzact/shared";
import type { Entitlements } from "../entitlements.js";
import { getTrialSettings } from "../trial-settings.js";

export interface AiAccount {
  tier: AiTier;
  counterKey: string;
  allowance: AiAllowance;
}

/** Live AI add-on subscriptions (an admin grant is one; a Full Access Trial is not). */
async function subscribedAiAddons(tenantId: string, now: Date): Promise<{ ai_assistant: boolean; ai_plus: boolean }> {
  const rows = await controlDb
    .select({ addon: billingSubscriptions.addon, status: billingSubscriptions.status, graceUntil: billingSubscriptions.graceUntil })
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.tenantId, tenantId), eq(billingSubscriptions.kind, "addon")));
  const out = { ai_assistant: false, ai_plus: false };
  for (const r of rows) {
    if (r.addon !== "ai_assistant" && r.addon !== "ai_plus") continue;
    const live = r.status === "active" || (r.status === "past_due" && (!r.graceUntil || r.graceUntil.getTime() >= now.getTime()));
    if (live) out[r.addon] = true;
  }
  return out;
}

export async function creditsRemaining(tenantId: string): Promise<number> {
  const [row] = await controlDb
    .select({ n: sql<number>`COALESCE(SUM(${aiCreditGrants.credits} - ${aiCreditGrants.used}), 0)::int` })
    .from(aiCreditGrants)
    .where(eq(aiCreditGrants.tenantId, tenantId));
  return row?.n ?? 0;
}

/** The organisation's AI tier and allowance right now, or null when it has no AI add-on. */
export async function loadAiAccount(tenantId: string, ent: Entitlements, now: Date = new Date()): Promise<AiAccount | null> {
  const subscribed = await subscribedAiAddons(tenantId, now);
  const tier = deriveAiTier({
    addons: { ai_assistant: !!ent.addons.ai_assistant, ai_plus: !!ent.addons.ai_plus },
    trialActive: ent.trial.active,
    subscribed,
  });
  if (!tier) return null;
  const counterKey = aiCounterKey(tier, now, ent.trial.startedAt);
  const [counter] = await controlDb
    .select({ used: aiQuotaCounters.used })
    .from(aiQuotaCounters)
    .where(and(eq(aiQuotaCounters.tenantId, tenantId), eq(aiQuotaCounters.key, counterKey)))
    .limit(1);
  const trialCap = ent.trial.caps?.aiQuestions ?? (await getTrialSettings()).caps.aiQuestions;
  return {
    tier,
    counterKey,
    allowance: computeAiAllowance({ tier, trialCap, used: counter?.used ?? 0, creditsRemaining: await creditsRemaining(tenantId) }),
  };
}

export type Consumption = { source: "included" } | { source: "credit"; grantId: string };

/**
 * Take one question. Returns where it came from, or null when nothing is left
 * (included questions used up and no credits).
 */
export async function consumeQuestion(tenantId: string, counterKey: string, limit: number): Promise<Consumption | null> {
  if (limit > 0) {
    const rows = await controlDb.execute(sql`
      INSERT INTO ai_quota_counters (tenant_id, key, used, updated_at)
      VALUES (${tenantId}, ${counterKey}, 1, now())
      ON CONFLICT (tenant_id, key) DO UPDATE
        SET used = ai_quota_counters.used + 1, updated_at = now()
        WHERE ai_quota_counters.used < ${limit}
      RETURNING used
    `);
    if (rows.length > 0) return { source: "included" };
  }
  // Included questions are used up: take one from the oldest pack with credits left.
  for (let attempt = 0; attempt < 5; attempt++) {
    const [candidate] = await controlDb
      .select({ id: aiCreditGrants.id })
      .from(aiCreditGrants)
      .where(and(eq(aiCreditGrants.tenantId, tenantId), gt(sql`${aiCreditGrants.credits} - ${aiCreditGrants.used}`, 0)))
      .orderBy(asc(aiCreditGrants.createdAt))
      .limit(1);
    if (!candidate) return null;
    const taken = await controlDb
      .update(aiCreditGrants)
      .set({ used: sql`${aiCreditGrants.used} + 1` })
      .where(and(eq(aiCreditGrants.id, candidate.id), sql`${aiCreditGrants.used} < ${aiCreditGrants.credits}`))
      .returning({ id: aiCreditGrants.id });
    if (taken.length > 0) return { source: "credit", grantId: candidate.id };
  }
  return null;
}

/** Give a question back (provider failure, or nothing was produced). */
export async function refundQuestion(tenantId: string, counterKey: string, source: string, grantId: string | null): Promise<void> {
  if (source === "credit" && grantId) {
    await controlDb
      .update(aiCreditGrants)
      .set({ used: sql`GREATEST(${aiCreditGrants.used} - 1, 0)` })
      .where(and(eq(aiCreditGrants.id, grantId), eq(aiCreditGrants.tenantId, tenantId)));
    return;
  }
  await controlDb
    .update(aiQuotaCounters)
    .set({ used: sql`GREATEST(${aiQuotaCounters.used} - 1, 0)`, updatedAt: new Date() })
    .where(and(eq(aiQuotaCounters.tenantId, tenantId), eq(aiQuotaCounters.key, counterKey)));
}

/** Add an extra pack of questions (a platform admin's grant). */
export async function grantCredits(opts: { tenantId: string; credits: number; reason: string; grantedByUserId: string }) {
  const [row] = await controlDb
    .insert(aiCreditGrants)
    .values({ tenantId: opts.tenantId, credits: opts.credits, reason: opts.reason, grantedByUserId: opts.grantedByUserId, source: "admin_grant" })
    .returning();
  return row!;
}
