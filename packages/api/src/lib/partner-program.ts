import { randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { controlDb, partners, partnerPayouts, tenants } from "@fintranzact/db";
import {
  money,
  nextPartnerBadge,
  normalizeReferralCode,
  partnerBadgeFor,
  type PartnerBadge,
} from "@fintranzact/shared";
import { getPlanCatalog } from "./plan-catalog.js";

type ControlDbLike = Pick<typeof controlDb, "select" | "update">;

// No 0/O or 1/I, so codes survive being read out over the phone.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferralCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `FTZ-${code}`;
}

/** Give a partner a referral code if they have none yet. Returns their code. */
export async function ensureReferralCode(partnerId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [existing] = await controlDb
      .select({ code: partners.referralCode })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1);
    if (!existing) throw new Error("Partner not found");
    if (existing.code) return existing.code;
    try {
      const [row] = await controlDb
        .update(partners)
        .set({ referralCode: generateReferralCode() })
        .where(and(eq(partners.id, partnerId), sql`${partners.referralCode} IS NULL`))
        .returning({ code: partners.referralCode });
      if (row?.code) return row.code;
    } catch (err) {
      // Another partner already has this code: try a new one.
      if (!(err instanceof Error) || !/partners_referral_code_idx|unique/i.test(err.message)) throw err;
    }
  }
  throw new Error("Could not create a unique referral code");
}

/** The approved partner a referral code belongs to, if any. */
export async function partnerForReferralCode(db: ControlDbLike, code: string | null | undefined): Promise<string | null> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  const [row] = await db
    .select({ id: partners.id })
    .from(partners)
    .where(and(eq(partners.referralCode, normalized), eq(partners.status, "approved")))
    .limit(1);
  return row?.id ?? null;
}

export interface PartnerStats {
  referred: number;
  /** Referred organisations on a paid plan (priced, or priced on request). */
  paidReferrals: number;
  /** Paid referrals on a plan priced on request, which have no price to take commission on. */
  customPriced: number;
  /** Sum of the referred organisations' monthly plan prices, in rupees. */
  monthlyValue: string;
  badge: PartnerBadge;
  next: { badge: PartnerBadge; needed: number } | null;
  commissionPercent: number;
  /** Commission on one month of monthlyValue. */
  monthlyCommission: string;
  paidOut: string;
  pendingPayout: string;
}

/**
 * Referrals, badge and money for each partner. Only active organisations
 * count; an organisation is "paid" when its plan is not free.
 */
export async function getPartnerStats(
  rows: Array<{ id: string; commissionPercent: number | null }>,
): Promise<Map<string, PartnerStats>> {
  const stats = new Map<string, PartnerStats>();
  if (rows.length === 0) return stats;
  const ids = rows.map((r) => r.id);

  const [catalog, referred, payouts] = await Promise.all([
    getPlanCatalog(),
    controlDb
      .select({ partnerId: tenants.partnerId, plan: tenants.plan })
      .from(tenants)
      .where(and(inArray(tenants.partnerId, ids), eq(tenants.status, "active"))),
    controlDb
      .select({ partnerId: partnerPayouts.partnerId, status: partnerPayouts.status, amount: partnerPayouts.amount })
      .from(partnerPayouts)
      .where(inArray(partnerPayouts.partnerId, ids)),
  ]);
  const price = new Map(catalog.map((p) => [p.id, p.monthlyPriceInr]));

  for (const row of rows) {
    let referredCount = 0;
    let paid = 0;
    let custom = 0;
    let value = "0.00";
    for (const t of referred) {
      if (t.partnerId !== row.id) continue;
      referredCount++;
      const p = price.get(t.plan);
      if (p === 0 || p === undefined) continue;
      paid++;
      if (p === null) custom++;
      else value = money.add(value, String(p));
    }
    let paidOut = "0.00";
    let pending = "0.00";
    for (const p of payouts) {
      if (p.partnerId !== row.id) continue;
      if (p.status === "paid") paidOut = money.add(paidOut, p.amount);
      else pending = money.add(pending, p.amount);
    }
    const badge = partnerBadgeFor(paid);
    const pct = row.commissionPercent ?? badge.commissionPercent;
    stats.set(row.id, {
      referred: referredCount,
      paidReferrals: paid,
      customPriced: custom,
      monthlyValue: value,
      badge,
      next: nextPartnerBadge(paid),
      commissionPercent: pct,
      monthlyCommission: money.percent(value, pct),
      paidOut,
      pendingPayout: pending,
    });
  }
  return stats;
}
