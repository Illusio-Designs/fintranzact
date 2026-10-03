import { describe, it, expect, beforeEach } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL } from "../lib/sandbox/client.js";
import {
  SandboxGstReturnsClient,
  GstReturnsError,
  GST_RETURNS_PATHS,
  clearGstSessionsForTests,
  gstr1ToSections,
  gstr1SaveBody,
  interpretReturnStatus,
  GSTR1_NIL_FLAG,
  GSTR3B_NIL_FLAG,
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

type Call = { url: string; init: RequestInit };
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => JSON.parse(c.init.body as string);
const ok = (data: unknown) => json({ code: 200, data: { status_cd: "1", ...(data as object) } });

describe("official GSTR-1 flow (exact requests)", () => {
  const BASE = `${SANDBOX_TEST_URL}/gst/compliance/tax-payer`;
  async function session(routes: Record<string, (i: RequestInit, u: string) => Response>, opts = {}) {
    const g = gateway({ [GST_RETURNS_PATHS.verifyOtp()]: verifyRoute, ...routes });
    const c = new SandboxGstReturnsClient(new SandboxClient(CFG, g.fn), ME, opts);
    await c.verifyOtp("123456");
    return { c, calls: g.calls };
  }

  it("save -> proceed -> status -> summary -> EVC OTP -> file, with the recipe's URLs, queries, headers and bodies", async () => {
    const SEC = [{ sec_nm: "B2B", ttl_rec: 1 }];
    const { c, calls } = await session({
      "/gstr-1/2026/08/new-proceed": () => ok({ data: { reference_id: "REF-PROCEED" } }),
      "/gstr-1/2026/08/file": () => ok({ data: { reference_id: "ARN-1" } }),
      "/gstr-1/2026/08": (init) =>
        init.method === "POST"
          ? ok({ data: { reference_id: "REF-SAVE" } })
          : ok({ data: { data: { sec_sum: SEC, chksum: "abc123" } } }),
      "/gstrs/2026/08/status": () => ok({ data: { status_cd: "P" } }),
      "/evc/otp": () => ok({}),
    });
    const full = { fp: "082026", gstin: ME.gstin, gt: 5000, cur_gt: 900, b2b: [] };

    expect(await c.saveGstr1("082026", full as never)).toBe("REF-SAVE");
    let call = calls.at(-1)!;
    expect(call.init.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/gstrs/gstr-1/2026/08`);
    expect(body(call)).toMatchObject({ fp: "082026", gstin: ME.gstin, gt: 5000, cur_gt: 900 });
    expect(hdr(call)).toMatchObject({ authorization: "sess-1", "x-api-key": "key_test_abc", "x-api-version": "1.0.0", "content-type": "application/json" });

    expect(await c.getReturnStatus("082026", "REF-SAVE")).toEqual({ phase: "processed", errors: [] });
    call = calls.at(-1)!;
    expect(call.init.method).toBe("GET");
    expect(call.url).toContain("reference_id=REF-SAVE");

    expect(await c.proceedGstr1("082026", false)).toBe("REF-PROCEED");
    call = calls.at(-1)!;
    expect(call.init.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/gstrs/gstr-1/2026/08/new-proceed?is_nil=N`);
    expect(body(call)).toEqual({ gstin: ME.gstin, ret_period: "082026" });

    const sum = await c.getGstr1Summary("082026");
    call = calls.at(-1)!;
    expect(call.init.method).toBe("GET");
    expect(call.url).toBe(`${BASE}/gstrs/gstr-1/2026/08?summary_type=long`);
    expect(sum).toEqual({ secSum: SEC, chksum: "abc123" });

    await c.requestEvcOtp("gstr-1", "ABCDE1234F");
    call = calls.at(-1)!;
    expect(call.init.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/evc/otp?gstr=gstr-1`);
    expect(body(call)).toEqual({ pan: "ABCDE1234F" });

    const out = await c.fileGstr1("082026", "654321", "ABCDE1234F", sum);
    call = calls.at(-1)!;
    expect(call.init.method).toBe("POST");
    const u = new URL(call.url);
    expect(u.pathname).toBe("/gst/compliance/tax-payer/gstrs/gstr-1/2026/08/file");
    expect(u.searchParams.get("pan")).toBe("ABCDE1234F");
    expect(u.searchParams.get("otp")).toBe("654321");
    expect(body(call)).toEqual({ ret_period: "082026", newSumFlag: true, sec_sum: SEC, gstin: ME.gstin, chksum: "abc123" });
    expect(out.referenceId).toBe("ARN-1");
  });

  it("nil GSTR-1: proceed is_nil=Y, file body carries isnil 'Y' and none of sec_sum / chksum / newSumFlag", async () => {
    const { c, calls } = await session({
      "/new-proceed": () => ok({ data: { reference_id: "R" } }),
      "/file": () => ok({ data: { reference_id: "ARN-N" } }),
    });
    await c.proceedGstr1("122023", true);
    expect(calls.at(-1)!.url).toBe(`${SANDBOX_TEST_URL}/gst/compliance/tax-payer/gstrs/gstr-1/2023/12/new-proceed?is_nil=Y`);
    await c.fileNilGstr1("122023", "111111", "ABCDE1234F");
    expect(body(calls.at(-1)!)).toEqual({ ret_period: "122023", gstin: ME.gstin, isnil: "Y" });
  });

  it("nil flag casing: GSTR-1 is 'isnil', GSTR-3B is 'isNil' (never swapped)", () => {
    expect(GSTR1_NIL_FLAG).toEqual({ key: "isnil", value: "Y" });
    expect(GSTR3B_NIL_FLAG).toEqual({ key: "isNil", value: "Y" });
  });

  it("the save body has fp, gstin, gt, cur_gt and every section key", () => {
    const b = gstr1SaveBody({ b2b: [], b2cLarge: [], b2cSmall: [], hsn: [], creditNotes: [], debitNotes: [] } as unknown as GSTR1Report, ME.gstin, "082026", { gt: 1, curGt: 2 });
    expect(Object.keys(b).sort()).toEqual(
      ["at", "ata", "b2b", "b2ba", "b2cl", "b2cla", "b2cs", "b2csa", "cdnr", "cdnra", "cdnur", "cdnura", "cur_gt", "doc_issue", "exp", "expa", "fp", "gstin", "gt", "hsn", "nil", "txpd", "txpda"].sort(),
    );
    expect(b).toMatchObject({ fp: "082026", gt: 1, cur_gt: 2, hsn: { data: [] } });
  });

  it("a summary without sec_sum / chksum is refused", async () => {
    const { c } = await session({ "/gstr-1/2026/08": () => ok({ data: { data: {} } }) });
    await expect(c.getGstr1Summary("082026")).rejects.toMatchObject({ code: "no_summary" });
  });

  it("a save response without reference_id is refused", async () => {
    const { c } = await session({ "/gstr-1/2026/08": () => ok({ data: {} }) });
    await expect(c.saveGstr1("082026", {} as never)).rejects.toMatchObject({ code: "no_reference" });
  });

  it("status: errors carry the portal messages; unknown codes keep processing", async () => {
    expect(interpretReturnStatus({ data: { status_cd: "PE", error_report: { b2b: [{ error_cd: "RET1", error_msg: "Bad GSTIN" }] } } })).toEqual({ phase: "errors", errors: ["Bad GSTIN"] });
    expect(interpretReturnStatus({ data: { status_cd: "IP" } }).phase).toBe("processing");
    expect(interpretReturnStatus({ data: { status_cd: "ZZ" } }).phase).toBe("processing");
  });

  it("PAN is validated before any call", async () => {
    const { c, calls } = await session({});
    const n = calls.length;
    await expect(c.requestEvcOtp("gstr-1", "abc")).rejects.toMatchObject({ code: "bad_pan" });
    await expect(c.fileNilGstr1("082026", "1", "ABCDE12345")).rejects.toMatchObject({ code: "bad_pan" });
    expect(calls.length).toBe(n);
  });

  it("an expired token mid-flow: re-authenticates once and retries; a second 401 surfaces", async () => {
    let n = 0;
    const sessions = new Map();
    const g = gateway({
      [GST_RETURNS_PATHS.verifyOtp()]: verifyRoute,
      "/gstr-1/2026/08/new-proceed": () => (++n === 1 || n < 0 ? json({ message: "expired" }, 401) : ok({ data: { reference_id: "R2" } })),
    });
    let reauths = 0;
    const c = new SandboxGstReturnsClient(new SandboxClient(CFG, g.fn), ME, {
      sessions,
      reauth: async () => {
        reauths++;
        await c.verifyOtp("999999");
      },
    });
    await c.verifyOtp("123456");
    expect(await c.proceedGstr1("082026", false)).toBe("R2");
    expect(reauths).toBe(1);

    n = -5; // always 401 from now on
    await expect(c.proceedGstr1("082026", false)).rejects.toMatchObject({ code: "no_session" });
    expect(reauths).toBe(2);
    expect(c.hasSession).toBe(false);
  });

  it("without a reauth hook a 401 drops the session", async () => {
    const { c } = await session({ "/new-proceed": () => json({ message: "expired" }, 401) });
    await expect(c.proceedGstr1("082026", false)).rejects.toMatchObject({ code: "no_session" });
    expect(c.hasSession).toBe(false);
  });

  it("maps a gateway 500 to a retryable error and a wrong OTP (400) to a non-retryable one", async () => {
    const s500 = await session({ "/gstr-1/2026/08/file": () => json({ message: "boom" }, 500) });
    const e1 = await s500.c.fileNilGstr1("082026", "1234", "ABCDE1234F").catch((e) => e);
    expect(e1).toBeInstanceOf(GstReturnsError);
    expect(e1.retryable).toBe(true);
    const s400 = await session({ "/gstr-1/2026/08/file": () => json({ code: 400, message: "Invalid OTP" }, 400) });
    const e2 = await s400.c.fileNilGstr1("082026", "1234", "ABCDE1234F").catch((e) => e);
    expect(e2.retryable).toBe(false);
    expect(e2.message).toContain("Invalid OTP");
  });

  it("rejects a malformed period before calling out", async () => {
    const { c } = await session({});
    await expect(c.proceedGstr1("2026-08", false)).rejects.toMatchObject({ code: "bad_period" });
  });
});

describe("official GSTR-3B flow (exact requests)", () => {
  const BASE = `${SANDBOX_TEST_URL}/gst/compliance/tax-payer`;
  it("get -> save -> ledger -> offset -> get (tx_pmt) -> EVC OTP -> file, and nil 3B", async () => {
    const g = gateway({
      [GST_RETURNS_PATHS.verifyOtp()]: verifyRoute,
      "/gstr-3b/2026/08/offset-liability": () => ok({ data: { reference_id: "OFF-1" } }),
      "/gstr-3b/2026/08/file": () => ok({ data: { reference_id: "ARN-3B" } }),
      "/gstr-3b/2026/08": (init) => (init.method === "POST" ? ok({ data: { reference_id: "SAVE-3B" } }) : ok({ data: { sup_details: { a: 1 }, tx_pmt: { b: 2 } } })),
      "/ledgers/bal/2026/08": () => ok({ data: { cash_bal: {}, itc_bal: {} } }),
      "/evc/otp": () => ok({}),
    });
    const c = new SandboxGstReturnsClient(new SandboxClient(CFG, g.fn), ME);
    await c.verifyOtp("123456");
    const calls = g.calls;

    expect(await c.getGstr3b("082026")).toMatchObject({ tx_pmt: { b: 2 } });
    expect(calls.at(-1)!.url).toBe(`${BASE}/gstrs/gstr-3b/2026/08`);
    expect(calls.at(-1)!.init.method).toBe("GET");

    expect(await c.saveGstr3b("082026", { ret_period: "082026" })).toBe("SAVE-3B");
    expect(calls.at(-1)!.init.method).toBe("POST");
    expect(calls.at(-1)!.url).toBe(`${BASE}/gstrs/gstr-3b/2026/08`);

    await c.getLedgerBalances("082026");
    expect(calls.at(-1)!.url).toBe(`${BASE}/ledgers/bal/2026/08`);
    expect(calls.at(-1)!.init.method).toBe("GET");

    expect(await c.offsetGstr3bLiability("082026", { pdcash: [1], pditc: { x: 1 } })).toBe("OFF-1");
    expect(calls.at(-1)!.url).toBe(`${BASE}/gstrs/gstr-3b/2026/08/offset-liability`);
    expect(body(calls.at(-1)!)).toEqual({ pdcash: [1], pditc: { x: 1 } });

    await c.requestEvcOtp("gstr-3b", "ABCDE1234F");
    expect(calls.at(-1)!.url).toBe(`${BASE}/evc/otp?gstr=gstr-3b`);

    await c.fileGstr3b("082026", "424242", "ABCDE1234F", { sup_details: { a: 1 }, tx_pmt: { b: 2 } });
    const f = calls.at(-1)!;
    const u = new URL(f.url);
    expect(u.pathname).toBe("/gst/compliance/tax-payer/gstrs/gstr-3b/2026/08/file");
    expect(u.search).toBe("?pan=ABCDE1234F&otp=424242");
    expect(body(f)).toEqual({ ret_period: "082026", gstin: ME.gstin, sup_details: { a: 1 }, tx_pmt: { b: 2 } });

    await c.fileNilGstr3b("082026", "424242", "ABCDE1234F");
    expect(body(calls.at(-1)!)).toEqual({ ret_period: "082026", gstin: ME.gstin, isNil: "Y" });
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
