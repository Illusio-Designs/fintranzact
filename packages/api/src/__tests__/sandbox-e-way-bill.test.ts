import { describe, it, expect, afterEach } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL, resetSandboxClientForTests } from "../lib/sandbox/client.js";
import { SandboxEWBClient, EWBApiError, ewbCancelReason } from "../lib/sandbox/e-way-bill.js";
import { createEWBClient } from "../lib/gov-provider.js";

const CFG = { apiKey: "key_test_abc", apiSecret: "s", baseUrl: SANDBOX_TEST_URL };
const GSTIN = "27AAAPL1234C1ZV";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gateway(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/e-way-bill/tax-payer/authenticate"))
      return json({ code: 200, data: { Status: 1, access_token: "ewb-portal", expiry: Date.now() + 6 * 3600_000 } });
    if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "api" } });
    for (const [suffix, handler] of Object.entries(routes)) if (u.endsWith(suffix)) return handler();
    return json({ message: "no route" }, 404);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const mk = (fn: typeof fetch) =>
  new SandboxEWBClient(new SandboxClient(CFG, fn), { username: "u", password: "p", gstin: GSTIN });
const body = (c: { init: RequestInit }) => JSON.parse(c.init.body as string);
const last = <T,>(a: T[]) => a[a.length - 1];

describe("SandboxEWBClient", () => {
  it("generates a bill and returns the NIC fields as strings", async () => {
    const { fn, calls } = gateway({
      "/e-way-bill/consignor/bill": () =>
        json({ code: 200, data: { status: "1", data: { ewayBillNo: 331009876543, ewayBillDate: "01/10/2026 02:30:00 PM", validUpto: "02/10/2026 11:59:00 PM" } } }),
    });
    const out = await mk(fn).generateEWB("biz", { docNo: "INV-1" } as never);
    expect(out).toEqual({ ewayBillNo: "331009876543", ewayBillDate: "01/10/2026 02:30:00 PM", validUpto: "02/10/2026 11:59:00 PM" });
    expect(body(last(calls))).toEqual({ docNo: "INV-1" });
    expect((last(calls).init.headers as Record<string, string>).authorization).toBe("ewb-portal");
  });

  it("logs in with the GSTIN set on config at call time", async () => {
    const { fn, calls } = gateway({
      "/consignor/bill": () => json({ code: 200, data: { status: "1", data: { ewayBillNo: 1, ewayBillDate: "", validUpto: "" } } }),
    });
    const client = mk(fn);
    client.config.gstin = "29AAAPL1234C1ZV"; // the router does this per request
    await client.generateEWB("biz", {} as never);
    const login = calls.find((c) => c.url.endsWith("/e-way-bill/tax-payer/authenticate"))!;
    expect(body(login).gstin).toBe("29AAAPL1234C1ZV");
  });

  it("throws EWBApiError with the NIC code on rejection (HTTP 200, status 0)", async () => {
    const { fn } = gateway({
      "/consignor/bill": () => json({ code: 200, data: { status: "0", error: { errorCodes: "604" } } }),
    });
    const err = await mk(fn).generateEWB("biz", {} as never).catch((e) => e);
    expect(err).toBeInstanceOf(EWBApiError);
    expect(err.code).toBe("604");
    expect(err.message).toContain("[604]");
    expect(err.isRetryable).toBe(false);
  });

  it("flags gateway outages as retryable", async () => {
    const { fn } = gateway({ "/consignor/bill": () => json({ message: "down" }, 502) });
    const err = await mk(fn).generateEWB("biz", {} as never).catch((e) => e);
    expect(err).toBeInstanceOf(EWBApiError);
    expect(err.isRetryable).toBe(true);
  });

  it("cancels with a numeric bill number and a NIC reason code", async () => {
    const { fn, calls } = gateway({
      "/bill/331009876543/cancel": () => json({ code: 200, data: { status: "1", data: { ewayBillNo: 331009876543, cancelDate: "01/10/2026 03:00:00 PM" } } }),
    });
    const out = await mk(fn).cancelEWB("biz", "331009876543", "3");
    expect(out).toEqual({ ewayBillNo: "331009876543", cancelDate: "01/10/2026 03:00:00 PM" });
    expect(body(last(calls))).toEqual({ ewbNo: 331009876543, cancelRsnCode: 3, cancelRmrk: "" });
  });

  it("maps free-text cancel reasons to code 4 (Others) with the text as the remark", () => {
    expect(ewbCancelReason("Customer changed the order")).toEqual({ code: 4, remarks: "Customer changed the order" });
    expect(ewbCancelReason("2")).toEqual({ code: 2, remarks: "" });
    expect(ewbCancelReason("x".repeat(300)).remarks).toHaveLength(100);
  });

  it("updates Part B with PUT on the vehicle path", async () => {
    const { fn, calls } = gateway({
      "/bill/555/vehicle": () => json({ code: 200, data: { status: "1", data: { validUpto: "03/10/2026 11:59:00 PM", vehUpdDate: "01/10/2026 04:00:00 PM" } } }),
    });
    const out = await mk(fn).updateVehicle("biz", "555", "MH12AB1234", "Pune", 27, "Vehicle broke down");
    expect(out).toEqual({ ewayBillNo: "555", transUpdateDate: "01/10/2026 04:00:00 PM", validUpto: "03/10/2026 11:59:00 PM" });
    const c = last(calls);
    expect(c.init.method).toBe("PUT");
    expect(body(c)).toMatchObject({ ewbNo: 555, vehicleNo: "MH12AB1234", fromState: 27, reasonCode: "3", reasonRem: "Vehicle broke down", transMode: "1" });
  });

  it("extends validity", async () => {
    const { fn, calls } = gateway({
      "/bill/555/extend": () => json({ code: 200, data: { status: "1", data: { ewayBillNo: 555, validUpto: "04/10/2026 11:59:00 PM" } } }),
    });
    const out = await mk(fn).extendValidity("biz", "555", "MH12AB1234", "Pune", 27, 411001, 120);
    expect(out).toEqual({ ewayBillNo: "555", validUpto: "04/10/2026 11:59:00 PM" });
    expect(body(last(calls))).toMatchObject({ ewbNo: 555, fromPincode: 411001, remainingDistance: 120, extnRsnCode: 5 });
  });

  it("looks a bill up with GET", async () => {
    const { fn, calls } = gateway({
      "/tax-payer/bill/555": () => json({ code: 200, data: { status: "1", data: { ewbNo: 555, vehicleNo: "MH12AB1234" } } }),
    });
    const out = await mk(fn).getEWBDetails("biz", "555");
    expect(out).toMatchObject({ ewbNo: 555 });
    expect(last(calls).init.method).toBe("GET");
  });

  it("authenticate() fails on a bad portal login", async () => {
    const fn = (async (url: string | URL) =>
      String(url).includes("/gst/")
        ? json({ code: 200, data: { status: "0", error: { errorCodes: "108" } } })
        : json({ code: 200, data: { access_token: "api" } })) as unknown as typeof fetch;
    await expect(mk(fn).authenticate()).rejects.toMatchObject({ code: "108" });
  });
});

describe("createEWBClient provider selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetSandboxClientForTests();
  });
  const cfg = { clientId: "", clientSecret: "", username: "u", password: "p", gstin: GSTIN };

  it("returns the Sandbox client when keys are set", () => {
    process.env.SANDBOX_API_KEY = "key_test_x";
    process.env.SANDBOX_API_SECRET = "s";
    process.env.GOV_API_PROVIDER = "sandbox"; // tests must opt in
    resetSandboxClientForTests();
    expect(createEWBClient(cfg)).toBeInstanceOf(SandboxEWBClient);
  });

  it("returns the direct NIC client otherwise", () => {
    delete process.env.SANDBOX_API_KEY;
    delete process.env.SANDBOX_API_SECRET;
    resetSandboxClientForTests();
    expect(createEWBClient(cfg)).not.toBeInstanceOf(SandboxEWBClient);
  });
});
