/**
 * tenant.updatePlan: only the owner changes the plan, and a self-serve (free)
 * choice never switches off a paid plan the Fintranzact team set up.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { tenants } from "@fintranzact/db";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";

type Plan ="forever_free" | "free" | "pro" | "business" | "enterprise";

let owner: TestUser;
let superadmin: TestUser;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
let tenant: TestTenant;

function callerFor(user: TestUser) {
  // updatePlan is organisation-level; no business is involved.
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId: tenant.id, businessId: NO_BUSINESS });
}

async function setPlan(plan: Plan) {
  await getControlDb().update(tenants).set({ plan }).where(eq(tenants.id, tenant.id));
}

async function planOf() {
  const [row] = await getControlDb().select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenant.id));
  return row!.plan;
}

beforeAll(async () => {
  owner = await createUser({ email: "owner.plan@guptastores.in", name: "Ravi Gupta" });
  superadmin = await createUser({ email: "super.plan@guptastores.in", name: "Meena Gupta" });
  admin = await createUser({ email: "admin.plan@guptastores.in", name: "Kiran Rao" });
  member = await createUser({ email: "member.plan@guptastores.in", name: "Suresh Iyer" });
  outsider = await createUser({ email: "someone@elsewhere.in", name: "Outsider" });
  tenant = await createTenant({ name: "Gupta Stores Org" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, superadmin.id, "superadmin");
  await addMember(tenant.id, admin.id, "admin");
  await addMember(tenant.id, member.id, "member");
});

beforeEach(async () => {
  await setPlan("free");
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("tenant.updatePlan — who may change the plan", () => {
  it("refuses members and admins who are not the owner", async () => {
    await expect(callerFor(member).tenant.updatePlan({ plan: "forever_free" })).rejects.toThrow(/Only the organization owner/);
    await expect(callerFor(admin).tenant.updatePlan({ plan: "forever_free" })).rejects.toThrow(/Only the organization owner/);
    expect(await planOf()).toBe("free");
  });

  it("refuses someone outside the organisation", async () => {
    await expect(callerFor(outsider).tenant.updatePlan({ plan: "forever_free" })).rejects.toThrow(/Only the organization owner/);
    expect(await planOf()).toBe("free");
  });

  it("lets the owner (and a superadmin) choose a free plan", async () => {
    await expect(callerFor(owner).tenant.updatePlan({ plan: "forever_free" })).resolves.toEqual({ plan: "forever_free" });
    expect(await planOf()).toBe("forever_free");
    await setPlan("free");
    await expect(callerFor(superadmin).tenant.updatePlan({ plan: "forever_free" })).resolves.toEqual({ plan: "forever_free" });
  });
});

describe("tenant.updatePlan — paid plans are never reset", () => {
  for (const paid of ["pro", "business", "enterprise"] as const) {
    it(`does not move a ${paid} organisation to Forever Free`, async () => {
      await setPlan(paid);
      await expect(callerFor(owner).tenant.updatePlan({ plan: "forever_free" })).rejects.toThrow(/managed by the Fintranzact team/);
      expect(await planOf()).toBe(paid);
    });
  }

  it("treats keeping the current paid plan as a no-op", async () => {
    await setPlan("pro");
    await expect(callerFor(owner).tenant.updatePlan({ plan: "pro" })).resolves.toEqual({ plan: "pro" });
    expect(await planOf()).toBe("pro");
  });

  it("still does not let the owner pick a paid plan", async () => {
    await expect(callerFor(owner).tenant.updatePlan({ plan: "business" })).rejects.toThrow(/set up by the Fintranzact team/);
    expect(await planOf()).toBe("free");
  });
});
