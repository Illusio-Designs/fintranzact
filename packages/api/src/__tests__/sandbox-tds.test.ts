import { describe, it, expect } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL } from "../lib/sandbox/client.js";
import { SandboxTdsClient, TdsApiError, TDS_API_PATHS } from "../lib/sandbox/tds.js";

const CFG = { apiKey: "key_test_abc", apiSecret: "s", baseUrl: SANDBOX_TEST_URL };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gateway(route: (init: RequestInit, url: string) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "api" } });
    return route(init ?? {}, u);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const mk = (fn: typeof fetch) => new SandboxTdsClient(new SandboxClient(CFG, fn));

describe("verifyPan", () => {
  it("returns valid and name match, sending the name", async () => {
    const { fn, calls } = gateway(() =>
      json({ code: 200, transaction_id: "t1", data: { status: "VALID", name_as_per_pan_match: true } }));
    const r = await mk(fn).verifyPan(" abcde1234f ", "Acme Traders");
    expect(r).toMatchObject({ pan: "ABCDE1234F", valid: true, status: "valid", nameMatch: true, dobMatch: null, transactionId: "t1" });
    const last = calls.at(-1)!;
    expect(last.url).toContain(TDS_API_PATHS.verifyPan());
    expect(JSON.parse(last.init.body as string)).toMatchObject({ pan: "ABCDE1234F", name_as_per_pan: "Acme Traders" });
  });

  it("reports an invalid PAN and a name mismatch", async () => {
    const { fn } = gateway(() => json({ code: 200, data: { status: "invalid" } }));
    expect(await mk(fn).verifyPan("ABCDE1234F")).toMatchObject({ valid: false, status: "invalid" });
    const g2 = gateway(() => json({ code: 200, data: { status: "valid", name_as_per_pan_match: false } }));
    expect(await mk(g2.fn).verifyPan("ABCDE1234F", "X")).toMatchObject({ valid: true, nameMatch: false });
  });

  it("rejects a malformed PAN without calling the gateway", async () => {
    const { fn, calls } = gateway(() => json({ code: 200, data: {} }));
    expect(await mk(fn).verifyPan("BAD")).toMatchObject({ valid: false, status: "invalid_format" });
    expect(calls).toHaveLength(0);
  });

  it("wraps gateway failures in TdsApiError with the retryable flag", async () => {
    const down = gateway(() => json({ message: "busy" }, 503));
    const e = await mk(down.fn).verifyPan("ABCDE1234F").catch((x) => x);
    expect(e).toBeInstanceOf(TdsApiError);
    expect(e.retryable).toBe(true);
    const bad = gateway(() => json({ message: "nope" }, 422));
    const e2 = await mk(bad.fn).verifyPan("ABCDE1234F").catch((x) => x);
    expect(e2).toBeInstanceOf(TdsApiError);
    expect(e2.retryable).toBe(false);
  });

  it("errors when the gateway returns no data", async () => {
    const { fn } = gateway(() => json({ code: 200 }));
    await expect(mk(fn).verifyPan("ABCDE1234F")).rejects.toBeInstanceOf(TdsApiError);
  });
});

describe("verifyTan", () => {
  it("returns the deductor name", async () => {
    const { fn, calls } = gateway(() => json({ code: 200, data: { name: "ACME LTD", status: "valid" } }));
    const r = await mk(fn).verifyTan("mumA12345b");
    expect(r).toMatchObject({ tan: "MUMA12345B", valid: true, name: "ACME LTD" });
    expect(calls.at(-1)!.url).toContain(TDS_API_PATHS.verifyTan());
  });

  it("rejects a malformed TAN locally and maps failures", async () => {
    const { fn, calls } = gateway(() => json({ message: "x" }, 429));
    expect(await mk(fn).verifyTan("123")).toMatchObject({ valid: false, status: "invalid_format" });
    expect(calls).toHaveLength(0);
    const e = await mk(fn).verifyTan("MUMA12345B").catch((x) => x);
    expect(e).toBeInstanceOf(TdsApiError);
    expect(e.retryable).toBe(true);
  });
});
