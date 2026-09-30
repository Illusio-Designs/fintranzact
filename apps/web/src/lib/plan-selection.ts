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
