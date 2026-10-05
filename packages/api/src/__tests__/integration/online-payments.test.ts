/**
 * Online payments on invoices, end to end against the real test database with
 * a MOCKED Razorpay (the HTTP layer is injected; the real Razorpay is never
 * called):
 *   - settings: a business connects its OWN keys (owner/admin only), stored
 *     encrypted, never returned, webhook URL unique per business;
 *   - payment links: made from the database balance, reused while the balance
 *     is unchanged, replaced when it moves, refused on drafts / cancelled /
 *     paid invoices, blocked in read-only mode, public share-page variant;
 *   - webhook: signature verified per business, payments recorded once per
 *     Razorpay payment id, partial and over-payments, gateway charges.
 */

import { createHmac, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  bankAccounts,
  bankTransactions,
  controlDb,
  expenses,
  getTenantDb,
  invoicePaymentLinks,
  invoices,
  paymentAllocations,
  paymentGatewayConfigs,
  payments,
  razorpayConnections,
  razorpayPayments,
  tenants,
} from "@fintranzact/db";
import { closeTestDb, getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import {
  addMember,
  createBankAccount,
  createBusiness,
  createInvoiceWithItems,
  createParty,
  createTenant,
  createTestWorld,
  createUser,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { setRazorpayFetch } from "../../lib/razorpay/client.js";
import { registerBusinessRazorpayWebhook } from "../../http/businessRazorpayWebhook.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";
import { createSharePaymentLink, shareOnlinePaymentAvailable } from "../../lib/razorpay/share.js";
import { getOrCreateShareLink, resolveShareToken } from "../../lib/share-links.js";

const KEY_ID = "rzp_test_OwnerKey1234";
const KEY_SECRET = "owner_key_secret_value";
const WEBHOOK_SECRET = "owner_webhook_secret";

// ── Mock Razorpay ─────────────────────────────────────────────────────────────

interface Call { method: string; path: string; body: Record<string, any> | null; auth: string }
let calls: Call[] = [];
let failCreate = false;
let rejectKeys = false;
let linkSeq = 0;

function installRazorpay() {
  setRazorpayFetch(async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const auth = Buffer.from(String(((init?.headers ?? {}) as Record<string, string>).Authorization).replace("Basic ", ""), "base64").toString();
    calls.push({ method, path, body, auth });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (rejectKeys) return json(401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
    if (method === "GET" && path === "/payment_links") return json(200, { payment_links: [] });
    if (method === "POST" && path === "/payment_links") {
      if (failCreate) return json(500, { error: { description: "boom" } });
      linkSeq += 1;
      return json(200, { id: `plink_Mock${linkSeq}`, short_url: `https://rzp.io/i/mock${linkSeq}`, status: "created", amount: body!.amount });
    }
    if (method === "POST" && /^\/payment_links\/[^/]+\/cancel$/.test(path)) return json(200, { status: "cancelled" });
    return json(404, { error: { description: "unexpected call" } });
  });
}

// ── World ─────────────────────────────────────────────────────────────────────

let world: TestWorld;
const owner = () => callerFor(world.ramesh);
const seller = () => callerFor(world.suresh);
function callerFor(user: TestWorld["ramesh"]) {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId: world.tenant1.id, businessId: world.business1.id });
}
const db = () => getTenantTestDb();
/** The application-side handle the lib functions take (the helper one has the test schema type). */
const appDb = () => getTenantDb(world.tenant1.id);

let app: Hono;
async function deliver(token: string, event: unknown, opts: { secret?: string; signature?: string | null } = {}) {
  const raw = JSON.stringify(event);
  const signature = opts.signature === undefined ? createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(raw).digest("hex") : opts.signature;
  return app.request(`/webhooks/razorpay/business/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-razorpay-signature": signature } : {}) },
    body: raw,
  });
}

let token: string;
async function tokenFor(c: ReturnType<typeof owner>) {
  const settings = await c.onlinePayments.getSettings();
  return settings.webhookUrl!.split("/webhooks/razorpay/business/")[1]!;
}

/** A sent invoice of `price` (no tax) for party1 in business1. */
async function sentInvoice(price: string, overrides: Record<string, unknown> = {}) {
  const { invoice } = await createInvoiceWithItems(db(), world.business1.id, world.party1.id, [{ itemId: world.item1.id, itemName: "Cotton", quantity: "1", unitPrice: price }], { status: "sent", ...overrides });
  return invoice;
}

function paidEvent(opts: { invoiceId?: string; linkId: string; paymentId: string; amount: number; fee?: number | null; method?: string; card?: string; event?: string; linkStatus?: string; notes?: Record<string, string> }) {
  return {
    event: opts.event ?? "payment_link.paid",
    payload: {
      payment: { entity: { id: opts.paymentId, amount: opts.amount, currency: "INR", status: "captured", method: opts.method ?? "upi", fee: opts.fee ?? null, tax: opts.fee ? Math.round(opts.fee * 0.18 / 1.18) : null, ...(opts.card ? { card: { type: opts.card } } : {}), notes: opts.notes ?? [] } },
      payment_link: { entity: { id: opts.linkId, status: opts.linkStatus ?? "paid", notes: opts.notes ?? [] } },
    },
  };
}

beforeAll(async () => {
  process.env.APP_URL = "https://app.fintranzact.example";
  world = await createTestWorld();
  app = new Hono();
  registerBusinessRazorpayWebhook(app, { clientIp: () => "203.0.113.9", rateLimitDisabled: true });
  installRazorpay();
});

afterEach(() => {
  failCreate = false;
  rejectKeys = false;
});

afterAll(async () => {
  setRazorpayFetch(null);
  await truncateAllTables();
  await closeTestDb();
});

// ── Settings ──────────────────────────────────────────────────────────────────

describe("settings: the business's own Razorpay keys", () => {
  it("starts not connected", async () => {
    expect(await owner().onlinePayments.getSettings()).toMatchObject({ connected: false, keyIdMasked: null, webhookUrl: null });
  });

  it("only owners and admins can manage keys", async () => {
    await expect(seller().onlinePayments.getSettings()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(seller().onlinePayments.connect({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(seller().onlinePayments.disconnect()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(seller().onlinePayments.testConnection()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects something that is not a Razorpay key id", async () => {
    await expect(owner().onlinePayments.connect({ keyId: "sk_live_abc123456", keySecret: KEY_SECRET })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("stores keys encrypted and never returns them", async () => {
    const saved = await owner().onlinePayments.connect({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
    const settings = await owner().onlinePayments.getSettings();
    for (const out of [saved, settings]) {
      const text = JSON.stringify(out);
      expect(text).not.toContain(KEY_SECRET);
      expect(text).not.toContain(WEBHOOK_SECRET);
      expect(text).not.toContain(KEY_ID);
    }
    expect(settings).toMatchObject({ connected: true, keyIdMasked: "rzp_test_••••1234", mode: "test", hasWebhookSecret: true });
    expect(settings.webhookEvents).toEqual(["payment_link.paid", "payment_link.partially_paid", "payment_link.cancelled", "payment_link.expired", "payment.captured", "payment.failed"]);

    const [row] = await db().select().from(razorpayConnections).where(eq(razorpayConnections.businessId, world.business1.id));
    const raw = JSON.stringify(row);
    expect(raw).not.toContain(KEY_SECRET);
    expect(raw).not.toContain(WEBHOOK_SECRET);
    expect(raw).not.toContain(KEY_ID);
    expect(row!.keySecretEncrypted).toMatch(/^v\d+:/);
    expect(row!.webhookSecretEncrypted).toMatch(/^v\d+:/);
  });

  it("gives a webhook URL with an unguessable per-business token, kept when the keys are re-saved", async () => {
    const first = (await owner().onlinePayments.getSettings()).webhookUrl!;
    expect(first).toMatch(new RegExp(`/webhooks/razorpay/business/${world.tenant1.id}\\.[A-Za-z0-9_-]{43}$`));
    // Re-save with a blank webhook secret: URL and stored secret stay.
    await owner().onlinePayments.connect({ keyId: KEY_ID, keySecret: KEY_SECRET });
    const again = await owner().onlinePayments.getSettings();
    expect(again.webhookUrl).toBe(first);
    expect(again.hasWebhookSecret).toBe(true);
    token = first.split("/webhooks/razorpay/business/")[1]!;
  });

  it("tests the connection against Razorpay with the business's own keys, never the platform's", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_PLATFORMKEY99";
    process.env.RAZORPAY_KEY_SECRET = "platform_secret_value";
    calls = [];
    const ok = await owner().onlinePayments.testConnection();
    expect(ok.ok).toBe(true);
    expect(calls.map((c) => c.auth)).toEqual([`${KEY_ID}:${KEY_SECRET}`]);
    rejectKeys = true;
    const bad = await owner().onlinePayments.testConnection();
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain(KEY_SECRET);
    expect((await owner().onlinePayments.getSettings()).lastTestOk).toBe(false);
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it("audits connecting without any secret in the entry", async () => {
    const rows = await db().select().from(auditLog).where(and(eq(auditLog.businessId, world.business1.id), eq(auditLog.action, "onlinePayments.connect")));
    expect(rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(KEY_SECRET);
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(text).not.toContain(KEY_ID);
  });

  it("another business has its own connection and token", async () => {
    const kiran = createTestCaller({ userId: world.kiran.id, email: world.kiran.email, name: world.kiran.name ?? null, tenantId: world.tenant2.id, businessId: world.business2.id });
    expect((await kiran.onlinePayments.getSettings()).connected).toBe(false);
    await kiran.onlinePayments.connect({ keyId: "rzp_live_KiranKey98765", keySecret: "kiran_secret_value", webhookSecret: "kiran_whsec" });
    const kiranToken = await tokenFor(kiran as never);
    expect(kiranToken).not.toBe(token);
    expect(kiranToken.startsWith(world.tenant2.id)).toBe(true);
    // Kiran's token with the OTHER business's secret is refused.
    const res = await deliver(kiranToken, { event: "payment.failed" }, { secret: WEBHOOK_SECRET });
    expect(res.status).toBe(401);
  });
});

// ── Payment links ─────────────────────────────────────────────────────────────

describe("payment links", () => {
  it("makes a link for the balance due from the database, with the invoice details", async () => {
    const inv = await sentInvoice("1180.00");
    calls = [];
    const out = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    expect(out).toMatchObject({ created: true, amount: "1180.00", url: expect.stringMatching(/^https:\/\/rzp\.io\/i\//) });
    const create = calls.find((c) => c.method === "POST" && c.path === "/payment_links")!;
    expect(create.auth).toBe(`${KEY_ID}:${KEY_SECRET}`);
    expect(create.body).toMatchObject({
      amount: 118000,
      currency: "INR",
      reference_id: inv.invoiceNumber,
      customer: { name: world.party1.name, email: "priya.textiles@example.in", contact: "+919123456780" },
      notes: { invoice_id: inv.id, business_id: world.business1.id },
      notify: { sms: false, email: false },
    });
    expect(create.body!.callback_url).toMatch(/^https:\/\/app\.fintranzact\.example\/i\/[A-Za-z0-9_-]{43}$/);
    const state = await owner().onlinePayments.invoiceLink({ invoiceId: inv.id });
    expect(state).toMatchObject({ connected: true, canPay: true, balance: "1180.00", link: { url: out.url, amount: "1180.00", current: true } });
  });

  it("reuses the link while the balance is unchanged (staff can make it too)", async () => {
    const inv = await sentInvoice("500.00");
    const a = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    calls = [];
    const b = await seller().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    expect(b).toMatchObject({ created: false, url: a.url });
    expect(calls).toEqual([]);
  });

  it("makes a new link and cancels the old one when the balance changed", async () => {
    const inv = await sentInvoice("1000.00");
    const first = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    await db().update(invoices).set({ amountPaid: "400.00", status: "partial" }).where(eq(invoices.id, inv.id));
    calls = [];
    const second = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    expect(second).toMatchObject({ created: true, amount: "600.00" });
    expect(second.url).not.toBe(first.url);
    const create = calls.find((c) => c.path === "/payment_links" && c.method === "POST")!;
    expect(create.body).toMatchObject({ amount: 60000, reference_id: `${inv.invoiceNumber}-2` });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => /\/payment_links\/plink_Mock\d+\/cancel$/.test(c.path))).toBe(true);
    const rows = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    expect(rows.filter((r) => r.status === "created")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "cancelled")).toHaveLength(1);
  });

  it("takes the credit notes into account in the balance", async () => {
    const inv = await sentInvoice("1000.00");
    await createInvoiceWithItems(db(), world.business1.id, world.party1.id, [{ itemId: world.item1.id, itemName: "Return", quantity: "1", unitPrice: "250.00" }], {
      documentType: "credit_note",
      status: "sent",
      referenceDocumentId: inv.id,
    });
    const out = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    expect(out.amount).toBe("750.00");
  });

  it("refuses drafts, cancelled, paid and non-sale / non-invoice documents", async () => {
    const draft = await sentInvoice("100.00", { status: "draft" });
    const cancelled = await sentInvoice("100.00", { status: "cancelled" });
    const paid = await sentInvoice("100.00", { status: "paid", amountPaid: "100.00" });
    const quote = await sentInvoice("100.00", { documentType: "quotation" });
    for (const inv of [draft, cancelled, paid, quote]) {
      await expect(owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect((await owner().onlinePayments.invoiceLink({ invoiceId: inv.id })).canPay).toBe(false);
    }
  });

  it("refuses a balance under the ₹1 minimum", async () => {
    const tiny = await sentInvoice("0.50");
    await expect(owner().onlinePayments.createInvoiceLink({ invoiceId: tiny.id })).rejects.toMatchObject({ message: expect.stringContaining("₹1") });
  });

  it("does not reach another business's invoice", async () => {
    const { invoice } = await createInvoiceWithItems(db(), world.business2.id, world.party2.id, [{ itemId: world.item2.id, itemName: "Incense", quantity: "1", unitPrice: "100" }], { status: "sent" });
    await expect(owner().onlinePayments.createInvoiceLink({ invoiceId: invoice.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner().onlinePayments.invoiceLink({ invoiceId: invoice.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("surfaces a Razorpay failure without keys and leaves no link behind", async () => {
    const inv = await sentInvoice("300.00");
    failCreate = true;
    const err = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id }).then(() => null, (e) => e);
    expect(err.message).toContain("Could not create the payment link");
    expect(err.message).not.toContain(KEY_SECRET);
    expect(await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id))).toHaveLength(0);
  });

  it("two simultaneous requests make one link", async () => {
    const inv = await sentInvoice("777.00");
    const [a, b] = await Promise.all([owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id }), seller().onlinePayments.createInvoiceLink({ invoiceId: inv.id })]);
    expect(a.url).toBe(b.url);
    expect(await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id))).toHaveLength(1);
  });
});

// ── Public share page ─────────────────────────────────────────────────────────

describe("public share page: Pay now", () => {
  it("creates the link from the token alone, with no keys in the answer", async () => {
    const inv = await sentInvoice("2500.00");
    const share = await getOrCreateShareLink({ tenantId: world.tenant1.id, businessId: world.business1.id, documentId: inv.id, userId: world.ramesh.id });
    const link = (await resolveShareToken(share.token))!;
    expect(await shareOnlinePaymentAvailable(await appDb(), link)).toBe(true);
    calls = [];
    const res = await createSharePaymentLink(await appDb(), link, share.token);
    expect(res).toMatchObject({ ok: true, amountPaise: 250000 });
    const text = JSON.stringify(res);
    expect(text).not.toContain(KEY_SECRET);
    expect(text).not.toContain(KEY_ID);
    expect(calls.find((c) => c.path === "/payment_links" && c.method === "POST")!.body!.callback_url).toBe(`https://app.fintranzact.example/i/${share.token}`);
    // Pressing it again reuses the same link.
    const again = await createSharePaymentLink(await appDb(), link, share.token);
    expect(again).toMatchObject({ ok: true, url: (res as { url: string }).url });
  });

  it("is not offered for a paid invoice or a document that is not an invoice", async () => {
    const paid = await sentInvoice("100.00", { status: "paid", amountPaid: "100.00" });
    const quote = await sentInvoice("100.00", { documentType: "quotation" });
    for (const inv of [paid, quote]) {
      const share = await getOrCreateShareLink({ tenantId: world.tenant1.id, businessId: world.business1.id, documentId: inv.id, userId: world.ramesh.id });
      const link = (await resolveShareToken(share.token))!;
      expect(await shareOnlinePaymentAvailable(await appDb(), link)).toBe(false);
      expect(await createSharePaymentLink(await appDb(), link, share.token)).toMatchObject({ ok: false, status: 409 });
    }
  });

  it("answers a gateway failure with a generic message", async () => {
    const inv = await sentInvoice("123.00");
    const share = await getOrCreateShareLink({ tenantId: world.tenant1.id, businessId: world.business1.id, documentId: inv.id, userId: world.ramesh.id });
    const link = (await resolveShareToken(share.token))!;
    failCreate = true;
    const res = await createSharePaymentLink(await appDb(), link, share.token);
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(res)).not.toMatch(/boom|rzp_|secret/i);
  });
});

// ── Webhook ───────────────────────────────────────────────────────────────────

describe("webhook: signature and routing", () => {
  const event = { event: "payment.failed", payload: { payment: { entity: { id: "pay_x", error_code: "BAD_REQUEST_ERROR" } } } };

  it("accepts a correctly signed event", async () => {
    const res = await deliver(token, event);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers every failure the same way: bad signature, no signature, wrong token, malformed token", async () => {
    const bodies = [];
    for (const res of [
      await deliver(token, event, { secret: "wrong-secret" }),
      await deliver(token, event, { signature: null }),
      await deliver(token, event, { signature: "deadbeef" }),
      await deliver(`${world.tenant1.id}.${"A".repeat(43)}`, event),
      await deliver("garbage", event),
      await deliver(`${randomUUID()}.${"A".repeat(43)}`, event),
    ]) {
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/signature|token|secret/i);
  });

  it("rejects an unsigned body that is not JSON only after the signature checks out", async () => {
    const raw = "not json";
    const sig = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    const res = await app.request(`/webhooks/razorpay/business/${token}`, { method: "POST", headers: { "x-razorpay-signature": sig }, body: raw });
    expect(res.status).toBe(400);
  });

  it("changes nothing for payment.failed", async () => {
    const before = await db().select().from(payments).where(eq(payments.businessId, world.business1.id));
    await deliver(token, event);
    expect(await db().select().from(payments).where(eq(payments.businessId, world.business1.id))).toHaveLength(before.length);
  });
});

describe("webhook: recording payments", () => {
  it("records a full payment once, marks the invoice paid, and ignores redeliveries", async () => {
    const inv = await sentInvoice("1180.00");
    const { url } = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [link] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    expect(url).toBe(link!.shortUrl);

    const ev = paidEvent({ linkId: link!.razorpayLinkId, paymentId: "pay_FULL1", amount: 118000, method: "upi" });
    expect((await deliver(token, ev)).status).toBe(200);
    expect((await deliver(token, ev)).status).toBe(200);
    expect((await deliver(token, { ...ev, event: "payment.captured" })).status).toBe(200);

    const rows = await db().select().from(payments).where(eq(payments.referenceNumber, "pay_FULL1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: "1180.00", mode: "upi", invoiceId: inv.id, partyId: world.party1.id, source: "razorpay", bankAccountId: null });
    const [after] = await db().select().from(invoices).where(eq(invoices.id, inv.id));
    expect(after).toMatchObject({ status: "paid", amountPaid: "1180.00" });
    const [alloc] = await db().select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, rows[0]!.id));
    expect(alloc).toMatchObject({ amount: "1180.00", invoiceId: inv.id });
    const [l] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.id, link!.id));
    expect(l!.status).toBe("paid");
    // No gateway account: no gateway expense or bank movement.
    expect(await db().select().from(expenses).where(eq(expenses.businessId, world.business1.id))).toHaveLength(0);

    const audit = await db().select().from(auditLog).where(and(eq(auditLog.businessId, world.business1.id), eq(auditLog.action, "razorpay.payment.recorded"), eq(auditLog.entityId, rows[0]!.id)));
    expect(audit).toHaveLength(1);
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toContain(WEBHOOK_SECRET);
    expect(auditText).not.toContain(KEY_SECRET);
    expect(auditText).not.toContain(token);
  });

  it("handles partial payments: records the part, then a new link asks for the rest", async () => {
    const inv = await sentInvoice("1000.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [first] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));

    await deliver(token, paidEvent({ linkId: first!.razorpayLinkId, paymentId: "pay_PART1", amount: 40000, event: "payment_link.partially_paid", linkStatus: "partially_paid" }));
    let [row] = await db().select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row).toMatchObject({ status: "partial", amountPaid: "400.00" });

    const again = await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    expect(again).toMatchObject({ created: true, amount: "600.00" });
    const links = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    const second = links.find((l) => l.status === "created")!;
    expect(second.amountPaise).toBe(60000);

    await deliver(token, paidEvent({ linkId: second.razorpayLinkId, paymentId: "pay_PART2", amount: 60000 }));
    [row] = await db().select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row).toMatchObject({ status: "paid", amountPaid: "1000.00" });
    expect(await db().select().from(payments).where(eq(payments.invoiceId, inv.id))).toHaveLength(2);
  });

  it("a payment still arriving on the old link after the balance moved is recorded, never lost", async () => {
    const inv = await sentInvoice("900.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [old] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    await db().update(invoices).set({ amountPaid: "100.00", status: "partial" }).where(eq(invoices.id, inv.id));
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id }); // old one is now cancelled
    await deliver(token, paidEvent({ linkId: old!.razorpayLinkId, paymentId: "pay_OLD1", amount: 90000 }));
    const [row] = await db().select().from(invoices).where(eq(invoices.id, inv.id));
    // Only the 800 balance reaches the invoice; the 100 over stays on the payment as an advance.
    expect(row).toMatchObject({ status: "paid", amountPaid: "900.00" });
    const [p] = await db().select().from(payments).where(eq(payments.referenceNumber, "pay_OLD1"));
    expect(p!.amount).toBe("900.00");
    const [alloc] = await db().select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, p!.id));
    expect(alloc!.amount).toBe("800.00");
  });

  it("maps card payments to credit / debit card modes", async () => {
    const inv = await sentInvoice("300.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [l] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    await deliver(token, paidEvent({ linkId: l!.razorpayLinkId, paymentId: "pay_CARD1", amount: 10000, method: "card", card: "debit", event: "payment_link.partially_paid", linkStatus: "partially_paid" }));
    const [p] = await db().select().from(payments).where(eq(payments.referenceNumber, "pay_CARD1"));
    expect(p!.mode).toBe("debit_card");
  });

  it("is idempotent under concurrent redelivery", async () => {
    const inv = await sentInvoice("640.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [l] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    const ev = paidEvent({ linkId: l!.razorpayLinkId, paymentId: "pay_RACE1", amount: 64000 });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => deliver(token, ev)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await db().select().from(payments).where(eq(payments.referenceNumber, "pay_RACE1"))).toHaveLength(1);
    expect(await db().select().from(razorpayPayments).where(eq(razorpayPayments.razorpayPaymentId, "pay_RACE1"))).toHaveLength(1);
    const [row] = await db().select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row!.amountPaid).toBe("640.00");
  });

  it("ignores payments that are not for one of this business's invoices", async () => {
    const before = (await db().select().from(payments).where(eq(payments.businessId, world.business1.id))).length;
    // Unknown link, no notes.
    await deliver(token, paidEvent({ linkId: "plink_Unknown", paymentId: "pay_UNK1", amount: 10000 }));
    // Notes naming ANOTHER business's invoice are not trusted.
    const { invoice } = await createInvoiceWithItems(db(), world.business2.id, world.party2.id, [{ itemId: world.item2.id, itemName: "X", quantity: "1", unitPrice: "100" }], { status: "sent" });
    await deliver(token, paidEvent({ linkId: "plink_Unknown2", paymentId: "pay_UNK2", amount: 10000, notes: { invoice_id: invoice.id, business_id: world.business2.id } }));
    // Notes naming this business but a random invoice id.
    await deliver(token, paidEvent({ linkId: "plink_Unknown3", paymentId: "pay_UNK3", amount: 10000, notes: { invoice_id: randomUUID(), business_id: world.business1.id } }));
    expect(await db().select().from(payments).where(eq(payments.businessId, world.business1.id))).toHaveLength(before);
    const [other] = await db().select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(other!.amountPaid).toBe("0.00");
  });

  it("does not record a payment that is not captured or not in rupees", async () => {
    const inv = await sentInvoice("100.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [l] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    const ev = paidEvent({ linkId: l!.razorpayLinkId, paymentId: "pay_AUTH1", amount: 10000 });
    (ev.payload.payment.entity as Record<string, unknown>).status = "authorized";
    await deliver(token, ev);
    const usd = paidEvent({ linkId: l!.razorpayLinkId, paymentId: "pay_USD1", amount: 10000 });
    (usd.payload.payment.entity as Record<string, unknown>).currency = "USD";
    await deliver(token, usd);
    expect(await db().select().from(payments).where(eq(payments.invoiceId, inv.id))).toHaveLength(0);
  });

  it("does not book a payment on an invoice cancelled meanwhile: it leaves an audit trail instead", async () => {
    const inv = await sentInvoice("100.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [l] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    await db().update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, inv.id));
    const res = await deliver(token, paidEvent({ linkId: l!.razorpayLinkId, paymentId: "pay_CAN1", amount: 10000 }));
    expect(res.status).toBe(200);
    expect(await db().select().from(payments).where(eq(payments.invoiceId, inv.id))).toHaveLength(0);
    const audit = await db().select().from(auditLog).where(and(eq(auditLog.entityId, inv.id), eq(auditLog.action, "razorpay.payment.unrecorded")));
    expect(audit).toHaveLength(1);
  });

  it("marks the link expired or cancelled on those events", async () => {
    const a = await sentInvoice("100.00");
    const b = await sentInvoice("100.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: a.id });
    await owner().onlinePayments.createInvoiceLink({ invoiceId: b.id });
    const [la] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, a.id));
    const [lb] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, b.id));
    await deliver(token, { event: "payment_link.expired", payload: { payment_link: { entity: { id: la!.razorpayLinkId } } } });
    await deliver(token, { event: "payment_link.cancelled", payload: { payment_link: { entity: { id: lb!.razorpayLinkId } } } });
    expect((await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.id, la!.id)))[0]!.status).toBe("expired");
    expect((await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.id, lb!.id)))[0]!.status).toBe("cancelled");
    // The active link is cleared, so asking again makes a fresh one.
    expect((await owner().onlinePayments.invoiceLink({ invoiceId: a.id })).link).toBeNull();
    expect(await owner().onlinePayments.createInvoiceLink({ invoiceId: a.id })).toMatchObject({ created: true });
  });
});

describe("webhook: gateway charges", () => {
  let gatewayId: string;
  let settlementId: string;

  beforeAll(async () => {
    const settlement = await createBankAccount(db(), world.business1.id, { accountName: "Settlement Current A/c", isDefault: false });
    const gateway = await createBankAccount(db(), world.business1.id, { accountName: "Razorpay", accountType: "payment_gateway", isDefault: false });
    settlementId = settlement.id;
    gatewayId = gateway.id;
    await db().insert(paymentGatewayConfigs).values({
      businessId: world.business1.id,
      bankAccountId: gatewayId,
      settlementAccountId: settlementId,
      chargeConfig: { upi: { type: "percentage", value: "0" }, credit_card: { type: "percentage", value: "2" }, default: { type: "percentage", value: "2" } },
    });
  });

  async function pay(price: string, ev: (linkId: string) => unknown) {
    const inv = await sentInvoice(price);
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    const [l] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id));
    await deliver(token, ev(l!.razorpayLinkId));
    const [p] = await db().select().from(payments).where(eq(payments.invoiceId, inv.id));
    return { inv, p: p! };
  }

  it("books the payment to the Razorpay gateway account with the fee Razorpay reported", async () => {
    const before = await db().select().from(expenses).where(eq(expenses.businessId, world.business1.id));
    const { p } = await pay("1000.00", (linkId) => paidEvent({ linkId, paymentId: "pay_GW1", amount: 100000, method: "card", card: "credit", fee: 2360 }));
    expect(p).toMatchObject({ bankAccountId: gatewayId, mode: "credit_card", amount: "1000.00" });
    const exp = (await db().select().from(expenses).where(eq(expenses.businessId, world.business1.id))).filter((e) => !before.some((b) => b.id === e.id));
    expect(exp).toHaveLength(1);
    // Razorpay's own fee (₹23.60 with GST), not the 2% configured on the account.
    expect(exp[0]).toMatchObject({ amount: "23.60", category: "Payment Gateway Charges", bankAccountId: gatewayId });
    const txns = await db().select().from(bankTransactions).where(eq(bankTransactions.paymentId, p.id));
    expect(txns.map((t) => t.referenceType).sort()).toEqual(["gateway_charge", "gateway_settlement", "gateway_settlement"]);
    const [settle] = await db().select().from(bankAccounts).where(eq(bankAccounts.id, settlementId));
    expect(parseFloat(settle!.currentBalance)).toBeGreaterThanOrEqual(976.4);
  });

  it("falls back to the account's configured rate when Razorpay sent no fee", async () => {
    const { p } = await pay("500.00", (linkId) => paidEvent({ linkId, paymentId: "pay_GW2", amount: 50000, method: "card", card: "credit", fee: null }));
    const txns = await db().select().from(bankTransactions).where(and(eq(bankTransactions.paymentId, p.id), eq(bankTransactions.referenceType, "gateway_charge")));
    expect(txns).toHaveLength(1);
    expect(txns[0]!.amount).toBe("10.00"); // 2% of 500
  });

  it("a free UPI payment records no charge", async () => {
    const { p } = await pay("250.00", (linkId) => paidEvent({ linkId, paymentId: "pay_GW3", amount: 25000, method: "upi", fee: 0 }));
    const txns = await db().select().from(bankTransactions).where(and(eq(bankTransactions.paymentId, p.id), eq(bankTransactions.referenceType, "gateway_charge")));
    expect(txns).toHaveLength(0);
  });
});

describe("read-only and suspended organisations", () => {
  async function org(name: string) {
    const u = await createUser({ email: `${name}@example.in`, name });
    const tenant = await createTenant({ name });
    await addMember(tenant.id, u.id, "owner");
    const business = await createBusiness(db(), u.id, { name });
    const party = await createParty(db(), business.id, { name: "Customer " + name });
    const c = createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: tenant.id, businessId: business.id });
    await c.onlinePayments.connect({ keyId: "rzp_test_ReadOnly12345", keySecret: "readonly_secret_value", webhookSecret: "readonly_whsec" });
    const { invoice } = await createInvoiceWithItems(db(), business.id, party.id, [{ itemName: "Service", quantity: "1", unitPrice: "800" }], { status: "sent" });
    const link = await c.onlinePayments.createInvoiceLink({ invoiceId: invoice.id });
    const [l] = await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, invoice.id));
    const tkn = (await c.onlinePayments.getSettings()).webhookUrl!.split("/business/")[1]!;
    return { tenant, u, business, c, invoice, link, l: l!, tkn };
  }

  it("read-only blocks making links and connecting, but still records a payment already made", async () => {
    const o = await org("readonly-org");
    await controlDb.update(tenants).set({ trialEndsAt: new Date(Date.now() - 86_400_000) }).where(eq(tenants.id, o.tenant.id));
    invalidateEntitlements(o.tenant.id);

    const second = await createInvoiceWithItems(db(), o.business.id, o.invoice.partyId, [{ itemName: "S2", quantity: "1", unitPrice: "100" }], { status: "sent" });
    await expect(o.c.onlinePayments.createInvoiceLink({ invoiceId: second.invoice.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(o.c.onlinePayments.connect({ keyId: "rzp_test_ReadOnly12345", keySecret: "readonly_secret_value" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Safe actions stay open: test the connection, read settings, remove the keys is exempt too.
    expect((await o.c.onlinePayments.testConnection()).ok).toBe(true);
    await expect(o.c.onlinePayments.getSettings()).resolves.toMatchObject({ connected: true });

    // The public Pay now makes no new link either.
    const share = await getOrCreateShareLink({ tenantId: o.tenant.id, businessId: o.business.id, documentId: second.invoice.id, userId: o.u.id });
    const resolved = (await resolveShareToken(share.token))!;
    expect(await shareOnlinePaymentAvailable(await appDb(), resolved)).toBe(false);
    expect(await createSharePaymentLink(await appDb(), resolved, share.token)).toMatchObject({ ok: false, status: 404 });

    // But the customer already paid: the webhook records it.
    const res = await app.request(`/webhooks/razorpay/business/${o.tkn}`, {
      method: "POST",
      headers: { "x-razorpay-signature": createHmac("sha256", "readonly_whsec").update(JSON.stringify(paidEvent({ linkId: o.l.razorpayLinkId, paymentId: "pay_RO1", amount: 80000 }))).digest("hex") },
      body: JSON.stringify(paidEvent({ linkId: o.l.razorpayLinkId, paymentId: "pay_RO1", amount: 80000 })),
    });
    expect(res.status).toBe(200);
    expect((await db().select().from(payments).where(eq(payments.referenceNumber, "pay_RO1")))).toHaveLength(1);
    expect((await db().select().from(invoices).where(eq(invoices.id, o.invoice.id)))[0]!.status).toBe("paid");
  });

  it("a suspended organisation's webhook token does not resolve", async () => {
    const o = await org("suspended-org");
    await controlDb.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, o.tenant.id));
    const body = JSON.stringify(paidEvent({ linkId: o.l.razorpayLinkId, paymentId: "pay_SUS1", amount: 80000 }));
    const res = await app.request(`/webhooks/razorpay/business/${o.tkn}`, {
      method: "POST",
      headers: { "x-razorpay-signature": createHmac("sha256", "readonly_whsec").update(body).digest("hex") },
      body,
    });
    expect(res.status).toBe(401);
    expect(await db().select().from(payments).where(eq(payments.referenceNumber, "pay_SUS1"))).toHaveLength(0);
  });
});

describe("disconnect", () => {
  it("removes the keys, cancels active links and stops the webhook", async () => {
    const inv = await sentInvoice("321.00");
    await owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id });
    calls = [];
    expect(await owner().onlinePayments.disconnect()).toEqual({ removed: true });
    expect(calls.some((c) => c.path.endsWith("/cancel"))).toBe(true);
    expect(await db().select().from(razorpayConnections).where(eq(razorpayConnections.businessId, world.business1.id))).toHaveLength(0);
    expect((await owner().onlinePayments.getSettings()).connected).toBe(false);
    expect((await owner().onlinePayments.invoiceLink({ invoiceId: inv.id })).canPay).toBe(false);
    expect((await db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, inv.id)))[0]!.status).toBe("cancelled");
    expect((await deliver(token, { event: "payment.failed" })).status).toBe(401);
    await expect(owner().onlinePayments.createInvoiceLink({ invoiceId: inv.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
