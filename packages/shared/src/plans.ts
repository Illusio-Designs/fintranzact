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

/** The three paid plans, cheapest first. There is no free plan. */
export const PLAN_IDS = ["starter", "growth", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Display order of the plans (cheapest first). */
export const PLAN_ORDER: readonly PlanId[] = PLAN_IDS;

/** Yearly billing gives 2 months free: a year costs 10 months. */
export const YEARLY_SAVING_MONTHS = 2;
export const YEARLY_CYCLE_MONTHS = 12 - YEARLY_SAVING_MONTHS;

/** GST charged on a subscription. Plan prices are ex-GST. */
export const PLAN_GST_RATE_PERCENT = 18;

/** Days of Full Access Trial a new organisation starts with (P2: editable in admin later). */
export const TRIAL_DAYS = 14;

/** The plan a new sign-up gets when it names none (or an unknown one). */
export const DEFAULT_SIGNUP_PLAN: PlanId = "growth";

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export interface PlanLimits {
  maxOwnedOrgs: number; // orgs a user can own (across all their tenants)
  maxBusinesses: number; // businesses per tenant
  maxTeamMembers: number; // members + pending invites per tenant
  maxConcurrentSessions: number;
  maxApiKeys: number; // 0 = no API access
  recurringRunsPerMonth: number;
  auditRetentionDays: number | null; // null = unlimited (full audit history)
  dataExport: boolean;
  onlineStore: boolean;
  pdfBranding: boolean; // true = shows "Powered by Fintranzact"; false on every plan
  // Feature flags. Editable per plan in the admin console and shown on the
  // pricing page. Only the flags listed in PLAN_FLAGS_ENFORCED are enforced by
  // the API today; the rest describe the plan and gate nothing yet.
  gstReports: boolean;
  eWayBills: boolean;
  recurringInvoices: boolean;
  pos: boolean;
  eInvoicing: boolean;
  multiWarehouse: boolean;
  batchesExpiry: boolean;
  bankReconciliation: boolean;
  manufacturing: boolean;
  approvals: boolean;
  prioritySupport: boolean;
  onboardingHelp: boolean;
}

/** Boolean feature flags in PlanLimits. */
export const PLAN_FLAG_KEYS = [
  "dataExport",
  "onlineStore",
  "pdfBranding",
  "gstReports",
  "eWayBills",
  "recurringInvoices",
  "pos",
  "eInvoicing",
  "multiWarehouse",
  "batchesExpiry",
  "bankReconciliation",
  "manufacturing",
  "approvals",
  "prioritySupport",
  "onboardingHelp",
] as const;
export type PlanFlagKey = (typeof PLAN_FLAG_KEYS)[number];

/** Number limits in PlanLimits (null/Infinity = unlimited; auditRetentionDays uses null). */
export const PLAN_COUNT_KEYS = [
  "maxOwnedOrgs",
  "maxBusinesses",
  "maxTeamMembers",
  "maxConcurrentSessions",
  "maxApiKeys",
  "recurringRunsPerMonth",
] as const;
export type PlanCountKey = (typeof PLAN_COUNT_KEYS)[number];

/**
 * Flags the API enforces today. Everything else in PLAN_FLAG_KEYS is
 * descriptive until its feature gets an enforcement hook. (API access is the
 * maxApiKeys limit: 0 means none.)
 */
export const PLAN_FLAGS_ENFORCED: readonly PlanFlagKey[] = ["dataExport", "onlineStore", "pdfBranding"];

const STARTER_LIMITS: PlanLimits = {
  maxOwnedOrgs: 1,
  maxBusinesses: 1,
  maxTeamMembers: 3,
  maxConcurrentSessions: 3,
  maxApiKeys: 0,
  recurringRunsPerMonth: Infinity,
  auditRetentionDays: 30,
  dataExport: false,
  onlineStore: false,
  pdfBranding: false,
  gstReports: true,
  eWayBills: true,
  recurringInvoices: true,
  pos: true,
  eInvoicing: false,
  multiWarehouse: false,
  batchesExpiry: false,
  bankReconciliation: false,
  manufacturing: false,
  approvals: false,
  prioritySupport: false,
  onboardingHelp: false,
};

const GROWTH_LIMITS: PlanLimits = {
  ...STARTER_LIMITS,
  maxOwnedOrgs: 3,
  maxBusinesses: 3,
  maxTeamMembers: 10,
  maxConcurrentSessions: 10,
  maxApiKeys: 3,
  auditRetentionDays: 365,
  dataExport: true,
  onlineStore: true,
  eInvoicing: true,
  multiWarehouse: true,
  batchesExpiry: true,
  bankReconciliation: true,
};

const BUSINESS_LIMITS: PlanLimits = {
  ...GROWTH_LIMITS,
  maxOwnedOrgs: Infinity,
  maxBusinesses: Infinity,
  maxTeamMembers: Infinity,
  maxConcurrentSessions: Infinity,
  maxApiKeys: Infinity,
  auditRetentionDays: null,
  manufacturing: true,
  approvals: true,
  prioritySupport: true,
  onboardingHelp: true,
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter: STARTER_LIMITS,
  growth: GROWTH_LIMITS,
  business: BUSINESS_LIMITS,
};

/** Built-in prices in whole rupees, before GST. */
export const PLAN_PRICES: Record<PlanId, { monthlyInr: number; yearlyInr: number }> = {
  starter: { monthlyInr: 299, yearlyInr: 2_999 },
  growth: { monthlyInr: 699, yearlyInr: 6_999 },
  business: { monthlyInr: 1_499, yearlyInr: 14_999 },
};

/**
 * The yearly price when none is set: a year costs 10 months (2 months free).
 * The built-in prices are the published ones (PLAN_PRICES), a few rupees above
 * this, and are stored explicitly.
 */
export function yearlyPrice(monthlyPriceInr: number): number {
  return monthlyPriceInr * YEARLY_CYCLE_MONTHS;
}

/** The yearly price in force: the explicit one, else ten months of the monthly price. Null when priced on request. */
export function effectiveYearlyPriceInr(plan: { monthlyPriceInr: number | null; yearlyPriceInr?: number | null }): number | null {
  if (plan.yearlyPriceInr !== null && plan.yearlyPriceInr !== undefined) return plan.yearlyPriceInr;
  return plan.monthlyPriceInr === null ? null : yearlyPrice(plan.monthlyPriceInr);
}

/** GST on an ex-GST amount in whole rupees or paise: 18%, rounded. */
export function gstOn(amount: number): number {
  return Math.round((amount * PLAN_GST_RATE_PERCENT) / 100);
}

/** An ex-GST amount with 18% GST added. */
export function withGst(amount: number): number {
  return amount + gstOn(amount);
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in rupees, before GST; null = priced on request. */
  monthlyPriceInr: number | null;
  /** Yearly price in rupees, before GST; null = ten times the monthly price. */
  yearlyPriceInr: number | null;
  features: string[];
  highlight?: boolean;
}

/** Plans offered on the pricing page and in the sign-up plan picker, in display order. */
export const PLANS: PlanInfo[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For a single business",
    monthlyPriceInr: PLAN_PRICES.starter.monthlyInr,
    yearlyPriceInr: PLAN_PRICES.starter.yearlyInr,
    features: [
      "1 business and 3 users",
      "Invoices, quotations, payments, parties and items",
      "GST reports and e-way bills",
      "Basic inventory, recurring invoices and POS",
      "No Fintranzact branding on PDFs",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "Best for growing businesses",
    monthlyPriceInr: PLAN_PRICES.growth.monthlyInr,
    yearlyPriceInr: PLAN_PRICES.growth.yearlyInr,
    features: [
      "3 businesses and 10 users",
      "Everything in Starter",
      "e-Invoicing",
      "Multiple warehouses, batches and expiry",
      "Bank reconciliation",
      "Basic online store and API access",
      "Data export",
    ],
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    tagline: "Scale without limits",
    monthlyPriceInr: PLAN_PRICES.business.monthlyInr,
    yearlyPriceInr: PLAN_PRICES.business.yearlyInr,
    features: [
      "Unlimited businesses and users",
      "Everything in Growth",
      "Manufacturing and bill of materials",
      "Approvals",
      "Full audit history",
      "Priority support and onboarding help",
    ],
  },
];

/** Every plan with its built-in definition, in display order. */
export interface PlanDefinition extends PlanInfo {
  /** Shown on the pricing page and in the sign-up plan picker. */
  visible: boolean;
  limits: PlanLimits;
}

export const PLAN_DEFAULTS: Record<PlanId, PlanDefinition> = Object.fromEntries(
  PLANS.map((p) => [p.id, { ...p, features: [...p.features], visible: true, limits: { ...PLAN_LIMITS[p.id] } }]),
) as Record<PlanId, PlanDefinition>;

// ── Editing plans (platform admin) ─────────────────────────────────────────

/** A number limit: a whole number, or null for unlimited. */
const countLimit = z.number().int().min(0).max(1_000_000).nullable();

/** What a platform admin can set for a plan. Number limits use null for unlimited. */
export const planSettingsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(120),
  monthlyPriceInr: z.number().int().min(0).max(10_000_000).nullable(),
  /** Null = ten times the monthly price. */
  yearlyPriceInr: z.number().int().min(0).max(120_000_000).nullable(),
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
    gstReports: z.boolean(),
    eWayBills: z.boolean(),
    recurringInvoices: z.boolean(),
    pos: z.boolean(),
    eInvoicing: z.boolean(),
    multiWarehouse: z.boolean(),
    batchesExpiry: z.boolean(),
    bankReconciliation: z.boolean(),
    manufacturing: z.boolean(),
    approvals: z.boolean(),
    prioritySupport: z.boolean(),
    onboardingHelp: z.boolean(),
  }),
});
export type PlanSettings = z.infer<typeof planSettingsSchema>;
export type StoredPlanLimits = PlanSettings["limits"];

/**
 * Warnings (not errors) about plan settings an admin is about to save. A
 * yearly price above twelve months of the monthly price costs more than paying
 * monthly, which is almost always a typo.
 */
export function planSettingsWarnings(settings: Pick<PlanSettings, "monthlyPriceInr" | "yearlyPriceInr">): string[] {
  const warnings: string[] = [];
  const { monthlyPriceInr: monthly, yearlyPriceInr: yearly } = settings;
  if (monthly !== null && yearly !== null && yearly > monthly * 12) {
    warnings.push("The yearly price is more than 12 months of the monthly price, so paying yearly costs more than paying monthly.");
  }
  if (monthly === null && yearly !== null) {
    warnings.push("A yearly price is set but the monthly price is on request.");
  }
  return warnings;
}

/** Limits as stored and sent over JSON: Infinity becomes null. */
export function limitsToStored(limits: PlanLimits): StoredPlanLimits {
  const n = (v: number | null) => (v === null || v === Infinity ? null : v);
  const out: Record<string, number | boolean | null> = {};
  for (const key of PLAN_COUNT_KEYS) out[key] = n(limits[key]);
  out.auditRetentionDays = limits.auditRetentionDays;
  for (const key of PLAN_FLAG_KEYS) out[key] = limits[key];
  return out as StoredPlanLimits;
}

/**
 * Limits the API enforces, from stored ones: null becomes Infinity (except
 * audit retention, where null already means unlimited). Anything missing or
 * malformed falls back to the given defaults.
 */
export function limitsFromStored(stored: Partial<Record<keyof PlanLimits, unknown>> | null | undefined, fallback: PlanLimits): PlanLimits {
  const out = { ...fallback } as Record<string, number | boolean | null>;
  for (const key of PLAN_COUNT_KEYS) {
    const v = stored?.[key];
    out[key] = v === null ? Infinity : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback[key];
  }
  for (const key of PLAN_FLAG_KEYS) {
    const v = stored?.[key];
    out[key] = typeof v === "boolean" ? v : fallback[key];
  }
  const retention = stored?.auditRetentionDays;
  out.auditRetentionDays =
    retention === null ? null : typeof retention === "number" && retention >= 0 ? retention : fallback.auditRetentionDays;
  return out as unknown as PlanLimits;
}

/** "₹299", "₹1,499" or "Custom" for plans priced on request. */
export function formatPlanPrice(plan: Pick<PlanInfo, "monthlyPriceInr">): string {
  if (plan.monthlyPriceInr === null) return "Custom";
  return "₹" + plan.monthlyPriceInr.toLocaleString("en-IN");
}

/** "₹2,999" or "Custom": the yearly price in force. */
export function formatYearlyPlanPrice(plan: Pick<PlanInfo, "monthlyPriceInr" | "yearlyPriceInr">): string {
  const yearly = effectiveYearlyPriceInr(plan);
  return yearly === null ? "Custom" : "₹" + yearly.toLocaleString("en-IN");
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

export interface PlanCheckoutAmount {
  /** Plan price for the cycle, before GST, in paise. */
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
}

/**
 * What a plan costs for one billing cycle, in paise, with 18% GST on top.
 * The yearly price is the plan's own yearlyPriceInr when it has one, else ten
 * months of the monthly price (2 months free). Integer math: prices are whole
 * rupees, so 18% of them is always a whole number of paise.
 */
export function planCheckoutAmount(monthlyPriceInr: number, cycle: BillingCycle, yearlyPriceInr?: number | null): PlanCheckoutAmount {
  const rupees = cycle === "yearly" ? (yearlyPriceInr ?? yearlyPrice(monthlyPriceInr)) : monthlyPriceInr;
  const basePaise = rupees * 100;
  const gstPaise = Math.round((basePaise * PLAN_GST_RATE_PERCENT) / 100);
  return { basePaise, gstPaise, totalPaise: basePaise + gstPaise };
}
