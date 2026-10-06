/**
 * The payment link a payment reminder carries ({{paymentLink}}).
 *
 * Uses the same code path as the invoice detail (ensureInvoicePaymentLink):
 * the active link is reused while the balance is unchanged, otherwise a new
 * one is made for the current balance. Making a link only happens when a
 * reminder is about to be SENT (`create: true`); previews and listings use
 * `create: false`, which only ever reads an existing active link for the
 * current balance. Any failure means "no link": a reminder is never blocked
 * by it, and logs carry ids only, never keys or links.
 */

import type { TenantDatabase } from "@fintranzact/db";
import { getEntitlements } from "../entitlements.js";
import { logger } from "../logger.js";
import { getShareLink, shareUrl } from "../share-links.js";
import { getConnectionRow } from "./connection.js";
import { moneyToPaise } from "./client.js";
import { PaymentLinkError, ensureInvoicePaymentLink, getActivePaymentLink, loadInvoiceBalance, paymentLinkRefusal } from "./payment-link.js";

export interface ReminderLinkOptions {
  /** Make a link when none is current. Only a reminder that is really being sent passes true. */
  create: boolean;
  /** The organisation, so a read-only one never gets a new link and the share page can be the return page. */
  tenantId?: string;
}

export async function reminderPaymentLink(
  db: TenantDatabase,
  businessId: string,
  invoiceId: string,
  opts: ReminderLinkOptions,
): Promise<string | null> {
  try {
    if (!(await getConnectionRow(db, businessId))) return null;
    const inv = await loadInvoiceBalance(db, businessId, invoiceId);
    if (!inv || paymentLinkRefusal(inv)) return null;

    const active = await getActivePaymentLink(db, businessId, invoiceId);
    if (active && active.amountPaise === moneyToPaise(inv.balance)) return active.shortUrl;
    if (!opts.create) return null;

    // Read-only organisations make no new links (same rule as onlinePayments.createInvoiceLink).
    if (opts.tenantId && (await getEntitlements(opts.tenantId)).readOnly) return null;

    let callback: string | null = null;
    if (opts.tenantId && process.env.APP_URL) {
      const share = await getShareLink(opts.tenantId, invoiceId).catch(() => null);
      if (share) callback = shareUrl(share.token);
    }
    const { link } = await ensureInvoicePaymentLink(db, { businessId, invoiceId, shareUrl: callback });
    return link.shortUrl;
  } catch (err) {
    logger.warn(
      { businessId, invoiceId, reason: err instanceof PaymentLinkError ? err.reason : "error" },
      "[payment-reminders] no payment link for this reminder",
    );
    return null;
  }
}
