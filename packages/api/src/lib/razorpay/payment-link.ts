/**
 * Razorpay payment link for an invoice's balance due, created on the
 * business's own Razorpay account.
 *
 * The amount is always worked out here from the database (total, less what is
 * paid and credited); nothing the client sends is trusted. One active link
 * per invoice: asked again with the balance unchanged it returns the same
 * link, with the balance changed it makes a new link and cancels the old.
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { businesses, invoicePaymentLinks, invoices, parties, type TenantDatabase } from "@fintranzact/db";
import { money } from "@fintranzact/shared";
import { ADJUSTING_DOCUMENT_TYPES } from "../invoice-status.js";
import { logger } from "../logger.js";
import { decryptConnection, getConnectionRow } from "./connection.js";
import { moneyToPaise, razorpay, razorpayContact, razorpayEmail } from "./client.js";

/** Razorpay will not take less than ₹1. */
export const MIN_LINK_PAISE = 100;

export type PaymentLinkRefusal =
  | "not_connected"
  | "not_found"
  | "not_payable"
  | "settled"
  | "below_minimum"
  | "gateway_error";

export class PaymentLinkError extends Error {
  constructor(
    readonly reason: PaymentLinkRefusal,
    message: string,
  ) {
    super(message);
    this.name = "PaymentLinkError";
  }
}

export interface InvoiceBalance {
  id: string;
  invoiceNumber: string;
  status: string;
  documentType: string;
  type: string;
  partyId: string;
  /** Balance due as a money string. */
  balance: string;
}

/** The invoice and its balance due: total less payments and credit notes/returns. */
export async function loadInvoiceBalance(db: Pick<TenantDatabase, "select">, businessId: string, invoiceId: string): Promise<InvoiceBalance | null> {
  const [inv] = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      documentType: invoices.documentType,
      type: invoices.type,
      partyId: invoices.partyId,
      totalAmount: invoices.totalAmount,
      amountPaid: invoices.amountPaid,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId), isNull(invoices.deletedAt)))
    .limit(1);
  if (!inv) return null;
  const [adj] = await db
    .select({ total: sql<string>`COALESCE(SUM(${invoices.totalAmount}), 0)::text` })
    .from(invoices)
    .where(and(
      eq(invoices.referenceDocumentId, invoiceId),
      eq(invoices.businessId, businessId),
      isNull(invoices.deletedAt),
      inArray(invoices.documentType, [...ADJUSTING_DOCUMENT_TYPES]),
      sql`${invoices.status} <> 'cancelled'`,
    ));
  const balance = money.max0(money.sub(money.sub(inv.totalAmount, inv.amountPaid), adj?.total ?? "0"));
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    documentType: inv.documentType,
    type: inv.type,
    partyId: inv.partyId,
    balance,
  };
}

/** Why an invoice cannot take an online payment right now, or null when it can. */
export function paymentLinkRefusal(inv: InvoiceBalance): { reason: PaymentLinkRefusal; message: string } | null {
  if (inv.documentType !== "invoice" || inv.type !== "sale" || ["draft", "cancelled"].includes(inv.status)) {
    return { reason: "not_payable", message: "Only issued sales invoices can be paid online." };
  }
  if (["paid", "adjusted"].includes(inv.status) || moneyToPaise(inv.balance) <= 0) {
    return { reason: "settled", message: "This invoice has nothing left to pay." };
  }
  if (moneyToPaise(inv.balance) < MIN_LINK_PAISE) {
    return { reason: "below_minimum", message: "The balance is below the ₹1 minimum for an online payment." };
  }
  return null;
}

export interface ActivePaymentLink {
  id: string;
  shortUrl: string;
  amountPaise: number;
  status: string;
  createdAt: Date;
}

export async function getActivePaymentLink(db: TenantDatabase, businessId: string, invoiceId: string): Promise<ActivePaymentLink | null> {
  const [row] = await db
    .select()
    .from(invoicePaymentLinks)
    .where(and(
      eq(invoicePaymentLinks.businessId, businessId),
      eq(invoicePaymentLinks.invoiceId, invoiceId),
      inArray(invoicePaymentLinks.status, ["created", "partially_paid"]),
    ))
    .orderBy(desc(invoicePaymentLinks.createdAt))
    .limit(1);
  return row ? { id: row.id, shortUrl: row.shortUrl, amountPaise: row.amountPaise, status: row.status, createdAt: row.createdAt } : null;
}

/**
 * The invoice's active payment link for its current balance, created if
 * needed. `shareUrl` is where the customer returns after paying.
 */
export async function ensureInvoicePaymentLink(
  db: TenantDatabase,
  params: {
    businessId: string;
    invoiceId: string;
    shareUrl: string | null;
    /** Store orders: pay in full, on the shopper's own details, with the order named in the notes. */
    storeOrder?: { orderId: string; orderNumber: string; customerName: string; customerEmail: string | null; customerPhone: string };
  },
): Promise<{ link: ActivePaymentLink; created: boolean; supersededRazorpayLinkIds: string[] }> {
  const connection = await getConnectionRow(db, params.businessId);
  if (!connection) throw new PaymentLinkError("not_connected", "Online payments are not set up for this business.");
  const creds = decryptConnection(connection);

  const inv = await loadInvoiceBalance(db, params.businessId, params.invoiceId);
  if (!inv) throw new PaymentLinkError("not_found", "Invoice not found.");
  const refusal = paymentLinkRefusal(inv);
  if (refusal) throw new PaymentLinkError(refusal.reason, refusal.message);
  const amountPaise = moneyToPaise(inv.balance);

  return db.transaction(async (tx) => {
    // One creator per invoice at a time, so two tabs cannot both mint a link.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"rzp-link:" + params.invoiceId}))`);

    const activeRows = await tx
      .select()
      .from(invoicePaymentLinks)
      .where(and(
        eq(invoicePaymentLinks.businessId, params.businessId),
        eq(invoicePaymentLinks.invoiceId, params.invoiceId),
        inArray(invoicePaymentLinks.status, ["created", "partially_paid"]),
      ));
    const same = activeRows.find((r) => r.amountPaise === amountPaise);
    if (same) {
      return {
        link: { id: same.id, shortUrl: same.shortUrl, amountPaise: same.amountPaise, status: same.status, createdAt: same.createdAt },
        created: false,
        supersededRazorpayLinkIds: [],
      };
    }

    const [partyRow] = await tx.select({ name: parties.name, email: parties.email, phone: parties.phone }).from(parties).where(eq(parties.id, inv.partyId)).limit(1);
    const so = params.storeOrder;
    const party = so ? { name: so.customerName, email: so.customerEmail, phone: so.customerPhone } : partyRow;
    const [biz] = await tx.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, params.businessId)).limit(1);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invoicePaymentLinks)
      .where(and(eq(invoicePaymentLinks.businessId, params.businessId), eq(invoicePaymentLinks.invoiceId, params.invoiceId)));

    let created;
    try {
      created = await razorpay.createPaymentLink(creds, {
        amountPaise,
        // Razorpay wants a unique reference per link: the invoice number, then -2, -3 for re-issues.
        referenceId: n === 0 ? inv.invoiceNumber : `${inv.invoiceNumber}-${n + 1}`,
        description: so
          ? `Order ${so.orderNumber}${biz?.name ? ` - ${biz.name}` : ""}`
          : `Invoice ${inv.invoiceNumber}${biz?.name ? ` - ${biz.name}` : ""}`,
        customer: { name: party?.name, email: razorpayEmail(party?.email), contact: razorpayContact(party?.phone) },
        callbackUrl: params.shareUrl,
        notes: {
          invoice_id: inv.id,
          business_id: params.businessId,
          invoice_number: inv.invoiceNumber,
          ...(so ? { store_order_id: so.orderId } : {}),
        },
        firstMinPartialPaise: MIN_LINK_PAISE,
        ...(so ? { acceptPartial: false } : {}),
      });
    } catch (err) {
      const e = err as { status?: number; description?: string };
      logger.warn({ status: e.status, businessId: params.businessId }, "[razorpay] payment link creation failed");
      throw new PaymentLinkError(
        "gateway_error",
        e.status === 401
          ? "Razorpay rejected this business's keys. Check them in Settings, Online payments."
          : "Could not create the payment link with Razorpay. Try again in a moment.",
      );
    }

    // The new link replaces any older active one (a balance that has moved).
    if (activeRows.length > 0) {
      await tx
        .update(invoicePaymentLinks)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(inArray(invoicePaymentLinks.id, activeRows.map((r) => r.id)));
    }
    const [row] = await tx
      .insert(invoicePaymentLinks)
      .values({
        businessId: params.businessId,
        invoiceId: params.invoiceId,
        razorpayLinkId: created.id,
        shortUrl: created.short_url,
        amountPaise,
      })
      .returning();

    // Best effort: stop the old link on Razorpay so it cannot be paid for a stale amount.
    const superseded = activeRows.map((r) => r.razorpayLinkId);
    for (const id of superseded) {
      razorpay.cancelPaymentLink(creds, id).catch(() => logger.warn({ businessId: params.businessId }, "[razorpay] could not cancel superseded payment link"));
    }

    return {
      link: { id: row!.id, shortUrl: row!.shortUrl, amountPaise: row!.amountPaise, status: row!.status, createdAt: row!.createdAt },
      created: true,
      supersededRazorpayLinkIds: superseded,
    };
  });
}
