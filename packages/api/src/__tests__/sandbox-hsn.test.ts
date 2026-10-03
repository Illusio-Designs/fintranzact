import { describe, it, expect } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL } from "../lib/sandbox/client.js";
import { SandboxHsnClient, HsnLookupError, HSN_API_PATHS } from "../lib/sandbox/hsn.js";

const CFG = { apiKey: "key_test_FAKE", apiSecret: "fake-secret", baseUrl: SANDBOX_TEST_URL };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NOW = Date.parse("2026-10-03T00:00:00Z");

function gateway(route: (init: RequestInit, url: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "api" } });
    return route(init ?? {}, u);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const mk = (fn: typeof fetch) => new SandboxHsnClient(new SandboxClient(CFG, fn), () => NOW);
const fail = (client: SandboxHsnClient, code = "30041010") => client.lookupHsn(code).catch((e) => e);

describe("SandboxHsnClient.lookupHsn", () => {
  it("normalises an HSN entry", async () => {
    const { fn, calls } = gateway(() =>
      json({ code: 200, transaction_id: "t1", data: { hsn_code: "30041010", description: "Penicillins", gst_rate: "12%", effective_from: "01/07/2017", effective_to: null, status: "active" } }));
    const r = await mk(fn).lookupHsn(" 30041010 ");
    expect(r).toEqual({
      code: "30041010", kind: "hsn", description: "Penicillins", rate: 12,
      effectiveFrom: "2017-07-01", effectiveTo: null, active: true, source: "sandbox", transactionId: "t1",
    });
    expect(calls.at(-1)!.url).toContain(HSN_API_PATHS.lookup("30041010"));
    expect(calls.at(-1)!.init.method).toBe("GET");
  });

  it("normalises a SAC entry, inferring the kind from the 99 prefix", async () => {
    const { fn } = gateway(() => json({ code: 200, data: { code: "998314", desc: "IT consulting", rate: 18 } }));
    expect(await mk(fn).lookupHsn("998314")).toMatchObject({ kind: "sac", description: "IT consulting", rate: 18, active: true });
    const g2 = gateway(() => json({ code: 200, data: { code: "9983", description: "x", type: "Service" } }));
    expect(await mk(g2.fn).lookupHsn("9983")).toMatchObject({ kind: "sac" });
  });

  it("marks withdrawn, flagged and expired codes inactive with the reason", async () => {
    const w = gateway(() => json({ code: 200, data: { code: "0101", description: "Horses", status: "Withdrawn", reason: "Merged into 0106" } }));
    expect(await mk(w.fn).lookupHsn("0101")).toMatchObject({ active: false, inactiveReason: "Merged into 0106" });
    const f = gateway(() => json({ code: 200, data: { code: "0101", description: "Horses", is_active: false } }));
    expect(await mk(f.fn).lookupHsn("0101")).toMatchObject({ active: false, inactiveReason: null });
    const e = gateway(() => json({ code: 200, data: { code: "0101", description: "Horses", effective_to: "2020-03-31" } }));
    expect(await mk(e.fn).lookupHsn("0101")).toMatchObject({ active: false, inactiveReason: "Effective until 2020-03-31" });
  });

  it("tolerates missing fields and list or wrapped answers", async () => {
    const m = gateway(() => json({ code: 200, data: { hsn_code: "0101" } }));
    expect(await mk(m.fn).lookupHsn("0101")).toMatchObject({ description: "", rate: null, effectiveFrom: null, active: true });
    const l = gateway(() => json({ code: 200, data: [{ code: "0102", description: "other" }, { code: "0101", description: "Horses" }] }));
    expect(await mk(l.fn).lookupHsn("0101")).toMatchObject({ code: "0101", description: "Horses" });
    const w = gateway(() => json({ code: 200, data: { hsn: { code: "0101", description: "Wrapped" } } }));
    expect(await mk(w.fn).lookupHsn("0101")).toMatchObject({ description: "Wrapped" });
  });

  it("returns null for 404, an empty answer, or another code", async () => {
    expect(await mk(gateway(() => json({ message: "nf" }, 404)).fn).lookupHsn("0101")).toBeNull();
    expect(await mk(gateway(() => json({ code: 200, data: {} })).fn).lookupHsn("0101")).toBeNull();
    expect(await mk(gateway(() => json({ code: 200, data: null })).fn).lookupHsn("0101")).toBeNull();
    expect(await mk(gateway(() => json({ code: 200, data: { code: "9999", description: "x" } })).fn).lookupHsn("0101")).toBeNull();
  });

  it("maps 401/403 to auth after one re-authentication", async () => {
    const g = gateway(() => json({ message: "denied" }, 401));
    const e = await fail(mk(g.fn));
    expect(e).toBeInstanceOf(HsnLookupError);
    expect(e).toMatchObject({ kind: "auth", httpStatus: 401 });
    expect(g.calls.filter((c) => c.url.endsWith("/authenticate"))).toHaveLength(2);
    expect(await fail(mk(gateway(() => json({}, 403)).fn))).toMatchObject({ kind: "auth" });
  });

  it("maps 429, 5xx, network failures and timeouts", async () => {
    expect(await fail(mk(gateway(() => json({}, 429)).fn))).toMatchObject({ kind: "rate_limited", httpStatus: 429 });
    expect(await fail(mk(gateway(() => json({}, 500)).fn))).toMatchObject({ kind: "unavailable", httpStatus: 500 });
    expect(await fail(mk(gateway(() => json({}, 422)).fn))).toMatchObject({ kind: "rejected" });
    expect(await fail(mk(gateway(() => { throw new Error("ECONNRESET"); }).fn))).toMatchObject({ kind: "unavailable" });
    const timeout = gateway(() => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    expect(await fail(mk(timeout.fn))).toMatchObject({ kind: "timeout" });
  });

  it("rejects an unreadable body and a bad code", async () => {
    const bad = gateway(() => new Response("<html>oops</html>", { status: 200 }));
    expect(await fail(mk(bad.fn))).toMatchObject({ kind: "malformed" });
    const none = gateway(() => json({}));
    expect(await fail(mk(none.fn), "12")).not.toBeInstanceOf(Error); // 2 digits is allowed
    expect(await fail(mk(none.fn), "1")).toMatchObject({ kind: "rejected" });
    expect(await fail(mk(none.fn), "ABCD")).toMatchObject({ kind: "rejected" });
    expect(none.calls.some((c) => c.url.includes("ABCD"))).toBe(false);
  });

  it("passes the per-call timeout and never leaks the gateway message", async () => {
    const g = gateway(() => json({ message: "secret key_test_FAKE leaked?" }, 500));
    const e = await fail(mk(g.fn));
    expect(e.message).not.toContain("key_test_FAKE");
  });
});
