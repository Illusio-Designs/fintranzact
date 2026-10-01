import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { controlDb, tenantMembers } from "@fintranzact/db";

/** Tenant roles that manage billing, and so may change the organisation's plan. */
export const PLAN_MANAGER_ROLES: string[] = ["owner", "superadmin"];

/**
 * The organisation whose plan the caller is changing: the selected one, or
 * (before one is selected, e.g. right after sign-up) the one they own.
 * Throws unless the caller is that organisation's owner (or a superadmin).
 */
export async function requirePlanManagerTenant(ctx: { tenantId: string | null; user: { id: string } }): Promise<string> {
  const tenantId = ctx.tenantId ?? (
    await controlDb.select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.userId, ctx.user.id),
        eq(tenantMembers.role, "owner"),
      ))
      .limit(1)
  )[0]?.tenantId ?? null;

  if (!tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No organization selected to update." });
  }

  // The plan is billing: only the organisation's owner may change it.
  const [membership] = await controlDb.select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, ctx.user.id)))
    .limit(1);
  if (!membership || !PLAN_MANAGER_ROLES.includes(membership.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the organization owner can change the plan." });
  }
  return tenantId;
}
