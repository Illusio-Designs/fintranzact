/**
 * Subscription billing — add-on catalogue, cycle amounts and proration.
 *
 * Plans themselves live in plans.ts; this file covers how plans and add-ons
 * are *bought*: billing cycles, the paid add-ons sold alongside plans
 * (AI Assistant, Payroll, Store Pro), and the shared money math used by the
 * checkout, the subscription service and the billing page.
 */

import { isStateCode } from "./indian-states.js";
import { stateCodeFromGstin } from "./party-compliance.js";
import { PLAN_GST_RATE_PERCENT, planCheckoutAmount, type BillingCycle, type PlanCheckoutAmount } from "./plans.js";

// ── Add-ons ────────────────────────────────────────────────────────────────

export const ADDON_IDS = ["ai_assistant", "ai_plus", "payroll", "store_pro"] as const;
export type AddonId = (typeof ADDON_IDS)[number];

export interface AddonInfo {
  id: AddonId;
  name: string;
  tagline: string;
  /** Monthly price in rupees, ex-GST. */
  monthlyPriceInr: number;
  features: string[];
  /** AI Assistant and AI Plus are tiers of one add-on: buying one replaces the other. */
  group: "ai" | "payroll" | "store";
}

/**
 * The paid add-ons. Prices are the launch prices from the roadmap, ex-18% GST;
 * Payroll is billed at its ₹499 monthly minimum until per-employee counting
 * ships with Payroll phase 1.
 */
export const ADDONS: AddonInfo[] = [
  {
    id: "ai_assistant",
    name: "AI Assistant",
    tagline: "150 questions a month",
    monthlyPriceInr: 399,
    features: ["Ask questions about your business", "Answers from live data", "English, Hindi and Hinglish"],
    group: "ai",
  },
  {
    id: "ai_plus",
    name: "AI Plus",
    tagline: "500 questions a month",
    monthlyPriceInr: 999,
    features: ["Everything in AI Assistant", "500 questions a month", "Priority replies"],
    group: "ai",
  },
  {
    id: "payroll",
    name: "Payroll",
    tagline: "Up to 10 employees, then ₹49 per employee",
    monthlyPriceInr: 499,
    features: ["Employees, attendance and leave", "Monthly payroll run and payslips", "PF / ESI / PT / TDS"],
    group: "payroll",
  },
  {
    id: "store_pro",
    name: "Store Pro",
    tagline: "Your store on your own domain",
    monthlyPriceInr: 499,
    features: ["Custom domain", "Themes and page builder", "Online payments at checkout"],
    group: "store",
  },
];

export function addonById(id: string): AddonInfo | undefined {
  return ADDONS.find((a) => a.id === id);
}

// ── Cycle amounts ──────────────────────────────────────────────────────────

export type CycleAmount = PlanCheckoutAmount;

/**
 * What a monthly price costs for one billing cycle, in paise, with 18% GST on
 * top. Same math as plan checkout (plans.ts): yearly gives 2 months free.
 */
export function cycleAmount(monthlyPriceInr: number, cycle: BillingCycle, yearlyPriceInr?: number | null): CycleAmount {
  return planCheckoutAmount(monthlyPriceInr, cycle, yearlyPriceInr);
}

/** GST on a base amount already expressed in paise. */
export function gstOnPaise(basePaise: number): number {
  return Math.round((basePaise * PLAN_GST_RATE_PERCENT) / 100);
}

// ── Subscriptions ──────────────────────────────────────────────────────────

export const SUBSCRIPTION_KINDS = ["plan", "addon"] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];

/**
 * created    — checkout started, first payment not confirmed yet
 * active     — paid up for the current period
 * past_due   — a renewal failed; the gateway retries during the grace period
 * halted     — grace over without payment; the organisation goes read-only
 * cancelled  — ended (by the owner, the admin or the gateway)
 */
export const SUBSCRIPTION_STATUSES = ["created", "active", "past_due", "halted", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  created: "Awaiting payment",
  active: "Active",
  past_due: "Payment failed",
  halted: "On hold",
  cancelled: "Cancelled",
};

/** A subscription that still entitles the organisation to what it bought. */
export function subscriptionIsLive(status: SubscriptionStatus): boolean {
  return status === "active" || status === "past_due";
}

/** How long a failed renewal may retry before the organisation goes read-only. */
export const BILLING_GRACE_DAYS = 7;

/** The next period for a cycle starting at `from` (calendar month / year, IST-agnostic). */
export function nextPeriodEnd(from: Date, cycle: BillingCycle): Date {
  const end = new Date(from);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

// ── Proration ──────────────────────────────────────────────────────────────

/**
 * Credit for the unused part of the current period when a plan is upgraded
 * mid-cycle: the period's base price times the fraction of it still ahead.
 * Clamped so clock skew can never produce a negative or over-full credit.
 */
export function prorationCreditPaise(opts: {
  basePaise: number;
  periodStart: Date;
  periodEnd: Date;
  at?: Date;
}): number {
  const at = opts.at ?? new Date();
  const whole = opts.periodEnd.getTime() - opts.periodStart.getTime();
  if (whole <= 0) return 0;
  const left = opts.periodEnd.getTime() - at.getTime();
  const fraction = Math.min(1, Math.max(0, left / whole));
  return Math.round(opts.basePaise * fraction);
}

// ── GST on Finvera's own invoices: place of supply ─────────────────────────

export interface BillingPlaceOfSupply {
  /** The state that decides the tax: from the GSTIN, else the billing state; null when unknown. */
  stateCode: string | null;
  source: "gstin" | "state" | "none";
  /** Same state as the seller: CGST + SGST. Otherwise (including unknown) IGST. */
  intraState: boolean;
  /** Both a GSTIN and a different billing state were given; the GSTIN won. */
  stateMismatch: boolean;
}

/**
 * Which GST applies to a subscription invoice. A valid GSTIN decides (a
 * registered buyer's place of supply is its registered state); without one the
 * billing state does; with neither it is IGST, the safe default. The free-text
 * address is never used. An invalid GSTIN counts as none.
 */
export function billingPlaceOfSupply(
  customer: { gstin?: string | null; state?: string | null },
  sellerStateCode: string,
): BillingPlaceOfSupply {
  const fromGstin = stateCodeFromGstin(customer.gstin);
  const given = isStateCode(customer.state) ? customer.state : null;
  const stateCode = fromGstin ?? given;
  return {
    stateCode,
    source: fromGstin ? "gstin" : given ? "state" : "none",
    intraState: !!stateCode && stateCode === sellerStateCode,
    stateMismatch: !!fromGstin && !!given && fromGstin !== given,
  };
}
