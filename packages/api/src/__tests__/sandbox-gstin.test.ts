import { describe, it, expect } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL, SANDBOX_LIVE_URL } from "../lib/sandbox/client.js";
import { SandboxGstinClient, GstinLookupError, GSTIN_API_PATHS, normaliseGstin } from "../lib/sandbox/gstin.js";
import {
  ACTIVE_REGULAR, CANCELLED, ISD, SEZ, COMPOSITION, SUSPENDED, OIDAR, MANY_ADDRESSES, NO_RECORD, INVALID_PATTERN, envelope, addr,
} from "./helpers/gstin-fixtures.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gateway(route: (init: RequestInit, url: string) => Response | Promise<Response>, baseUrl = SANDBOX_TEST_URL) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "api-token" } });
    return route(init ?? {}, u);
  }) as unknown as typeof fetch;
  const client = new SandboxGstinClient(new SandboxClient({ apiKey: "key_test_FAKE", apiSecret: "fake-secret", baseUrl }, fn));
  return { client, calls };
}
const fail = (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe("SandboxGstinClient.lookupGstin: the documented examples", () => {
  it("normalises an active regular taxpayer and sends the documented request", async () => {
    const g = gateway(() => json(ACTIVE_REGULAR));
    const p = await g.client.lookupGstin("29afspb9500e1zy", { acceptCache: true });
    const call = g.calls.at(-1)!;
    expect(call.url).toBe(`${SANDBOX_TEST_URL}${GSTIN_API_PATHS.search}`);
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({ gstin: "29AFSPB9500E1ZY" });
    const h = call.init.headers as Record<string, string>;
    expect(h.authorization).toBe("api-token");
    expect(h["x-api-key"]).toBe("key_test_FAKE");
    expect(h["x-accept-cache"]).toBe("true");
    expect(p).toMatchObject({
      gstin: "29AFSPB9500E1ZY",
      legalName: "SHREE PACKAGING BHANDARI",
      tradeName: "SHREE PACKAGING",
      status: "active",
      statusRaw: "Active",
      taxpayerType: "Regular",
      constitution: "Partnership",
      registeredOn: "2017-07-01",
      cancelledOn: null,
      lastUpdatedOn: "2024-03-12",
      eInvoiceEnabled: true,
      natureOfBusiness: ["Retail Business", "Wholesale Business"],
      source: "sandbox",
      transactionId: "tx-1",
    });
    expect(p!.principalAddress).toEqual({
      line1: "3rd Floor, No 12, Prestige Tower",
      line2: "MG Road, Opp Metro Station",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      stateCode: "29",
      pincode: "560001",
    });
    expect(p!.additionalAddresses).toHaveLength(1);
    // An additional place of business keeps its own state.
    expect(p!.additionalAddresses[0]).toMatchObject({ state: "Tamil Nadu", stateCode: "33", city: "Chennai", pincode: "600001" });
  });

  it("omits x-accept-cache unless asked", async () => {
    const g = gateway(() => json(ACTIVE_REGULAR));
    await g.client.lookupGstin("29AFSPB9500E1ZY");
    expect((g.calls.at(-1)!.init.headers as Record<string, string>)["x-accept-cache"]).toBeUndefined();
  });

  it("normalises a cancelled GSTIN with its cancellation date", async () => {
    const p = await gateway(() => json(CANCELLED)).client.lookupGstin("36AEOFS9999J1ZI");
    expect(p).toMatchObject({ status: "cancelled", cancelledOn: "2023-12-31", eInvoiceEnabled: false, tradeName: "" });
  });

  it("normalises ISD, SEZ, composition and suspended records", async () => {
    expect(await gateway(() => json(ISD)).client.lookupGstin("27AACCA8432H2ZP")).toMatchObject({ taxpayerType: "Input Service Distributor (ISD)", status: "active" });
    expect(await gateway(() => json(SEZ)).client.lookupGstin("24AAACZ0629H1ZI")).toMatchObject({ taxpayerType: "SEZ Developer" });
    expect(await gateway(() => json(COMPOSITION)).client.lookupGstin("27AAPFU0939F1ZV")).toMatchObject({ taxpayerType: "Composition" });
    expect(await gateway(() => json(SUSPENDED)).client.lookupGstin("27AAPFU0939F1ZV")).toMatchObject({ status: "suspended" });
  });

  it("keeps all additional places of business (15+)", async () => {
    const p = await gateway(() => json(MANY_ADDRESSES)).client.lookupGstin("29AFSPB9500E1ZY");
    expect(p!.additionalAddresses).toHaveLength(17);
    expect(p!.additionalAddresses[16]).toMatchObject({ line1: "3rd Floor, 116, Depot 17", pincode: "560116" });
  });

  it("copes with a sparse non-resident (OIDAR) record: NA fields become empty, no addresses", async () => {
    const p = await gateway(() => json(OIDAR)).client.lookupGstin("9917SGP29002OSR");
    expect(p).toMatchObject({
      gstin: "9917SGP29002OSR", legalName: "GLOBAL STREAMING PTE LTD", constitution: "", status: "active",
      natureOfBusiness: [], principalAddress: null, additionalAddresses: [], eInvoiceEnabled: false,
    });
  });

  it("returns null for FO8000 / status_cd 0 (no record)", async () => {
    expect(await gateway(() => json(NO_RECORD)).client.lookupGstin("07CQZCD1111I4Z7")).toBeNull();
    const bare = { code: 200, data: { status_cd: "0" } };
    expect(await gateway(() => json(bare)).client.lookupGstin("07CQZCD1111I4Z7")).toBeNull();
  });

  it("tolerates missing fields", async () => {
    const p = await gateway(() => json(envelope({ gstin: "29AFSPB9500E1ZY", sts: "Active" }))).client.lookupGstin("29AFSPB9500E1ZY");
    expect(p).toMatchObject({ legalName: "", tradeName: "", taxpayerType: "", registeredOn: null, eInvoiceEnabled: null, principalAddress: null, additionalAddresses: [] });
  });

  it("maps an unknown status to other and keeps the raw word", async () => {
    const p = await gateway(() => json(envelope({ gstin: "29AFSPB9500E1ZY", sts: "Inactive" }))).client.lookupGstin("29AFSPB9500E1ZY");
    expect(p).toMatchObject({ status: "other", statusRaw: "Inactive" });
  });
});

describe("normaliseGstin: addresses and VERIFY markers", () => {
  it("prefers the GSTIN's state digits and flags a portal address in another state", () => {
    const p = normaliseGstin(envelope({ gstin: "29AFSPB9500E1ZY", sts: "Active", pradr: { addr: addr({ stcd: "Tamil Nadu" }) } }).data, "29AFSPB9500E1ZY")!;
    expect(p.principalAddress).toMatchObject({ stateCode: "29", state: "Karnataka", stateMismatch: true });
  });

  it("falls back to the portal's state name for a non-state GSTIN prefix and marks it inferred", () => {
    const p = normaliseGstin(envelope({ gstin: "9917SGP29002OSR", sts: "Active", pradr: { addr: addr({ stcd: "Maharashtra" }) } }).data, "9917SGP29002OSR")!;
    expect(p.principalAddress).toMatchObject({ stateCode: "27", state: "Maharashtra" });
    expect(p.inferred).toContain("principalAddress.stateCode");
  });

  it("uses locality, then district, when loc is empty (and says so)", () => {
    const a = normaliseGstin(envelope({ gstin: "29AFSPB9500E1ZY", sts: "Active", pradr: { addr: addr({ loc: "" }) } }).data, "29AFSPB9500E1ZY")!;
    expect(a.principalAddress!.city).toBe("Ashok Nagar");
    expect(a.inferred).toContain("principalAddress.city");
    const b = normaliseGstin(envelope({ gstin: "29AFSPB9500E1ZY", sts: "Active", pradr: { addr: addr({ loc: "", locality: "" }) } }).data, "29AFSPB9500E1ZY")!;
    expect(b.principalAddress!.city).toBe("Bengaluru Urban");
  });

  it("takes nature of business from the principal address when nba is missing", () => {
    const p = normaliseGstin(envelope({ gstin: "29AFSPB9500E1ZY", sts: "Active", pradr: { addr: addr(), ntr: "Retail Business, Supplier of Services" } }).data, "29AFSPB9500E1ZY")!;
    expect(p.natureOfBusiness).toEqual(["Retail Business", "Supplier of Services"]);
    expect(p.inferred).toContain("natureOfBusiness");
  });

  it("throws malformed for an unrecognisable shape and unavailable for other portal errors", () => {
    expect(() => normaliseGstin("oops", "29AFSPB9500E1ZY")).toThrow(GstinLookupError);
    expect(() => normaliseGstin({ status_cd: "1" }, "29AFSPB9500E1ZY")).toThrow(/unreadable/);
    expect(() => normaliseGstin({ status_cd: "0", error: { error_cd: "FO9999", message: "Portal busy" } }, "29AFSPB9500E1ZY")).toThrow(GstinLookupError);
  });
});

describe("SandboxGstinClient: local validation, errors and the check digit", () => {
  it("rejects garbage without any call", async () => {
    const g = gateway(() => json(ACTIVE_REGULAR));
    expect(await fail(g.client.lookupGstin("NOT-A-GSTIN"))).toMatchObject({ kind: "invalid" });
    expect(await fail(g.client.lookupGstin(""))).toMatchObject({ kind: "invalid" });
    expect(g.calls).toHaveLength(0);
  });

  it("enforces the check digit only against the live host", async () => {
    // 29AFSPB9500E1ZY (the docs' headline example) has a wrong check digit.
    const test = gateway(() => json(ACTIVE_REGULAR), SANDBOX_TEST_URL);
    expect(await test.client.lookupGstin("29AFSPB9500E1ZY")).not.toBeNull();
    const live = gateway(() => json(ACTIVE_REGULAR), SANDBOX_LIVE_URL);
    expect(await fail(live.client.lookupGstin("29AFSPB9500E1ZY"))).toMatchObject({ kind: "invalid" });
    expect(live.calls).toHaveLength(0);
  });

  it("allows non-resident patterns", async () => {
    const g = gateway(() => json(OIDAR), SANDBOX_LIVE_URL);
    expect(await g.client.lookupGstin("9917SGP29002OSR")).not.toBeNull();
  });

  it("maps 422 to invalid", async () => {
    // 3418FIN00001UNY matches the UIN pattern locally, so Sandbox gets to answer.
    const g = gateway(() => json(INVALID_PATTERN, 422));
    const e = await fail(g.client.lookupGstin("3418FIN00001UNY"));
    expect(e).toBeInstanceOf(GstinLookupError);
    expect(e).toMatchObject({ kind: "invalid", httpStatus: 422 });
  });

  it("maps 401/403 to auth after one re-authentication", async () => {
    const g = gateway(() => json({ message: "denied" }, 401));
    expect(await fail(g.client.lookupGstin("29AFSPB9500E1ZY"))).toMatchObject({ kind: "auth", httpStatus: 401 });
    expect(g.calls.filter((c) => c.url.endsWith("/authenticate"))).toHaveLength(2);
    expect(await fail(gateway(() => json({}, 403)).client.lookupGstin("29AFSPB9500E1ZY"))).toMatchObject({ kind: "auth" });
  });

  it("maps 429, 5xx, network failures and timeouts", async () => {
    const run = (route: () => Response) => fail(gateway(route).client.lookupGstin("29AFSPB9500E1ZY"));
    expect(await run(() => json({}, 429))).toMatchObject({ kind: "rate_limited" });
    expect(await run(() => json({}, 500))).toMatchObject({ kind: "unavailable", httpStatus: 500 });
    expect(await run(() => json({}, 503))).toMatchObject({ kind: "unavailable" });
    expect(await run(() => { throw new Error("ECONNRESET"); })).toMatchObject({ kind: "unavailable" });
    expect(await run(() => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); })).toMatchObject({ kind: "timeout" });
  });

  it("rejects a malformed body", async () => {
    expect(await fail(gateway(() => new Response("<html>oops</html>", { status: 200 })).client.lookupGstin("29AFSPB9500E1ZY"))).toMatchObject({ kind: "malformed" });
    expect(await fail(gateway(() => json({ code: 200, data: { data: "x", status_cd: "1" } })).client.lookupGstin("29AFSPB9500E1ZY"))).toMatchObject({ kind: "malformed" });
  });

  it("never leaks the gateway message or keys in the error", async () => {
    const e = await fail(gateway(() => json({ message: "secret key_test_FAKE leaked?" }, 500)).client.lookupGstin("29AFSPB9500E1ZY"));
    expect(e.message).not.toContain("key_test_FAKE");
    expect(e.message).not.toContain("leaked");
  });
});
