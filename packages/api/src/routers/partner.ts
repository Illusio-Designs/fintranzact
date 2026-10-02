import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { controlDb, partners, partnerPayouts, tenants, tenantMembers, userTenantPrefs, users } from "@fintranzact/db";
import { partnerApplicationSchema } from "@fintranzact/shared";
import { getPartnerStats } from "../lib/partner-program.js";
import { CA_ROLES } from "@fintranzact/shared";
import { MANAGED_CLIENTS_LIMIT, toManagedClients } from "../lib/partner-ca.js";
import { getPlanCatalog } from "../lib/plan-catalog.js";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { logger } from "../lib/logger.js";

/**
 * The partner record for a signed-in user: the newest application made with
 * their email. Until the email is verified (which approval does) only a
 * pending or rejected application is returned, and the portal shows its
 * status without the company's details, so registering someone else's
 * address never shows their partner account.
 */
async function partnerForUser(userId: string) {
  const [user] = await controlDb
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { user: null, partner: null };
  const email = user.email.trim().toLowerCase();
  const rows = await controlDb.select().from(partners).where(eq(partners.email, email)).orderBy(desc(partners.createdAt));
  // An approved record wins over an older or newer rejected / pending one.
  const partner = rows.find((r) => r.status === "approved") ?? rows[0] ?? null;
  if (!user.emailVerified && partner?.status === "approved") return { user, partner: null };
  return { user, partner };
}

/**
 * Public side of the partner programme: the "Become a partner" form and the
 * directory of approved partners, and the signed-in partner portal.
 * Reviewing applications is in
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

  /** Whether the signed-in user is a partner (shows the "Partner portal" link). */
  me: protectedProcedure.query(async ({ ctx }) => {
    const { partner } = await partnerForUser(ctx.user.id);
    return { status: (partner?.status as "pending" | "approved" | "rejected" | undefined) ?? null };
  }),

  /** The signed-in partner's own portal: application status, or code, badge, referrals and payouts. */
  portal: protectedProcedure.query(async ({ ctx }) => {
    const { user, partner } = await partnerForUser(ctx.user.id);
    if (!user) return { kind: "none" as const, email: ctx.user.email, emailVerified: false };
    if (!partner) return { kind: "none" as const, email: user.email, emailVerified: user.emailVerified };

    if (partner.status !== "approved" || !partner.referralCode) {
      return {
        kind: "application" as const,
        email: user.email,
        companyName: user.emailVerified ? partner.companyName : null,
        status: partner.status as "pending" | "approved" | "rejected",
        appliedAt: partner.createdAt.toISOString(),
      };
    }

    const [stats, referred, payouts, catalog] = await Promise.all([
      getPartnerStats([partner]),
      controlDb
        .select({ name: tenants.name, plan: tenants.plan, status: tenants.status, createdAt: tenants.createdAt })
        .from(tenants)
        .where(eq(tenants.partnerId, partner.id))
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
        .where(eq(partnerPayouts.partnerId, partner.id))
        .orderBy(desc(partnerPayouts.period)),
      getPlanCatalog(),
    ]);
    const plans = new Map<string, (typeof catalog)[number]>(catalog.map((p) => [p.id, p]));
    const st = stats.get(partner.id)!;

    // Clients you manage (accountant partners): organisations where THIS login holds a CA role.
    // Who/when/plan only, never financial data. Latest 100 (one extra row tells "more").
    let managedClients: ReturnType<typeof toManagedClients> | null = null;
    let managedClientsMore = false;
    if (partner.partnerType === "accountant") {
      const rows = await controlDb
        .select({
          tenantId: tenants.id,
          name: tenants.name,
          plan: tenants.plan,
          role: tenantMembers.role,
          acceptedAt: tenantMembers.acceptedAt,
          createdAt: tenantMembers.createdAt,
          lastOpenedAt: userTenantPrefs.lastOpenedAt,
        })
        .from(tenantMembers)
        .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
        .leftJoin(userTenantPrefs, and(eq(userTenantPrefs.tenantId, tenantMembers.tenantId), eq(userTenantPrefs.userId, tenantMembers.userId)))
        .where(and(
          eq(tenantMembers.userId, ctx.user.id),
          inArray(tenantMembers.role, [...CA_ROLES]),
          eq(tenants.status, "active"),
        ))
        .orderBy(desc(tenantMembers.createdAt))
        .limit(MANAGED_CLIENTS_LIMIT + 1);
      managedClientsMore = rows.length > MANAGED_CLIENTS_LIMIT;
      managedClients = toManagedClients(
        rows.slice(0, MANAGED_CLIENTS_LIMIT).map((r) => ({ ...r, since: r.acceptedAt ?? r.createdAt })),
        (plan) => plans.get(plan)?.name ?? plan,
      );
    }
    return {
      kind: "partner" as const,
      email: user.email,
      companyName: partner.companyName,
      contactName: partner.contactName,
      partnerType: partner.partnerType,
      city: partner.city,
      state: partner.state,
      website: partner.website,
      phone: partner.phone,
      listPublicly: partner.listPublicly,
      approvedAt: partner.reviewedAt?.toISOString() ?? null,
      referralCode: partner.referralCode,
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
      /** null unless the partner type is accountant. */
      managedClients,
      managedClientsMore,
    };
  }),
});
