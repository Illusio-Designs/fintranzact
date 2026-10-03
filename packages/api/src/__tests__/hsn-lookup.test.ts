import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHsnResolver, hsnSettingsFromEnv, checkItemHsn, resolveHsn, resetHsnLookupForTests, HSN_SUCCESS_TTL_MS, HSN_NEGATIVE_TTL_MS, HSN_CACHE_MAX, type HsnResolverDeps } from "../lib/hsn-lookup.js";
import { describeHsn } from "../lib/hsn-data.js";
import { HsnLookupError, SandboxHsnClient, type HsnLookupClient, type SandboxHsnResult } from "../lib/sandbox/hsn.js";
import { SandboxClient } from "../lib/sandbox/client.js";
import { logger } from "../lib/logger.js";

const sb = (over: Partial<SandboxHsnResult> = {}): SandboxHsnResult => ({
  code: "30041010", kind: "hsn", description: "Sandbox says penicillins", rate: 12,
  effectiveFrom: "2017-07-01", effectiveTo: null, active: true, source: "sandbox", ...over,
});

let t = 1_000_000;
function setup(lookup: HsnLookupClient["lookupHsn"], extra: Partial<HsnResolverDeps> = {}) {
  const client: HsnLookupClient = { lookupHsn: vi.fn(lookup) };
  const r = createHsnResolver({
    getClient: () => client,
    bundled: describeHsn,
    now: () => t,
    settings: () => ({ enabled: true, timeoutMs: 2500 }),
    ...extra,
  });
  return { r, client, spy: client.lookupHsn as ReturnType<typeof vi.fn> };
}

beforeEach(() => { t = 1_000_000; });

describe("resolveHsn: when Sandbox is used", () => {
  it("skips Sandbox silently without a client (no keys / provider not Sandbox)", async () => {
    const r = createHsnResolver({ getClient: () => null, bundled: describeHsn, now: () => t, settings: () => ({ enabled: true, timeoutMs: 2500 }) });
    const res = await r.resolveHsn("30041010");
    expect(res).toMatchObject({ source: "bundled", sandboxStatus: "not_configured", valid: true });
    expect(res.warning).toBeUndefined();
    expect(res.description).toBe(res.bundledDescription);
  });

  it("is off with HSN_SANDBOX_LOOKUP=off", async () => {
    const { r, spy } = setup(async () => sb(), { settings: () => ({ enabled: false, timeoutMs: 2500 }) });
    expect(await r.resolveHsn("30041010")).toMatchObject({ source: "bundled", sandboxStatus: "not_configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("settings parse the environment with defaults and a ceiling", () => {
    expect(hsnSettingsFromEnv({})).toEqual({ enabled: true, timeoutMs: 2500 });
    expect(hsnSettingsFromEnv({ HSN_SANDBOX_LOOKUP: "OFF", HSN_LOOKUP_TIMEOUT_MS: "900" })).toEqual({ enabled: false, timeoutMs: 900 });
    expect(hsnSettingsFromEnv({ HSN_LOOKUP_TIMEOUT_MS: "999999" }).timeoutMs).toBe(10_000);
    expect(hsnSettingsFromEnv({ HSN_LOOKUP_TIMEOUT_MS: "abc" }).timeoutMs).toBe(2500);
  });

  it("returns Sandbox merged with the bundled description", async () => {
    const { r } = setup(async () => sb());
    const res = await r.resolveHsn(" 30041010 ");
    expect(res).toMatchObject({
      code: "30041010", source: "sandbox", sandboxStatus: "ok", valid: true, kind: "hsn",
      description: "Sandbox says penicillins", rate: 12, active: true,
    });
    expect(res.bundledDescription).toBe(describeHsn("30041010")!.description);
    expect(res.bundled).not.toBeNull();
    expect(res.warning).toBeUndefined();
  });

  it("keeps the bundled description when Sandbox sends none", async () => {
    const { r } = setup(async () => sb({ description: "" }));
    expect((await r.resolveHsn("30041010")).description).toBe(describeHsn("30041010")!.description);
  });

  it("flags a withdrawn code as not valid, with a warning", async () => {
    const { r } = setup(async () => sb({ active: false, inactiveReason: "Merged" }));
    const res = await r.resolveHsn("30041010");
    expect(res).toMatchObject({ source: "sandbox", valid: false, active: false });
    expect(res.warning).toContain("Merged");
  });

  it("does not call Sandbox for malformed codes", async () => {
    const { r, spy } = setup(async () => sb());
    for (const c of ["", "1", "12ab", "123456789"]) {
      expect(await r.resolveHsn(c)).toMatchObject({ source: "bundled", sandboxStatus: "skipped", valid: false });
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("resolveHsn: fallbacks", () => {
  it.each([
    ["5xx", new HsnLookupError("down", "unavailable", 503)],
    ["timeout", new HsnLookupError("slow", "timeout")],
    ["429", new HsnLookupError("busy", "rate_limited", 429)],
    ["auth", new HsnLookupError("no", "auth", 401)],
    ["unknown error", new Error("boom")],
  ])("falls back to the bundled list on %s", async (_n, err) => {
    const { r } = setup(async () => { throw err; });
    const res = await r.resolveHsn("30041010");
    expect(res).toMatchObject({ source: "bundled", sandboxStatus: "unavailable", valid: true });
    expect(res.warning).toBeUndefined();
  });

  it("gives up after the timeout when Sandbox hangs", async () => {
    vi.useFakeTimers();
    try {
      const { r } = setup(() => new Promise(() => {}));
      const p = r.resolveHsn("30041010", { timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
      expect(await p).toMatchObject({ source: "bundled", sandboxStatus: "unavailable", valid: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits longer than the configured timeout, whatever the caller asks", async () => {
    const { spy, r } = setup(async () => sb(), { settings: () => ({ enabled: true, timeoutMs: 1000 }) });
    await r.resolveHsn("30041010", { timeoutMs: 9000 });
    expect(spy).toHaveBeenCalledWith("30041010", { timeoutMs: 1000 });
  });

  it("not found on Sandbox but in the bundled list: bundled answer with a warning, still valid", async () => {
    const { r } = setup(async () => null);
    const res = await r.resolveHsn("30041010");
    expect(res).toMatchObject({ source: "bundled", sandboxStatus: "not_found", valid: true });
    expect(res.warning).toContain("Sandbox does not list");
  });

  it("unknown to both is invalid with a warning", async () => {
    const { r } = setup(async () => null);
    expect(await r.resolveHsn("00000000")).toMatchObject({ source: "bundled", sandboxStatus: "not_found", valid: false, description: null, warning: expect.stringContaining("not found") });
    const down = setup(async () => { throw new HsnLookupError("x", "unavailable", 500); });
    expect(await down.r.resolveHsn("00000000")).toMatchObject({ valid: false, sandboxStatus: "unavailable" });
    const off = createHsnResolver({ getClient: () => null, bundled: describeHsn, now: () => t, settings: () => ({ enabled: true, timeoutMs: 1 }) });
    expect(await off.resolveHsn("00000000")).toMatchObject({ valid: false, sandboxStatus: "not_configured" });
  });

  it("never throws, even if the bundled lookup or client factory throws", async () => {
    const r = createHsnResolver({
      getClient: () => { throw new Error("config exploded"); },
      bundled: () => { throw new Error("data exploded"); },
      now: () => t,
      settings: () => ({ enabled: true, timeoutMs: 100 }),
    });
    await expect(r.resolveHsn("30041010")).resolves.toMatchObject({ source: "bundled", valid: false, sandboxStatus: "unavailable" });
  });
});

describe("resolveHsn: caching", () => {
  it("serves a success from cache for 24 h, then asks again", async () => {
    const { r, spy } = setup(async () => sb());
    await r.resolveHsn("30041010");
    t += HSN_SUCCESS_TTL_MS - 1;
    await r.resolveHsn("30041010");
    expect(spy).toHaveBeenCalledTimes(1);
    t += 2;
    await r.resolveHsn("30041010");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("caches failures and misses for 60 s only", async () => {
    let fail = true;
    const { r, spy } = setup(async () => {
      if (fail) throw new HsnLookupError("down", "unavailable", 503);
      return sb();
    });
    expect((await r.resolveHsn("30041010")).sandboxStatus).toBe("unavailable");
    t += HSN_NEGATIVE_TTL_MS - 1;
    expect((await r.resolveHsn("30041010")).sandboxStatus).toBe("unavailable");
    expect(spy).toHaveBeenCalledTimes(1);
    fail = false;
    t += 2;
    expect((await r.resolveHsn("30041010")).sandboxStatus).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(2);

    const nf = setup(async () => null);
    await nf.r.resolveHsn("30041010");
    await nf.r.resolveHsn("30041010");
    expect(nf.spy).toHaveBeenCalledTimes(1);
  });

  it("honours the injected clock option", async () => {
    const { r, spy } = setup(async () => sb());
    await r.resolveHsn("30041010", { now: () => 0 });
    await r.resolveHsn("30041010", { now: () => HSN_SUCCESS_TTL_MS + 1 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent lookups of one code into one call", async () => {
    let release!: (v: SandboxHsnResult) => void;
    const { r, spy } = setup(() => new Promise((res) => { release = res; }));
    const all = Promise.all([r.resolveHsn("30041010"), r.resolveHsn("30041010"), r.resolveHsn("30041010")]);
    await Promise.resolve();
    release(sb());
    const out = await all;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.every((x) => x.source === "sandbox")).toBe(true);
  });

  it("bounds the cache (LRU)", async () => {
    const { r } = setup(async (c) => sb({ code: c }), { maxPerMinute: 1e9 });
    for (let i = 0; i < HSN_CACHE_MAX + 5; i++) await r.resolveHsn(String(10000000 + i));
    expect(r.cacheSize()).toBe(HSN_CACHE_MAX);
  });

  it("guards the call rate per process, falling back without calling", async () => {
    const { r, spy } = setup(async (c) => sb({ code: c }), { maxPerMinute: 2 });
    await r.resolveHsn("30041010");
    await r.resolveHsn("30049099");
    const third = await r.resolveHsn("30042019");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(third).toMatchObject({ source: "bundled", sandboxStatus: "unavailable" });
    t += 60_000;
    expect((await r.resolveHsn("30042019")).sandboxStatus).toBe("ok");
  });
});

describe("checkItemHsn", () => {
  it("is null for a blank code and caps the wait at 2.5 s", async () => {
    expect(await checkItemHsn("  ")).toBeNull();
    expect(await checkItemHsn(null)).toBeNull();
  });

  it("returns the compact check shape (default resolver, no Sandbox in tests)", async () => {
    resetHsnLookupForTests();
    const c = await checkItemHsn("30041010");
    expect(c).toMatchObject({ code: "30041010", source: "bundled", sandboxStatus: "not_configured", valid: true });
    expect(c!.description).toBeTruthy();
    expect((await resolveHsn("30041010")).bundled).not.toBeNull();
  });
});

describe("secrets are never logged", () => {
  const KEY = "key_test_FAKE_KEY_123";
  const SECRET = "FAKE_SECRET_456";
  const TOKEN = "FAKE_TOKEN_789";
  let spies: Array<ReturnType<typeof vi.spyOn>>;
  beforeEach(() => {
    spies = (["warn", "error", "info", "debug"] as const).map((m) => vi.spyOn(logger, m).mockImplementation(() => undefined));
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  it("keeps keys, secrets and tokens out of logs and results", async () => {
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).endsWith("/authenticate")) {
        return new Response(JSON.stringify({ data: { access_token: TOKEN } }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `bad ${KEY} ${SECRET} ${TOKEN}` }), { status: 500 });
    }) as unknown as typeof fetch;
    const client = new SandboxHsnClient(new SandboxClient({ apiKey: KEY, apiSecret: SECRET, baseUrl: "https://example.invalid" }, fetchImpl));
    const r = createHsnResolver({ getClient: () => client, bundled: describeHsn, now: () => t, settings: () => ({ enabled: true, timeoutMs: 500 }) });
    const res = await r.resolveHsn("30041010");
    expect(res.sandboxStatus).toBe("unavailable");
    const calls = JSON.stringify(spies.flatMap((s) => s.mock.calls)) + JSON.stringify(res);
    expect(calls).not.toContain(KEY);
    expect(calls).not.toContain(SECRET);
    expect(calls).not.toContain(TOKEN);
    // The failure itself was logged (class and status only).
    expect(spies[0].mock.calls.some((c) => JSON.stringify(c).includes("errorKind"))).toBe(true);
  });
});

describe("resolveHsn: the refreshed layer (live, then refreshed, then bundled)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const row = (over: Partial<SandboxHsnResult> = {}, ageMs = 2 * DAY) => ({
    result: sb({ description: "Refreshed penicillins", rate: 12, ...over }),
    checkedAt: t - ageMs,
  });
  const offline: HsnLookupClient["lookupHsn"] = async () => { throw new HsnLookupError("down", "unavailable", 503); };

  it("uses a row under 30 days old when Sandbox is down, as source refreshed", async () => {
    const { r } = setup(offline, { refreshed: async () => row() });
    const res = await r.resolveHsn("30041010");
    expect(res).toMatchObject({ source: "refreshed", sandboxStatus: "unavailable", valid: true, description: "Refreshed penicillins", rate: 12 });
    expect(res.checkedAt).toBe(new Date(t - 2 * DAY).toISOString());
    expect(res.warning).toBeUndefined();
  });

  it("uses a row when Sandbox is not configured", async () => {
    const r = createHsnResolver({ getClient: () => null, bundled: describeHsn, now: () => t, settings: () => ({ enabled: true, timeoutMs: 2500 }), refreshed: async () => row() });
    expect(await r.resolveHsn("30041010")).toMatchObject({ source: "refreshed", sandboxStatus: "not_configured" });
  });

  it("live Sandbox wins over a refreshed row", async () => {
    const refreshed = vi.fn(async () => row());
    const { r } = setup(async () => sb({ description: "Live answer" }), { refreshed });
    expect(await r.resolveHsn("30041010")).toMatchObject({ source: "sandbox", description: "Live answer" });
    expect(refreshed).not.toHaveBeenCalled();
  });

  it("ignores a row 30 days old or more and falls to the bundled list", async () => {
    const { r } = setup(offline, { refreshed: async () => row({}, 30 * DAY) });
    expect(await r.resolveHsn("30041010")).toMatchObject({ source: "bundled", sandboxStatus: "unavailable" });
    const { r: r2 } = setup(offline, { refreshed: async () => row({}, 29 * DAY) });
    expect((await r2.resolveHsn("30041010")).source).toBe("refreshed");
  });

  it("a refreshed withdrawn code is not valid and carries a warning", async () => {
    const { r } = setup(offline, { refreshed: async () => row({ active: false, inactiveReason: "Merged" }) });
    const res = await r.resolveHsn("30041010");
    expect(res).toMatchObject({ source: "refreshed", valid: false, active: false });
    expect(res.warning).toContain("Merged");
  });

  it("does not use the refreshed layer when Sandbox answers not found, or with liveOnly", async () => {
    const refreshed = vi.fn(async () => row());
    const { r } = setup(async () => null, { refreshed });
    expect(await r.resolveHsn("30041010")).toMatchObject({ source: "bundled", sandboxStatus: "not_found" });
    const { r: r2 } = setup(offline, { refreshed });
    expect(await r2.resolveHsn("30041010", { liveOnly: true })).toMatchObject({ source: "bundled", sandboxStatus: "unavailable" });
    expect(refreshed).not.toHaveBeenCalled();
  });

  it("a throwing refreshed lookup falls back to the bundled list", async () => {
    const { r } = setup(offline, { refreshed: async () => { throw new Error("db down"); } });
    expect(await r.resolveHsn("30041010")).toMatchObject({ source: "bundled", valid: true });
  });
});
