/** The real RemovalStore: control DB, tenant DB, caches, security events, e-mail. */
import { and, eq, inArray, isNotNull, isNull, gt, sql } from "drizzle-orm";
import { controlDb, getTenantDb, tenantMembers, apiKeys, invitations, sessions, users, tenants, businessMembers, userTenantPrefs } from "@fintranzact/db";
import { invalidateSessionCache } from "../context.js";
import { invalidateTwoFactorGateMember } from "./two-factor-gate-cache.js";
import { invalidateTenantMembership } from "./tenant-membership.js";
import { tenantBusinessIds } from "./business-membership.js";
import { recordSecurityEvent } from "./security-events.js";
import { emailService } from "./email.js";
import { logger } from "./logger.js";
import { normalizeInviteEmail } from "./invite-rules.js";
import type { RemovalStore } from "./member-removal.js";

export const removalStore: RemovalStore = {
  async getTarget(tenantId, userId) {
    const [row] = await controlDb
      .select({ role: tenantMembers.role, email: users.email, name: users.name })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  },

  async getUserEmail(userId) {
    const [row] = await controlDb.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.email ?? null;
  },

  async getTenantName(tenantId) {
    const [row] = await controlDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row?.name ?? null;
  },

  async getOwnerEmails(tenantId) {
    const rows = await controlDb
      .select({ email: users.email })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.role, ["owner", "superadmin"])));
    return rows.map((r) => r.email).filter((e): e is string => !!e);
  },

  async revokeBusinessGrants(tenantId, userId) {
    const db = await getTenantDb(tenantId);
    // Scoped to this organisation's businesses (self-hosted mode shares one database across organisations).
    const ids = await tenantBusinessIds(db, tenantId);
    if (ids.length === 0) return 0;
    const rows = await db
      .delete(businessMembers)
      .where(and(eq(businessMembers.userId, userId), inArray(businessMembers.businessId, ids)))
      .returning({ id: businessMembers.id });
    return rows.length;
  },

  async revokeControlAccess(tenantId, userId, email, now) {
    return controlDb.transaction(async (tx) => {
      const removedMembers = await tx
        .delete(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
        .returning({ id: tenantMembers.id });

      await tx.delete(userTenantPrefs).where(and(eq(userTenantPrefs.tenantId, tenantId), eq(userTenantPrefs.userId, userId)));

      const keys = await tx
        .delete(apiKeys)
        .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.userId, userId)))
        .returning({ id: apiKeys.id });

      let invitationsDeleted = 0;
      let invitationsExpired = 0;
      if (email) {
        const normalized = normalizeInviteEmail(email);
        const sameEmail = and(eq(invitations.tenantId, tenantId), sql`lower(${invitations.email}) = ${normalized}`);
        // Accepted: delete, so the old link cannot re-add them. Pending: expire, keeps the row for history.
        invitationsDeleted = (await tx.delete(invitations).where(and(sameEmail, isNotNull(invitations.acceptedAt))).returning({ id: invitations.id })).length;
        invitationsExpired = (await tx.update(invitations).set({ expiresAt: now })
          .where(and(sameEmail, isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)))
          .returning({ id: invitations.id })).length;
      }

      const affected = await tx
        .update(sessions)
        .set({ tenantId: null })
        .where(and(eq(sessions.userId, userId), eq(sessions.tenantId, tenantId)))
        .returning({ id: sessions.id });

      return {
        membershipRemoved: removedMembers.length > 0,
        apiKeysRevoked: keys.length,
        invitationsDeleted,
        invitationsExpired,
        sessionIds: affected.map((s) => s.id),
      };
    });
  },

  invalidateCaches(tenantId, userId, sessionIds) {
    invalidateTenantMembership(tenantId, userId);
    invalidateTwoFactorGateMember(tenantId, userId);
    for (const id of sessionIds) invalidateSessionCache(id);
  },

  recordEvent: recordSecurityEvent,
  sendNotice: (to, subject, text) => emailService.sendNotice(to, subject, text),
  log: { error: (msg, meta) => logger.error(meta ?? {}, msg) },
  now: () => new Date(),
};
