/**
 * Applying a verified Razorpay webhook event to one business's books.
 *
 * The caller (http/businessRazorpayWebhook.ts) has already checked the
 * signature against that business's own webhook secret. Here:
 *
 *   payment_link.paid / partially_paid / payment.captured
 *       record a payment for the amount actually paid, against the invoice,
 *       once per Razorpay payment id (a redelivery records nothing new);
 *   payment.failed          no change to the books, logged;
 *   payment_link.expired / cancelled   the link is no longer active.
 *
 * Amounts arrive in paise and are stored as the app's two-decimal money.
 * Gateway charges use the account's existing mechanism (lib/gateway.ts) when
 * the business has an active gateway account named Razorpay; the fee Razorpay
 * reports wins over the account's configured rate.
 */

import { and, eq, ilike, or, sql } from "drizzle-orm";
import {
  bankAccounts,
  bankTransactions,
  businesses,
  invoicePaymentLinks,
  invoices,
  paymentAllocations,
  paymentGatewayConfigs,
  payments,
  razorpayPayments,
  type TenantDatabase,
} from "@fintranzact/db";
import { money } from "@fintranzact/shared";
import { applyInvoicePayment } from "../invoice-status.js";
import { processGatewayPayment } from "../gateway.js";
import { logAudit } from "../audit.js";
import { logger } from "../logger.js";
import { loadPeriodLockState, lockViolation } from "../period-lock.js";
import { loadInvoiceBalance } from "./payment-link.js";
import { paiseToMoney } from "./client.js";

/** Audit entries written by the webhook have no signed-in user. */
export const WEBHOOK_AUDIT_USER_ID = "00000000-0000-0000-0000-000000000000";

interface PaymentEntity {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  fee?: number | null;
  tax?: number | null;
  card?: { type?: string } | null;
  notes?: Record<string, unknown> | unknown[] | null;
  error_code?: string | null;
}

interface PaymentLinkEntity {
  id?: string;
  status?: string;
  notes?: Record<string, unknown> | unknown[] | null;
}

export interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: PaymentEntity };
    payment_link?: { entity?: PaymentLinkEntity };
  };
}

export type WebhookOutcome =
  | { result: "recorded"; paymentId: string }
  | { result: "duplicate" }
  | { result: "ignored"; reason: string }
  | { result: "link_updated" }
  | { result: "unrecorded"; reason: string };

/** Razorpay method (and card type) to the app's payment modes. */
export function mapRazorpayMethod(method: string | undefined, cardType: string | undefined | null): "credit_card" | "debit_card" | "upi" | "net_banking" | "wallet" | "other" {
  switch (method) {
    case "card":
      return cardType === "debit" || cardType === "prepaid" ? "debit_card" : "credit_card";
    case "emi":
      return "credit_card";
    case "upi":
      return "upi";
    case "netbanking":
      return "net_banking";
    case "wallet":
      return "wallet";
    default:
      return "other";
  }
}

function notesObject(notes: PaymentEntity["notes"]): Record<string, string> {
  if (!notes || Array.isArray(notes) || typeof notes !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes)) if (typeof v === "string") out[k] = v;
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Unrecordable extends Error {}

type Tx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

/** The business's Razorpay gateway bank account (active config), if it keeps one. */
async function findRazorpayGatewayAccount(tx: Tx, businessId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .innerJoin(paymentGatewayConfigs, eq(paymentGatewayConfigs.bankAccountId, bankAccounts.id))
    .where(and(
      eq(bankAccounts.businessId, businessId),
      eq(bankAccounts.accountType, "payment_gateway"),
      eq(paymentGatewayConfigs.isActive, true),
      or(ilike(bankAccounts.accountName, "%razorpay%"), ilike(bankAccounts.bankName, "%razorpay%")),
    ))
    .limit(1);
  return row?.id ?? null;
}

async function resolveInvoiceId(
  db: TenantDatabase,
  businessId: string,
  linkId: string | undefined,
  notes: Record<string, string>,
): Promise<string | null> {
  if (linkId) {
    const [link] = await db
      .select({ invoiceId: invoicePaymentLinks.invoiceId })
      .from(invoicePaymentLinks)
      .where(and(eq(invoicePaymentLinks.businessId, businessId), eq(invoicePaymentLinks.razorpayLinkId, linkId)))
      .limit(1);
    if (link) return link.invoiceId;
  }
  // Payments from a link we no longer have a row for: trust the notes only when they name THIS business.
  if (notes.business_id === businessId && notes.invoice_id && UUID_RE.test(notes.invoice_id)) {
    const [inv] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, notes.invoice_id), eq(invoices.businessId, businessId)))
      .limit(1);
    return inv?.id ?? null;
  }
  return null;
}

async function recordPayment(
  db: TenantDatabase,
  businessId: string,
  p: {
    razorpayPaymentId: string;
    amountPaise: number;
    feePaise: number | null;
    taxPaise: number | null;
    method: string | undefined;
    cardType: string | null | undefined;
    invoiceId: string;
    razorpayLinkId: string | undefined;
    linkStatus: "paid" | "partially_paid" | null;
  },
): Promise<WebhookOutcome> {
  const mode = mapRazorpayMethod(p.method, p.cardType);
  const amount = paiseToMoney(p.amountPaise);
  const fee = p.feePaise !== null && p.feePaise >= 0 ? paiseToMoney(p.feePaise) : undefined;

  let outcome: WebhookOutcome;
  let auditMeta: Record<string, unknown> = {};
  try {
    outcome = await db.transaction(async (tx) => {
      // Dedupe first: the unique (business, razorpay payment id) row makes a
      // concurrent duplicate wait here, then find the conflict.
      const [marker] = await tx
        .insert(razorpayPayments)
        .values({
          businessId,
          razorpayPaymentId: p.razorpayPaymentId,
          invoiceId: p.invoiceId,
          razorpayLinkId: p.razorpayLinkId ?? null,
          amountPaise: p.amountPaise,
          feePaise: p.feePaise,
          taxPaise: p.taxPaise,
          method: p.method ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: razorpayPayments.id });
      if (!marker) return { result: "duplicate" } as const;

      // Lock the invoice so a manual payment at the same moment cannot overpay it.
      const [locked] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, p.invoiceId), eq(invoices.businessId, businessId)))
        .for("update")
        .limit(1);
      const inv = locked ? await loadInvoiceBalance(tx, businessId, p.invoiceId) : null;
      if (!inv) throw new Unrecordable("invoice_missing");
      if (inv.documentType !== "invoice" || inv.type !== "sale" || inv.status === "cancelled") throw new Unrecordable("invoice_not_payable");

      const now = new Date();
      const violation = lockViolation(await loadPeriodLockState(tx, businessId), now);
      if (violation) throw new Unrecordable("period_locked");

      // What reaches the invoice is capped at its balance; any excess stays on
      // the payment as an advance from the customer.
      const allocation = money.compare(amount, inv.balance) > 0 ? inv.balance : amount;
      const allocated = money.compare(allocation, "0") > 0;

      const [biz] = await tx
        .select({ prefix: businesses.paymentPrefix, nextNum: businesses.nextPaymentNumber })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .for("update");
      const paymentNumber = `${biz!.prefix}-${String(biz!.nextNum).padStart(5, "0")}`;
      await tx.update(businesses).set({ nextPaymentNumber: biz!.nextNum + 1 }).where(eq(businesses.id, businessId));

      const gatewayAccountId = await findRazorpayGatewayAccount(tx, businessId);

      const [payment] = await tx
        .insert(payments)
        .values({
          businessId,
          partyId: inv.partyId,
          invoiceId: p.invoiceId,
          amount,
          mode,
          referenceNumber: p.razorpayPaymentId,
          paymentDate: now,
          notes: `Paid online through Razorpay${p.razorpayLinkId ? ` (payment link ${p.razorpayLinkId})` : ""}`,
          paymentNumber,
          bankAccountId: gatewayAccountId,
          createdByName: "Razorpay",
          source: "razorpay",
        })
        .returning();

      if (allocated) {
        await applyInvoicePayment(tx, businessId, p.invoiceId, allocation);
        await tx.insert(paymentAllocations).values({ paymentId: payment!.id, invoiceId: p.invoiceId, amount: allocation });
      }

      let chargeAmount: string | null = null;
      if (gatewayAccountId) {
        const [account] = await tx
          .select({ currentBalance: bankAccounts.currentBalance })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.id, gatewayAccountId), eq(bankAccounts.businessId, businessId)))
          .for("update")
          .limit(1);
        if (account) {
          await tx.insert(bankTransactions).values({
            businessId,
            bankAccountId: gatewayAccountId,
            type: "deposit",
            amount,
            description: `Payment ${paymentNumber}`,
            referenceType: "payment",
            referenceId: payment!.id,
            transactionDate: now,
          });
          await tx
            .update(bankAccounts)
            .set({ currentBalance: money.add(account.currentBalance, amount), updatedAt: now })
            .where(eq(bankAccounts.id, gatewayAccountId));
          const gw = await processGatewayPayment(tx, {
            businessId,
            paymentId: payment!.id,
            paymentNumber,
            bankAccountId: gatewayAccountId,
            amount,
            mode,
            paymentDate: now,
            ...(fee !== undefined ? { chargeOverride: fee } : {}),
          });
          chargeAmount = gw?.chargeAmount ?? null;
        }
      }

      await tx.update(razorpayPayments).set({ paymentId: payment!.id }).where(eq(razorpayPayments.id, marker.id));

      if (p.razorpayLinkId && p.linkStatus) {
        await tx
          .update(invoicePaymentLinks)
          .set({ status: p.linkStatus, updatedAt: now })
          .where(and(eq(invoicePaymentLinks.businessId, businessId), eq(invoicePaymentLinks.razorpayLinkId, p.razorpayLinkId)));
      }

      auditMeta = {
        paymentNumber,
        amount,
        allocated: allocation,
        advance: money.sub(amount, allocation),
        mode,
        razorpayPaymentId: p.razorpayPaymentId,
        invoiceId: p.invoiceId,
        gatewayCharge: chargeAmount,
        gatewayAccount: !!gatewayAccountId,
      };
      return { result: "recorded", paymentId: payment!.id } as const;
    });
  } catch (err) {
    if (err instanceof Unrecordable) {
      // Money was taken but it cannot be booked automatically: leave a trail for the owner and stop Razorpay retrying.
      await logAudit(db, {
        businessId,
        userId: WEBHOOK_AUDIT_USER_ID,
        action: "razorpay.payment.unrecorded",
        entityType: "invoice",
        entityId: p.invoiceId,
        metadata: { reason: err.message, razorpayPaymentId: p.razorpayPaymentId, amount },
      });
      logger.warn({ businessId, reason: err.message }, "[razorpay] payment received but not recorded");
      return { result: "unrecorded", reason: err.message };
    }
    throw err;
  }

  if (outcome.result === "recorded") {
    await logAudit(db, {
      businessId,
      userId: WEBHOOK_AUDIT_USER_ID,
      action: "razorpay.payment.recorded",
      entityType: "payment",
      entityId: outcome.paymentId,
      metadata: { source: "razorpay_webhook", ...auditMeta },
    });
  }
  return outcome;
}

export async function processBusinessWebhookEvent(
  db: TenantDatabase,
  businessId: string,
  event: RazorpayEvent,
): Promise<WebhookOutcome> {
  const payment = event.payload?.payment?.entity;
  const link = event.payload?.payment_link?.entity;
  const type = event.event ?? "";

  switch (type) {
    case "payment_link.paid":
    case "payment_link.partially_paid":
    case "payment.captured": {
      if (!payment?.id || typeof payment.amount !== "number" || !Number.isInteger(payment.amount) || payment.amount <= 0) {
        return { result: "ignored", reason: "no_payment" };
      }
      if (payment.currency && payment.currency !== "INR") return { result: "ignored", reason: "currency" };
      if (payment.status && payment.status !== "captured") return { result: "ignored", reason: "not_captured" };

      const notes = { ...notesObject(link?.notes), ...notesObject(payment.notes) };
      const invoiceId = await resolveInvoiceId(db, businessId, link?.id, notes);
      // A captured payment that is not for one of our links (the business's other uses of Razorpay) is none of our business.
      if (!invoiceId) return { result: "ignored", reason: "not_ours" };

      return recordPayment(db, businessId, {
        razorpayPaymentId: payment.id,
        amountPaise: payment.amount,
        feePaise: typeof payment.fee === "number" ? payment.fee : null,
        taxPaise: typeof payment.tax === "number" ? payment.tax : null,
        method: payment.method,
        cardType: payment.card?.type,
        invoiceId,
        razorpayLinkId: link?.id,
        linkStatus: type === "payment_link.paid" ? "paid" : type === "payment_link.partially_paid" ? "partially_paid" : null,
      });
    }
    case "payment.failed": {
      // Nothing changes in the books; the customer can retry on the same link.
      logger.info({ businessId, errorCode: payment?.error_code ?? null }, "[razorpay] payment failed");
      return { result: "ignored", reason: "payment_failed" };
    }
    case "payment_link.expired":
    case "payment_link.cancelled": {
      if (!link?.id) return { result: "ignored", reason: "no_link" };
      await db
        .update(invoicePaymentLinks)
        .set({ status: type === "payment_link.expired" ? "expired" : "cancelled", updatedAt: new Date() })
        .where(and(
          eq(invoicePaymentLinks.businessId, businessId),
          eq(invoicePaymentLinks.razorpayLinkId, link.id),
          sql`${invoicePaymentLinks.status} IN ('created', 'partially_paid')`,
        ));
      return { result: "link_updated" };
    }
    default:
      return { result: "ignored", reason: "unhandled_event" };
  }
}
