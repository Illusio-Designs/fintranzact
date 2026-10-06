/**
 * A business's own Razorpay connection: its API keys (encrypted at rest), the
 * webhook secret it copied from ITS Razorpay dashboard, and the unguessable
 * webhook token that routes Razorpay's callbacks to the right business.
 *
 * Secrets never leave this module in a form a client could receive:
 * presentConnection returns only the masked key id and booleans.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { controlDb, getTenantDb, invoicePaymentLinks, razorpayConnections, tenants, type TenantDatabase } from "@fintranzact/db";
import { decryptGatewaySecret, encryptGatewaySecret } from "../field-encryption.js";
import { maskKeyId, parseKeyId, razorpay, type RazorpayCredentials } from "./client.js";

/** Events the owner ticks when adding the webhook in their Razorpay dashboard. */
export const RAZORPAY_WEBHOOK_EVENTS = [
  "payment_link.paid",
  "payment_link.partially_paid",
  "payment_link.cancelled",
  "payment_link.expired",
  "payment.captured",
  "payment.failed",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i;

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** "<tenantId>.<32 random bytes>": the tenant id routes, the random part authenticates. */
function newWebhookToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString("base64url")}`;
}

/** The API server's public origin, for the webhook URL shown to the owner. */
export function publicApiOrigin(req: { url: string; headers: { get(name: string): string | null } }): string {
  const configured = process.env.API_URL || process.env.PUBLIC_API_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  return `${proto}://${host}`;
}

export function webhookUrl(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/webhooks/razorpay/business/${token}`;
}

export interface ConnectionView {
  connected: boolean;
  keyIdMasked: string | null;
  mode: "test" | "live" | null;
  hasWebhookSecret: boolean;
  webhookUrl: string | null;
  webhookEvents: readonly string[];
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
}

const NOT_CONNECTED: ConnectionView = {
  connected: false,
  keyIdMasked: null,
  mode: null,
  hasWebhookSecret: false,
  webhookUrl: null,
  webhookEvents: RAZORPAY_WEBHOOK_EVENTS,
  lastTestedAt: null,
  lastTestOk: null,
};

type ConnectionRow = typeof razorpayConnections.$inferSelect;

/** What a client may see. No key, no secret, no bare token. */
export function presentConnection(row: ConnectionRow | undefined | null, origin: string): ConnectionView {
  if (!row) return NOT_CONNECTED;
  return {
    connected: true,
    keyIdMasked: row.keyIdMasked,
    mode: row.mode === "live" ? "live" : "test",
    hasWebhookSecret: !!row.webhookSecretEncrypted,
    webhookUrl: webhookUrl(decryptGatewaySecret(row.webhookTokenEncrypted), origin),
    webhookEvents: RAZORPAY_WEBHOOK_EVENTS,
    lastTestedAt: row.lastTestedAt,
    lastTestOk: row.lastTestOk,
  };
}

export async function getConnectionRow(db: TenantDatabase, businessId: string): Promise<ConnectionRow | null> {
  const [row] = await db.select().from(razorpayConnections).where(eq(razorpayConnections.businessId, businessId)).limit(1);
  return row ?? null;
}

export interface DecryptedConnection extends RazorpayCredentials {
  webhookSecret: string | null;
}

export function decryptConnection(row: ConnectionRow): DecryptedConnection {
  return {
    keyId: decryptGatewaySecret(row.keyIdEncrypted),
    keySecret: decryptGatewaySecret(row.keySecretEncrypted),
    webhookSecret: row.webhookSecretEncrypted ? decryptGatewaySecret(row.webhookSecretEncrypted) : null,
  };
}

export class InvalidRazorpayKeyError extends Error {}

/**
 * Save (create or update) the connection. The key id and secret are always
 * required together; a blank webhook secret on re-save keeps the stored one.
 * The webhook token is minted once and kept, so the URL already added in the
 * owner's Razorpay dashboard keeps working when keys are rotated.
 */
export async function saveConnection(
  db: TenantDatabase,
  params: { tenantId: string; businessId: string; keyId: string; keySecret: string; webhookSecret?: string | null },
): Promise<ConnectionRow> {
  const keyId = params.keyId.trim();
  const keySecret = params.keySecret.trim();
  const parsed = parseKeyId(keyId);
  if (!parsed) throw new InvalidRazorpayKeyError("That does not look like a Razorpay key id (it starts with rzp_test_ or rzp_live_).");
  if (keySecret.length < 8 || /\s/.test(keySecret)) throw new InvalidRazorpayKeyError("Enter the Razorpay key secret.");

  const existing = await getConnectionRow(db, params.businessId);
  const webhookSecret = params.webhookSecret?.trim() || null;
  if (webhookSecret && webhookSecret.length < 6) throw new InvalidRazorpayKeyError("The webhook secret must be at least 6 characters.");

  const values = {
    keyIdEncrypted: encryptGatewaySecret(keyId),
    keySecretEncrypted: encryptGatewaySecret(keySecret),
    keyIdMasked: maskKeyId(keyId),
    mode: parsed.mode,
    ...(webhookSecret ? { webhookSecretEncrypted: encryptGatewaySecret(webhookSecret) } : {}),
    // New keys have not been tested yet.
    lastTestedAt: null,
    lastTestOk: null,
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db.update(razorpayConnections).set(values).where(eq(razorpayConnections.id, existing.id)).returning();
    return row!;
  }
  const token = newWebhookToken(params.tenantId);
  const [row] = await db
    .insert(razorpayConnections)
    .values({
      businessId: params.businessId,
      ...values,
      webhookSecretEncrypted: webhookSecret ? encryptGatewaySecret(webhookSecret) : null,
      webhookTokenHash: hashWebhookToken(token),
      webhookTokenEncrypted: encryptGatewaySecret(token),
    })
    .returning();
  return row!;
}

/** Call Razorpay with the stored keys and remember the outcome. */
export async function testStoredConnection(
  db: TenantDatabase,
  businessId: string,
): Promise<{ ok: boolean; message: string }> {
  const row = await getConnectionRow(db, businessId);
  if (!row) return { ok: false, message: "Razorpay is not connected." };
  let ok = false;
  let message: string;
  try {
    await razorpay.testConnection(decryptConnection(row));
    ok = true;
    message = "Connected. Razorpay accepted your keys.";
  } catch (err) {
    const status = (err as { status?: number }).status;
    const description = (err as { description?: string }).description;
    message =
      status === 401
        ? "Razorpay rejected these keys. Check the key id and secret."
        : status === 0
          ? "Could not reach Razorpay. Try again in a moment."
          : `Razorpay answered with an error${description ? `: ${description}` : "."}`;
  }
  await db
    .update(razorpayConnections)
    .set({ lastTestedAt: new Date(), lastTestOk: ok, updatedAt: new Date() })
    .where(eq(razorpayConnections.id, row.id));
  return { ok, message };
}

/**
 * Remove the keys. Active payment links are cancelled on Razorpay (best
 * effort, while the keys still exist) and locally, so nothing keeps pointing
 * at a connection that is gone.
 */
export async function disconnect(db: TenantDatabase, businessId: string): Promise<boolean> {
  const row = await getConnectionRow(db, businessId);
  if (!row) return false;
  const active = await db
    .select({ id: invoicePaymentLinks.id, razorpayLinkId: invoicePaymentLinks.razorpayLinkId })
    .from(invoicePaymentLinks)
    .where(and(eq(invoicePaymentLinks.businessId, businessId), inArray(invoicePaymentLinks.status, ["created", "partially_paid"])));
  if (active.length > 0) {
    const creds = decryptConnection(row);
    await Promise.allSettled(active.map((l) => razorpay.cancelPaymentLink(creds, l.razorpayLinkId)));
    await db
      .update(invoicePaymentLinks)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(inArray(invoicePaymentLinks.id, active.map((l) => l.id)));
  }
  await db.delete(razorpayConnections).where(eq(razorpayConnections.id, row.id));
  return true;
}

export interface ResolvedWebhookConnection {
  tenantId: string;
  businessId: string;
  webhookSecret: string;
  db: TenantDatabase;
}

/**
 * Find the business a webhook URL token belongs to, or null. Null covers a
 * malformed token, an unknown token, no webhook secret saved and an inactive
 * organisation alike, so a caller cannot tell them apart.
 */
export async function resolveWebhookConnection(token: string): Promise<ResolvedWebhookConnection | null> {
  if (!TOKEN_RE.test(token)) return null;
  const tenantId = token.slice(0, 36);
  if (!UUID_RE.test(tenantId)) return null;
  const [tenant] = await controlDb.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return null;
  const db = await getTenantDb(tenantId);
  const [row] = await db
    .select()
    .from(razorpayConnections)
    .where(eq(razorpayConnections.webhookTokenHash, hashWebhookToken(token)))
    .limit(1);
  if (!row || !row.webhookSecretEncrypted) return null;
  return { tenantId, businessId: row.businessId, webhookSecret: decryptGatewaySecret(row.webhookSecretEncrypted), db };
}
