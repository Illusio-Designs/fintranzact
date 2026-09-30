/**
 * share-links.ts — public links to one document (invoice, quotation, …).
 *
 * A link is a 32-byte random token in the URL. The control DB keeps a SHA-256
 * hash of it for lookup (a leaked table does not hand out working links) and
 * the token itself encrypted, so the business can copy the same link again
 * instead of minting a new one every time. One live link per document;
 * revoking it stops the old URL working and the next share mints a new one.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { controlDb, shareLinks, tenants, encryptField, decryptField } from "@fintranzact/db";

/** Tokens are 43 URL-safe characters; anything else is rejected before a lookup. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

/** Public URL of the share page, on the web app's origin. */
export function shareUrl(token: string, fallbackOrigin?: string | null) {
  const base = (process.env.APP_URL || fallbackOrigin || "").replace(/\/+$/, "");
  return `${base}/i/${token}`;
}

export interface ShareLinkInfo {
  token: string;
  createdAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
}

/** The document's live link, or null when it has none. */
export async function getShareLink(tenantId: string, documentId: string): Promise<ShareLinkInfo | null> {
  const [row] = await controlDb
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.tenantId, tenantId), eq(shareLinks.documentId, documentId), isNull(shareLinks.revokedAt)))
    .limit(1);
  if (!row) return null;
  return {
    token: decryptField(row.tokenEncrypted),
    createdAt: row.createdAt,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt,
  };
}

/** Return the live link, minting one if the document has none. */
export async function getOrCreateShareLink(input: {
  tenantId: string;
  businessId: string;
  documentId: string;
  userId: string;
}): Promise<ShareLinkInfo> {
  const existing = await getShareLink(input.tenantId, input.documentId);
  if (existing) return existing;

  const token = newToken();
  const [row] = await controlDb
    .insert(shareLinks)
    .values({
      tokenHash: hashShareToken(token),
      tokenEncrypted: encryptField(token),
      tenantId: input.tenantId,
      businessId: input.businessId,
      documentId: input.documentId,
      createdByUserId: input.userId,
    })
    // Two tabs sharing at once: the partial unique index keeps one live link,
    // and the loser reads the winner's.
    .onConflictDoNothing()
    .returning();
  if (row) return { token, createdAt: row.createdAt, viewCount: 0, lastViewedAt: null };

  const winner = await getShareLink(input.tenantId, input.documentId);
  if (!winner) throw new Error("Could not create a share link");
  return winner;
}

/** Stop the document's live link working. Returns whether one was live. */
export async function revokeShareLink(tenantId: string, documentId: string): Promise<boolean> {
  const rows = await controlDb
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.tenantId, tenantId), eq(shareLinks.documentId, documentId), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id });
  return rows.length > 0;
}

export interface ResolvedShareLink {
  id: string;
  tenantId: string;
  businessId: string;
  documentId: string;
  tenantPlan: string;
}

/**
 * Find the live link for a token, or null. Null covers malformed, unknown,
 * revoked and suspended-tenant tokens alike, so a caller cannot tell them
 * apart.
 */
export async function resolveShareToken(token: string): Promise<ResolvedShareLink | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await controlDb
    .select({
      id: shareLinks.id,
      tenantId: shareLinks.tenantId,
      businessId: shareLinks.businessId,
      documentId: shareLinks.documentId,
      tenantStatus: tenants.status,
      tenantPlan: tenants.plan,
    })
    .from(shareLinks)
    .innerJoin(tenants, eq(tenants.id, shareLinks.tenantId))
    .where(and(eq(shareLinks.tokenHash, hashShareToken(token)), isNull(shareLinks.revokedAt)))
    .limit(1);
  if (!row || row.tenantStatus !== "active") return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    documentId: row.documentId,
    tenantPlan: row.tenantPlan,
  };
}

/** Count a view (best effort — a failed counter never blocks the page). */
export async function recordShareView(id: string) {
  await controlDb
    .update(shareLinks)
    .set({ viewCount: sql`${shareLinks.viewCount} + 1`, lastViewedAt: new Date() })
    .where(eq(shareLinks.id, id))
    .catch(() => undefined);
}
