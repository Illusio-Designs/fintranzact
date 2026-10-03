/**
 * Platform admin: who gets in, what they see, and how the admin account is
 * seeded from the environment.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { users, tenants } from "@fintranzact/db";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { platformAdminEmails, seedPlatformAdmin } from "../../lib/platform-admin.js";
import { getLimits } from "../../lib/plan-limits.js";
import { listPublicPlans } from "../../lib/public-plans.js";
import { PLAN_DEFAULTS, REMOVED_PLAN_IDS, limitsToStored, type PlanSettings } from "@fintranzact/shared";

const ADMIN_EMAIL = "rishi.platform@fintranzact.com";

let admin: TestUser;
let owner: TestUser;
let tenant: TestTenant;
let business: TestBusiness;
let savedEnv: NodeJS.ProcessEnv;

function callerFor(user: TestUser) {
  return createTestCaller({
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    tenantId: tenant.id,
    businessId: business.id,
  });
}

beforeAll(async () => {
  savedEnv = { ...process.env };
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
  delete process.env.PLATFORM_ADMIN_EMAILS;

  admin = await createUser({ email: ADMIN_EMAIL, name: "Rishi" });
  owner = await createUser({ email: "owner.platform@sharmatraders.in", name: "Asha Sharma" });
  tenant = await createTenant({ name: "Sharma Traders Org" });
  await addMember(tenant.id, owner.id, "owner");
  business = await createBusiness(getTenantTestDb(), owner.id, { name: "Sharma Traders", gstin: "27AABCU9603R1ZM" });
});

afterEach(() => {
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.PLATFORM_ADMIN_PASSWORD;
});

afterAll(async () => {
  process.env = savedEnv;
  await truncateAllTables();
  await closeTestDb();
});

describe("platformAdminEmails", () => {
  it("combines PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_EMAILS, lower-cased and de-duplicated", () => {
    expect(platformAdminEmails({ PLATFORM_ADMIN_EMAIL: " Rishi@Fintranzact.com ", PLATFORM_ADMIN_EMAILS: "ops@x.com, rishi@fintranzact.com" }))
      .toEqual(["rishi@fintranzact.com", "ops@x.com"]);
  });

  it("is empty when nothing is configured, so nobody is an admin by default", () => {
    expect(platformAdminEmails({})).toEqual([]);
  });
});

describe("platform access", () => {
  it("reports admin status to the web app", async () => {
    expect(await callerFor(admin).platform.me()).toEqual({ isPlatformAdmin: true });
    expect(await callerFor(owner).platform.me()).toEqual({ isPlatformAdmin: false });
  });

  it("refuses organisation owners who are not platform admins", async () => {
    await expect(callerFor(owner).platform.tenants({})).rejects.toThrow(/Platform admin access only/);
    await expect(callerFor(owner).platform.overview()).rejects.toThrow(/Platform admin access only/);
  });

  it("refuses the upcoming-features board to anyone but platform admins", async () => {
    const other = callerFor(owner).platform;
    const id = "00000000-0000-4000-8000-000000000000";
    await expect(other.roadmapList()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(other.roadmapCreate({ title: "New feature", category: "Payroll" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(other.roadmapUpdate({ id, status: "done" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(other.roadmapDelete({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(other.roadmapReorder({ ids: [id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a listed email that has not been verified", async () => {
    const squatter = await createUser({ email: "second.admin@fintranzact.com", emailVerified: false });
    process.env.PLATFORM_ADMIN_EMAILS = "second.admin@fintranzact.com";
    await expect(callerFor(squatter).platform.tenants({})).rejects.toThrow(/Platform admin access only/);
  });

  it("refuses everyone when no admin is configured", async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    await expect(callerFor(admin).platform.tenants({})).rejects.toThrow(/Platform admin access only/);
  });
});

describe("what a platform admin sees", () => {
  it("lists organisations with their owner and member count", async () => {
    const result = await callerFor(admin).platform.tenants({ search: "sharma" });
    const row = result.data.find((t) => t.id === tenant.id);
    expect(row).toMatchObject({
      name: "Sharma Traders Org",
      memberCount: 1,
      owner: { name: "Asha Sharma", email: "owner.platform@sharmatraders.in" },
    });
  });

  it("finds an organisation by a member's email", async () => {
    const result = await callerFor(admin).platform.tenants({ search: "owner.platform@" });
    expect(result.data.map((t) => t.id)).toContain(tenant.id);
  });

  it("shows one organisation's members and businesses", async () => {
    const detail = await callerFor(admin).platform.tenant({ id: tenant.id });
    expect(detail.members).toEqual([
      expect.objectContaining({ email: "owner.platform@sharmatraders.in", role: "owner", emailVerified: true }),
    ]);
    expect(detail.businesses).toEqual([
      expect.objectContaining({ name: "Sharma Traders", gstin: "27AABCU9603R1ZM" }),
    ]);
  });

  it("counts organisations and users in the overview", async () => {
    const overview = await callerFor(admin).platform.overview();
    expect(overview.tenants).toBeGreaterThanOrEqual(1);
    expect(overview.users).toBeGreaterThanOrEqual(2);
    expect(overview.tenantsLast30Days).toBeGreaterThanOrEqual(1);
  });
});

describe("plan setup", () => {
  const planOf = async () =>
    (await getControlDb().select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenant.id)))[0]?.plan;

  it("lets the platform admin put an organisation on a plan", async () => {
    expect(await callerFor(admin).platform.setPlan({ tenantId: tenant.id, plan: "business" }))
      .toEqual({ id: tenant.id, plan: "business" });
    expect(await planOf()).toBe("business");
  });

  it("refuses plan changes from anyone else", async () => {
    await expect(callerFor(owner).platform.setPlan({ tenantId: tenant.id, plan: "business" }))
      .rejects.toThrow(/Platform admin access only/);
  });

  it("refuses a removed plan id, with a message that says so", async () => {
    for (const plan of REMOVED_PLAN_IDS) {
      await expect(callerFor(admin).platform.setPlan({ tenantId: tenant.id, plan: plan as never }))
        .rejects.toThrow(/plan has been removed\. Choose Starter, Growth or Business/);
    }
  });

  it("lets an owner switch the plan they are trying, and keep the plan an admin gave them", async () => {
    await callerFor(admin).platform.setPlan({ tenantId: tenant.id, plan: "starter" });
    await callerFor(owner).tenant.updatePlan({ plan: "growth" });
    expect(await planOf()).toBe("growth");
    await callerFor(admin).platform.setPlan({ tenantId: tenant.id, plan: "business" });
    await expect(callerFor(owner).tenant.updatePlan({ plan: "business" })).resolves.toEqual({ plan: "business" });
  });

  it("reports an unknown organisation", async () => {
    await expect(callerFor(admin).platform.setPlan({ tenantId: "00000000-0000-4000-8000-000000000000", plan: "growth" }))
      .rejects.toThrow(/Organisation not found/);
  });
});

describe("editing plans", () => {
  const growthSettings = (): PlanSettings => ({
    name: "Growth",
    tagline: "For growing teams",
    monthlyPriceInr: 799,
    yearlyPriceInr: 7_999,
    features: ["Priority support", "10 businesses"],
    highlight: true,
    visible: true,
    limits: { ...limitsToStored(PLAN_DEFAULTS.growth.limits), maxBusinesses: 10, maxApiKeys: null, eInvoicing: false },
  });

  afterEach(async () => {
    for (const plan of ["starter", "growth", "business"] as const) {
      await callerFor(admin).platform.resetPlan({ plan });
    }
  });

  it("lists the three plans with prices, limits and how many organisations use them", async () => {
    const plans = await callerFor(admin).platform.plans();
    expect(plans.map((p) => p.id)).toEqual(["starter", "growth", "business"]);
    const growth = plans.find((p) => p.id === "growth")!;
    expect(growth).toMatchObject({
      edited: false,
      visible: true,
      highlight: true,
      monthlyPriceInr: 699,
      yearlyPriceInr: 6_990,
      effectiveYearlyPriceInr: 6_990,
      limits: { maxBusinesses: 3, maxTeamMembers: 10, eInvoicing: true },
    });
    expect(plans.find((p) => p.id === "starter")!).toMatchObject({ monthlyPriceInr: 299, yearlyPriceInr: 2_990, limits: { maxBusinesses: 1, maxTeamMembers: 3 } });
    expect(plans.find((p) => p.id === "business")!.limits.maxBusinesses).toBeNull();
    for (const p of plans) expect(p.grandfatheredCount).toBeGreaterThanOrEqual(0);
  });

  it("applies a saved plan, yearly price and feature flags to the pricing page and to the limits the API enforces", async () => {
    const saved = await callerFor(admin).platform.savePlan({ plan: "growth", settings: growthSettings() });
    expect(saved.warnings).toEqual([]);
    expect(saved).toMatchObject({ yearlyPriceInr: 7_999, effectiveYearlyPriceInr: 7_999 });

    const growth = (await listPublicPlans()).find((p) => p.id === "growth")!;
    expect(growth).toMatchObject({ name: "Growth", monthlyPriceInr: 799, yearlyPriceInr: 7_999, price: "₹799", yearlyPrice: "₹7,999", highlight: true });
    expect(growth.features).toEqual(["Priority support", "10 businesses"]);

    const limits = await getLimits("growth");
    expect(limits.maxBusinesses).toBe(10);
    expect(limits.maxApiKeys).toBe(Infinity);
    expect(limits.eInvoicing).toBe(false);
    expect(limits.maxTeamMembers).toBe(PLAN_DEFAULTS.growth.limits.maxTeamMembers);
  });

  it("derives the yearly price (ten months) when none is set", async () => {
    const saved = await callerFor(admin).platform.savePlan({ plan: "growth", settings: { ...growthSettings(), yearlyPriceInr: null } });
    expect(saved).toMatchObject({ yearlyPriceInr: null, effectiveYearlyPriceInr: 7_990 });
  });

  it("accepts a yearly price above 12 months of the monthly price, with a warning", async () => {
    const saved = await callerFor(admin).platform.savePlan({ plan: "growth", settings: { ...growthSettings(), yearlyPriceInr: 9_999 } });
    expect(saved.warnings).toHaveLength(1);
    expect(saved.warnings[0]).toMatch(/more than 12 months/);
    expect(saved.yearlyPriceInr).toBe(9_999);
  });

  it("hides a plan from the pricing page without touching organisations on it", async () => {
    await callerFor(admin).platform.setPlan({ tenantId: tenant.id, plan: "business" });
    await callerFor(admin).platform.savePlan({
      plan: "business",
      settings: { ...growthSettings(), name: "Business", visible: false, limits: limitsToStored(PLAN_DEFAULTS.business.limits) },
    });
    expect((await listPublicPlans()).map((p) => p.id)).not.toContain("business");
    const detail = await callerFor(admin).platform.tenant({ id: tenant.id });
    expect(detail.plan).toBe("business");
    expect(detail.accessGrandfathered).toBe(false);
  });

  it("goes back to the built-in plan on reset", async () => {
    await callerFor(admin).platform.savePlan({ plan: "growth", settings: growthSettings() });
    await callerFor(admin).platform.resetPlan({ plan: "growth" });
    expect((await getLimits("growth")).maxBusinesses).toBe(PLAN_DEFAULTS.growth.limits.maxBusinesses);
    const growth = (await callerFor(admin).platform.plans()).find((p) => p.id === "growth")!;
    expect(growth.edited).toBe(false);
    expect(growth.monthlyPriceInr).toBe(699);
  });

  it("rejects invalid settings (negative prices, bad limits) and refuses non-admins", async () => {
    await expect(
      callerFor(admin).platform.savePlan({ plan: "growth", settings: { ...growthSettings(), name: "" } }),
    ).rejects.toThrow();
    await expect(
      callerFor(admin).platform.savePlan({ plan: "growth", settings: { ...growthSettings(), monthlyPriceInr: -1 } }),
    ).rejects.toThrow();
    await expect(
      callerFor(admin).platform.savePlan({ plan: "growth", settings: { ...growthSettings(), yearlyPriceInr: -1 } }),
    ).rejects.toThrow();
    await expect(
      callerFor(admin).platform.savePlan({
        plan: "growth",
        settings: { ...growthSettings(), limits: { ...growthSettings().limits, maxBusinesses: -1 } },
      }),
    ).rejects.toThrow();
    await expect(
      callerFor(admin).platform.savePlan({ plan: "free" as never, settings: growthSettings() }),
    ).rejects.toThrow(/plan has been removed/);
    await expect(callerFor(owner).platform.savePlan({ plan: "growth", settings: growthSettings() })).rejects.toThrow(
      /Platform admin access only/,
    );
    await expect(callerFor(owner).platform.plans()).rejects.toThrow(/Platform admin access only/);
  });
});

describe("partner programme", () => {
  const application = {
    contactName: "Kiran Desai",
    companyName: "Desai Tax Consultants",
    email: "Kiran@DesaiTax.in",
    phone: "+91 98765 43210",
    city: "Ahmedabad",
    state: "Gujarat",
    website: "desaitax.in",
    partnerType: "accountant" as const,
    clientCount: "11-50" as const,
    message: "We file GST for about 40 small businesses.",
    listPublicly: true,
  };

  it("accepts an application from the public form", async () => {
    expect(await createUnauthenticatedCaller().partner.submitApplication(application)).toEqual({ received: true });
    const list = await callerFor(admin).platform.partners({ status: "pending" });
    expect(list.data[0]).toMatchObject({
      companyName: "Desai Tax Consultants",
      email: "kiran@desaitax.in",
      status: "pending",
      partnerType: "accountant",
    });
    expect(list.counts.pending).toBeGreaterThanOrEqual(1);
  });

  it("refuses a second pending application from the same email", async () => {
    await expect(createUnauthenticatedCaller().partner.submitApplication({ ...application, companyName: "Desai & Co" })).rejects.toThrow(
      /already have an application/,
    );
  });

  it("checks the form", async () => {
    await expect(
      createUnauthenticatedCaller().partner.submitApplication({ ...application, email: "not-an-email" }),
    ).rejects.toThrow();
    await expect(createUnauthenticatedCaller().partner.submitApplication({ ...application, phone: "12" })).rejects.toThrow();
  });

  it("lists only approved partners who agreed, without contact details", async () => {
    expect(await createUnauthenticatedCaller().partner.directory()).toEqual([]);

    const [pending] = (await callerFor(admin).platform.partners({ search: "desai" })).data;
    await callerFor(admin).platform.updatePartner({ id: pending!.id, status: "approved", adminNotes: "Called, good fit" });

    const directory = await createUnauthenticatedCaller().partner.directory();
    expect(directory).toEqual([
      { id: pending!.id, companyName: "Desai Tax Consultants", city: "Ahmedabad", state: "Gujarat", website: "desaitax.in", partnerType: "accountant", badge: "registered" },
    ]);

    await callerFor(admin).platform.updatePartner({ id: pending!.id, listPublicly: false });
    expect(await createUnauthenticatedCaller().partner.directory()).toEqual([]);
  });

  it("records who reviewed an application and filters by status", async () => {
    const approved = await callerFor(admin).platform.partners({ status: "approved" });
    expect(approved.data[0]).toMatchObject({ status: "approved", adminNotes: "Called, good fit", reviewedByUserId: admin.id });
    expect(approved.data[0]?.reviewedAt).toBeTruthy();
    expect((await callerFor(admin).platform.partners({ status: "rejected" })).data).toEqual([]);
  });

  it("keeps applications private from everyone but platform admins", async () => {
    await expect(callerFor(owner).platform.partners({})).rejects.toThrow(/Platform admin access only/);
    await expect(
      callerFor(owner).platform.updatePartner({ id: "00000000-0000-4000-8000-000000000000", status: "approved" }),
    ).rejects.toThrow(/Platform admin access only/);
  });
});

describe("seedPlatformAdmin", () => {
  const db = () => getControlDb();

  it("does nothing without both email and password", async () => {
    expect(await seedPlatformAdmin({ PLATFORM_ADMIN_EMAIL: "new.admin@fintranzact.com" })).toBe("skipped");
  });

  it("creates a verified account with a hashed password", async () => {
    const result = await seedPlatformAdmin({
      PLATFORM_ADMIN_EMAIL: "New.Admin@Fintranzact.com",
      PLATFORM_ADMIN_PASSWORD: "a-long-test-password",
      PLATFORM_ADMIN_NAME: "Ops",
    });
    expect(result).toBe("created");
    const [row] = await db().select().from(users).where(eq(users.email, "new.admin@fintranzact.com"));
    expect(row).toMatchObject({ name: "Ops", emailVerified: true });
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain("a-long-test-password");
  });

  it("leaves an existing account alone", async () => {
    const [before] = await db().select().from(users).where(eq(users.id, admin.id));
    expect(await seedPlatformAdmin({ PLATFORM_ADMIN_EMAIL: ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD: "another-password" })).toBe("exists");
    const [after] = await db().select().from(users).where(eq(users.id, admin.id));
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });

  it("does not verify an address someone else registered first", async () => {
    await createUser({ email: "taken@fintranzact.com", emailVerified: false });
    expect(await seedPlatformAdmin({ PLATFORM_ADMIN_EMAIL: "taken@fintranzact.com", PLATFORM_ADMIN_PASSWORD: "a-long-test-password" }))
      .toBe("exists-unverified");
    const [row] = await db().select().from(users).where(eq(users.email, "taken@fintranzact.com"));
    expect(row?.emailVerified).toBe(false);
  });

  it("refuses a password shorter than 8 characters", async () => {
    expect(await seedPlatformAdmin({ PLATFORM_ADMIN_EMAIL: "short@fintranzact.com", PLATFORM_ADMIN_PASSWORD: "short" })).toBe("skipped");
  });
});

describe("signing in as a platform admin", () => {
  it("lets the seeded admin sign in without belonging to an organisation", async () => {
    process.env.PLATFORM_ADMIN_EMAIL = "signin.admin@fintranzact.com";
    await seedPlatformAdmin({ PLATFORM_ADMIN_EMAIL: "signin.admin@fintranzact.com", PLATFORM_ADMIN_PASSWORD: "a-long-test-password" });
    const result = await createUnauthenticatedCaller().auth.login({
      email: "signin.admin@fintranzact.com",
      password: "a-long-test-password",
    });
    if (result.twoFactorRequired) throw new Error("expected a session, got a two-factor challenge");
    expect(result.user.email).toBe("signin.admin@fintranzact.com");
    expect(result.sessionToken.length).toBeGreaterThan(30);
  });

  it("still refuses an ordinary account with no organisation", async () => {
    await seedPlatformAdmin({ PLATFORM_ADMIN_EMAIL: "no.org@example.in", PLATFORM_ADMIN_PASSWORD: "a-long-test-password" });
    // Created through the seed helper for a known password, but not listed as an admin.
    await expect(
      createUnauthenticatedCaller().auth.login({ email: "no.org@example.in", password: "a-long-test-password" }),
    ).rejects.toThrow(/no organization membership/);
  });
});
