import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { controlDb, partners, partnerPayouts, tenants } from "@fintranzact/db";
import { normalizeReferralCode, partnerApplicationSchema, partnerStatusLookupSchema } from "@fintranzact/shared";
import { getPartnerStats } from "../lib/partner-program.js";
import { getPlanCatalog } from "../lib/plan-catalog.js";
import { router, publicProcedure } from "../trpc.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { logger } from "../lib/logger.js";

/**
 * Public side of the partner programme: the "Become a partner" form and the
 * directory of approved partners, and the page where a partner checks their
 * status. Reviewing applications is in
 * platform.partners / platform.updatePartner (platform admins only).
 */
export const partnerRouter = router({
  submitApplication: publicProcedure.input(partnerApplicationSchema).mutation(async ({ input, ctx }) => {
    if (process.env.TURNSTILE_SECRET_KEY) {
      const ok = input.turnstileToken
        ? await verifyTurnstile(input.turnstileToken, ctx.ipAddress)
        : false;
      if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
    }

    const [pending] = await controlDb
      .select({ id: partners.id })
      .from(partners)
      .where(and(eq(partners.email, input.email), eq(partners.status, "pending")))
      .limit(1);
    if (pending) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "We already have an application from this email. We'll be in touch soon.",
      });
    }

    const { turnstileToken: _token, ...application } = input;
    const [row] = await controlDb.insert(partners).values(application).returning({ id: partners.id });
    logger.info({ partnerId: row?.id, partnerType: input.partnerType }, "Partner application received");
    return { received: true };
  }),

  /** Approved partners who agreed to be listed, with their badge. Contact details stay private. */
  directory: publicProcedure.query(async () => {
    const rows = await controlDb
      .select({
        commissionPercent: partners.commissionPercent,
        id: partners.id,
        companyName: partners.companyName,
        city: partners.city,
        state: partners.state,
        website: partners.website,
        partnerType: partners.partnerType,
      })
      .from(partners)
      .where(and(eq(partners.status, "approved"), eq(partners.listPublicly, true)))
      .orderBy(asc(partners.companyName));
    const stats = await getPartnerStats(rows);
    return rows.map(({ commissionPercent: _c, ...p }) => ({ ...p, badge: stats.get(p.id)!.badge.id }));
  }),

  /**
   * "Check partner status": with the email they applied with and their
   * referral code, a partner sees their badge, referrals and payouts. With
   * their phone number instead, only whether the application is approved.
   * Wrong details get the same answer whether or not the email exists.
   */
  checkStatus: publicProcedure.input(partnerStatusLookupSchema).mutation(async ({ input, ctx }) => {
    if (process.env.TURNSTILE_SECRET_KEY) {
      const ok = input.turnstileToken ? await verifyTurnstile(input.turnstileToken, ctx.ipAddress) : false;
      if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
    }
    const notFound = () =>
      new TRPCError({ code: "NOT_FOUND", message: "We couldn't find a partner with those details. Check them and try again." });

    const rows = await controlDb.select().from(partners).where(eq(partners.email, input.email)).orderBy(desc(partners.createdAt));
    if (rows.length === 0) throw notFound();

    const code = normalizeReferralCode(input.secret);
    const byCode = code ? rows.find((r) => r.referralCode && r.referralCode === code && r.status === "approved") : undefined;
    if (!byCode) {
      const digits = (v: string) => v.replace(/\D/g, "").slice(-10);
      const byPhone = rows.find((r) => digits(r.phone).length >= 8 && digits(r.phone) === digits(input.secret));
      if (!byPhone) throw notFound();
      return {
        kind: "application" as const,
        companyName: byPhone.companyName,
        status: byPhone.status as "pending" | "approved" | "rejected",
        appliedAt: byPhone.createdAt.toISOString(),
      };
    }

    const [stats, referred, payouts, catalog] = await Promise.all([
      getPartnerStats([byCode]),
      controlDb
        .select({ name: tenants.name, plan: tenants.plan, status: tenants.status, createdAt: tenants.createdAt })
        .from(tenants)
        .where(eq(tenants.partnerId, byCode.id))
        .orderBy(desc(tenants.createdAt)),
      controlDb
        .select({
          period: partnerPayouts.period,
          amount: partnerPayouts.amount,
          status: partnerPayouts.status,
          paidAt: partnerPayouts.paidAt,
          reference: partnerPayouts.reference,
        })
        .from(partnerPayouts)
        .where(eq(partnerPayouts.partnerId, byCode.id))
        .orderBy(desc(partnerPayouts.period)),
      getPlanCatalog(),
    ]);
    const plans = new Map(catalog.map((p) => [p.id, p]));
    const st = stats.get(byCode.id)!;
    return {
      kind: "partner" as const,
      companyName: byCode.companyName,
      contactName: byCode.contactName,
      partnerType: byCode.partnerType,
      referralCode: byCode.referralCode!,
      stats: {
        referred: st.referred,
        paidReferrals: st.paidReferrals,
        customPriced: st.customPriced,
        monthlyValue: st.monthlyValue,
        commissionPercent: st.commissionPercent,
        monthlyCommission: st.monthlyCommission,
        paidOut: st.paidOut,
        pendingPayout: st.pendingPayout,
        badge: st.badge.id,
        next: st.next ? { badge: st.next.badge.id, needed: st.next.needed } : null,
      },
      referred: referred.map((t) => ({
        name: t.name,
        planName: plans.get(t.plan)?.name ?? t.plan,
        paid: (plans.get(t.plan)?.monthlyPriceInr ?? 0) !== 0,
        active: t.status === "active",
        joinedAt: t.createdAt.toISOString(),
      })),
      payouts: payouts.map((p) => ({ ...p, paidAt: p.paidAt?.toISOString() ?? null })),
    };
  }),
});
