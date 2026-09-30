/**
 * Platform admin: who gets in, what they see, and how the admin account is
 * seeded from the environment.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@fintranzact/db";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { platformAdminEmails, seedPlatformAdmin } from "../../lib/platform-admin.js";

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
