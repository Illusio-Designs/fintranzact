import { describe, it, expect, vi } from "vitest";
import {
  SandboxClient,
  SandboxError,
  sandboxConfigFromEnv,
  SANDBOX_LIVE_URL,
  SANDBOX_TEST_URL,
} from "../lib/sandbox/client.js";

const CONFIG = { apiKey: "key_test_abc", apiSecret: "secret_xyz", baseUrl: SANDBOX_TEST_URL };
const CREDS = { gstin: "27AAAPL1234C1ZV", username: "api_user", password: "pw1" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { url: string; init: RequestInit };
function mockFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe("sandboxConfigFromEnv", () => {
  it("returns null when key or secret is missing", () => {
    expect(sandboxConfigFromEnv({})).toBeNull();
    expect(sandboxConfigFromEnv({ SANDBOX_API_KEY: "key_test_a" })).toBeNull();
  });

  it("picks the host from the key prefix", () => {
    expect(sandboxConfigFromEnv({ SANDBOX_API_KEY: "key_test_a", SANDBOX_API_SECRET: "s" })?.baseUrl).toBe(SANDBOX_TEST_URL);
    expect(sandboxConfigFromEnv({ SANDBOX_API_KEY: "key_live_a", SANDBOX_API_SECRET: "s" })?.baseUrl).toBe(SANDBOX_LIVE_URL);
  });

  it("lets SANDBOX_BASE_URL override and strips trailing slashes", () => {
    const cfg = sandboxConfigFromEnv({ SANDBOX_API_KEY: "key_live_a", SANDBOX_API_SECRET: "s", SANDBOX_BASE_URL: "http://localhost:9/" });
    expect(cfg?.baseUrl).toBe("http://localhost:9");
  });
});

describe("SandboxClient API token", () => {
  it("authenticates with key + secret and sends the raw token (no Bearer)", async () => {
    const { fn, calls } = mockFetch((c) =>
      c.url.endsWith("/authenticate")
        ? json({ code: 200, data: { access_token: "tok1" } })
        : json({ code: 200, data: { ok: true } }),
    );
    const client = new SandboxClient(CONFIG, fn);
    const res = await client.request("POST", "/tcs/calculator", { body: { a: 1 } });

    expect(res.data).toEqual({ ok: true });
    expect(calls[0].url).toBe(`${SANDBOX_TEST_URL}/authenticate`);
    expect(header(calls[0], "x-api-key")).toBe("key_test_abc");
    expect(header(calls[0], "x-api-secret")).toBe("secret_xyz");
    expect(header(calls[0], "authorization")).toBeUndefined();
    expect(header(calls[1], "authorization")).toBe("tok1");
    expect(header(calls[1], "x-api-secret")).toBeUndefined();
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ a: 1 });
  });

  it("caches the token and only authenticates once for concurrent calls", async () => {
    const { fn, calls } = mockFetch((c) =>
      c.url.endsWith("/authenticate") ? json({ code: 200, data: { access_token: "tok1" } }) : json({ code: 200, data: {} }),
    );
    const client = new SandboxClient(CONFIG, fn);
    await Promise.all([client.request("GET", "/a"), client.request("GET", "/b"), client.request("GET", "/c")]);
    await client.request("GET", "/d");
    expect(calls.filter((c) => c.url.endsWith("/authenticate"))).toHaveLength(1);
  });

  it("re-authenticates after the 24h token nears expiry", async () => {
    let t = 1_000_000;
    let n = 0;
    const { fn, calls } = mockFetch((c) =>
      c.url.endsWith("/authenticate") ? json({ code: 200, data: { access_token: `tok${++n}` } }) : json({ code: 200, data: {} }),
    );
    const client = new SandboxClient(CONFIG, fn, () => t);
    await client.request("GET", "/a");
    t += 23 * 60 * 60 * 1000; // still inside the window
    await client.request("GET", "/a");
    expect(calls.filter((c) => c.url.endsWith("/authenticate"))).toHaveLength(1);
    t += 60 * 60 * 1000; // past 24h minus the safety margin
    await client.request("GET", "/a");
    expect(calls.filter((c) => c.url.endsWith("/authenticate"))).toHaveLength(2);
    expect(header(calls[calls.length - 1], "authorization")).toBe("tok2");
  });

  it("retries once with a fresh token on 401", async () => {
    let n = 0;
    const { fn, calls } = mockFetch((c) => {
      if (c.url.endsWith("/authenticate")) return json({ code: 200, data: { access_token: `tok${++n}` } });
      return header(c, "authorization") === "tok1" ? json({ code: 401, message: "expired" }, 401) : json({ code: 200, data: { ok: 1 } });
    });
    const client = new SandboxClient(CONFIG, fn);
    const res = await client.request("GET", "/x");
    expect(res.data).toEqual({ ok: 1 });
    expect(calls.filter((c) => c.url.endsWith("/authenticate"))).toHaveLength(2);
  });

  it("throws when authentication returns no token", async () => {
    const { fn } = mockFetch(() => json({ code: 200, data: {} }));
    await expect(new SandboxClient(CONFIG, fn).request("GET", "/x")).rejects.toMatchObject({ code: "auth" });
  });
});

describe("SandboxClient errors", () => {
  const authed = (handler: (c: Call) => Response) =>
    mockFetch((c) => (c.url.endsWith("/authenticate") ? json({ code: 200, data: { access_token: "t" } }) : handler(c)));

  it("maps HTTP errors with message, code and transaction id", async () => {
    const { fn } = authed(() => json({ code: 422, message: "Invalid GSTIN pattern", transaction_id: "tx-1" }, 422));
    const err = await new SandboxClient(CONFIG, fn).request("POST", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toMatchObject({ message: "Invalid GSTIN pattern", code: "422", httpStatus: 422, transactionId: "tx-1" });
    expect(err.isRetryable).toBe(false);
  });

  it("treats 5xx and 429 as retryable", async () => {
    for (const status of [429, 500, 503]) {
      const { fn } = authed(() => json({ message: "x" }, status));
      const err = await new SandboxClient(CONFIG, fn).request("GET", "/x").catch((e) => e);
      expect(err.isRetryable).toBe(true);
    }
  });

  it("maps network failures and timeouts", async () => {
    const net = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const e1 = await new SandboxClient(CONFIG, net.fn).request("GET", "/x").catch((e) => e);
    expect(e1).toMatchObject({ code: "network" });
    expect(e1.isRetryable).toBe(true);

    const slow = mockFetch(() => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    const e2 = await new SandboxClient(CONFIG, slow.fn).request("GET", "/x").catch((e) => e);
    expect(e2).toMatchObject({ code: "timeout" });
  });

  it("serialises query params and skips undefined ones", async () => {
    const { fn, calls } = authed(() => json({ code: 200, data: {} }));
    await new SandboxClient(CONFIG, fn).request("GET", "/x", { query: { force: true, page: 2, skip: undefined } });
    expect(calls[1].url).toBe(`${SANDBOX_TEST_URL}/x?force=true&page=2`);
  });
});

describe("SandboxClient portal sessions", () => {
  const AUTH = "/gst/compliance/e-invoice/tax-payer/authenticate";
  function portalFetch(extra?: (c: Call) => Response | undefined) {
    let portalN = 0;
    return mockFetch((c) => {
      if (c.url.endsWith("/authenticate") && !c.url.includes("/gst/")) return json({ code: 200, data: { access_token: "api-tok" } });
      if (c.url.endsWith(AUTH)) {
        return json({ code: 200, data: { Status: 1, access_token: `portal${++portalN}`, expiry: Date.now() + 6 * 3600_000 } });
      }
      return extra?.(c) ?? json({ code: 200, data: { Data: { Irn: "abc" }, Status: 1 } });
    });
  }

  it("logs in with the business's portal credentials and uses that token on calls", async () => {
    const { fn, calls } = portalFetch();
    const client = new SandboxClient(CONFIG, fn);
    await client.portalRequest("e-invoice", CREDS, "POST", "/gst/compliance/e-invoice/tax-payer/invoice", { body: { Version: "1.1" } });

    const login = calls.find((c) => c.url.endsWith(AUTH))!;
    expect(JSON.parse(login.init.body as string)).toEqual({ username: "api_user", password: "pw1", gstin: CREDS.gstin });
    expect(header(login, "authorization")).toBe("api-tok");
    const call = calls[calls.length - 1];
    expect(header(call, "authorization")).toBe("portal1");
    expect(header(call, "x-api-key")).toBe("key_test_abc");
  });

  it("caches the portal token per GSTIN and re-logs in when the password changes", async () => {
    const { fn, calls } = portalFetch();
    const client = new SandboxClient(CONFIG, fn);
    const logins = () => calls.filter((c) => c.url.endsWith(AUTH)).length;

    await client.getPortalToken("e-invoice", CREDS);
    await client.getPortalToken("e-invoice", CREDS);
    expect(logins()).toBe(1);

    await client.getPortalToken("e-invoice", { ...CREDS, password: "changed" });
    expect(logins()).toBe(2);

    await client.getPortalToken("e-invoice", { ...CREDS, gstin: "29AAAPL1234C1ZV" });
    expect(logins()).toBe(3);
  });

  it("surfaces portal login failures (HTTP 200, Status 0) as non-retryable errors", async () => {
    const { fn } = mockFetch((c) =>
      c.url.includes("/gst/")
        ? json({ code: 200, data: { Status: 0, ErrorDetails: [{ ErrorCode: "1019", ErrorMessage: "Incorrect password" }] } })
        : json({ code: 200, data: { access_token: "api-tok" } }),
    );
    const err = await new SandboxClient(CONFIG, fn).getPortalToken("e-invoice", CREDS).catch((e) => e);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("1019");
    expect(err.isRetryable).toBe(false);
  });

  it("reads e-way bill style failures (status '0', error.errorCodes)", async () => {
    const { fn } = mockFetch((c) =>
      c.url.includes("/gst/")
        ? json({ code: 200, data: { status: "0", error: { errorCodes: "108" } } })
        : json({ code: 200, data: { access_token: "api-tok" } }),
    );
    const err = await new SandboxClient(CONFIG, fn).getPortalToken("e-way-bill", CREDS).catch((e) => e);
    expect(err.code).toBe("108");
  });

  it("re-logs in once when a portal call gets 401", async () => {
    const { fn, calls } = portalFetch((c) =>
      header(c, "authorization") === "portal1" ? json({ message: "expired" }, 401) : undefined,
    );
    const client = new SandboxClient(CONFIG, fn);
    const res = await client.portalRequest("e-invoice", CREDS, "POST", "/gst/compliance/e-invoice/tax-payer/invoice", { body: {} });
    expect(res.code).toBe(200);
    expect(calls.filter((c) => c.url.endsWith(AUTH))).toHaveLength(2);
  });
});
