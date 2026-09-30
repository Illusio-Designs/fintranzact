/**
 * Public share links for documents stored in the invoices table (invoices,
 * quotations, proforma, delivery challans, credit/debit notes, returns).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { invoices } from "@fintranzact/db";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { getOrCreateShareLink, getShareLink, revokeShareLink, shareUrl, type ShareLinkInfo } from "../lib/share-links.js";

const input = z.object({ documentId: z.string().uuid() });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertDocument(ctx: any, documentId: string) {
  const [doc] = await ctx.db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(and(
      eq(invoices.id, documentId),
      eq(invoices.businessId, ctx.businessId),
      // Only what the business sends out: its sales-side documents.
      eq(invoices.type, "sale"),
      isNull(invoices.deletedAt),
    ))
    .limit(1);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  return doc as { id: string; invoiceNumber: string };
}

function present(link: ShareLinkInfo, origin: string | null) {
  return {
    url: shareUrl(link.token, origin),
    createdAt: link.createdAt,
    viewCount: link.viewCount,
    lastViewedAt: link.lastViewedAt,
  };
}

export const shareRouter = router({
  /** The document's live link, or null when it has none yet. */
  get: viewerProcedure.input(input).query(async ({ ctx, input }) => {
    requireCan(ctx.ability, "read", "Invoice");
    await assertDocument(ctx, input.documentId);
    const link = await getShareLink(ctx.tenantId, input.documentId);
    return link ? present(link, ctx.req.headers.get("origin")) : null;
  }),

  /** The document's live link, created if it has none. */
  create: memberProcedure.input(input).mutation(async ({ ctx, input }) => {
    requireCan(ctx.ability, "read", "Invoice");
    const doc = await assertDocument(ctx, input.documentId);
    const link = await getOrCreateShareLink({
      tenantId: ctx.tenantId,
      businessId: ctx.businessId,
      documentId: doc.id,
      userId: ctx.user.id,
    });
    logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "share.create",
      entityType: "invoice",
      entityId: doc.id,
      metadata: { invoiceNumber: doc.invoiceNumber },
      ipAddress: ctx.ipAddress,
    });
    return present(link, ctx.req.headers.get("origin"));
  }),

  /** Stop the live link working. Sharing again makes a new link. */
  revoke: memberProcedure.input(input).mutation(async ({ ctx, input }) => {
    requireCan(ctx.ability, "update", "Invoice");
    const doc = await assertDocument(ctx, input.documentId);
    const revoked = await revokeShareLink(ctx.tenantId, doc.id);
    if (revoked) {
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "share.revoke",
        entityType: "invoice",
        entityId: doc.id,
        metadata: { invoiceNumber: doc.invoiceNumber },
        ipAddress: ctx.ipAddress,
      });
    }
    return { revoked };
  }),
});
