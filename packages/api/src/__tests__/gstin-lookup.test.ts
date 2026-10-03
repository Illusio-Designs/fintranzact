import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GstinProfile } from "@fintranzact/shared";
import {
  createGstinResolver, gstinSettingsFromEnv, checkPartyGstin, resolveGstin, resetGstinLookupForTests, partyNameMismatch,
  GSTIN_SUCCESS_TTL_MS, GSTIN_NEGATIVE_TTL_MS, GSTIN_CACHE_MAX, type GstinResolverDeps,
} from "../lib/gstin-lookup.js";
import { GstinLookupError, normaliseGstin, SandboxGstinClient, type GstinLookupClient } from "../lib/sandbox/gstin.js";
import { SandboxClient } from "../lib/sandbox/client.js";
import { logger } from "../lib/logger.js";
import { ACTIVE_REGULAR, CANCELLED, SUSPENDED, addr, envelope } from "./helpers/gstin-fixtures.js";

const profile = (raw = ACTIVE_REGULAR, gstin = "29AFSPB9500E1ZY"): GstinProfile => normaliseGstin(raw.data, gstin)!;
const G = "29AFSPB9500E1ZY";

let t = 5_000_000;
function setup(lookup: GstinLookupClient["lookupGstin"], extra: Partial<GstinResolverDeps> = {}, strict = false) {
  const client: GstinLookupClient = { strictChecksum: strict, lookupGstin: vi.fn(lookup) };
  const r = createGstinResolver({
    getClient: () => client,
    now: () => t,
    settings: () => ({ enabled: true, timeoutMs: 2500 }),
    ...extra,
  });
  return { r, spy: client.lookupGstin as ReturnType<typeof vi.fn> };
}
beforeEach(() => { t = 5_000_000; });

describe("resolveGstin: local validation", () => {
  it("rejects garbage without a call", async () => {
    const { r, spy } = setup(async () => profile());
    expect(await r.resolveGstin("garbage")).toMatchObject({ valid: false, source: "local", sandboxStatus: "invalid" });
    expect(await r.resolveGstin("")).toMatchObject({ valid: false, sandboxStatus: "invalid" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("enforces the check digit when the client says so, and only warns otherwise", async () => {
    const strict = setup(async () => profile(), {}, true);
    const bad = await strict.r.resolveGstin(G);
    expect(bad).toMatchObject({ valid: false, sandboxStatus: "invalid", checksumOk: false });
    expect(bad.warnings[0]).toMatch(/check character/);
    expect(strict.spy).not.toHaveBeenCalled();
    const lax = setup(async () => profile(), {}, false);
    expect(await lax.r.resolveGstin(G)).toMatchObject({ valid: true, sandboxStatus: "ok", checksumOk: false });
    expect(lax.spy).toHaveBeenCalledTimes(1);
  });
});

describe("resolveGstin: not configured", () => {
  it("falls back to local validation, silently, without a client or when switched off", async () => {
    const none = createGstinResolver({ getClient: () => null, now: () => t, settings: () => ({ enabled: true, timeoutMs: 2500 }) });
    expect(await none.resolveGstin("27AAPFU0939F1ZV")).toMatchObject({ valid: true, source: "local", sandboxStatus: "not_configured", warnings: [], profile: null });
    const off = setup(async () => profile(), { settings: () => ({ enabled: false, timeoutMs: 2500 }) });
    expect(await off.r.resolveGstin("27AAPFU0939F1ZV")).toMatchObject({ sandboxStatus: "not_configured" });
    expect(off.spy).not.toHaveBeenCalled();
  });

  it("a wrong check digit is only a warning when Sandbox cannot be asked", async () => {
    const none = createGstinResolver({ getClient: () => null, now: () => t, settings: () => ({ enabled: true, timeoutMs: 2500 }) });
    const r = await none.resolveGstin(G);
    expect(r).toMatchObject({ valid: true, sandboxStatus: "not_configured", checksumOk: false });
    expect(r.warnings[0]).toMatch(/check character/);
  });

  it("settings parse the environment with defaults and a ceiling", () => {
    expect(gstinSettingsFromEnv({})).toEqual({ enabled: true, timeoutMs: 2500 });
    expect(gstinSettingsFromEnv({ GSTIN_SANDBOX_LOOKUP: "OFF", GSTIN_LOOKUP_TIMEOUT_MS: "900" })).toEqual({ enabled: false, timeoutMs: 900 });
    expect(gstinSettingsFromEnv({ GSTIN_LOOKUP_TIMEOUT_MS: "999999" }).timeoutMs).toBe(10_000);
    expect(gstinSettingsFromEnv({ GSTIN_LOOKUP_TIMEOUT_MS: "abc" }).timeoutMs).toBe(2500);
  });

  it("the shared resolver is not configured under test (provider is not Sandbox)", async () => {
    resetGstinLookupForTests();
    expect(await resolveGstin("27AAPFU0939F1ZV")).toMatchObject({ sandboxStatus: "not_configured" });
  });
});

describe("resolveGstin: answers", () => {
  it("returns the profile from Sandbox and asks for the cached answer by default", async () => {
    const { r, spy } = setup(async () => profile());
    const res = await r.resolveGstin(` ${G.toLowerCase()} `);
    expect(res).toMatchObject({ gstin: G, valid: true, source: "sandbox", sandboxStatus: "ok", warnings: [] });
    expect(res.profile).toMatchObject({ legalName: "SHREE PACKAGING BHANDARI", status: "active" });
    expect(spy).toHaveBeenCalledWith(G, expect.objectContaining({ acceptCache: true, timeoutMs: 2500 }));
    await r.resolveGstin(G, { fresh: true, acceptCache: false });
    expect(spy).toHaveBeenLastCalledWith(G, expect.objectContaining({ acceptCache: false }));
  });

  it("a cancelled GSTIN is not valid and warns; suspended warns but stays valid", async () => {
    const c = setup(async () => profile(CANCELLED, "36AEOFS9999J1ZI"));
    const cr = await c.r.resolveGstin("36AEOFS9999J1ZI");
    expect(cr).toMatchObject({ valid: false, sandboxStatus: "ok" });
    expect(cr.warnings[0]).toMatch(/cancelled \(since 31\/12\/2023\)/);
    const s = setup(async () => profile(SUSPENDED, "27AAPFU0939F1ZV"));
    const sr = await s.r.resolveGstin("27AAPFU0939F1ZV");
    expect(sr).toMatchObject({ valid: true });
    expect(sr.warnings[0]).toMatch(/suspended/);
  });

  it("warns when the portal's address state disagrees with the GSTIN", async () => {
    const p = normaliseGstin(envelope({ gstin: G, sts: "Active", pradr: { addr: addr({ stcd: "Kerala" }) } }).data, G)!;
    const res = await setup(async () => p).r.resolveGstin(G);
    expect(res.warnings[0]).toMatch(/different state/);
  });

  it("not found and an invalid pattern are definite answers", async () => {
    const nf = await setup(async () => null).r.resolveGstin(G);
    expect(nf).toMatchObject({ valid: false, source: "sandbox", sandboxStatus: "not_found" });
    expect(nf.warnings[0]).toMatch(/No GST record/);
    const bad = await setup(async () => { throw new GstinLookupError("x", "invalid", 422); }).r.resolveGstin(G);
    expect(bad).toMatchObject({ valid: false, sandboxStatus: "invalid" });
  });

  it("every other failure is unavailable and still valid locally, and never throws", async () => {
    for (const kind of ["auth", "rate_limited", "timeout", "unavailable", "malformed"] as const) {
      const { r } = setup(async () => { throw new GstinLookupError("boom", kind, 500); });
      expect(await r.resolveGstin(G)).toMatchObject({ valid: true, source: "local", sandboxStatus: "unavailable", profile: null });
    }
    const odd = setup(async () => { throw new TypeError("weird"); });
    expect(await odd.r.resolveGstin(G)).toMatchObject({ sandboxStatus: "unavailable" });
    const throwingDeps = createGstinResolver({ getClient: () => { throw new Error("env exploded"); }, now: () => t, settings: () => ({ enabled: true, timeoutMs: 2500 }) });
    expect(await throwingDeps.resolveGstin(G)).toMatchObject({ valid: true, sandboxStatus: "not_configured" });
  });

  it("gives up after the timeout even if the client hangs", async () => {
    const { r } = setup(() => new Promise(() => {}), { settings: () => ({ enabled: true, timeoutMs: 100 }) });
    const res = await r.resolveGstin(G);
    expect(res).toMatchObject({ sandboxStatus: "unavailable", valid: true });
  });
});

describe("resolveGstin: cache, coalescing, guard", () => {
  it("caches a found answer for 6 h, then asks again", async () => {
    const { r, spy } = setup(async () => profile());
    await r.resolveGstin(G);
    t += GSTIN_SUCCESS_TTL_MS - 1;
    await r.resolveGstin(G);
    expect(spy).toHaveBeenCalledTimes(1);
    t += 2;
    await r.resolveGstin(G);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("caches not-found and failures only 60 s", async () => {
    const nf = setup(async () => null);
    await nf.r.resolveGstin(G);
    t += GSTIN_NEGATIVE_TTL_MS - 1;
    await nf.r.resolveGstin(G);
    expect(nf.spy).toHaveBeenCalledTimes(1);
    t += 2;
    await nf.r.resolveGstin(G);
    expect(nf.spy).toHaveBeenCalledTimes(2);
    const down = setup(async () => { throw new GstinLookupError("x", "unavailable", 503); });
    await down.r.resolveGstin(G);
    await down.r.resolveGstin(G);
    expect(down.spy).toHaveBeenCalledTimes(1);
  });

  it("fresh bypasses the cache and replaces the entry", async () => {
    let name = "OLD";
    const { r, spy } = setup(async () => ({ ...profile(), legalName: name }));
    await r.resolveGstin(G);
    name = "NEW";
    expect((await r.resolveGstin(G)).profile!.legalName).toBe("OLD");
    expect((await r.resolveGstin(G, { fresh: true })).profile!.legalName).toBe("NEW");
    expect((await r.resolveGstin(G)).profile!.legalName).toBe("NEW");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("concurrent lookups share one call", async () => {
    let release!: (p: GstinProfile) => void;
    const { r, spy } = setup(() => new Promise((res) => { release = res; }));
    const all = [r.resolveGstin(G), r.resolveGstin(G), r.resolveGstin(G)];
    await Promise.resolve();
    release(profile());
    const out = await Promise.all(all);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.every((x) => x.sandboxStatus === "ok")).toBe(true);
  });

  it("keeps the cache bounded (LRU)", async () => {
    const { r } = setup(async () => profile(), { maxPerMinute: 100_000 });
    // Valid-format GSTINs; the check digit is not enforced here.
    for (let i = 0; i < GSTIN_CACHE_MAX + 5; i++) {
      await r.resolveGstin(`27AAPFU${String(i).padStart(4, "0")}F1ZV`);
    }
    expect(r.cacheSize()).toBe(GSTIN_CACHE_MAX);
  });

  it("the per-process guard caps calls a minute and resets after it", async () => {
    const { r, spy } = setup(async () => profile(), { maxPerMinute: 2 });
    await r.resolveGstin("27AAPFU0001F1ZV");
    await r.resolveGstin("27AAPFU0002F1ZV");
    const third = await r.resolveGstin("27AAPFU0003F1ZV");
    expect(third).toMatchObject({ sandboxStatus: "unavailable", valid: true });
    expect(spy).toHaveBeenCalledTimes(2);
    t += 60_000;
    expect(await r.resolveGstin("27AAPFU0004F1ZV")).toMatchObject({ sandboxStatus: "ok" });
  });
});

describe("secrets are never logged", () => {
  it("logs only the failure class, not keys, tokens or gateway bodies", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const fn = (async (url: string | URL) =>
      String(url).endsWith("/authenticate")
        ? new Response(JSON.stringify({ code: 200, data: { access_token: "tok-SECRET" } }))
        : new Response(JSON.stringify({ message: "key_test_SECRET denied" }), { status: 500 })) as unknown as typeof fetch;
    const sandbox = new SandboxClient({ apiKey: "key_test_SECRET", apiSecret: "shh-SECRET", baseUrl: "https://test-api.sandbox.co.in" }, fn);
    const r = createGstinResolver({ getClient: () => new SandboxGstinClient(sandbox), now: () => t, settings: () => ({ enabled: true, timeoutMs: 2500 }) });
    const res = await r.resolveGstin(G);
    expect(res.sandboxStatus).toBe("unavailable");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toMatch(/SECRET/);
    expect(logged).toContain("unavailable");
    expect(JSON.stringify(res)).not.toMatch(/SECRET/);
    warn.mockRestore();
  });
});

describe("partyNameMismatch", () => {
  it("ignores case, punctuation and company suffixes", () => {
    expect(partyNameMismatch(["Shree Packaging"], ["SHREE PACKAGING BHANDARI", "SHREE PACKAGING"])).toBe(false);
    expect(partyNameMismatch(["Acme Pvt. Ltd."], ["ACME LIMITED"])).toBe(false);
    expect(partyNameMismatch(["M/s Acme & Sons"], ["Acme and Sons Private Limited"])).toBe(false);
  });
  it("flags unrelated names and stays quiet with nothing to compare", () => {
    expect(partyNameMismatch(["Blue Star Traders"], ["SHREE PACKAGING BHANDARI"])).toBe(true);
    expect(partyNameMismatch(["", null], ["SHREE"])).toBe(false);
    expect(partyNameMismatch(["Anything"], ["", null])).toBe(false);
  });
});

describe("checkPartyGstin", () => {
  const via = (raw: typeof ACTIVE_REGULAR, gstin = G) => ({ resolve: setup(async () => profile(raw, gstin)).r.resolveGstin });

  it("is null for a blank GSTIN", async () => {
    expect(await checkPartyGstin({ gstin: " " })).toBeNull();
    expect(await checkPartyGstin({ gstin: null })).toBeNull();
  });

  it("is a plain status for a matching active party", async () => {
    expect(await checkPartyGstin({ gstin: G, name: "Shree Packaging", stateCode: "29" }, via(ACTIVE_REGULAR))).toEqual({ status: "active" });
  });

  it("warns on a name mismatch and a state mismatch, without blocking", async () => {
    const out = await checkPartyGstin({ gstin: G, name: "Blue Star Traders", stateCode: "27" }, via(ACTIVE_REGULAR));
    expect(out!.status).toBe("active");
    expect(out!.warning).toMatch(/name on this party does not match/);
    expect(out!.warning).toMatch(/state differs/);
  });

  it("warns on cancelled and suspended GSTINs", async () => {
    const c = await checkPartyGstin({ gstin: "36AEOFS9999J1ZI", name: "Sai Fabrics" }, via(CANCELLED, "36AEOFS9999J1ZI"));
    expect(c).toMatchObject({ status: "cancelled" });
    expect(c!.warning).toMatch(/cancelled/);
    const s = await checkPartyGstin({ gstin: "27AAPFU0939F1ZV", name: "Uday Traders" }, via(SUSPENDED, "27AAPFU0939F1ZV"));
    expect(s).toMatchObject({ status: "suspended" });
  });

  it("reports not found, unavailable and not configured without throwing", async () => {
    expect(await checkPartyGstin({ gstin: G }, { resolve: setup(async () => null).r.resolveGstin })).toMatchObject({ status: "not_found" });
    expect(await checkPartyGstin({ gstin: G }, { resolve: setup(async () => { throw new GstinLookupError("x", "timeout"); }).r.resolveGstin })).toEqual({ status: "unavailable" });
    resetGstinLookupForTests();
    expect(await checkPartyGstin({ gstin: "27AAPFU0939F1ZV" })).toEqual({ status: "not_configured" });
  });

  it("caps the wait at 2.5 s however large a timeout is asked for", async () => {
    const resolve = vi.fn(async () => ({ gstin: G, valid: true, format: "regular" as const, checksumOk: true, source: "local" as const, sandboxStatus: "not_configured" as const, profile: null, warnings: [], checkedAt: null }));
    await checkPartyGstin({ gstin: G }, { resolve, timeoutMs: 60_000 });
    expect(resolve).toHaveBeenCalledWith(G, expect.objectContaining({ timeoutMs: 2500 }));
  });
});
