/**
 * Remaining plan-limit and read-only enforcement against a real database:
 *   - recurringInvoice.runNow is refused once the plan's monthly runs are used
 *   - selfExport.request and GET /api/export honour the plan's dataExport flag,
 *     and a read-only organisation whose plan allows export can still export
 *   - apiKey.create / tenant.create / selfImport.request are refused while read-only
 *   - the public store treats a plan without onlineStore, or a read-only
 *     organisation, as "cannot serve" (storeServesTenant: the server maps that
 *     to a neutral 404 "Store not found")
 *   - an API key of a suspended organisation, or of a plan with no keys, no
 *     longer authenticates (apiKeyUsable via createContext)
 *   - the recurring scheduler skips a read-only organisation: no invoice, no
 *     failed run, and the due date moves past now (no burst on recovery)
 *   - auditTrail hides entries older than the plan's auditRetentionDays
 */

import { describe, it, expect, afterAll } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { PLAN_DEFAULTS, limitsToStored, type PlanId } from "@fintranzact/shared";
import { apiKeys, auditLog, getTenantDb, invoices, planSettings, recurringInvoiceRuns, recurringInvoiceTemplates } from "@fintranzact/db";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, createParty } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { createContext } from "../../context.js";
import { registerExportRoute } from "../../http/exportStream.js";
import { signExportToken } from "../../lib/exportToken.js";
import { getEntitlements } from "../../lib/entitlements.js";
import { enforceBusinessLimit, storeServesTenant } from "../../lib/plan-limits.js";
import { tickTenant, processDueTemplates, skipDueTemplates } from "../../lib/recurring-invoice-scheduler.js";
import { clearEntitlementsCache } from "../../lib/entitlements.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";

const DAY = 86_400_000;
const past = () => new Date(Date.now() - 2 * DAY);

async function org(opts: { plan: PlanId; readOnly?: boolean; status?: "active" | "suspended" }) {
  const owner = await createUser({ name: "Anjali Mehta" });
  const tenant = await createTenant({
    plan: opts.plan,
    status: opts.status ?? "active",
    // A trial that has run out and no subscription: read-only (read_only_trial_expired).
    trialEndsAt: opts.readOnly ? past() : null,
  });
  await addMember(tenant.id, owner.id, "owner");
  const biz = await createBusiness(getTenantTestDb(), owner.id, { name: `Biz ${tenant.slug}` });
  const caller = (businessId?: string) =>
    createTestCaller({ userId: owner.id, email: owner.email, name: owner.name ?? null, tenantId: tenant.id, businessId: businessId ?? biz.id });
  return { owner, tenant, biz, caller };
}

/** An admin edit to Starter: recurringRunsPerMonth capped (plan_settings), catalogue refreshed. */
async function capStarterRuns(runs: number) {
  const base = PLAN_DEFAULTS.starter;
  await getControlDb().insert(planSettings).values({
    plan: "starter",
    name: base.name,
    tagline: base.tagline,
    monthlyPriceInr: base.monthlyPriceInr,
    yearlyPriceInr: base.yearlyPriceInr,
    features: base.features,
    highlight: false,
    visible: true,
    limits: { ...limitsToStored(base.limits), recurringRunsPerMonth: runs },
  }).onConflictDoUpdate({ target: planSettings.plan, set: { limits: { ...limitsToStored(base.limits), recurringRunsPerMonth: runs } } });
  invalidatePlanCatalog();
}

afterAll(async () => {
  await getControlDb().delete(planSettings);
  invalidatePlanCatalog();
  await truncateAllTables();
  await closeTestDb();
});

describe("recurringInvoice.runNow and the monthly allowance", () => {
  it("is refused once the plan's runs this month are used, and counts the scheduler's counter", async () => {
    // Starter has no recurring cap built in; an admin may set one (here 5 a month).
    await capStarterRuns(5);
    const { biz, caller, tenant } = await org({ plan: "starter" });
    const db = getTenantTestDb();
    const party = await createParty(db, biz.id);
    const [tpl] = await db.insert(recurringInvoiceTemplates).values({
      businessId: biz.id, partyId: party.id, name: "Monthly", type: "sale", frequency: "monthly",
      startDate: new Date(), nextRunDate: new Date(Date.now() + 30 * DAY),
      lineItems: [{ itemName: "Fee", quantity: "1", unitPrice: "100.00", taxPercent: "0", discountPercent: "0" }],
      additionalCharges: "0",
    }).returning();
    for (let i = 0; i < 5; i++) {
      await db.insert(recurringInvoiceRuns).values({ templateId: tpl!.id, businessId: biz.id, status: "success" });
    }
    expect((await getEntitlements(tenant.id)).limits.recurringRunsPerMonth).toBe(5);
    await expect(caller().recurringInvoice.runNow({ id: tpl!.id })).rejects.toThrow(/recurring invoice runs? a month/);
  });

  it("still runs on a plan with unlimited runs", async () => {
    const { biz, caller } = await org({ plan: "business" });
    const db = getTenantTestDb();
    const party = await createParty(db, biz.id);
    const [tpl] = await db.insert(recurringInvoiceTemplates).values({
      businessId: biz.id, partyId: party.id, name: "Monthly", type: "sale", frequency: "monthly",
      startDate: new Date(), nextRunDate: new Date(Date.now() + 30 * DAY),
      lineItems: [{ itemName: "Fee", quantity: "1", unitPrice: "100.00", taxPercent: "0", discountPercent: "0" }],
      additionalCharges: "0",
    }).returning();
    await expect(caller().recurringInvoice.runNow({ id: tpl!.id })).resolves.toBeTruthy();
  });
});

describe("the business limit counts one organisation's own businesses", () => {
  it("in a single-database install, another organisation's businesses do not use up the limit", async () => {
    // Starter: 1 business. org() already creates each organisation's first business.
    const a = await org({ plan: "starter" });
    const b = await org({ plan: "starter" });
    await expect(enforceBusinessLimit(a.tenant.id, await getTenantDb(a.tenant.id))).rejects.toThrow(/up to 1 business/);
    await expect(enforceBusinessLimit(b.tenant.id, await getTenantDb(b.tenant.id))).rejects.toThrow(/up to 1 business/);
    // A third organisation with no business of its own may still create its first.
    const owner = await createUser({ name: "Third Owner" });
    const c = await createTenant({ plan: "starter" });
    await addMember(c.id, owner.id, "owner");
    await expect(enforceBusinessLimit(c.id, await getTenantDb(c.id))).resolves.toBeUndefined();
    const caller = createTestCaller({ userId: owner.id, email: owner.email, name: owner.name ?? null, tenantId: c.id, businessId: a.biz.id });
    await expect(caller.business.canCreate()).resolves.toBe(true);
  });
});

describe("data export", () => {
  const app = new Hono();
  registerExportRoute(app);
  const download = (tenantId: string, token: string) => app.request(`/api/export/${tenantId}?token=${encodeURIComponent(token)}`);

  it("is refused by selfExport.request and the export route when the plan's dataExport is false", async () => {
    const { owner, tenant, caller } = await org({ plan: "starter" });
    await expect(caller().selfExport.request({ tenantId: tenant.id })).rejects.toThrow(/Data export is available on paid plans/);
    // A token that predates a downgrade is refused by the route too.
    const { token } = signExportToken(tenant.id, owner.id);
    const res = await download(tenant.id, token);
    expect(res.status).toBe(403);
  });

  it("works for a read-only organisation whose plan allows export", async () => {
    const { owner, tenant, caller } = await org({ plan: "business", readOnly: true });
    expect((await getEntitlements(tenant.id)).readOnly).toBe(true);
    const { token } = await caller().selfExport.request({ tenantId: tenant.id });
    const res = await download(tenant.id, token);
    expect(res.status).toBe(200);
    expect(owner.id).toBeTruthy();
  });
});

describe("writes outside the gated bases are refused while read-only", () => {
  it("apiKey.create", async () => {
    const { caller } = await org({ plan: "business", readOnly: true });
    await expect(caller().apiKey.create({ name: "CI" })).rejects.toThrow(/Your trial has ended/);
  });

  it("apiKey.create on a halted/suspended organisation", async () => {
    const { caller } = await org({ plan: "business", status: "suspended" });
    await expect(caller().apiKey.create({ name: "CI" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("selfImport.request", async () => {
    const { tenant, caller } = await org({ plan: "business", readOnly: true });
    await expect(caller().selfImport.request({ tenantId: tenant.id })).rejects.toThrow(/Your trial has ended/);
  });

  it("tenant.create while the user owns a read-only organisation", async () => {
    const { caller } = await org({ plan: "business", readOnly: true });
    await expect(caller().tenant.create()).rejects.toThrow(/Your trial has ended/);
  });

  it("apiKey.create still works for a writable organisation", async () => {
    const { caller } = await org({ plan: "business" });
    await expect(caller().apiKey.create({ name: "CI" })).resolves.toMatchObject({ name: "CI" });
  });
});

describe("online store availability", () => {
  it("is off for a plan without onlineStore (neutral 404 for buyers), on for paid plans", async () => {
    clearEntitlementsCache();
    expect(await storeServesTenant((await org({ plan: "starter" })).tenant.id)).toBe(false);
    expect(await storeServesTenant((await org({ plan: "business" })).tenant.id)).toBe(true);
  });

  it("is off for a read-only organisation (an order is a write) and a suspended one", async () => {
    expect(await storeServesTenant((await org({ plan: "business", readOnly: true })).tenant.id)).toBe(false);
    expect(await storeServesTenant((await org({ plan: "business", status: "suspended" })).tenant.id)).toBe(false);
  });

  it("store.updateSettings refuses enabling the store on a plan without it, but allows turning it off", async () => {
    const { caller } = await org({ plan: "starter" });
    await expect(caller().store.updateSettings({ storeEnabled: true })).rejects.toThrow(/online store is available on paid plans/);
    await expect(caller().store.updateSettings({ storeEnabled: false })).resolves.toBeTruthy();
  });
});

describe("API keys after a downgrade", () => {
  async function keyFor(tenantId: string, userId: string) {
    const raw = `fintranzact_key_${Math.random().toString(36).slice(2)}test`;
    await getControlDb().insert(apiKeys).values({
      userId, tenantId, keyHash: createHash("sha256").update(raw).digest("hex"), keyPrefix: raw.slice(0, 20), name: "legacy",
    });
    return raw;
  }
  const ctxFor = (raw: string) =>
    createContext({
      req: new Request("http://localhost/api/trpc/x", { headers: { authorization: `Bearer ${raw}` } }),
      resHeaders: new Headers(),
      info: {} as never,
    } as never);

  it("still authenticate on a plan with keys, and in read-only mode (the gate refuses writes)", async () => {
    const { owner, tenant } = await org({ plan: "business", readOnly: true });
    expect((await ctxFor(await keyFor(tenant.id, owner.id))).user?.id).toBe(owner.id);
  });

  it("stop authenticating for a plan with no keys (Starter) and for a suspended organisation", async () => {
    const a = await org({ plan: "starter" });
    expect((await ctxFor(await keyFor(a.tenant.id, a.owner.id))).user).toBeNull();
    const b = await org({ plan: "business", status: "suspended" });
    expect((await ctxFor(await keyFor(b.tenant.id, b.owner.id))).user).toBeNull();
  });
});

describe("audit trail window", () => {
  it("hides entries older than auditRetentionDays (Starter: 30 days) and keeps recent ones", async () => {
    const { owner, biz, caller } = await org({ plan: "starter" });
    const db = getTenantTestDb();
    await db.insert(auditLog).values([
      { businessId: biz.id, userId: owner.id, action: "x.old", entityType: "x", createdAt: new Date(Date.now() - 90 * DAY) },
      { businessId: biz.id, userId: owner.id, action: "x.new", entityType: "x", createdAt: new Date(Date.now() - 2 * DAY) },
    ]);
    const res = await caller().business.auditTrail({ page: 1, limit: 50 });
    expect(res.data.map((e) => e.action)).toEqual(["x.new"]);
  });
});

describe("recurring scheduler and read-only organisations", () => {
  it("skips a read-only organisation: no invoice, no run row, due date moved past now", async () => {
    const { biz, tenant } = await org({ plan: "business", readOnly: true });
    const db = getTenantTestDb();
    const party = await createParty(db, biz.id);
    const threeWeeksAgo = new Date(Date.now() - 21 * DAY);
    const [tpl] = await db.insert(recurringInvoiceTemplates).values({
      businessId: biz.id, partyId: party.id, name: "Weekly", type: "sale", frequency: "weekly",
      startDate: threeWeeksAgo, nextRunDate: threeWeeksAgo,
      lineItems: [{ itemName: "Fee", quantity: "1", unitPrice: "100.00", taxPercent: "0", discountPercent: "0" }],
      additionalCharges: "0",
    }).returning();

    const outcome = await tickTenant(tenant.id, {
      readOnly: async (id) => (await getEntitlements(id)).readOnly,
      runsPerMonth: async () => 5,
      getDb: getTenantDb,
      process: processDueTemplates,
      skip: skipDueTemplates,
    });
    expect(outcome).toBe("skipped");

    expect(await db.select().from(recurringInvoiceRuns).where(eq(recurringInvoiceRuns.templateId, tpl!.id))).toHaveLength(0);
    expect(await db.select().from(invoices).where(eq(invoices.businessId, biz.id))).toHaveLength(0);
    const [after] = await db.select().from(recurringInvoiceTemplates).where(eq(recurringInvoiceTemplates.id, tpl!.id));
    expect(after!.status).toBe("active");
    expect(after!.totalRuns).toBe(0);
    expect(after!.nextRunDate.getTime()).toBeGreaterThan(Date.now());
  });
});
