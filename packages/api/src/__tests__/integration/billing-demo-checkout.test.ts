/**
 * Plan choice after sign-up and the demo checkout:
 *   - a self sign-up starts on Growth with a 14-day trial and no plan confirmed (planSelectedAt null)
 *   - choosing a plan (even the one it already has) records the choice; removed plan ids are refused
 *   - billing.demoCheckout takes a paid plan for the owner, when demo
 *     payments are on; never in production without DEMO_PAYMENTS, never for
 *     other roles, never for a plan that does not exist.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { planSettings, tenantMembers, tenants, users } from "@fintranzact/db";
import { limitsToStored, PLAN_DEFAULTS, TRIAL_DAYS, planCheckoutAmount } from "@fintranzact/shared";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";
import { getEntitlements } from "../../lib/entitlements.js";

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";
const GROWTH_PRICE_INR = 999;

const savedEnv = { NODE_ENV: process.env.NODE_ENV, DEMO_PAYMENTS: process.env.DEMO_PAYMENTS };

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function caller(user: { id: string; email: string; name?: string | null }, tenantId: string) {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId, businessId: NO_BUSINESS });
}

async function tenantRow(tenantId: string) {
  const [row] = await getControlDb()
    .select({ plan: tenants.plan, planSelectedAt: tenants.planSelectedAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return row!;
}

/** Signs up through auth.register and returns the new user and their organisation. */
async function signUp(email: string) {
  await createUnauthenticatedCaller().auth.register({
    email,
    name: "Anjali Mehta",
    password: "SecurePass1!",
    confirmPassword: "SecurePass1!",
  });
  const db = getControlDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const [membership] = await db.select().from(tenantMembers).where(eq(tenantMembers.userId, user!.id));
  return { user: user!, tenantId: membership!.tenantId };
}

beforeAll(async () => {
  // Growth gets a test price (999) so the checkout amounts below are round numbers.
  const growth = PLAN_DEFAULTS.growth;
  await getControlDb().insert(planSettings).values({
    plan: "growth",
    name: growth.name,
    tagline: growth.tagline,
    monthlyPriceInr: GROWTH_PRICE_INR,
    features: growth.features,
    highlight: false,
    visible: true,
    limits: limitsToStored(growth.limits),
  });
  invalidatePlanCatalog();
});

afterEach(() => {
  restoreEnv();
});

afterAll(async () => {
  restoreEnv();
  await getControlDb().delete(planSettings);
  invalidatePlanCatalog();
  await truncateAllTables();
  await closeTestDb();
});

describe("plan choice after sign-up", () => {
  it("a new sign-up starts on Growth with a trial running and no plan confirmed yet", async () => {
    const { user, tenantId } = await signUp("anjali.signup@mehtatraders.in");
    const list = await caller(user, tenantId).tenant.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.tenantPlan).toBe("growth");
    expect(list[0]!.planSelectedAt).toBeNull();
    const [row] = await getControlDb().select({ trial: tenants.trialEndsAt, g: tenants.accessGrandfathered }).from(tenants).where(eq(tenants.id, tenantId));
    expect(row!.g).toBe(false);
    const daysLeft = (row!.trial!.getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(TRIAL_DAYS - 0.01);
    expect(daysLeft).toBeLessThan(TRIAL_DAYS + 0.01);
    expect(await getEntitlements(tenantId)).toMatchObject({ state: "trialing", readOnly: false, plan: "growth", trialDaysLeft: TRIAL_DAYS });
  });

  it("a sign-up that names a plan gets it, confirmed", async () => {
    await createUnauthenticatedCaller().auth.register({
      email: "anjali.starter@mehtatraders.in", name: "Anjali Mehta", password: "SecurePass1!", confirmPassword: "SecurePass1!", plan: "starter",
    });
    const [u] = await getControlDb().select().from(users).where(eq(users.email, "anjali.starter@mehtatraders.in"));
    const [m] = await getControlDb().select().from(tenantMembers).where(eq(tenantMembers.userId, u!.id));
    const row = await tenantRow(m!.tenantId);
    expect(row.plan).toBe("starter");
    expect(row.planSelectedAt).toBeInstanceOf(Date);
  });

  it("an unrecognised plan at sign-up falls back to Growth", async () => {
    await createUnauthenticatedCaller().auth.register({
      email: "anjali.unknown@mehtatraders.in", name: "Anjali Mehta", password: "SecurePass1!", confirmPassword: "SecurePass1!", plan: "platinum",
    });
    const [u] = await getControlDb().select().from(users).where(eq(users.email, "anjali.unknown@mehtatraders.in"));
    const [m] = await getControlDb().select().from(tenantMembers).where(eq(tenantMembers.userId, u!.id));
    expect((await tenantRow(m!.tenantId)).plan).toBe("growth");
  });

  it("a sign-up that names a removed plan is refused, and nothing is created", async () => {
    for (const plan of ["free", "forever_free", "pro", "enterprise"]) {
      const email = `anjali.${plan}@mehtatraders.in`;
      await expect(
        createUnauthenticatedCaller().auth.register({ email, name: "Anjali Mehta", password: "SecurePass1!", confirmPassword: "SecurePass1!", plan }),
      ).rejects.toThrow(/has been removed\. Choose Starter, Growth or Business/);
      expect(await getControlDb().select().from(users).where(eq(users.email, email))).toHaveLength(0);
    }
  });

  it("choosing the plan it already has records the choice", async () => {
    const { user, tenantId } = await signUp("anjali.free@mehtatraders.in");
    await expect(caller(user, tenantId).tenant.updatePlan({ plan: "growth" })).resolves.toEqual({ plan: "growth" });
    const list = await caller(user, tenantId).tenant.list();
    expect(list[0]!.planSelectedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(list[0]!.planSelectedAt!))).toBe(false);
  });

  it("switching to another plan during the trial changes the plan, and a removed plan is refused", async () => {
    const { user, tenantId } = await signUp("anjali.switch@mehtatraders.in");
    await expect(caller(user, tenantId).tenant.updatePlan({ plan: "starter" })).resolves.toEqual({ plan: "starter" });
    expect((await tenantRow(tenantId)).plan).toBe("starter");
    await expect(caller(user, tenantId).tenant.updatePlan({ plan: "free" as never })).rejects.toThrow(/The free plan has been removed/);
    expect((await tenantRow(tenantId)).plan).toBe("starter");
  });

  it("organisations created any other way count as already chosen", async () => {
    const t = await createTenant({ name: "Seeded Org" });
    expect((await tenantRow(t.id)).planSelectedAt).toBeInstanceOf(Date);
  });

  it("billing.config reports demo payments on outside production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.DEMO_PAYMENTS;
    await expect(createUnauthenticatedCaller().billing.config()).resolves.toMatchObject({ demoPayments: true, provider: "demo" });
    process.env.NODE_ENV = "production";
    await expect(createUnauthenticatedCaller().billing.config()).resolves.toMatchObject({ demoPayments: false });
    process.env.DEMO_PAYMENTS = "true";
    await expect(createUnauthenticatedCaller().billing.config()).resolves.toMatchObject({ demoPayments: true });
  });
});

describe("billing.demoCheckout", () => {
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let tenant: TestTenant;

  beforeAll(async () => {
    owner = await createUser({ email: "owner.checkout@mehtatraders.in", name: "Anjali Mehta" });
    admin = await createUser({ email: "admin.checkout@mehtatraders.in", name: "Vikram Shah" });
    member = await createUser({ email: "member.checkout@mehtatraders.in", name: "Pooja Nair" });
    tenant = await createTenant({ name: "Mehta Traders Org" });
    await addMember(tenant.id, owner.id, "owner");
    await addMember(tenant.id, admin.id, "admin");
    await addMember(tenant.id, member.id, "member");
  });

  it("takes a paid plan for the owner and records the choice", async () => {
    const { user, tenantId } = await signUp("anjali.paid@mehtatraders.in");
    const result = await caller(user, tenantId).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });

    // ₹999 + 18% GST = ₹1,178.82
    expect(result).toEqual({ paymentId: expect.stringMatching(/^pay_demo_[\w-]{14}$/), plan: "growth", amountPaise: 117_882, cycle: "monthly" });
    const row = await tenantRow(tenantId);
    expect(row.plan).toBe("growth");
    expect(row.planSelectedAt).toBeInstanceOf(Date);
  });

  it("charges ten months plus GST for a yearly cycle when no yearly price is set (2 months free)", async () => {
    const result = await caller(owner, tenant.id).billing.demoCheckout({ plan: "growth", cycle: "yearly", method: "card" });
    expect(result.amountPaise).toBe(planCheckoutAmount(GROWTH_PRICE_INR, "yearly").totalPaise);
    expect(result.amountPaise).toBe(1_178_820);
  });

  it("is FORBIDDEN in production without DEMO_PAYMENTS", async () => {
    const { user, tenantId } = await signUp("anjali.prod@mehtatraders.in");
    process.env.NODE_ENV = "production";
    delete process.env.DEMO_PAYMENTS;
    await expect(caller(user, tenantId).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const row = await tenantRow(tenantId);
    expect(row.plan).toBe("growth");
    expect(row.planSelectedAt).toBeNull();
  });

  it("works in production when DEMO_PAYMENTS=true", async () => {
    const { user, tenantId } = await signUp("anjali.flag@mehtatraders.in");
    process.env.NODE_ENV = "production";
    process.env.DEMO_PAYMENTS = "true";
    await expect(caller(user, tenantId).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "netbanking" }))
      .resolves.toMatchObject({ plan: "growth" });
  });

  it("is FORBIDDEN for anyone but the owner", async () => {
    for (const user of [admin, member]) {
      await expect(caller(user, tenant.id).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("is a BAD_REQUEST for a removed plan id", async () => {
    for (const plan of ["free", "forever_free", "pro", "enterprise"]) {
      await expect(caller(owner, tenant.id).billing.demoCheckout({ plan: plan as never, cycle: "monthly", method: "upi" }))
        .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/has been removed/) });
    }
  });

  it("is a BAD_REQUEST for a plan hidden from the pricing page or priced on request", async () => {
    await getControlDb().insert(planSettings).values({
      plan: "starter", name: "Starter", tagline: "", monthlyPriceInr: null, features: [], highlight: false, visible: true,
      limits: limitsToStored(PLAN_DEFAULTS.starter.limits),
    });
    invalidatePlanCatalog();
    await expect(caller(owner, tenant.id).billing.demoCheckout({ plan: "starter", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await getControlDb().update(planSettings).set({ monthlyPriceInr: 299, visible: false }).where(eq(planSettings.plan, "starter"));
    invalidatePlanCatalog();
    await expect(caller(owner, tenant.id).billing.demoCheckout({ plan: "starter", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await getControlDb().delete(planSettings).where(eq(planSettings.plan, "starter"));
    invalidatePlanCatalog();
  });

  it("charges the plan's own yearly price when it has one (Starter: ₹2,999 + GST)", async () => {
    const { user, tenantId } = await signUp("anjali.starteryearly@mehtatraders.in");
    const result = await caller(user, tenantId).billing.demoCheckout({ plan: "starter", cycle: "yearly", method: "card" });
    expect(result.amountPaise).toBe(planCheckoutAmount(299, "yearly", 2999).totalPaise);
    expect(result.amountPaise).toBe(353_882);
  });
});
