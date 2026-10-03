import { describe, it, expect } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL } from "../lib/sandbox/client.js";
import {
  keyKind,
  maskKey,
  guardRun,
  parseSandboxEnv,
  resolveSandboxEnv,
  parseArgs,
  sanitise,
  diffShape,
  getPath,
  verdictOf,
  runCheck,
  runChecks,
  buildReport,
  type SmokeCheck,
  type SmokeContext,
} from "../lib/sandbox/smoke.js";
import { allChecks, registerCheck, createSmokeContext } from "../lib/sandbox/smoke-checks.js";

const KEY = "key_test_abcdef1234567890";
const SECRET = "secret_zyxwvu9876543210";
// A syntactically valid, obviously fake JWT.
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQ3MDAwMDAwMDAsInN1YiI6IngifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

describe("key guard", () => {
  it("classifies keys", () => {
    expect(keyKind("key_test_x")).toBe("test");
    expect(keyKind("key_live_x")).toBe("live");
    expect(keyKind("sk_whatever")).toBe("unknown");
    expect(keyKind(undefined)).toBe("unknown");
  });

  it("masks everything after the type prefix", () => {
    expect(maskKey(KEY)).toBe("key_test_••••••••");
    expect(maskKey(KEY)).not.toContain("abcdef");
    expect(maskKey("key_live_zzz")).toBe("key_live_••••••••");
    expect(maskKey("nonsense_secret_value")).not.toContain("secret_value");
  });

  it("runs for test keys", () => {
    const g = guardRun({ apiKey: KEY, apiSecret: SECRET, baseUrl: SANDBOX_TEST_URL, allowLive: false });
    expect(g).toMatchObject({ ok: true, kind: "test", readOnlyOnly: false });
  });

  it("refuses a live key without --allow-live and runs read-only with it", () => {
    const refuse = guardRun({ apiKey: "key_live_abc", apiSecret: SECRET, baseUrl: "https://api.sandbox.co.in", allowLive: false });
    expect(refuse.ok).toBe(false);
    const allow = guardRun({ apiKey: "key_live_abc", apiSecret: SECRET, baseUrl: "https://api.sandbox.co.in", allowLive: true });
    expect(allow).toMatchObject({ ok: true, kind: "live", readOnlyOnly: true });
    expect(allow.ok && allow.warnings.length).toBeGreaterThan(0);
  });

  it("never runs with an unrecognised key, even with --allow-live", () => {
    expect(guardRun({ apiKey: "abc", apiSecret: SECRET, baseUrl: SANDBOX_TEST_URL, allowLive: true }).ok).toBe(false);
  });

  it("refuses missing credentials and a test key aimed at the live host", () => {
    expect(guardRun({ apiKey: KEY, baseUrl: SANDBOX_TEST_URL, allowLive: false }).ok).toBe(false);
    expect(guardRun({ apiKey: KEY, apiSecret: SECRET, baseUrl: "https://api.sandbox.co.in", allowLive: true }).ok).toBe(false);
  });

  it("refusal reasons never contain the key", () => {
    const g = guardRun({ apiKey: "key_live_supersecretvalue", apiSecret: SECRET, baseUrl: "https://api.sandbox.co.in", allowLive: false });
    expect(JSON.stringify(g)).not.toContain("supersecretvalue");
  });
});

describe("environment and arguments", () => {
  it("parses only the SANDBOX_* names from .env text", () => {
    const text = [`SANDBOX_API_KEY="${KEY}"`, `export SANDBOX_API_SECRET=${SECRET} # note`, "DATABASE_URL=postgres://u:p@h/db", "SANDBOX_BASE_URL=", "# SANDBOX_API_VERSION=2"].join("\n");
    expect(parseSandboxEnv(text)).toEqual({ SANDBOX_API_KEY: KEY, SANDBOX_API_SECRET: SECRET });
  });

  it("lets the process environment win over .env", () => {
    const env = resolveSandboxEnv({ SANDBOX_API_KEY: "key_test_fromshell" } as NodeJS.ProcessEnv, `SANDBOX_API_KEY=${KEY}\nSANDBOX_API_SECRET=${SECRET}`);
    expect(env.SANDBOX_API_KEY).toBe("key_test_fromshell");
    expect(env.SANDBOX_API_SECRET).toBe(SECRET);
  });

  it("accepts known flags only and never echoes an unknown argument", () => {
    expect(parseArgs(["--allow-live", "--only=a,b", "--no-file"])).toEqual({ ok: true, args: { allowLive: true, list: false, only: ["a", "b"], noFile: true } });
    const bad = parseArgs([KEY]);
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("abcdef");
  });
});

describe("sanitise", () => {
  it("redacts secret-looking keys, JWTs and literal secrets anywhere", () => {
    const out = sanitise(
      {
        authorization: JWT,
        "x-api-key": KEY,
        data: { access_token: JWT, note: `bearer ${JWT} and ${SECRET}`, nested: { password: "pw", name: "Acme" } },
        message: `key ${KEY} rejected`,
      },
      { secrets: [KEY, SECRET] },
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain("abcdef1234567890");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("pw");
    expect(text).toContain("Acme");
    expect((out as { authorization: string }).authorization).toBe("[REDACTED]");
  });

  it("masks a bare sandbox key even when it is not a known secret", () => {
    expect(String(sanitise("see key_live_ABCdef123 now"))).toBe("see key_live_•••• now");
  });

  it("truncates arrays to 3 items, long strings and deep trees", () => {
    const out = sanitise({ list: [1, 2, 3, 4, 5], long: "x".repeat(1000) }) as { list: unknown[]; long: string };
    expect(out.list).toEqual([1, 2, 3, "…(+2 more)"]);
    expect(out.long.length).toBeLessThan(400);
    let deep: unknown = "leaf";
    for (let i = 0; i < 12; i++) deep = { a: deep };
    expect(JSON.stringify(sanitise(deep))).toContain("max depth");
  });
});

describe("shape diffing", () => {
  const exp = { required: ["data.data.EFiledlist[].arn", "data.data.EFiledlist[].status"], extraTopLevel: ["code"] };
  it("reads dotted paths and array first elements", () => {
    expect(getPath({ a: [{ b: 1 }] }, "a[].b")).toBe(1);
    expect(getPath({ a: [] }, "a[].b")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
  it("reports present keys, missing fields and unexpected top-level keys", () => {
    const d = diffShape({ code: 200, data: { data: { EFiledlist: [{ arn: "x" }] } }, surprise: 1 }, exp);
    expect(d.keysPresent).toEqual(["code", "data", "surprise"]);
    expect(d.missingFields).toEqual(["data.data.EFiledlist[].status"]);
    expect(d.unexpectedKeys).toEqual(["surprise"]);
  });
  it("handles a non-object body", () => {
    expect(diffShape("oops", exp)).toMatchObject({ keysPresent: [], missingFields: exp.required });
  });
});

describe("verdicts and runner", () => {
  const ctxStub = { now: () => 1000 } as unknown as SmokeContext;
  const base = { ok: true, observedPath: "/x", notes: [], missingFields: [] as string[] };

  it("maps outcomes to PASS / PASS-WITH-DIFFERENCES / FAIL", () => {
    expect(verdictOf(base)).toBe("PASS");
    expect(verdictOf({ ...base, missingFields: ["a"] })).toBe("PASS-WITH-DIFFERENCES");
    expect(verdictOf({ ...base, unexpectedKeys: ["z"] })).toBe("PASS-WITH-DIFFERENCES");
    expect(verdictOf({ ...base, unexpectedShape: "s" })).toBe("PASS-WITH-DIFFERENCES");
    expect(verdictOf({ ...base, ok: false })).toBe("FAIL");
  });

  it("turns a throwing check into a FAIL instead of crashing", async () => {
    const r = await runCheck({ id: "t", title: "t", kind: "read-only", run: async () => { throw new Error("boom"); } }, ctxStub);
    expect(r.verdict).toBe("FAIL");
    expect(r.notes.join(" ")).toContain("boom");
  });

  it("refuses a check that is not read-only", async () => {
    const bad = { id: "w", title: "w", kind: "write", run: async () => base } as unknown as SmokeCheck;
    expect((await runCheck(bad, ctxStub)).verdict).toBe("FAIL");
  });

  it("skips the rest when authentication fails", async () => {
    const mk = (id: string, ok: boolean): SmokeCheck => ({ id, title: id, kind: "read-only", run: async () => ({ ...base, ok }) });
    const res = await runChecks([mk("auth-token", false), mk("other", true)], ctxStub);
    expect(res.map((r) => r.verdict)).toEqual(["FAIL", "SKIPPED"]);
  });

  it("rejects duplicate ids and non read-only checks at registration", () => {
    const first = allChecks()[0];
    expect(() => registerCheck(first)).toThrow(/Duplicate/);
    expect(() => registerCheck({ id: "zz", title: "zz", kind: "write" as "read-only", run: async () => base })).toThrow(/read-only/);
  });
});

// ── Whole run against a mocked gateway: no network, no database ──

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gateway() {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    calls.push({ method: init?.method ?? "GET", url: String(url), headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
    if (u.pathname === "/authenticate") return json({ code: 200, timestamp: 1, transaction_id: "t", data: { access_token: JWT } });
    if (u.pathname === "/gst/hsn-sac/5208") return json({ code: 200, data: { hsn_code: "5208", description: "Cotton fabrics", gst_rate: 5 } });
    if (u.pathname === "/gst/hsn-sac/998313") return json({ message: "Not Found" }, 404);
    if (u.pathname === "/kyc/pan/verify") return json({ code: 200, data: { status: "invalid" }, extra: true });
    if (u.pathname === "/tds/tan/verify") return json({ message: "Invalid TAN", code: 422 }, 422);
    if (u.pathname === "/gst/compliance/public/gstin/search") {
      const g = JSON.parse(init?.body as string).gstin;
      if (g === "3418FIN00001UNY") return json({ message: "Invalid pattern" }, 422);
      if (g === "07CQZCD1111I4Z7") return json({ code: 200, data: { error: { code: "FO8000" } } });
      return json({ code: 200, data: { data: { gstin: g, sts: "Active" } } });
    }
    if (u.pathname === "/gst/compliance/public/gstrs/track") {
      const fy = u.searchParams.get("financial_year");
      if (fy === "FY 2025-27") return json({ code: 200, data: { error: { error_cd: "RTN_22" } } });
      const g = JSON.parse(init?.body as string).gstin;
      if (g === "3418FIN00001UNY") return json({ message: "Invalid pattern" }, 422);
      return json({ code: 200, data: { data: { EFiledlist: [{ arn: "A", dof: "d", mof: "m", ret_prd: "042025", rtntype: "GSTR1", status: "Filed", valid: "Y" }] } } });
    }
    return json({ message: "no route" }, 404);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("end-to-end run against a mocked gateway", () => {
  it("runs every registered check without network or database and produces a clean report", async () => {
    const { fn, calls } = gateway();
    const noop = { onFailure() {}, onSuccess() {} };
    const client = new SandboxClient({ apiKey: KEY, apiSecret: SECRET, baseUrl: SANDBOX_TEST_URL }, fn, undefined, noop);
    const ctx = createSmokeContext({ client, baseUrl: SANDBOX_TEST_URL, apiKey: KEY, apiSecret: SECRET, fetchImpl: fn });
    const results = await runChecks(allChecks(), ctx);
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));

    expect(byId["auth-token"]).toMatchObject({ verdict: "PASS", httpStatus: 200 });
    expect(byId["hsn-goods"]).toMatchObject({ verdict: "PASS", httpStatus: 200 });
    expect(byId["hsn-service"]).toMatchObject({ verdict: "FAIL", httpStatus: 404 });
    expect(byId["pan-verify"]).toMatchObject({ verdict: "PASS-WITH-DIFFERENCES" });
    expect(byId["pan-verify"].unexpectedKeys).toEqual(["extra"]);
    expect(byId["tan-verify"]).toMatchObject({ verdict: "PASS", httpStatus: 422 });
    expect(byId["gstin-search-active"].verdict).toBe("PASS");
    expect(byId["gstin-search-no-records"].verdict).toBe("PASS");
    expect(byId["gstin-search-invalid-pattern"]).toMatchObject({ verdict: "PASS", httpStatus: 422 });
    expect(byId["gst-track-success"].verdict).toBe("PASS");
    expect(byId["gst-track-gstr1"].observedPath).toContain("gstr=gstr-1");
    expect(byId["gst-track-invalid-fy"].verdict).toBe("PASS");
    expect(byId["gst-track-invalid-pattern"].verdict).toBe("PASS");

    // Only reads: no state-changing verbs besides the documented POST lookups.
    for (const c of calls) {
      expect(c.url).not.toMatch(/generate|cancel|file|proceed|save|\/otp/);
    }
    // GSTIN search / track send the documented headers.
    const search = calls.find((c) => c.url.includes("gstin/search"));
    expect(search?.headers["x-api-key"]).toBe(KEY);
    expect(search?.headers["x-api-version"]).toBe("1.0.0");
    expect(search?.headers.authorization).toBeTruthy();

    const { json: rj, markdown } = buildReport({
      env: { keyKind: "test", maskedKey: maskKey(KEY), host: "test-api.sandbox.co.in", apiVersion: "1.0.0", readOnlyOnly: false, warnings: [] },
      results,
      generatedAt: "2026-01-01T00:00:00.000Z",
      secrets: [KEY, SECRET],
    });
    const everything = JSON.stringify(rj) + markdown;
    for (const secret of [KEY, SECRET, JWT, "abcdef1234567890", "c2lnbmF0dXJl"]) expect(everything).not.toContain(secret);
    expect(markdown).toContain("## Manual test-environment checklist");
    expect(markdown).toMatch(/\| auth-token \| PASS \|/);
    expect(rj.summary.total).toBe(results.length);
    expect(rj.summary.fail).toBe(1);
  });

  it("reports a funding failure clearly and skips the rest on bad credentials", async () => {
    const fn = (async (url: string | URL) =>
      String(url).endsWith("/authenticate") ? json({ message: "Invalid credentials" }, 401) : json({}, 200)) as unknown as typeof fetch;
    const client = new SandboxClient({ apiKey: KEY, apiSecret: SECRET, baseUrl: SANDBOX_TEST_URL }, fn, undefined, { onFailure() {}, onSuccess() {} });
    const ctx = createSmokeContext({ client, baseUrl: SANDBOX_TEST_URL, apiKey: KEY, apiSecret: SECRET, fetchImpl: fn });
    const results = await runChecks(allChecks(), ctx);
    expect(results[0]).toMatchObject({ id: "auth-token", verdict: "FAIL", httpStatus: 401 });
    expect(results.slice(1).every((r) => r.verdict === "SKIPPED")).toBe(true);
  });
});
