/**
 * Track GST Returns: the adapter against the documented response shapes, the
 * FY / prerequisite helpers, and the never-throwing cached resolver.
 */
import { describe, it, expect } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL } from "../lib/sandbox/client.js";
import { trackGstReturns, TrackError, normalizeReturnType, TRACK_PATH, type TrackedReturn } from "../lib/sandbox/gst-track.js";
import {
  financialYearLabel,
  fyStartYear,
  fyPeriods,
  derivePrerequisite,
  GstTrackResolver,
  RefreshLimiter,
  missingMessage,
} from "../lib/gst-track.js";

const CFG = { apiKey: "key_test_abc", apiSecret: "s", baseUrl: SANDBOX_TEST_URL };
const GSTIN = "27AAAPL1234C1ZV";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Rec { url: string; headers: Record<string, string>; body: unknown; method: string }
function gateway(handler: (n: number) => Response) {
  const calls: Rec[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "jwt-api-token" } });
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method ?? "GET" });
    return handler(calls.length);
  }) as unknown as typeof fetch;
  return { fn, calls, sandbox: new SandboxClient(CFG, fn) };
}

/** The documented row shape; 22 unordered entries across GSTR1 and GSTR3B. */
function sample(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const periods = ["062025", "042025", "122025", "082025", "032026", "102025", "052025", "012026", "072025", "112025", "092025", "022026"];
  periods.forEach((ret_prd, i) => {
    rows.push({ arn: `AA27${ret_prd}0000${i}Z`, dof: `1${i % 9}-${ret_prd.slice(0, 2)}-${ret_prd.slice(2)}`, mof: "GSP", ret_prd, rtntype: "GSTR1", status: "Filed", valid: "Y" });
  });
  periods.slice(0, 10).forEach((ret_prd, i) => {
    rows.push({ arn: `AB27${ret_prd}0000${i}Z`, dof: "20-07-2025", mof: "GSP", ret_prd, rtntype: "GSTR3B", status: "Filed", valid: "Y" });
  });
  return rows;
}
const ok = (list: unknown[]) => json({ code: 200, data: { data: { EFiledlist: list }, status_cd: "1" }, timestamp: 1, transaction_id: "t1" });

describe("trackGstReturns", () => {
  it("POSTs the documented request and returns the 22-entry unordered list sorted by period", async () => {
    const g = gateway(() => ok(sample()));
    const list = await trackGstReturns(g.sandbox, GSTIN, "FY 2025-26", { gstr: "gstr-1" });
    expect(list).toHaveLength(22);
    const c = g.calls[0]!;
    expect(c.method).toBe("POST");
    const u = new URL(c.url);
    expect(u.pathname).toBe(TRACK_PATH);
    expect(c.url).toContain("financial_year=FY%202025-26"); // %20, as in the docs
    expect(u.searchParams.get("financial_year")).toBe("FY 2025-26");
    expect(u.searchParams.get("gstr")).toBe("gstr-1");
    expect(c.body).toEqual({ gstin: GSTIN });
    expect(c.headers).toMatchObject({ authorization: "jwt-api-token", "x-api-key": "key_test_abc", "x-api-version": "1.0.0" });
    expect(c.headers["x-accept-cache"]).toBeUndefined();
    // sorted: oldest period first
    const periods = list.map((r) => `${r.period.slice(2)}${r.period.slice(0, 2)}`);
    expect([...periods].sort()).toEqual(periods);
    expect(list[0]).toMatchObject({ period: "042025", returnType: "gstr1", filed: true, valid: true, mode: "GSP" });
    expect(list[0]!.filedOn).toMatch(/^2025-04-1\d$/);
  });

  it("sends x-accept-cache only when the caller accepts cached data, and omits gstr when not asked", async () => {
    const g = gateway(() => ok([]));
    await trackGstReturns(g.sandbox, GSTIN, "FY 2025-26", { cache: true });
    expect(g.calls[0]!.headers["x-accept-cache"]).toBe("true");
    expect(new URL(g.calls[0]!.url).searchParams.has("gstr")).toBe(false);
  });

  it("RET13510 'No Record found' means nothing filed yet, not a failure", async () => {
    const g = gateway(() => json({ code: 200, data: { error: { error_code: "RET13510", message: "No Record found for the provided Inputs" }, status_cd: "0" } }));
    expect(await trackGstReturns(g.sandbox, GSTIN, "FY 2025-26")).toEqual([]);
  });

  it("RTN_22 is an invalid financial year; other portal errors are failures", async () => {
    const g = gateway(() => json({ code: 200, data: { error: { error_code: "RTN_22", message: "Please select a valid financial year" }, status_cd: "0" } }));
    await expect(trackGstReturns(g.sandbox, GSTIN, "2025-26")).rejects.toMatchObject({ code: "invalid_fy" });
    const h = gateway(() => json({ code: 200, data: { error: { error_code: "X1", message: "Boom" }, status_cd: "0" } }));
    await expect(trackGstReturns(h.sandbox, GSTIN, "FY 2025-26")).rejects.toMatchObject({ code: "X1", message: "Boom" });
  });

  it("HTTP 422 'Invalid GSTIN pattern' is a non-retryable bad_gstin", async () => {
    const g = gateway(() => json({ code: 422, message: "Invalid GSTIN pattern" }, 422));
    const e = await trackGstReturns(g.sandbox, "BAD", "FY 2025-26").catch((x) => x);
    expect(e).toBeInstanceOf(TrackError);
    expect(e).toMatchObject({ code: "bad_gstin", retryable: false });
  });

  it("a gateway outage is retryable", async () => {
    const g = gateway(() => json({ message: "down" }, 503));
    expect(await trackGstReturns(g.sandbox, GSTIN, "FY 2025-26").catch((x) => x)).toMatchObject({ retryable: true });
  });

  it("normalises return types", () => {
    expect(normalizeReturnType("GSTR1")).toBe("gstr1");
    expect(normalizeReturnType("GSTR-3B")).toBe("gstr3b");
  });
});

describe("financial year helpers", () => {
  it("builds 'FY 2025-26' from a period (April starts the year)", () => {
    expect(financialYearLabel(fyStartYear("042025"))).toBe("FY 2025-26");
    expect(financialYearLabel(fyStartYear("032026"))).toBe("FY 2025-26");
    expect(financialYearLabel(fyStartYear({ year: 2026, month: 3 }))).toBe("FY 2025-26");
    expect(financialYearLabel(fyStartYear({ year: 2026, month: 4 }))).toBe("FY 2026-27");
    expect(financialYearLabel(1999)).toBe("FY 1999-00");
    expect(financialYearLabel(2099)).toBe("FY 2099-00");
  });
  it("lists the 12 periods April to March", () => {
    const p = fyPeriods(2025);
    expect(p[0]).toBe("042025");
    expect(p[8]).toBe("122025");
    expect(p[9]).toBe("012026");
    expect(p[11]).toBe("032026");
    expect(p).toHaveLength(12);
  });
});

describe("derivePrerequisite", () => {
  const row = (returnType: string, period: string, over: Partial<TrackedReturn> = {}): TrackedReturn => ({
    arn: `ARN${period}${returnType}`, filedOn: "2025-08-20", mode: "GSP", period, returnType, rawType: returnType.toUpperCase(), status: "Filed", filed: true, valid: true, ...over,
  });
  const g1 = (...ps: string[]) => ps.map((p) => row("gstr1", p));
  const g3 = (...ps: string[]) => ps.map((p) => row("gstr3b", p));
  const both = (...ps: string[]) => [...g1(...ps), ...g3(...ps)];

  it.each([
    ["all earlier periods filed", { kind: "gstr1", period: "082025", filings: g1("042025", "052025", "062025", "072025") }, "ok", []],
    ["gap in the middle", { kind: "gstr1", period: "082025", filings: g1("042025", "062025") }, "missing", ["GSTR-1 May 2025", "GSTR-1 Jul 2025"]],
    ["first period of a new FY needs March of the previous FY", { kind: "gstr1", period: "042026", filings: g1("012026", "022026") }, "missing", ["GSTR-1 Mar 2026"]],
    ["new FY with March filed", { kind: "gstr1", period: "042026", filings: g1("022026", "032026") }, "ok", []],
    ["first-ever return: nothing found, not blocked", { kind: "gstr1", period: "092025", filings: [] }, "ok", []],
    ["periods before the first filing we can see are not demanded", { kind: "gstr1", period: "092025", filings: g1("072025", "082025") }, "ok", []],
    ["3B needs GSTR-1 of the same period", { kind: "gstr3b", period: "082025", filings: [...g3("072025"), ...g1("072025")] }, "missing", ["GSTR-1 Aug 2025"]],
    ["3B with earlier 3B and same-period GSTR-1 filed", { kind: "gstr3b", period: "082025", filings: [...g3("072025"), ...g1("072025", "082025")] }, "ok", []],
    ["3B gap and missing same-period GSTR-1", { kind: "gstr3b", period: "092025", filings: [...g3("062025", "082025"), ...g1("092025")] }, "missing", ["GSTR-3B Jul 2025"]],
    ["quarterly filer: quarter-end months only", { kind: "gstr1", period: "092025", frequency: "quarterly", filings: g1("032025", "062025") }, "ok", []],
    ["quarterly filer with a missing quarter", { kind: "gstr1", period: "122025", frequency: "quarterly", filings: g1("032025", "092025") }, "missing", ["GSTR-1 Jun 2025"]],
    ["composition dealers skip the prerequisite", { kind: "gstr1", period: "082025", filings: [], composition: true }, "skipped", []],
    ["portal unreachable: unknown, never a block", { kind: "gstr1", period: "082025", filings: null }, "unknown", []],
  ] as const)("%s", (_name, input, verdict, missing) => {
    const r = derivePrerequisite(input as never);
    expect(r.verdict).toBe(verdict);
    expect(r.missing.map((m) => m.label)).toEqual(missing);
  });

  it("reports a return the portal already shows as filed, with ARN, date and valid flag", () => {
    const r = derivePrerequisite({ kind: "gstr1", period: "082025", filings: g1("072025", "082025") });
    expect(r.alreadyFiled).toMatchObject({ arn: "ARN082025gstr1", filedOn: "2025-08-20", valid: true });
  });

  it("a Not-filed or other-type row does not count as filed", () => {
    const r = derivePrerequisite({ kind: "gstr1", period: "082025", filings: [row("gstr1", "062025"), row("gstr1", "072025", { status: "Not Filed", filed: false }), row("gstr3b", "072025")] });
    expect(r.missing.map((m) => m.label)).toEqual(["GSTR-1 Jul 2025"]);
    expect(missingMessage(r)).toBe("File these returns first: GSTR-1 Jul 2025.");
  });

  it("says when monthly filing is only assumed", () => {
    const r = derivePrerequisite({ kind: "gstr1", period: "082025", filings: g1("072025"), frequencyAssumed: true });
    expect(r.notes.join(" ")).toMatch(/monthly filing is assumed/);
    void both;
  });
});

describe("GstTrackResolver", () => {
  const filing = (period: string): TrackedReturn => ({ arn: "A", filedOn: null, mode: null, period, returnType: "gstr1", rawType: "GSTR1", status: "Filed", filed: true, valid: true });

  function mk(opts: { fail?: boolean; sandbox?: boolean } = {}) {
    const clock = { t: 0 };
    const calls: Array<{ fy: string; cache?: boolean }> = [];
    const r = new GstTrackResolver({
      sandbox: () => (opts.sandbox === false ? null : ({} as never)),
      now: () => clock.t,
      track: (async (_s: unknown, _g: string, fy: string, o: { cache?: boolean }) => {
        calls.push({ fy, cache: o.cache });
        if (opts.fail) throw new Error("boom");
        return [filing("042025")];
      }) as never,
    });
    return { r, clock, calls };
  }

  it("caches display lookups for 5 minutes and accepts Sandbox's cache for them", async () => {
    const { r, clock, calls } = mk();
    expect(await r.track(GSTIN, 2025)).toMatchObject({ status: "ok", cached: false });
    expect(await r.track(GSTIN, 2025)).toMatchObject({ status: "ok", cached: true });
    expect(calls).toEqual([{ fy: "FY 2025-26", cache: true }]);
    clock.t += 5 * 60_000 + 1;
    expect(await r.track(GSTIN, 2025)).toMatchObject({ cached: false });
    expect(calls).toHaveLength(2);
  });

  it("a fresh lookup (refresh, pre-filing) skips both caches", async () => {
    const { r, calls } = mk();
    await r.track(GSTIN, 2025);
    await r.track(GSTIN, 2025, { fresh: true });
    expect(calls).toEqual([{ fy: "FY 2025-26", cache: true }, { fy: "FY 2025-26", cache: false }]);
  });

  it("the prerequisite always goes fresh, and looks at March of the previous FY for April", async () => {
    const { r, calls } = mk();
    await r.prerequisite({ gstin: GSTIN, kind: "gstr1", period: "042026" });
    expect(calls.map((c) => c.fy).sort()).toEqual(["FY 2025-26", "FY 2026-27"]);
    expect(calls.every((c) => c.cache === false)).toBe(true);
    calls.length = 0;
    await r.prerequisite({ gstin: GSTIN, kind: "gstr1", period: "082026" });
    expect(calls.map((c) => c.fy)).toEqual(["FY 2026-27"]);
  });

  it("never throws: failures and a missing Sandbox become 'unavailable' / 'unknown'", async () => {
    const bad = mk({ fail: true });
    expect(await bad.r.track(GSTIN, 2025)).toMatchObject({ status: "unavailable" });
    expect(await bad.r.prerequisite({ gstin: GSTIN, kind: "gstr3b", period: "082025" })).toMatchObject({ verdict: "unknown", missing: [] });
    const none = mk({ sandbox: false });
    expect(await none.r.track(GSTIN, 2025)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("not configured") });
    expect(await none.r.prerequisite({ gstin: GSTIN, kind: "gstr1", period: "082025" })).toMatchObject({ verdict: "unknown" });
  });

  it("composition dealers make no tracker call", async () => {
    const { r, calls } = mk();
    expect(await r.prerequisite({ gstin: GSTIN, kind: "gstr1", period: "082025", composition: true })).toMatchObject({ verdict: "skipped" });
    expect(calls).toHaveLength(0);
  });
});

describe("RefreshLimiter", () => {
  it("allows 6 uncached refreshes a minute per business", () => {
    let t = 0;
    const l = new RefreshLimiter(6, 60_000, () => t);
    for (let i = 0; i < 6; i++) expect(l.take("b1")).toBe(true);
    expect(l.take("b1")).toBe(false);
    expect(l.take("b2")).toBe(true);
    t += 60_001;
    expect(l.take("b1")).toBe(true);
  });
});
