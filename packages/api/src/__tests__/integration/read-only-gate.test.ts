/**
 * The server gate, end to end against the real databases (billing P4, part 2):
 * a read-only or suspended organisation is refused writes (and, when
 * suspended, ordinary reads) with 403 + data.entitlement, while reads, PDF and
 * export procedures, auth and the billing recovery path keep working.
 * Never-subscribed organisations (forever_free, plan "business" fixtures) are
 * never refused.
 *
 * Needs the test Postgres (docker compose -f docker-compose.test.yml up -d).
 * The pure decision is also covered without a database in
 * ../entitlement-gate.test.ts and ../entitlement-exempt.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { billingSubscriptions, planSettings, tenants } from "@fintranzact/db";
import { limitsToStored, PLAN_DEFAULTS } from "@fintranzact/shared";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";
import { invalidateEntitlements, requireAddon } from "../../lib/entitlements.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { recordRenewalFailure } from "../../lib/billing/service.js";

const DAY = 86_400_000;
const CHOOSE_A_PLAN = "Choose a plan";

interface Org {
  owner: TestUser;
  tenant: TestTenant;
  business: TestBusiness;
  c: ReturnType<typeof createTestCaller>;
}

let n = 0;
async function org(tenantOverrides: Partial<TestTenant> = {}): Promise<Org> {
  n += 1;
  const owner = await createUser({ email: `gate.owner${n}@mehtatraders.in`, name: "Anjali Mehta" });
  const tenant = await createTenant({ name: `Gate org ${n}`, ...tenantOverrides });
  await addMember(tenant.id, owner.id, "owner");
  const business = await createBusiness(getTenantTestDb(), owner.id, { name: `Gate business ${n}` });
  const c = createTestCaller({ userId: owner.id, email: owner.email, name: owner.name ?? null, tenantId: tenant.id, businessId: business.id });
  return { owner, tenant, business, c };
}

async function planSub(tenantId: string) {
  const [row] = await getControlDb()
    .select()
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.tenantId, tenantId), eq(billingSubscriptions.kind, "plan")));
  return row!;
}

/** Buy Pro (demo), fail a renewal; the caller decides whether grace is over. */
async function pastDueOrg(graceOver: boolean): Promise<Org> {
  const o = await org();
  await o.c.billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" });
  const sub = await planSub(o.tenant.id);
  await recordRenewalFailure(sub, "Card declined");
  await getControlDb()
    .update(billingSubscriptions)
    .set({ graceUntil: new Date(Date.now() + (graceOver ? -1000 : 3 * DAY)) })
    .where(eq(billingSubscriptions.id, sub.id));
  invalidateEntitlements(o.tenant.id);
  return o;
}

async function haltedOrg(): Promise<Org> {
  return pastDueOrg(true);
}

async function setTrial(tenantId: string, endsAt: Date | null) {
  await getControlDb().update(tenants).set({ trialEndsAt: endsAt }).where(eq(tenants.id, tenantId));
  invalidateEntitlements(tenantId);
}

const newParty = (name = "Gate Customer") => ({ type: "customer" as const, name });

/** The rejection of a promise, as the entitlement data the client would see. */
async function refusal(p: Promise<unknown>) {
  const err = await p.then(() => null, (e) => e);
  expect(err, "expected a refusal").not.toBeNull();
  return { err, data: entitlementDataOf(err) };
}

async function expectRefused(p: Promise<unknown>, reason: string) {
  const { err, data } = await refusal(p);
  expect(err.code).toBe("FORBIDDEN");
  expect(data).toMatchObject({ reason, upgradePath: "/settings?tab=billing" });
  return err;
}

beforeAll(async () => {
  const db = getControlDb();
  for (const [plan, price] of [["pro", 699], ["business", 1499]] as const) {
    const base = PLAN_DEFAULTS[plan];
    await db.insert(planSettings).values({
      plan, name: base.name, tagline: base.tagline, monthlyPriceInr: price, features: base.features,
      highlight: false, visible: true, limits: limitsToStored(base.limits),
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

describe("a halted organisation", () => {
  it("is refused creating and editing, with read_only_halted and the Choose a plan message", async () => {
    const { c } = await haltedOrg();
    const err = await expectRefused(c.party.create(newParty()), "read_only_halted");
    expect(err.message).toContain(CHOOSE_A_PLAN);
    await expectRefused(c.item.create({ name: "Blocked item", itemType: "product", itemMode: "simple" } as never), "read_only_halted");
    await expectRefused(c.expense.create({} as never), "read_only_halted");
    await expectRefused(c.invoice.create({} as never), "read_only_halted");
  });

  it("is refused before input validation, so a bad body cannot probe past the gate", async () => {
    const { c } = await haltedOrg();
    await expectRefused(c.invoice.create({ nonsense: true } as never), "read_only_halted");
  });

  it("still reads: lists, reports, search, billing.status, tenant.current", async () => {
    const { c } = await haltedOrg();
    await expect(c.party.list({ page: 1, limit: 10 })).resolves.toBeDefined();
    await expect(c.invoice.list({ page: 1, limit: 10 })).resolves.toBeDefined();
    await expect(c.item.list({ page: 1, limit: 10 })).resolves.toBeDefined();
    await expect(c.reports.daybook({ fromDate: "2025-04-01", toDate: "2025-04-30" } as never)).resolves.toBeDefined();
    await expect(c.tenant.current()).resolves.toBeDefined();
    const status = await c.billing.status();
    expect(status).toMatchObject({ state: "halted", readOnly: true, reason: "read_only_halted", canManageBilling: true, upgradePath: "/settings?tab=billing" });
    expect(status.message).toContain(CHOOSE_A_PLAN);
  });

  it("keeps exports, lookups and revocations open (never refused as read-only)", async () => {
    const { c } = await haltedOrg();
    // These may fail for their own reasons (plan feature, no GST sandbox, missing record), never as read-only.
    for (const call of [
      () => c.business.exportData(),
      () => c.party.lookupGstin({ gstin: "27AABCU9603R1ZM" }),
      () => c.eInvoice.testConnection({} as never),
      () => c.share.revoke({} as never),
      () => c.tenant.revokeInvitation({ invitationId: "00000000-0000-4000-8000-000000000001" }),
      () => c.tenant.removeMember({ userId: "00000000-0000-4000-8000-000000000002" }),
    ]) {
      const err = await call().then(() => null, (e) => e);
      expect(entitlementDataOf(err)?.reason ?? "", "must not be a read-only refusal").not.toMatch(/^read_only/);
    }
  });

  it("keeps auth and billing open", async () => {
    const { c, tenant } = await haltedOrg();
    await expect(c.auth.logout()).resolves.toBeDefined();
    await expect(c.billing.updateBillingDetails({ name: "Mehta Traders", gstin: null, address: null, email: null })).resolves.toEqual({ ok: true });
    await expect(c.billing.overview()).resolves.toMatchObject({ readOnly: true });
    expect(tenant.id).toBeTruthy();
  });

  it("recovers: billing.subscribePlan works while read-only, then writes are open again", async () => {
    const { c } = await haltedOrg();
    await expectRefused(c.party.create(newParty()), "read_only_halted");
    const bought = await c.billing.subscribePlan({ plan: "business", cycle: "monthly" });
    expect(bought.status).toBe("active");
    await expect(c.party.create(newParty("After recovery"))).resolves.toMatchObject({ name: "After recovery" });
    expect(await c.billing.status()).toMatchObject({ state: "active", readOnly: false, reason: null });
  });
});

describe("trials", () => {
  it("an expired trial with no subscription is refused, with read_only_trial_expired", async () => {
    const { c, tenant } = await org();
    await setTrial(tenant.id, new Date(Date.now() - DAY));
    const err = await expectRefused(c.party.create(newParty()), "read_only_trial_expired");
    expect(err.message).toContain("Your trial has ended. Choose a plan");
    await expect(c.party.list({ page: 1, limit: 10 })).resolves.toBeDefined();
  });

  it("a running trial is writable and billing.status shows the days left", async () => {
    const { c, tenant } = await org();
    await setTrial(tenant.id, new Date(Date.now() + 5 * DAY));
    await expect(c.party.create(newParty())).resolves.toBeDefined();
    expect(await c.billing.status()).toMatchObject({ state: "trialing", readOnly: false, trialDaysLeft: 5, reason: null, message: null });
  });

  it("a live subscription beats an expired trial", async () => {
    const { c, tenant } = await org();
    await setTrial(tenant.id, new Date(Date.now() - DAY));
    await c.billing.subscribePlan({ plan: "pro", cycle: "monthly" });
    await expect(c.party.create(newParty())).resolves.toBeDefined();
  });
});

describe("subscriptions", () => {
  it("an ended subscription is refused, with read_only_subscription_ended", async () => {
    const { c, tenant } = await org();
    await c.billing.subscribePlan({ plan: "pro", cycle: "monthly" });
    await getControlDb().update(billingSubscriptions).set({ status: "cancelled", endedAt: new Date() }).where(eq(billingSubscriptions.tenantId, tenant.id));
    invalidateEntitlements(tenant.id);
    await expectRefused(c.party.create(newParty()), "read_only_subscription_ended");
  });

  it("a live active subscription is writable", async () => {
    const { c } = await org();
    await c.billing.subscribePlan({ plan: "pro", cycle: "monthly" });
    await expect(c.party.create(newParty())).resolves.toBeDefined();
  });

  it("past_due inside its grace period is writable", async () => {
    const { c } = await pastDueOrg(false);
    await expect(c.party.create(newParty())).resolves.toBeDefined();
    expect(await c.billing.status()).toMatchObject({ state: "past_due_grace", readOnly: false });
  });

  it("past_due past its grace period is refused", async () => {
    const { c } = await pastDueOrg(true);
    await expectRefused(c.party.create(newParty()), "read_only_halted");
  });
});

describe("never-subscribed organisations", () => {
  it("forever_free and a plan 'business' fixture stay writable", async () => {
    for (const plan of ["forever_free", "business"] as const) {
      const { c } = await org({ plan });
      await expect(c.party.create(newParty(`Free ${plan}`))).resolves.toBeDefined();
      expect(await c.billing.status()).toMatchObject({ state: "free", readOnly: false, reason: null });
    }
  });
});

describe("a suspended organisation", () => {
  it("is refused writes and ordinary reads, with tenant_suspended", async () => {
    const { c } = await org({ status: "suspended" });
    await expectRefused(c.party.create(newParty()), "tenant_suspended");
    await expectRefused(c.party.list({ page: 1, limit: 10 }), "tenant_suspended");
    await expectRefused(c.business.exportData(), "tenant_suspended");
  });

  it("can still load what the client needs to show the suspended state", async () => {
    const { c } = await org({ status: "suspended" });
    await expect(c.tenant.current()).resolves.toBeDefined();
    expect(await c.billing.status()).toMatchObject({ state: "suspended", readOnly: true, reason: "tenant_suspended", canManageBilling: true });
    await expect(c.auth.logout()).resolves.toBeDefined();
  });
});

describe("billing.status", () => {
  it("is open to every member, and says whether the caller can manage billing", async () => {
    const { tenant, business } = await org();
    const seller = await createUser({ email: "gate.seller@mehtatraders.in", name: "Suresh" });
    await addMember(tenant.id, seller.id, "seller");
    const c = createTestCaller({ userId: seller.id, email: seller.email, name: "Suresh", tenantId: tenant.id, businessId: business.id });
    expect(await c.billing.status()).toMatchObject({ readOnly: false, canManageBilling: false });
    await expect(c.billing.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requireAddon", () => {
  it("refuses with addon_required and the add-on name in the message", async () => {
    const { tenant } = await org();
    const { err, data } = await refusal(requireAddon(tenant.id, "ai_assistant" as never));
    expect(err.code).toBe("FORBIDDEN");
    expect(data).toMatchObject({ reason: "addon_required", addon: "ai_assistant", upgradePath: "/settings?tab=billing" });
    expect(err.message).toContain("add-on");
  });
});
