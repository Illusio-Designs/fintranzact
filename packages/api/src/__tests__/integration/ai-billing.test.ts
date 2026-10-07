/**
 * ai-billing.test.ts — buying the AI add-ons (AI Assistant, AI Plus) and extra question packs,
 * against a real Postgres. Razorpay is ALWAYS a fake: the platform keys are test strings and
 * `fetch` is stubbed, so no test calls the network.
 *
 * Invariants:
 *   1. While `ADDON_FEATURES.ai_*.implemented` is false nothing can be bought (server side too).
 *   2. Pricing: monthly/yearly + 18% GST, admin price overrides, the pack price.
 *   3. Tiers: Assistant -> Plus now (old retired with a credit note), Plus -> Assistant at the
 *      period end; an organisation is never billed for both.
 *   4. Packs: server-side signature check, webhook idempotency, one grant per payment, failed
 *      payments and refunds leave no credits, the existing consume logic uses them after the
 *      monthly included questions.
 *   5. Unpaid after the grace period: the assistant is blocked, chats stay readable, credits wait.
 *   6. Only the owner buys; platform-admin grants; audit entries; invoices; the receipt email.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiCreditGrants, aiPackOrders, aiQuotaCounters, billingEvents, businessMembers, billingPayments, billingSubscriptions, systemConfig, tenants,
} from "@fintranzact/db";
import { ADDON_COMING_SOON_MESSAGE, ADDON_FEATURES, ADDON_IDS, AI_PACK_MAX_PER_ORDER, aiQuotaPeriod, type AddonId } from "@fintranzact/shared";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, grantAddon, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { invalidateEntitlements, getEntitlements } from "../../lib/entitlements.js";
import { invalidateAddonPrices } from "../../lib/billing/addon-prices.js";
import { getBillingState } from "../../lib/billing/service.js";
import { fulfilPackPayment, packDeps } from "../../lib/billing/ai-packs.js";
import { generateBillingInvoicePDF, gstSplit } from "../../lib/billing/invoice-pdf.js";
import { consumeQuestion, loadAiAccount } from "../../lib/ai/quota.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { handleRazorpayEvent, registerRazorpayWebhook } from "../../http/razorpayWebhook.js";

const cdb = () => getControlDb();
const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";
const KEY_SECRET = "test_key_secret_not_real";
const WEBHOOK_SECRET = "test_webhook_secret_not_real";
const PERIOD = aiQuotaPeriod(new Date());

type Caller = ReturnType<typeof createTestCaller>;
const as = (u: { id: string; email: string; name?: string | null }, t: { id: string }): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: NO_BUSINESS });

// ── Availability: the flag is the one switch; tests turn it on and restore it ──
const flagBackup = Object.fromEntries(ADDON_IDS.map((id) => [id, ADDON_FEATURES[id].implemented])) as Record<AddonId, boolean>;
function releaseAi() {
  ADDON_FEATURES.ai_assistant.implemented = true;
  ADDON_FEATURES.ai_plus.implemented = true;
}

// ── A fake Razorpay (platform account) behind `fetch` ──
interface RzpCall { method: string; path: string; body: Record<string, unknown> | null }
let rzpCalls: RzpCall[] = [];
let rzpFailCancel = false;
let orderSeq = 0;
function installFakeRazorpay() {
  process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  rzpCalls = [];
  rzpFailCancel = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const path = String(url).replace("https://api.razorpay.com/v1", "");
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    rzpCalls.push({ method: init?.method ?? "GET", path, body });
    if (path === "/orders") return new Response(JSON.stringify({ id: `order_TEST${++orderSeq}` }));
    if (path === "/plans") return new Response(JSON.stringify({ id: `plan_TEST${++orderSeq}` }));
    if (path === "/subscriptions") return new Response(JSON.stringify({ id: `sub_TEST${++orderSeq}` }));
    if (/^\/subscriptions\/.+\/cancel$/.test(path)) {
      return rzpFailCancel ? new Response("gateway down", { status: 500 }) : new Response(JSON.stringify({ status: "cancelled" }));
    }
    return new Response("not found", { status: 404 });
  }));
}
function removeFakeRazorpay() {
  process.env.RAZORPAY_KEY_ID = "";
  process.env.RAZORPAY_KEY_SECRET = "";
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  vi.unstubAllGlobals();
}
const orderSig = (orderId: string, paymentId: string, secret = KEY_SECRET) => createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

// ── Fixtures ──
let admin: TestUser;
let adminC: Caller;
let counter = 0;

async function freshOrg(label: string): Promise<{ owner: TestUser; tenant: TestTenant; ownerC: Caller }> {
  const n = ++counter;
  const owner = await createUser({ email: `owner${n}.${label}@aibill.test`, name: "Anjali Mehta" });
  const tenant = await createTenant({ name: `Org ${label} ${n}` });
  await addMember(tenant.id, owner.id, "owner");
  return { owner, tenant, ownerC: as(owner, tenant) };
}

/** A caller with a real business, for the ai.* procedures (they need one). */
async function withBusiness(o: { owner: TestUser; tenant: TestTenant }): Promise<Caller> {
  const db = getTenantTestDb();
  const biz = await createBusiness(db, o.owner.id, { name: "AI Bill Traders" });
  await db.insert(businessMembers).values({ businessId: biz.id, userId: o.owner.id, role: "admin" });
  return createTestCaller({ userId: o.owner.id, email: o.owner.email, name: o.owner.name ?? null, tenantId: o.tenant.id, businessId: biz.id });
}

async function aiSubs(tenantId: string) {
  return cdb().select().from(billingSubscriptions).where(and(eq(billingSubscriptions.tenantId, tenantId), eq(billingSubscriptions.kind, "addon"), inArray(billingSubscriptions.addon, ["ai_assistant", "ai_plus"])));
}
const liveAi = async (tenantId: string) => (await aiSubs(tenantId)).filter((s) => s.status === "active" || s.status === "past_due");
const payments = (tenantId: string) => cdb().select().from(billingPayments).where(eq(billingPayments.tenantId, tenantId)).orderBy(billingPayments.createdAt);
const grants = (tenantId: string) => cdb().select().from(aiCreditGrants).where(eq(aiCreditGrants.tenantId, tenantId));
const events = async (tenantId: string, type: string) => (await cdb().select().from(billingEvents).where(and(eq(billingEvents.tenantId, tenantId), eq(billingEvents.type, type))));
const tenantRow = async (id: string) => (await cdb().select().from(tenants).where(eq(tenants.id, id)))[0]!;

const notices: Array<{ to: string; subject: string; text: string }> = [];
const realSend = packDeps.sendNotice;

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAIL = "platform@fintranzact.test";
  admin = await createUser({ email: "platform@fintranzact.test", name: "Platform", emailVerified: true });
  const t = await createTenant({ name: "Platform Org" });
  adminC = as(admin, t);
  packDeps.sendNotice = async (to, subject, text) => { notices.push({ to, subject, text }); };
}, 60_000);

afterAll(async () => {
  packDeps.sendNotice = realSend;
  await truncateAllTables();
  await closeTestDb();
});

beforeEach(async () => {
  notices.length = 0;
  invalidateAddonPrices();
  await cdb().delete(systemConfig).where(eq(systemConfig.key, "razorpay_plan_ids")); // the fake gateway mints fresh plans
});

afterEach(async () => {
  for (const id of ADDON_IDS) ADDON_FEATURES[id].implemented = flagBackup[id];
  removeFakeRazorpay();
  await cdb().delete(systemConfig).where(inArray(systemConfig.key, ["billing.addon_prices", "razorpay_plan_ids"]));
  invalidateAddonPrices();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("shipped state: the add-ons are not on sale", () => {
  it("the shipped flags are false", () => {
    expect(flagBackup.ai_assistant).toBe(false);
    expect(flagBackup.ai_plus).toBe(false);
  });

  it("config hides everything and every purchase path refuses, creating nothing", async () => {
    const { ownerC, tenant } = await freshOrg("shipped");
    const config = await ownerC.billing.config();
    expect(config.addonAvailability).toMatchObject({ ai_assistant: false, ai_plus: false });
    expect(config.aiPackAvailable).toBe(false);

    await expect(ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: ADDON_COMING_SOON_MESSAGE });
    await expect(ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "yearly" })).rejects.toMatchObject({ message: ADDON_COMING_SOON_MESSAGE });
    await expect(ownerC.billing.changeAddon({ addon: "ai_plus", cycle: "monthly" })).rejects.toMatchObject({ message: ADDON_COMING_SOON_MESSAGE });
    await expect(ownerC.billing.buyAiPack({ packs: 1 })).rejects.toMatchObject({ message: ADDON_COMING_SOON_MESSAGE });

    expect(await aiSubs(tenant.id)).toHaveLength(0);
    expect(await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, tenant.id))).toHaveLength(0);
    expect(await payments(tenant.id)).toHaveLength(0);

    const overview = await ownerC.billing.overview();
    expect(overview.ai.packAvailable).toBe(false);
    expect(overview.addons.filter((a) => a.group === "ai").every((a) => a.available === false)).toBe(true);
  });

  it("an add-on an admin granted before release keeps working and its owner still sees it", async () => {
    const { ownerC, tenant } = await freshOrg("heldearly");
    await grantAddon(tenant.id, "ai_assistant");
    expect((await ownerC.billing.status()).addons).toMatchObject({ ai_assistant: true });
    expect((await ownerC.billing.overview()).addonSubscriptions).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("subscribing (released)", () => {
  beforeEach(releaseAi);

  it("AI Assistant monthly: active, one invoice of 399 + 18% GST", async () => {
    const { ownerC, tenant } = await freshOrg("sub1");
    const r = await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    expect(r).toMatchObject({ status: "active", totalPaise: 47_082 });
    const [sub] = await aiSubs(tenant.id);
    expect(sub).toMatchObject({ addon: "ai_assistant", status: "active", cycle: "monthly", basePaise: 39_900, provider: "demo" });
    const [p] = await payments(tenant.id);
    expect(p).toMatchObject({ status: "captured", basePaise: 39_900, gstPaise: 7_182, totalPaise: 47_082, description: "AI Assistant add-on — monthly" });
    expect(p!.invoiceSeq).toBeGreaterThan(0);
    expect((await getEntitlements(tenant.id)).addons.ai_assistant).toBe(true);
  });

  it("AI Plus yearly is ten months: 9,990 + GST, and grants AI Assistant too", async () => {
    const { ownerC, tenant } = await freshOrg("sub2");
    await ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "yearly" });
    const [p] = await payments(tenant.id);
    expect(p).toMatchObject({ basePaise: 999_000, gstPaise: 179_820, totalPaise: 1_178_820, description: "AI Plus add-on — yearly" });
    expect((await getEntitlements(tenant.id)).addons).toMatchObject({ ai_plus: true, ai_assistant: true });
  });

  it("with Razorpay it is its own subscription on the platform account (not the business's keys) and the checkout activates it", async () => {
    installFakeRazorpay();
    const { ownerC, tenant } = await freshOrg("sub3");
    const r = await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    expect(r).toMatchObject({ status: "checkout", totalPaise: 47_082, razorpayKeyId: "rzp_test_fake" });
    const plan = rzpCalls.find((c) => c.path === "/plans")!;
    expect((plan.body!.item as { amount: number }).amount).toBe(47_082);
    expect((await getEntitlements(tenant.id)).addons.ai_assistant).toBe(false); // awaiting payment
    if (r.status !== "checkout") throw new Error("expected checkout");
    const [sub] = await aiSubs(tenant.id);
    expect(sub!.status).toBe("created");
    await handleRazorpayEvent({ event: "subscription.activated", payload: { subscription: { entity: { id: r.providerSubscriptionId } }, payment: { entity: { id: "pay_S1", method: "upi" } } } }, "evt_ai_sub_1");
    expect((await getEntitlements(tenant.id)).addons.ai_assistant).toBe(true);
    expect((await payments(tenant.id))[0]).toMatchObject({ providerPaymentId: "pay_S1", totalPaise: 47_082 });
  });

  it("a second tier cannot be bought on top (never billed for both)", async () => {
    const { ownerC, tenant } = await freshOrg("sub4");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await expect(ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "monthly" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await liveAi(tenant.id)).toHaveLength(1);
  });

  it("only the owner buys: an admin, a seller and an accountant are refused", async () => {
    const { tenant } = await freshOrg("perm");
    for (const role of ["admin", "seller", "accountant"] as const) {
      const u = await createUser({ email: `${role}.perm${++counter}@aibill.test`, name: role });
      await addMember(tenant.id, u.id, role);
      const c = as(u, tenant);
      await expect(c.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.billing.changeAddon({ addon: "ai_plus", cycle: "monthly" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.billing.buyAiPack({ packs: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.billing.verifyAiPackPayment({ orderId: "11111111-1111-4111-8111-111111111111", razorpayPaymentId: "pay_x", razorpaySignature: "sig" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await aiSubs(tenant.id)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("admin price overrides", () => {
  beforeEach(releaseAi);

  it("editing a price changes what the next purchase costs, and the overview shows it", async () => {
    await adminC.platform.saveAddonPrices({
      addons: { ai_assistant: { monthlyPriceInr: 449, yearlyPriceInr: 4_000 }, ai_plus: { monthlyPriceInr: 1_099, yearlyPriceInr: null } },
      aiPackPriceInr: 249,
    });
    const table = await adminC.platform.addonPrices();
    expect(table.addons.find((a) => a.id === "ai_assistant")).toMatchObject({ monthlyPriceInr: 449, yearlyPriceInr: 4_000, edited: true, builtInMonthlyPriceInr: 399 });
    expect(table.addons.find((a) => a.id === "payroll")).toMatchObject({ edited: false });
    expect(table.aiPack).toMatchObject({ priceInr: 249, edited: true, builtInPriceInr: 199 });

    const { ownerC, tenant } = await freshOrg("prices");
    expect((await ownerC.billing.overview()).ai.pack).toMatchObject({ priceInr: 249 });
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "yearly" });
    expect((await payments(tenant.id))[0]).toMatchObject({ basePaise: 400_000, totalPaise: 472_000 });

    const pack = await ownerC.billing.buyAiPack({ packs: 2 });
    expect(pack).toMatchObject({ status: "paid", totalPaise: 58_764 }); // 2 x 249 = 498 + 18%
  });

  it("the admin can put a price back to the built-in one, and only platform admins can edit", async () => {
    await adminC.platform.saveAddonPrices({ addons: { ai_plus: { monthlyPriceInr: 1_099, yearlyPriceInr: null } }, aiPackPriceInr: 249 });
    await adminC.platform.saveAddonPrices({ addons: {}, aiPackPriceInr: null });
    const table = await adminC.platform.addonPrices();
    expect(table.addons.find((a) => a.id === "ai_plus")).toMatchObject({ monthlyPriceInr: 999, edited: false });
    expect(table.aiPack.priceInr).toBe(199);

    const { ownerC } = await freshOrg("prices2");
    await expect(ownerC.platform.saveAddonPrices({ addons: {}, aiPackPriceInr: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerC.platform.addonPrices()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adminC.platform.saveAddonPrices({ addons: { ai_plus: { monthlyPriceInr: 0, yearlyPriceInr: null } }, aiPackPriceInr: null })).rejects.toThrow();
  });

  it("a garbage stored value falls back to the built-in prices (checkout never breaks)", async () => {
    await cdb().insert(systemConfig).values({ key: "billing.addon_prices", value: { ai_assistant: { monthlyPriceInr: "free" }, ai_pack: { priceInr: -1 } } });
    invalidateAddonPrices();
    const { ownerC, tenant } = await freshOrg("prices3");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    expect((await payments(tenant.id))[0]!.basePaise).toBe(39_900);
  });

  it("an edit is recorded in the billing event log with the admin", async () => {
    await adminC.platform.saveAddonPrices({ addons: {}, aiPackPriceInr: 220 });
    const rows = await cdb().select().from(billingEvents).where(eq(billingEvents.type, "platform.addon_prices_changed"));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.at(-1)!.payload)).toContain(admin.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("tier changes: AI Assistant <-> AI Plus", () => {
  beforeEach(releaseAi);

  it("upgrade applies now: Plus is bought, Assistant retired with a credit note; never two live", async () => {
    const { ownerC, tenant } = await freshOrg("up1");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    const r = await ownerC.billing.changeAddon({ addon: "ai_plus", cycle: "monthly" });
    expect(r).toEqual({ applied: "now" });

    const subs = await aiSubs(tenant.id);
    expect(subs.filter((s) => s.status === "active").map((s) => s.addon)).toEqual(["ai_plus"]);
    expect(subs.find((s) => s.addon === "ai_assistant")!.status).toBe("cancelled");
    expect(await liveAi(tenant.id)).toHaveLength(1);

    const pays = await payments(tenant.id);
    expect(pays.map((p) => p.status)).toEqual(["captured", "credit", "captured"]);
    const credit = pays[1]!;
    expect(credit.basePaise).toBeLessThan(0);
    expect(Math.abs(credit.basePaise)).toBeLessThanOrEqual(39_900);
    expect(credit.description).toMatch(/Credit note: unused AI Assistant add-on time/);
    expect(pays[2]).toMatchObject({ basePaise: 99_900, description: "AI Plus add-on — monthly" });
    expect(await events(tenant.id, "subscription.addon_switched")).toHaveLength(1);
    expect((await getEntitlements(tenant.id)).addons).toMatchObject({ ai_plus: true, ai_assistant: true });
  });

  it("downgrade waits for the period end, then Assistant takes over (applied lazily)", async () => {
    const { ownerC, tenant } = await freshOrg("down1");
    await ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "monthly" });
    const r = await ownerC.billing.changeAddon({ addon: "ai_assistant", cycle: "monthly" });
    expect(r).toEqual({ applied: "at_period_end" });
    // Still Plus, with a scheduled switch; no second invoice.
    let live = await liveAi(tenant.id);
    expect(live.map((s) => s.addon)).toEqual(["ai_plus"]);
    expect(live[0]).toMatchObject({ scheduledAddon: "ai_assistant", scheduledCycle: "monthly" });
    expect((await payments(tenant.id)).length).toBe(1);

    // The period runs out.
    await cdb().update(billingSubscriptions).set({ currentPeriodEnd: new Date(Date.now() - 1_000) }).where(eq(billingSubscriptions.id, live[0]!.id));
    invalidateEntitlements(tenant.id);
    await getBillingState(tenant.id);
    live = await liveAi(tenant.id);
    expect(live.map((s) => s.addon)).toEqual(["ai_assistant"]);
    expect((await aiSubs(tenant.id)).find((s) => s.addon === "ai_plus")!.status).toBe("cancelled");
    expect((await payments(tenant.id)).at(-1)).toMatchObject({ description: "AI Assistant add-on — monthly", basePaise: 39_900 });
  });

  it("with Razorpay the old tier keeps running until the new one is paid, then is retired and cancelled at the gateway", async () => {
    installFakeRazorpay();
    const { ownerC, tenant } = await freshOrg("up2");
    const first = await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    if (first.status !== "checkout") throw new Error("expected checkout");
    await handleRazorpayEvent({ event: "subscription.activated", payload: { subscription: { entity: { id: first.providerSubscriptionId } }, payment: { entity: { id: "pay_A1" } } } }, "evt_up2_1");

    const r = await ownerC.billing.changeAddon({ addon: "ai_plus", cycle: "monthly" });
    expect(r.applied).toBe("now");
    if (!r.checkout) throw new Error("expected a checkout");
    // Not paid yet: Assistant is still the only live tier.
    expect((await liveAi(tenant.id)).map((s) => s.addon)).toEqual(["ai_assistant"]);

    await handleRazorpayEvent({ event: "subscription.activated", payload: { subscription: { entity: { id: r.checkout.providerSubscriptionId } }, payment: { entity: { id: "pay_P1" } } } }, "evt_up2_2");
    expect((await liveAi(tenant.id)).map((s) => s.addon)).toEqual(["ai_plus"]);
    const cancelCalls = rzpCalls.filter((c) => /\/cancel$/.test(c.path));
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]!.path).toBe(`/subscriptions/${first.providerSubscriptionId}/cancel`);
    expect(cancelCalls[0]!.body).toEqual({ cancel_at_cycle_end: 0 });
    // The new invoice is the full Plus price; the unused Assistant time is a credit note.
    const pays = await payments(tenant.id);
    expect(pays.map((p) => p.status)).toEqual(["captured", "credit", "captured"]);
    expect(pays[2]).toMatchObject({ basePaise: 99_900, providerPaymentId: "pay_P1" });
  });

  it("a gateway failure while retiring the old tier is recorded, never thrown (the money for the new tier is taken)", async () => {
    installFakeRazorpay();
    const { ownerC, tenant } = await freshOrg("up3");
    const first = await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    if (first.status !== "checkout") throw new Error("expected checkout");
    await handleRazorpayEvent({ event: "subscription.activated", payload: { subscription: { entity: { id: first.providerSubscriptionId } }, payment: { entity: { id: "pay_B1" } } } }, "evt_up3_1");
    const r = await ownerC.billing.changeAddon({ addon: "ai_plus", cycle: "monthly" });
    rzpFailCancel = true;
    await handleRazorpayEvent({ event: "subscription.activated", payload: { subscription: { entity: { id: r.checkout!.providerSubscriptionId } }, payment: { entity: { id: "pay_B2" } } } }, "evt_up3_2");
    expect((await liveAi(tenant.id)).map((s) => s.addon)).toEqual(["ai_plus"]);
    const failed = await events(tenant.id, "subscription.replace_cancel_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toMatch(/Razorpay/);
  });

  it("changing to what you have is refused; with nothing to change it says subscribe", async () => {
    const { ownerC } = await freshOrg("chg");
    await expect(ownerC.billing.changeAddon({ addon: "ai_plus", cycle: "monthly" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await expect(ownerC.billing.changeAddon({ addon: "ai_assistant", cycle: "monthly" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the same tier on another cycle is scheduled for the period end", async () => {
    const { ownerC, tenant } = await freshOrg("cycle");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    expect(await ownerC.billing.changeAddon({ addon: "ai_assistant", cycle: "yearly" })).toEqual({ applied: "at_period_end" });
    expect((await liveAi(tenant.id))[0]).toMatchObject({ scheduledAddon: "ai_assistant", scheduledCycle: "yearly" });
  });

  it("cancelling clears a scheduled switch and the subscription runs out with its period", async () => {
    const { ownerC, tenant } = await freshOrg("cancel");
    await ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "monthly" });
    await ownerC.billing.changeAddon({ addon: "ai_assistant", cycle: "monthly" });
    const [sub] = await liveAi(tenant.id);
    await ownerC.billing.cancelSubscription({ subscriptionId: sub!.id });
    const [after] = await liveAi(tenant.id);
    expect(after).toMatchObject({ cancelAtPeriodEnd: true, scheduledAddon: null });
    await cdb().update(billingSubscriptions).set({ currentPeriodEnd: new Date(Date.now() - 1_000) }).where(eq(billingSubscriptions.id, sub!.id));
    invalidateEntitlements(tenant.id);
    await getBillingState(tenant.id);
    expect(await liveAi(tenant.id)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extra question packs: demo gateway", () => {
  beforeEach(releaseAi);

  it("an organisation with an AI add-on buys 3 packs: GST invoice, 300 credits linked to the payment, receipt email", async () => {
    const { ownerC, tenant, owner } = await freshOrg("pack1");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    const r = await ownerC.billing.buyAiPack({ packs: 3 });
    expect(r).toMatchObject({ status: "paid", packs: 3, credits: 300, totalPaise: 70_446, razorpayKeyId: null });

    const [grant] = await grants(tenant.id);
    expect(grant).toMatchObject({ credits: 300, used: 0, source: "purchase", reason: "purchase" });
    const pay = (await payments(tenant.id)).find((p) => p.id === grant!.paymentId)!;
    expect(pay).toMatchObject({ status: "captured", basePaise: 59_700, gstPaise: 10_746, totalPaise: 70_446, description: "AI question packs — 3 × 100 questions" });
    expect(pay.invoiceSeq).toBeGreaterThan(0);
    const [order] = await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, tenant.id));
    expect(order).toMatchObject({ status: "paid", paymentId: pay.id, grantId: grant!.id, packs: 3, credits: 300 });

    await vi.waitFor(() => expect(notices.find((n) => n.to === owner.email)).toBeDefined());
    const mail = notices.find((n) => n.to === owner.email)!;
    expect(mail.subject).toMatch(/Receipt/);
    expect(mail.text).toContain("₹704.46");
    expect(mail.text).toMatch(/FIN-\d{5}/);

    const overview = await ownerC.billing.overview();
    expect(overview.ai.creditsRemaining).toBe(300);
    expect(overview.ai.purchases[0]).toMatchObject({ packs: 3, credits: 300, status: "paid", invoiceNumber: expect.stringMatching(/^FIN-\d{5}$/), creditsLeft: 300 });
  });

  it("the questions are used by the existing consume logic after the monthly included ones", async () => {
    const { ownerC, tenant } = await freshOrg("pack2");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await ownerC.billing.buyAiPack({ packs: 1 });
    const account = await loadAiAccount(tenant.id, await getEntitlements(tenant.id));
    expect(account!.allowance).toMatchObject({ limit: 150, remaining: 250, creditsRemaining: 100 });
    // Included questions first…
    expect(await consumeQuestion(tenant.id, PERIOD, 150)).toEqual({ source: "included" });
    // …then, once they are used up, the pack.
    await cdb().insert(aiQuotaCounters).values({ tenantId: tenant.id, key: PERIOD, used: 150 }).onConflictDoUpdate({ target: [aiQuotaCounters.tenantId, aiQuotaCounters.key], set: { used: 150 } });
    const next = await consumeQuestion(tenant.id, PERIOD, 150);
    expect(next).toMatchObject({ source: "credit" });
    expect((await grants(tenant.id))[0]!.used).toBe(1);
  });

  it("1 to 50 packs only; 0, 51 and fractions are refused before anything is created", async () => {
    const { ownerC, tenant } = await freshOrg("pack3");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    for (const packs of [0, AI_PACK_MAX_PER_ORDER + 1, 2.5, -1]) await expect(ownerC.billing.buyAiPack({ packs })).rejects.toThrow();
    expect(await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, tenant.id))).toHaveLength(0);
    const max = await ownerC.billing.buyAiPack({ packs: AI_PACK_MAX_PER_ORDER });
    expect(max).toMatchObject({ credits: 5_000, status: "paid" });
  });

  it("an organisation without an AI add-on cannot buy packs (credits would be unusable)", async () => {
    const { ownerC, tenant } = await freshOrg("pack4");
    await expect(ownerC.billing.buyAiPack({ packs: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/AI plan/) });
    expect(await grants(tenant.id)).toHaveLength(0);
  });

  it("during the Full Access Trial (AI on) packs can be bought", async () => {
    const { ownerC, tenant } = await freshOrg("pack5");
    await cdb().update(tenants).set({ trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 5 * 86_400_000), trialSource: "signup" }).where(eq(tenants.id, tenant.id));
    invalidateEntitlements(tenant.id);
    await expect(ownerC.billing.buyAiPack({ packs: 1 })).resolves.toMatchObject({ status: "paid" });
  });

  it("the invoice for a pack: SAC from the subscription invoices, CGST+SGST in Gujarat, IGST elsewhere, a real PDF", async () => {
    const intra = gstSplit({ gstin: "24AAAAA0000A1Z5" }, 3_582, "24");
    expect(intra.map((p) => p.label)).toEqual(["CGST (9%)", "SGST (9%)"]);
    expect(intra.reduce((n, p) => n + p.paise, 0)).toBe(3_582);
    expect(gstSplit({ gstin: "27AAAAA0000A1Z5" }, 3_582, "24")).toEqual([{ label: "IGST (18%)", paise: 3_582 }]);
    expect(gstSplit({}, 3_582, "24")).toEqual([{ label: "IGST (18%)", paise: 3_582 }]);
    const pdf = await generateBillingInvoicePDF({
      invoiceNumber: "FIN-00001", date: new Date(), description: "AI question packs — 1 × 100 questions", periodStart: null, periodEnd: null,
      basePaise: 19_900, gstPaise: 3_582, totalPaise: 23_482, method: "upi", providerPaymentId: "pay_X",
      customer: { name: "Mehta Traders", gstin: "24AAAAA0000A1Z5", address: null, state: null }, isCreditNote: false,
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("the frozen billing details of the organisation are on the pack invoice", async () => {
    const { ownerC, tenant } = await freshOrg("pack6");
    await ownerC.billing.updateBillingDetails({ name: "Mehta Traders LLP", gstin: "27AAAAA0000A1Z5", address: "Pune", email: "accounts@mehta.test" });
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await ownerC.billing.buyAiPack({ packs: 1 });
    const pay = (await payments(tenant.id)).find((p) => p.description.startsWith("AI question packs"))!;
    expect(pay).toMatchObject({ billingName: "Mehta Traders LLP", billingGstin: "27AAAAA0000A1Z5" });
    await vi.waitFor(() => expect(notices.find((n) => n.to === "accounts@mehta.test")).toBeDefined());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("extra question packs: Razorpay Orders on the platform account", () => {
  beforeEach(() => {
    releaseAi();
    installFakeRazorpay();
  });

  async function orgWithAddon(label: string) {
    const o = await freshOrg(label);
    await grantAddon(o.tenant.id, "ai_assistant");
    return o;
  }
  async function startOrder(o: Awaited<ReturnType<typeof freshOrg>>, packs = 2) {
    const r = await o.ownerC.billing.buyAiPack({ packs });
    if (r.status !== "checkout") throw new Error("expected checkout");
    return r;
  }
  const captured = (orderId: string, paymentId: string, amount: number, extra: Record<string, unknown> = {}) => ({
    event: "payment.captured",
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, method: "upi", ...extra } } },
  });

  it("creates the order for the GST-inclusive total on the platform keys, and grants nothing until paid", async () => {
    const o = await orgWithAddon("rz1");
    const r = await startOrder(o, 2);
    expect(r).toMatchObject({ status: "checkout", razorpayKeyId: "rzp_test_fake", totalPaise: 46_964, credits: 200 });
    const call = rzpCalls.find((c) => c.path === "/orders")!;
    expect(call.body).toMatchObject({ amount: 46_964, currency: "INR", notes: { tenantId: o.tenant.id, item: "ai_pack", packs: "2" } });
    expect(await grants(o.tenant.id)).toHaveLength(0);
    expect((await payments(o.tenant.id))).toHaveLength(0);
    expect((await events(o.tenant.id, "ai_pack.order_created"))).toHaveLength(1);
  });

  it("a valid signature grants once; replaying the callback adds nothing", async () => {
    const o = await orgWithAddon("rz2");
    const r = await startOrder(o);
    const input = { orderId: r.orderId, razorpayPaymentId: "pay_OK1", razorpaySignature: orderSig(r.providerOrderId, "pay_OK1") };
    expect(await o.ownerC.billing.verifyAiPackPayment(input)).toMatchObject({ status: "paid", credits: 200, alreadyApplied: false });
    expect(await o.ownerC.billing.verifyAiPackPayment(input)).toMatchObject({ status: "paid", alreadyApplied: true });
    const gs = await grants(o.tenant.id);
    expect(gs).toHaveLength(1);
    expect(gs[0]).toMatchObject({ credits: 200, source: "purchase", reason: "purchase" });
    const pays = await payments(o.tenant.id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ providerPaymentId: "pay_OK1", provider: "razorpay", totalPaise: 46_964, id: gs[0]!.paymentId });
  });

  it("an invalid signature (wrong secret, wrong payment id, empty) grants nothing", async () => {
    const o = await orgWithAddon("rz3");
    const r = await startOrder(o);
    const bad = [
      orderSig(r.providerOrderId, "pay_BAD", "another_secret"),
      orderSig(r.providerOrderId, "pay_OTHER"),
      orderSig("order_OTHER", "pay_BAD"),
      "deadbeef",
    ];
    for (const sig of bad) {
      await expect(o.ownerC.billing.verifyAiPackPayment({ orderId: r.orderId, razorpayPaymentId: "pay_BAD", razorpaySignature: sig })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Payment could not be verified." });
    }
    expect(await grants(o.tenant.id)).toHaveLength(0);
    expect(await payments(o.tenant.id)).toHaveLength(0);
    const [order] = await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, o.tenant.id));
    expect(order!.status).toBe("created");
  });

  it("another organisation's owner cannot confirm someone else's order", async () => {
    const a = await orgWithAddon("rz4a");
    const b = await orgWithAddon("rz4b");
    const r = await startOrder(a);
    await expect(b.ownerC.billing.verifyAiPackPayment({ orderId: r.orderId, razorpayPaymentId: "pay_X", razorpaySignature: orderSig(r.providerOrderId, "pay_X") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await grants(b.tenant.id)).toHaveLength(0);
    expect(await grants(a.tenant.id)).toHaveLength(0);
  });

  it("payment.captured grants without the browser; a duplicate delivery, a new event id and the callback together grant once", async () => {
    const o = await orgWithAddon("rz5");
    const r = await startOrder(o);
    const ev = captured(r.providerOrderId, "pay_W1", 46_964);
    await handleRazorpayEvent(ev, "evt_pack_1");
    await handleRazorpayEvent(ev, "evt_pack_1"); // redelivered
    await handleRazorpayEvent(ev, "evt_pack_2"); // same payment, another event id
    await handleRazorpayEvent({ event: "order.paid", payload: { order: { entity: { id: r.providerOrderId } }, payment: { entity: { id: "pay_W1", order_id: r.providerOrderId, amount: 46_964 } } } }, "evt_pack_3");
    await o.ownerC.billing.verifyAiPackPayment({ orderId: r.orderId, razorpayPaymentId: "pay_W1", razorpaySignature: orderSig(r.providerOrderId, "pay_W1") });
    expect(await grants(o.tenant.id)).toHaveLength(1);
    expect(await payments(o.tenant.id)).toHaveLength(1);
    expect(await events(o.tenant.id, "ai_pack.paid")).toHaveLength(1);
    await vi.waitFor(() => expect(notices.filter((n) => n.to === o.owner.email && n.subject.startsWith("Receipt"))).toHaveLength(1));
  });

  it("concurrent confirmations (webhook racing the callback) grant exactly once", async () => {
    const o = await orgWithAddon("rz6");
    const r = await startOrder(o, 1);
    const results = await Promise.all(Array.from({ length: 6 }, () => fulfilPackPayment({ providerOrderId: r.providerOrderId, providerPaymentId: "pay_RACE" })));
    expect(results.filter((x) => x.granted)).toHaveLength(1);
    expect(await grants(o.tenant.id)).toHaveLength(1);
    expect(await payments(o.tenant.id)).toHaveLength(1);
  });

  it("the same payment id cannot pay two orders", async () => {
    const o = await orgWithAddon("rz7");
    const r1 = await startOrder(o, 1);
    const r2 = await startOrder(o, 1);
    await fulfilPackPayment({ providerOrderId: r1.providerOrderId, providerPaymentId: "pay_SAME" });
    await expect(fulfilPackPayment({ providerOrderId: r2.providerOrderId, providerPaymentId: "pay_SAME" })).rejects.toThrow();
    expect(await grants(o.tenant.id)).toHaveLength(1);
    expect(await payments(o.tenant.id)).toHaveLength(1);
  });

  it("a captured amount that is not the order's total grants nothing and is acknowledged with an audit trail", async () => {
    const o = await orgWithAddon("rz8");
    const r = await startOrder(o);
    await expect(handleRazorpayEvent(captured(r.providerOrderId, "pay_LOW", 100), "evt_low")).resolves.toBeUndefined();
    expect(await grants(o.tenant.id)).toHaveLength(0);
    const rejected = await events(o.tenant.id, "ai_pack.payment_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.error).toMatch(/amount/);
  });

  it("a failed payment grants nothing and takes no invoice number; a later successful retry on the same order still pays it", async () => {
    const o = await orgWithAddon("rz9");
    const r = await startOrder(o);
    await handleRazorpayEvent({ event: "payment.failed", payload: { payment: { entity: { id: "pay_F1", order_id: r.providerOrderId, error_description: "Insufficient funds" } } } }, "evt_f1");
    const [failed] = await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, o.tenant.id));
    expect(failed).toMatchObject({ status: "failed", failureReason: "Insufficient funds" });
    expect(await grants(o.tenant.id)).toHaveLength(0);
    expect(await payments(o.tenant.id)).toHaveLength(0);

    await handleRazorpayEvent(captured(r.providerOrderId, "pay_F2", 46_964), "evt_f2");
    expect(await grants(o.tenant.id)).toHaveLength(1);
    const [paid] = await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, o.tenant.id));
    expect(paid!.status).toBe("paid");
    // A late failure notice never undoes a paid order.
    await handleRazorpayEvent({ event: "payment.failed", payload: { payment: { entity: { id: "pay_F3", order_id: r.providerOrderId } } } }, "evt_f3");
    expect((await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, o.tenant.id)))[0]!.status).toBe("paid");
  });

  it("a full refund takes the unused credits back and raises a credit note; replaying it changes nothing", async () => {
    const o = await orgWithAddon("rz10");
    const r = await startOrder(o, 2);
    await handleRazorpayEvent(captured(r.providerOrderId, "pay_R1", 46_964), "evt_r1");
    await cdb().update(aiCreditGrants).set({ used: 30 }).where(eq(aiCreditGrants.tenantId, o.tenant.id)); // 30 of the 200 were asked
    const refund = { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_R1", amount: 46_964 } } } };
    await handleRazorpayEvent(refund, "evt_r2");
    await handleRazorpayEvent(refund, "evt_r2");
    await handleRazorpayEvent(refund, "evt_r3"); // same refund, another event id
    const [g] = await grants(o.tenant.id);
    expect(g).toMatchObject({ credits: 30, used: 30 });
    expect(g!.credits - g!.used).toBe(0);
    expect((await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, o.tenant.id)))[0]!.status).toBe("refunded");
    const pays = await payments(o.tenant.id);
    expect(pays.map((p) => p.status)).toEqual(["captured", "credit"]);
    expect(pays[1]!.invoiceSeq).toBeGreaterThan(pays[0]!.invoiceSeq!);
    expect(pays[1]!.basePaise + pays[1]!.gstPaise).toBeLessThan(0);
  });

  it("a partial refund takes back its share of the unused credits only", async () => {
    const o = await orgWithAddon("rz11");
    const r = await startOrder(o, 2); // 200 credits, 46,964 paise
    await handleRazorpayEvent(captured(r.providerOrderId, "pay_R2", 46_964), "evt_p1");
    await handleRazorpayEvent({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_2", payment_id: "pay_R2", amount: 23_482 } } } }, "evt_p2");
    const [g] = await grants(o.tenant.id);
    expect(g!.credits).toBe(100);
    expect((await cdb().select().from(aiPackOrders).where(eq(aiPackOrders.tenantId, o.tenant.id)))[0]!.status).toBe("paid");
  });

  it("subscription payments and unknown orders are ignored by the pack handling", async () => {
    const o = await orgWithAddon("rz12");
    await expect(handleRazorpayEvent(captured("order_NOT_OURS", "pay_Z", 100), "evt_z1")).resolves.toBeUndefined();
    await expect(handleRazorpayEvent({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_z", payment_id: "pay_unknown", amount: 5 } } } }, "evt_z2")).resolves.toBeUndefined();
    expect(await grants(o.tenant.id)).toHaveLength(0);
  });

  it("billing.overview lists the purchase with its invoice number", async () => {
    const o = await orgWithAddon("rz13");
    const r = await startOrder(o, 1);
    expect((await o.ownerC.billing.overview()).ai.purchases[0]).toMatchObject({ status: "created", invoiceNumber: null });
    await handleRazorpayEvent(captured(r.providerOrderId, "pay_V1", 23_482), "evt_v1");
    expect((await o.ownerC.billing.overview()).ai.purchases[0]).toMatchObject({ status: "paid", invoiceNumber: expect.stringMatching(/^FIN-/) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /webhooks/razorpay: signature", () => {
  const app = new Hono();
  registerRazorpayWebhook(app);
  const sign = (body: string, secret = WEBHOOK_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

  beforeEach(() => {
    releaseAi();
    installFakeRazorpay();
  });

  it("rejects a missing or wrong signature and grants nothing; accepts a correct one", async () => {
    const o = await freshOrg("wh1");
    await grantAddon(o.tenant.id, "ai_assistant");
    const r = await o.ownerC.billing.buyAiPack({ packs: 1 });
    if (r.status !== "checkout") throw new Error("expected checkout");
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_H1", order_id: r.providerOrderId, amount: 23_482 } } } });

    expect((await app.request("/webhooks/razorpay", { method: "POST", body })).status).toBe(401);
    expect((await app.request("/webhooks/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": sign(body, "wrong") } })).status).toBe(401);
    expect((await app.request("/webhooks/razorpay", { method: "POST", body: body + " ", headers: { "x-razorpay-signature": sign(body) } })).status).toBe(401);
    expect(await grants(o.tenant.id)).toHaveLength(0);

    const ok = await app.request("/webhooks/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": sign(body), "x-razorpay-event-id": "evt_http_1" } });
    expect(ok.status).toBe(200);
    expect(await grants(o.tenant.id)).toHaveLength(1);
    const again = await app.request("/webhooks/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": sign(body), "x-razorpay-event-id": "evt_http_1" } });
    expect(again.status).toBe(200);
    expect(await grants(o.tenant.id)).toHaveLength(1);
  });

  it("is not configured without a webhook secret", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect((await app.request("/webhooks/razorpay", { method: "POST", body: "{}", headers: { "x-razorpay-signature": "x" } })).status).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("unpaid after the grace period", () => {
  beforeEach(releaseAi);

  async function lapse(tenantId: string, subId: string) {
    await cdb().update(billingSubscriptions).set({ status: "past_due", graceUntil: new Date(Date.now() - 60_000) }).where(eq(billingSubscriptions.id, subId));
    invalidateEntitlements(tenantId);
  }

  it("blocks the assistant with the add-on message; credits stay but are unusable; the chat history stays readable; nothing is deleted", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    const org = await freshOrg("grace1");
    const { ownerC, tenant } = org;
    const aiC = await withBusiness(org);
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await ownerC.billing.buyAiPack({ packs: 1 });
    const [sub] = await liveAi(tenant.id);
    // Within the grace period it still works.
    await cdb().update(billingSubscriptions).set({ status: "past_due", graceUntil: new Date(Date.now() + 86_400_000) }).where(eq(billingSubscriptions.id, sub!.id));
    invalidateEntitlements(tenant.id);
    expect((await getEntitlements(tenant.id)).addons.ai_assistant).toBe(true);

    await lapse(tenant.id, sub!.id);
    const ent = await getEntitlements(tenant.id);
    expect(ent.addons).toMatchObject({ ai_assistant: false, ai_plus: false });
    expect((await aiSubs(tenant.id))[0]!.status).toBe("halted"); // the lazy transition ran
    expect(await loadAiAccount(tenant.id, ent)).toBeNull();
    expect(await aiC.ai.status()).toMatchObject({ access: "addon_required", allowance: null });
    const blocked = await aiC.ai.begin({ message: "how much is outstanding?" }).then(() => null, (e) => e);
    expect(blocked).toMatchObject({ code: "FORBIDDEN" });
    expect(entitlementDataOf(blocked)).toMatchObject({ reason: "addon_required", addon: "ai_assistant" });
    // The saved chats are still readable; the pack credits are still there, untouched.
    await expect(aiC.ai.conversations()).resolves.toEqual([]);
    expect((await grants(tenant.id))[0]).toMatchObject({ credits: 100, used: 0 });
    // Packs cannot be bought while the assistant is off.
    await expect(ownerC.billing.buyAiPack({ packs: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.unstubAllEnvs();
  });

  it("history stays readable once the add-on has lapsed (but never for an organisation that never had it)", async () => {
    const never = await freshOrg("grace2a");
    const neverC = await withBusiness(never);
    const err = await neverC.ai.conversations().then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });

    const org = await freshOrg("grace2b");
    const { ownerC, tenant } = org;
    const aiC = await withBusiness(org);
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    const [sub] = await liveAi(tenant.id);
    await lapse(tenant.id, sub!.id);
    await expect(aiC.ai.conversations()).resolves.toEqual([]);
  });

  it("buying the add-on again retires the halted one and brings the assistant and the saved credits back", async () => {
    const { ownerC, tenant } = await freshOrg("grace3");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await ownerC.billing.buyAiPack({ packs: 1 });
    const [sub] = await liveAi(tenant.id);
    await lapse(tenant.id, sub!.id);
    await getBillingState(tenant.id);
    await ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "monthly" }); // another tier is fine too
    const live = await liveAi(tenant.id);
    expect(live.map((s) => s.addon)).toEqual(["ai_plus"]);
    expect((await aiSubs(tenant.id)).filter((s) => s.addon === "ai_assistant")[0]!.status).toBe("cancelled");
    const account = await loadAiAccount(tenant.id, await getEntitlements(tenant.id));
    expect(account!.allowance).toMatchObject({ limit: 500, creditsRemaining: 100 });
  });

  it("a plan that is read-only turns the add-on off with it (existing rule), credits intact", async () => {
    const { ownerC, tenant } = await freshOrg("grace4");
    await grantAddon(tenant.id, "ai_assistant");
    await ownerC.billing.buyAiPack({ packs: 1 });
    await cdb().insert(billingSubscriptions).values({ tenantId: tenant.id, kind: "plan", plan: "growth", cycle: "monthly", status: "halted", provider: "razorpay", providerSubscriptionId: "sub_PLAN_HALTED", basePaise: 69_900 });
    invalidateEntitlements(tenant.id);
    expect((await getEntitlements(tenant.id)).addons.ai_assistant).toBe(false);
    await expect(ownerC.billing.buyAiPack({ packs: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await grants(tenant.id))[0]!.credits).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("admin: grant an AI add-on free, purchases view, MRR", () => {
  beforeEach(releaseAi);

  it("grants AI Plus free: active, no invoice, no end date; the owner cannot cancel it or buy over it", async () => {
    const { ownerC, tenant } = await freshOrg("grant1");
    await adminC.platform.grantAddon({ tenantId: tenant.id, addon: "ai_plus", reason: "Launch partner, 6 months" });
    const [sub] = await aiSubs(tenant.id);
    expect(sub).toMatchObject({ addon: "ai_plus", status: "active", provider: "admin", basePaise: 0, currentPeriodEnd: null });
    expect((await getEntitlements(tenant.id)).addons).toMatchObject({ ai_plus: true, ai_assistant: true });
    expect(await payments(tenant.id)).toHaveLength(0);
    await expect(ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(ownerC.billing.cancelSubscription({ subscriptionId: sub!.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(ownerC.billing.changeAddon({ addon: "ai_assistant", cycle: "monthly" })).rejects.toMatchObject({ code: "CONFLICT" });
    const ev = await events(tenant.id, "platform.addon_granted");
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0]!.payload)).toContain(admin.id);
    expect(JSON.stringify(ev[0]!.payload)).toContain("Launch partner");
  });

  it("a second tier is refused while one is live; revoking takes the grant back and lets the owner buy", async () => {
    const { ownerC, tenant } = await freshOrg("grant2");
    await adminC.platform.grantAddon({ tenantId: tenant.id, addon: "ai_assistant", reason: "Pilot customer" });
    await expect(adminC.platform.grantAddon({ tenantId: tenant.id, addon: "ai_plus", reason: "Pilot customer" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(adminC.platform.grantAddon({ tenantId: tenant.id, addon: "ai_assistant", reason: "Pilot customer" })).rejects.toMatchObject({ code: "CONFLICT" });
    await adminC.platform.revokeAddon({ tenantId: tenant.id, addon: "ai_assistant" });
    expect(await liveAi(tenant.id)).toHaveLength(0);
    expect((await events(tenant.id, "platform.addon_revoked"))).toHaveLength(1);
    await expect(adminC.platform.revokeAddon({ tenantId: tenant.id, addon: "ai_assistant" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "monthly" })).resolves.toMatchObject({ status: "active" });
  });

  it("a revoke never touches a paid subscription", async () => {
    const { ownerC, tenant } = await freshOrg("grant3");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await expect(adminC.platform.revokeAddon({ tenantId: tenant.id, addon: "ai_assistant" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await liveAi(tenant.id)).toHaveLength(1);
  });

  it("works while the add-on is not on sale (an admin can grant before the release) and only for platform admins", async () => {
    ADDON_FEATURES.ai_assistant.implemented = false;
    ADDON_FEATURES.ai_plus.implemented = false;
    const { ownerC, tenant } = await freshOrg("grant4");
    await expect(ownerC.platform.grantAddon({ tenantId: tenant.id, addon: "ai_assistant", reason: "trying it" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await adminC.platform.grantAddon({ tenantId: tenant.id, addon: "ai_assistant", reason: "Early access pilot" });
    expect((await getEntitlements(tenant.id)).addons.ai_assistant).toBe(true);
    await expect(adminC.platform.grantAddon({ tenantId: "00000000-0000-4000-8000-0000000000aa", addon: "ai_assistant", reason: "no such org" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("granting replaces a half-finished checkout or a halted subscription", async () => {
    const { tenant } = await freshOrg("grant5");
    await cdb().insert(billingSubscriptions).values({ tenantId: tenant.id, kind: "addon", addon: "ai_assistant", cycle: "monthly", status: "halted", provider: "razorpay", providerSubscriptionId: "sub_H_OLD", basePaise: 39_900 });
    await adminC.platform.grantAddon({ tenantId: tenant.id, addon: "ai_assistant", reason: "Goodwill after a failed card" });
    expect((await liveAi(tenant.id)).map((s) => s.provider)).toEqual(["admin"]);
  });

  it("aiPurchases lists purchased credits and invoices next to the add-ons; MRR includes the paid AI add-on and not the free one", async () => {
    const a = await freshOrg("view1");
    await a.ownerC.billing.subscribeAddon({ addon: "ai_plus", cycle: "monthly" });
    await a.ownerC.billing.buyAiPack({ packs: 2 });
    const b = await freshOrg("view2");
    await adminC.platform.grantAddon({ tenantId: b.tenant.id, addon: "ai_assistant", reason: "Free pilot for a month" });

    const view = await adminC.platform.aiPurchases({ tenantId: a.tenant.id });
    expect(view.purchases[0]).toMatchObject({ packs: 2, credits: 200, status: "paid", invoiceNumber: expect.stringMatching(/^FIN-/) });
    expect(view.addons).toEqual([expect.objectContaining({ addon: "ai_plus", status: "active", provider: "demo" })]);
    expect((await adminC.platform.aiCredits({ tenantId: a.tenant.id })).grants[0]).toMatchObject({ source: "purchase", credits: 200 });
    expect((await adminC.platform.aiPurchases({ tenantId: b.tenant.id })).addons).toEqual([expect.objectContaining({ addon: "ai_assistant", provider: "admin" })]);

    const summary = await adminC.platform.billingSummary();
    const plus = summary.mix.find((m) => m.label === "ai_plus");
    expect(plus).toBeDefined();
    expect(plus!.mrrPaise).toBeGreaterThanOrEqual(99_900);
    // A free grant is a live add-on subscription with no price: counted, but it adds no revenue.
    const c = await freshOrg("view3");
    const before = await adminC.platform.billingSummary();
    await adminC.platform.grantAddon({ tenantId: c.tenant.id, addon: "ai_assistant", reason: "Another free pilot" });
    const after = await adminC.platform.billingSummary();
    expect(after.mrrPaise).toBe(before.mrrPaise);
    expect(after.liveCount).toBe(before.liveCount + 1);
    await expect(a.ownerC.platform.aiPurchases({ tenantId: a.tenant.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("audit trail", () => {
  beforeEach(releaseAi);

  it("subscribe, switch, pack purchase and cancel each leave a billing event", async () => {
    const { ownerC, tenant } = await freshOrg("audit");
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await ownerC.billing.changeAddon({ addon: "ai_plus", cycle: "monthly" });
    await ownerC.billing.buyAiPack({ packs: 1 });
    const [live] = await liveAi(tenant.id);
    await ownerC.billing.cancelSubscription({ subscriptionId: live!.id });
    const types = (await cdb().select({ type: billingEvents.type }).from(billingEvents).where(eq(billingEvents.tenantId, tenant.id))).map((e) => e.type);
    for (const t of ["checkout.started", "subscription.activated", "subscription.addon_upgrade_started", "subscription.addon_switched", "ai_pack.order_created", "ai_pack.paid", "subscription.cancel_scheduled"]) {
      expect(types).toContain(t);
    }
    const paid = (await events(tenant.id, "ai_pack.paid"))[0]!;
    expect(paid.payload).toMatchObject({ credits: 100, invoiceNumber: expect.stringMatching(/^FIN-/) });
    const order = (await events(tenant.id, "ai_pack.order_created"))[0]!;
    expect(JSON.stringify(order.payload)).toContain(live!.tenantId === tenant.id ? "actorUserId" : "");
  });

  it("the tenant row is untouched by add-on and pack purchases (no plan change)", async () => {
    const { ownerC, tenant } = await freshOrg("audit2");
    const before = await tenantRow(tenant.id);
    await ownerC.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    await ownerC.billing.buyAiPack({ packs: 1 });
    expect((await tenantRow(tenant.id)).plan).toBe(before.plan);
  });
});
