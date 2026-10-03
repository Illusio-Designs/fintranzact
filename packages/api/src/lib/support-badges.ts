/**
 * The operational plan flags (prioritySupport, onboardingHelp) as badges for
 * the support team: nothing in the app is locked by them. Read from the same
 * entitlement features as everything else (trial = Business-level,
 * grandfathered = everything), so the team sees what the customer was promised.
 */

import { getEntitlements } from "./entitlements.js";

export interface SupportBadges {
  priority: boolean;
  onboarding: boolean;
  /** "Priority support", "Onboarding help included": the labels shown next to a submission or an organisation. */
  labels: string[];
}

export async function supportBadges(tenantId: string): Promise<SupportBadges> {
  try {
    const { features } = await getEntitlements(tenantId);
    const labels: string[] = [];
    if (features.prioritySupport) labels.push("Priority support");
    if (features.onboardingHelp) labels.push("Onboarding help included");
    return { priority: features.prioritySupport, onboarding: features.onboardingHelp, labels };
  } catch {
    return { priority: false, onboarding: false, labels: [] };
  }
}
