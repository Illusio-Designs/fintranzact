/**
 * Plan catalogue shown on the public pricing page and during sign-up plan
 * selection. Keep both in sync by editing only this list.
 */

export type PlanId = "forever_free" | "free" | "pro" | "business" | "enterprise";

export const PLAN_OPTIONS: Array<{
  id: PlanId;
  name: string;
  tagline: string;
  price: string;
  features: string[];
  highlight?: boolean;
}> = [
  {
    id: "forever_free",
    name: "Forever Free",
    tagline: "Unlimited for life",
    price: "₹0",
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
    price: "Custom",
    features: [
      "Advanced automation and workflows",
      "Priority support",
      "Expanded collaboration",
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "Scale without limits",
    price: "Custom",
    features: [
      "Multi-tenant controls",
      "Premium reporting",
      "Dedicated onboarding",
    ],
  },
];
