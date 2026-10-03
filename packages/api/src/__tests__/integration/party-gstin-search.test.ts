/**
 * party-gstin-search.test.ts — the Sandbox GSTIN search behind party.lookupGstin
 * and the advisory gstinCheck on party.create / party.update, with Sandbox mocked.
 *
 * Needs the test database (see item.test.ts); written for CI. Sandbox is never
 * contacted: global fetch is stubbed and the keys are obvious fakes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { resetSandboxClientForTests } from "../../lib/sandbox/client.js";
import { resetGstinLookupForTests } from "../../lib/gstin-lookup.js";
import { resetGstinLookupRateLimit, GSTIN_LOOKUP_LIMIT } from "../../routers/party.js";
import { ACTIVE_REGULAR, CANCELLED, NO_RECORD, INVALID_PATTERN } from "../helpers/gstin-fixtures.js";

let business: TestBusiness;
let caller: ReturnType<typeof createTestCaller>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let searchCalls = 0;
let searchRoute: () => Response | Promise<Response>;

const ACTIVE = "29AFSPB9500E1ZY";
const CANCELLED_GSTIN = "36AEOFS9999J1ZI";

beforeAll(async () => {
  const user = await createUser({ email: "owner.gstinsearch@acmetrading.in", name: "Owner" });
  const tenant = await createTenant({ name: "GSTIN Search Co" });
  await addMember(tenant.id, user.id, "owner");
  business = await createBusiness(getTenantTestDb(), user.id, { name: "GSTIN Search Co", gstin: "27AABCA2222R1ZM", city: "Mumbai", state: "Maharashtra", stateCode: "27" });
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
  resetGstinLookupForTests();
  resetGstinLookupRateLimit();
  searchCalls = 0;
  searchRoute = () => json(ACTIVE_REGULAR);
  vi.stubGlobal("fetch", async (url: string | URL) => {
    if (String(url).endsWith("/authenticate")) return json({ code: 200, data: { access_token: "fake-token" } });
    searchCalls++;
    return searchRoute();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOV_API_PROVIDER;
  delete process.env.SANDBOX_API_KEY;
  delete process.env.SANDBOX_API_SECRET;
  resetSandboxClientForTests();
  resetGstinLookupForTests();
  resetGstinLookupRateLimit();
});

describe("party.lookupGstin through Sandbox", () => {
  it("returns the profile, party-form details and the new fields", async () => {
    const r = await caller.party.lookupGstin({ gstin: ACTIVE.toLowerCase() });
    expect(r).toMatchObject({
      available: true, valid: true, source: "sandbox", sandboxStatus: "ok", warnings: [],
      details: { gstin: ACTIVE, legalName: "SHREE PACKAGING BHANDARI", stateCode: "29", state: "Karnataka", pincode: "560001", gstRegistrationType: "regular", gstinStatus: "active" },
    });
    if (!r.available) throw new Error("expected available");
    expect(r.profile).toMatchObject({ status: "active", eInvoiceEnabled: true });
    expect(r.profile!.additionalAddresses).toHaveLength(1);
    expect(searchCalls).toBe(1);
  });

  it("serves a repeat search from the cache, and refresh asks again", async () => {
    await caller.party.lookupGstin({ gstin: ACTIVE });
    await caller.party.lookupGstin({ gstin: ACTIVE });
    expect(searchCalls).toBe(1);
    await caller.party.lookupGstin({ gstin: ACTIVE, refresh: true });
    expect(searchCalls).toBe(2);
  });

  it("warns on a cancelled GSTIN", async () => {
    searchRoute = () => json(CANCELLED);
    const r = await caller.party.lookupGstin({ gstin: CANCELLED_GSTIN });
    expect(r).toMatchObject({ available: true, valid: false, details: { gstinStatus: "cancelled" } });
    expect(r.warnings[0]).toMatch(/cancelled/);
  });

  it("reports no record and an invalid pattern as definite answers", async () => {
    searchRoute = () => json(NO_RECORD);
    expect(await caller.party.lookupGstin({ gstin: "27AAPFU0939F1ZV" })).toMatchObject({ available: false, valid: false, sandboxStatus: "not_found", source: "sandbox", profile: null, derived: { stateCode: "27" } });
    resetGstinLookupForTests();
    searchRoute = () => json(INVALID_PATTERN, 422);
    expect(await caller.party.lookupGstin({ gstin: "27AAPFU0939F1ZV" })).toMatchObject({ available: false, sandboxStatus: "invalid" });
  });

  it("falls back to local details with a clear reason when Sandbox is down", async () => {
    searchRoute = () => json({ message: "down" }, 503);
    const r = await caller.party.lookupGstin({ gstin: ACTIVE });
    expect(r).toMatchObject({ available: false, valid: true, source: "local", sandboxStatus: "unavailable", derived: { pan: "AFSPB9500E" } });
    if (r.available) return;
    expect(r.reason).toMatch(/could not reach the GST portal/i);
  });

  it("is limited per user because each search can spend quota", async () => {
    for (let i = 0; i < GSTIN_LOOKUP_LIMIT; i++) await caller.party.lookupGstin({ gstin: ACTIVE });
    await expect(caller.party.lookupGstin({ gstin: ACTIVE })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("is not configured without keys: local derivation only, no Sandbox call", async () => {
    delete process.env.SANDBOX_API_KEY;
    delete process.env.SANDBOX_API_SECRET;
    resetSandboxClientForTests();
    const r = await caller.party.lookupGstin({ gstin: "27AAPFU0939F1ZV" });
    expect(r).toMatchObject({ available: false, valid: true, source: "local", sandboxStatus: "not_configured", derived: { stateCode: "27" } });
    expect(searchCalls).toBe(0);
  });
});

describe("party.create / party.update gstinCheck", () => {
  it("returns the check with a created party and never blocks when Sandbox is down", async () => {
    const ok = await caller.party.create({ type: "supplier", name: "Shree Packaging", gstin: ACTIVE });
    expect(ok.id).toBeTruthy();
    expect(ok.gstinCheck).toEqual({ status: "active" });

    searchRoute = () => json({ message: "down" }, 503);
    resetGstinLookupForTests();
    const down = await caller.party.create({ type: "supplier", name: "Down Co", gstin: "27AAPFU0939F1ZV" });
    expect(down.id).toBeTruthy();
    expect(down.gstin).toBe("27AAPFU0939F1ZV");
    expect(down.gstinCheck).toEqual({ status: "unavailable" });
  });

  it("saves within the 2.5 s cap when Sandbox hangs", async () => {
    searchRoute = () => new Promise<Response>(() => {});
    const started = Date.now();
    const p = await caller.party.create({ type: "customer", name: "Hang Co", gstin: "24AAACZ0629H1ZI" });
    expect(Date.now() - started).toBeLessThan(6000);
    expect(p.gstinCheck).toMatchObject({ status: "unavailable" });
  });

  it("has a null check without a GSTIN and warns on a cancelled GSTIN or a different name", async () => {
    expect((await caller.party.create({ type: "customer", name: "No GST Co" })).gstinCheck).toBeNull();
    expect(searchCalls).toBe(0);

    searchRoute = () => json(CANCELLED);
    const c = await caller.party.create({ type: "customer", name: "Totally Different Name", gstin: CANCELLED_GSTIN });
    expect(c.id).toBeTruthy();
    expect(c.gstinCheck?.status).toBe("cancelled");
    expect(c.gstinCheck?.warning).toMatch(/cancelled/);
    expect(c.gstinCheck?.warning).toMatch(/name on this party does not match/);
  });

  it("checks on update only when the GSTIN is new or changed", async () => {
    const p = await caller.party.create({ type: "customer", name: "Update Co" });
    searchCalls = 0;
    const renamed = await caller.party.update({ id: p.id, data: { name: "Update Company" } });
    expect(renamed.gstinCheck).toBeNull();
    expect(searchCalls).toBe(0);

    const added = await caller.party.update({ id: p.id, data: { gstin: ACTIVE } });
    expect(added.gstin).toBe(ACTIVE);
    expect(added.gstinCheck).toMatchObject({ status: "active" });
    expect(searchCalls).toBe(1);

    const same = await caller.party.update({ id: p.id, data: { gstin: ACTIVE } });
    expect(same.gstinCheck).toBeNull();
    expect(searchCalls).toBe(1);
  });

  it("stays silent about Sandbox when it is not configured", async () => {
    delete process.env.SANDBOX_API_KEY;
    delete process.env.SANDBOX_API_SECRET;
    resetSandboxClientForTests();
    const p = await caller.party.create({ type: "supplier", name: "Offline Co", gstin: "27AAPFU0939F1ZV" });
    expect(p.gstinCheck).toEqual({ status: "not_configured" });
    expect(searchCalls).toBe(0);
  });
});
