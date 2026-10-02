/**
 * Entitlements against the real control database (billing P4, part 1):
 *   - a halted organisation is read-only, and can buy its way out through
 *     startCheckout / demoCheckout and through changePlan (no dead end)
 *   - the halted row is retired (cancelled, with an event) so the unique
 *     live-plan index holds, and a late renewal on the retired row cannot
 *     revive it
 *   - the entitlement cache follows every billing change on this server
 *   - platform.setTrial sets, clears and audits a trial; an expired trial is
 *     read-only, a live subscription beats it
 *   - never-subscribed organisations (fixtures, forever_free) stay writable
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { billingEvents, billingSubscriptions, planSettings } from "@fintranzact/db";
import { limitsToStored, PLAN_DEFAULTS } from "@fintranzact/shared";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";
import { assertWritable, getEntitlements, invalidateEntitlements } from "../../lib/entitlements.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { endSubscription, haltSubscription, recordRenewal, recordRenewalFailure } from "../../lib/billing/service.js";

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";
const ADMIN_EMAIL = "admin.entitlements@fintranzact.test";
const DAY = 86_400_000;

let admin: TestUser;
let savedEnv: NodeJS.ProcessEnv;

function caller(user: { id: string; email: string; name?: string | null }, tenantId: string) {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId, businessId: NO_BUSINESS });
}

async function freshOwnerOrg(email: string): Promise<{ owner: TestUser; tenant: TestTenant }> {
  const owner = await createUser({ email, name: "Anjali Mehta" });
  const tenant = await createTenant({ name: "Org of " + email });
  await addMember(tenant.id, owner.id, "owner");
  return { owner, tenant };
}

async function planSubsOf(tenantId: string) {
  return getControlDb()
    .select()
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.tenantId, tenantId), eq(billingSubscriptions.kind, "plan")))
    .orderBy(desc(billingSubscriptions.createdAt));
}

/** Buy Pro (demo), fail a renewal, run grace out: the organisation is halted. */
async function haltedOrg(email: string) {
  const { owner, tenant } = await freshOwnerOrg(email);
  const c = caller(owner, tenant.id);
  await c.billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" });
  const [sub] = await planSubsOf(tenant.id);
  await recordRenewalFailure(sub!, "Card declined");
  await getControlDb()
    .update(billingSubscriptions)
    .set({ graceUntil: new Date(Date.now() - 1000) })
    .where(eq(billingSubscriptions.id, sub!.id));
  // Grace is over, but the flip to halted is applied lazily on the next entitlement read.
  invalidateEntitlements(tenant.id);
  await getEntitlements(tenant.id);
  return { owner, tenant, c, halted: sub! };
}

beforeAll(async () => {
  savedEnv = { ...process.env };
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  admin = await createUser({ email: ADMIN_EMAIL, name: "Rishi" });

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
  process.env = savedEnv;
  await getControlDb().delete(planSettings);
  invalidatePlanCatalog();
  await truncateAllTables();
  await closeTestDb();
});

describe("never-subscribed organisations", () => {
  it("stay writable on forever_free and on a fixture's business plan", async () => {
    for (const plan of ["forever_free", "business"] as const) {
      const tenant = await createTenant({ plan });
      expect(await getEntitlements(tenant.id)).toMatchObject({ state: "free", readOnly: false, plan });
      await expect(assertWritable(tenant.id)).resolves.toBeTruthy();
    }
  });
});

describe("a halted organisation", () => {
  it("is read-only, with the Choose a plan message and reason, without anyone opening the Billing tab", async () => {
    const { tenant } = await haltedOrg("halted.readonly@mehtatraders.in");
    // The row is still past_due; getEntitlements applies the lazy halt itself.
    const ent = await getEntitlements(tenant.id);
    expect(ent).toMatchObject({ state: "halted", readOnly: true, reason: "read_only_halted" });
    const err = await assertWritable(tenant.id).catch((e) => e);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("Choose a plan");
    expect(entitlementDataOf(err)).toMatchObject({ reason: "read_only_halted", upgradePath: "/settings?tab=billing" });
  });

  it("can buy a plan again through startCheckout: the halted row is retired and an event recorded", async () => {
    const { owner, tenant, halted } = await haltedOrg("halted.rebuy@mehtatraders.in");
    expect((await getEntitlements(tenant.id)).readOnly).toBe(true);

    await caller(owner, tenant.id).billing.demoCheckout({ plan: "business", cycle: "monthly", method: "upi" });

    const subs = await planSubsOf(tenant.id);
    const old = subs.find((s) => s.id === halted.id)!;
    expect(old.status).toBe("cancelled");
    expect(old.endedAt).toBeInstanceOf(Date);
    const live = subs.filter((s) => s.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ plan: "business", status: "active" });

    const events = await getControlDb().select().from(billingEvents).where(eq(billingEvents.tenantId, tenant.id));
    expect(events.some((e) => e.type === "subscription.retired" && e.subscriptionId === halted.id)).toBe(true);

    // Entitlements follow immediately (cache invalidated), and writes are open again.
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "active", readOnly: false, plan: "business" });
    await expect(assertWritable(tenant.id)).resolves.toBeTruthy();
  });

  it("can recover with changePlan, even to the same plan", async () => {
    const { tenant, c, halted } = await haltedOrg("halted.change@mehtatraders.in");
    expect((await getEntitlements(tenant.id)).readOnly).toBe(true);

    const result = await c.billing.changePlan({ plan: "pro", cycle: "monthly" });
    expect(result.applied).toBe("now");

    const subs = await planSubsOf(tenant.id);
    expect(subs.find((s) => s.id === halted.id)!.status).toBe("cancelled");
    expect(subs.filter((s) => s.status === "active")).toHaveLength(1);
    expect((await getEntitlements(tenant.id)).readOnly).toBe(false);
    const events = await getControlDb().select().from(billingEvents).where(eq(billingEvents.tenantId, tenant.id));
    expect(events.some((e) => e.type === "subscription.rebought")).toBe(true);
  });

  it("is still refused a second plan while the subscription is live (changePlan is the path)", async () => {
    const { owner, tenant } = await freshOwnerOrg("live.conflict@mehtatraders.in");
    const c = caller(owner, tenant.id);
    await c.billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" });
    await expect(c.billing.demoCheckout({ plan: "business", cycle: "monthly", method: "upi" })).rejects.toThrow(/already has a plan subscription/);
  });

  it("is reactivated by a late renewal on the halted subscription", async () => {
    const { tenant } = await haltedOrg("halted.late@mehtatraders.in");
    await getEntitlements(tenant.id); // applies the halt
    const [halted] = await planSubsOf(tenant.id);
    expect(halted!.status).toBe("halted");

    await recordRenewal(halted!, { providerPaymentId: "pay_late_1" });
    expect((await planSubsOf(tenant.id))[0]!.status).toBe("active");
    expect(await getEntitlements(tenant.id)).toMatchObject({ readOnly: false, state: "active" });
  });

  it("does not revive a retired subscription on a late charge", async () => {
    const { owner, tenant, halted } = await haltedOrg("halted.retired@mehtatraders.in");
    await caller(owner, tenant.id).billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" });
    const retired = (await planSubsOf(tenant.id)).find((s) => s.id === halted.id)!;
    expect(retired.status).toBe("cancelled");

    await recordRenewal(retired, { providerPaymentId: "pay_late_2" });
    const after = (await planSubsOf(tenant.id)).find((s) => s.id === halted.id)!;
    expect(after.status).toBe("cancelled");
    expect((await planSubsOf(tenant.id)).filter((s) => s.status !== "cancelled")).toHaveLength(1);
  });
});

describe("entitlement cache", () => {
  it("follows halt, end and renewal on this server without waiting for the 30s window", async () => {
    const { owner, tenant } = await freshOwnerOrg("cache.follow@mehtatraders.in");
    await caller(owner, tenant.id).billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" });
    const [sub] = await planSubsOf(tenant.id);

    expect((await getEntitlements(tenant.id)).state).toBe("active");

    await haltSubscription(sub!.id);
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "halted", readOnly: true });

    await recordRenewal({ ...sub!, status: "halted" }, {});
    expect((await getEntitlements(tenant.id)).state).toBe("active");

    await endSubscription(sub!.id);
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "ended", readOnly: true, reason: "read_only_subscription_ended" });
  });

  it("follows platform.setPlan", async () => {
    const { tenant } = await freshOwnerOrg("cache.setplan@mehtatraders.in");
    const c = caller(admin, tenant.id);
    // The fixture's default plan is whatever createTenant uses; change to two others and watch the cache follow.
    await c.platform.setPlan({ tenantId: tenant.id, plan: "pro" });
    expect((await getEntitlements(tenant.id)).plan).toBe("pro");
    await c.platform.setPlan({ tenantId: tenant.id, plan: "business" });
    expect((await getEntitlements(tenant.id)).plan).toBe("business");
  });
});

describe("platform.setTrial", () => {
  it("sets a trial (writable, days left), then an expired one is read-only, and null clears it", async () => {
    const { tenant } = await freshOwnerOrg("trial.set@mehtatraders.in");
    const c = caller(admin, tenant.id);

    const endsAt = new Date(Date.now() + 5 * DAY);
    const row = await c.platform.setTrial({ tenantId: tenant.id, endsAt });
    expect(row).toMatchObject({ id: tenant.id });
    expect(row.trialEndsAt?.getTime()).toBe(endsAt.getTime());
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "trialing", readOnly: false, trialDaysLeft: 5 });

    await c.platform.setTrial({ tenantId: tenant.id, endsAt: new Date(Date.now() - DAY) });
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "trial_expired", readOnly: true, reason: "read_only_trial_expired" });
    const err = await assertWritable(tenant.id).catch((e) => e);
    expect(err.message).toContain("Your trial has ended. Choose a plan");

    await c.platform.setTrial({ tenantId: tenant.id, endsAt: null });
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "free", readOnly: false });

    const events = await getControlDb().select().from(billingEvents).where(eq(billingEvents.tenantId, tenant.id));
    expect(events.filter((e) => e.type === "tenant.trial_set")).toHaveLength(3);
  });

  it("a live subscription beats an expired trial", async () => {
    const { owner, tenant } = await freshOwnerOrg("trial.beaten@mehtatraders.in");
    await caller(admin, tenant.id).platform.setTrial({ tenantId: tenant.id, endsAt: new Date(Date.now() - DAY) });
    expect((await getEntitlements(tenant.id)).readOnly).toBe(true);
    await caller(owner, tenant.id).billing.demoCheckout({ plan: "pro", cycle: "monthly", method: "upi" });
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "active", readOnly: false });
  });

  it("is for platform admins only and reports an unknown organisation", async () => {
    const { owner, tenant } = await freshOwnerOrg("trial.forbidden@mehtatraders.in");
    await expect(caller(owner, tenant.id).platform.setTrial({ tenantId: tenant.id, endsAt: null })).rejects.toThrow(/Platform admin access only/);
    await expect(
      caller(admin, tenant.id).platform.setTrial({ tenantId: "00000000-0000-4000-8000-000000000000", endsAt: null }),
    ).rejects.toThrow(/Organisation not found/);
  });
});
