/**
 * Whether the sign-up plan picker may change the organisation's plan.
 * Mirrors tenant.updatePlan on the API: only the owner changes the plan, and
 * an organisation with a bought plan changes it in Billing instead —
 * the API refuses a change here once a plan is bought.
 */

/** Tenant roles that manage billing. */
const PLAN_MANAGER_ROLES: readonly string[] = ["owner", "superadmin"];

export interface CurrentTenantPlan {
  role: string;
  tenantPlan: string;
}

export type PlanSelectionMode =
  /** The owner of a free organisation: saving the choice is allowed. */
  | "choose"
  /** On a paid plan: keep it, the Fintranzact team changes it. */
  | "managed"
  /** Not the owner: the plan is left as it is. */
  | "not-owner";

export function planSelectionMode(tenant: CurrentTenantPlan | null | undefined): PlanSelectionMode {
  if (!tenant) return "choose";
  if (!PLAN_MANAGER_ROLES.includes(tenant.role)) return "not-owner";
  return "choose";
}

export interface TenantPlanChoice {
  role: string;
  /** When the owner chose a plan; null until they do (new sign-ups). */
  planSelectedAt: string | null;
}

/**
 * Whether the signed-in user must choose a plan before going on: only the
 * owner (or a superadmin) of an organisation that has not chosen one yet.
 * Other roles are never held up by it.
 */
export function needsPlanSelection(tenant: TenantPlanChoice | null | undefined): boolean {
  if (!tenant) return false;
  return tenant.planSelectedAt === null && PLAN_MANAGER_ROLES.includes(tenant.role);
}
