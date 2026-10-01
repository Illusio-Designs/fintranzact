import { describe, it, expect, vi, afterEach } from "vitest";
import { IRPError } from "../lib/irp-client.js";
import { SandboxClient, SANDBOX_TEST_URL, resetSandboxClientForTests } from "../lib/sandbox/client.js";
import { SandboxIRPClient, mapGstinSearch, parseIrpDateTime } from "../lib/sandbox/e-invoice.js";
import { createIRPClient, useSandboxProvider } from "../lib/gov-provider.js";

const CFG = { apiKey: "key_test_abc", apiSecret: "s", baseUrl: SANDBOX_TEST_URL };
const BIZ = { gstin: "27AAAPL1234C1ZV", username: "u", password: "p" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Routes by path: both auth endpoints succeed, the rest is supplied per test. */
function gateway(routes: Record<string, (init: RequestInit, url: string) => Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/authenticate") && !u.includes("/gst/")) return json({ code: 200, data: { access_token: "api" } });
    if (u.endsWith("/e-invoice/tax-payer/authenticate")) return json({ code: 200, data: { Status: 1, access_token: "portal", expiry: Date.now() + 6 * 3600_000 } });
    for (const [suffix, handler] of Object.entries(routes)) {
      if (u.endsWith(suffix) || u.includes(suffix)) return handler(init ?? {}, u);
    }
    return json({ message: "no route" }, 404);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (fn: typeof fetch) => new SandboxIRPClient(new SandboxClient(CFG, fn), BIZ);

const IRP_OK = {
  Irn: "a".repeat(64),
  AckNo: 112410188589976,
  AckDt: "2026-10-01 14:30:05",
  SignedInvoice: "jwt-inv",
  SignedQRCode: "jwt-qr",
  Status: "ACT",
};

describe("SandboxIRPClient.generateIRN", () => {
  it("posts the IRP JSON and maps the response", async () => {
    const { fn, calls } = gateway({
      "/e-invoice/tax-payer/invoice": () => json({ code: 200, data: { Status: 1, Data: IRP_OK } }),
    });
    const out = await client(fn).generateIRN({ Version: "1.1" } as never);

    expect(out.irn).toHaveLength(64);
    expect(out.ackNo).toBe("112410188589976"); // number → string for the DB column
    expect(out.signedQrCode).toBe("jwt-qr");
    expect(out.ackDt.toISOString()).toBe("2026-10-01T09:00:05.000Z"); // 14:30:05 IST
    const post = calls[calls.length - 1];
    expect(JSON.parse(post.init.body as string)).toEqual({ Version: "1.1" });
    expect((post.init.headers as Record<string, string>).authorization).toBe("portal");
  });

  it("throws IRPError with the IRP code on a rejected invoice (HTTP 200, Status 0)", async () => {
    const { fn } = gateway({
      "/e-invoice/tax-payer/invoice": () =>
        json({ code: 200, data: { Status: 0, Data: null, ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }] } }),
    });
    const err = await client(fn).generateIRN({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(IRPError);
    expect(err).toMatchObject({ code: "2150", message: "Duplicate IRN" });
    expect(err.isRetryable).toBe(false);
  });

  it("marks gateway 5xx as retryable", async () => {
    const { fn } = gateway({ "/e-invoice/tax-payer/invoice": () => json({ message: "down" }, 503) });
    const err = await client(fn).generateIRN({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(IRPError);
    expect(err.isRetryable).toBe(true);
  });

  it("reports portal login failures as non-retryable IRPError", async () => {
    const fn = (async (url: string | URL) =>
      String(url).includes("/gst/")
        ? json({ code: 200, data: { Status: 0, ErrorDetails: [{ ErrorCode: "1019" }] } })
        : json({ code: 200, data: { access_token: "api" } })) as unknown as typeof fetch;
    const err = await client(fn).authenticate().catch((e) => e);
    expect(err).toBeInstanceOf(IRPError);
    expect(err.code).toBe("1019");
    expect(err.isRetryable).toBe(false);
  });
});

describe("SandboxIRPClient cancel / fetch", () => {
  it("cancels by IRN in the path and body", async () => {
    const irn = "b".repeat(64);
    const { fn, calls } = gateway({
      [`/invoice/${irn}/cancel`]: () => json({ code: 200, data: { Status: 1, Data: { Irn: irn, CancelDate: "2026-10-01 15:00:00" } } }),
    });
    const out = await client(fn).cancelIRN(irn, "2", "typo");
    expect(out.irn).toBe(irn);
    expect(out.cancelDate.toISOString()).toBe("2026-10-01T09:30:00.000Z");
    expect(JSON.parse(calls[calls.length - 1].init.body as string)).toEqual({ Irn: irn, CnlRsn: "2", CnlRem: "typo" });
  });

  it("surfaces cancellation window errors", async () => {
    const irn = "c".repeat(64);
    const { fn } = gateway({
      "/cancel": () => json({ code: 200, data: { Status: 0, Data: null, ErrorDetails: [{ ErrorCode: "2270", ErrorMessage: "Cancel window over" }] } }),
    });
    await expect(client(fn).cancelIRN(irn, "1")).rejects.toMatchObject({ code: "2270" });
  });

  it("fetches an IRN with GET", async () => {
    const { fn, calls } = gateway({
      [`/invoice/${IRP_OK.Irn}`]: () => json({ code: 200, data: { Status: 1, Data: IRP_OK } }),
    });
    const out = await client(fn).getIRNDetails(IRP_OK.Irn);
    expect(out?.Irn).toBe(IRP_OK.Irn);
    expect(calls[calls.length - 1].init.method).toBe("GET");
  });

  it("reads flattened error fields on a failed fetch", async () => {
    const { fn } = gateway({
      "/invoice/": () => json({ code: 200, data: { Status: 0, ErrorCode: "2148", ErrorMessage: "IRN not available" } }),
    });
    await expect(client(fn).getIRNDetails("d".repeat(64))).rejects.toMatchObject({ code: "2148" });
  });
});

describe("GSTIN lookup", () => {
  it("maps the public GSTIN search to the IRP master shape", () => {
    const d = mapGstinSearch("27AAAPL1234C1ZV", {
      gstin: "27AAAPL1234C1ZV",
      lgnm: "ACME TRADERS",
      tradeNam: "Acme",
      dty: "Regular",
      sts: "Active",
      pradr: { addr: { bno: "12", bnm: "Tower", st: "MG Road", loc: "Pune", pncd: "411001", stcd: "Maharashtra" } },
    });
    expect(d).toMatchObject({
      Gstin: "27AAAPL1234C1ZV",
      LegalName: "ACME TRADERS",
      TradeName: "Acme",
      AddrBno: "12",
      AddrSt: "MG Road",
      AddrLoc: "Pune",
      AddrPncd: "411001",
      StateCode: "27",
      TxpType: "REG",
      Status: "ACT",
      BlkStatus: "U",
    });
  });

  it("calls the public search with only the API token (no portal login)", async () => {
    const { fn, calls } = gateway({
      "/public/gstin/search": () => json({ code: 200, data: { data: { gstin: BIZ.gstin, lgnm: "X", sts: "Cancelled", dty: "Composition" } } }),
    });
    const d = await client(fn).getGstinDetails(BIZ.gstin);
    expect(d).toMatchObject({ Status: "CNL", TxpType: "COM" });
    expect(calls.some((c) => c.url.endsWith("/e-invoice/tax-payer/authenticate"))).toBe(false);
  });

  it("throws NOT_FOUND when the payload is empty", async () => {
    const { fn } = gateway({ "/public/gstin/search": () => json({ code: 200, data: {} }) });
    await expect(client(fn).getGstinDetails(BIZ.gstin)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("parseIrpDateTime", () => {
  it("parses both IRP formats as IST", () => {
    expect(parseIrpDateTime("2026-10-01 14:30:05").toISOString()).toBe("2026-10-01T09:00:05.000Z");
    expect(parseIrpDateTime("01/10/2026 14:30:05").toISOString()).toBe("2026-10-01T09:00:05.000Z");
  });
});

describe("createIRPClient provider selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetSandboxClientForTests();
  });
  const config = { gstin: BIZ.gstin, username: "u", password: "p" } as never;

  it("uses Sandbox when keys are set", () => {
    process.env.SANDBOX_API_KEY = "key_test_x";
    process.env.SANDBOX_API_SECRET = "s";
    process.env.GOV_API_PROVIDER = "sandbox"; // tests must opt in
    resetSandboxClientForTests();
    expect(useSandboxProvider()).toBe(true);
    expect(createIRPClient(config, {} as never)).toBeInstanceOf(SandboxIRPClient);
  });

  it("does not pick Sandbox under NODE_ENV=test from the keys alone", () => {
    process.env.SANDBOX_API_KEY = "key_live_real";
    process.env.SANDBOX_API_SECRET = "s";
    delete process.env.GOV_API_PROVIDER;
    resetSandboxClientForTests();
    expect(process.env.NODE_ENV).toBe("test");
    expect(useSandboxProvider()).toBe(false);
  });

  it("falls back to the direct client without keys, or with GOV_API_PROVIDER=direct", () => {
    delete process.env.SANDBOX_API_KEY;
    delete process.env.SANDBOX_API_SECRET;
    resetSandboxClientForTests();
    expect(useSandboxProvider()).toBe(false);
    expect(createIRPClient(config, {} as never)).not.toBeInstanceOf(SandboxIRPClient);

    process.env.SANDBOX_API_KEY = "key_test_x";
    process.env.SANDBOX_API_SECRET = "s";
    process.env.GOV_API_PROVIDER = "direct";
    resetSandboxClientForTests();
    expect(useSandboxProvider()).toBe(false);
  });
});
