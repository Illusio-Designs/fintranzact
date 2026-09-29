/**
 * Plan catalogue — the single source of truth for plans.
 *
 * The API enforces `PLAN_LIMITS` (see packages/api/src/lib/plan-limits.ts) and
 * the web app renders the pricing page and plan picker from `PLANS`, so the
 * limits a visitor reads are exactly the limits the backend applies.
 */

export type PlanId = "forever_free" | "free" | "pro" | "business" | "enterprise";

export interface PlanLimits {
  maxOwnedOrgs: number; // orgs a user can own (across all their tenants)
  maxBusinesses: number; // businesses per tenant
  maxTeamMembers: number; // members + pending invites per tenant
  maxConcurrentSessions: number;
  maxApiKeys: number;
  recurringRunsPerMonth: number;
  auditRetentionDays: number | null; // null = unlimited
  dataExport: boolean;
  onlineStore: boolean;
  pdfBranding: boolean; // true = shows "Powered by Fintranzact"
}

const UNLIMITED: PlanLimits = {
  maxOwnedOrgs: Infinity,
  maxBusinesses: Infinity,
  maxTeamMembers: Infinity,
  maxConcurrentSessions: Infinity,
  maxApiKeys: Infinity,
  recurringRunsPerMonth: Infinity,
  auditRetentionDays: null,
  dataExport: true,
  onlineStore: true,
  pdfBranding: false,
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  forever_free: { ...UNLIMITED },
  // Legacy plan for older organizations; not offered to new sign-ups.
  free: {
    maxOwnedOrgs: 1,
    maxBusinesses: 1,
    maxTeamMembers: 3,
    maxConcurrentSessions: 3,
    maxApiKeys: 0,
    recurringRunsPerMonth: 5,
    auditRetentionDays: 30,
    dataExport: false,
    onlineStore: false,
    pdfBranding: true,
  },
  pro: {
    maxOwnedOrgs: 3,
    maxBusinesses: 5,
    maxTeamMembers: 15,
    maxConcurrentSessions: 10,
    maxApiKeys: 3,
    recurringRunsPerMonth: Infinity,
    auditRetentionDays: 365,
    dataExport: true,
    onlineStore: true,
    pdfBranding: false,
  },
  business: { ...UNLIMITED },
  enterprise: { ...UNLIMITED },
};

export interface PlanInfo {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in rupees; 0 = free; null = priced on request. */
  monthlyPriceInr: number | null;
  features: string[];
  highlight?: boolean;
}

/** Plans offered on the pricing page and in the sign-up plan picker, in display order. */
export const PLANS: PlanInfo[] = [
  {
    id: "forever_free",
    name: "Forever Free",
    tagline: "Unlimited for life",
    monthlyPriceInr: 0,
    features: [
      "Unlimited invoices, parties, and payments",
      "Unlimited businesses and team members",
      "Unlimited API access",
      "No branding or paywall",
    ],
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Best for growing teams",
    monthlyPriceInr: null,
    features: ["Advanced automation and workflows", "Priority support", "Expanded collaboration"],
  },
  {
    id: "business",
    name: "Business",
    tagline: "Scale without limits",
    monthlyPriceInr: null,
    features: ["Multi-tenant controls", "Premium reporting", "Dedicated onboarding"],
  },
];

/** "₹0", "₹1,499" or "Custom" for plans priced on request. */
export function formatPlanPrice(plan: Pick<PlanInfo, "monthlyPriceInr">): string {
  if (plan.monthlyPriceInr === null) return "Custom";
  return "₹" + plan.monthlyPriceInr.toLocaleString("en-IN");
}

/** "Unlimited", "5", "1 year", "30 days" — a plan limit as shown to people. */
export function formatPlanLimit(value: number | null, unit?: "days"): string {
  if (value === null || value === Infinity) return "Unlimited";
  if (unit === "days") {
    if (value % 365 === 0) return value === 365 ? "1 year" : `${value / 365} years`;
    return `${value} days`;
  }
  return value.toLocaleString("en-IN");
}
