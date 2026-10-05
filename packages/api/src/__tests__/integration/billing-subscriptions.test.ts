/**
 * Subscription billing (roadmap P3):
 *   - buying a plan creates a subscription + a numbered GST invoice
 *   - add-ons subscribe and conflict within their group (AI tiers)
 *   - upgrades apply now with a proration credit; downgrades wait for the
 *     period end and are applied lazily
 *   - cancel-at-period-end runs out with the period
 *   - a failed renewal starts the grace period; past it the organisation is
 *     read-only (halted), applied lazily with no scheduler
 *   - the Razorpay webhook handler is idempotent per event id
 *   - failed charges never take a GST invoice number
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { billingPayments, billingSubscriptions, planSettings, tenants } from "@fintranzact/db";
import { ADDON_COMING_SOON_MESSAGE, ADDON_FEATURES, ADDON_IDS, limitsToStored, PLAN_DEFAULTS, type AddonId } from "@fintranzact/shared";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";
import { getBillingState, recordRenewalFailure } from "../../lib/billing/service.js";
import { handleRazorpayEvent } from "../../http/razorpayWebhook.js";

/** Mark add-ons as built for one test (the shared flag is the single switch); restored in afterEach. */
const flagBackup = Object.fromEntries(ADDON_IDS.map((id) => [id, ADDON_FEATURES[id].implemented])) as Record<AddonId, boolean>;
function enableAddons(...ids: AddonId[]) {
  for (const id of ids) ADDON_FEATURES[id].implemented = true;
}
afterEach(() => {
  for (const id of ADDON_IDS) ADDON_FEATURES[id].implemented = flagBackup[id];
});

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";
const GROWTH_PRICE_INR = 699;
const BUSINESS_PRICE_INR = 1499;

function caller(user: { id: string; email: string; name?: string | null }, tenantId: string) {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId, businessId: NO_BUSINESS });
}

async function freshOwnerOrg(email: string): Promise<{ owner: TestUser; tenant: TestTenant }> {
  const owner = await createUser({ email, name: "Anjali Mehta" });
  const tenant = await createTenant({ name: "Org of " + email });
  await addMember(tenant.id, owner.id, "owner");
  return { owner, tenant };
}

async function planSubOf(tenantId: string) {
  const [row] = await getControlDb()
    .select()
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.tenantId, tenantId), eq(billingSubscriptions.kind, "plan")))
    .orderBy(desc(billingSubscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

async function paymentsOf(tenantId: string) {
  return getControlDb()
    .select()
    .from(billingPayments)
    .where(eq(billingPayments.tenantId, tenantId))
    .orderBy(desc(billingPayments.createdAt));
}

beforeAll(async () => {
  // Growth and Business get a test price (the built-in ones would also do); yearly is left to derive as ten months.
  const db = getControlDb();
  for (const [plan, price] of [["growth", GROWTH_PRICE_INR], ["business", BUSINESS_PRICE_INR]] as const) {
    const base = PLAN_DEFAULTS[plan];
    await db.insert(planSettings).values({
      plan,
      name: base.name,
      tagline: base.tagline,
      monthlyPriceInr: price,
      features: base.features,
      highlight: false,
      visible: true,
      limits: limitsToStored(base.limits),
    });
  }
  invalidatePlanCatalog();
});

afterAll(async () => {
  await getControlDb().delete(planSettings);
  invalidatePlanCatalog();
  await truncateAllTables();
  await closeTestDb();
});

describe("buying a plan", () => {
  it("creates an active subscription with a period and a numbered GST invoice", async () => {
    const { owner, tenant } = await freshOwnerOrg("buy.plan@mehtatraders.in");
    await caller(owner, tenant.id).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });

    const sub = (await planSubOf(tenant.id))!;
    expect(sub.status).toBe("active");
    expect(sub.plan).toBe("growth");
    expect(sub.provider).toBe("demo");
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());

    const [payment] = await paymentsOf(tenant.id);
    expect(payment!.status).toBe("captured");
    expect(payment!.invoiceSeq).toBeGreaterThan(0);
    // ₹699 + 18% GST
    expect(payment!.totalPaise).toBe(82_482);

    const [row] = await getControlDb().select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenant.id));
    expect(row!.plan).toBe("growth");
  });

  it("the overview shows the subscription, payment and billing details", async () => {
    const { owner, tenant } = await freshOwnerOrg("overview@mehtatraders.in");
    const c = caller(owner, tenant.id);
    await c.billing.demoCheckout({ plan: "growth", cycle: "yearly", method: "card" });
    await c.billing.updateBillingDetails({
      name: "Mehta Traders LLP",
      gstin: "24AAAAA0000A1Z5",
      address: "12 Ring Road, Ahmedabad",
      email: "accounts@mehtatraders.in",
    });

    const overview = await c.billing.overview();
    expect(overview.plan.id).toBe("growth");
    expect(overview.planSubscription).toMatchObject({ plan: "growth", cycle: "yearly", status: "active" });
    expect(overview.readOnly).toBe(false);
    expect(overview.billingDetails.gstin).toBe("24AAAAA0000A1Z5");
    expect(overview.payments[0]).toMatchObject({ status: "captured", invoiceNumber: expect.stringMatching(/^FIN-\d{5}$/) });

    // Later invoices freeze the saved details.
    enableAddons("store_pro");
    await c.billing.subscribeAddon({ addon: "store_pro", cycle: "monthly" });
    const latest = (await paymentsOf(tenant.id))[0]!;
    expect(latest.billingName).toBe("Mehta Traders LLP");
    expect(latest.billingGstin).toBe("24AAAAA0000A1Z5");
  });

  it("subscribePlan buys the first plan (the Billing tab's path)", async () => {
    const { owner, tenant } = await freshOwnerOrg("subscribe.plan@mehtatraders.in");
    const c = caller(owner, tenant.id);
    const res = await c.billing.subscribePlan({ plan: "growth", cycle: "yearly" });
    expect(res.status).toBe("active");

    expect((await planSubOf(tenant.id))!).toMatchObject({ plan: "growth", cycle: "yearly", status: "active" });
    const [row] = await getControlDb().select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenant.id));
    expect(row!.plan).toBe("growth");

    await expect(c.billing.subscribePlan({ plan: "business", cycle: "monthly" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a second plan purchase is refused while one is live", async () => {
    const { owner, tenant } = await freshOwnerOrg("double.buy@mehtatraders.in");
    const c = caller(owner, tenant.id);
    await c.billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });
    await expect(c.billing.demoCheckout({ plan: "business", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("add-ons", () => {
  it("subscribe, and the AI tiers exclude each other", async () => {
    const { owner, tenant } = await freshOwnerOrg("addons@mehtatraders.in");
    const c = caller(owner, tenant.id);
    enableAddons("ai_assistant", "ai_plus", "payroll");

    const res = await c.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" });
    expect(res.status).toBe("active");
    await expect(c.billing.subscribeAddon({ addon: "ai_assistant", cycle: "monthly" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(c.billing.subscribeAddon({ addon: "ai_plus", cycle: "monthly" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    // A different group is fine.
    await expect(c.billing.subscribeAddon({ addon: "payroll", cycle: "yearly" })).resolves.toMatchObject({ status: "active" });

    const overview = await c.billing.overview();
    expect(overview.addonSubscriptions.map((s) => s.addon).sort()).toEqual(["ai_assistant", "payroll"]);
  });
});

describe("plan changes", () => {
  it("an upgrade applies now, credits unused time, and switches the tenant plan", async () => {
    const { owner, tenant } = await freshOwnerOrg("upgrade@mehtatraders.in");
    const c = caller(owner, tenant.id);
    await c.billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });

    const res = await c.billing.changePlan({ plan: "business", cycle: "monthly" });
    expect(res.applied).toBe("now");

    const sub = (await planSubOf(tenant.id))!;
    expect(sub.plan).toBe("business");
    expect(sub.status).toBe("active");

    const payments = await paymentsOf(tenant.id);
    const credit = payments.find((p) => p.status === "credit")!;
    // The whole period is still ahead, so (almost) the full month comes back.
    expect(credit.basePaise).toBeLessThan(0);
    expect(-credit.basePaise).toBeGreaterThan(GROWTH_PRICE_INR * 100 * 0.99);
    // First Business charge = base minus the credit.
    const firstCharge = payments.find((p) => p.status === "captured" && p.description.includes("Business"))!;
    expect(firstCharge.basePaise).toBe(BUSINESS_PRICE_INR * 100 - -credit.basePaise);

    const [row] = await getControlDb().select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenant.id));
    expect(row!.plan).toBe("business");
  });

  it("a downgrade is scheduled and applied lazily once the period is over", async () => {
    const { owner, tenant } = await freshOwnerOrg("downgrade@mehtatraders.in");
    const c = caller(owner, tenant.id);
    await c.billing.demoCheckout({ plan: "business", cycle: "monthly", method: "upi" });

    const res = await c.billing.changePlan({ plan: "growth", cycle: "monthly" });
    expect(res.applied).toBe("at_period_end");
    expect((await planSubOf(tenant.id))!.scheduledPlan).toBe("growth");

    // Wind the period back so it has run out, then read the state.
    const old = (await planSubOf(tenant.id))!;
    await getControlDb()
      .update(billingSubscriptions)
      .set({ currentPeriodStart: new Date(Date.now() - 40 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 86_400_000) })
      .where(eq(billingSubscriptions.id, old.id));

    const state = await getBillingState(tenant.id);
    expect(state.planSubscription!.plan).toBe("growth");
    expect(state.planSubscription!.status).toBe("active");

    const [row] = await getControlDb().select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenant.id));
    expect(row!.plan).toBe("growth");
  });

  it("cancelling runs the subscription out at the period end", async () => {
    const { owner, tenant } = await freshOwnerOrg("cancel@mehtatraders.in");
    const c = caller(owner, tenant.id);
    await c.billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });

    const sub = (await planSubOf(tenant.id))!;
    await c.billing.cancelSubscription({ subscriptionId: sub.id });
    expect((await planSubOf(tenant.id))!.cancelAtPeriodEnd).toBe(true);

    // Still active until the period ends…
    let state = await getBillingState(tenant.id);
    expect(state.planSubscription!.status).toBe("active");

    // …and gone after it.
    await getControlDb()
      .update(billingSubscriptions)
      .set({ currentPeriodEnd: new Date(Date.now() - 1000) })
      .where(eq(billingSubscriptions.id, sub.id));
    state = await getBillingState(tenant.id);
    expect(state.planSubscription).toBeNull();
  });
});

describe("failed renewals and the grace period", () => {
  it("past_due inside grace, halted (read-only) after it — and the failed charge takes no invoice number", async () => {
    const { owner, tenant } = await freshOwnerOrg("grace@mehtatraders.in");
    const c = caller(owner, tenant.id);
    await c.billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });

    const sub = (await planSubOf(tenant.id))!;
    await recordRenewalFailure(sub, "Card declined");

    let state = await getBillingState(tenant.id);
    expect(state.planSubscription!.status).toBe("past_due");
    expect(state.readOnly).toBe(false);
    expect(state.graceUntil).toBeInstanceOf(Date);

    const failed = (await paymentsOf(tenant.id)).find((p) => p.status === "failed")!;
    expect(failed.failureReason).toBe("Card declined");
    expect(failed.invoiceSeq).toBeNull();

    // Grace over → halted on the next read, no scheduler involved.
    await getControlDb()
      .update(billingSubscriptions)
      .set({ graceUntil: new Date(Date.now() - 1000) })
      .where(eq(billingSubscriptions.id, sub.id));
    state = await getBillingState(tenant.id);
    expect(state.planSubscription!.status).toBe("halted");
    expect(state.readOnly).toBe(true);
  });
});

describe("razorpay webhook handler", () => {
  it("activates, renews, fails and cancels by provider subscription id — once per event id", async () => {
    const { owner, tenant } = await freshOwnerOrg("webhook@mehtatraders.in");
    void owner;
    // A checkout that went out to Razorpay: a `created` row awaiting payment.
    const [sub] = await getControlDb()
      .insert(billingSubscriptions)
      .values({
        tenantId: tenant.id,
        kind: "plan",
        plan: "growth",
        cycle: "monthly",
        status: "created",
        provider: "razorpay",
        providerSubscriptionId: "sub_RZPTEST000001",
        basePaise: GROWTH_PRICE_INR * 100,
      })
      .returning();

    const event = (name: string, extra?: object) => ({
      event: name,
      payload: {
        subscription: { entity: { id: "sub_RZPTEST000001" } },
        payment: { entity: { id: "pay_RZPTEST0001", method: "upi", ...extra } },
      },
    });

    await handleRazorpayEvent(event("subscription.activated"), "evt_1");
    expect((await planSubOf(tenant.id))!.status).toBe("active");
    expect((await paymentsOf(tenant.id)).filter((p) => p.status === "captured")).toHaveLength(1);

    // The same delivery again is a no-op (idempotent by event id).
    await handleRazorpayEvent(event("subscription.activated"), "evt_1");
    expect((await paymentsOf(tenant.id)).filter((p) => p.status === "captured")).toHaveLength(1);

    const before = (await planSubOf(tenant.id))!.currentPeriodEnd!;
    await handleRazorpayEvent(event("subscription.charged"), "evt_2");
    const renewed = (await planSubOf(tenant.id))!;
    expect(renewed.currentPeriodEnd!.getTime()).toBeGreaterThan(before.getTime());
    expect((await paymentsOf(tenant.id)).filter((p) => p.status === "captured")).toHaveLength(2);

    await handleRazorpayEvent(event("subscription.pending", { error_description: "UPI mandate paused" }), "evt_3");
    expect((await planSubOf(tenant.id))!.status).toBe("past_due");

    await handleRazorpayEvent(event("subscription.halted"), "evt_4");
    expect((await planSubOf(tenant.id))!.status).toBe("halted");

    await handleRazorpayEvent(event("subscription.cancelled"), "evt_5");
    expect((await planSubOf(tenant.id))!.status).toBe("cancelled");
    expect(sub).toBeTruthy();
  });

  it("an add-on whose feature is not built yet cannot be bought, and nothing is created", async () => {
    const { owner, tenant } = await freshOwnerOrg("addons.soon@mehtatraders.in");
    const c = caller(owner, tenant.id);
    for (const addon of ADDON_IDS) {
      await expect(c.billing.subscribeAddon({ addon, cycle: "monthly" }))
        .rejects.toMatchObject({ code: "BAD_REQUEST", message: ADDON_COMING_SOON_MESSAGE });
    }
    const subs = await getControlDb().select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenant.id));
    expect(subs).toEqual([]);
  });

  it("only the owner reaches the refusal; others stay forbidden", async () => {
    const { tenant } = await freshOwnerOrg("addons.roles@mehtatraders.in");
    const member = await createUser({ email: "addons.member@mehtatraders.in", name: "Member" });
    await addMember(tenant.id, member.id, "admin");
    await expect(caller(member, tenant.id).billing.subscribeAddon({ addon: "payroll", cycle: "monthly" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("billing.config and billing.overview expose per-add-on availability", async () => {
    const { owner, tenant } = await freshOwnerOrg("addons.avail@mehtatraders.in");
    const c = caller(owner, tenant.id);
    const config = await c.billing.config();
    expect(config.addonAvailability).toEqual({ ai_assistant: false, ai_plus: false, payroll: false, store_pro: false });
    const overview = await c.billing.overview();
    expect(overview.addons.map((a) => [a.id, a.available])).toEqual([
      ["ai_assistant", false], ["ai_plus", false], ["payroll", false], ["store_pro", false],
    ]);

    // Flipping the shared flag is the only thing that puts one back on sale.
    enableAddons("payroll");
    expect((await c.billing.config()).addonAvailability.payroll).toBe(true);
    expect((await c.billing.overview()).addons.find((a) => a.id === "payroll")!.available).toBe(true);
    await expect(c.billing.subscribeAddon({ addon: "payroll", cycle: "monthly" })).resolves.toMatchObject({ status: "active" });
    await expect(c.billing.subscribeAddon({ addon: "store_pro", cycle: "monthly" }))
      .rejects.toMatchObject({ message: ADDON_COMING_SOON_MESSAGE });
  });

  it("an add-on already held stays listed and keeps working after it became unavailable", async () => {
    const { owner, tenant } = await freshOwnerOrg("addons.held@mehtatraders.in");
    const c = caller(owner, tenant.id);
    enableAddons("payroll");
    await c.billing.subscribeAddon({ addon: "payroll", cycle: "monthly" });
    ADDON_FEATURES.payroll.implemented = false;
    const overview = await c.billing.overview();
    expect(overview.addonSubscriptions.map((s) => s.addon)).toEqual(["payroll"]);
    expect(overview.addons.find((a) => a.id === "payroll")).toMatchObject({ available: false });
    expect((await c.billing.status()).addons.payroll).toBe(true);
  });
});
