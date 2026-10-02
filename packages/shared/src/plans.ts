/**
 * Plan catalogue — the built-in plan definitions.
 *
 * A platform admin can edit any plan (name, price, features, limits); the
 * edits live in the plan_settings table and replace these defaults. The API
 * merges the two (packages/api/src/lib/plan-catalog.ts), enforces the merged
 * limits and serves them to the pricing page and plan picker, so what a
 * visitor reads is exactly what the backend applies.
 */

import { z } from "zod";

export const PLAN_IDS = ["forever_free", "free", "pro", "business", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

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

/** Every plan with its built-in definition, in display order. */
export interface PlanDefinition extends PlanInfo {
  /** Shown on the pricing page and in the sign-up plan picker. */
  visible: boolean;
  limits: PlanLimits;
}

const HIDDEN_PLANS: Record<"free" | "enterprise", PlanInfo> = {
  free: {
    id: "free",
    name: "Free (legacy)",
    tagline: "Older organisations",
    monthlyPriceInr: 0,
    features: ["One business", "Up to 3 team members"],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For large organisations",
    monthlyPriceInr: null,
    features: ["Everything in Business", "Custom agreement"],
  },
};

export const PLAN_DEFAULTS: Record<PlanId, PlanDefinition> = Object.fromEntries(
  PLAN_IDS.map((id) => {
    const listed = PLANS.find((p) => p.id === id);
    const info = listed ?? HIDDEN_PLANS[id as "free" | "enterprise"];
    return [id, { ...info, features: [...info.features], visible: !!listed, limits: { ...PLAN_LIMITS[id] } }];
  }),
) as Record<PlanId, PlanDefinition>;

// ── Editing plans (platform admin) ─────────────────────────────────────────

/** A number limit: a whole number, or null for unlimited. */
const countLimit = z.number().int().min(0).max(1_000_000).nullable();

/** What a platform admin can set for a plan. Number limits use null for unlimited. */
export const planSettingsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(120),
  monthlyPriceInr: z.number().int().min(0).max(10_000_000).nullable(),
  features: z.array(z.string().trim().min(1).max(160)).max(15),
  highlight: z.boolean(),
  visible: z.boolean(),
  limits: z.object({
    maxOwnedOrgs: countLimit,
    maxBusinesses: countLimit,
    maxTeamMembers: countLimit,
    maxConcurrentSessions: countLimit.refine((v) => v === null || v >= 1, "At least one session"),
    maxApiKeys: countLimit,
    recurringRunsPerMonth: countLimit,
    auditRetentionDays: countLimit,
    dataExport: z.boolean(),
    onlineStore: z.boolean(),
    pdfBranding: z.boolean(),
  }),
});
export type PlanSettings = z.infer<typeof planSettingsSchema>;
export type StoredPlanLimits = PlanSettings["limits"];

/** Limits as stored and sent over JSON: Infinity becomes null. */
export function limitsToStored(limits: PlanLimits): StoredPlanLimits {
  const n = (v: number | null) => (v === null || v === Infinity ? null : v);
  return {
    maxOwnedOrgs: n(limits.maxOwnedOrgs),
    maxBusinesses: n(limits.maxBusinesses),
    maxTeamMembers: n(limits.maxTeamMembers),
    maxConcurrentSessions: n(limits.maxConcurrentSessions),
    maxApiKeys: n(limits.maxApiKeys),
    recurringRunsPerMonth: n(limits.recurringRunsPerMonth),
    auditRetentionDays: limits.auditRetentionDays,
    dataExport: limits.dataExport,
    onlineStore: limits.onlineStore,
    pdfBranding: limits.pdfBranding,
  };
}

/**
 * Limits the API enforces, from stored ones: null becomes Infinity (except
 * audit retention, where null already means unlimited). Anything missing or
 * malformed falls back to the given defaults.
 */
export function limitsFromStored(stored: Partial<Record<keyof PlanLimits, unknown>> | null | undefined, fallback: PlanLimits): PlanLimits {
  const count = (key: Exclude<keyof PlanLimits, "auditRetentionDays" | "dataExport" | "onlineStore" | "pdfBranding">) => {
    const v = stored?.[key];
    if (v === null) return Infinity;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback[key];
  };
  const flag = (key: "dataExport" | "onlineStore" | "pdfBranding") => {
    const v = stored?.[key];
    return typeof v === "boolean" ? v : fallback[key];
  };
  const retention = stored?.auditRetentionDays;
  return {
    maxOwnedOrgs: count("maxOwnedOrgs"),
    maxBusinesses: count("maxBusinesses"),
    maxTeamMembers: count("maxTeamMembers"),
    maxConcurrentSessions: count("maxConcurrentSessions"),
    maxApiKeys: count("maxApiKeys"),
    recurringRunsPerMonth: count("recurringRunsPerMonth"),
    auditRetentionDays:
      retention === null ? null : typeof retention === "number" && retention >= 0 ? retention : fallback.auditRetentionDays,
    dataExport: flag("dataExport"),
    onlineStore: flag("onlineStore"),
    pdfBranding: flag("pdfBranding"),
  };
}

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

// ── Checkout amounts ───────────────────────────────────────────────────────

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** GST charged on a subscription. */
export const PLAN_GST_RATE_PERCENT = 18;

export interface PlanCheckoutAmount {
  /** Plan price for the cycle, before GST, in paise. */
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
}

/** Yearly billing gives 2 months free: a year costs 10 months. */
export const YEARLY_CYCLE_MONTHS = 10;

/**
 * What a plan costs for one billing cycle, in paise, with 18% GST on top.
 * Plans carry a monthly price only; a year is ten months (2 months free).
 * Integer math: prices are whole rupees, so 18% of them is always a whole
 * number of paise.
 */
export function planCheckoutAmount(monthlyPriceInr: number, cycle: BillingCycle): PlanCheckoutAmount {
  const months = cycle === "yearly" ? YEARLY_CYCLE_MONTHS : 1;
  const basePaise = monthlyPriceInr * 100 * months;
  const gstPaise = Math.round((basePaise * PLAN_GST_RATE_PERCENT) / 100);
  return { basePaise, gstPaise, totalPaise: basePaise + gstPaise };
}
