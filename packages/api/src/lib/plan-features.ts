/**
 * Which plan feature flags an organisation has right now.
 *
 *  - grandfathered organisations (the former Forever Free ones) have everything;
 *  - during an ACTIVE trial the organisation has Business-level features: the
 *    flags of the highest plan as stored (a platform admin's edits count);
 *  - otherwise the flags of the organisation's own plan, as stored.
 *
 * Reads the plan catalogue (admin edits applied, cached 30s, cleared when a
 * plan is saved), never a plan name.
 */

import { PLAN_ORDER, allFeatures, featuresOf, type AccessState, type PlanFeatures, type PlanLimits } from "@fintranzact/shared";
import { getPlanLimits } from "./plan-catalog.js";

export async function resolveFeatures(state: AccessState, planLimits: PlanLimits): Promise<PlanFeatures> {
  // pdfBranding is a display flag (true = the small "Powered by" line prints), not a capability:
  // a trial or grandfathered organisation keeps its own plan's value rather than "everything on".
  const own = { pdfBranding: planLimits.pdfBranding };
  if (state === "grandfathered") return { ...allFeatures(), ...own };
  if (state === "trialing") return { ...featuresOf(await getPlanLimits(PLAN_ORDER[PLAN_ORDER.length - 1]!)), ...own };
  return featuresOf(planLimits);
}
