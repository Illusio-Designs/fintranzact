import { z } from "zod";
import { invalidateEntitlements } from "../lib/entitlements-cache.js";
import { TRPCError } from "@trpc/server";
import { controlDb, getTenantDb, billingSubscriptions, tenants, tenantMembers, userTenantPrefs, invitations, users, sessions, securityEvents, provisionTenantDatabase, cleanupTenantDatabase } from "@fintranzact/db";
import { eq, and, gt, isNull, desc, sql, inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { router, publicProcedure, protectedProcedure, tenantProcedure } from "../trpc.js";
import { invalidateSessionCache, getSessionIdFromRequest } from "../context.js";
import { invalidateTwoFactorGateMember, invalidateTwoFactorGateTenant } from "../lib/two-factor-gate-cache.js";
import { getGateMembership, getTwoFactorRequirementForCaller } from "../lib/two-factor-gate.js";
import { setSecurityPolicy, type PolicyDeps } from "../lib/two-factor-policy.js";
import { recordSecurityEvent } from "../lib/security-events.js";
import { planIdSchema, TWO_FACTOR_POLICIES, DEFAULT_TWO_FACTOR_GRACE_DAYS, ACCESS_EVENT_TYPES, caRoleDescription, memberRoleLabel, isCaRole } from "@fintranzact/shared";
import { emailService } from "../lib/email.js";
import { getCatalogPlan } from "../lib/plan-catalog.js";
import { newOrganisationPlanFields } from "../lib/signup-plan.js";
import { requirePlanManagerTenant } from "../lib/plan-manager.js";
import { effectiveOwnerPlan, enforceTeamMemberLimit, countCaSlots, enforceOrgCreationLimit, assertOwnedOrgsWritable, getLimits } from "../lib/plan-limits.js";
import { checkInviteRules, checkRoleChangeRules, countsTowardTeamLimit, normalizeInviteEmail } from "../lib/invite-rules.js";
import { removeTenantMember } from "../lib/member-removal.js";
import { removalStore } from "../lib/member-removal-store.js";
import { invalidateTenantMembership } from "../lib/tenant-membership.js";
import { logger } from "../lib/logger.js";
import { recordAccessEvent, recordOrgOpened } from "../lib/access-events.js";
import { canViewAccessLog, clampAccessLimit, decodeAccessCursor, pageAccessRows, accessUserIds, toAccessLogItem } from "../lib/access-log.js";
import { CLIENT_SCOPES, orderAndPageClients, lastOpenedCutoff, decidePin, MAX_PINNED_TENANTS, type ClientRow } from "../lib/client-switcher.js";
import { findCaPartnersByEmails, findCaPartnerByEmail, decideCreditPartner, attributePartnerOnAccept } from "../lib/partner-ca.js";
import { partnerCaStore } from "../lib/partner-ca-store.js";
import { backfillLegacyBusinessMembers, grantTenantBusinessesToMember } from "../lib/business-membership.js";

/** A member who joins through an invitation can open the organisation's businesses. */
async function openTenantBusinessesFor(tenantId: string, userId: string, role: string): Promise<void> {
  const db = await getTenantDb(tenantId);
  // Legacy businesses (no members yet) first get the whole team, as on first use.
  await backfillLegacyBusinessMembers(db, tenantId);
  await grantTenantBusinessesToMember(db, tenantId, userId, role);
}

/** Case-insensitive e-mail match (rows written before invites were lowercased may be mixed case). */
function emailIs(column: typeof users.email | typeof invitations.email, normalized: string) {
  return sql`lower(${column}) = ${normalized}`;
}

/** What an invitation shows the invitee: the role's label and, for an accountant role, what it can do. */
function roleInfo(role: string) {
  return { roleLabel: memberRoleLabel(role), accessDescription: caRoleDescription(role) };
}

/** Who/where for an access event raised by a signed-in request. */
function accessWho(ctx: { user: { id: string }; ipAddress?: string | null; req: Request }, tenantId: string) {
  return { actorId: ctx.user.id, tenantId, ip: ctx.ipAddress ?? null, userAgent: ctx.req.headers.get("user-agent") };
}

/**
 * After a NEW membership from an invitation: honour the owner's opt-in to credit
 * the CA (an approved accountant partner) as the organisation's partner. Never
 * fails the accept; records `access.partner_attributed` only when it credited.
 */
async function creditPartnerAfterAccept(
  ctx: { user: { id: string }; ipAddress?: string | null; req: Request },
  invitation: { tenantId: string; role: string; email: string; creditPartner: boolean | null },
): Promise<void> {
  if (invitation.creditPartner !== true) return;
  try {
    const [u] = await controlDb.select({ email: users.email, emailVerified: users.emailVerified })
      .from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!u) return;
    const partner = await attributePartnerOnAccept(partnerCaStore, {
      tenantId: invitation.tenantId,
      role: invitation.role,
      creditPartner: invitation.creditPartner,
      email: u.email,
      emailVerified: u.emailVerified,
    });
    if (partner) {
      await recordAccessEvent({
        kind: "partner_attributed",
        ...accessWho(ctx, invitation.tenantId),
        role: invitation.role,
        partnerName: partner.companyName,
      });
    }
  } catch (err) {
    logger.error({ err, tenantId: invitation.tenantId }, "Could not credit the CA partner on accept");
  }
}

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function autoSelectTenantInSession(req: Request, tenantId: string): Promise<string> {
  const sessionId = getSessionIdFromRequest(req);
  if (sessionId) {
    await controlDb.update(sessions)
      .set({ tenantId })
      .where(eq(sessions.id, sessionId));
    invalidateSessionCache(sessionId);
  }
  const [tenant] = await controlDb.select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return tenant?.name ?? "Organization";
}

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) + "-" + nanoid(6);
}

const drizzlePolicyDeps: PolicyDeps = {
  async getPolicy(tenantId) {
    const [row] = await controlDb.select({
      policy: tenants.twoFactorPolicy,
      graceDays: tenants.twoFactorGraceDays,
      enforcedAt: tenants.twoFactorEnforcedAt,
    }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!row) return null;
    return { policy: row.policy as (typeof TWO_FACTOR_POLICIES)[number], graceDays: row.graceDays ?? DEFAULT_TWO_FACTOR_GRACE_DAYS, enforcedAt: row.enforcedAt };
  },
  async getCaller(tenantId, userId) {
    // Fresh, not cached: this decides who may change security settings.
    const { entry } = await getGateMembership(tenantId, userId, { fresh: true });
    return entry ? { role: entry.role, hasTwoFactor: entry.hasTwoFactor } : null;
  },
  async save(tenantId, next) {
    await controlDb.update(tenants)
      .set({
        twoFactorPolicy: next.policy,
        twoFactorGraceDays: next.graceDays,
        twoFactorEnforcedAt: next.enforcedAt,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
  },
  record: recordSecurityEvent,
  invalidate: invalidateTwoFactorGateTenant,
  now: () => new Date(),
};

export const tenantRouter = router({
  /**
   * The owner switches the plan their organisation is trying. There is no free
   * plan and no payment here: this only applies to an organisation with no
   * live plan subscription (a trial). Once a plan is bought, plans change from
   * Settings -> Billing (billing.changePlan). A grandfathered organisation
   * (former Forever Free) has permanent full access and nothing to choose.
   * Removed plan ids are refused with a message that says so.
   */
  updatePlan: protectedProcedure
    .input(z.object({ plan: planIdSchema }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = await requirePlanManagerTenant(ctx);

      const [current] = await controlDb
        .select({ plan: tenants.plan, accessGrandfathered: tenants.accessGrandfathered })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No organization selected to update." });
      }
      // Keeping the current plan changes nothing, but still records that the
      // owner has confirmed their choice.
      if (current.plan === input.plan) {
        await controlDb.update(tenants)
          .set({ planSelectedAt: new Date(), updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));
        return { plan: current.plan };
      }
      if (current.accessGrandfathered) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your organisation has permanent full access. There is no plan to choose." });
      }
      const offered = await getCatalogPlan(input.plan);
      if (!offered || !offered.visible) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That plan is not on offer." });
      }
      // A bought plan changes through billing (proration, the gateway subscription).
      const [live] = await controlDb
        .select({ id: billingSubscriptions.id })
        .from(billingSubscriptions)
        .where(and(
          eq(billingSubscriptions.tenantId, tenantId),
          eq(billingSubscriptions.kind, "plan"),
          inArray(billingSubscriptions.status, ["active", "past_due", "halted"]),
        ))
        .limit(1);
      if (live) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your plan is already subscribed. Change it from Settings → Billing." });
      }

      await controlDb.update(tenants)
        .set({ plan: input.plan, planSelectedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      invalidateEntitlements(tenantId);

      return { plan: input.plan };
    }),

  // Create a new organization for the authenticated user.
  // User becomes the owner. In self-hosted mode, joins the default tenant instead.
  create: protectedProcedure.mutation(async ({ ctx }) => {
    await assertOwnedOrgsWritable(ctx.user.id);
    await enforceOrgCreationLimit(ctx.user.id);
    const displayName = ctx.user.name ?? ctx.user.email.split("@")[0];

    if (process.env.MULTI_TENANT === "true") {
      const tenantName = `${displayName}'s Organization`;
      const slug = generateSlug(tenantName);

      // Phase 1 (outside any tx): provision the physical DB + role + schema.
      // CREATE DATABASE is non-transactional, so it MUST happen outside the
      // control-DB transaction. If it throws, provisionTenantDatabase's own
      // internal catch already cleaned up.
      const dbConfig = await provisionTenantDatabase(nanoid(), slug);

      // Phase 2 (inside tx): insert tenants row + owner membership atomically.
      // If this tx fails (constraint violation, connection drop, COMMIT
      // failure), we compensate by dropping the physical DB + role — without
      // this, CREATE DATABASE would orphan resources forever.
      let tenantId: string;
      try {
        tenantId = await controlDb.transaction(async (tx) => {
          const [tenant] = await tx.insert(tenants).values({
            name: tenantName,
            slug,
            dbName: dbConfig.dbName,
            dbHost: dbConfig.dbHost,
            dbPort: dbConfig.dbPort,
            dbUser: dbConfig.dbUser,
            dbPassword: dbConfig.dbPassword,
            // Growth with a trial running (lib/signup-plan.ts); the owner confirms the plan next.
            ...newOrganisationPlanFields(null),
          }).returning({ id: tenants.id });

          await tx.insert(tenantMembers).values({
            tenantId: tenant.id,
            userId: ctx.user.id,
            role: "owner",
            acceptedAt: new Date(),
          });

          return tenant.id;
        });
      } catch (err) {
        // Drop the orphan physical DB + role since the control-DB writes
        // rolled back. Best-effort — never throws.
        await cleanupTenantDatabase(dbConfig.dbName, dbConfig.dbUser);
        throw err;
      }

      // Auto-select the new tenant in session (outside tx, not part of the
      // orphan-compensation contract — failure here only affects UX, not
      // cluster state)
      const tenantNameResult = await autoSelectTenantInSession(ctx.req, tenantId);
      return { tenantId, tenantName: tenantNameResult };
    } else {
      // Self-hosted: each user gets their own organization and becomes owner.
      const tenantName = `${displayName}'s Organization`;
      const slug = generateSlug(tenantName);

      const [tenant] = await controlDb.insert(tenants).values({
        name: tenantName,
        slug,
        // Growth with a trial running (lib/signup-plan.ts); the owner confirms the plan next.
        ...newOrganisationPlanFields(null),
      }).returning({ id: tenants.id });

      await controlDb.insert(tenantMembers).values({
        tenantId: tenant.id,
        userId: ctx.user.id,
        role: "owner",
        acceptedAt: new Date(),
      });

      const tenantNameResult = await autoSelectTenantInSession(ctx.req, tenant.id);
      return { tenantId: tenant.id, tenantName: tenantNameResult };
    }
  }),

  // Check if the user can create a new org (plan limit not reached).
  canCreateOrg: protectedProcedure.query(async ({ ctx }) => {
    const ownedOrgs = await controlDb.select({ plan: tenants.plan })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(
        eq(tenantMembers.userId, ctx.user.id),
        eq(tenantMembers.role, "owner"),
      ));

    const bestPlan = effectiveOwnerPlan(ownedOrgs);
    if (bestPlan === null) return true;

    const limits = await getLimits(bestPlan);
    return limits.maxOwnedOrgs === Infinity || ownedOrgs.length < limits.maxOwnedOrgs;
  }),

  // List user's tenant memberships
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await controlDb.select({
      tenantId: tenantMembers.tenantId,
      role: tenantMembers.role,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantPlan: tenants.plan,
      planSelectedAt: tenants.planSelectedAt,
    })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(
        eq(tenantMembers.userId, ctx.user.id),
        eq(tenants.status, "active"),
      ));
    return memberships.map((m) => ({ ...m, planSelectedAt: m.planSelectedAt?.toISOString() ?? null }));
  }),

  // The client switcher's list: the caller's organisations, pinned first, then
  // most recently opened, then by name; searchable, scoped ("mine" = their own
  // firm, "clients" = everything else) and paged. One join, ordered and paged in
  // memory (lib/client-switcher.ts). Needs no selected organisation. Only active
  // organisations are listed, as in tenant.list.
  listClients: protectedProcedure
    .input(z.object({
      search: z.string().max(100).optional(),
      scope: z.enum(CLIENT_SCOPES).optional(),
      cursor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const rows: ClientRow[] = await controlDb.select({
        tenantId: tenantMembers.tenantId,
        name: tenants.name,
        slug: tenants.slug,
        role: tenantMembers.role,
        plan: tenants.plan,
        pinnedAt: userTenantPrefs.pinnedAt,
        lastOpenedAt: userTenantPrefs.lastOpenedAt,
      })
        .from(tenantMembers)
        .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
        .leftJoin(userTenantPrefs, and(
          eq(userTenantPrefs.tenantId, tenantMembers.tenantId),
          eq(userTenantPrefs.userId, tenantMembers.userId),
        ))
        .where(and(eq(tenantMembers.userId, ctx.user.id), eq(tenants.status, "active")));
      return orderAndPageClients(rows, input ?? {});
    }),

  // Pin or unpin an organisation in the caller's own switcher (at most 20 pinned).
  setPinned: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid(), pinned: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const [membership] = await controlDb.select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, input.tenantId), eq(tenantMembers.userId, ctx.user.id)))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });

      const [current] = await controlDb.select({ pinnedAt: userTenantPrefs.pinnedAt })
        .from(userTenantPrefs)
        .where(and(eq(userTenantPrefs.userId, ctx.user.id), eq(userTenantPrefs.tenantId, input.tenantId)))
        .limit(1);
      // Only pins of organisations the person still belongs to count towards the limit.
      const [{ count }] = await controlDb.select({ count: sql<number>`count(*)::int` })
        .from(userTenantPrefs)
        .innerJoin(tenantMembers, and(eq(tenantMembers.tenantId, userTenantPrefs.tenantId), eq(tenantMembers.userId, userTenantPrefs.userId)))
        .where(and(eq(userTenantPrefs.userId, ctx.user.id), sql`${userTenantPrefs.pinnedAt} is not null`));
      const decision = decidePin({ pinned: input.pinned, alreadyPinned: !!current?.pinnedAt, pinnedCount: count ?? 0 });
      if (decision === "limit") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `You can pin up to ${MAX_PINNED_TENANTS} organisations. Unpin one first.` });
      }
      if (decision === "ok") {
        const pinnedAt = input.pinned ? new Date() : null;
        await controlDb.insert(userTenantPrefs)
          .values({ userId: ctx.user.id, tenantId: input.tenantId, pinnedAt })
          .onConflictDoUpdate({ target: [userTenantPrefs.userId, userTenantPrefs.tenantId], set: { pinnedAt } });
      }
      return { success: true, pinned: input.pinned };
    }),

  // Leave an organisation you do not own (a CA ending a client relationship).
  // Same cleanup as being removed (business access, API keys, invitations,
  // sessions); logs `access.left` and tells the owners. Owners cannot leave.
  leave: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [membership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, input.tenantId), eq(tenantMembers.userId, ctx.user.id)))
        .limit(1);
      const result = await removeTenantMember({
        tenantId: input.tenantId,
        actor: { id: ctx.user.id, role: membership?.role ?? null },
        targetUserId: ctx.user.id,
        self: true,
        ip: ctx.ipAddress,
        userAgent: ctx.req.headers.get("user-agent"),
      }, removalStore);
      return { success: result.success };
    }),

  // Pending invitations for the authenticated user's email.
  // Used by the NoOrgScreen to show "You've been invited to [Org]".
  myInvitations: protectedProcedure.query(async ({ ctx }) => {
    const pending = await controlDb.select({
      id: invitations.id,
      tenantName: tenants.name,
      role: invitations.role,
      invitedByName: users.name,
    })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(
        emailIs(invitations.email, normalizeInviteEmail(ctx.user.email)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ));
    return pending.map((p) => ({ ...p, ...roleInfo(p.role) }));
  }),

  // Accept invitation by ID (for users who see their pending invites in-app,
  // without having clicked the email link). Same logic as acceptInvitation
  // but looks up by ID + email match instead of raw token.
  acceptById: protectedProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [invitation] = await controlDb.select()
        .from(invitations)
        .where(and(
          eq(invitations.id, input.invitationId),
          emailIs(invitations.email, normalizeInviteEmail(ctx.user.email)),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (!invitation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found or expired" });
      }

      // Check if already a member
      const [existingMember] = await controlDb.select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, invitation.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (existingMember) {
        await controlDb.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
        const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
        return { tenantId: invitation.tenantId, tenantName };
      }

      await controlDb.transaction(async (tx) => {
        await tx.insert(tenantMembers).values({
          tenantId: invitation.tenantId,
          userId: ctx.user.id,
          role: invitation.role,
          invitedBy: invitation.invitedBy ?? undefined,
          acceptedAt: new Date(),
        });
        await tx.update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invitation.id));
      });
      await openTenantBusinessesFor(invitation.tenantId, ctx.user.id, invitation.role);
      await recordAccessEvent({ kind: "accepted", ...accessWho(ctx, invitation.tenantId), role: invitation.role });
      await creditPartnerAfterAccept(ctx, invitation);

      const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
      return { tenantId: invitation.tenantId, tenantName };
    }),

  // Select/switch tenant — updates session's tenantId
  select: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is a member of this tenant
      const [membership] = await controlDb.select({ id: tenantMembers.id, role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, input.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
      }

      // Get session ID from cookie or Bearer token (mobile uses Bearer)
      const sessionId = getSessionIdFromRequest(ctx.req);
      if (!sessionId) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Update session's tenantId
      await controlDb.update(sessions)
        .set({ tenantId: input.tenantId })
        .where(eq(sessions.id, sessionId));

      // Invalidate cached session so the next request picks up the new tenant
      invalidateSessionCache(sessionId);

      // Remember when this person last opened the organisation (for "Recent" in
      // the switcher). At most one write per 5 minutes, the guard is in the
      // upsert itself; never fails the selection.
      try {
        const now = new Date();
        await controlDb.insert(userTenantPrefs)
          .values({ userId: ctx.user.id, tenantId: input.tenantId, lastOpenedAt: now })
          .onConflictDoUpdate({
            target: [userTenantPrefs.userId, userTenantPrefs.tenantId],
            set: { lastOpenedAt: now },
            setWhere: sql`${userTenantPrefs.lastOpenedAt} is null or ${userTenantPrefs.lastOpenedAt} < ${lastOpenedCutoff(now).toISOString()}::timestamptz`,
          });
      } catch (err) {
        logger.warn({ err }, "tenant.select: could not record last opened");
      }

      // A CA opening a client's books is logged for the owner (CA roles only,
      // at most once an hour per person and organisation).
      await recordOrgOpened({ ...ctx, tenantId: input.tenantId }, membership.role);

      return { success: true };
    }),

  // Get current tenant info. Explicit columns: the tenants row also holds
  // the organisation's database connection details (dbHost/dbUser/dbPassword…),
  // which must never reach a client.
  current: tenantProcedure.query(async ({ ctx }) => {
    const [tenant] = await controlDb.select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      referralCode: tenants.referralCode,
      partnerId: tenants.partnerId,
      plan: tenants.plan,
      status: tenants.status,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
      twoFactorPolicy: tenants.twoFactorPolicy,
      twoFactorGraceDays: tenants.twoFactorGraceDays,
    })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    if (!tenant) return null;
    // What the caller must do about two-factor here. Always answered (this is
    // one of the few calls a blocked member can still make) so clients can show
    // the banner or redirect to the Security tab.
    const twoFactorRequirement = await getTwoFactorRequirementForCaller({
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      authTokenKind: ctx.authTokenKind,
    });
    return { ...tenant, twoFactorRequirement };
  }),

  // List members of current tenant
  members: tenantProcedure.query(async ({ ctx }) => {
    // Who has set up two-factor is shown to owners and admins only.
    const { entry: caller } = await getGateMembership(ctx.tenantId, ctx.user.id);
    const showTwoFactor = !!caller && ["owner", "superadmin", "admin"].includes(caller.role);
    const rows = await controlDb.select({
      id: tenantMembers.id,
      userId: tenantMembers.userId,
      role: tenantMembers.role,
      acceptedAt: tenantMembers.acceptedAt,
      createdAt: tenantMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
      twoFactorEnabled: users.twoFactorEnabled,
    })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(eq(tenantMembers.tenantId, ctx.tenantId));
    // When each CA last opened the books (owners and admins only; null for non-CA members).
    const showOpened = !!caller && canViewAccessLog(caller.role);
    const caIds = showOpened ? rows.filter((r) => isCaRole(r.role)).map((r) => r.userId) : [];
    const opened = new Map<string, Date>();
    if (caIds.length > 0) {
      const latest = await controlDb.select({
        userId: securityEvents.userId,
        at: sql<Date>`max(${securityEvents.createdAt})`.mapWith(securityEvents.createdAt),
      })
        .from(securityEvents)
        .where(and(
          eq(securityEvents.tenantId, ctx.tenantId),
          eq(securityEvents.type, "access.org_opened"),
          inArray(securityEvents.userId, caIds),
        ))
        .groupBy(securityEvents.userId);
      for (const l of latest) if (l.userId && l.at) opened.set(l.userId, l.at);
    }
    // "Registered CA partner" badge: owners/admins only, CA members only, one batched lookup.
    const partnerByEmail = showOpened
      ? await findCaPartnersByEmails(partnerCaStore, rows.filter((r) => isCaRole(r.role)).map((r) => r.userEmail))
      : new Map();
    return rows.map(({ twoFactorEnabled, ...member }) => ({
      ...member,
      caPartner: (isCaRole(member.role) ? partnerByEmail.get(normalizeInviteEmail(member.userEmail)) : null) ?? null,
      twoFactorEnabled: showTwoFactor ? twoFactorEnabled : undefined,
      lastOpenedAt: showOpened && isCaRole(member.role) ? (opened.get(member.userId) ?? null) : null,
    }));
  }),

  // Require two-factor authentication for the organisation (owner only, like
  // billing). The rules live in lib/two-factor-policy.ts.
  setSecurityPolicy: tenantProcedure
    .input(z.object({
      policy: z.enum(TWO_FACTOR_POLICIES),
      graceDays: z.number().int().min(0).max(30).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const next = await setSecurityPolicy(drizzlePolicyDeps, {
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        input,
        ip: ctx.ipAddress ?? null,
        userAgent: ctx.req.headers.get("user-agent"),
      });
      return { policy: next.policy, graceDays: next.graceDays, enforcedAt: next.enforcedAt };
    }),

  // Invite a member
  inviteMember: tenantProcedure
    .input(z.object({
      // Trimmed and lowercased once, so every lookup and comparison below (and
      // the invitee's own list) sees the same address however it was typed.
      email: z.string().trim().toLowerCase().email(),
      role: z.enum(["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"]).default("seller"),
      // CA roles only (ignored otherwise): "This CA referred me to Fintranzact, credit them as my partner". Default off.
      creditPartner: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check caller has permission (owner/superadmin or admin; CA roles: owner/superadmin only)
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      const caSlots = isCaRole(input.role) ? await countCaSlots(ctx.tenantId) : { memberCaCount: 0, pendingCaCount: 0 };
      const rules = checkInviteRules({
        inviterRole: callerMembership?.role,
        targetRole: input.role,
        ...caSlots,
      });
      if (!rules.ok) throw new TRPCError({ code: rules.code, message: rules.message });

      // Opt-in partner credit: only for a CA role, only for an approved CA partner's e-mail.
      const credit = decideCreditPartner({
        role: input.role,
        creditPartner: input.creditPartner,
        partnerMatch: input.creditPartner && isCaRole(input.role)
          ? await findCaPartnerByEmail(partnerCaStore, input.email, { allowUnregistered: true })
          : null,
      });
      if (!credit.ok) throw new TRPCError({ code: "BAD_REQUEST", message: credit.message });

      // Enforce team member limit before proceeding (accountant roles are outside it)
      if (countsTowardTeamLimit(input.role)) await enforceTeamMemberLimit(ctx.tenantId);

      // Check if already a member
      const [existingUser] = await controlDb.select({ id: users.id })
        .from(users).where(emailIs(users.email, input.email)).limit(1);

      if (existingUser) {
        const [existingMember] = await controlDb.select({ id: tenantMembers.id })
          .from(tenantMembers)
          .where(and(
            eq(tenantMembers.tenantId, ctx.tenantId),
            eq(tenantMembers.userId, existingUser.id),
          ))
          .limit(1);

        if (existingMember) {
          throw new TRPCError({ code: "CONFLICT", message: "User is already a member" });
        }
      }

      // Check for existing pending invitation (prevent duplicates)
      const [existingInvite] = await controlDb.select({ id: invitations.id })
        .from(invitations)
        .where(and(
          eq(invitations.tenantId, ctx.tenantId),
          emailIs(invitations.email, input.email),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (existingInvite) {
        throw new TRPCError({ code: "CONFLICT", message: "A pending invitation for this email already exists" });
      }

      const rawToken = nanoid(32);
      const tokenHash = hashInvitationToken(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await controlDb.insert(invitations).values({
        tenantId: ctx.tenantId,
        email: input.email,
        role: input.role,
        token: tokenHash, // Store hash, never the raw token
        invitedBy: ctx.user.id,
        expiresAt,
        creditPartner: credit.creditPartner,
      });

      // Fire-and-forget invitation email — failure doesn't block invite creation
      const [tenant] = await controlDb.select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);

      const [inviter] = await controlDb.select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5173}`;
      const inviteUrl = `${baseUrl}/invite/${rawToken}`;

      emailService.sendInvitation(
        input.email,
        inviteUrl,
        tenant?.name ?? "Organization",
        inviter?.name ?? null,
        input.role,
      ).catch((err) => {
        console.error("[invite] Failed to send invitation email:", err);
      });

      await recordAccessEvent({
        kind: "invited",
        ...accessWho(ctx, ctx.tenantId),
        role: input.role,
        email: input.email,
        inviteeUserId: existingUser?.id ?? null,
      });

      // Return the raw token — this is what gets sent via email
      return { token: rawToken, inviteUrl, role: input.role, expiresAt };
    }),

  // Accept an invitation
  // Preview invitation details without accepting — used by the onboarding
  // flow to show "Join [Org] or create your own?" before committing.
  // Public because new users calling this may not have a session yet.
  // Security: token is nanoid(32) (~192 bits entropy) — brute-force infeasible.
  // Response deliberately omits email to avoid leaking PII via token possession.
  peekInvitation: publicProcedure
    .input(z.object({ token: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const tokenHash = hashInvitationToken(input.token);
      const [invitation] = await controlDb.select({
        role: invitations.role,
        tenantId: invitations.tenantId,
        acceptedAt: invitations.acceptedAt,
        invitedBy: invitations.invitedBy,
      })
        .from(invitations)
        .where(and(
          eq(invitations.token, tokenHash),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (!invitation || invitation.acceptedAt) return null;

      const [tenant] = await controlDb.select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, invitation.tenantId))
        .limit(1);

      const [inviter] = invitation.invitedBy
        ? await controlDb.select({ name: users.name }).from(users).where(eq(users.id, invitation.invitedBy)).limit(1)
        : [];

      return {
        tenantName: tenant?.name ?? "Organization",
        role: invitation.role,
        invitedByName: inviter?.name ?? null,
        ...roleInfo(invitation.role),
      };
    }),

  acceptInvitation: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tokenHash = hashInvitationToken(input.token);
      const [invitation] = await controlDb.select()
        .from(invitations)
        .where(and(
          eq(invitations.token, tokenHash),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (!invitation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired invitation" });
      }

      // Verify the invitation email matches the authenticated user
      const [currentUser] = await controlDb.select({ email: users.email })
        .from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!currentUser || normalizeInviteEmail(currentUser.email) !== normalizeInviteEmail(invitation.email)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This invitation was sent to a different email address" });
      }

      // If already accepted, treat as idempotent — the user may be clicking
      // an old link or retrying after a partial failure. Check membership and
      // auto-select the tenant if they're already in.
      if (invitation.acceptedAt) {
        const [existingMember] = await controlDb.select({ id: tenantMembers.id })
          .from(tenantMembers)
          .where(and(
            eq(tenantMembers.tenantId, invitation.tenantId),
            eq(tenantMembers.userId, ctx.user.id),
          ))
          .limit(1);
        if (existingMember) {
          const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
          return { tenantId: invitation.tenantId, tenantName };
        }
        // Accepted but not a member: the person was removed (removal deletes
        // the accepted invitation, so this is a leftover from before that, or a
        // retry). An old link must never re-add someone the organisation
        // removed: they need a NEW invitation.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invitation has already been used. Ask the organisation for a new invitation.",
        });
      }

      // Check if already a member (e.g. double-click)
      const [existingMember] = await controlDb.select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, invitation.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);
      if (existingMember) {
        await controlDb.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
        const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
        return { tenantId: invitation.tenantId, tenantName };
      }

      // Create membership and mark invitation accepted atomically so a crash
      // between the two writes cannot leave the user as a member with a
      // re-usable invitation link.
      await controlDb.transaction(async (tx) => {
        await tx.insert(tenantMembers).values({
          tenantId: invitation.tenantId,
          userId: ctx.user.id,
          role: invitation.role,
          invitedBy: invitation.invitedBy ?? undefined,
          acceptedAt: new Date(),
        });

        await tx.update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invitation.id));
      });
      await openTenantBusinessesFor(invitation.tenantId, ctx.user.id, invitation.role);
      await recordAccessEvent({ kind: "accepted", ...accessWho(ctx, invitation.tenantId), role: invitation.role });
      await creditPartnerAfterAccept(ctx, invitation);

      const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
      return { tenantId: invitation.tenantId, tenantName };
    }),

  // List pending invitations for the current tenant
  pendingInvitations: tenantProcedure.query(async ({ ctx }) => {
    // Invitee emails are shown to owners and admins only.
    const [caller] = await controlDb.select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, ctx.user.id)))
      .limit(1);
    if (!caller || !["owner", "superadmin", "admin"].includes(caller.role)) return [];

    const pending = await controlDb.select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      invitedByName: users.name,
    })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(
        eq(invitations.tenantId, ctx.tenantId),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ))
      .orderBy(desc(invitations.createdAt));

    const partnerByEmail = await findCaPartnersByEmails(
      partnerCaStore,
      pending.filter((p) => isCaRole(p.role)).map((p) => p.email),
      { allowUnregistered: true },
    );
    return pending.map((p) => ({
      ...p,
      ...roleInfo(p.role),
      caPartner: (isCaRole(p.role) ? partnerByEmail.get(normalizeInviteEmail(p.email)) : null) ?? null,
    }));
  }),

  // Revoke a pending invitation
  revokeInvitation: tenantProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Verify caller is admin/owner
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!callerMembership || !["owner", "superadmin", "admin"].includes(callerMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can revoke invitations" });
      }

      const revoked = await controlDb.delete(invitations)
        .where(and(
          eq(invitations.id, input.invitationId),
          eq(invitations.tenantId, ctx.tenantId),
          isNull(invitations.acceptedAt),
        ))
        .returning({ email: invitations.email, role: invitations.role });

      for (const inv of revoked) {
        await recordAccessEvent({ kind: "invite_revoked", ...accessWho(ctx, ctx.tenantId), role: inv.role, email: inv.email });
      }

      return { success: true };
    }),

  // Remove a member: revokes business grants, API keys, old invite links and
  // sessions, logs `access.removed` and e-mails the person (lib/member-removal.ts).
  removeMember: tenantProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      const result = await removeTenantMember({
        tenantId: ctx.tenantId,
        actor: { id: ctx.user.id, role: callerMembership?.role ?? null },
        targetUserId: input.userId,
        ip: ctx.ipAddress,
        userAgent: ctx.req.headers.get("user-agent"),
      }, removalStore);

      return { success: result.success };
    }),

  // Update member role
  updateMemberRole: tenantProcedure
    .input(z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!callerMembership || !["owner", "superadmin", "admin"].includes(callerMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can change roles" });
      }

      // Prevent changing a superadmin/owner's role
      const [targetMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, input.userId),
        ))
        .limit(1);

      if (targetMembership && ["owner", "superadmin"].includes(targetMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot change the role of a superadmin" });
      }

      // Accountant (CA) roles: owner/superadmin only, to or from one; capped per organisation.
      const caSlots = isCaRole(input.role) ? await countCaSlots(ctx.tenantId) : { memberCaCount: 0, pendingCaCount: 0 };
      const rules = checkRoleChangeRules({
        actorRole: callerMembership.role,
        currentRole: targetMembership?.role,
        newRole: input.role,
        ...caSlots,
      });
      if (!rules.ok) throw new TRPCError({ code: rules.code, message: rules.message });

      await controlDb.update(tenantMembers)
        .set({ role: input.role })
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, input.userId),
        ));
      invalidateTwoFactorGateMember(ctx.tenantId, input.userId);
      invalidateTenantMembership(ctx.tenantId, input.userId);

      if (targetMembership && targetMembership.role !== input.role) {
        const [target] = await controlDb.select({ email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1);
        await recordAccessEvent({
          kind: "role_changed",
          ...accessWho(ctx, ctx.tenantId),
          targetUserId: input.userId,
          from: targetMembership.role,
          to: input.role,
          email: target?.email ?? "",
        });
      }

      return { success: true };
    }),

  // The access log: who was invited, who accepted, role changes, removals, when
  // a CA opened the books and what they downloaded. Owners and admins only.
  // Reads the control security_events table, so the plan's audit retention
  // window does not apply. Keyset paging on (createdAt ms, id).
  accessLog: tenantProcedure
    .input(z.object({
      cursor: z.string().max(80).optional(),
      limit: z.number().int().optional(),
      type: z.union([z.enum(ACCESS_EVENT_TYPES), z.array(z.enum(ACCESS_EVENT_TYPES)).min(1).max(ACCESS_EVENT_TYPES.length)]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const [caller] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, ctx.user.id)))
        .limit(1);
      if (!caller || !canViewAccessLog(caller.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can see the access log" });
      }

      const limit = clampAccessLimit(input?.limit);
      const cursor = decodeAccessCursor(input?.cursor);
      if (input?.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });

      const types = input?.type === undefined ? null : Array.isArray(input.type) ? input.type : [input.type];
      // Millisecond precision on both sides of the keyset so a row is never skipped or repeated.
      const ms = sql`date_trunc('milliseconds', ${securityEvents.createdAt})`;
      const conds = [
        eq(securityEvents.tenantId, ctx.tenantId),
        types ? inArray(securityEvents.type, types) : like(securityEvents.type, "access.%"),
      ];
      if (cursor) {
        conds.push(sql`(${ms}, ${securityEvents.id}) < (${new Date(cursor.ms).toISOString()}::timestamptz, ${cursor.id}::uuid)`);
      }
      const fetched = await controlDb.select({
        id: securityEvents.id,
        userId: securityEvents.userId,
        actorUserId: securityEvents.actorUserId,
        type: securityEvents.type,
        metadata: securityEvents.metadata,
        createdAt: securityEvents.createdAt,
      })
        .from(securityEvents)
        .where(and(...conds))
        .orderBy(desc(ms), desc(securityEvents.id))
        .limit(limit + 1);

      const { rows, nextCursor } = pageAccessRows(fetched, limit);
      const ids = accessUserIds(rows);
      const people = ids.length > 0
        ? await controlDb.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids))
        : [];
      const byId = new Map(people.map((u) => [u.id, u]));
      return { items: rows.map((r) => toAccessLogItem(r, byId)), nextCursor };
    }),
});

