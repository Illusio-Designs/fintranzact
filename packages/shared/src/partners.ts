/**
 * Partner programme: who can apply, what they fill in, and the states an
 * application moves through. Shared by the public form, the API and the
 * platform admin console.
 */

import { z } from "zod";

export const partnerTypes = ["accountant", "reseller", "technology"] as const;
export type PartnerType = (typeof partnerTypes)[number];

export const partnerTypeInfo: Record<PartnerType, { label: string; description: string }> = {
  accountant: {
    label: "Accountant / CA firm",
    description: "Manage clients' books, GST returns and reconciliations from one login.",
  },
  reseller: {
    label: "Reseller / consultant",
    description: "Recommend Fintranzact to businesses you work with and help them get set up.",
  },
  technology: {
    label: "Technology partner",
    description: "Connect your app to Fintranzact through the API.",
  },
};

export const partnerStatuses = ["pending", "approved", "rejected"] as const;
export type PartnerStatus = (typeof partnerStatuses)[number];

export const partnerClientCounts = ["1-10", "11-50", "51-200", "200+"] as const;

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const partnerApplicationSchema = z.object({
  contactName: z.string().trim().min(2, "Enter your name").max(100),
  companyName: z.string().trim().min(2, "Enter your company name").max(150),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{8,16}$/, "Enter a valid phone number"),
  city: z.string().trim().min(2, "Enter your city").max(80),
  state: optionalText(80),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v), "Enter a valid website"),
  partnerType: z.enum(partnerTypes),
  clientCount: z.enum(partnerClientCounts).optional(),
  message: optionalText(1000),
  listPublicly: z.boolean().default(false),
  turnstileToken: z.string().optional(),
});
export type PartnerApplication = z.input<typeof partnerApplicationSchema>;

// ── Referrals, badges and commission ───────────────────────────────────────

/**
 * Badges, from the number of organisations a partner referred that are on a
 * paid plan. Each badge sets the default commission on those organisations'
 * plan price; a platform admin can give a partner a different rate.
 */
export const partnerBadges = [
  { id: "registered", label: "Registered", minPaidReferrals: 0, commissionPercent: 10 },
  { id: "silver", label: "Silver", minPaidReferrals: 5, commissionPercent: 15 },
  { id: "gold", label: "Gold", minPaidReferrals: 15, commissionPercent: 20 },
  { id: "platinum", label: "Platinum", minPaidReferrals: 40, commissionPercent: 25 },
] as const;
export type PartnerBadge = (typeof partnerBadges)[number];
export type PartnerBadgeId = PartnerBadge["id"];

/** The badge a partner has earned with this many paid referrals. */
export function partnerBadgeFor(paidReferrals: number): PartnerBadge {
  let badge: PartnerBadge = partnerBadges[0];
  for (const b of partnerBadges) if (paidReferrals >= b.minPaidReferrals) badge = b;
  return badge;
}

/** The next badge up and how many more paid referrals it needs; null at the top. */
export function nextPartnerBadge(paidReferrals: number): { badge: PartnerBadge; needed: number } | null {
  const next = partnerBadges.find((b) => b.minPaidReferrals > paidReferrals);
  return next ? { badge: next, needed: next.minPaidReferrals - paidReferrals } : null;
}

/** Referral codes look like FTZ-7K2M9Q; people may type them in any case or without the dash. */
export function normalizeReferralCode(code: string | null | undefined): string | null {
  const cleaned = (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return null;
  return cleaned.startsWith("FTZ") && cleaned.length === 9 ? `FTZ-${cleaned.slice(3)}` : cleaned;
}

export const partnerPayoutStatuses = ["pending", "paid"] as const;
export type PartnerPayoutStatus = (typeof partnerPayoutStatuses)[number];

/** "2026-09" — the month a payout covers. */
export const payoutPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

/** What a partner enters on the public "Check partner status" page. */
export const partnerStatusLookupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the email you applied with").max(200),
  /** Their referral code (full dashboard) or the phone number they applied with (application status only). */
  secret: z.string().trim().min(4, "Enter your referral code or phone number").max(40),
  turnstileToken: z.string().optional(),
});
