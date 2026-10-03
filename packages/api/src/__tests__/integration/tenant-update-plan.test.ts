/**
 * tenant.updatePlan: only the owner changes the plan; it works while there is
 * no plan subscription (a trial), never once a plan is bought (that goes
 * through billing), never for a grandfathered organisation, and never to a
 * removed plan id.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { billingSubscriptions, tenants } from "@fintranzact/db";
import { REMOVED_PLAN_IDS } from "@fintranzact/shared";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";

type Plan = "starter" | "growth" | "business";

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

async function setPlan(plan: Plan, grandfathered = false) {
  await getControlDb().update(tenants).set({ plan, accessGrandfathered: grandfathered }).where(eq(tenants.id, tenant.id));
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
  await getControlDb().delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenant.id));
  await setPlan("starter");
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("tenant.updatePlan — who may change the plan", () => {
  it("refuses members and admins who are not the owner", async () => {
    await expect(callerFor(member).tenant.updatePlan({ plan: "growth" })).rejects.toThrow(/Only the organization owner/);
    await expect(callerFor(admin).tenant.updatePlan({ plan: "growth" })).rejects.toThrow(/Only the organization owner/);
    expect(await planOf()).toBe("starter");
  });

  it("refuses someone outside the organisation", async () => {
    await expect(callerFor(outsider).tenant.updatePlan({ plan: "growth" })).rejects.toThrow(/Only the organization owner/);
    expect(await planOf()).toBe("starter");
  });

  it("lets the owner (and a superadmin) switch the plan they are trying", async () => {
    await expect(callerFor(owner).tenant.updatePlan({ plan: "growth" })).resolves.toEqual({ plan: "growth" });
    expect(await planOf()).toBe("growth");
    await setPlan("starter");
    await expect(callerFor(superadmin).tenant.updatePlan({ plan: "business" })).resolves.toEqual({ plan: "business" });
  });
});

describe("tenant.updatePlan — removed plans", () => {
  for (const removed of REMOVED_PLAN_IDS) {
    it(`refuses ${removed} with a message that says it was removed`, async () => {
      await expect(callerFor(owner).tenant.updatePlan({ plan: removed as never })).rejects.toThrow(
        new RegExp(`The ${removed} plan has been removed. Choose Starter, Growth or Business`),
      );
      expect(await planOf()).toBe("starter");
    });
  }

  it("refuses an id that was never a plan", async () => {
    await expect(callerFor(owner).tenant.updatePlan({ plan: "platinum" as never })).rejects.toThrow(/Unknown plan/);
  });
});

describe("tenant.updatePlan — bought and grandfathered organisations", () => {
  it("does not switch the plan of an organisation with a live plan subscription", async () => {
    await setPlan("growth");
    await getControlDb().insert(billingSubscriptions).values({
      tenantId: tenant.id, kind: "plan", plan: "growth", cycle: "monthly", status: "active", basePaise: 69_900,
    });
    await expect(callerFor(owner).tenant.updatePlan({ plan: "starter" })).rejects.toThrow(/Change it from Settings/);
    expect(await planOf()).toBe("growth");
  });

  it("treats keeping the current plan as a no-op that records the choice", async () => {
    await setPlan("growth");
    await expect(callerFor(owner).tenant.updatePlan({ plan: "growth" })).resolves.toEqual({ plan: "growth" });
    expect(await planOf()).toBe("growth");
  });

  it("does not move a grandfathered organisation off Business", async () => {
    await setPlan("business", true);
    await expect(callerFor(owner).tenant.updatePlan({ plan: "starter" })).rejects.toThrow(/permanent full access/);
    expect(await planOf()).toBe("business");
    await expect(callerFor(owner).tenant.updatePlan({ plan: "business" })).resolves.toEqual({ plan: "business" });
  });

  it("does not offer a plan an admin has hidden", async () => {
    const { planSettings } = await import("@fintranzact/db");
    const { invalidatePlanCatalog } = await import("../../lib/plan-catalog.js");
    await getControlDb().insert(planSettings).values({
      plan: "business", name: "Business", tagline: "", monthlyPriceInr: 1499, features: [], highlight: false, visible: false, limits: {},
    });
    invalidatePlanCatalog();
    try {
      await expect(callerFor(owner).tenant.updatePlan({ plan: "business" })).rejects.toThrow(/not on offer/);
    } finally {
      await getControlDb().delete(planSettings).where(eq(planSettings.plan, "business"));
      invalidatePlanCatalog();
    }
  });
});
