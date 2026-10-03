/**
 * hsn-refresh.test.ts — the daily HSN / SAC refresh against the real databases,
 * with Sandbox mocked, and the resolver's "refreshed" layer on top of it.
 *
 * Needs the test database (see item.test.ts); written for CI. Sandbox is never
 * contacted: global fetch is stubbed and the keys are obvious fakes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { controlDb, hsnSandboxCodes, systemConfig, billingEvents } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, createItem, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { resetSandboxClientForTests } from "../../lib/sandbox/client.js";
import { resetHsnLookupForTests } from "../../lib/hsn-lookup.js";
import { refreshHsnCodes, getHsnRefreshState } from "../../lib/hsn-refresh.js";

let business: TestBusiness;
let caller: ReturnType<typeof createTestCaller>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const requested: string[] = [];
let route: (code: string) => Response | Promise<Response>;

function stubSandbox() {
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "fake-token" } });
    const code = decodeURIComponent(u.split("/").pop() ?? "");
    requested.push(code);
    return route(code);
  });
}

function configureSandbox() {
  process.env.GOV_API_PROVIDER = "sandbox";
  process.env.SANDBOX_API_KEY = "key_test_FAKE_FOR_TESTS";
  process.env.SANDBOX_API_SECRET = "fake-secret-for-tests";
  resetSandboxClientForTests();
  resetHsnLookupForTests();
}

beforeAll(async () => {
  const user = await createUser({ email: "owner.hsnrefresh@acmetrading.in", name: "Owner" });
  const tenant = await createTenant({ name: "HSN Refresh Co" });
  await addMember(tenant.id, user.id, "owner");
  business = await createBusiness(getTenantTestDb(), user.id, { name: "HSN Refresh Co", gstin: "27AABCA3333R1ZM", city: "Mumbai", state: "Maharashtra", stateCode: "27" });
  caller = createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId: tenant.id, businessId: business.id });
  const db = getTenantTestDb();
  await createItem(db, business.id, { name: "A1", hsn: "30041010" });
  await createItem(db, business.id, { name: "A2", hsn: "30041010" });
  await createItem(db, business.id, { name: "B", hsn: "5208" });
  await createItem(db, business.id, { name: "No code", hsn: null });
});

afterAll(async () => {
  await controlDb.delete(systemConfig).where(eq(systemConfig.key, "hsn_refresh"));
  await truncateAllTables();
  await closeTestDb();
});

beforeEach(async () => {
  requested.length = 0;
  route = (code) => json({ code: 200, data: { code, description: `Sandbox ${code}`, gst_rate: 12 } });
  await controlDb.delete(hsnSandboxCodes);
  await controlDb.delete(systemConfig).where(eq(systemConfig.key, "hsn_refresh"));
  await controlDb.delete(billingEvents).where(eq(billingEvents.type, "sandbox.hsn_withdrawn_in_use"));
  configureSandbox();
  stubSandbox();
  process.env.HSN_REFRESH_BATCH = "50";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["GOV_API_PROVIDER", "SANDBOX_API_KEY", "SANDBOX_API_SECRET", "HSN_REFRESH", "HSN_REFRESH_BATCH"]) delete process.env[k];
  resetSandboxClientForTests();
  resetHsnLookupForTests();
});

describe("refreshHsnCodes", () => {
  it("records Sandbox's answer for each distinct code in use, once", async () => {
    const res = await refreshHsnCodes();
    expect(res).toMatchObject({ ran: true, summary: { attempted: 2, recorded: 2, found: 2 } });
    expect(requested.sort()).toEqual(["30041010", "5208"]);
    const rows = await controlDb.select().from(hsnSandboxCodes);
    expect(rows.map((r) => r.code).sort()).toEqual(["30041010", "5208"]);
    expect(rows.find((r) => r.code === "5208")).toMatchObject({ description: "Sandbox 5208", status: "ok", active: true, source: "sandbox" });
    expect(Number(rows.find((r) => r.code === "5208")!.rate)).toBe(12);
  });

  it("is idempotent: a second run right after asks Sandbox for nothing and keeps one row per code", async () => {
    await refreshHsnCodes();
    requested.length = 0;
    resetHsnLookupForTests();
    const again = await refreshHsnCodes();
    expect(again).toMatchObject({ ran: true, summary: { attempted: 0 } });
    expect(requested).toEqual([]);
    expect(await controlDb.select().from(hsnSandboxCodes)).toHaveLength(2);
  });

  it("skips silently when Sandbox is not configured or HSN_REFRESH=off", async () => {
    delete process.env.SANDBOX_API_KEY;
    delete process.env.SANDBOX_API_SECRET;
    resetSandboxClientForTests();
    expect(await refreshHsnCodes()).toEqual({ ran: false, reason: "not_configured" });
    configureSandbox();
    process.env.HSN_REFRESH = "off";
    expect(await refreshHsnCodes()).toEqual({ ran: false, reason: "disabled" });
    expect(requested).toEqual([]);
    expect(await controlDb.select().from(hsnSandboxCodes)).toHaveLength(0);
  });

  it("records a withdrawn code, raises one notice for the set, and leaves customers' items alone", async () => {
    route = (code) => (code === "5208"
      ? json({ code: 200, data: { code, description: "Old cotton", status: "withdrawn", reason: "Replaced" } })
      : json({ code: 200, data: { code, description: `Sandbox ${code}` } }));
    const res = await refreshHsnCodes();
    expect(res).toMatchObject({ ran: true, summary: { withdrawnInUse: 1, itemsAffected: 1, withdrawnCodes: ["5208"] } });
    const [row] = await controlDb.select().from(hsnSandboxCodes).where(eq(hsnSandboxCodes.code, "5208"));
    expect(row).toMatchObject({ active: false, inactiveReason: "Replaced" });
    expect(await getHsnRefreshState()).toMatchObject({ withdrawnInUse: 1, itemsAffected: 1, withdrawnCodes: ["5208"] });
    const notices = () => controlDb.select().from(billingEvents).where(eq(billingEvents.type, "sandbox.hsn_withdrawn_in_use"));
    expect(await notices()).toHaveLength(1);

    // The same set on a later run raises nothing new.
    await controlDb.update(hsnSandboxCodes).set({ checkedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    resetHsnLookupForTests();
    await refreshHsnCodes();
    expect(await notices()).toHaveLength(1);

    const items = await getTenantTestDb().query.items.findMany({ where: (i, { eq: e }) => e(i.businessId, business.id) });
    expect(items.map((i) => i.hsn).sort()).toEqual(["30041010", "30041010", "5208", null]);
  });

  it("a Sandbox outage records nothing and never throws", async () => {
    route = () => json({ message: "down" }, 503);
    const res = await refreshHsnCodes();
    expect(res).toMatchObject({ ran: true, summary: { recorded: 0 } });
    expect(await controlDb.select().from(hsnSandboxCodes)).toHaveLength(0);
  });
});

describe("the resolver's refreshed layer", () => {
  it("serves the refreshed row when Sandbox is down, then the bundled list once the row is 30 days old", async () => {
    await refreshHsnCodes();
    route = () => json({ message: "down" }, 503);
    resetHsnLookupForTests();
    const viaRefresh = await caller.hsn.validate({ hsn: "30041010" });
    expect(viaRefresh).toMatchObject({ valid: true, source: "refreshed", sandboxStatus: "unavailable", sandbox: { description: "Sandbox 30041010", rate: 12, active: true } });
    expect(viaRefresh.checkedAt).toEqual(expect.any(String));

    await controlDb.update(hsnSandboxCodes).set({ checkedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) });
    resetHsnLookupForTests();
    expect(await caller.hsn.validate({ hsn: "30041010" })).toMatchObject({ valid: true, source: "bundled", sandboxStatus: "unavailable", sandbox: null });
  });

  it("live Sandbox wins over the refreshed row", async () => {
    await refreshHsnCodes();
    route = (code) => json({ code: 200, data: { code, description: "Live now", gst_rate: 5 } });
    resetHsnLookupForTests();
    expect(await caller.hsn.validate({ hsn: "30041010" })).toMatchObject({ source: "sandbox", sandbox: { description: "Live now" } });
  });

  it("item.create reports the refreshed source and its warning for a withdrawn code", async () => {
    route = (code) => json({ code: 200, data: { code, description: "Old", status: "withdrawn", reason: "Replaced" } });
    await refreshHsnCodes();
    route = () => json({}, 500);
    resetHsnLookupForTests();
    const item = await caller.item.create({ name: "Uses withdrawn", itemType: "product", itemMode: "simple", unit: "pcs", salePrice: "10.00", hsn: "30041010" });
    expect(item.hsnCheck).toMatchObject({ source: "refreshed", valid: false, warning: expect.stringContaining("Replaced") });
  });
});
