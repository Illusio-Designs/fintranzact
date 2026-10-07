/**
 * Extra AI question packs: a ONE-TIME purchase (not a subscription), paid through the PLATFORM
 * Razorpay (an Order; each business's own Razorpay keys are for its customers and are never used
 * here) or, before the platform keys are set, the demo gateway.
 *
 * Flow
 *   createPackOrder   price the order (packs x the pack price, ex-GST, then 18% GST), create the
 *                     gateway order and an `ai_pack_orders` row (`created`). Demo: paid at once.
 *   confirmPackPayment  the checkout callback: Razorpay's signature over "<order_id>|<payment_id>"
 *                     is verified server-side first (billing router), then this fulfils.
 *   handlePackWebhook payment.captured / order.paid fulfil (so a closed browser still gets its
 *                     questions), payment.failed marks the order failed, refund.processed takes the
 *                     unused credits back.
 *
 * Fulfilment (fulfilPackPayment) is idempotent by order: it locks the order row, and only the call
 * that finds it unpaid records the captured payment (the GST invoice, numbered from the same
 * FIN series as subscription invoices), inserts the `ai_credit_grants` row (source "purchase",
 * reason "purchase", linked to the payment and the order) and marks the order paid, all in one
 * transaction. A duplicate webhook, a webhook racing the callback or a replay grants nothing more;
 * unique indexes on the grant's payment id and on the provider payment id back that up.
 * The webhook also checks that the captured amount equals the order's total.
 *
 * The credits do not expire in Phase 1 and are used after the monthly included questions
 * (lib/ai/quota.ts). They are usable only while the organisation has an AI add-on (or a trial):
 * the assistant itself needs one, so credits wait, unspent, for an unpaid organisation.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { aiCreditGrants, aiPackOrders, billingEvents, billingPayments, controlDb, tenantMembers, tenants, users } from "@fintranzact/db";
import {
  ADDON_COMING_SOON_MESSAGE,
  AI_PACK_MAX_PER_ORDER,
  AI_PACK_QUESTIONS,
  aiPackAmount,
  isAiPackAvailable,
} from "@fintranzact/shared";
import { emailService } from "../email.js";
import { getEntitlements } from "../entitlements.js";
import { logger } from "../logger.js";
import { getAiPackPriceInr } from "./addon-prices.js";
import { getGateway, type BillingProvider } from "./gateway.js";
import { formatBillingInvoiceNumber, recordBillingEvent, recordPayment } from "./service.js";

export type PackOrderRow = typeof aiPackOrders.$inferSelect;

/** Replaceable in tests so no email is sent. */
export const packDeps = {
  sendNotice: (to: string, subject: string, text: string): Promise<void> => emailService.sendNotice(to, subject, text),
};

export const AI_PACK_NEEDS_ADDON_MESSAGE = "Extra questions are for organisations that have an AI plan. Add AI Assistant or AI Plus first.";

export interface CreatePackOrderResult {
  status: "paid" | "checkout";
  orderId: string;
  providerOrderId: string;
  provider: BillingProvider;
  packs: number;
  credits: number;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
}

export function packDescription(packs: number): string {
  return `AI question packs — ${packs} × ${AI_PACK_QUESTIONS} questions`;
}

/** Start buying `packs` extra packs. Refused while the AI add-on is not on sale, and for an organisation with no AI access. */
export async function createPackOrder(opts: { tenantId: string; userId: string; packs: number }): Promise<CreatePackOrderResult> {
  if (!isAiPackAvailable()) throw new TRPCError({ code: "BAD_REQUEST", message: ADDON_COMING_SOON_MESSAGE });
  if (!Number.isInteger(opts.packs) || opts.packs < 1 || opts.packs > AI_PACK_MAX_PER_ORDER) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Choose between 1 and ${AI_PACK_MAX_PER_ORDER} packs.` });
  }
  const ent = await getEntitlements(opts.tenantId);
  if (!ent.addons.ai_assistant && !ent.addons.ai_plus) {
    throw new TRPCError({ code: "BAD_REQUEST", message: AI_PACK_NEEDS_ADDON_MESSAGE });
  }

  const amount = aiPackAmount(opts.packs, await getAiPackPriceInr());
  const gateway = getGateway();
  const created = await gateway.createOrder({
    amountPaise: amount.totalPaise,
    receipt: `aipack_${opts.tenantId.slice(0, 8)}_${Date.now().toString(36)}`,
    notes: { tenantId: opts.tenantId, item: "ai_pack", packs: String(opts.packs) },
  });
  const [order] = await controlDb
    .insert(aiPackOrders)
    .values({
      tenantId: opts.tenantId,
      packs: amount.packs,
      credits: amount.credits,
      basePaise: amount.basePaise,
      totalPaise: amount.totalPaise,
      provider: gateway.name,
      providerOrderId: created.id,
      createdByUserId: opts.userId,
    })
    .returning();
  await recordBillingEvent({
    provider: "local",
    type: "ai_pack.order_created",
    tenantId: opts.tenantId,
    payload: { orderId: order!.id, packs: amount.packs, totalPaise: amount.totalPaise, provider: gateway.name, actorUserId: opts.userId },
  });

  const base = {
    orderId: order!.id,
    providerOrderId: created.id,
    provider: gateway.name,
    packs: amount.packs,
    credits: amount.credits,
    basePaise: amount.basePaise,
    gstPaise: amount.gstPaise,
    totalPaise: amount.totalPaise,
  };
  if (gateway.name === "demo") {
    await fulfilPackPayment({ providerOrderId: created.id, providerPaymentId: "pay_demo_" + order!.id.slice(0, 14), method: "demo" });
    return { status: "paid", ...base };
  }
  return { status: "checkout", ...base };
}

export interface FulfilResult {
  /** True only for the call that granted the credits. */
  granted: boolean;
  orderId: string;
  tenantId: string;
  paymentId: string | null;
  grantId: string | null;
}

/**
 * Record a captured payment for an order: GST invoice, credit grant, order paid, atomically and at
 * most once. `amountPaise`, when known (the webhook), must equal the order's total.
 */
export async function fulfilPackPayment(opts: {
  providerOrderId: string;
  providerPaymentId: string;
  method?: string | null;
  amountPaise?: number | null;
}): Promise<FulfilResult> {
  const result = await controlDb.transaction(async (tx) => {
    // FOR UPDATE: a concurrent webhook or callback waits here and then sees the order paid.
    const [order] = await tx.select().from(aiPackOrders).where(eq(aiPackOrders.providerOrderId, opts.providerOrderId)).for("update").limit(1);
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
    if (order.status === "paid" || order.status === "refunded") {
      return { granted: false, orderId: order.id, tenantId: order.tenantId, paymentId: order.paymentId, grantId: order.grantId, order };
    }
    if (opts.amountPaise != null && opts.amountPaise !== order.totalPaise) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The amount paid does not match the order." });
    }

    const payment = await recordPayment({
      tenantId: order.tenantId,
      subscriptionId: null,
      status: "captured",
      description: packDescription(order.packs),
      basePaise: order.basePaise,
      provider: order.provider as BillingProvider,
      method: opts.method ?? null,
      providerPaymentId: opts.providerPaymentId,
      executor: tx,
    });
    const [grant] = await tx
      .insert(aiCreditGrants)
      .values({
        tenantId: order.tenantId,
        credits: order.credits,
        source: "purchase",
        reason: "purchase",
        grantedByUserId: order.createdByUserId,
        paymentId: payment.id,
        orderId: order.id,
      })
      .returning({ id: aiCreditGrants.id });
    await tx
      .update(aiPackOrders)
      .set({ status: "paid", providerPaymentId: opts.providerPaymentId, paymentId: payment.id, grantId: grant!.id, paidAt: new Date(), failureReason: null })
      .where(eq(aiPackOrders.id, order.id));
    await recordBillingEvent({
      provider: "local",
      type: "ai_pack.paid",
      tenantId: order.tenantId,
      payload: { orderId: order.id, paymentId: payment.id, grantId: grant!.id, credits: order.credits, providerPaymentId: opts.providerPaymentId, invoiceNumber: payment.invoiceNumber },
      executor: tx,
    });
    return { granted: true, orderId: order.id, tenantId: order.tenantId, paymentId: payment.id, grantId: grant!.id, order, invoiceNumber: payment.invoiceNumber };
  });

  if (result.granted) void sendPackReceipt(result.tenantId, result.order, result.invoiceNumber ?? null);
  return { granted: result.granted, orderId: result.orderId, tenantId: result.tenantId, paymentId: result.paymentId, grantId: result.grantId };
}

/** The receipt email: best effort, never fails the purchase. */
async function sendPackReceipt(tenantId: string, order: PackOrderRow, invoiceNumber: string | null): Promise<void> {
  try {
    const [tenant] = await controlDb.select({ name: tenants.name, billingName: tenants.billingName, billingEmail: tenants.billingEmail }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    let to = tenant?.billingEmail ?? null;
    if (!to) {
      const [owner] = await controlDb
        .select({ email: users.email })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, "owner")))
        .limit(1);
      to = owner?.email ?? null;
    }
    if (!to) return;
    const rupees = (order.totalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const text = [
      `Thank you. We received your payment of ₹${rupees} (including GST) for ${order.packs} extra AI question pack${order.packs === 1 ? "" : "s"}.`,
      "",
      `${order.credits} questions have been added to ${tenant?.billingName ?? tenant?.name ?? "your organisation"}. They do not expire and are used after your monthly questions.`,
      invoiceNumber ? `GST invoice: ${invoiceNumber}. Download it from Settings, Billing, Invoices and payments.` : "",
      "",
      "Finvera Solutions LLP",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    await packDeps.sendNotice(to, "Receipt: extra AI questions", text);
  } catch (err) {
    logger.warn({ err, tenantId }, "[billing] could not send the AI pack receipt");
  }
}

/** The order of an organisation (never another's). */
export async function getPackOrderForTenant(tenantId: string, orderId: string): Promise<PackOrderRow> {
  const [order] = await controlDb.select().from(aiPackOrders).where(and(eq(aiPackOrders.id, orderId), eq(aiPackOrders.tenantId, tenantId))).limit(1);
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
  return order;
}

/** The payment failed: mark the order failed (a later successful retry on the same order still fulfils it). Grants nothing. */
export async function failPackPayment(providerOrderId: string, reason: string | null): Promise<boolean> {
  const rows = await controlDb
    .update(aiPackOrders)
    .set({ status: "failed", failureReason: reason ?? "Payment failed" })
    .where(and(eq(aiPackOrders.providerOrderId, providerOrderId), eq(aiPackOrders.status, "created")))
    .returning({ id: aiPackOrders.id, tenantId: aiPackOrders.tenantId });
  const row = rows[0];
  if (row) {
    await recordBillingEvent({ provider: "local", type: "ai_pack.failed", tenantId: row.tenantId, payload: { orderId: row.id, reason } });
  }
  return !!row;
}

/**
 * A refund was processed for a pack payment: the unused questions are taken back so a refund never
 * leaves credits granted. Full refund: all unused credits; partial: the refunded share, at most the
 * unused ones. Questions already asked are not recovered. A credit note (numbered) is recorded.
 * Idempotent per refund id.
 */
export async function refundPackPayment(opts: { providerPaymentId: string; refundId: string; amountPaise: number }): Promise<{ revoked: number } | null> {
  const [order] = await controlDb.select().from(aiPackOrders).where(eq(aiPackOrders.providerPaymentId, opts.providerPaymentId)).limit(1);
  if (!order || !order.grantId) return null;

  const claimed = await controlDb
    .insert(billingEvents)
    .values({ provider: "razorpay", eventId: `ai_pack_refund:${opts.refundId}`, type: "ai_pack.refund", tenantId: order.tenantId, payload: { orderId: order.id, amountPaise: opts.amountPaise } })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });
  if (claimed.length === 0) return { revoked: 0 };

  const amount = Math.min(Math.max(opts.amountPaise, 0), order.totalPaise);
  const full = amount >= order.totalPaise;
  let revoked = 0;
  await controlDb.transaction(async (tx) => {
    const [grant] = await tx.select().from(aiCreditGrants).where(eq(aiCreditGrants.id, order.grantId!)).for("update").limit(1);
    if (grant) {
      const unused = Math.max(0, grant.credits - grant.used);
      const share = full ? unused : Math.min(unused, Math.ceil((order.credits * amount) / order.totalPaise));
      revoked = share;
      if (share > 0) {
        await tx.update(aiCreditGrants).set({ credits: sql`${aiCreditGrants.credits} - ${share}` }).where(eq(aiCreditGrants.id, grant.id));
      }
    }
    if (full) await tx.update(aiPackOrders).set({ status: "refunded" }).where(eq(aiPackOrders.id, order.id));
    // The credit note: the refund (GST inclusive) as a negative base plus its GST.
    await recordPayment({
      tenantId: order.tenantId,
      subscriptionId: null,
      status: "credit",
      description: `Credit note: ${packDescription(order.packs)} refunded`,
      basePaise: -Math.round(amount / 1.18),
      provider: order.provider as BillingProvider,
      providerPaymentId: opts.providerPaymentId,
      executor: tx,
    });
    await recordBillingEvent({
      provider: "local",
      type: "ai_pack.refunded",
      tenantId: order.tenantId,
      payload: { orderId: order.id, refundId: opts.refundId, amountPaise: amount, creditsRevoked: revoked },
      executor: tx,
    });
  });
  return { revoked };
}

/** What the Billing page and the admin console list: an organisation's pack orders with their invoices. */
export async function listPackPurchases(tenantId: string, limit = 25) {
  const rows = await controlDb
    .select({
      id: aiPackOrders.id,
      packs: aiPackOrders.packs,
      credits: aiPackOrders.credits,
      totalPaise: aiPackOrders.totalPaise,
      status: aiPackOrders.status,
      provider: aiPackOrders.provider,
      createdAt: aiPackOrders.createdAt,
      paidAt: aiPackOrders.paidAt,
      paymentId: aiPackOrders.paymentId,
      invoiceSeq: billingPayments.invoiceSeq,
      used: aiCreditGrants.used,
      grantCredits: aiCreditGrants.credits,
    })
    .from(aiPackOrders)
    .leftJoin(billingPayments, eq(billingPayments.id, aiPackOrders.paymentId))
    .leftJoin(aiCreditGrants, eq(aiCreditGrants.id, aiPackOrders.grantId))
    .where(eq(aiPackOrders.tenantId, tenantId))
    .orderBy(sql`${aiPackOrders.createdAt} DESC`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    packs: r.packs,
    credits: r.credits,
    totalPaise: r.totalPaise,
    status: r.status,
    provider: r.provider,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    paymentId: r.paymentId,
    invoiceNumber: formatBillingInvoiceNumber(r.invoiceSeq),
    used: r.used ?? 0,
    creditsLeft: r.grantCredits != null ? Math.max(0, r.grantCredits - (r.used ?? 0)) : 0,
  }));
}
