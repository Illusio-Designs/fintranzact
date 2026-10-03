/**
 * GET /api/billing/invoices/:paymentId/pdf — the GST invoice (or credit note)
 * from Finvera Solutions LLP for one subscription payment.
 *
 * Session-authenticated like the document PDF endpoint, and owner-gated like
 * every billing procedure: the caller must be an owner/superadmin member of
 * the organisation the payment belongs to. Failed charges have no invoice.
 */

import type { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import { controlDb, billingPayments, sessions, tenantMembers } from "@fintranzact/db";
import { getSessionIdFromRequest } from "../context.js";
import { PLAN_MANAGER_ROLES } from "../lib/plan-manager.js";
import { formatBillingInvoiceNumber } from "../lib/billing/service.js";
import { generateBillingInvoicePDF } from "../lib/billing/invoice-pdf.js";

export function registerBillingInvoiceRoute(app: Hono): void {
  app.get("/api/billing/invoices/:paymentId/pdf", async (c) => {
    const sessionId = getSessionIdFromRequest(c.req.raw);
    if (!sessionId) return c.json({ error: "Unauthorized" }, 401);
    const [session] = await controlDb
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const paymentId = c.req.param("paymentId");
    if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return c.json({ error: "Invoice not found" }, 404);
    const [payment] = await controlDb
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.id, paymentId))
      .limit(1);
    if (!payment) return c.json({ error: "Invoice not found" }, 404);

    const [membership] = await controlDb
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, payment.tenantId), eq(tenantMembers.userId, session.userId)))
      .limit(1);
    if (!membership || !PLAN_MANAGER_ROLES.includes(membership.role)) {
      return c.json({ error: "Only the organization owner can download billing invoices" }, 403);
    }

    const invoiceNumber = formatBillingInvoiceNumber(payment.invoiceSeq);
    if (!invoiceNumber) return c.json({ error: "This charge has no invoice" }, 404);

    const pdf = await generateBillingInvoicePDF({
      invoiceNumber,
      date: payment.createdAt,
      description: payment.description,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      basePaise: payment.basePaise,
      gstPaise: payment.gstPaise,
      totalPaise: payment.totalPaise,
      method: payment.method,
      providerPaymentId: payment.providerPaymentId,
      customer: {
        name: payment.billingName ?? "Customer",
        gstin: payment.billingGstin,
        address: payment.billingAddress,
        state: payment.billingState,
      },
      isCreditNote: payment.status === "credit",
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
