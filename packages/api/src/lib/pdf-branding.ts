/**
 * The small "Powered by Fintranzact" line on PDFs (invoices, quotations and
 * the other documents drawn by the invoice templates, thermal receipts and
 * e-way bill prints). Whether it shows is the plan's `pdfBranding` limit
 * (lib/plan-limits.ts pdfBrandingHidden); this file decides where it links.
 *
 *  - an organisation referred by an APPROVED partner: the sign-up page with
 *    that partner's referral code, /register?ref=CODE, the same parameter a
 *    partner's own referral link uses (see the partner portal and the sign-up
 *    form). Nothing else goes in the URL: no organisation, user or document
 *    details, no tracking ids.
 *  - otherwise (no partner, or a partner who is not approved): the plain site
 *    URL.
 *  - when no public URL is configured at all, no link (the text stays plain).
 */

import { and, eq } from "drizzle-orm";
import { controlDb, partners, tenants } from "@fintranzact/db";
import { normalizeReferralCode } from "@fintranzact/shared";
import { pdfBrandingHidden } from "./plan-limits.js";

export interface PartnerForBranding {
  status: string;
  referralCode: string | null;
}

/** The public web origin: APP_URL, else the request's own origin. No trailing slash. */
export function publicSiteBase(fallbackOrigin?: string | null): string {
  return (process.env.APP_URL || fallbackOrigin || "").replace(/\/+$/, "");
}

/** The partner's referral code, only for an approved partner who has one. */
export function partnerCodeForBranding(partner: PartnerForBranding | null | undefined): string | null {
  if (!partner || partner.status !== "approved") return null;
  return normalizeReferralCode(partner.referralCode) || null;
}

/** Where the footer line links, or undefined when there is no public URL to link to. */
export function brandingFooterUrl(base: string, partner?: PartnerForBranding | null): string | undefined {
  const origin = base.replace(/\/+$/, "");
  if (!origin) return undefined;
  const code = partnerCodeForBranding(partner);
  return code ? `${origin}/register?ref=${encodeURIComponent(code)}` : origin;
}

export interface PdfBranding {
  /** True when the plan switches the footer line off (the PDF data's isPaidPlan). */
  hidden: boolean;
  /** Link for the line; undefined when hidden or when there is no public URL. */
  url: string | undefined;
}

/** Footer decision for one organisation's PDFs. */
export async function resolvePdfBranding(tenantId: string, plan: string, fallbackOrigin?: string | null): Promise<PdfBranding> {
  if (await pdfBrandingHidden(plan)) return { hidden: true, url: undefined };
  const [row] = await controlDb
    .select({ status: partners.status, referralCode: partners.referralCode })
    .from(tenants)
    .leftJoin(partners, and(eq(partners.id, tenants.partnerId)))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const partner = row && row.status ? { status: row.status, referralCode: row.referralCode } : null;
  return { hidden: false, url: brandingFooterUrl(publicSiteBase(fallbackOrigin), partner) };
}
