/**
 * The "Pay now" half of the public share page. Public and unauthenticated:
 * everything is derived from the share token on the server, nothing from the
 * request body, and no key or secret is ever part of a response.
 */

import type { TenantDatabase } from "@fintranzact/db";
import { getEntitlements } from "../entitlements.js";
import { getConnectionRow } from "./connection.js";
import { PaymentLinkError, ensureInvoicePaymentLink, loadInvoiceBalance, paymentLinkRefusal } from "./payment-link.js";
import { shareUrl } from "../share-links.js";

/**
 * Whether the share page should offer Pay now: the business has connected
 * Razorpay, the organisation can still write (a read-only organisation makes
 * no new links), and the invoice has a balance that can be paid online.
 */
export async function shareOnlinePaymentAvailable(
  db: TenantDatabase,
  link: { tenantId: string; businessId: string; documentId: string },
): Promise<boolean> {
  const ent = await getEntitlements(link.tenantId);
  if (ent.readOnly) return false;
  if (!(await getConnectionRow(db, link.businessId))) return false;
  const inv = await loadInvoiceBalance(db, link.businessId, link.documentId);
  return !!inv && !paymentLinkRefusal(inv);
}

export type SharePayResult =
  | { ok: true; url: string; amountPaise: number }
  | { ok: false; status: 404 | 409 | 502; error: string };

/** Create (or reuse) the payment link for the shared invoice's current balance. */
export async function createSharePaymentLink(
  db: TenantDatabase,
  link: { tenantId: string; businessId: string; documentId: string },
  token: string,
): Promise<SharePayResult> {
  const ent = await getEntitlements(link.tenantId);
  // Read-only organisations make no new links: same neutral answer as an unknown link.
  if (ent.readOnly) return { ok: false, status: 404, error: "This link is not valid any more" };
  try {
    const { link: created } = await ensureInvoicePaymentLink(db, {
      businessId: link.businessId,
      invoiceId: link.documentId,
      // Only the configured app origin: a request header must never decide where Razorpay sends the customer.
      shareUrl: process.env.APP_URL ? shareUrl(token) : null,
    });
    return { ok: true, url: created.shortUrl, amountPaise: created.amountPaise };
  } catch (err) {
    if (err instanceof PaymentLinkError) {
      if (err.reason === "not_connected" || err.reason === "not_found") return { ok: false, status: 404, error: "This link is not valid any more" };
      if (err.reason === "gateway_error") return { ok: false, status: 502, error: "Online payment is unavailable right now. Please try again shortly." };
      return { ok: false, status: 409, error: "There is nothing to pay online on this invoice." };
    }
    throw err;
  }
}
