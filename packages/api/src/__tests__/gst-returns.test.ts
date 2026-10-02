import { describe, it, expect, beforeEach } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL } from "../lib/sandbox/client.js";
import {
  SandboxGstReturnsClient,
  GstReturnsError,
  GST_RETURNS_PATHS,
  clearGstSessionsForTests,
  gstr1ToSections,
  gstr3bToGstn,
  toGstnPeriod,
} from "../lib/sandbox/gst-returns.js";
import type { GSTR1Report, GSTR3BReport } from "../lib/gst-reports.js";
import { parseGSTR2BJSON } from "../lib/gstr2b-parser.js";

const CFG = { apiKey: "key_test_abc", apiSecret: "s", baseUrl: SANDBOX_TEST_URL };
const ME = { gstin: "27AAAPL1234C1ZV", username: "taxpayer1" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gateway(routes: Record<string, (init: RequestInit, url: string) => Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/authenticate")) return json({ code: 200, data: { access_token: "api" } });
    for (const [part, h] of Object.entries(routes)) if (u.includes(part)) return h(init ?? {}, u);
    return json({ message: "no route" }, 404);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const mk = (fn: typeof fetch, now?: () => number) =>
  new SandboxGstReturnsClient(new SandboxClient(CFG, fn), ME, now ? { now } : {});

const OTP_ROUTES = {
  [GST_RETURNS_PATHS.requestOtp()]: () => json({ code: 200, data: { status_cd: "1" } }),
};
const verifyRoute = () => json({ code: 200, data: { status_cd: "1", access_token: "sess-1" } });

beforeEach(() => clearGstSessionsForTests());

describe("OTP session", () => {
  it("requests an OTP, verifies it, and sends the session token on later calls", async () => {
    const { fn, calls } = gateway({
      [GST_RETURNS_PATHS.verifyOtp()]: verifyRoute, // before requestOtp: "/otp" is a prefix of "/otp/verify"
      ...OTP_ROUTES,
      "/gstr-2b/": () => json({ code: 200, data: { data: { docdata: { b2b: [] } } } }),
    });
    const c = mk(fn);
    await c.requestOtp();
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({ username: "taxpayer1", gstin: ME.gstin });
    expect(c.hasSession).toBe(false);
    await c.verifyOtp("123456");
    expect(calls.at(-1)!.url).toContain("otp=123456");
    expect(c.hasSession).toBe(true);

    await c.fetchGstr2b("082026");
    const last = calls.at(-1)!;
    expect(last.url).toContain("/gstr-2b/2026/08");
    expect((last.init.headers as Record<string, string>).authorization).toBe("sess-1");
  });

  it("refuses calls without a session, and after expiry", async () => {
    let t = 1_000_000;
    const { fn } = gateway({ [GST_RETURNS_PATHS.verifyOtp()]: verifyRoute });
    const c = mk(fn, () => t);
    await expect(c.fetchGstr2b("082026")).rejects.toMatchObject({ code: "no_session" });
    await c.verifyOtp("111111");
    t += 7 * 3600_000; // past the ~6 h session
    expect(c.hasSession).toBe(false);
    await expect(c.fetchGstr2b("082026")).rejects.toBeInstanceOf(GstReturnsError);
  });

  it("wrong OTP: portal failure is a non-retryable GstReturnsError", async () => {
    const { fn } = gateway({
      [GST_RETURNS_PATHS.verifyOtp()]: () => json({ code: 200, data: { status_cd: "0", error: { error_cd: "OTP512", message: "Invalid OTP" } } }),
    });
    const err = await mk(fn).verifyOtp("000000").catch((e) => e);
    expect(err).toBeInstanceOf(GstReturnsError);
    expect(err.code).toBe("OTP512");
    expect(err.retryable).toBe(false);
  });
});

describe("filing", () => {
  async function sessioned(routes: Record<string, (i: RequestInit, u: string) => Response>) {
    const g = gateway({ [GST_RETURNS_PATHS.verifyOtp()]: verifyRoute, ...routes });
    const c = mk(g.fn);
    await c.verifyOtp("123456");
    return { c, calls: g.calls };
  }

  it("files GSTR-1 with the EVC OTP and PAN", async () => {
    const { c, calls } = await sessioned({
      "/gstr-1/2026/08/file": () => json({ code: 200, data: { status_cd: "1", data: { reference_id: "ARN-77" } } }),
    });
    const out = await c.fileGstr1("082026", "654321", "ABCDE1234F");
    expect(out.referenceId).toBe("ARN-77");
    const url = calls.at(-1)!.url;
    expect(url).toContain("otp=654321");
    expect(url).toContain("pan=ABCDE1234F");
  });

  it("saves a GSTR-1 section and GSTR-3B", async () => {
    const { c, calls } = await sessioned({
      "/gstr-1/2026/08/b2b": () => json({ code: 200, data: { status_cd: "1" } }),
      "/gstr-3b/2026/08": () => json({ code: 200, data: { status_cd: "1" } }),
    });
    await c.saveGstr1Section("082026", "b2b", [{ ctin: "x" }]);
    expect(calls.at(-1)!.init.method).toBe("PUT");
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toMatchObject({ fp: "082026", b2b: [{ ctin: "x" }] });
    await c.saveGstr3b("082026", { a: 1 });
    expect(calls.at(-1)!.url).toContain("/gstr-3b/2026/08");
  });

  it("maps a gateway 500 to a retryable error and a 401 to no_session", async () => {
    const s500 = await sessioned({ "/gstr-1/2026/08/file": () => json({ message: "boom" }, 500) });
    const e1 = await s500.c.fileGstr1("082026", "1234", "ABCDE1234F").catch((e) => e);
    expect(e1).toBeInstanceOf(GstReturnsError);
    expect(e1.retryable).toBe(true);

    const s401 = await sessioned({ "/gstr-3b/2026/08/file": () => json({ message: "expired" }, 401) });
    const e2 = await s401.c.fileGstr3b("082026", "1234", "ABCDE1234F").catch((e) => e);
    expect(e2.code).toBe("no_session");
    expect(s401.c.hasSession).toBe(false);
  });

  it("rejects a malformed period before calling out", async () => {
    const { c } = await sessioned({});
    await expect(c.fileGstr1("2026-08", "1", "x")).rejects.toMatchObject({ code: "bad_period" });
  });
});

describe("mappers", () => {
  const rateLine = { rate: 18, taxableValue: 1000, cgst: 90, sgst: 90, igst: 0 };
  const report = {
    period: "Aug 2026",
    businessGstin: ME.gstin,
    businessName: "Biz",
    b2b: [
      {
        partyGstin: "27BBBPL1234C1ZV", partyName: "P", invoiceNumber: "INV-1", invoiceDate: "2026-08-10T06:00:00Z",
        invoiceType: "Regular", taxableValue: 1000, cgst: 90, sgst: 90, igst: 0, totalInvoiceValue: 1180, rateItems: [rateLine],
      },
    ],
    b2cLarge: [],
    b2cSmall: [{ taxRate: 18, taxableValue: 500, cgst: 45, sgst: 45, igst: 0, supplyType: "INTRA", pos: "27" }],
    hsn: [{ hsn: "9983", description: "Svc", rate: 18, uqc: "NA", quantity: 1, taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, totalValue: 1770 }],
    creditNotes: [],
    debitNotes: [],
  } as unknown as GSTR1Report;

  it("GSTR-1: b2b, b2cs and hsn sections; empty sections dropped; no doc_issue", () => {
    const s = gstr1ToSections(report, ME.gstin, "082026") as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(["b2b", "b2cs", "hsn"]);
    expect(s.b2b).toEqual([
      expect.objectContaining({ ctin: "27BBBPL1234C1ZV", inv: [expect.objectContaining({ inum: "INV-1", idt: "10-08-2026", val: 1180 })] }),
    ]);
    expect(s.b2cs).toEqual([expect.objectContaining({ sply_ty: "INTRA", pos: "27", txval: 500, rt: 18, camt: 45, samt: 45 })]);
    expect((s.hsn as { data: unknown[] }).data).toHaveLength(1);
    expect(s).not.toHaveProperty("doc_issue");
  });

  it("GSTR-3B: outward, RCM and ITC totals", () => {
    const r = {
      outwardSupplies: {
        taxable: { taxableValue: 1500.005, igst: 0, cgst: 135, sgst: 135 },
        zeroRated: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
        exempt: { taxableValue: 200, igst: 0, cgst: 0, sgst: 0 },
      },
      rcmSupplies: { taxableValue: "100.00", cgst: "9.00", sgst: "9.00", igst: "0.00" },
      itc: { igst: 10, cgst: 50, sgst: 50, total: 110 },
    } as unknown as GSTR3BReport;
    const j = gstr3bToGstn(r, ME.gstin, "082026") as Record<string, any>;
    expect(j.ret_period).toBe("082026");
    expect(j.sup_details.osup_det).toEqual({ txval: 1500.01, iamt: 0, camt: 135, samt: 135, csamt: 0 });
    expect(j.sup_details.osup_nil_exmp.txval).toBe(200);
    expect(j.sup_details.isup_rev.camt).toBe(9);
    expect(j.itc_elg.itc_net).toEqual({ iamt: 10, camt: 50, samt: 50, csamt: 0 });
    expect(j).not.toHaveProperty("inter_sup");
  });

  it("toGstnPeriod converts the app period", () => {
    expect(toGstnPeriod("2026-08")).toBe("082026");
  });

  it("downloaded 2B JSON goes through the existing parser", () => {
    const raw = { data: { docdata: { b2b: [{ ctin: "27BBBPL1234C1ZV", trdnm: "S", inv: [{ inum: "S1", dt: "05-08-2026", val: 118, items: [{ txval: 100, cgst: 9, sgst: 9, igst: 0, cess: 0 }] }] }] } } };
    expect(parseGSTR2BJSON(JSON.stringify(raw))).toHaveLength(1);
  });
});
