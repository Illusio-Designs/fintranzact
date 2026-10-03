/**
 * item-hsn-check.test.ts — the advisory HSN / SAC check on item.create and
 * item.update, and the extra fields on hsn.validate, with Sandbox mocked.
 *
 * Needs the test database (see item.test.ts); written for CI. Sandbox is never
 * contacted: global fetch is stubbed and the keys are obvious fakes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, createItem, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { resetSandboxClientForTests } from "../../lib/sandbox/client.js";
import { resetHsnLookupForTests } from "../../lib/hsn-lookup.js";
import { describeHsn } from "../../lib/hsn-data.js";

let business: TestBusiness;
let caller: ReturnType<typeof createTestCaller>;

const base = { name: "HSN check item", itemType: "product" as const, itemMode: "simple" as const, unit: "pcs" as const, salePrice: "10.00" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let hsnCalls = 0;
let hsnRoute: () => Response | Promise<Response>;

beforeAll(async () => {
  const user = await createUser({ email: "owner.hsncheck@acmetrading.in", name: "Owner" });
  const tenant = await createTenant({ name: "HSN Check Co" });
  await addMember(tenant.id, user.id, "owner");
  business = await createBusiness(getTenantTestDb(), user.id, { name: "HSN Check Co", gstin: "27AABCA2222R1ZM", city: "Mumbai", state: "Maharashtra", stateCode: "27" });
  caller = createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId: tenant.id, businessId: business.id });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

beforeEach(() => {
  process.env.GOV_API_PROVIDER = "sandbox";
  process.env.SANDBOX_API_KEY = "key_test_FAKE_FOR_TESTS";
  process.env.SANDBOX_API_SECRET = "fake-secret-for-tests";
  resetSandboxClientForTests();
  resetHsnLookupForTests();
  hsnCalls = 0;
  hsnRoute = () => json({ code: 200, data: { code: "30041010", description: "Sandbox penicillins", gst_rate: 12 } });
  vi.stubGlobal("fetch", async (url: string | URL) => {
    if (String(url).endsWith("/authenticate")) return json({ code: 200, data: { access_token: "fake-token" } });
    hsnCalls++;
    return hsnRoute();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOV_API_PROVIDER;
  delete process.env.SANDBOX_API_KEY;
  delete process.env.SANDBOX_API_SECRET;
  resetSandboxClientForTests();
  resetHsnLookupForTests();
});

describe("item.create hsnCheck", () => {
  it("returns Sandbox's description and source when Sandbox answers", async () => {
    const item = await caller.item.create({ ...base, hsn: "30041010" });
    expect(item.hsn).toBe("30041010");
    expect(item.hsnCheck).toEqual({ code: "30041010", source: "sandbox", sandboxStatus: "ok", valid: true, description: "Sandbox penicillins" });
  });

  it("has a null hsnCheck when no code is given", async () => {
    const item = await caller.item.create({ ...base, name: "No HSN" });
    expect(item.hsnCheck).toBeNull();
    expect(hsnCalls).toBe(0);
  });

  it("saves normally and falls back to the bundled list when Sandbox is down", async () => {
    hsnRoute = () => json({ message: "down" }, 503);
    const item = await caller.item.create({ ...base, name: "Sandbox down", hsn: "30041010" });
    expect(item.id).toBeTruthy();
    expect(item.hsnCheck).toMatchObject({ source: "bundled", sandboxStatus: "unavailable", valid: true, description: describeHsn("30041010")!.description });
  });

  it("saves within the 2.5 s cap when Sandbox hangs", async () => {
    hsnRoute = () => new Promise<Response>(() => {});
    const started = Date.now();
    const item = await caller.item.create({ ...base, name: "Sandbox hangs", hsn: "30041010" });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(item.hsnCheck).toMatchObject({ source: "bundled", sandboxStatus: "unavailable", valid: true });
  });

  it("a code Sandbox does not list but the bundled list has is saved with a warning", async () => {
    hsnRoute = () => json({ message: "nf" }, 404);
    const item = await caller.item.create({ ...base, name: "Not on Sandbox", hsn: "30041010" });
    expect(item.hsnCheck).toMatchObject({ source: "bundled", sandboxStatus: "not_found", valid: true, warning: expect.stringContaining("Sandbox does not list") });
  });

  it("warns, without refusing, when Sandbox says the code is withdrawn", async () => {
    hsnRoute = () => json({ code: 200, data: { code: "30041010", description: "Old", status: "withdrawn", reason: "Replaced" } });
    const item = await caller.item.create({ ...base, name: "Withdrawn code", hsn: "30041010" });
    expect(item.id).toBeTruthy();
    expect(item.hsnCheck).toMatchObject({ valid: false, source: "sandbox", warning: expect.stringContaining("Replaced") });
  });

  it("still refuses a code the bundled list rejects, without calling Sandbox", async () => {
    await expect(caller.item.create({ ...base, name: "Bad", hsn: "00000000" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(hsnCalls).toBe(0);
  });

  it("reports the bundled list alone when Sandbox is not configured", async () => {
    delete process.env.SANDBOX_API_KEY;
    delete process.env.SANDBOX_API_SECRET;
    resetSandboxClientForTests();
    const item = await caller.item.create({ ...base, name: "No keys", hsn: "30041010" });
    expect(item.hsnCheck).toMatchObject({ source: "bundled", sandboxStatus: "not_configured", valid: true });
    expect(hsnCalls).toBe(0);
  });
});

describe("item.update hsnCheck", () => {
  it("checks a changed code and skips an unchanged or absent one", async () => {
    const item = await createItem(getTenantTestDb(), business.id, { name: "To update", hsn: "5208" });
    const changed = await caller.item.update({ id: item.id, data: { hsn: "30041010" } });
    expect(changed!.hsn).toBe("30041010");
    expect(changed.hsnCheck).toMatchObject({ source: "sandbox" });
    const calls = hsnCalls;
    const same = await caller.item.update({ id: item.id, data: { hsn: "30041010", name: "Renamed" } });
    expect(same.hsnCheck).toBeNull();
    const noHsn = await caller.item.update({ id: item.id, data: { name: "Renamed again" } });
    expect(noHsn.hsnCheck).toBeNull();
    expect(hsnCalls).toBe(calls);
  });

  it("a Sandbox outage never blocks an update", async () => {
    hsnRoute = () => json({}, 500);
    const item = await createItem(getTenantTestDb(), business.id, { name: "Outage update", hsn: "5208" });
    const updated = await caller.item.update({ id: item.id, data: { hsn: "30041010" } });
    expect(updated!.hsn).toBe("30041010");
    expect(updated.hsnCheck).toMatchObject({ sandboxStatus: "unavailable" });
  });
});

describe("hsn.validate", () => {
  it("adds Sandbox details and keeps valid/details as before", async () => {
    const r = await caller.hsn.validate({ hsn: "30041010" });
    expect(r).toMatchObject({ valid: true, source: "sandbox", sandboxStatus: "ok", details: { code: "30041010" }, sandbox: { description: "Sandbox penicillins", rate: 12, active: true } });
  });

  it("falls back to the bundled details when Sandbox is down", async () => {
    hsnRoute = () => json({}, 500);
    const r = await caller.hsn.validate({ hsn: "30041010" });
    expect(r).toMatchObject({ valid: true, source: "bundled", sandboxStatus: "unavailable", sandbox: null });
  });

  it("an unknown code stays invalid", async () => {
    hsnRoute = () => json({ message: "nf" }, 404);
    expect(await caller.hsn.validate({ hsn: "00000000" })).toMatchObject({ valid: false, source: "bundled" });
  });
});
