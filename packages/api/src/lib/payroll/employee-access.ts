/**
 * Employee logins (Payroll Phase 3): how an employee record becomes a person who can sign in, and how
 * that access ends. docs/architecture/payroll-self-service.md.
 *
 *  - HR (or an owner/admin) invites an employee by email. The invitation is an ordinary `invitations`
 *    row with role "employee" plus the employee and business it is for; it is single-use, expires in
 *    7 days and carries a hashed token, exactly like the team invitations.
 *  - Accepting it makes the person an organisation member with the role "employee" (no team seat), a
 *    business member of THAT business only, and writes the `employee_logins` link. One employee has
 *    one login; one user has one employee record per business.
 *  - The employee is always resolved from the link (`resolveSelf`), never from client input.
 *  - Access ends when HR removes the link, when the employee is marked as exited, or when the person
 *    leaves the organisation: the link goes, the business membership goes, and, when it was their last
 *    link in the organisation, the organisation membership, API keys and sessions go through the same
 *    removal flow as any member.
 */

import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import {
  businessMembers,
  businesses,
  controlDb,
  employeeLogins,
  employees,
  getTenantDb,
  invitations,
  tenantMembers,
  tenants,
  users,
  type TenantDatabase,
} from "@fintranzact/db";
import { EMPLOYEE_ROLE } from "@fintranzact/shared";
import { logAudit } from "../audit.js";
import { emailService } from "../email.js";
import { recordAccessEvent } from "../access-events.js";
import { removeTenantMember } from "../member-removal.js";
import { removalStore } from "../member-removal-store.js";
import { invalidateTenantMembership } from "../tenant-membership.js";
import { invalidateTwoFactorGateMember } from "../two-factor-gate-cache.js";
import { tenantBusinessIds } from "../business-membership.js";
import { logger } from "../logger.js";

export const EMPLOYEE_INVITE_DAYS = 7;

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type EmployeeRow = typeof employees.$inferSelect;

export interface SelfCtx {
  db: TenantDatabase;
  businessId: string;
  user: { id: string };
  role: string;
}

/**
 * The employee record behind the signed-in employee login, or FORBIDDEN. The business comes from the
 * request header that hasBusinessAccess already checked; the link row decides which employee it is.
 */
export async function resolveSelf(ctx: SelfCtx): Promise<EmployeeRow> {
  if (ctx.role !== EMPLOYEE_ROLE) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Self-service is for employee logins." });
  }
  const [row] = await ctx.db
    .select({ employee: employees })
    .from(employeeLogins)
    .innerJoin(employees, eq(employees.id, employeeLogins.employeeId))
    .where(and(eq(employeeLogins.businessId, ctx.businessId), eq(employeeLogins.userId, ctx.user.id), eq(employees.businessId, ctx.businessId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "FORBIDDEN", message: "Your login is not linked to an employee record here. Ask HR to invite you again." });
  if (row.employee.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Your employment record is no longer active." });
  return row.employee;
}

// ── Inviting ─────────────────────────────────────────────────────────────────

export interface InviteArgs {
  tenantId: string;
  db: TenantDatabase;
  businessId: string;
  employeeId: string;
  email: string;
  inviter: { id: string; name: string | null };
  ip?: string | null;
  userAgent?: string | null;
}

/** Expire the pending invitations for an employee. Returns how many. */
async function expirePendingFor(employeeId: string, businessId: string): Promise<number> {
  const now = new Date();
  const rows = await controlDb
    .update(invitations)
    .set({ expiresAt: now })
    .where(and(eq(invitations.employeeId, employeeId), eq(invitations.businessId, businessId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)))
    .returning({ id: invitations.id });
  return rows.length;
}

/**
 * Invite (or re-invite) an employee. A pending invitation for the same employee is replaced, so
 * "resend" is the same call and an old link stops working.
 */
export async function inviteEmployee(args: InviteArgs): Promise<{ inviteUrl: string; token: string; expiresAt: Date; replaced: boolean }> {
  const [emp] = await args.db
    .select()
    .from(employees)
    .where(and(eq(employees.id, args.employeeId), eq(employees.businessId, args.businessId)))
    .limit(1);
  if (!emp) throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
  if (emp.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Only current employees can be given a login." });

  const [existingLogin] = await args.db.select({ id: employeeLogins.id, userId: employeeLogins.userId }).from(employeeLogins).where(eq(employeeLogins.employeeId, emp.id)).limit(1);
  if (existingLogin) {
    // A link whose person was removed from the organisation by other means (Team page) is stale: clear it.
    const [stillMember] = await controlDb
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, args.tenantId), eq(tenantMembers.userId, existingLogin.userId)))
      .limit(1);
    if (stillMember) throw new TRPCError({ code: "CONFLICT", message: "This employee already has a login. Remove it first to invite a different email." });
    await args.db.delete(employeeLogins).where(eq(employeeLogins.id, existingLogin.id));
  }

  // The address may already belong to a user of this organisation.
  const [existingUser] = await controlDb.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${args.email}`).limit(1);
  if (existingUser) {
    const [member] = await controlDb
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, args.tenantId), eq(tenantMembers.userId, existingUser.id)))
      .limit(1);
    if (member && member.role !== EMPLOYEE_ROLE) {
      throw new TRPCError({ code: "CONFLICT", message: "This email already belongs to a team member of the organisation. Use a different email address for the employee login." });
    }
    const [other] = await args.db
      .select({ id: employeeLogins.id })
      .from(employeeLogins)
      .where(and(eq(employeeLogins.businessId, args.businessId), eq(employeeLogins.userId, existingUser.id)))
      .limit(1);
    if (other) throw new TRPCError({ code: "CONFLICT", message: "This email is already linked to another employee in this business." });
  }
  // The same address cannot be invited for two different employees of one business at once.
  const now = new Date();
  const [clash] = await controlDb
    .select({ id: invitations.id, employeeId: invitations.employeeId })
    .from(invitations)
    .where(and(
      eq(invitations.tenantId, args.tenantId),
      eq(invitations.businessId, args.businessId),
      sql`lower(${invitations.email}) = ${args.email}`,
      isNull(invitations.acceptedAt),
      gt(invitations.expiresAt, now),
    ))
    .limit(1);
  if (clash && clash.employeeId !== emp.id) {
    throw new TRPCError({ code: "CONFLICT", message: "This email has a pending employee invitation for another employee." });
  }

  const replaced = (await expirePendingFor(emp.id, args.businessId)) > 0;
  const token = nanoid(32);
  const expiresAt = new Date(now.getTime() + EMPLOYEE_INVITE_DAYS * 24 * 60 * 60 * 1000);
  await controlDb.insert(invitations).values({
    tenantId: args.tenantId,
    email: args.email,
    role: EMPLOYEE_ROLE,
    token: hashInvitationToken(token),
    invitedBy: args.inviter.id,
    expiresAt,
    employeeId: emp.id,
    businessId: args.businessId,
  });

  const [tenant] = await controlDb.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, args.tenantId)).limit(1);
  const [biz] = await args.db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, args.businessId)).limit(1);
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5173}`;
  const inviteUrl = `${baseUrl}/invite/${token}`;
  // Fire and forget, like every invitation: a mail failure never blocks creating it (HR can resend).
  emailService
    .sendInvitation(args.email, inviteUrl, biz?.name ?? tenant?.name ?? "Organization", args.inviter.name, EMPLOYEE_ROLE)
    .catch((err) => logger.error({ err }, "Employee invitation email failed"));

  await recordAccessEvent({
    kind: "invited",
    actorId: args.inviter.id,
    tenantId: args.tenantId,
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
    role: EMPLOYEE_ROLE,
    email: args.email,
    inviteeUserId: existingUser?.id ?? null,
  });
  await logAudit(args.db, {
    businessId: args.businessId,
    userId: args.inviter.id,
    action: replaced ? "payroll.employeeLogin.reinvite" : "payroll.employeeLogin.invite",
    entityType: "employee",
    entityId: emp.id,
    metadata: { employeeCode: emp.employeeCode },
    ipAddress: args.ip ?? null,
  });
  return { inviteUrl, token, expiresAt, replaced };
}

// ── Accepting ────────────────────────────────────────────────────────────────

export interface AcceptableInvitation {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  employeeId: string | null;
  businessId: string | null;
  invitedBy: string | null;
  acceptedAt: Date | null;
}

/**
 * Accept an employee invitation for the signed-in user (the caller has already checked the invited email
 * matches). Idempotent for the same user. Creates the organisation membership (role employee), the
 * membership of exactly this business, and the employee link.
 */
export async function acceptEmployeeInvitation(
  inv: AcceptableInvitation,
  user: { id: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  if (!inv.employeeId || !inv.businessId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired invitation" });
  }
  const db = await getTenantDb(inv.tenantId);
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, inv.employeeId), eq(employees.businessId, inv.businessId))).limit(1);
  if (!emp || emp.status !== "active") {
    throw new TRPCError({ code: "NOT_FOUND", message: "This invitation is no longer valid. Ask HR to send a new one." });
  }
  const [taken] = await db.select({ userId: employeeLogins.userId }).from(employeeLogins).where(eq(employeeLogins.employeeId, emp.id)).limit(1);
  if (taken && taken.userId !== user.id) {
    throw new TRPCError({ code: "CONFLICT", message: "This employee already has a login." });
  }
  const [mine] = await db
    .select({ employeeId: employeeLogins.employeeId })
    .from(employeeLogins)
    .where(and(eq(employeeLogins.businessId, inv.businessId), eq(employeeLogins.userId, user.id)))
    .limit(1);
  if (mine && mine.employeeId !== emp.id) {
    throw new TRPCError({ code: "CONFLICT", message: "Your login is already linked to another employee record in this business." });
  }
  const [member] = await controlDb
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, inv.tenantId), eq(tenantMembers.userId, user.id)))
    .limit(1);
  if (member && member.role !== EMPLOYEE_ROLE) {
    throw new TRPCError({ code: "CONFLICT", message: "You are already a team member of this organisation. Ask HR to use a different email for your employee login." });
  }

  // Tenant database first (idempotent), then the control database.
  await db.insert(businessMembers).values({ businessId: inv.businessId, userId: user.id, role: "member" }).onConflictDoNothing();
  await db.insert(employeeLogins).values({ businessId: inv.businessId, employeeId: emp.id, userId: user.id, createdByUserId: inv.invitedBy }).onConflictDoNothing();

  const now = new Date();
  await controlDb.transaction(async (tx) => {
    if (!inv.acceptedAt) {
      const claimed = await tx
        .update(invitations)
        .set({ acceptedAt: now })
        .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)))
        .returning({ id: invitations.id });
      if (claimed.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "This invitation has already been used or has expired." });
    }
    if (!member) {
      await tx.insert(tenantMembers).values({ tenantId: inv.tenantId, userId: user.id, role: EMPLOYEE_ROLE, invitedBy: inv.invitedBy ?? undefined, acceptedAt: now });
    }
  });
  invalidateTenantMembership(inv.tenantId, user.id);
  invalidateTwoFactorGateMember(inv.tenantId, user.id);

  await recordAccessEvent({ kind: "accepted", actorId: user.id, tenantId: inv.tenantId, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, role: EMPLOYEE_ROLE });
  await logAudit(db, {
    businessId: inv.businessId,
    userId: user.id,
    action: "payroll.employeeLogin.accept",
    entityType: "employee",
    entityId: emp.id,
    metadata: { employeeCode: emp.employeeCode },
    ipAddress: meta.ip ?? null,
    role: EMPLOYEE_ROLE,
  });
}

// ── Ending access ────────────────────────────────────────────────────────────

export interface RevokeArgs {
  tenantId: string;
  db: TenantDatabase;
  businessId: string;
  employeeId: string;
  actor: { id: string };
  reason: "removed" | "exited";
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * End an employee's login: pending invitations expire, the link and the business membership go, and when
 * this was the person's last employee link in the organisation (and their role there is "employee") the
 * organisation membership, API keys and sessions go too. Safe to call twice.
 */
export async function revokeEmployeeAccess(args: RevokeArgs): Promise<{ revoked: boolean; invitationsExpired: number }> {
  const invitationsExpired = await expirePendingFor(args.employeeId, args.businessId);
  const [login] = await args.db
    .select()
    .from(employeeLogins)
    .where(and(eq(employeeLogins.employeeId, args.employeeId), eq(employeeLogins.businessId, args.businessId)))
    .limit(1);
  if (!login) return { revoked: false, invitationsExpired };

  await args.db.delete(employeeLogins).where(eq(employeeLogins.id, login.id));
  await args.db.delete(businessMembers).where(and(eq(businessMembers.businessId, args.businessId), eq(businessMembers.userId, login.userId)));

  const bizIds = await tenantBusinessIds(args.db, args.tenantId);
  const [{ n }] = await args.db
    .select({ n: sql<number>`count(*)::int` })
    .from(employeeLogins)
    .where(and(eq(employeeLogins.userId, login.userId), inArray(employeeLogins.businessId, bizIds.length ? bizIds : [args.businessId])));
  if (n === 0) {
    const [member] = await controlDb
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, args.tenantId), eq(tenantMembers.userId, login.userId)))
      .limit(1);
    if (member?.role === EMPLOYEE_ROLE) {
      await removeTenantMember(
        { tenantId: args.tenantId, actor: { id: args.actor.id, role: "admin" }, targetUserId: login.userId, ip: args.ip, userAgent: args.userAgent },
        removalStore,
      );
    }
  } else {
    invalidateTenantMembership(args.tenantId, login.userId);
    invalidateTwoFactorGateMember(args.tenantId, login.userId);
  }
  await logAudit(args.db, {
    businessId: args.businessId,
    userId: args.actor.id,
    action: args.reason === "exited" ? "payroll.employeeLogin.revokeOnExit" : "payroll.employeeLogin.revoke",
    entityType: "employee",
    entityId: args.employeeId,
    metadata: { reason: args.reason },
    ipAddress: args.ip ?? null,
  });
  return { revoked: true, invitationsExpired };
}

// ── The HR view ──────────────────────────────────────────────────────────────

export type LoginState = "none" | "invited" | "active";

export interface LoginStatusRow {
  employeeId: string;
  state: LoginState;
  /** The invited address (pending) or the linked account's address (active). */
  email: string | null;
  invitationExpiresAt: Date | null;
  linkedAt: Date | null;
}

export async function loginStatuses(db: TenantDatabase, tenantId: string, businessId: string): Promise<Map<string, LoginStatusRow>> {
  const out = new Map<string, LoginStatusRow>();
  const links = await db.select().from(employeeLogins).where(eq(employeeLogins.businessId, businessId));
  const linkUsers = links.length
    ? await controlDb.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, links.map((l) => l.userId)))
    : [];
  const emailOf = new Map(linkUsers.map((u) => [u.id, u.email]));
  for (const l of links) {
    out.set(l.employeeId, { employeeId: l.employeeId, state: "active", email: emailOf.get(l.userId) ?? null, invitationExpiresAt: null, linkedAt: l.createdAt });
  }
  const pending = await controlDb
    .select({ employeeId: invitations.employeeId, email: invitations.email, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.businessId, businessId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
  for (const p of pending) {
    if (p.employeeId && !out.has(p.employeeId)) {
      out.set(p.employeeId, { employeeId: p.employeeId, state: "invited", email: p.email, invitationExpiresAt: p.expiresAt, linkedAt: null });
    }
  }
  return out;
}
