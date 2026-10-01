/**
 * Whether the sign-up plan picker may change the organisation's plan.
 * Mirrors tenant.updatePlan on the API: only the owner changes the plan, and
 * an organisation on a paid plan (set up by the Fintranzact team) keeps it —
 * choosing a free plan here must never reset it.
 */

/** Tenant roles that manage billing. */
const PLAN_MANAGER_ROLES: readonly string[] = ["owner", "superadmin"];
/** ₹0 plans; every other plan is paid. */
const FREE_PLAN_IDS: readonly string[] = ["forever_free", "free"];

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
  if (!FREE_PLAN_IDS.includes(tenant.tenantPlan)) return "managed";
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
