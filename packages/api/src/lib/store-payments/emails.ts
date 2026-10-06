/**
 * Emails a shopper gets about an online store order: order confirmation,
 * payment received, payment failed (with the way to pay again) and refund
 * issued. Sent from the business's name through the existing email service
 * (the same sender payment reminders use); a reply goes to the business.
 *
 * Every value that comes from a shopper or a business (names, order numbers)
 * is HTML-escaped. A mail carries no keys, tokens or signatures; the only link
 * is the order page on the configured storefront URL.
 */

import { eq, and } from "drizzle-orm";
import { businesses, storeOrders, type TenantDatabase } from "@fintranzact/db";
import { emailService, safeDisplayName, type BuiltEmail, type ReminderEmail } from "../email.js";
import { logger } from "../logger.js";
import { storeOrderUrl } from "./urls.js";

export type StoreMailKind = "placed" | "paid" | "failed" | "refund";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export interface StoreMailInput {
  kind: StoreMailKind;
  businessName: string;
  customerName: string;
  orderNumber: string;
  /** The order total as a money string. */
  total: string;
  /** Refund mail: the amount refunded. */
  amount?: string;
  /** Placed mail: how the shopper chose to pay. */
  method?: "online" | "cod";
  /** The order page (status and Pay again), when the storefront URL is configured. */
  orderUrl: string | null;
}

/** Subject, plain text and HTML for one of the four mails (pure). */
export function buildStoreOrderEmail(p: StoreMailInput): BuiltEmail {
  const rupees = (m: string) => `Rs ${Number(m).toFixed(2)}`;
  const first = p.customerName.trim().split(/\s+/)[0] || "there";
  const lines: string[] = [`Hi ${first},`, ""];
  let subject: string;
  let linkLabel: string | null = null;
  switch (p.kind) {
    case "placed":
      subject = `Order ${p.orderNumber} received - ${p.businessName}`;
      lines.push(`Thank you. ${p.businessName} has received your order ${p.orderNumber} for ${rupees(p.total)}.`);
      if (p.method === "online") {
        lines.push("It is waiting for your online payment. You will get another email when the payment is received.");
        linkLabel = "Pay for your order";
      } else {
        lines.push("You chose Cash on Delivery, so there is nothing to pay now. The business will confirm your order shortly.");
        linkLabel = "View your order";
      }
      break;
    case "paid":
      subject = `Payment received for order ${p.orderNumber} - ${p.businessName}`;
      lines.push(`We received your payment of ${rupees(p.amount ?? p.total)} for order ${p.orderNumber}. ${p.businessName} will confirm your order shortly.`);
      linkLabel = "View your order";
      break;
    case "failed":
      subject = `Payment not completed for order ${p.orderNumber} - ${p.businessName}`;
      lines.push(`Your payment for order ${p.orderNumber} (${rupees(p.total)}) did not go through, and you have not been charged for it. Your order is still saved: you can try again with the button below.`);
      linkLabel = "Pay again";
      break;
    case "refund":
      subject = `Refund issued for order ${p.orderNumber} - ${p.businessName}`;
      lines.push(`${p.businessName} has refunded ${rupees(p.amount ?? p.total)} for order ${p.orderNumber}. It usually reaches your account in 5 to 7 working days, depending on your bank.`);
      linkLabel = "View your order";
      break;
  }
  const footer = `You are receiving this because you placed an order with ${p.businessName}. Reply to this email to reach them.`;
  const text = [...lines, ...(p.orderUrl && linkLabel ? ["", `${linkLabel}: ${p.orderUrl}`] : []), "", "--", footer].join("\n");

  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const paras = lines.filter((l) => l !== "").map((l) => `<p style="margin:0 0 14px 0;">${esc(l)}</p>`).join("");
  const button = p.orderUrl && linkLabel
    ? `<p style="margin:18px 0 6px 0;"><a href="${esc(p.orderUrl)}" style="display:inline-block;padding:11px 20px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;${font}font-size:15px;font-weight:600;">${esc(linkLabel)}</a></p>`
    : "";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(subject)}</title></head><body style="margin:0;padding:24px;background-color:#f3f4f6;"><table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:24px;${font}font-size:15px;line-height:23px;color:#374151;">${paras}${button}</td></tr><tr><td style="padding:0 24px 20px 24px;${font}font-size:12px;line-height:18px;color:#9ca3af;border-top:1px solid #f3f4f6;"><p style="margin:14px 0 0 0;">${esc(footer)}</p></td></tr></table></body></html>`;
  return { subject, text, html };
}

type Sender = (mail: ReminderEmail) => Promise<void>;
let sender: Sender = (mail) => emailService.sendReminder(mail);

/** Tests only: capture the mails instead of sending them (null restores the real sender). */
export function setStoreMailSender(impl: Sender | null): void {
  sender = impl ?? ((mail) => emailService.sendReminder(mail));
}

/**
 * Email the shopper about their order. Best effort: no address on the order
 * means no mail, and a failure to send is logged (without the address) and
 * never undoes the payment, order or refund that triggered it.
 */
export async function sendStoreOrderEmail(
  db: TenantDatabase,
  businessId: string,
  orderId: string,
  kind: StoreMailKind,
  extra: { amount?: string } = {},
): Promise<boolean> {
  try {
    const [row] = await db
      .select({
        email: storeOrders.customerEmail,
        customerName: storeOrders.customerName,
        orderNumber: storeOrders.orderNumber,
        total: storeOrders.totalAmount,
        method: storeOrders.paymentMethod,
        businessName: businesses.name,
        businessEmail: businesses.email,
        slug: businesses.storeSlug,
      })
      .from(storeOrders)
      .innerJoin(businesses, eq(businesses.id, storeOrders.businessId))
      .where(and(eq(storeOrders.id, orderId), eq(storeOrders.businessId, businessId)))
      .limit(1);
    if (!row?.email) return false;
    const built = buildStoreOrderEmail({
      kind,
      businessName: row.businessName,
      customerName: row.customerName,
      orderNumber: row.orderNumber,
      total: row.total,
      amount: extra.amount,
      method: row.method === "online" ? "online" : "cod",
      orderUrl: row.slug ? storeOrderUrl(row.slug, orderId) : null,
    });
    await sender({
      to: row.email,
      fromName: safeDisplayName(row.businessName),
      replyTo: row.businessEmail,
      subject: built.subject,
      text: built.text,
      html: built.html,
    });
    return true;
  } catch (err) {
    logger.warn({ businessId, kind, err: err instanceof Error ? err.message : "error" }, "[store-payments] could not send the order email");
    return false;
  }
}
