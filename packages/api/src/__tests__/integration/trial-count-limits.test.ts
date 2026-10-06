/**
 * trial-count-limits.test.ts — the plan COUNT limits follow the effective plan
 * during the Full Access Trial, against a real Postgres.
 *
 * Invariants:
 *   1. While a trial runs the organisation is Business-level: an organisation
 *      that picked Starter (maxApiKeys 0) can create and use API keys, add
 *      more businesses and team members than Starter allows, and own more
 *      organisations. Every count limit reads getEntitlements().limits.
 *   2. When the trial ends (trial_ends_at in the past, no subscription) the
 *      plan's OWN limits apply again, with nothing special-cased: a Starter
 *      organisation's keys stop authenticating (as for any plan without API
 *      access) and new keys are refused (read-only).
 *   3. A plan that has API access keeps authenticating keys after the trial;
 *      the read-only gate refuses their writes.
 */

import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { tenants, auditLog } from "@fintranzact/db";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { createContext } from "../../context.js";
import { getEntitlements, invalidateEntitlements } from "../../lib/entitlements.js";
import { enforceApiKeyLimit, enforceBusinessLimit, enforceOrgCreationLimit, enforceTeamMemberLimit } from "../../lib/plan-limits.js";

const DAY = 86_400_000;

async function trialOrg(plan: "starter" | "growth" | "business") {
  const owner = await createUser({ name: "Anjali Mehta" });
  const tenant = await createTenant({ plan, trialStartedAt: new Date(Date.now() - DAY), trialEndsAt: new Date(Date.now() + 10 * DAY), trialSource: "signup" });
  await addMember(tenant.id, owner.id, "owner");
  const biz = await createBusiness(getTenantTestDb(), owner.id, { name: `Biz ${tenant.slug}` });
  const caller = () =>
    createTestCaller({ userId: owner.id, email: owner.email, name: owner.name ?? null, tenantId: tenant.id, businessId: biz.id });
  /** The trial runs out: no subscription, trial_ends_at in the past. */
  const endTrial = async () => {
    await getControlDb().update(tenants).set({ trialEndsAt: new Date(Date.now() - DAY) }).where(eq(tenants.id, tenant.id));
    invalidateEntitlements(tenant.id);
  };
  return { owner, tenant, biz, caller, endTrial };
}

const ctxFor = (raw: string) =>
  createContext({
    req: new Request("http://localhost/api/trpc/x", { headers: { authorization: `Bearer ${raw}` } }),
    resHeaders: new Headers(),
    info: {} as never,
  } as never);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("API keys", () => {
  it("a Starter organisation in its trial can create several keys, and they authenticate", async () => {
    const { owner, tenant, caller } = await trialOrg("starter");
    const ent = await getEntitlements(tenant.id);
    expect(ent).toMatchObject({ state: "trialing", plan: "starter", effectivePlan: "business" });
    expect(ent.limits.maxApiKeys).toBe(Infinity);

    const keys = [];
    for (const name of ["CI", "CLI", "MCP", "Fourth"]) keys.push(await caller().apiKey.create({ name }));
    expect(keys).toHaveLength(4); // beyond even Growth's 3: the trial is Business-level
    const raw = (keys[0] as unknown as { key: string }).key;
    expect(raw).toMatch(/^fintranzact_key_/);
    expect((await ctxFor(raw)).user?.id).toBe(owner.id);
  });

  it("when the trial ends on Starter, the keys stop working and new ones are refused", async () => {
    const { owner, tenant, caller, endTrial } = await trialOrg("starter");
    const created = await caller().apiKey.create({ name: "During trial" });
    const raw = (created as unknown as { key: string }).key;
    expect((await ctxFor(raw)).user?.id).toBe(owner.id);

    await endTrial();
    const ent = await getEntitlements(tenant.id);
    expect(ent).toMatchObject({ state: "trial_expired", readOnly: true, effectivePlan: "starter" });
    expect(ent.limits.maxApiKeys).toBe(0);
    // Same behaviour as for any plan without API access: the key no longer authenticates.
    expect((await ctxFor(raw)).user).toBeNull();
    await expect(caller().apiKey.create({ name: "After" })).rejects.toThrow(/Your trial has ended/);
    // And the plan's own limit (not the trial's) is what the count check reads.
    await expect(enforceApiKeyLimit(tenant.id)).rejects.toThrow(/API access is available on the/);
    // The key row is kept (nothing is deleted), so choosing a plan with API access brings it back.
    await getControlDb().update(tenants).set({ plan: "growth", trialEndsAt: null }).where(eq(tenants.id, tenant.id));
    invalidateEntitlements(tenant.id);
    expect((await ctxFor(raw)).user?.id).toBe(owner.id);
  });

  it("a Growth organisation in its trial is not held to Growth's 3 keys; afterwards the plan's cap of 3 applies", async () => {
    const { owner, tenant, caller, endTrial } = await trialOrg("growth");
    const raws: string[] = [];
    for (let i = 0; i < 4; i++) raws.push(((await caller().apiKey.create({ name: `k${i}` })) as unknown as { key: string }).key);

    await endTrial();
    expect((await getEntitlements(tenant.id)).limits.maxApiKeys).toBe(3);
    // Growth has API access: existing keys keep authenticating (the read-only gate refuses their writes).
    expect((await ctxFor(raws[0]!)).user?.id).toBe(owner.id);
    // Four keys exist, over the plan's cap of 3: the cap applies to creating new ones.
    await expect(enforceApiKeyLimit(tenant.id)).rejects.toThrow(/allows up to 3 API keys/);
  });

  it("a suspended organisation's keys never authenticate, trial or not", async () => {
    const { owner, tenant, caller } = await trialOrg("starter");
    const raw = ((await caller().apiKey.create({ name: "k" })) as unknown as { key: string }).key;
    await getControlDb().update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenant.id));
    invalidateEntitlements(tenant.id);
    expect((await ctxFor(raw)).user).toBeNull();
    expect(owner.id).toBeTruthy();
  });

  it("keys are stored hashed (sanity check for the helper above)", async () => {
    const { caller } = await trialOrg("starter");
    const created = (await caller().apiKey.create({ name: "h" })) as unknown as { key: string };
    expect(createHash("sha256").update(created.key).digest("hex")).toHaveLength(64);
  });
});

describe("the other count limits follow the same rule", () => {
  it("businesses, team members, sessions and audit retention read the Business-level limits during a trial, the plan's own after", async () => {
    const { tenant, endTrial } = await trialOrg("starter");
    const during = (await getEntitlements(tenant.id)).limits;
    expect(during).toMatchObject({
      maxBusinesses: Infinity,
      maxTeamMembers: Infinity,
      maxConcurrentSessions: Infinity,
      maxOwnedOrgs: Infinity,
      maxApiKeys: Infinity,
      auditRetentionDays: null,
    });
    await endTrial();
    expect((await getEntitlements(tenant.id)).limits).toMatchObject({
      maxBusinesses: 1,
      maxTeamMembers: 3,
      maxConcurrentSessions: 3,
      maxOwnedOrgs: 1,
      maxApiKeys: 0,
      auditRetentionDays: 30,
    });
  });

  it("business.canCreate and enforceBusinessLimit allow a second business in the trial (Starter allows one), and not after", async () => {
    const { tenant, caller, endTrial } = await trialOrg("starter");
    expect(await caller().business.canCreate()).toBe(true);
    await expect(enforceBusinessLimit(tenant.id, getTenantTestDb() as never)).resolves.toBeUndefined();
    await endTrial();
    expect(await caller().business.canCreate()).toBe(false);
    await expect(enforceBusinessLimit(tenant.id, getTenantTestDb() as never)).rejects.toThrow(/allows up to 1 business/);
  });

  it("the team member limit is Business-level in the trial", async () => {
    const { tenant, endTrial } = await trialOrg("starter");
    for (let i = 0; i < 4; i++) {
      const u = await createUser({ name: `Member ${i}` });
      await addMember(tenant.id, u.id, "seller");
    }
    // 5 members now (owner + 4), over Starter's 3.
    await expect(enforceTeamMemberLimit(tenant.id)).resolves.toBeUndefined();
    await endTrial();
    await expect(enforceTeamMemberLimit(tenant.id)).rejects.toThrow(/allows up to 3 team members/);
  });

  it("the owned-organisation limit counts a trialing organisation as Business, and the plan's own afterwards", async () => {
    const { owner, caller, endTrial } = await trialOrg("starter");
    expect(await caller().tenant.canCreateOrg()).toBe(true);
    await expect(enforceOrgCreationLimit(owner.id)).resolves.toBeUndefined();
    await endTrial();
    expect(await caller().tenant.canCreateOrg()).toBe(false);
    await expect(enforceOrgCreationLimit(owner.id)).rejects.toThrow(/allows up to 1 organization/);
  });

  it("the audit trail window is unlimited in the trial and 30 days (Starter) afterwards", async () => {
    const { owner, biz, caller, endTrial } = await trialOrg("starter");
    await getTenantTestDb().insert(auditLog).values([
      { businessId: biz.id, userId: owner.id, action: "x.old", entityType: "x", createdAt: new Date(Date.now() - 90 * DAY) },
      { businessId: biz.id, userId: owner.id, action: "x.new", entityType: "x", createdAt: new Date(Date.now() - 2 * DAY) },
    ]);
    const during = await caller().business.auditTrail({ page: 1, limit: 50 });
    expect(during.data.map((e) => e.action).sort()).toEqual(["x.new", "x.old"]);
    await endTrial();
    const after = await caller().business.auditTrail({ page: 1, limit: 50 });
    expect(after.data.map((e) => e.action)).toEqual(["x.new"]);
  });
});
