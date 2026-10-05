/**
 * Online payments: a business connects ITS OWN Razorpay account (Settings,
 * Online payments) and customers pay its invoices through Razorpay payment
 * links. Customer money goes straight to that business's Razorpay account;
 * the platform's own Razorpay keys are never used here.
 *
 * Keys are encrypted at rest and never returned: getSettings answers with the
 * masked key id, the webhook URL to add in the business's Razorpay dashboard,
 * and booleans. Managing keys needs manage:Business (owner and admin).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { withAudit } from "../lib/audit.js";
import { getOrCreateShareLink, shareUrl } from "../lib/share-links.js";
import {
  InvalidRazorpayKeyError,
  disconnect,
  getConnectionRow,
  presentConnection,
  publicApiOrigin,
  saveConnection,
  testStoredConnection,
} from "../lib/razorpay/connection.js";
import { PaymentLinkError, ensureInvoicePaymentLink, getActivePaymentLink, loadInvoiceBalance, paymentLinkRefusal } from "../lib/razorpay/payment-link.js";
import { paiseToMoney } from "../lib/razorpay/client.js";

const invoiceInput = z.object({ invoiceId: z.string().uuid() });

export const onlinePaymentsRouter = router({
  /** The connection as the settings page may see it: masked key id, webhook URL, no secrets. */
  getSettings: adminProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "Business");
    const row = await getConnectionRow(ctx.db, ctx.businessId);
    return presentConnection(row, publicApiOrigin(ctx.req));
  }),

  /** Save the business's own Razorpay keys (and webhook secret). Blank webhook secret on re-save keeps the stored one. */
  connect: adminProcedure
    .input(z.object({
      keyId: z.string().trim().min(1).max(64),
      keySecret: z.string().trim().min(1).max(128),
      webhookSecret: z.string().trim().max(128).optional(),
    }))
    .mutation(withAudit(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "Business");
      try {
        const row = await saveConnection(ctx.db, {
          tenantId: ctx.tenantId,
          businessId: ctx.businessId,
          keyId: input.keyId,
          keySecret: input.keySecret,
          webhookSecret: input.webhookSecret,
        });
        return { id: row.id, ...presentConnection(row, publicApiOrigin(ctx.req)) };
      } catch (err) {
        if (err instanceof InvalidRazorpayKeyError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        throw err;
      }
      // Audit entries carry the masked key id and mode only, never a key or secret.
    }, (r) => ({ action: "onlinePayments.connect", entityType: "razorpayConnection", entityId: r.id, metadata: { keyIdMasked: r.keyIdMasked, mode: r.mode, hasWebhookSecret: r.hasWebhookSecret } }))),

  /** Call Razorpay with the stored keys. A read-only check, so it stays open in read-only mode. */
  testConnection: adminProcedure.mutation(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "Business");
    return testStoredConnection(ctx.db, ctx.businessId);
  }),

  /** Remove the keys and cancel the active payment links. Revoking credentials is never refused for plan reasons. */
  disconnect: adminProcedure.mutation(withAudit(async ({ ctx }) => {
    requireCan(ctx.ability, "manage", "Business");
    const removed = await disconnect(ctx.db, ctx.businessId);
    return { removed };
  }, (r) => (r.removed ? { action: "onlinePayments.disconnect", entityType: "razorpayConnection" } : null))),

  /** The invoice's payment link state: can it be paid online, and is there a live link. */
  invoiceLink: viewerProcedure.input(invoiceInput).query(async ({ ctx, input }) => {
    requireCan(ctx.ability, "read", "Invoice");
    const connected = !!(await getConnectionRow(ctx.db, ctx.businessId));
    const inv = await loadInvoiceBalance(ctx.db, ctx.businessId, input.invoiceId);
    if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    const refusal = paymentLinkRefusal(inv);
    const link = connected ? await getActivePaymentLink(ctx.db, ctx.businessId, inv.id) : null;
    return {
      connected,
      canPay: connected && !refusal,
      reason: refusal?.message ?? null,
      balance: inv.balance,
      // A link for a balance that has since moved is stale: it is replaced when the next one is made.
      link: link ? { url: link.shortUrl, amount: paiseToMoney(link.amountPaise), current: paiseToMoney(link.amountPaise) === inv.balance, createdAt: link.createdAt } : null,
    };
  }),

  /** Create (or reuse) the payment link for the invoice's current balance due. */
  createInvoiceLink: memberProcedure.input(invoiceInput).mutation(withAudit(async ({ ctx, input }) => {
    requireCan(ctx.ability, "create", "Payment");
    // The customer returns to the invoice's share page after paying.
    const inv = await loadInvoiceBalance(ctx.db, ctx.businessId, input.invoiceId);
    if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    // Refuse before any share link is minted for an invoice that cannot take a payment.
    if (!(await getConnectionRow(ctx.db, ctx.businessId))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Online payments are not set up for this business. Connect Razorpay in Settings." });
    }
    const refusal = paymentLinkRefusal(inv);
    if (refusal) throw new TRPCError({ code: "PRECONDITION_FAILED", message: refusal.message });
    try {
      const share = await getOrCreateShareLink({ tenantId: ctx.tenantId, businessId: ctx.businessId, documentId: inv.id, userId: ctx.user.id });
      const { link, created } = await ensureInvoicePaymentLink(ctx.db, {
        businessId: ctx.businessId,
        invoiceId: inv.id,
        shareUrl: shareUrl(share.token, ctx.req.headers.get("origin")),
      });
      return { url: link.shortUrl, amount: paiseToMoney(link.amountPaise), created, invoiceId: inv.id };
    } catch (err) {
      if (err instanceof PaymentLinkError) {
        throw new TRPCError({ code: err.reason === "gateway_error" ? "BAD_GATEWAY" : err.reason === "not_found" ? "NOT_FOUND" : "PRECONDITION_FAILED", message: err.message });
      }
      throw err;
    }
  }, (r) => (r.created ? { action: "onlinePayments.createLink", entityType: "invoice", entityId: r.invoiceId, metadata: { amount: r.amount } } : null))),
});
