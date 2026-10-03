/**
 * Full Access Trial (roadmap P2) against the real control database:
 *   - sign-up starts a trial (14 days, 30 for an approved partner code, the
 *     length from the admin setting), in the same transaction as the tenant
 *   - one trial per business: email variants and GSTIN, atomic, idempotent,
 *     never revealing who holds a claim, never storing the raw value
 *   - entitlements: Business limits and every add-on (with caps) while it
 *     runs, read-only after, and buying a plan unlocks at once
 *   - admin: extend, custom trial, end now, settings; all audited
 *   - the reminder job: 7 / 2 / 0 days left, once each, catch-up once
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { billingEvents, tenants, tenantMembers, trialClaims, trialReminders, users, systemConfig } from "@fintranzact/db";
import { gstinCheckChar, PLAN_DEFAULTS, TRIAL_ALREADY_USED_MESSAGE } from "@fintranzact/shared";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser } from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { emailService } from "../../lib/email.js";
import { getEntitlements, invalidateEntitlements } from "../../lib/entitlements.js";
import { invalidateTrialSettings } from "../../lib/trial-settings.js";
import { clearGstinClaimLimiter, claimGstinForTenant, hashClaimValue, MAX_GSTIN_CLAIMS_PER_TENANT } from "../../lib/trial-claims.js";
import { runTrialReminders } from "../../lib/trial-reminders.js";
import { enforceDataExport } from "../../lib/plan-limits.js";

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";
const ADMIN_EMAIL = "admin.trial@fintranzact.test";
const DAY = 86_400_000;
const PASSWORD = "a-long-test-password";

let admin: TestUser;
let savedEnv: NodeJS.ProcessEnv;
let seq = 0;

const publicCaller = () => createUnauthenticatedCaller();
const asUser = (u: { id: string; email: string; name?: string | null }, tenantId: string) =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId, businessId: NO_BUSINESS });

async function tenantOf(email: string) {
  const [row] = await getControlDb()
    .select({
      id: tenants.id,
      userId: users.id,
      plan: tenants.plan,
      partnerId: tenants.partnerId,
      trialStartedAt: tenants.trialStartedAt,
      trialEndsAt: tenants.trialEndsAt,
      trialSource: tenants.trialSource,
    })
    .from(tenants)
    .innerJoin(tenantMembers, eq(tenantMembers.tenantId, tenants.id))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(users.email, email));
  return row!;
}

async function register(email: string, extra: { referralCode?: string; plan?: string } = {}) {
  await publicCaller().auth.register({
    name: "Test Owner",
    email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...extra,
  } as Parameters<ReturnType<typeof publicCaller>["auth"]["register"]>[0]);
  return tenantOf(email.trim().toLowerCase());
}

/** A well-formed GSTIN with a correct check digit; n makes it unique. */
function gstin(n: number): string {
  const first14 = `27AAAAA${String(1000 + n).padStart(4, "0")}A1Z`;
  return first14 + gstinCheckChar(first14);
}

async function ownerOrg(overrides: Partial<typeof tenants.$inferInsert> = {}) {
  seq++;
  const owner = await createUser({ email: `owner${seq}.trial@mehtatraders.in`, name: "Anjali Mehta" });
  const tenant = await createTenant({ name: `Org ${seq}`, ...overrides });
  await addMember(tenant.id, owner.id, "owner");
  return { owner, tenant };
}

let adminTenantId = "";
const adminCaller = () => asUser(admin, adminTenantId);

async function eventsOf(tenantId: string, type: string) {
  return getControlDb()
    .select()
    .from(billingEvents)
    .where(and(eq(billingEvents.tenantId, tenantId), eq(billingEvents.type, type)))
    .orderBy(desc(billingEvents.createdAt));
}

beforeAll(async () => {
  savedEnv = { ...process.env };
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.TRIAL_CLAIMS;
  admin = await createUser({ email: ADMIN_EMAIL, name: "Rishi" });
  const adminTenant = await createTenant({ name: "Admin Org" });
  await addMember(adminTenant.id, admin.id, "owner");
  adminTenantId = adminTenant.id;
});

beforeEach(() => {
  clearGstinClaimLimiter();
});

afterAll(async () => {
  process.env = savedEnv;
  await getControlDb().delete(systemConfig);
  invalidateTrialSettings();
  await truncateAllTables();
  await closeTestDb();
});

describe("sign-up starts a trial", () => {
  it("a self sign-up gets 14 days, source signup, started and ending together with the tenant", async () => {
    const t = await register("fresh.owner@mehtatraders.in");
    expect(t.trialSource).toBe("signup");
    expect(t.trialStartedAt).toBeTruthy();
    const days = (t.trialEndsAt!.getTime() - t.trialStartedAt!.getTime()) / DAY;
    expect(days).toBe(14);
    expect(Math.abs(t.trialStartedAt!.getTime() - Date.now())).toBeLessThan(30_000);

    const ent = await getEntitlements(t.id);
    expect(ent).toMatchObject({ state: "trialing", readOnly: false });
    expect(ent.trial).toMatchObject({ active: true, source: "signup", daysLeft: 14, totalDays: 14 });
  });

  it("an approved partner code gives the 30-day partner trial; an unknown code does not", async () => {
    const partnerCaller = adminCaller();
    await publicCaller().partner.submitApplication({
      contactName: "Kiran Desai",
      companyName: "Desai Tax Consultants",
      email: "kiran@desaitax.in",
      phone: "+91 98765 43210",
      city: "Ahmedabad",
      partnerType: "accountant",
    });
    const [application] = (await partnerCaller.platform.partners({})).data;
    vi.spyOn(emailService, "sendPartnerApproved").mockResolvedValue(undefined);
    const approved = await partnerCaller.platform.updatePartner({ id: application!.id, status: "approved" });
    const code = approved.referralCode!;

    const partnered = await register("via.partner@shahtraders.in", { referralCode: code });
    expect(partnered.partnerId).toBe(application!.id);
    expect(partnered.trialSource).toBe("partner");
    expect((partnered.trialEndsAt!.getTime() - partnered.trialStartedAt!.getTime()) / DAY).toBe(30);
    expect((await getEntitlements(partnered.id)).trial).toMatchObject({ source: "partner", totalDays: 30, daysLeft: 30 });

    const unknown = await register("friend.code@shahtraders.in", { referralCode: "FRIEND2026" });
    expect(unknown.trialSource).toBe("signup");
    expect((unknown.trialEndsAt!.getTime() - unknown.trialStartedAt!.getTime()) / DAY).toBe(14);
  });

  it("a pending (not approved) partner is not a partner trial", async () => {
    await publicCaller().partner.submitApplication({
      contactName: "Pending Person",
      companyName: "Pending Co",
      email: "pending@pendingco.in",
      phone: "+91 90000 11111",
      city: "Pune",
      partnerType: "reseller",
    });
    const t = await register("pending.ref@shahtraders.in", { referralCode: "FTZ-NOTAPPROVED" });
    expect(t.trialSource).toBe("signup");
  });

  it("uses the lengths set by the platform admin, applying to sign-ups from then on", async () => {
    const before = await register("before.setting@mehtatraders.in");
    await adminCaller().platform.saveTrialSettings({ days: 21, partnerDays: 45, caps: { aiQuestions: 80, payrollEmployees: 5 } });
    const after = await register("after.setting@mehtatraders.in");
    expect((after.trialEndsAt!.getTime() - after.trialStartedAt!.getTime()) / DAY).toBe(21);
    // running trials keep their dates
    expect((await tenantOf("before.setting@mehtatraders.in")).trialEndsAt).toEqual(before.trialEndsAt);
    // and the caps ride in the entitlements payload
    expect((await getEntitlements(after.id)).trial.caps).toEqual({ aiQuestions: 80, payrollEmployees: 5, storePro: true });
    await adminCaller().platform.saveTrialSettings({ days: 14, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } });
  });
});

describe("one trial per business: email", () => {
  it("stores only a salted hash, never the email", async () => {
    await register("hash.check@mehtatraders.in");
    const rows = await getControlDb().select().from(trialClaims).where(eq(trialClaims.kind, "email"));
    const mine = rows.find((r) => r.valueHash === hashClaimValue("email", "hash.check@mehtatraders.in"));
    expect(mine).toBeTruthy();
    expect(JSON.stringify(rows)).not.toContain("hash.check");
    expect(mine!.valueHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a second sign-up with an alias of the same email gets no trial, read-only, with the clear message", async () => {
    const first = await register("dup.owner@gmail.com");
    expect(first.trialSource).toBe("signup");

    // Same mailbox: Gmail ignores dots and +tags.
    const second = await register("dup.o.wner+shop@gmail.com");
    expect(second.id).not.toBe(first.id);
    expect(second.trialSource).toBe("none");
    expect(second.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());

    const ent = await getEntitlements(second.id);
    expect(ent).toMatchObject({ state: "trial_expired", readOnly: true, reason: "read_only_trial_expired" });
    expect(ent.trial).toMatchObject({ active: false, source: "none" });

    // The status the app reads says why, without naming anybody.
    const status = await asUser({ id: second.userId, email: "dup.o.wner+shop@gmail.com" }, second.id).billing.status();
    expect(status.trialMessage).toBe(TRIAL_ALREADY_USED_MESSAGE);
    expect(JSON.stringify(status)).not.toContain(first.id);
    // and the first organisation is untouched
    expect(await getEntitlements(first.id)).toMatchObject({ state: "trialing" });
  });

  it("sign-up itself never fails: the duplicate still registers and can pick a plan", async () => {
    await register("never.fails@mehtatraders.in");
    const dup = await register("never.fails+two@mehtatraders.in");
    expect(dup.id).toBeTruthy();
    const c = asUser({ id: dup.userId, email: "never.fails+two@mehtatraders.in" }, dup.id);
    // billing is the way out and is allowed while read-only
    await expect(c.billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" })).resolves.toBeTruthy();
    expect(await getEntitlements(dup.id)).toMatchObject({ state: "active", readOnly: false });
  });

  it("TRIAL_CLAIMS=off skips the check (self-hosted, e2e)", async () => {
    process.env.TRIAL_CLAIMS = "off";
    try {
      await register("off.owner@mehtatraders.in");
      const again = await register("off.owner+x@mehtatraders.in");
      expect(again.trialSource).toBe("signup");
    } finally {
      delete process.env.TRIAL_CLAIMS;
    }
  });
});

describe("one trial per business: GSTIN", () => {
  it("the first organisation claims it; saving it again is a no-op", async () => {
    const { tenant } = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    expect(await claimGstinForTenant(tenant.id, gstin(1))).toEqual({ status: "claimed" });
    expect(await claimGstinForTenant(tenant.id, gstin(1).toLowerCase())).toEqual({ status: "claimed" });
    const rows = await getControlDb().select().from(trialClaims).where(eq(trialClaims.tenantId, tenant.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.valueHash).toBe(hashClaimValue("gstin", gstin(1)));
    expect(JSON.stringify(rows)).not.toContain(gstin(1));
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "trialing" });
  });

  it("another organisation using it loses its trial (read-only until a plan is bought), without naming the first", async () => {
    const a = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    const b = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    await claimGstinForTenant(a.tenant.id, gstin(2));
    expect(await claimGstinForTenant(b.tenant.id, gstin(2))).toEqual({ status: "denied" });

    const ent = await getEntitlements(b.tenant.id);
    expect(ent).toMatchObject({ state: "trial_expired", readOnly: true });
    expect(ent.trial.source).toBe("none");
    expect(await getEntitlements(a.tenant.id)).toMatchObject({ state: "trialing" });

    const [event] = await eventsOf(b.tenant.id, "tenant.trial_denied");
    expect(event).toBeTruthy();
    expect(JSON.stringify(event!.payload)).not.toContain(a.tenant.id);
    expect(JSON.stringify(event!.payload)).not.toContain(gstin(2));
  });

  it("a denied organisation that has since bought a plan is not touched again", async () => {
    const a = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    await claimGstinForTenant(a.tenant.id, gstin(3));
    const b = await ownerOrg({ trialSource: "none", trialStartedAt: new Date(), trialEndsAt: new Date() });
    // source "none" never takes part
    expect(await claimGstinForTenant(b.tenant.id, gstin(3))).toMatchObject({ status: "ignored", reason: "not_applicable" });
  });

  it("only a valid GSTIN counts, and only organisations with a self-serve trial take part", async () => {
    const a = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    expect(await claimGstinForTenant(a.tenant.id, "27AAAAA1234A1Z5")).toMatchObject({ status: "ignored", reason: "invalid" });
    expect(await claimGstinForTenant(a.tenant.id, "garbage")).toMatchObject({ status: "ignored", reason: "invalid" });
    expect(await claimGstinForTenant(a.tenant.id, null)).toMatchObject({ status: "ignored", reason: "invalid" });

    const fixture = await ownerOrg(); // no trial source (admin-created / fixture)
    expect(await claimGstinForTenant(fixture.tenant.id, gstin(4))).toMatchObject({ status: "ignored", reason: "not_applicable" });
    const gf = await ownerOrg({ accessGrandfathered: true, trialSource: "signup" });
    expect(await claimGstinForTenant(gf.tenant.id, gstin(4))).toMatchObject({ status: "ignored", reason: "not_applicable" });
    expect(await getControlDb().select().from(trialClaims).where(eq(trialClaims.valueHash, hashClaimValue("gstin", gstin(4))))).toHaveLength(0);
  });

  it("cannot be used to poison numbers: capped per organisation and rate limited", async () => {
    const a = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    for (let i = 0; i < MAX_GSTIN_CLAIMS_PER_TENANT; i++) {
      expect(await claimGstinForTenant(a.tenant.id, gstin(100 + i))).toEqual({ status: "claimed" });
    }
    expect(await claimGstinForTenant(a.tenant.id, gstin(199))).toMatchObject({ status: "ignored", reason: "cap" });

    clearGstinClaimLimiter();
    const b = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await claimGstinForTenant(b.tenant.id, gstin(300 + i));
      if (r.status === "ignored" && r.reason === "rate_limited") limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("two racing organisations cannot both claim the same GSTIN", async () => {
    const a = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    const b = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * DAY) });
    const results = await Promise.all([claimGstinForTenant(a.tenant.id, gstin(7)), claimGstinForTenant(b.tenant.id, gstin(7))]);
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "denied")).toHaveLength(1);
    expect(await getControlDb().select().from(trialClaims).where(eq(trialClaims.valueHash, hashClaimValue("gstin", gstin(7))))).toHaveLength(1);
  });
});

describe("entitlements during and after the trial", () => {
  it("while it runs: Business limits, every add-on, caps in the payload, whatever plan was picked", async () => {
    const { tenant } = await ownerOrg({
      plan: "starter",
      trialSource: "signup",
      trialStartedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 9 * DAY - 1000),
    });
    const ent = await getEntitlements(tenant.id);
    expect(ent).toMatchObject({ state: "trialing", plan: "starter", effectivePlan: "business", readOnly: false });
    expect(ent.limits).toMatchObject({ maxBusinesses: Infinity, maxApiKeys: Infinity, dataExport: true, eInvoicing: true, manufacturing: true, approvals: true });
    expect(ent.limits.maxBusinesses).not.toBe(PLAN_DEFAULTS.starter.limits.maxBusinesses);
    expect(ent.addons).toEqual({ ai_assistant: true, ai_plus: false, payroll: true, store_pro: true });
    expect(ent.trial).toMatchObject({
      active: true,
      daysLeft: 9,
      source: "signup",
      caps: { aiQuestions: 50, payrollEmployees: 10, storePro: true },
    });
    // the existing fields are unchanged
    expect(ent.trialDaysLeft).toBe(9);
  });

  it("after the end with no plan: read-only, add-ons off, plan limits again, and exports still allowed on every plan", async () => {
    const { tenant } = await ownerOrg({
      plan: "starter",
      trialSource: "signup",
      trialStartedAt: new Date(Date.now() - 15 * DAY),
      trialEndsAt: new Date(Date.now() - DAY),
    });
    const ent = await getEntitlements(tenant.id);
    expect(ent).toMatchObject({ state: "trial_expired", readOnly: true, reason: "read_only_trial_expired", effectivePlan: "starter" });
    expect(ent.addons).toEqual({ ai_assistant: false, ai_plus: false, payroll: false, store_pro: false });
    expect(ent.trial).toMatchObject({ active: false, ended: true, caps: null, daysLeft: 0 });
    expect(ent.limits.maxBusinesses).toBe(PLAN_DEFAULTS.starter.limits.maxBusinesses);
    // Starter has no data export, but a read-only organisation keeps it.
    expect(PLAN_DEFAULTS.starter.limits.dataExport).toBe(false);
    expect(ent.limits.dataExport).toBe(true);
    await expect(enforceDataExport(tenant.id)).resolves.toBeUndefined();
  });

  it("buying any plan unlocks at once (no waiting for the 30 second cache)", async () => {
    const { owner, tenant } = await ownerOrg({
      plan: "starter",
      trialSource: "signup",
      trialStartedAt: new Date(Date.now() - 15 * DAY),
      trialEndsAt: new Date(Date.now() - DAY),
    });
    expect((await getEntitlements(tenant.id)).readOnly).toBe(true); // warms the cache
    await asUser(owner, tenant.id).billing.demoCheckout({ plan: "starter", cycle: "monthly", method: "upi" });
    const after = await getEntitlements(tenant.id);
    expect(after).toMatchObject({ state: "active", readOnly: false, reason: null });
    expect(after.trial).toMatchObject({ active: false, caps: null });
  });

  it("a grandfathered organisation has no trial block active, whatever its row says", async () => {
    const { tenant } = await ownerOrg({ plan: "business", accessGrandfathered: true });
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "grandfathered", trial: { active: false, caps: null } });
  });

  it("billing.status carries the trial block additively", async () => {
    const { owner, tenant } = await ownerOrg({
      trialSource: "partner",
      trialStartedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 30 * DAY - 1000),
    });
    const status = await asUser(owner, tenant.id).billing.status();
    expect(status).toMatchObject({
      state: "trialing",
      trialDaysLeft: 30,
      trialMessage: null,
      effectivePlan: "business",
      trial: { active: true, source: "partner", daysLeft: 30, totalDays: 30 },
    });
  });
});

describe("admin controls", () => {
  it("only a platform admin can use them", async () => {
    const { owner, tenant } = await ownerOrg();
    const c = asUser(owner, tenant.id);
    await expect(c.platform.extendTrial({ tenantId: tenant.id, days: 3, reason: "because" })).rejects.toThrow(/Platform admin/);
    await expect(c.platform.saveTrialSettings({ days: 10, partnerDays: 20, caps: { aiQuestions: 1, payrollEmployees: 1 } })).rejects.toThrow(/Platform admin/);
  });

  it("extend adds days to a running trial from its end, audited with reason and actor", async () => {
    const end = new Date(Date.now() + 5 * DAY);
    const { tenant } = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: end });
    const row = await adminCaller().platform.extendTrial({ tenantId: tenant.id, days: 7, reason: "Customer asked for more time" });
    expect(row.trialEndsAt!.getTime()).toBe(end.getTime() + 7 * DAY);
    expect(row.trialSource).toBe("signup");
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "trialing" });
    const [event] = await eventsOf(tenant.id, "tenant.trial_extended");
    expect(event!.payload).toMatchObject({ days: 7, reason: "Customer asked for more time", actorUserId: admin.id });
  });

  it("extend on an ended trial runs from now and unlocks; a none organisation becomes admin-sourced", async () => {
    const { tenant } = await ownerOrg({ trialSource: "none", trialStartedAt: new Date(Date.now() - DAY), trialEndsAt: new Date(Date.now() - DAY) });
    expect((await getEntitlements(tenant.id)).readOnly).toBe(true);
    const row = await adminCaller().platform.extendTrial({ tenantId: tenant.id, days: 10, reason: "Goodwill" });
    expect(row.trialSource).toBe("admin");
    const ent = await getEntitlements(tenant.id);
    expect(ent).toMatchObject({ state: "trialing", readOnly: false });
    expect(ent.trial.daysLeft).toBe(10);
  });

  it("a custom trial starts now for N days, allowed even though a claim exists", async () => {
    const first = await register("custom.first@mehtatraders.in");
    const dup = await register("custom.first+again@mehtatraders.in");
    expect(dup.trialSource).toBe("none");
    expect(first.trialSource).toBe("signup");
    const row = await adminCaller().platform.grantTrial({ tenantId: dup.id, days: 20, reason: "Partner demo" });
    expect(row.trialSource).toBe("admin");
    expect((row.trialEndsAt!.getTime() - row.trialStartedAt!.getTime()) / DAY).toBe(20);
    expect(await getEntitlements(dup.id)).toMatchObject({ state: "trialing", readOnly: false });
    const [event] = await eventsOf(dup.id, "tenant.trial_granted");
    expect(event!.payload).toMatchObject({ days: 20, reason: "Partner demo", actorUserId: admin.id, source: "admin" });
  });

  it("end now makes the organisation read-only at once, audited", async () => {
    const { tenant } = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 8 * DAY) });
    expect((await getEntitlements(tenant.id)).state).toBe("trialing");
    await adminCaller().platform.endTrial({ tenantId: tenant.id, reason: "Abuse" });
    expect(await getEntitlements(tenant.id)).toMatchObject({ state: "trial_expired", readOnly: true });
    const [event] = await eventsOf(tenant.id, "tenant.trial_ended");
    expect(event!.payload).toMatchObject({ reason: "Abuse", actorUserId: admin.id });
    await expect(adminCaller().platform.endTrial({ tenantId: tenant.id, reason: "again" })).rejects.toThrow(/no running trial/);
  });

  it("refuses to trial a grandfathered or already-paying organisation, and needs a reason and 1-365 days", async () => {
    const gf = await ownerOrg({ plan: "business", accessGrandfathered: true });
    await expect(adminCaller().platform.grantTrial({ tenantId: gf.tenant.id, days: 5, reason: "x trial" })).rejects.toThrow(/grandfathered/);
    await expect(adminCaller().platform.extendTrial({ tenantId: gf.tenant.id, days: 5, reason: "x trial" })).rejects.toThrow(/grandfathered/);

    const paid = await ownerOrg({ plan: "growth", trialSource: "signup", trialEndsAt: new Date(Date.now() - DAY) });
    await asUser(paid.owner, paid.tenant.id).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });
    await expect(adminCaller().platform.grantTrial({ tenantId: paid.tenant.id, days: 5, reason: "x trial" })).rejects.toThrow(/paid plan/);

    const { tenant } = await ownerOrg();
    await expect(adminCaller().platform.extendTrial({ tenantId: tenant.id, days: 0, reason: "valid reason" })).rejects.toThrow();
    await expect(adminCaller().platform.extendTrial({ tenantId: tenant.id, days: 366, reason: "valid reason" })).rejects.toThrow();
    await expect(adminCaller().platform.extendTrial({ tenantId: tenant.id, days: 3, reason: "" })).rejects.toThrow();
  });

  it("the organisation list and detail show the trial", async () => {
    const { tenant } = await ownerOrg({ name: "Trial Visible Org", trialSource: "partner", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 12 * DAY - 1000) });
    const list = await adminCaller().platform.tenants({ search: "Trial Visible Org" });
    expect(list.data[0]).toMatchObject({ id: tenant.id, trialSource: "partner", trialDaysLeft: 12 });
    const detail = await adminCaller().platform.tenant({ id: tenant.id });
    expect(detail).toMatchObject({ trialSource: "partner", accessState: "trialing", trial: { active: true, daysLeft: 12, source: "partner" } });
  });

  it("settings: validated, saved, audited and read back; bad values refused", async () => {
    const c = adminCaller();
    expect(await c.platform.trialSettings()).toEqual({ days: 14, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } });
    await expect(c.platform.saveTrialSettings({ days: 0, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } })).rejects.toThrow();
    await expect(c.platform.saveTrialSettings({ days: 91, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } })).rejects.toThrow();
    await expect(c.platform.saveTrialSettings({ days: 14, partnerDays: 30, caps: { aiQuestions: -5, payrollEmployees: 10 } })).rejects.toThrow();
    expect(await c.platform.trialSettings()).toMatchObject({ days: 14 });

    await c.platform.saveTrialSettings({ days: 7, partnerDays: 60, caps: { aiQuestions: 20, payrollEmployees: 2 } });
    expect(await c.platform.trialSettings()).toEqual({ days: 7, partnerDays: 60, caps: { aiQuestions: 20, payrollEmployees: 2 } });
    const keys = await getControlDb().select().from(systemConfig);
    expect(keys.map((k) => k.key)).toEqual(expect.arrayContaining(["trial.days", "trial.partnerDays", "trial.caps"]));
    const events = await getControlDb().select().from(billingEvents).where(eq(billingEvents.type, "platform.trial_settings_changed"));
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.payload).toMatchObject({ to: { days: 7 }, actorUserId: admin.id });
    await c.platform.saveTrialSettings({ days: 14, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } });
  });

  it("a hand-edited bad setting falls back to the default, never breaking sign-up", async () => {
    await getControlDb().insert(systemConfig).values({ key: "trial.days", value: { value: 9999 } }).onConflictDoUpdate({ target: systemConfig.key, set: { value: { value: 9999 } } });
    invalidateTrialSettings();
    const t = await register("bad.setting@mehtatraders.in");
    expect((t.trialEndsAt!.getTime() - t.trialStartedAt!.getTime()) / DAY).toBe(14);
    await getControlDb().update(systemConfig).set({ value: { value: 14 } }).where(eq(systemConfig.key, "trial.days"));
    invalidateTrialSettings();
  });
});

describe("the reminder job", () => {
  const start = new Date("2026-11-01T09:00:00Z");
  const at = (d: number) => new Date(start.getTime() + d * DAY);

  // Organisations from earlier tests have trials too; the job looks at all of them.
  beforeEach(async () => {
    await getControlDb().delete(trialReminders);
    await getControlDb().update(tenants).set({ trialSource: null });
  });

  async function trialOrg(days = 14, over: Partial<typeof tenants.$inferInsert> = {}) {
    const r = await ownerOrg({ plan: "growth", trialSource: "signup", trialStartedAt: start, trialEndsAt: at(days), ...over });
    return r;
  }

  const sender = () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    return { sent, send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) };
  };

  it("sends at 7 days left, 2 days left and the end, once each, to the owner", async () => {
    const { owner, tenant } = await trialOrg();
    const s = sender();

    expect((await runTrialReminders(at(1), s)).sent).toBe(0);
    expect((await runTrialReminders(at(7), s)).sent).toBe(1);
    expect(s.sent.at(-1)).toMatchObject({ to: owner.email });
    expect(s.sent.at(-1)!.subject).toMatch(/7 days left/);
    expect(s.sent.at(-1)!.text).toContain("/settings?tab=billing");

    // running again, or later the same day, never duplicates
    expect((await runTrialReminders(at(7), s)).sent).toBe(0);
    expect((await runTrialReminders(at(8), s)).sent).toBe(0);

    expect((await runTrialReminders(at(12), s)).sent).toBe(1);
    expect(s.sent.at(-1)!.subject).toMatch(/2 days left/);
    expect((await runTrialReminders(at(12.5), s)).sent).toBe(0);

    expect((await runTrialReminders(at(14), s)).sent).toBe(1);
    expect(s.sent.at(-1)!.subject).toMatch(/has ended/);
    expect((await runTrialReminders(at(14.2), s)).sent).toBe(0);
    expect(s.sent).toHaveLength(3);

    const log = await getControlDb().select().from(trialReminders).where(eq(trialReminders.tenantId, tenant.id));
    expect(log.map((r) => `${r.kind}:${r.status}`).sort()).toEqual(["days_0:sent", "days_2:sent", "days_7:sent"]);
  });

  it("two job runs at the same moment send each reminder once", async () => {
    const { tenant } = await trialOrg();
    const s = sender();
    const [a, b] = await Promise.all([runTrialReminders(at(7), s), runTrialReminders(at(7), s)]);
    expect(a.sent + b.sent).toBe(1);
    expect(s.sent).toHaveLength(1);
    expect(await getControlDb().select().from(trialReminders).where(eq(trialReminders.tenantId, tenant.id))).toHaveLength(1);
  });

  it("a late run catches up once: only the latest due reminder is sent, earlier ones are skipped", async () => {
    const { tenant } = await trialOrg();
    const s = sender();
    expect((await runTrialReminders(at(13), s)).sent).toBe(1);
    expect(s.sent[0]!.subject).toMatch(/day/);
    expect(s.sent[0]!.subject).toMatch(/2 days left|1 day left/);
    const log = await getControlDb().select().from(trialReminders).where(eq(trialReminders.tenantId, tenant.id));
    expect(log.map((r) => `${r.kind}:${r.status}`).sort()).toEqual(["days_2:sent", "days_7:skipped"]);
    expect((await runTrialReminders(at(13.5), s)).sent).toBe(0);
  });

  it("a failed send releases the claim, so the next run retries", async () => {
    const { tenant } = await trialOrg();
    const failing = { send: async () => { throw new Error("mail down"); } };
    const r = await runTrialReminders(at(7), failing);
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(await getControlDb().select().from(trialReminders).where(eq(trialReminders.tenantId, tenant.id))).toHaveLength(0);
    const s = sender();
    expect((await runTrialReminders(at(7.5), s)).sent).toBe(1);
  });

  it("never emails paid, grandfathered, suspended or never-granted organisations", async () => {
    const paid = await trialOrg();
    await asUser(paid.owner, paid.tenant.id).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });
    await trialOrg(14, { accessGrandfathered: true });
    await trialOrg(14, { status: "suspended" });
    await trialOrg(14, { trialSource: "none" });
    const s = sender();
    expect((await runTrialReminders(at(7), s)).sent).toBe(0);
    expect(s.sent).toHaveLength(0);
  });

  it("a 30-day partner trial and a 5-day trial follow the same rule (7/2/0 days left, skipping what is past at start)", async () => {
    const long = await trialOrg(30, { trialSource: "partner" });
    const short = await trialOrg(5);
    const s = sender();
    expect((await runTrialReminders(at(10), s)).sent).toBe(0);
    await runTrialReminders(at(3), s); // short: 2 days left
    expect(s.sent.map((m) => m.to)).toEqual([short.owner.email]);
    await runTrialReminders(at(23), s); // long: 7 days left
    expect(s.sent.map((m) => m.to)).toEqual([short.owner.email, long.owner.email]);
    const shortLog = await getControlDb().select().from(trialReminders).where(eq(trialReminders.tenantId, short.tenant.id));
    expect(shortLog.map((r) => r.kind)).toEqual(["days_2"]); // days_7 was before the start: never logged
  });

  it("extending a trial resets the log: reminders already past under the new dates are skipped, later ones still go out", async () => {
    const { owner, tenant } = await trialOrg(14, { trialEndsAt: new Date(Date.now() + 14 * DAY), trialStartedAt: new Date() });
    const s = sender();
    const now = Date.now();
    // 7 days left arrives, is sent
    expect((await runTrialReminders(new Date(now + 7 * DAY), s)).sent).toBe(1);
    // Admin extends by 14 days: old log is cleared; nothing is past under the new end (28 days), so 7 days left will come again at the new moment.
    await adminCaller().platform.extendTrial({ tenantId: tenant.id, days: 14, reason: "More time" });
    expect(await getControlDb().select().from(trialReminders).where(eq(trialReminders.tenantId, tenant.id))).toHaveLength(0);
    expect((await runTrialReminders(new Date(now + 8 * DAY), s)).sent).toBe(0);
    expect((await runTrialReminders(new Date(now + 21 * DAY), s)).sent).toBe(1);
    expect(s.sent.map((m) => m.to)).toEqual([owner.email, owner.email]);
  });
});

describe("misc", () => {
  it("invalidate keeps working after a trial change (no stale cache)", async () => {
    const { tenant } = await ownerOrg({ trialSource: "signup", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 3 * DAY) });
    expect((await getEntitlements(tenant.id)).trial.active).toBe(true);
    await getControlDb().update(tenants).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(tenants.id, tenant.id));
    // no invalidation: the organisation row is always read fresh
    expect((await getEntitlements(tenant.id)).trial).toMatchObject({ active: false, ended: true });
    invalidateEntitlements(tenant.id);
  });
});
