/**
 * Who may use payroll, and how many employees the trial allows.
 *
 * Payroll is the paid add-on `payroll` (packages/shared ADDON_FEATURES) and its
 * data is salary data, so every procedure goes through assertPayroll(): the CASL
 * permission on the "Payroll" subject first (so a role with no access is
 * refused as FORBIDDEN whatever the add-on says), then the add-on entitlement.
 *
 * The add-on is on for an organisation when it is in a Full Access Trial, when
 * it holds an active payroll add-on subscription (including one a platform
 * admin granted), or never otherwise. A read-only organisation (trial over, plan
 * ended) keeps READING the payroll data it already has, like every other
 * module: add-ons are off while read-only, so reads are let through for it and
 * only the writes (already refused by the read-only gate) stay closed.
 */

import { count, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { businesses, employees, tenantMembers, type TenantDatabase } from "@fintranzact/db";
import { requireCan, type Action, type AppAbility } from "../permissions.js";
import { getEntitlements, requireAddon } from "../entitlements.js";
import { entitlementError, limitError } from "../entitlement-error.js";

interface PayrollCtx {
  ability: AppAbility;
  tenantId: string;
}

/**
 * Permission and add-on check for a payroll procedure. `action` is the CASL
 * action on Payroll; anything but "read" counts as a write for the add-on check.
 */
export async function assertPayroll(ctx: PayrollCtx, action: Action): Promise<void> {
  requireCan(ctx.ability, action, "Payroll");
  await assertPayrollAddon(ctx, action);
}

/**
 * Employee self-service (payrollSelf.*): the CASL permission on "PayrollSelf" (only the employee role),
 * then the same add-on rules as the rest of Payroll. Employee logins are included in the Payroll add-on
 * (no per-login charge) but only work while the organisation has it (or its trial).
 */
export async function assertSelfService(ctx: PayrollCtx, action: Action): Promise<void> {
  requireCan(ctx.ability, action, "PayrollSelf");
  await assertPayrollAddon(ctx, action);
}

export async function assertPayrollAddon(ctx: { tenantId: string }, action: Action): Promise<void> {
  if (action !== "read") {
    await requireAddon(ctx.tenantId, "payroll");
    return;
  }
  const ent = await getEntitlements(ctx.tenantId);
  if (ent.addons.payroll) return;
  if (ent.reason === "tenant_suspended") throw entitlementError(ent.reason);
  // Read-only organisation: the add-on is off, but what it already has stays readable.
  if (ent.readOnly) return;
  throw entitlementError("addon_required", { addon: "payroll" });
}

/**
 * Posting to the books (a run's journal entry, its payment, a statutory payment) is bookkeeping:
 * Payroll "update" plus the PayrollPosting permission, which accountants, owners and admins hold
 * and the HR / Payroll manager role does not.
 */
export async function assertPayrollPosting(ctx: PayrollCtx): Promise<void> {
  requireCan(ctx.ability, "create", "PayrollPosting");
  await assertPayroll(ctx, "update");
}

/** True when the signed-in role may see full identity and bank numbers (Payroll "manage": owners and admins). */
export function canSeeSensitive(ability: AppAbility): boolean {
  return ability.can("manage", "Payroll");
}

/** Active employees across the organisation's businesses (what the trial cap counts). */
export async function countOrganisationActiveEmployees(tenantId: string, tenantDb: TenantDatabase): Promise<number> {
  if (process.env.MULTI_TENANT === "true") {
    const [row] = await tenantDb.select({ n: count() }).from(employees).where(eq(employees.status, "active"));
    return row?.n ?? 0;
  }
  const [row] = await tenantDb
    .select({ n: count() })
    .from(employees)
    .innerJoin(businesses, eq(businesses.id, employees.businessId))
    .where(
      sql`${employees.status} = 'active' AND ${businesses.createdByUserId} IN (SELECT ${tenantMembers.userId} FROM ${tenantMembers} WHERE ${tenantMembers.tenantId} = ${tenantId})`,
    );
  return row?.n ?? 0;
}

export const TRIAL_EMPLOYEE_CAP_MESSAGE = (cap: number) =>
  `Your Full Access Trial includes up to ${cap} payroll employee${cap === 1 ? "" : "s"}. Employees who have left do not count. Payroll beyond the trial needs the Payroll add-on.`;

/**
 * During a Full Access Trial the number of ACTIVE employees is capped
 * (`trial.caps.payrollEmployees`, default 10). `adding` is how many are about to
 * become active. Outside a trial there is no cap here (billing per employee is
 * the add-on billing module's job).
 */
export async function enforceEmployeeCap(tenantId: string, tenantDb: TenantDatabase, adding = 1): Promise<void> {
  const ent = await getEntitlements(tenantId);
  if (!ent.trial.active || !ent.trial.caps) return;
  const cap = ent.trial.caps.payrollEmployees;
  const current = await countOrganisationActiveEmployees(tenantId, tenantDb);
  if (current + adding > cap) throw limitError(TRIAL_EMPLOYEE_CAP_MESSAGE(cap));
}

export function notFound(what: string): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: `${what} not found` });
}

export function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

/** A Postgres unique-constraint violation (drizzle wraps the driver error in `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return (e?.code ?? e?.cause?.code) === "23505";
}
