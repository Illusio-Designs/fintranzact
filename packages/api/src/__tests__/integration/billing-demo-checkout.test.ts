/**
 * Plan choice after sign-up and the demo checkout:
 *   - a self sign-up starts with no plan chosen (planSelectedAt null)
 *   - choosing a free plan (even the one it already has) records the choice
 *   - billing.demoCheckout takes a paid plan for the owner, when demo
 *     payments are on; never in production without DEMO_PAYMENTS, never for
 *     other roles, never for a free plan.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { planSettings, tenantMembers, tenants, users } from "@fintranzact/db";
import { limitsToStored, PLAN_DEFAULTS, planCheckoutAmount } from "@fintranzact/shared";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";
const PRO_PRICE_INR = 999;

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
  // Pro is "priced on request" by default; give it a listed price so it can be bought.
  const pro = PLAN_DEFAULTS.pro;
  await getControlDb().insert(planSettings).values({
    plan: "pro",
    name: pro.name,
    tagline: pro.tagline,
    monthlyPriceInr: PRO_PRICE_INR,
    features: pro.features,
    highlight: false,
    visible: true,
    limits: limitsToStored(pro.limits),
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
  it("a new sign-up has not chosen a plan yet", async () => {
    const { user, tenantId } = await signUp("anjali.signup@mehtatraders.in");
    const list = await caller(user, tenantId).tenant.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.tenantPlan).toBe("forever_free");
    expect(list[0]!.planSelectedAt).toBeNull();
  });

  it("choosing the free plan it already has records the choice", async () => {
    const { user, tenantId } = await signUp("anjali.free@mehtatraders.in");
    await expect(caller(user, tenantId).tenant.updatePlan({ plan: "forever_free" })).resolves.toEqual({ plan: "forever_free" });
    const list = await caller(user, tenantId).tenant.list();
    expect(list[0]!.planSelectedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(list[0]!.planSelectedAt!))).toBe(false);
  });

  it("organisations created any other way count as already chosen", async () => {
    const t = await createTenant({ name: "Seeded Org" });
    expect((await tenantRow(t.id)).planSelectedAt).toBeInstanceOf(Date);
  });

  it("billing.config reports demo payments on outside production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.DEMO_PAYMENTS;
    await expect(createUnauthenticatedCaller().billing.config()).resolves.toEqual({ demoPayments: true });
    process.env.NODE_ENV = "production";
    await expect(createUnauthenticatedCaller().billing.config()).resolves.toEqual({ demoPayments: false });
    process.env.DEMO_PAYMENTS = "true";
    await expect(createUnauthenticatedCaller().billing.config()).resolves.toEqual({ demoPayments: true });
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
    const result = await caller(user, tenantId).billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" });

    // ₹999 + 18% GST = ₹1,178.82
    expect(result).toEqual({ paymentId: expect.stringMatching(/^pay_demo_[\w-]{14}$/), plan: "pro", amountPaise: 117_882, cycle: "monthly" });
    const row = await tenantRow(tenantId);
    expect(row.plan).toBe("pro");
    expect(row.planSelectedAt).toBeInstanceOf(Date);
  });

  it("charges twelve months plus GST for a yearly cycle", async () => {
    const result = await caller(owner, tenant.id).billing.demoCheckout({ plan: "pro", cycle: "yearly", method: "card" });
    expect(result.amountPaise).toBe(planCheckoutAmount(PRO_PRICE_INR, "yearly").totalPaise);
    expect(result.amountPaise).toBe(1_414_584);
  });

  it("is FORBIDDEN in production without DEMO_PAYMENTS", async () => {
    const { user, tenantId } = await signUp("anjali.prod@mehtatraders.in");
    process.env.NODE_ENV = "production";
    delete process.env.DEMO_PAYMENTS;
    await expect(caller(user, tenantId).billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const row = await tenantRow(tenantId);
    expect(row.plan).toBe("forever_free");
    expect(row.planSelectedAt).toBeNull();
  });

  it("works in production when DEMO_PAYMENTS=true", async () => {
    const { user, tenantId } = await signUp("anjali.flag@mehtatraders.in");
    process.env.NODE_ENV = "production";
    process.env.DEMO_PAYMENTS = "true";
    await expect(caller(user, tenantId).billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "netbanking" }))
      .resolves.toMatchObject({ plan: "pro" });
  });

  it("is FORBIDDEN for anyone but the owner", async () => {
    for (const user of [admin, member]) {
      await expect(caller(user, tenant.id).billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("is a BAD_REQUEST for a free plan or one priced on request", async () => {
    await expect(caller(owner, tenant.id).billing.demoCheckout({ plan: "forever_free", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller(owner, tenant.id).billing.demoCheckout({ plan: "business", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Hidden plans are not on offer either.
    await expect(caller(owner, tenant.id).billing.demoCheckout({ plan: "enterprise", cycle: "monthly", method: "upi" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
