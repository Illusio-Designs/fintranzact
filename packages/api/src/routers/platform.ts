import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, gte, ilike, inArray, max, or, sql } from "drizzle-orm";
import { controlDb, getTenantDb, securityEvents, tenants, tenantMembers, users, businesses, planSettings, partners, partnerPayouts, roadmapItems, billingSubscriptions, billingPayments, aiUsage, aiCreditGrants } from "@fintranzact/db";
import { ensureReferralCode, getPartnerStats, payingTenantIds } from "../lib/partner-program.js";
import { emailService } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { ADDONS, ADDON_IDS, AI_PACK_PRICE_INR, aiPriceTableSchema, aiQuotaPeriod, RESET_VERIFICATION_METHODS, SECURITY_EVENT_TYPES, PLAN_DEFAULTS, planIdSchema, planSettingsWarnings, effectiveYearlyPriceInr, SUBSCRIPTION_STATUSES, YEARLY_CYCLE_MONTHS, limitsToStored, partnerStatuses, planSettingsSchema, partnerTypes, partnerPayoutStatuses, payoutPeriodSchema, trialSettingsSchema, trialDaysLeftAt, TRIAL_ADMIN_MAX_DAYS } from "@fintranzact/shared";
import {
  roadmapStatuses,
  roadmapListSchema,
  roadmapCreateSchema,
  roadmapUpdateSchema,
  roadmapDeleteSchema,
  roadmapReorderSchema,
  roadmapLaunchStages,
  type RoadmapStatus,
  type RoadmapLaunchStage,
  type RoadmapPriority,
  type RoadmapBilling,
} from "@fintranzact/shared";
import { getPlanCatalog, invalidatePlanCatalog } from "../lib/plan-catalog.js";
import { supportBadges } from "../lib/support-badges.js";
import { router, protectedProcedure } from "../trpc.js";
import { escapeLike } from "../lib/escape-like.js";
import { ensureRoadmapSeeded } from "../lib/roadmap.js";
import { isPlatformAdmin } from "../lib/platform-admin.js";
import { sandboxQuotaStatus, tenantsWithUnbilledUsage, periodIsClosed } from "../lib/gov-usage.js";
import { getHsnRefreshState } from "../lib/hsn-refresh.js";
import { closeGovUsagePeriod } from "../lib/billing/service.js";
import { invalidateEntitlements } from "../lib/entitlements-cache.js";
import { endTrialNow, extendTrial, grantCustomTrial, setTrial } from "../lib/trial.js";
import { getTrialSettings, saveTrialSettings } from "../lib/trial-settings.js";
import { getAiPrices, saveAiPrices } from "../lib/ai/settings.js";
import { grantCredits } from "../lib/ai/quota.js";
import { resolveAiModels } from "../lib/ai/model-router.js";
import { recordBillingEvent } from "../lib/billing/service.js";
import { getEntitlements } from "../lib/entitlements.js";
import { getAddonPrices, saveAddonPrices } from "../lib/billing/addon-prices.js";
import { grantAddonByAdmin, revokeAddonGrant } from "../lib/billing/addon-service.js";
import { listPackPurchases } from "../lib/billing/ai-packs.js";
import { resetTwoFactorByAdmin } from "../lib/two-factor-reset.js";
import { drizzleResetStore } from "../lib/two-factor-store.js";
import { invalidateTwoFactorGateUser } from "../lib/two-factor-gate-cache.js";
import { rotateSessionsOnPrivilegeEvent } from "../lib/session-rotation.js";
import { recordSecurityEvent } from "../lib/security-events.js";
import { ADMIN_EVENTS_DEFAULT_LIMIT, MAX_ACTIVITY_LIMIT, clampLimit, eventLabel } from "../lib/security-activity.js";

/**
 * Platform admin: every organisation on this server, and the plan each is on.
 * Who is an admin is set by environment variables (see lib/platform-admin.ts).
 * Nothing here shows or changes a business's books (invoices, payments…).
 */
const platformAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await isPlatformAdmin(ctx.user.id))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin access only" });
  }
  return next();
});

const OWNER_ROLES = ["owner", "superadmin"] as const;

/** Numbers as the admin console edits them: Infinity is sent as null. */
function planForAdmin(plan: Awaited<ReturnType<typeof getPlanCatalog>>[number], orgCount: number, grandfatheredCount = 0) {
  return {
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    monthlyPriceInr: plan.monthlyPriceInr,
    /** What was set; null means "ten months of the monthly price". */
    yearlyPriceInr: plan.yearlyPriceInr,
    /** What a yearly subscriber is charged (before GST). */
    effectiveYearlyPriceInr: effectiveYearlyPriceInr(plan),
    features: plan.features,
    highlight: !!plan.highlight,
    visible: plan.visible,
    limits: limitsToStored(plan.limits),
    edited: plan.edited,
    updatedAt: plan.updatedAt,
    orgCount,
    /** Of orgCount, the organisations with permanent full access (former Forever Free). */
    grandfatheredCount,
  };
}

export const platformRouter = router({
  /** Whether the signed-in user is a platform admin (shows or hides the admin link). */
  me: protectedProcedure.query(async ({ ctx }) => ({
    isPlatformAdmin: await isPlatformAdmin(ctx.user.id),
  })),

  /** Headline numbers across the whole platform. */
  overview: platformAdminProcedure.query(async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [[tenantTotal], [userTotal], [newTenants], byPlan, byStatus] = await Promise.all([
      controlDb.select({ n: count() }).from(tenants),
      controlDb.select({ n: count() }).from(users),
      controlDb.select({ n: count() }).from(tenants).where(gte(tenants.createdAt, since)),
      controlDb.select({ plan: tenants.plan, n: count() }).from(tenants).groupBy(tenants.plan),
      controlDb.select({ status: tenants.status, n: count() }).from(tenants).groupBy(tenants.status),
    ]);
    return {
      tenants: tenantTotal?.n ?? 0,
      users: userTotal?.n ?? 0,
      tenantsLast30Days: newTenants?.n ?? 0,
      byPlan: byPlan.map((r) => ({ plan: r.plan, count: r.n })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: r.n })),
    };
  }),

  /** Every organisation with its owner and member count, newest first. */
  tenants: platformAdminProcedure
    .input(z.object({
      search: z.string().trim().max(100).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(25),
    }).default({}))
    .query(async ({ input }) => {
      const term = input.search ? `%${escapeLike(input.search)}%` : null;
      // Match the organisation's name/slug or any member's name/email.
      const where = term
        ? or(
            ilike(tenants.name, term),
            ilike(tenants.slug, term),
            // Written out in full: inside a subquery Drizzle renders
            // ${tenants.id} as a bare "id", which would bind to the member row.
            sql`EXISTS (SELECT 1 FROM tenant_members tm JOIN users u ON u.id = tm.user_id
                        WHERE tm.tenant_id = "tenants"."id" AND (u.email ILIKE ${term} OR u.name ILIKE ${term}))`,
          )
        : undefined;

      const [rows, [total]] = await Promise.all([
        controlDb
          .select({
            id: tenants.id,
            name: tenants.name,
            slug: tenants.slug,
            plan: tenants.plan,
            accessGrandfathered: tenants.accessGrandfathered,
            status: tenants.status,
            createdAt: tenants.createdAt,
            trialStartedAt: tenants.trialStartedAt,
            trialEndsAt: tenants.trialEndsAt,
            trialSource: tenants.trialSource,
            memberCount: sql<number>`(SELECT COUNT(*)::int FROM tenant_members tm WHERE tm.tenant_id = "tenants"."id")`,
          })
          .from(tenants)
          .where(where)
          .orderBy(desc(tenants.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit),
        controlDb.select({ n: count() }).from(tenants).where(where),
      ]);

      const ids = rows.map((r) => r.id);
      const owners = ids.length
        ? await controlDb
            .select({ tenantId: tenantMembers.tenantId, name: users.name, email: users.email })
            .from(tenantMembers)
            .innerJoin(users, eq(users.id, tenantMembers.userId))
            .where(and(inArray(tenantMembers.tenantId, ids), inArray(tenantMembers.role, [...OWNER_ROLES])))
            .orderBy(tenantMembers.createdAt)
        : [];
      const ownerOf = new Map<string, { name: string | null; email: string }>();
      for (const o of owners) if (!ownerOf.has(o.tenantId)) ownerOf.set(o.tenantId, { name: o.name, email: o.email });

      // Support badges from the plan's operational flags (priority support, onboarding help).
      const supportOf = new Map(await Promise.all(rows.map(async (r) => [r.id, await supportBadges(r.id)] as const)));

      const now = new Date();
      return {
        data: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          trialStartedAt: r.trialStartedAt?.toISOString() ?? null,
          trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
          trialDaysLeft: trialDaysLeftAt(r.trialEndsAt, now),
          owner: ownerOf.get(r.id) ?? null,
          support: supportOf.get(r.id)!,
        })),
        total: total?.n ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

  /** One organisation: its members and its businesses. */
  tenant: platformAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [tenant] = await controlDb
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          plan: tenants.plan,
          accessGrandfathered: tenants.accessGrandfathered,
          status: tenants.status,
          partnerId: tenants.partnerId,
          createdAt: tenants.createdAt,
          trialStartedAt: tenants.trialStartedAt,
          trialEndsAt: tenants.trialEndsAt,
          trialSource: tenants.trialSource,
          // So the admin can see the organisation's two-factor policy.
          twoFactorPolicy: tenants.twoFactorPolicy,
          twoFactorGraceDays: tenants.twoFactorGraceDays,
        })
        .from(tenants)
        .where(eq(tenants.id, input.id))
        .limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });

      const members = await controlDb
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          twoFactorEnabled: users.twoFactorEnabled,
          role: tenantMembers.role,
          joinedAt: tenantMembers.createdAt,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(eq(tenantMembers.tenantId, input.id))
        .orderBy(tenantMembers.createdAt);

      // Businesses live in the tenant's database (the shared one when
      // self-hosted); scoping by creator keeps other tenants' rows out.
      const memberIds = members.map((m) => m.userId);
      const businessRows = memberIds.length
        ? await (await getTenantDb(input.id))
            .select({
              id: businesses.id,
              name: businesses.name,
              gstin: businesses.gstin,
              city: businesses.city,
              createdAt: businesses.createdAt,
            })
            .from(businesses)
            .where(inArray(businesses.createdByUserId, memberIds))
            .orderBy(businesses.createdAt)
        : [];

      const [referredBy] = tenant.partnerId
        ? await controlDb
            .select({ id: partners.id, companyName: partners.companyName, referralCode: partners.referralCode })
            .from(partners)
            .where(eq(partners.id, tenant.partnerId))
            .limit(1)
        : [];

      const ent = await getEntitlements(input.id);
      return {
        ...tenant,
        referredBy: referredBy ?? null,
        support: await supportBadges(input.id),
        createdAt: tenant.createdAt.toISOString(),
        trialStartedAt: tenant.trialStartedAt?.toISOString() ?? null,
        trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
        /** The live access state (trialing, trial_expired, active, ...) and trial block, as the organisation sees it. */
        accessState: ent.state,
        trial: {
          active: ent.trial.active,
          ended: ent.trial.ended,
          daysLeft: ent.trial.daysLeft,
          source: ent.trial.source,
          totalDays: ent.trial.totalDays,
        },
        members: members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
        businesses: businessRows.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
      };
    }),

  /** Put an organisation on a plan. Paid plans are set up here, not by owners. */
  setPlan: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), plan: planIdSchema }))
    .mutation(async ({ input }) => {
      const [row] = await controlDb
        .update(tenants)
        .set({ plan: input.plan, updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId))
        .returning({ id: tenants.id, plan: tenants.plan });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });
      invalidateEntitlements(input.tenantId);
      return row;
    }),

  /**
   * Set (or clear, with null) an organisation's trial end. Past it, with no
   * live plan subscription, the organisation is read-only until it picks a plan.
   * Recorded in the billing event log with the acting admin.
   */
  setTrial: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), endsAt: z.coerce.date().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const row = await setTrial(input.tenantId, input.endsAt, { actorUserId: ctx.user.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });
      return row;
    }),

  /** The trial settings: days, partner days and the add-on caps (system_config trial.*). */
  trialSettings: platformAdminProcedure.query(() => getTrialSettings()),

  /**
   * Save the trial settings. Days are 1 to 90; caps are whole numbers.
   * Applies to organisations that sign up from now on; running trials keep
   * their dates. Recorded in the billing event log with the acting admin.
   */
  saveTrialSettings: platformAdminProcedure.input(trialSettingsSchema).mutation(async ({ input, ctx }) => {
    const before = await getTrialSettings();
    await saveTrialSettings(input);
    await recordBillingEvent({
      provider: "local",
      type: "platform.trial_settings_changed",
      payload: { from: before, to: input, actorUserId: ctx.user.id },
    });
    return input;
  }),

  // ── AI assistant: usage, cost and extra packs ──────────────────────────────

  /**
   * AI questions, tokens and the estimated cost per organisation for one IST
   * month (default: this month), highest cost first. A question given back to
   * the customer (provider failure) is counted separately and its tokens still
   * count towards cost, because the provider charged for them.
   */
  aiUsage: platformAdminProcedure
    .input(z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM").optional() }).optional())
    .query(async ({ input }) => {
      const period = input?.period ?? aiQuotaPeriod(new Date());
      const [rows, periods] = await Promise.all([
        controlDb
          .select({
            tenantId: aiUsage.tenantId,
            name: tenants.name,
            plan: tenants.plan,
            questions: sql<number>`count(*) filter (where ${aiUsage.status} in ('ok', 'aborted'))::int`,
            refunded: sql<number>`count(*) filter (where ${aiUsage.status} = 'refunded')::int`,
            inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.cacheReadTokens} + ${aiUsage.cacheWriteTokens}), 0)::bigint`,
            outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::bigint`,
            costPaise: sql<number>`coalesce(sum(${aiUsage.costPaise}), 0)::bigint`,
            lastAt: sql<Date | null>`max(${aiUsage.createdAt})`,
          })
          .from(aiUsage)
          .innerJoin(tenants, eq(tenants.id, aiUsage.tenantId))
          .where(eq(aiUsage.period, period))
          .groupBy(aiUsage.tenantId, tenants.name, tenants.plan)
          .orderBy(desc(sql`coalesce(sum(${aiUsage.costPaise}), 0)`)),
        controlDb.selectDistinct({ period: aiUsage.period }).from(aiUsage).orderBy(desc(aiUsage.period)).limit(24),
      ]);
      const organisations = rows.map((r) => ({
        tenantId: r.tenantId,
        name: r.name,
        plan: r.plan,
        questions: Number(r.questions),
        refunded: Number(r.refunded),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        costPaise: Number(r.costPaise),
        lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
      }));
      return {
        period,
        periods: periods.map((p) => p.period),
        organisations,
        totals: organisations.reduce(
          (t, o) => ({ questions: t.questions + o.questions, inputTokens: t.inputTokens + o.inputTokens, outputTokens: t.outputTokens + o.outputTokens, costPaise: t.costPaise + o.costPaise }),
          { questions: 0, inputTokens: 0, outputTokens: 0, costPaise: 0 },
        ),
      };
    }),

  /** The price table (paise per million tokens) the cost estimate uses, and the model ids in force. */
  aiPrices: platformAdminProcedure.query(async () => ({ prices: await getAiPrices(), models: resolveAiModels() })),

  /** Save the price table. Applies to questions answered from now on. Recorded in the billing event log with the acting admin. */
  saveAiPrices: platformAdminProcedure.input(aiPriceTableSchema).mutation(async ({ input, ctx }) => {
    const before = await getAiPrices();
    await saveAiPrices(input);
    await recordBillingEvent({ provider: "local", type: "platform.ai_prices_changed", payload: { from: before, to: input, actorUserId: ctx.user.id } });
    return input;
  }),

  /** Extra question packs of one organisation: what was granted and what is left. */
  aiCredits: platformAdminProcedure.input(z.object({ tenantId: z.string().uuid() })).query(async ({ input }) => {
    const grants = await controlDb.select().from(aiCreditGrants).where(eq(aiCreditGrants.tenantId, input.tenantId)).orderBy(desc(aiCreditGrants.createdAt)).limit(50);
    return {
      grants: grants.map((g) => ({ id: g.id, credits: g.credits, used: g.used, source: g.source, reason: g.reason, createdAt: g.createdAt.toISOString() })),
      remaining: grants.reduce((n, g) => n + (g.credits - g.used), 0),
    };
  }),

  /** Grant extra AI questions (one or more packs of 100) to an organisation, with a reason. The purchase flow is a separate piece of work. */
  grantAiCredits: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), credits: z.number().int().min(1).max(100_000), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const [tenant] = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });
      const grant = await grantCredits({ tenantId: input.tenantId, credits: input.credits, reason: input.reason, grantedByUserId: ctx.user.id });
      await recordBillingEvent({ provider: "local", tenantId: input.tenantId, type: "platform.ai_credits_granted", payload: { grantId: grant.id, credits: input.credits, reason: input.reason, actorUserId: ctx.user.id } });
      return { id: grant.id, credits: grant.credits };
    }),

  /** Add days to an organisation trial (from its end when running, from now when over). */
  /**
   * The add-on price table: the price in force next to the built-in one, for every add-on and the
   * extra AI pack. An entry the admin never edited shows the built-in price with `edited: false`.
   */
  addonPrices: platformAdminProcedure.query(async () => {
    const o = await getAddonPrices();
    return {
      addons: ADDONS.map((a) => ({
        id: a.id,
        name: a.name,
        builtInMonthlyPriceInr: a.monthlyPriceInr,
        monthlyPriceInr: o.addons[a.id]?.monthlyPriceInr ?? a.monthlyPriceInr,
        yearlyPriceInr: o.addons[a.id]?.yearlyPriceInr ?? null,
        edited: !!o.addons[a.id],
      })),
      aiPack: { builtInPriceInr: AI_PACK_PRICE_INR, priceInr: o.aiPackPriceInr ?? AI_PACK_PRICE_INR, edited: o.aiPackPriceInr !== null },
    };
  }),

  /**
   * Save the add-on prices (ex-GST rupees; an empty yearly price means ten months, "2 months free").
   * An add-on left out of `addons` goes back to its built-in price. Applies to new purchases only.
   * Recorded in the billing event log with the acting admin.
   */
  saveAddonPrices: platformAdminProcedure
    .input(z.object({
      addons: z.record(z.enum(ADDON_IDS), z.object({
        monthlyPriceInr: z.number().int().min(1).max(1_000_000),
        yearlyPriceInr: z.number().int().min(1).max(1_000_000).nullable(),
      })),
      aiPackPriceInr: z.number().int().min(1).max(1_000_000).nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await getAddonPrices();
      await saveAddonPrices({ addons: input.addons, aiPackPriceInr: input.aiPackPriceInr });
      await recordBillingEvent({ provider: "local", type: "platform.addon_prices_changed", payload: { from: before, to: input, actorUserId: ctx.user.id } });
      return { ok: true };
    }),

  /** Give an add-on free to an organisation (it runs until revoked, is never billed). Another tier of the same add-on must be removed first. */
  grantAddon: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), addon: z.enum(ADDON_IDS), reason: z.string().trim().min(3).max(300) }))
    .mutation(async ({ input, ctx }) => grantAddonByAdmin({ ...input, actorUserId: ctx.user.id })),

  /** Take back an add-on an admin granted. A paid subscription is not touched. */
  revokeAddon: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), addon: z.enum(ADDON_IDS) }))
    .mutation(async ({ input, ctx }) => {
      await revokeAddonGrant({ ...input, actorUserId: ctx.user.id });
      return { ok: true };
    }),

  /** An organisation's extra-question purchases: orders, credits bought, what is left, and the GST invoice of each. */
  aiPurchases: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .query(async ({ input }) => {
      const subs = await controlDb
        .select({
          id: billingSubscriptions.id,
          addon: billingSubscriptions.addon,
          status: billingSubscriptions.status,
          provider: billingSubscriptions.provider,
          cycle: billingSubscriptions.cycle,
          basePaise: billingSubscriptions.basePaise,
          currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
          graceUntil: billingSubscriptions.graceUntil,
        })
        .from(billingSubscriptions)
        .where(and(eq(billingSubscriptions.tenantId, input.tenantId), eq(billingSubscriptions.kind, "addon"), inArray(billingSubscriptions.status, ["active", "past_due", "halted"])));
      return {
        purchases: await listPackPurchases(input.tenantId, 50),
        /** The live add-on subscriptions (a row with provider "admin" is a free grant). */
        addons: subs.map((r) => ({ ...r, currentPeriodEnd: r.currentPeriodEnd?.toISOString() ?? null, graceUntil: r.graceUntil?.toISOString() ?? null })),
      };
    }),

  extendTrial: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), days: z.number().int().min(1).max(TRIAL_ADMIN_MAX_DAYS), reason: z.string().trim().min(3).max(500) }))
    .mutation(({ input, ctx }) => extendTrial(input.tenantId, input.days, { actorUserId: ctx.user.id, reason: input.reason })),

  /** Give an organisation a custom trial of N days from now (allowed even if a trial was already used). */
  grantTrial: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), days: z.number().int().min(1).max(TRIAL_ADMIN_MAX_DAYS), reason: z.string().trim().min(3).max(500) }))
    .mutation(({ input, ctx }) => grantCustomTrial(input.tenantId, input.days, { actorUserId: ctx.user.id, reason: input.reason })),

  /** End a running trial now; the organisation is read-only until it buys a plan. */
  endTrial: platformAdminProcedure
    .input(z.object({ tenantId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }))
    .mutation(({ input, ctx }) => endTrialNow(input.tenantId, { actorUserId: ctx.user.id, reason: input.reason })),

  /**
   * Reset a user's two-factor authentication after an identity check
   * (docs/TWO-FACTOR.md). Revokes every session, forgets trusted devices,
   * emails the user and records `2fa.reset_by_admin`. Never your own.
   */
  resetTwoFactor: platformAdminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        tenantId: z.string().uuid().optional(),
        confirmEmail: z.string().min(1).max(320),
        verification: z.object({
          method: z.enum(RESET_VERIFICATION_METHODS),
          checks: z.array(z.string().max(60)).max(20),
          reference: z.string().max(120).optional(),
          reason: z.string().max(1000),
        }),
      }),
    )
    .mutation(({ input, ctx }) =>
      resetTwoFactorByAdmin(
        {
          store: drizzleResetStore,
          revokeAllSessions: (userId) => rotateSessionsOnPrivilegeEvent(userId),
          invalidateGate: invalidateTwoFactorGateUser,
          record: recordSecurityEvent,
          sendNotice: (to, subject, text) => emailService.sendNotice(to, subject, text),
          log: { error: (msg, meta) => logger.error(meta ?? {}, msg) },
          now: () => new Date(),
        },
        { adminUserId: ctx.user.id, input, ip: ctx.ipAddress ?? null, userAgent: ctx.req.headers.get("user-agent") },
      ),
    ),

  /**
   * The security trail, newest first. With `tenantId`: events recorded for that
   * organisation plus events about its members. `cursor` is the `nextCursor`
   * of the previous page.
   */
  securityEvents: platformAdminProcedure
    .input(
      z
        .object({
          userId: z.string().uuid().optional(),
          tenantId: z.string().uuid().optional(),
          type: z.enum(SECURITY_EVENT_TYPES).optional(),
          limit: z.number().int().optional(),
          cursor: z.string().datetime().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const limit = clampLimit(input?.limit, ADMIN_EVENTS_DEFAULT_LIMIT, MAX_ACTIVITY_LIMIT);
      const conds = [];
      if (input?.userId) conds.push(eq(securityEvents.userId, input.userId));
      if (input?.type) conds.push(eq(securityEvents.type, input.type));
      if (input?.tenantId) {
        conds.push(
          or(
            eq(securityEvents.tenantId, input.tenantId),
            sql`${securityEvents.userId} IN (SELECT user_id FROM tenant_members WHERE tenant_id = ${input.tenantId})`,
          )!,
        );
      }
      if (input?.cursor) conds.push(sql`${securityEvents.createdAt} < ${input.cursor}::timestamptz`);
      const rows = await controlDb
        .select()
        .from(securityEvents)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(securityEvents.createdAt))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const ids = [...new Set(page.flatMap((r) => [r.userId, r.actorUserId]).filter((x): x is string => !!x))];
      const people = ids.length
        ? await controlDb.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids))
        : [];
      const byId = new Map(people.map((p) => [p.id, p]));
      return {
        items: page.map((r) => ({
          id: r.id,
          type: r.type,
          label: eventLabel(r.type),
          createdAt: r.createdAt.toISOString(),
          ip: r.ip,
          userAgent: r.userAgent,
          tenantId: r.tenantId,
          metadata: (r.metadata ?? null) as Record<string, unknown> | null,
          user: r.userId ? (byId.get(r.userId) ?? { id: r.userId, name: null, email: null }) : null,
          actor: r.actorUserId ? (byId.get(r.actorUserId) ?? { id: r.actorUserId, name: null, email: null }) : null,
        })),
        nextCursor: rows.length > limit ? page[page.length - 1]!.createdAt.toISOString() : null,
      };
    }),

  // ── Plans ────────────────────────────────────────────────────

  /** Every plan as it is now, with how many organisations are on it. */
  plans: platformAdminProcedure.query(async () => {
    const [catalog, counts, grandfathered] = await Promise.all([
      getPlanCatalog(),
      controlDb.select({ plan: tenants.plan, n: count() }).from(tenants).groupBy(tenants.plan),
      controlDb.select({ plan: tenants.plan, n: count() }).from(tenants).where(eq(tenants.accessGrandfathered, true)).groupBy(tenants.plan),
    ]);
    const countOf = new Map(counts.map((c) => [c.plan, c.n]));
    const grandfatheredOf = new Map(grandfathered.map((c) => [c.plan, c.n]));
    return catalog.map((plan) => planForAdmin(plan, countOf.get(plan.id) ?? 0, grandfatheredOf.get(plan.id) ?? 0));
  }),

  /** Change a plan's name, price, features, visibility or limits. */
  savePlan: platformAdminProcedure
    .input(z.object({ plan: planIdSchema, settings: planSettingsSchema }))
    .mutation(async ({ input, ctx }) => {
      const { settings } = input;
      const values = {
        name: settings.name,
        tagline: settings.tagline,
        monthlyPriceInr: settings.monthlyPriceInr,
        yearlyPriceInr: settings.yearlyPriceInr,
        features: settings.features,
        highlight: settings.highlight,
        visible: settings.visible,
        limits: settings.limits,
        updatedAt: new Date(),
        updatedByUserId: ctx.user.id,
      };
      await controlDb
        .insert(planSettings)
        .values({ plan: input.plan, ...values })
        .onConflictDoUpdate({ target: planSettings.plan, set: values });
      invalidatePlanCatalog();
      const plan = (await getPlanCatalog()).find((p) => p.id === input.plan)!;
      // Prices are validated by the schema (whole rupees, never negative). A
      // yearly price above 12 months of the monthly one is allowed but flagged.
      return { ...planForAdmin(plan, 0), warnings: planSettingsWarnings(settings) };
    }),

  /** Undo every edit to a plan and go back to its built-in definition. */
  resetPlan: platformAdminProcedure
    .input(z.object({ plan: planIdSchema }))
    .mutation(async ({ input }) => {
      await controlDb.delete(planSettings).where(eq(planSettings.plan, input.plan));
      invalidatePlanCatalog();
      return { plan: input.plan, name: PLAN_DEFAULTS[input.plan].name };
    }),

  // ── Subscriptions (billing) ──────────────────────────────────

  /** Every subscription with its organisation, status and next renewal. */
  subscriptions: platformAdminProcedure
    .input(z.object({
      status: z.enum(SUBSCRIPTION_STATUSES).optional(),
      search: z.string().trim().max(100).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(25),
    }).default({}))
    .query(async ({ input }) => {
      const term = input.search ? `%${escapeLike(input.search)}%` : null;
      const where = and(
        input.status ? eq(billingSubscriptions.status, input.status) : undefined,
        term ? or(ilike(tenants.name, term), ilike(tenants.slug, term)) : undefined,
      );

      const [rows, [total], failedRows] = await Promise.all([
        controlDb
          .select({
            id: billingSubscriptions.id,
            tenantId: billingSubscriptions.tenantId,
            tenantName: tenants.name,
            kind: billingSubscriptions.kind,
            plan: billingSubscriptions.plan,
            addon: billingSubscriptions.addon,
            cycle: billingSubscriptions.cycle,
            status: billingSubscriptions.status,
            provider: billingSubscriptions.provider,
            basePaise: billingSubscriptions.basePaise,
            currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
            cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd,
            scheduledPlan: billingSubscriptions.scheduledPlan,
            graceUntil: billingSubscriptions.graceUntil,
            createdAt: billingSubscriptions.createdAt,
          })
          .from(billingSubscriptions)
          .innerJoin(tenants, eq(tenants.id, billingSubscriptions.tenantId))
          .where(where)
          .orderBy(desc(billingSubscriptions.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit),
        controlDb
          .select({ n: count() })
          .from(billingSubscriptions)
          .innerJoin(tenants, eq(tenants.id, billingSubscriptions.tenantId))
          .where(where),
        // Failed charges in the last 30 days, per subscription.
        controlDb
          .select({ subscriptionId: billingPayments.subscriptionId, n: count() })
          .from(billingPayments)
          .where(and(
            eq(billingPayments.status, "failed"),
            gte(billingPayments.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
          ))
          .groupBy(billingPayments.subscriptionId),
      ]);
      const failedOf = new Map(failedRows.map((r) => [r.subscriptionId, r.n]));
      return {
        subscriptions: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          currentPeriodEnd: r.currentPeriodEnd?.toISOString() ?? null,
          graceUntil: r.graceUntil?.toISOString() ?? null,
          failedPayments30d: failedOf.get(r.id) ?? 0,
        })),
        total: total?.n ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

  /** MRR and the plan / add-on mix across live subscriptions. */
  billingSummary: platformAdminProcedure.query(async () => {
    const live = await controlDb
      .select({
        kind: billingSubscriptions.kind,
        plan: billingSubscriptions.plan,
        addon: billingSubscriptions.addon,
        cycle: billingSubscriptions.cycle,
        status: billingSubscriptions.status,
        basePaise: billingSubscriptions.basePaise,
      })
      .from(billingSubscriptions)
      .where(inArray(billingSubscriptions.status, ["active", "past_due"]));

    // MRR = each live subscription's base price per month (yearly spreads
    // over the 10 paid months of its cycle → the real money per month).
    const monthlyOf = (s: (typeof live)[number]) =>
      s.cycle === "yearly" ? Math.round(s.basePaise / YEARLY_CYCLE_MONTHS) : s.basePaise;
    const mrrPaise = live.reduce((sum, s) => sum + monthlyOf(s), 0);

    const mix = new Map<string, { label: string; kind: string; count: number; mrrPaise: number }>();
    for (const s of live) {
      const key = s.kind === "plan" ? `plan:${s.plan}` : `addon:${s.addon}`;
      const entry = mix.get(key) ?? { label: s.kind === "plan" ? (s.plan ?? "?") : (s.addon ?? "?"), kind: s.kind, count: 0, mrrPaise: 0 };
      entry.count += 1;
      entry.mrrPaise += monthlyOf(s);
      mix.set(key, entry);
    }

    const [statusCounts, [failed30]] = await Promise.all([
      controlDb
        .select({ status: billingSubscriptions.status, n: count() })
        .from(billingSubscriptions)
        .groupBy(billingSubscriptions.status),
      controlDb
        .select({ n: count() })
        .from(billingPayments)
        .where(and(
          eq(billingPayments.status, "failed"),
          gte(billingPayments.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        )),
    ]);

    return {
      mrrPaise,
      liveCount: live.length,
      mix: [...mix.values()].sort((a, b) => b.mrrPaise - a.mrrPaise),
      byStatus: statusCounts.map((r) => ({ status: r.status, count: r.n })),
      failedPayments30d: failed30?.n ?? 0,
    };
  }),

  // ── Partners ─────────────────────────────────────────────────

  /** Partner applications, newest first, with a count per status. */
  /** Calls used this month against the Sandbox plan quota. */
  sandboxQuota: platformAdminProcedure.query(async () => ({
    ...(await sandboxQuotaStatus()),
    /** Last daily HSN / SAC refresh and any withdrawn codes still used by items; null before the first run. */
    hsnRefresh: await getHsnRefreshState(),
  })),

  /** Month-end: raise the government API usage statement for every tenant with unbilled usage. */
  closeGovUsageMonth: platformAdminProcedure
    .input(z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM") }))
    .mutation(async ({ input }) => {
      if (!periodIsClosed(input.period)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${input.period} has not ended yet, so it cannot be billed.` });
      }
      const tenantIds = await tenantsWithUnbilledUsage(input.period);
      let billed = 0;
      const failed: string[] = [];
      for (const tenantId of tenantIds) {
        try {
          if (await closeGovUsagePeriod(tenantId, input.period)) billed++;
        } catch (err) {
          logger.error({ err, tenantId, period: input.period }, "Could not close government API usage");
          failed.push(tenantId);
        }
      }
      return { period: input.period, tenants: tenantIds.length, billed, failed: failed.length };
    }),

  partners: platformAdminProcedure
    .input(
      z.object({
        status: z.enum(partnerStatuses).optional(),
        search: z.string().trim().max(100).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ input }) => {
      const term = input.search ? `%${escapeLike(input.search)}%` : null;
      const searchFilter = term
        ? or(
            ilike(partners.companyName, term),
            ilike(partners.contactName, term),
            ilike(partners.email, term),
            ilike(partners.city, term),
          )
        : undefined;
      const where = and(input.status ? eq(partners.status, input.status) : undefined, searchFilter);
      const [rows, [total], byStatus] = await Promise.all([
        controlDb
          .select()
          .from(partners)
          .where(where)
          .orderBy(desc(partners.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit),
        controlDb.select({ n: count() }).from(partners).where(where),
        controlDb.select({ status: partners.status, n: count() }).from(partners).where(searchFilter).groupBy(partners.status),
      ]);
      const stats = await getPartnerStats(rows);
      return {
        data: rows.map((r) => {
          const st = stats.get(r.id)!;
          return {
            ...r,
            createdAt: r.createdAt.toISOString(),
            reviewedAt: r.reviewedAt?.toISOString() ?? null,
            badge: st.badge.id,
            referred: st.referred,
            paidReferrals: st.paidReferrals,
          };
        }),
        total: total?.n ?? 0,
        page: input.page,
        limit: input.limit,
        counts: Object.fromEntries(partnerStatuses.map((s) => [s, byStatus.find((b) => b.status === s)?.n ?? 0])) as Record<
          (typeof partnerStatuses)[number],
          number
        >,
      };
    }),

  /** Approve or reject a partner, change their type, or keep notes on them. */
  updatePartner: platformAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(partnerStatuses).optional(),
        partnerType: z.enum(partnerTypes).optional(),
        adminNotes: z.string().trim().max(2000).optional(),
        listPublicly: z.boolean().optional(),
        /** Null goes back to the badge's rate. */
        commissionPercent: z.number().int().min(0).max(100).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, status, ...rest } = input;
      const [before] = await controlDb.select({ status: partners.status }).from(partners).where(eq(partners.id, id)).limit(1);
      const [row] = await controlDb
        .update(partners)
        .set({
          ...rest,
          ...(status ? { status, reviewedAt: new Date(), reviewedByUserId: ctx.user.id } : {}),
        })
        .where(eq(partners.id, id))
        .returning({ id: partners.id, status: partners.status, companyName: partners.companyName, email: partners.email });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Partner not found" });
      // Approving a partner is how their email gets verified: the admin has
      // checked who applied. An account made with that email (now, or before
      // a later re-approval) opens the partner portal from then on.
      if (row.status === "approved") {
        await controlDb
          .update(users)
          .set({ emailVerified: true })
          .where(sql`lower(${users.email}) = ${row.email.trim().toLowerCase()}`);
      }
      // Approved partners get the referral code they share with businesses.
      const referralCode = row.status === "approved" ? await ensureReferralCode(row.id) : null;

      // First approval: email the partner their code. A failed email does not
      // undo the approval; the admin can share the code from the panel.
      let emailed = false;
      if (referralCode && before?.status !== "approved") {
        const [p] = await controlDb
          .select({ email: partners.email, contactName: partners.contactName, companyName: partners.companyName })
          .from(partners)
          .where(eq(partners.id, row.id))
          .limit(1);
        const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
        try {
          await emailService.sendPartnerApproved(p!.email, {
            contactName: p!.contactName,
            companyName: p!.companyName,
            referralCode,
            signupUrl: `${base}/register?ref=${referralCode}`,
            portalUrl: `${base}/partner-portal`,
          });
          emailed = true;
        } catch (err) {
          logger.warn({ err, partnerId: row.id }, "Could not email the approved partner");
        }
      }
      const { email: _email, ...result } = row;
      return { ...result, referralCode, emailed };
    }),

  /** One partner: their referral code, badge, the organisations they brought in, and payouts. */
  partner: platformAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [partner] = await controlDb.select().from(partners).where(eq(partners.id, input.id)).limit(1);
      if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "Partner not found" });
      const [stats, referred, payouts, catalog] = await Promise.all([
        getPartnerStats([partner]),
        controlDb
          .select({ id: tenants.id, name: tenants.name, plan: tenants.plan, accessGrandfathered: tenants.accessGrandfathered, status: tenants.status, createdAt: tenants.createdAt })
          .from(tenants)
          .where(eq(tenants.partnerId, partner.id))
          .orderBy(desc(tenants.createdAt)),
        controlDb.select().from(partnerPayouts).where(eq(partnerPayouts.partnerId, partner.id)).orderBy(desc(partnerPayouts.period)),
        getPlanCatalog(),
      ]);
      const plans = new Map(catalog.map((p) => [p.id, p]));
      const paying = await payingTenantIds(referred.map((t) => t.id));
      const st = stats.get(partner.id)!;
      return {
        ...partner,
        createdAt: partner.createdAt.toISOString(),
        reviewedAt: partner.reviewedAt?.toISOString() ?? null,
        stats: { ...st, badge: st.badge.id, next: st.next ? { badge: st.next.badge.id, needed: st.next.needed } : null },
        referred: referred.map((t) => ({
          ...t,
          createdAt: t.createdAt.toISOString(),
          planName: plans.get(t.plan)?.name ?? t.plan,
          // A trial or grandfathered organisation pays nothing, whatever its plan.
          monthlyPriceInr: t.accessGrandfathered || !paying.has(t.id) ? 0 : (plans.get(t.plan)?.monthlyPriceInr ?? 0),
        })),
        payouts: payouts.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          paidAt: p.paidAt?.toISOString() ?? null,
        })),
      };
    }),

  /** Record what a partner is owed for a month. */
  recordPayout: platformAdminProcedure
    .input(
      z.object({
        partnerId: z.string().uuid(),
        period: payoutPeriodSchema,
        amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.50"),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [partner] = await controlDb
        .select({ status: partners.status })
        .from(partners)
        .where(eq(partners.id, input.partnerId))
        .limit(1);
      if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "Partner not found" });
      if (partner.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only approved partners can be paid" });
      }
      const [row] = await controlDb
        .insert(partnerPayouts)
        .values({ ...input, notes: input.notes || null, createdByUserId: ctx.user.id })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        throw new TRPCError({ code: "CONFLICT", message: `A payout for ${input.period} is already recorded for this partner` });
      }
      return row;
    }),

  /** Mark a payout paid (with the bank / UPI reference) or back to pending. */
  updatePayout: platformAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(partnerPayoutStatuses),
        reference: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [row] = await controlDb
        .update(partnerPayouts)
        .set({
          status: input.status,
          paidAt: input.status === "paid" ? new Date() : null,
          ...(input.reference !== undefined ? { reference: input.reference || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        })
        .where(eq(partnerPayouts.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Payout not found" });
      return row;
    }),

  /** Remove a payout recorded by mistake. Paid payouts stay as a record. */
  deletePayout: platformAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [row] = await controlDb
        .delete(partnerPayouts)
        .where(and(eq(partnerPayouts.id, input.id), eq(partnerPayouts.status, "pending")))
        .returning({ id: partnerPayouts.id });
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a pending payout can be removed" });
      return row;
    }),

  // ── Upcoming features (roadmap) ──────────────────────────────

  /** The roadmap board, in board order, with a count per status and every category in use. */
  roadmapList: platformAdminProcedure.input(roadmapListSchema).query(async ({ input }) => {
    await ensureRoadmapSeeded();
    const term = input.search ? `%${escapeLike(input.search)}%` : null;
    const searchFilter = term
      ? or(ilike(roadmapItems.title, term), ilike(roadmapItems.description, term), ilike(roadmapItems.category, term))
      : undefined;
    const categoryFilter = input.category ? ilike(roadmapItems.category, escapeLike(input.category)) : undefined;
    const stageFilter = input.launchStage ? eq(roadmapItems.launchStage, input.launchStage) : undefined;
    // Status counts follow the other filters, not the status itself, so the
    // columns/tabs stay meaningful; stage counts likewise ignore the stage.
    const baseFilter = and(searchFilter, categoryFilter, stageFilter);
    const [rows, byStatus, byStage, categories] = await Promise.all([
      controlDb
        .select()
        .from(roadmapItems)
        .where(and(baseFilter, input.status ? eq(roadmapItems.status, input.status) : undefined))
        .orderBy(
          // Before-launch work first, then high → medium → low, then the admins' own order.
          sql`CASE WHEN ${roadmapItems.launchStage} = 'before_launch' THEN 0 ELSE 1 END`,
          sql`CASE ${roadmapItems.priority} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
          asc(roadmapItems.sortOrder),
          asc(roadmapItems.createdAt),
        ),
      controlDb.select({ status: roadmapItems.status, n: count() }).from(roadmapItems).where(baseFilter).groupBy(roadmapItems.status),
      controlDb
        .select({ stage: roadmapItems.launchStage, n: count() })
        .from(roadmapItems)
        .where(and(searchFilter, categoryFilter, input.status ? eq(roadmapItems.status, input.status) : undefined))
        .groupBy(roadmapItems.launchStage),
      controlDb.selectDistinct({ category: roadmapItems.category }).from(roadmapItems).orderBy(asc(roadmapItems.category)),
    ]);
    return {
      data: rows.map(roadmapForAdmin),
      counts: Object.fromEntries(roadmapStatuses.map((s) => [s, byStatus.find((b) => b.status === s)?.n ?? 0])) as Record<
        RoadmapStatus,
        number
      >,
      stageCounts: Object.fromEntries(roadmapLaunchStages.map((s) => [s, byStage.find((b) => b.stage === s)?.n ?? 0])) as Record<
        RoadmapLaunchStage,
        number
      >,
      categories: categories.map((c) => c.category),
    };
  }),

  /** Add a feature to the board, at the end. */
  roadmapCreate: platformAdminProcedure.input(roadmapCreateSchema).mutation(async ({ input, ctx }) => {
    const [last] = await controlDb.select({ n: max(roadmapItems.sortOrder) }).from(roadmapItems);
    const [row] = await controlDb
      .insert(roadmapItems)
      .values({ ...input, sortOrder: (last?.n ?? -1) + 1, createdByUserId: ctx.user.id })
      .returning();
    return roadmapForAdmin(row!);
  }),

  /** Edit a feature: any of its fields, its status, or ticks on its checklist. */
  roadmapUpdate: platformAdminProcedure.input(roadmapUpdateSchema).mutation(async ({ input }) => {
    const { id, ...changes } = input;
    const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as Partial<
      typeof roadmapItems.$inferInsert
    >;
    if (set.priceNote === "") set.priceNote = null;
    const [row] = await controlDb
      .update(roadmapItems)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(roadmapItems.id, id))
      .returning();
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Feature not found" });
    return roadmapForAdmin(row);
  }),

  /** Remove a feature from the board. */
  roadmapDelete: platformAdminProcedure.input(roadmapDeleteSchema).mutation(async ({ input }) => {
    const [row] = await controlDb.delete(roadmapItems).where(eq(roadmapItems.id, input.id)).returning({ id: roadmapItems.id });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Feature not found" });
    return row;
  }),

  /** Put features in a new order; the first id is shown first. */
  roadmapReorder: platformAdminProcedure.input(roadmapReorderSchema).mutation(async ({ input }) => {
    const ids = [...new Set(input.ids)];
    const list = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;
    // One statement: each id's position in the list (from 0) becomes its sort order.
    const updated = await controlDb.execute(sql`
      UPDATE roadmap_items SET sort_order = v.ord - 1
      FROM unnest(${list}) WITH ORDINALITY AS v(id, ord)
      WHERE roadmap_items.id = v.id
      RETURNING roadmap_items.id`);
    return { count: updated.length };
  }),
});

function roadmapForAdmin(row: typeof roadmapItems.$inferSelect) {
  return {
    ...row,
    status: row.status as RoadmapStatus,
    priority: row.priority as RoadmapPriority,
    launchStage: row.launchStage as RoadmapLaunchStage,
    billing: row.billing as RoadmapBilling,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
