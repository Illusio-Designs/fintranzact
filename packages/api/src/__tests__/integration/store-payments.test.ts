/**
 * Online payments at store checkout, end to end against the real test
 * database with a MOCKED Razorpay (the HTTP layer is injected; the real
 * Razorpay is never called). The public routes are driven through server.ts's
 * own fetch handler, exactly as a shopper's browser would.
 *
 *   - settings: online payment needs the business's own Razorpay connection
 *     (with its webhook secret); a store keeps at least one way to pay; Cash on
 *     Delivery shows only when switched on;
 *   - checkout: the amount is worked out from the database, a client-sent
 *     amount is ignored, the payment link is on the business's own account and
 *     returns to STORE_URL only, an order survives a Razorpay failure;
 *   - order page + Pay again: no personal data or keys in the response, the same
 *     live link is reused, an expired link is replaced, paid/cancelled/COD
 *     orders refuse a link;
 *   - webhook: signature verified, order and invoice marked paid once per
 *     Razorpay payment id, gateway charge recorded, another business's notes
 *     ignored, failed payment emails the retry link once;
 *   - refunds: full and partial through Razorpay with a credit note,
 *     idempotent by key, capped at what was paid, owner/admin only, a failed
 *     Razorpay call books nothing, cancelling a paid order asks what to do with
 *     the money and puts the stock back after a full refund.
 */

import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bankAccounts,
  bankTransactions,
  expenses,
  invoiceItems,
  invoicePaymentLinks,
  invoices,
  items,
  paymentGatewayConfigs,
  payments,
  razorpayPayments,
  storeOrderRefunds,
  storeOrders,
} from "@fintranzact/db";
import { closeTestDb, getTenantTestDb, getTestClient, truncateAllTables } from "../helpers/test-db.js";
import { runAudit } from "../../lib/data-audit/runner.js";
import { createBankAccount, createItem, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";
import { setRazorpayFetch } from "../../lib/razorpay/client.js";
import { setStoreMailSender } from "../../lib/store-payments/emails.js";

// server.ts starts listening on import; capture its fetch handler instead.
const captured = vi.hoisted(() => ({ fetch: null as null | ((req: Request) => Promise<Response>) }));
vi.mock("@hono/node-server", () => ({
  serve: (opts: { fetch: (req: Request) => Promise<Response> }) => {
    captured.fetch = opts.fetch;
    return { close: () => undefined };
  },
}));

const KEY_ID = "rzp_test_StoreKey1234";
const KEY_SECRET = "store_key_secret_value";
const WEBHOOK_SECRET = "store_webhook_secret";
const SLUG = "pay-test-shop";
const STORE_URL = "https://store.fintranzact.example";

// ── Mock Razorpay ─────────────────────────────────────────────────────────────

interface Call { method: string; path: string; body: Record<string, any> | null; headers: Record<string, string>; auth: string }
let calls: Call[] = [];
let failLink = false;
let failRefund = false;
let linkSeq = 0;
let refundSeq = 0;

function installRazorpay() {
  setRazorpayFetch(async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = Buffer.from(String(headers.Authorization).replace("Basic ", ""), "base64").toString();
    calls.push({ method, path, body, headers, auth });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (method === "POST" && path === "/payment_links") {
      if (failLink) return json(500, { error: { description: "boom" } });
      linkSeq += 1;
      return json(200, { id: `plink_Store${linkSeq}`, short_url: `https://rzp.io/i/store${linkSeq}`, status: "created", amount: body!.amount });
    }
    if (method === "POST" && /^\/payment_links\/[^/]+\/cancel$/.test(path)) return json(200, { status: "cancelled" });
    if (method === "POST" && /^\/payments\/[^/]+\/refund$/.test(path)) {
      if (failRefund) return json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The refund amount is greater than the amount available for refund" } });
      refundSeq += 1;
      return json(200, { id: `rfnd_Store${refundSeq}`, payment_id: path.split("/")[2], amount: body!.amount, status: "processed" });
    }
    return json(404, { error: { description: "unexpected call" } });
  });
}

// ── World ─────────────────────────────────────────────────────────────────────

let world: TestWorld;
let itemId: string;
let webhookToken: string;
let gatewayId: string;
const owner = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const db = () => getTenantTestDb();
let phoneSeq = 0;
let paySeq = 0;

function http(path: string, init: RequestInit = {}): Promise<Response> {
  return captured.fetch!(new Request(`http://localhost${path}`, init));
}

async function placeOrder(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  phoneSeq += 1;
  const res = await http(`/store/${SLUG}/order`, {
    method: "POST",
    // A distinct client address per order: the public route allows 20 orders a minute per address.
    headers: { "content-type": "application/json", "cf-connecting-ip": `203.0.113.${phoneSeq % 250}`, ...headers },
    body: JSON.stringify({
      customerName: "Asha Verma",
      customerPhone: `98765${String(10000 + phoneSeq)}`,
      customerEmail: "asha@example.in",
      deliveryAddress: "12 Lake Road",
      items: [{ itemId, quantity: 1 }],
      turnstileToken: "test",
      paymentMethod: "online",
      ...body,
    }),
  });
  return { res, json: (await res.json()) as Record<string, any> };
}

async function deliver(event: unknown, opts: { secret?: string; signature?: string | null; token?: string } = {}) {
  const raw = JSON.stringify(event);
  const signature = opts.signature === undefined ? createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(raw).digest("hex") : opts.signature;
  return http(`/webhooks/razorpay/business/${opts.token ?? webhookToken}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-razorpay-signature": signature } : {}) },
    body: raw,
  });
}

function paidEvent(p: { linkId: string; paymentId: string; amount: number; method?: string; fee?: number | null; notes?: Record<string, string>; event?: string }) {
  return {
    event: p.event ?? "payment_link.paid",
    payload: {
      payment: { entity: { id: p.paymentId, amount: p.amount, currency: "INR", status: "captured", method: p.method ?? "upi", fee: p.fee ?? null, tax: null, notes: p.notes ?? [] } },
      payment_link: { entity: { id: p.linkId, status: "paid", notes: p.notes ?? [] } },
    },
  };
}

async function orderRow(id: string) {
  const [row] = await db().select().from(storeOrders).where(eq(storeOrders.id, id));
  return row!;
}
async function linkRows(invoiceId: string) {
  return db().select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, invoiceId));
}

/** An online order placed and paid in full (118.00: 100 + 18% GST) through the webhook. */
async function paidOrder(opts: { fee?: number | null } = {}) {
  const { json } = await placeOrder();
  const order = await orderRow(json.orderId);
  const [link] = await linkRows(order.invoiceId!);
  paySeq += 1;
  const paymentId = `pay_Store${paySeq}`;
  const res = await deliver(paidEvent({ linkId: link!.razorpayLinkId, paymentId, amount: 11800, fee: opts.fee ?? null }));
  expect(res.status).toBe(200);
  return { orderId: json.orderId as string, invoiceId: order.invoiceId!, paymentId, linkId: link!.razorpayLinkId };
}

const sentMails: Array<{ to: string; subject: string; text: string; html: string; fromName: string }> = [];

beforeAll(async () => {
  process.env.DISABLE_RATE_LIMIT = "1";
  process.env.CORS_ORIGINS ||= "http://localhost:5173";
  process.env.STORE_URL = STORE_URL;
  process.env.APP_URL = "https://app.fintranzact.example";
  const realOn = process.on.bind(process);
  const spy = vi.spyOn(process, "on").mockImplementation(((event: string, fn: (...a: unknown[]) => void) =>
    ["unhandledRejection", "uncaughtException", "SIGINT", "SIGTERM"].includes(event) ? process : realOn(event, fn)) as typeof process.on);
  await import("../../server.js");
  spy.mockRestore();
  if (!captured.fetch) throw new Error("server.ts did not hand its fetch handler to serve()");

  world = await createTestWorld();
  installRazorpay();
  setStoreMailSender(async (mail) => {
    sentMails.push(mail);
  });
  itemId = (await createItem(db(), world.business1.id, {
    name: "Store Widget", storeEnabled: true, storePrice: "100.00", salePrice: "100.00", taxPercent: "18.00", stockQuantity: "50.000",
  })).id;
  await db().update((await import("@fintranzact/db")).businesses).set({ storeEnabled: true, storeSlug: SLUG }).where(eq((await import("@fintranzact/db")).businesses.id, world.business1.id));
  // Razorpay gateway account so payments and refunds move a gateway balance.
  const settlement = await createBankAccount(db(), world.business1.id, { accountName: "Settlement A/c", isDefault: false });
  const gateway = await createBankAccount(db(), world.business1.id, { accountName: "Razorpay", accountType: "payment_gateway", isDefault: false });
  gatewayId = gateway.id;
  await db().insert(paymentGatewayConfigs).values({
    businessId: world.business1.id,
    bankAccountId: gatewayId,
    settlementAccountId: settlement.id,
    chargeConfig: { upi: { type: "percentage", value: "0" }, default: { type: "percentage", value: "2" } },
  });
}, 120_000);

afterAll(async () => {
  setRazorpayFetch(null);
  setStoreMailSender(null);
  await truncateAllTables();
  await closeTestDb();
});

// ── Settings ──────────────────────────────────────────────────────────────────

describe("store payment settings", () => {
  it("starts with Cash on Delivery on and online payment off, not connected", async () => {
    const s = await owner().store.getSettings();
    expect(s).toMatchObject({ storeOnlinePaymentsEnabled: false, storeCodEnabled: true });
    expect(s.payments).toEqual({ connected: false, hasWebhookSecret: false, mode: null, onlineActive: false });
  });

  it("online payment needs the business's own Razorpay connection, with its webhook secret", async () => {
    await expectCode(owner().store.updateSettings({ storeOnlinePaymentsEnabled: true }), "PRECONDITION_FAILED");
    await owner().onlinePayments.connect({ keyId: KEY_ID, keySecret: KEY_SECRET });
    await expectCode(owner().store.updateSettings({ storeOnlinePaymentsEnabled: true }), "PRECONDITION_FAILED");
    await owner().onlinePayments.connect({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
    webhookToken = (await owner().onlinePayments.getSettings()).webhookUrl!.split("/webhooks/razorpay/business/")[1]!;
    expect(await owner().store.updateSettings({ storeOnlinePaymentsEnabled: true })).toMatchObject({ storeOnlinePaymentsEnabled: true, storeCodEnabled: true });
    const s = await owner().store.getSettings();
    expect(s.payments).toEqual({ connected: true, hasWebhookSecret: true, mode: "test", onlineActive: true });
    expect(JSON.stringify(s)).not.toContain(KEY_SECRET);
    expect(JSON.stringify(s)).not.toContain(KEY_ID);
  });

  it("an enabled store keeps at least one way to pay; sellers cannot change it", async () => {
    await expectCode(owner().store.updateSettings({ storeOnlinePaymentsEnabled: false, storeCodEnabled: false }), "BAD_REQUEST");
    await expectCode(seller().store.updateSettings({ storeCodEnabled: false }), "FORBIDDEN");
    // Online on, COD off is fine.
    expect(await owner().store.updateSettings({ storeCodEnabled: false })).toMatchObject({ storeCodEnabled: false, storeOnlinePaymentsEnabled: true });
    await expectCode(owner().store.updateSettings({ storeOnlinePaymentsEnabled: false }), "BAD_REQUEST");
    await owner().store.updateSettings({ storeCodEnabled: true });
  });
});

// ── Catalog: which methods checkout offers ────────────────────────────────────

describe("catalog payment options", () => {
  const options = async () => (await (await http(`/store/${SLUG}/catalog.json`)).json() as any).business.payments;

  it("offers online and Cash on Delivery as configured, and nothing secret", async () => {
    expect(await options()).toEqual({ online: true, cod: true });
    await owner().store.updateSettings({ storeCodEnabled: false });
    expect(await options()).toEqual({ online: true, cod: false });
    await owner().store.updateSettings({ storeCodEnabled: true, storeOnlinePaymentsEnabled: false });
    expect(await options()).toEqual({ online: false, cod: true });
    await owner().store.updateSettings({ storeOnlinePaymentsEnabled: true });
    const text = await (await http(`/store/${SLUG}/catalog.json`)).text();
    for (const secret of [KEY_ID, KEY_SECRET, WEBHOOK_SECRET, webhookToken]) expect(text).not.toContain(secret);
  });
});

// ── Checkout ──────────────────────────────────────────────────────────────────

describe("checkout", () => {
  it("Cash on Delivery orders are created as before: unpaid, no payment link", async () => {
    calls = [];
    const { res, json } = await placeOrder({ paymentMethod: "cod" });
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ paymentMethod: "cod", paymentStatus: "unpaid", paymentUrl: null, totalAmount: "118.00", subtotal: "100.00", taxAmount: "18.00" });
    expect(calls).toHaveLength(0);
    expect(await orderRow(json.orderId)).toMatchObject({ paymentMethod: "cod", paymentStatus: "unpaid", status: "pending" });
  });

  it("an order without a paymentMethod is Cash on Delivery (older storefronts keep working)", async () => {
    const { res, json } = await placeOrder({ paymentMethod: undefined });
    expect(res.status).toBe(201);
    expect(json.paymentMethod).toBe("cod");
  });

  it("an online order makes a payment link for the amount worked out from the database, on the business's own keys", async () => {
    calls = [];
    // A client cannot name the amount, the business or the callback.
    const { res, json } = await placeOrder({ amount: 1, totalAmount: "1.00", businessId: world.business2.id, callbackUrl: "https://evil.example" }, { origin: "https://evil.example", host: "evil.example" });
    expect(res.status).toBe(403);
    expect(json.error).toBe("Origin not allowed");
    const ok = await placeOrder({ amount: 1, totalAmount: "1.00", businessId: world.business2.id, callbackUrl: "https://evil.example" });
    expect(ok.res.status).toBe(201);
    expect(ok.json).toMatchObject({ paymentMethod: "online", paymentStatus: "unpaid", totalAmount: "118.00", subtotal: "100.00", taxAmount: "18.00" });
    expect(ok.json.paymentUrl).toMatch(/^https:\/\/rzp\.io\/i\/store\d+$/);

    const create = calls.filter((c) => c.path === "/payment_links");
    expect(create).toHaveLength(1);
    const body = create[0]!.body!;
    expect(body.amount).toBe(11800);
    expect(body.accept_partial).toBe(false);
    expect(body.notify).toEqual({ sms: false, email: false });
    expect(body.callback_url).toBe(`${STORE_URL}/${SLUG}/order/${ok.json.orderId}`);
    expect(body.notes).toMatchObject({ business_id: world.business1.id, store_order_id: ok.json.orderId });
    expect(body.customer).toMatchObject({ name: "Asha Verma", email: "asha@example.in" });
    // The business's OWN keys, never the platform's.
    expect(create[0]!.auth).toBe(`${KEY_ID}:${KEY_SECRET}`);
    expect(JSON.stringify(ok.json)).not.toContain(KEY_SECRET);

    const order = await orderRow(ok.json.orderId);
    const [inv] = await db().select().from(invoices).where(eq(invoices.id, order.invoiceId!));
    expect(inv).toMatchObject({ totalAmount: "118.00", amountPaid: "0.00", status: "unfulfilled" });
  });

  it("refuses a method the store does not offer, and an unknown method", async () => {
    await owner().store.updateSettings({ storeCodEnabled: false });
    const cod = await placeOrder({ paymentMethod: "cod" });
    expect(cod.res.status).toBe(400);
    expect(cod.json.error).toMatch(/Cash on Delivery is not available/);
    const none = await placeOrder({ paymentMethod: undefined });
    expect(none.res.status).toBe(201); // default falls to online when COD is off
    await owner().store.updateSettings({ storeCodEnabled: true, storeOnlinePaymentsEnabled: false });
    const online = await placeOrder({ paymentMethod: "online" });
    expect(online.res.status).toBe(400);
    expect(online.json.error).toMatch(/Online payment is not available/);
    expect((await placeOrder({ paymentMethod: "crypto" })).res.status).toBe(400);
    await owner().store.updateSettings({ storeOnlinePaymentsEnabled: true });
  });

  it("keeps the order when Razorpay fails, with a polite message and a way to pay again", async () => {
    failLink = true;
    const { res, json } = await placeOrder();
    failLink = false;
    expect(res.status).toBe(201);
    expect(json.paymentUrl).toBeNull();
    expect(json.paymentError).toMatch(/unavailable/i);
    expect(await orderRow(json.orderId)).toMatchObject({ paymentStatus: "unpaid", paymentMethod: "online" });
    const again = await http(`/store/${SLUG}/order/${json.orderId}/pay`, { method: "POST" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).url).toMatch(/^https:\/\/rzp\.io/);
  });

  it("sends the shopper an order confirmation email, escaped", async () => {
    sentMails.length = 0;
    await placeOrder({ customerName: "<b>Eve</b> & Co" });
    await vi.waitFor(() => expect(sentMails.some((m) => m.subject.startsWith("Order "))).toBe(true));
    const mail = sentMails.find((m) => m.subject.startsWith("Order "))!;
    expect(mail.to).toBe("asha@example.in");
    expect(mail.fromName).toBe("Acme Trading Co");
    expect(mail.html).not.toContain("<b>Eve");
    expect(mail.html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(`${mail.text}${mail.html}`).not.toContain(KEY_SECRET);
    expect(mail.text).toContain(`${STORE_URL}/${SLUG}/order/`);
  });
});

// ── Order page and Pay again ──────────────────────────────────────────────────

describe("order page and pay again", () => {
  it("shows status, totals and lines, with no personal data and no keys", async () => {
    const { json } = await placeOrder();
    const res = await http(`/store/${SLUG}/order/${json.orderId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = (await res.json()) as any;
    expect(view).toMatchObject({
      orderId: json.orderId, status: "pending", paymentMethod: "online", paymentStatus: "unpaid",
      subtotal: "100.00", taxAmount: "18.00", totalAmount: "118.00", balance: "118.00", canPayOnline: true,
    });
    expect(view.lines).toEqual([{ name: "Store Widget", quantity: "1.000", total: "118.00" }]);
    const text = JSON.stringify(view);
    for (const secret of ["98765", "asha@example.in", "Lake Road", KEY_ID, KEY_SECRET, WEBHOOK_SECRET, "plink_"]) expect(text).not.toContain(secret);
  });

  it("answers 404 for an unknown order, another store's order, a bad id and an unknown store", async () => {
    const { json } = await placeOrder();
    expect((await http(`/store/${SLUG}/order/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await http(`/store/${SLUG}/order/not-a-uuid`)).status).toBe(404);
    expect((await http(`/store/no-such-shop/order/${json.orderId}`)).status).toBe(404);
    expect((await http(`/store/no-such-shop/order/${json.orderId}/pay`, { method: "POST" })).status).toBe(404);
    // An order of another business is not found under this store's slug.
    const { businesses } = await import("@fintranzact/db");
    await db().update(businesses).set({ storeEnabled: true, storeSlug: "other-shop" }).where(eq(businesses.id, world.business2.id));
    expect((await http(`/store/other-shop/order/${json.orderId}`)).status).toBe(404);
    expect((await http(`/store/other-shop/order/${json.orderId}/pay`, { method: "POST" })).status).toBe(404);
  });

  it("Pay again returns the same live link, and a fresh one once the old link expired", async () => {
    const { json } = await placeOrder();
    const order = await orderRow(json.orderId);
    const pay = async () => (await (await http(`/store/${SLUG}/order/${json.orderId}/pay`, { method: "POST" })).json()) as any;
    calls = [];
    const first = await pay();
    expect(first.url).toBe(json.paymentUrl);
    expect(calls.filter((c) => c.path === "/payment_links")).toHaveLength(0);

    // The link expires on Razorpay: the order stays unpaid and asks for a new link.
    const [link] = await linkRows(order.invoiceId!);
    expect((await deliver({ event: "payment_link.expired", payload: { payment_link: { entity: { id: link!.razorpayLinkId, status: "expired", notes: [] } } } })).status).toBe(200);
    expect(await orderRow(json.orderId)).toMatchObject({ paymentStatus: "unpaid" });
    const second = await pay();
    expect(second.url).not.toBe(json.paymentUrl);
    const rows = await linkRows(order.invoiceId!);
    expect(rows.map((r) => r.status).sort()).toEqual(["created", "expired"]);
    // The new link has the next reference id and the same amount.
    const body = calls.filter((c) => c.path === "/payment_links").at(-1)!.body!;
    expect(body.amount).toBe(11800);
    expect(body.reference_id).toMatch(/-2$/);
  });

  it("refuses a link for a paid, a cancelled and a Cash on Delivery order", async () => {
    const paid = await paidOrder();
    expect((await http(`/store/${SLUG}/order/${paid.orderId}/pay`, { method: "POST" })).status).toBe(409);
    const view = (await (await http(`/store/${SLUG}/order/${paid.orderId}`)).json()) as any;
    expect(view).toMatchObject({ paymentStatus: "paid", canPayOnline: false, balance: null });

    const cod = await placeOrder({ paymentMethod: "cod" });
    const codPay = await http(`/store/${SLUG}/order/${cod.json.orderId}/pay`, { method: "POST" });
    expect(codPay.status).toBe(409);

    const { json } = await placeOrder();
    await owner().store.cancelOrder({ orderId: json.orderId });
    const cancelled = await http(`/store/${SLUG}/order/${json.orderId}/pay`, { method: "POST" });
    expect(cancelled.status).toBe(409);
    expect(((await cancelled.json()) as any).error).toMatch(/cancelled/);
  });

  it("cancelling an unpaid online order stops its payment link on Razorpay", async () => {
    const { json } = await placeOrder();
    const order = await orderRow(json.orderId);
    calls = [];
    await owner().store.cancelOrder({ orderId: json.orderId });
    expect(calls.some((c) => /\/payment_links\/plink_Store\d+\/cancel$/.test(c.path))).toBe(true);
    expect((await linkRows(order.invoiceId!))[0]!.status).toBe("cancelled");
  });
});

// ── Webhook ───────────────────────────────────────────────────────────────────

describe("webhook marks the order and its invoice paid", () => {
  it("records the payment once, marks the order paid and the invoice paid, with the gateway charge", async () => {
    sentMails.length = 0;
    const { json } = await placeOrder();
    const order = await orderRow(json.orderId);
    const [link] = await linkRows(order.invoiceId!);
    const ev = paidEvent({ linkId: link!.razorpayLinkId, paymentId: "pay_StoreFee1", amount: 11800, method: "upi", fee: 236 });
    expect((await deliver(ev)).status).toBe(200);
    // Razorpay redelivers: nothing is recorded twice.
    expect((await deliver(ev)).status).toBe(200);

    expect(await orderRow(json.orderId)).toMatchObject({ paymentMethod: "online", paymentStatus: "paid", status: "pending" });
    expect((await orderRow(json.orderId)).paidAt).toBeInstanceOf(Date);
    const [inv] = await db().select().from(invoices).where(eq(invoices.id, order.invoiceId!));
    expect(inv).toMatchObject({ amountPaid: "118.00", status: "paid" });
    const pays = await db().select().from(payments).where(eq(payments.invoiceId, order.invoiceId!));
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount: "118.00", mode: "upi", referenceNumber: "pay_StoreFee1", source: "razorpay", bankAccountId: gatewayId });
    expect(await db().select().from(razorpayPayments).where(eq(razorpayPayments.razorpayPaymentId, "pay_StoreFee1"))).toHaveLength(1);
    // Razorpay's own fee became a gateway-charge expense.
    const charges = (await db().select().from(expenses).where(eq(expenses.businessId, world.business1.id))).filter((e) => e.amount === "2.36");
    expect(charges.length).toBeGreaterThanOrEqual(1);
    expect((await linkRows(order.invoiceId!))[0]!.status).toBe("paid");

    // One "payment received" email, none for the redelivery.
    await vi.waitFor(() => expect(sentMails.filter((m) => m.subject.startsWith("Payment received"))).toHaveLength(1));
    expect(sentMails.filter((m) => m.subject.startsWith("Payment received"))).toHaveLength(1);

    // Confirming the paid order keeps its invoice paid (it must not drop back to "sent").
    await owner().store.confirmOrder({ orderId: json.orderId });
    expect((await db().select().from(invoices).where(eq(invoices.id, order.invoiceId!)))[0]!.status).toBe("paid");
  });

  it("verifies the signature with the business's own secret and answers a generic 401 otherwise", async () => {
    const { json } = await placeOrder();
    const order = await orderRow(json.orderId);
    const [link] = await linkRows(order.invoiceId!);
    const ev = paidEvent({ linkId: link!.razorpayLinkId, paymentId: "pay_StoreBad1", amount: 11800 });
    for (const res of [
      await deliver(ev, { secret: "someone-elses-secret" }),
      await deliver(ev, { signature: null }),
      await deliver(ev, { signature: "00".repeat(32) }),
      await deliver(ev, { token: `${world.tenant1.id}.${"A".repeat(43)}` }),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid request" });
    }
    expect(await orderRow(json.orderId)).toMatchObject({ paymentStatus: "unpaid" });
    expect(await db().select().from(payments).where(eq(payments.referenceNumber, "pay_StoreBad1"))).toHaveLength(0);
  });

  it("ignores a payment whose notes name another business", async () => {
    const { json } = await placeOrder();
    const order = await orderRow(json.orderId);
    const ev = paidEvent({
      linkId: "plink_Unknown", paymentId: "pay_StoreOther1", amount: 11800,
      notes: { business_id: world.business2.id, invoice_id: order.invoiceId!, store_order_id: json.orderId },
    });
    expect((await deliver(ev)).status).toBe(200);
    expect(await orderRow(json.orderId)).toMatchObject({ paymentStatus: "unpaid" });
    expect(await db().select().from(razorpayPayments).where(eq(razorpayPayments.razorpayPaymentId, "pay_StoreOther1"))).toHaveLength(0);
  });

  it("a failed or abandoned payment leaves the order unpaid and emails the retry link once", async () => {
    sentMails.length = 0;
    const { json } = await placeOrder();
    const order = await orderRow(json.orderId);
    const [link] = await linkRows(order.invoiceId!);
    const failed = {
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_StoreFailed1", amount: 11800, currency: "INR", status: "failed", method: "card", error_code: "BAD_REQUEST_ERROR", notes: { business_id: world.business1.id, invoice_id: order.invoiceId!, store_order_id: json.orderId } } } },
    };
    expect((await deliver(failed)).status).toBe(200);
    expect((await deliver(failed)).status).toBe(200);
    await vi.waitFor(() => expect(sentMails.filter((m) => m.subject.startsWith("Payment not completed"))).toHaveLength(1));
    const mail = sentMails.find((m) => m.subject.startsWith("Payment not completed"))!;
    expect(mail.text).toContain(`${STORE_URL}/${SLUG}/order/${json.orderId}`);
    expect(mail.text).toMatch(/Pay again/);
    expect(await orderRow(json.orderId)).toMatchObject({ paymentStatus: "unpaid" });
    expect((await db().select().from(invoices).where(eq(invoices.id, order.invoiceId!)))[0]!.amountPaid).toBe("0.00");
    expect(await db().select().from(payments).where(eq(payments.invoiceId, order.invoiceId!))).toHaveLength(0);
    // The same link stays usable.
    expect((await linkRows(order.invoiceId!))[0]).toMatchObject({ id: link!.id, status: "created" });
  });
});

// ── Refunds ───────────────────────────────────────────────────────────────────

describe("refunds", () => {
  it("only owners and admins can refund; unpaid and Cash on Delivery orders have nothing to refund", async () => {
    const paid = await paidOrder();
    await expectCode(seller().store.refundOrder({ orderId: paid.orderId, idempotencyKey: "key-seller-1" }), "FORBIDDEN");
    const cod = await placeOrder({ paymentMethod: "cod" });
    await expectCode(owner().store.refundOrder({ orderId: cod.json.orderId, idempotencyKey: "key-cod-0001" }), "PRECONDITION_FAILED");
    const unpaid = await placeOrder();
    await expectCode(owner().store.refundOrder({ orderId: unpaid.json.orderId, idempotencyKey: "key-unpaid-1" }), "PRECONDITION_FAILED");
    await expectCode(owner().store.refundOrder({ orderId: "00000000-0000-4000-8000-000000000000", idempotencyKey: "key-unknown-1" }), "NOT_FOUND");
  });

  it("refunds in part through Razorpay with a credit note, then the rest, never more than was paid", async () => {
    sentMails.length = 0;
    const paid = await paidOrder();
    const [before] = await db().select().from(bankAccounts).where(eq(bankAccounts.id, gatewayId));
    calls = [];

    const first = await owner().store.refundOrder({ orderId: paid.orderId, amount: "50.00", reason: "Item arrived scratched", idempotencyKey: "key-partial-1" });
    expect(first).toMatchObject({ amount: "50.00", paymentStatus: "partially_refunded", replayed: false });
    const refundCalls = calls.filter((c) => c.path.endsWith("/refund"));
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]!.path).toBe(`/payments/${paid.paymentId}/refund`);
    expect(refundCalls[0]!.body).toMatchObject({ amount: 5000, speed: "normal" });
    expect(refundCalls[0]!.headers["X-Refund-Idempotency"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(refundCalls[0]!.auth).toBe(`${KEY_ID}:${KEY_SECRET}`);

    // The credit note: against the order's invoice, for exactly the refund, GST reversed at 18%.
    // The refunded 50.00 came off what is paid on the invoice and off the payment's allocation.
    expect((await db().select().from(invoices).where(eq(invoices.id, paid.invoiceId)))[0]).toMatchObject({ amountPaid: "68.00", status: "paid" });
    const [note] = await db().select().from(invoices).where(eq(invoices.id, first.creditNoteId));
    expect(note).toMatchObject({ documentType: "credit_note", type: "sale", referenceDocumentId: paid.invoiceId, totalAmount: "50.00", status: "paid", amountPaid: "50.00" });
    expect(parseFloat(note!.taxAmount)).toBeCloseTo(7.62, 2);
    expect(await orderRow(paid.orderId)).toMatchObject({ paymentStatus: "partially_refunded", refundedAmount: "50.00", status: "pending" });
    const [after] = await db().select().from(bankAccounts).where(eq(bankAccounts.id, gatewayId));
    expect(parseFloat(before!.currentBalance) - parseFloat(after!.currentBalance)).toBeCloseTo(50, 2);
    const txns = await db().select().from(bankTransactions).where(and(eq(bankTransactions.referenceType, "refund"), eq(bankTransactions.referenceId, first.creditNoteId)));
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: "withdrawal", amount: "50.00", bankAccountId: gatewayId });
    const audit = await waitForAudit(world.business1.id, "storeOrder.refund", paid.orderId);
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit)).not.toContain(KEY_SECRET);
    await vi.waitFor(() => expect(sentMails.some((m) => m.subject.startsWith("Refund issued"))).toBe(true));

    // More than what is left is refused, before anything reaches Razorpay.
    calls = [];
    await expectCode(owner().store.refundOrder({ orderId: paid.orderId, amount: "70.00", idempotencyKey: "key-partial-2" }), "BAD_REQUEST");
    expect(calls).toHaveLength(0);

    // The rest (default amount): 68.00.
    const rest = await owner().store.refundOrder({ orderId: paid.orderId, idempotencyKey: "key-partial-3" });
    expect(rest).toMatchObject({ amount: "68.00", paymentStatus: "refunded" });
    expect(await orderRow(paid.orderId)).toMatchObject({ paymentStatus: "refunded", refundedAmount: "118.00" });
    await expectCode(owner().store.refundOrder({ orderId: paid.orderId, idempotencyKey: "key-partial-4" }), "BAD_REQUEST");
    // Invoice: the notes cover it, so it reads as adjusted.
    expect((await db().select().from(invoices).where(eq(invoices.id, paid.invoiceId)))[0]!.status).toBe("adjusted");

    const detail = await owner().store.getOrder({ id: paid.orderId });
    expect(detail).toMatchObject({ paymentStatus: "refunded", refundable: "0.00" });
    expect(detail.refunds.map((r) => r.amount)).toEqual(["50.00", "68.00"]);
    expect(detail.razorpayPayments).toMatchObject([{ razorpayPaymentId: paid.paymentId, amount: "118.00" }]);
  });

  it("is idempotent: the same key answers with the first result and refunds once", async () => {
    const paid = await paidOrder();
    calls = [];
    const input = { orderId: paid.orderId, amount: "30.00", idempotencyKey: "key-idem-0001" };
    const [a, b] = await Promise.allSettled([owner().store.refundOrder(input), owner().store.refundOrder(input)]);
    const c = await owner().store.refundOrder(input);
    expect(c).toMatchObject({ amount: "30.00", replayed: true });
    const okResults = [a, b].filter((r) => r.status === "fulfilled");
    expect(okResults.length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((x) => x.path.endsWith("/refund"))).toHaveLength(1);
    expect(await db().select().from(storeOrderRefunds).where(eq(storeOrderRefunds.storeOrderId, paid.orderId))).toHaveLength(1);
    expect(await orderRow(paid.orderId)).toMatchObject({ refundedAmount: "30.00" });
    expect((await db().select().from(invoices).where(and(eq(invoices.referenceDocumentId, paid.invoiceId), eq(invoices.documentType, "credit_note"))))).toHaveLength(1);
    // The same key for a different amount or another order is refused.
    await expectCode(owner().store.refundOrder({ ...input, amount: "31.00" }), "CONFLICT");
    const other = await paidOrder();
    await expectCode(owner().store.refundOrder({ orderId: other.orderId, idempotencyKey: input.idempotencyKey }), "CONFLICT");
  });

  it("books nothing when Razorpay refuses, and the same key can be retried", async () => {
    const paid = await paidOrder();
    failRefund = true;
    await expectCode(owner().store.refundOrder({ orderId: paid.orderId, amount: "20.00", idempotencyKey: "key-fail-0001" }), "BAD_GATEWAY");
    failRefund = false;
    expect(await orderRow(paid.orderId)).toMatchObject({ paymentStatus: "paid", refundedAmount: "0.00" });
    expect(await db().select().from(invoices).where(and(eq(invoices.referenceDocumentId, paid.invoiceId), eq(invoices.documentType, "credit_note")))).toHaveLength(0);
    expect((await db().select().from(storeOrderRefunds).where(eq(storeOrderRefunds.storeOrderId, paid.orderId)))[0]!.status).toBe("failed");
    const retry = await owner().store.refundOrder({ orderId: paid.orderId, amount: "20.00", idempotencyKey: "key-fail-0001" });
    expect(retry).toMatchObject({ amount: "20.00", paymentStatus: "partially_refunded" });
  });

  it("validates the amount and the key", async () => {
    const paid = await paidOrder();
    await expectCode(owner().store.refundOrder({ orderId: paid.orderId, amount: "0", idempotencyKey: "key-valid-001" }), "BAD_REQUEST");
    await expectCode(owner().store.refundOrder({ orderId: paid.orderId, amount: "0.50", idempotencyKey: "key-valid-002" }), "BAD_REQUEST");
    await expectCode(owner().store.refundOrder({ orderId: paid.orderId, amount: "abc", idempotencyKey: "key-valid-003" }), "BAD_REQUEST");
    await expectCode(owner().store.refundOrder({ orderId: paid.orderId, idempotencyKey: "short" }), "BAD_REQUEST");
  });
});

// ── Cancelling a paid order ───────────────────────────────────────────────────

describe("cancelling an order paid online", () => {
  async function stock() {
    const [row] = await db().select({ q: items.stockQuantity }).from(items).where(eq(items.id, itemId));
    return Number(row!.q);
  }

  it("asks what to do with the money first", async () => {
    const paid = await paidOrder();
    await expectCode(owner().store.cancelOrder({ orderId: paid.orderId }), "PRECONDITION_FAILED");
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "pending" });
  });

  it("refunds in full, books a credit note, puts the stock back and cancels the order", async () => {
    const paid = await paidOrder();
    const stockWhilePaid = await stock();
    calls = [];
    await owner().store.cancelOrder({ orderId: paid.orderId, refund: "full", reason: "Out of stock" });
    expect(calls.filter((c) => c.path.endsWith("/refund"))).toHaveLength(1);
    expect(calls.find((c) => c.path.endsWith("/refund"))!.body).toMatchObject({ amount: 11800 });
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "refunded", refundedAmount: "118.00", cancellationReason: "Out of stock" });
    const [inv] = await db().select().from(invoices).where(eq(invoices.id, paid.invoiceId));
    expect(inv!.status).toBe("adjusted"); // the credit note reversed the sale; the invoice itself is not cancelled
    const [note] = await db().select().from(invoices).where(and(eq(invoices.referenceDocumentId, paid.invoiceId), eq(invoices.documentType, "credit_note")));
    expect(note).toMatchObject({ totalAmount: "118.00", status: "paid" });
    expect(await stock()).toBe(stockWhilePaid + 1);
    // Cancelling again is refused and refunds nothing more.
    calls = [];
    await expectCode(owner().store.cancelOrder({ orderId: paid.orderId, refund: "full" }), "BAD_REQUEST");
    expect(calls).toHaveLength(0);
  });

  it("an order already refunded in full is cancelled without cancelling its invoice (the credit note already reversed the sale)", async () => {
    const paid = await paidOrder();
    const before = await stock();
    await owner().store.refundOrder({ orderId: paid.orderId, idempotencyKey: "key-refund-then-cancel" });
    expect(await stock()).toBe(before); // a plain refund moves no stock
    await owner().store.cancelOrder({ orderId: paid.orderId });
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "refunded" });
    expect((await db().select().from(invoices).where(eq(invoices.id, paid.invoiceId)))[0]!.status).toBe("adjusted");
    expect(await stock()).toBe(before + 1);
    // Cancelling and the stock coming back happen once, however often it is looked at.
    expect((await db().select().from(invoices).where(and(eq(invoices.referenceDocumentId, paid.invoiceId), eq(invoices.documentType, "credit_note"))))).toHaveLength(1);
  });

  it("a partly refunded order must be cancelled with a refund of the rest", async () => {
    const paid = await paidOrder();
    await owner().store.refundOrder({ orderId: paid.orderId, amount: "18.00", idempotencyKey: "key-part-then-cancel" });
    await expectCode(owner().store.cancelOrder({ orderId: paid.orderId }), "PRECONDITION_FAILED");
    await expectCode(owner().store.cancelOrder({ orderId: paid.orderId, refund: "none" }), "BAD_REQUEST");
    await owner().store.cancelOrder({ orderId: paid.orderId, refund: "full" });
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "refunded", refundedAmount: "118.00" });
    const notes = await db().select().from(invoices).where(and(eq(invoices.referenceDocumentId, paid.invoiceId), eq(invoices.documentType, "credit_note")));
    expect(notes.map((n) => n.totalAmount).sort()).toEqual(["100.00", "18.00"]);
  });

  it("only owners and admins can cancel with a refund", async () => {
    const paid = await paidOrder();
    await expectCode(seller().store.cancelOrder({ orderId: paid.orderId, refund: "full" }), "FORBIDDEN");
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "pending", paymentStatus: "paid" });
  });

  it("can cancel and keep the payment (refund by hand): the invoice is cancelled as before", async () => {
    const paid = await paidOrder();
    calls = [];
    await owner().store.cancelOrder({ orderId: paid.orderId, refund: "none" });
    expect(calls.filter((c) => c.path.endsWith("/refund"))).toHaveLength(0);
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "paid" });
    expect((await db().select().from(invoices).where(eq(invoices.id, paid.invoiceId)))[0]!.status).toBe("cancelled");
  });

  it("a gateway failure leaves the order uncancelled and unrefunded", async () => {
    const paid = await paidOrder();
    failRefund = true;
    await expectCode(owner().store.cancelOrder({ orderId: paid.orderId, refund: "full" }), "BAD_GATEWAY");
    failRefund = false;
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "pending", paymentStatus: "paid", refundedAmount: "0.00" });
    // Trying again succeeds on the same cancellation key.
    await owner().store.cancelOrder({ orderId: paid.orderId, refund: "full" });
    expect(await orderRow(paid.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "refunded" });
  });
});

// ── Public route safety ───────────────────────────────────────────────────────

describe("no platform keys, no secrets in logs or responses", () => {
  it("never uses the platform's Razorpay account for shopper money", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_PLATFORMKEY99";
    process.env.RAZORPAY_KEY_SECRET = "platform_secret_value";
    calls = [];
    const { json } = await placeOrder();
    expect(json.paymentUrl).toBeTruthy();
    for (const c of calls) {
      expect(c.auth).not.toContain("PLATFORMKEY99");
      expect(c.auth).not.toContain("platform_secret_value");
    }
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it("a request header cannot decide where Razorpay sends the shopper", async () => {
    calls = [];
    await placeOrder({}, { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
    const body = calls.find((c) => c.path === "/payment_links")!.body!;
    expect(String(body.callback_url).startsWith(`${STORE_URL}/`)).toBe(true);
  });
});

// ── The books stay consistent ─────────────────────────────────────────────────

// ── Delivery charge ───────────────────────────────────────────────────────────

describe("delivery charge", () => {
  let fiveId: string;
  const setDelivery = (fee: string, freeAbove: string | null = null) =>
    owner().store.updateSettings({ storeDeliveryFee: fee, storeFreeDeliveryAbove: freeAbove });
  // 100 at 18% GST + 49 delivery taxed at the principal rate (18%, intra-state): 100 + 18 + 49 + 8.82 = 175.82.
  const WITH_FEE = { total: "175.82", tax: "26.82", fee: "49.00" };

  async function payInFull(orderId: string, amountPaise: number) {
    const order = await orderRow(orderId);
    const [link] = await linkRows(order.invoiceId!);
    paySeq += 1;
    const paymentId = `pay_Store${paySeq}`;
    expect((await deliver(paidEvent({ linkId: link!.razorpayLinkId, paymentId, amount: amountPaise }))).status).toBe(200);
    return { orderId, invoiceId: order.invoiceId!, paymentId };
  }

  beforeAll(async () => {
    fiveId = (await createItem(db(), world.business1.id, {
      name: "Store Gadget", storeEnabled: true, storePrice: "200.00", salePrice: "200.00", taxPercent: "5.00", stockQuantity: "50.000",
    })).id;
  });
  afterAll(async () => {
    await setDelivery("0", null);
  });

  it("is a store setting: fee, free-delivery threshold and the existing note, validated, admin only, shown in the catalog", async () => {
    expect(await owner().store.getSettings()).toMatchObject({ storeDeliveryFee: "0.00", storeFreeDeliveryAbove: null });
    expect(await owner().store.updateSettings({ storeDeliveryFee: "49", storeFreeDeliveryAbove: "500", storeDeliveryNote: "Delivery in 3-5 working days" }))
      .toMatchObject({ storeDeliveryFee: "49.00", storeFreeDeliveryAbove: "500.00", storeDeliveryNote: "Delivery in 3-5 working days" });
    for (const bad of ["-1", "10000.01", "1e3", "12.345", "abc", ""]) {
      await expect(owner().store.updateSettings({ storeDeliveryFee: bad })).rejects.toThrow();
    }
    await expect(owner().store.updateSettings({ storeFreeDeliveryAbove: "10000000.01" })).rejects.toThrow();
    await expectCode(seller().store.updateSettings({ storeDeliveryFee: "1" }), "FORBIDDEN");
    const cat = (await (await http(`/store/${SLUG}/catalog.json`)).json()) as any;
    expect(cat.business).toMatchObject({ deliveryFee: "49.00", freeDeliveryAbove: "500.00", deliveryNote: "Delivery in 3-5 working days" });
    // Clearing the threshold with null; an update that leaves them out keeps them.
    expect(await owner().store.updateSettings({ storeFreeDeliveryAbove: null })).toMatchObject({ storeDeliveryFee: "49.00", storeFreeDeliveryAbove: null });
    await setDelivery("0", null);
  });

  it("adds the charge to the order total, invoice (as an itemised additional charge with GST), payment link and order page; the client cannot name it", async () => {
    await setDelivery("49");
    calls = [];
    const { res, json } = await placeOrder({ deliveryCharge: "0", deliveryFee: "0", additionalCharges: "0", charges: [] });
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ subtotal: "100.00", deliveryCharge: WITH_FEE.fee, taxAmount: WITH_FEE.tax, totalAmount: WITH_FEE.total });
    expect(calls.filter((c) => c.path === "/payment_links")[0]!.body!.amount).toBe(17582);

    const order = await orderRow(json.orderId);
    expect(order.totalAmount).toBe(WITH_FEE.total);
    const [inv] = await db().select().from(invoices).where(eq(invoices.id, order.invoiceId!));
    expect(inv).toMatchObject({ subtotal: "100.00", additionalCharges: "49.00", taxAmount: "26.82", totalAmount: "175.82", amountPaid: "0.00" });
    expect(inv!.charges).toEqual([{ label: "Delivery charge", amount: "49.00" }]);
    // The lines carry only the goods; the charge's GST (8.82) is on top of the line GST (18.00).
    const lines = await db().select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv!.id));
    expect(lines.map((l) => l.totalAmount)).toEqual(["118.00"]);

    const view = (await (await http(`/store/${SLUG}/order/${json.orderId}`)).json()) as any;
    expect(view).toMatchObject({ subtotal: "100.00", deliveryCharge: "49.00", taxAmount: "26.82", totalAmount: "175.82", balance: "175.82" });

    const detail = await owner().store.getOrder({ id: json.orderId });
    expect(detail.delivery).toEqual({ taxableValue: "49.00", taxAmount: "8.82", rate: "18.00" });
  });

  it("the payment link and the webhook settle the whole invoice, delivery included", async () => {
    await setDelivery("49");
    const { json } = await placeOrder();
    const paid = await payInFull(json.orderId, 17582);
    expect(await orderRow(paid.orderId)).toMatchObject({ paymentStatus: "paid" });
    expect((await db().select().from(invoices).where(eq(invoices.id, paid.invoiceId)))[0]).toMatchObject({ status: "paid", amountPaid: "175.82" });
    // Pay again on a paid order is refused: nothing is left.
    const again = await http(`/store/${SLUG}/order/${json.orderId}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(again.status).toBe(409);
  });

  it("is free at exactly the threshold and charged below it, judged on the server from the order's subtotal", async () => {
    await setDelivery("49", "100");
    const atThreshold = await placeOrder();
    expect(atThreshold.json).toMatchObject({ deliveryCharge: "0.00", totalAmount: "118.00" });
    expect((await db().select().from(invoices).where(eq(invoices.id, (await orderRow(atThreshold.json.orderId)).invoiceId!)))[0]!.charges).toBeNull();
    await setDelivery("49", "100.01");
    const below = await placeOrder();
    expect(below.json).toMatchObject({ deliveryCharge: "49.00", totalAmount: "175.82" });
    // More items push the order over the threshold.
    await setDelivery("49", "200");
    const over = await placeOrder({ items: [{ itemId, quantity: 2 }] });
    expect(over.json).toMatchObject({ deliveryCharge: "0.00", totalAmount: "236.00" });
  });

  it("a zero fee adds nothing; the minimum order amount is judged on the goods, not on the delivery", async () => {
    await setDelivery("0", null);
    expect((await placeOrder()).json).toMatchObject({ deliveryCharge: "0.00", totalAmount: "118.00" });
    await setDelivery("49");
    await owner().store.updateSettings({ storeMinOrderAmount: "150.00" });
    const refused = await placeOrder();
    expect(refused.res.status).toBe(400);
    expect(refused.json.error).toContain("Minimum order amount");
    await owner().store.updateSettings({ storeMinOrderAmount: null });
  });

  it("with mixed GST rates the charge takes the highest line rate (the invoice charge mechanism), and a full refund reverses every rupee exactly", async () => {
    await setDelivery("49");
    // 100 @18% + 200 @5%: lines 118 + 210 = 328; delivery 49 + 8.82 GST at 18%; total 385.82; GST 18 + 10 + 8.82 = 36.82.
    const { json } = await placeOrder({ items: [{ itemId, quantity: 1 }, { itemId: fiveId, quantity: 1 }] });
    expect(json).toMatchObject({ subtotal: "300.00", deliveryCharge: "49.00", taxAmount: "36.82", totalAmount: "385.82" });
    const paid = await payInFull(json.orderId, 38582);

    const full = await owner().store.refundOrder({ orderId: paid.orderId, idempotencyKey: "key-delivery-full" });
    expect(full).toMatchObject({ amount: "385.82", paymentStatus: "refunded" });
    const [note] = await db().select().from(invoices).where(eq(invoices.id, full.creditNoteId));
    // The credit note reverses the delivery charge with its GST: same total and same tax as the sale.
    expect(note).toMatchObject({ documentType: "credit_note", totalAmount: "385.82", taxAmount: "36.82" });
    const noteLines = await db().select().from(invoiceItems).where(eq(invoiceItems.invoiceId, note!.id));
    expect(noteLines.map((l) => `${Number(l.taxPercent)}:${l.totalAmount}`).sort()).toEqual(["18:175.82", "5:210.00"]);
    expect((await db().select().from(invoices).where(eq(invoices.id, paid.invoiceId)))[0]!.status).toBe("adjusted");
  });

  it("partial refunds of an order with a delivery charge stay exact: each credit note is exactly the refund, together exactly the total", async () => {
    await setDelivery("49");
    const { json } = await placeOrder();
    const paid = await payInFull(json.orderId, 17582);
    const a = await owner().store.refundOrder({ orderId: paid.orderId, amount: "58.82", idempotencyKey: "key-delivery-part-1" });
    const b = await owner().store.refundOrder({ orderId: paid.orderId, amount: "33.33", idempotencyKey: "key-delivery-part-2" });
    const c = await owner().store.refundOrder({ orderId: paid.orderId, idempotencyKey: "key-delivery-part-3" });
    expect([a.amount, b.amount, c.amount]).toEqual(["58.82", "33.33", "83.67"]);
    expect(c.paymentStatus).toBe("refunded");
    const notes = await db().select().from(invoices).where(eq(invoices.referenceDocumentId, paid.invoiceId));
    expect(notes.map((n) => n.totalAmount).sort()).toEqual(["33.33", "58.82", "83.67"]);
    expect(notes.reduce((t, n) => t + parseFloat(n.taxAmount), 0)).toBeCloseTo(26.82, 1);
    expect(await orderRow(paid.orderId)).toMatchObject({ paymentStatus: "refunded", refundedAmount: "175.82" });
  });

  it("the confirmation email shows subtotal, delivery, GST and total", async () => {
    await setDelivery("49");
    sentMails.length = 0;
    await placeOrder();
    await vi.waitFor(() => expect(sentMails.length).toBeGreaterThan(0));
    const mail = sentMails[0]!;
    expect(mail.text).toContain("Subtotal: Rs 100.00");
    expect(mail.text).toContain("Delivery: Rs 49.00");
    expect(mail.text).toContain("GST: Rs 26.82");
    expect(mail.text).toContain("Total: Rs 175.82");
    await setDelivery("0");
    sentMails.length = 0;
    await placeOrder();
    await vi.waitFor(() => expect(sentMails.length).toBeGreaterThan(0));
    expect(sentMails[0]!.text).toContain("Delivery: Free");
  });
});

describe("data audit", () => {
  it("finds nothing wrong after payments, refunds and cancellations", async () => {
    const report = await runAudit(getTestClient(), { businessIds: [world.business1.id], samples: 10 });
    expect(report.failures.map((f) => `${f.rule.id}: ${f.error}`)).toEqual([]);
    // The fixtures' own parties and items trip unrelated audit-trail rules; what matters here are the money, stock and order rules.
    const mine = /^(invoices|payments|payment_allocations|store_orders|store_order_refunds|razorpay_payments|bank_transactions|bank_accounts)\./;
    const errors = report.results.filter((r) => r.rule.severity === "error" && mine.test(r.rule.id));
    expect(errors.map((r) => `${r.rule.id}: ${r.samples.map((x) => x.detail).join(" | ")}`)).toEqual([]);
  });
});
