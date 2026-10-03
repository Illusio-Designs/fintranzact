import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import {
  SandboxClient,
  SandboxError,
  SandboxFundingError,
  SANDBOX_TEST_URL,
  type SandboxMeter,
} from "../lib/sandbox/client.js";
import { FUNDING_CUSTOMER_MESSAGE, isFundingFailure } from "../lib/sandbox/funding.js";
import { SandboxIRPClient } from "../lib/sandbox/e-invoice.js";
import { SandboxEWBClient, EWBApiError } from "../lib/sandbox/e-way-bill.js";
import { SandboxHsnClient, HsnLookupError } from "../lib/sandbox/hsn.js";
import { SandboxTdsClient, TdsApiError } from "../lib/sandbox/tds.js";
import { SandboxGstReturnsClient, GstReturnsError, clearGstSessionsForTests } from "../lib/sandbox/gst-returns.js";
import { IRPError } from "../lib/irp-client.js";
import { toTrpc } from "../routers/gstReturns.js";
import { router, publicProcedure } from "../trpc.js";

const CFG = { apiKey: "key_test_abc", apiSecret: "s", baseUrl: SANDBOX_TEST_URL };
const RAW = "Insufficient wallet balance for account acme-prod, balance 0.00";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Gateway that authenticates fine and rejects everything else with the given response. */
function rejecting(status: number, message: string): typeof fetch {
  return (async (url: string | URL) => {
    if (String(url).endsWith("/authenticate")) return json({ code: 200, data: { access_token: "api" } });
    return json({ message, code: status }, status);
  }) as unknown as typeof fetch;
}
const meterSpy = (): SandboxMeter & { failures: Array<[number | undefined, string]> } => {
  const failures: Array<[number | undefined, string]> = [];
  return { failures, onFailure: (s, m) => void failures.push([s, m]), onSuccess: () => undefined };
};

beforeEach(() => clearGstSessionsForTests());

describe("SandboxClient funding failures", () => {
  it.each([
    ["HTTP 402", 402, "Payment required"],
    ["an insufficient wallet balance message", 400, RAW],
    ["a quota exceeded message", 429, "Monthly quota exceeded"],
  ])("throws SandboxFundingError for %s", async (_n, status, message) => {
    const client = new SandboxClient(CFG, rejecting(status, message));
    const err = await client.request("GET", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(SandboxFundingError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.customerMessage).toBe(FUNDING_CUSTOMER_MESSAGE);
    expect(err.message).toBe(FUNDING_CUSTOMER_MESSAGE);
    expect(err.message).not.toContain("wallet");
    expect(err.httpStatus).toBe(status);
    expect(err.isRetryable).toBe(true);
    // The raw wording is kept for logs / audit only.
    expect(err.rawMessage).toBe(message);
    expect((err.cause as Error).message).toBe(message);
  });

  it("leaves non-funding errors exactly as before", async () => {
    const client = new SandboxClient(CFG, rejecting(422, "Invalid GSTIN pattern"));
    const err = await client.request("GET", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).not.toBeInstanceOf(SandboxFundingError);
    expect(err.message).toBe("Invalid GSTIN pattern");
    expect(err.httpStatus).toBe(422);
    expect(err.isRetryable).toBe(false);
  });

  it("hands the raw message to the injected meter (which raises the platform alert)", async () => {
    const meter = meterSpy();
    const client = new SandboxClient(CFG, rejecting(402, RAW), undefined, meter);
    await client.request("GET", "/x").catch(() => undefined);
    expect(meter.failures).toEqual([[402, RAW]]);
  });

  it("does not need a database when no meter is injected", async () => {
    const client = new SandboxClient(CFG, rejecting(402, RAW));
    await expect(client.request("GET", "/x")).rejects.toBeInstanceOf(SandboxFundingError);
  });
});

describe("adapters carry the friendly message, keep the raw one in cause", () => {
  const funding = () => new SandboxClient(CFG, rejecting(402, RAW));
  const portalFetch = (): typeof fetch =>
    (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/tax-payer/authenticate"))
        return json({ code: 200, data: { Status: 1, status: "1", access_token: "p", expiry: Date.now() + 6 * 3600_000 } });
      if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "api" } });
      return json({ message: RAW }, 402);
    }) as unknown as typeof fetch;

  it("e-invoice: retryable IRPError", async () => {
    const c = new SandboxIRPClient(new SandboxClient(CFG, portalFetch()), { gstin: "27AAAPL1234C1ZV", username: "u", password: "p" });
    const err = await c.getGstinDetails("27AAAPL1234C1ZV").catch((e) => e);
    expect(err).toBeInstanceOf(IRPError);
    expect(err.message).toBe(FUNDING_CUSTOMER_MESSAGE);
    expect(err.isRetryable).toBe(true);
    expect(isFundingFailure(err)).toBe(true);
    expect((err.cause as SandboxFundingError).rawMessage).toBe(RAW);
  });

  it("e-way bill", async () => {
    const c = new SandboxEWBClient(new SandboxClient(CFG, portalFetch()), { username: "u", password: "p", gstin: "27AAAPL1234C1ZV" });
    const err = await c.getEWBDetails("biz", "123456789012").catch((e) => e);
    expect(err).toBeInstanceOf(EWBApiError);
    expect(err.message).toBe(FUNDING_CUSTOMER_MESSAGE);
    expect(isFundingFailure(err)).toBe(true);
  });

  it("PAN verification", async () => {
    const err = await new SandboxTdsClient(funding()).verifyPan("ABCDE1234F").catch((e) => e);
    expect(err).toBeInstanceOf(TdsApiError);
    expect(err.message).toBe(FUNDING_CUSTOMER_MESSAGE);
    expect(isFundingFailure(err)).toBe(true);
  });

  it("GST returns", async () => {
    const err = await new SandboxGstReturnsClient(funding(), { gstin: "27AAAPL1234C1ZV", username: "u" }).requestOtp().catch((e) => e);
    expect(err).toBeInstanceOf(GstReturnsError);
    expect(err.message).toBe(FUNDING_CUSTOMER_MESSAGE);
    expect(isFundingFailure(err)).toBe(true);
  });

  it("HSN lookup stays an 'unavailable' lookup error so callers fall back, never block", async () => {
    const err = await new SandboxHsnClient(funding()).lookupHsn("5208").catch((e) => e);
    expect(err).toBeInstanceOf(HsnLookupError);
    expect(err.kind).toBe("unavailable");
    expect(err.message).not.toContain("wallet");
  });

  it("HSN 404 still means 'unknown code'", async () => {
    const c = new SandboxHsnClient(new SandboxClient(CFG, rejecting(404, "not found")));
    expect(await c.lookupHsn("5208")).toBeNull();
  });
});

describe("router mapping", () => {
  it("gstReturns toTrpc: SERVICE_UNAVAILABLE with the friendly text, never the raw text", async () => {
    const funding = await new SandboxGstReturnsClient(new SandboxClient(CFG, rejecting(402, RAW)), { gstin: "27AAAPL1234C1ZV", username: "u" })
      .requestOtp()
      .catch((e) => e);
    let thrown: unknown;
    try {
      toTrpc(funding);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("SERVICE_UNAVAILABLE");
    expect((thrown as TRPCError).message).toBe(FUNDING_CUSTOMER_MESSAGE);
    expect(JSON.stringify({ m: (thrown as TRPCError).message })).not.toContain("wallet");
  });

  it("gstReturns toTrpc: other retryable and non-retryable errors are unchanged", () => {
    expect(() => toTrpc(new GstReturnsError("GST x failed: boom", "500", true))).toThrow(
      expect.objectContaining({ code: "SERVICE_UNAVAILABLE", message: "GST x failed: boom" }),
    );
    expect(() => toTrpc(new GstReturnsError("GST x failed: bad", "422"))).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST", message: "GST x failed: bad" }),
    );
  });

  /** Run a procedure through the real HTTP adapter so the global errorFormatter applies. */
  async function call(thrower: () => unknown) {
    const r = router({
      boom: publicProcedure.query(() => {
        throw thrower();
      }),
    });
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/boom"),
      router: r,
      createContext: ({ req }) => ({ req }) as never,
      onError: () => undefined,
    });
    return { status: res.status, text: await res.text() };
  }

  it("a funding error that escapes a procedure unmapped (e.g. e-way bill) becomes a 503 with the friendly text", async () => {
    const raw = await new SandboxClient(CFG, rejecting(402, RAW)).request("GET", "/x").catch((e) => e);
    const ewb = new EWBApiError(raw.customerMessage, "funding", true);
    (ewb as { cause?: unknown }).cause = raw;
    const { status, text } = await call(() => ewb);
    expect(status).toBe(503);
    expect(text).toContain(FUNDING_CUSTOMER_MESSAGE);
    expect(text).toContain("SERVICE_UNAVAILABLE");
    expect(text).not.toContain("wallet");
    expect(text).not.toContain("acme-prod");
  });

  it("an ordinary unexpected error still shows the generic message", async () => {
    const { status, text } = await call(() => new Error("db exploded"));
    expect(status).toBe(500);
    expect(text).toContain("Something went wrong. Please try again.");
    expect(JSON.parse(text).error.json.message).not.toContain("db exploded");
  });
});

describe("hourly platform alert", () => {
  it("fires once per hour, with the actionable text", async () => {
    vi.resetModules();
    const values = vi.fn(async () => undefined);
    vi.doMock("@fintranzact/db", () => ({
      controlDb: { insert: () => ({ values }) },
      govApiUsage: {},
      sandboxCallCounters: {},
      billingEvents: {},
    }));
    const { noteSandboxFundingFailure } = await import("../lib/gov-usage.js");
    await noteSandboxFundingFailure(402, RAW);
    await noteSandboxFundingFailure(402, RAW);
    await noteSandboxFundingFailure(400, "Invalid GSTIN");
    expect(values).toHaveBeenCalledTimes(1);
    const row = (values.mock.calls[0] as unknown as [{ type: string; payload: { message: string } }])[0];
    expect(row.type).toBe("sandbox.wallet_or_quota_blocked");
    expect(row.payload.message).toContain("Top up the Sandbox wallet at console.sandbox.co.in");
    vi.doUnmock("@fintranzact/db");
  });
});
