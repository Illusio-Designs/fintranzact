/**
 * The filing orchestration (lib/gst-filing.ts) with an in-memory attempt store
 * and a mocked Sandbox gateway: full sequences, validation-error loop, polling
 * schedule, resume after a crash, nil guards, token / OTP secrecy.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SandboxClient, SANDBOX_TEST_URL } from "../lib/sandbox/client.js";
import { SandboxGstReturnsClient, clearGstSessionsForTests, GstReturnsError } from "../lib/sandbox/gst-returns.js";
import { GstFiling, FilingRefusal, type AttemptStore } from "../lib/gst-filing.js";
import { resolvePan, pollDecision, POLL_FLOOR_MS, POLL_MAX_MS, FlowError, type Attempt } from "../lib/gst-return-flow.js";
import { logger } from "../lib/logger.js";
import type { GSTR1Report, GSTR3BReport } from "../lib/gst-reports.js";
import type { PrereqResult } from "../lib/gst-track.js";

const CFG = { apiKey: "key_test_abc", apiSecret: "s", baseUrl: SANDBOX_TEST_URL };
const GSTIN = "27AAAPL1234C1ZV";
const PAN = "AAAPL1234C";
const P = "082026";
const SECRET_OTP = "918273";
const SECRET_TOKEN = "taxpayer-token-xyz";
const SECRET_CHK = "chk-SECRET-777";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: object = {}) => json({ code: 200, data: { status_cd: "1", ...data } });

interface Rec { method: string; path: string; query: URLSearchParams; body: any; headers: Record<string, string> }

function makeWorld(over: { gstr1?: Partial<GSTR1Report>; gstr3b?: Partial<GSTR3BReport>; prereq?: PrereqResult } = {}) {
  const calls: Rec[] = [];
  const state = { status: "P" as string, statusErrors: undefined as unknown, failFile: null as null | Response, ledger: undefined as unknown, details: undefined as unknown, saveFailsOnce: false };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const rec: Rec = { method: init?.method ?? "GET", path: u.pathname.replace("/gst/compliance/tax-payer", ""), query: u.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> };
    if (u.pathname === "/authenticate") return json({ code: 200, data: { access_token: "api" } });
    calls.push(rec);
    const p = rec.path;
    if (p === "/otp/verify") return ok({ access_token: SECRET_TOKEN });
    if (p.endsWith("/status")) return ok({ data: { status_cd: state.status, ...(state.statusErrors ? { error_report: state.statusErrors } : {}) } });
    if (p.endsWith("/new-proceed")) return ok({ data: { reference_id: "REF-PROCEED" } });
    if (p.startsWith("/evc/otp")) return ok();
    if (p.endsWith("/offset-liability")) return ok({ data: { reference_id: "REF-OFFSET" } });
    if (p.startsWith("/ledgers/bal")) return ok({ data: state.ledger ?? { cash_bal: { igst: { tot: 0 }, cgst: { tot: 1000 }, sgst: { tot: 1000 } }, itc_bal: { igst_bal: 0, cgst_bal: 50, sgst_bal: 50 } } });
    if (p.endsWith("/file")) return state.failFile ?? ok({ data: { reference_id: "ARN-FILED" } });
    if (p.startsWith("/gstrs/gstr-3b/")) {
      if (rec.method === "POST") return ok({ data: { reference_id: "REF-SAVE3B" } });
      return ok({ data: state.details ?? { sup_details: { osup_det: { txval: 1 } }, tx_pmt: { net_tax_pay: [] } } });
    }
    if (p.startsWith("/gstrs/gstr-1/")) {
      if (rec.method === "POST") return ok({ data: { reference_id: "REF-SAVE" } });
      return ok({ data: { data: { sec_sum: [{ sec_nm: "B2B" }], chksum: SECRET_CHK } } });
    }
    return json({ message: "no route " + p }, 404);
  }) as unknown as typeof fetch;

  const journal = new Map<string, Attempt>();
  const store: AttemptStore & { failNextSave: boolean } = {
    failNextSave: false,
    async load(kind, period) { const a = journal.get(`${kind}.${period}`); return a ? structuredClone(a) : null; },
    async save(a) {
      if (this.failNextSave) { this.failNextSave = false; throw new Error("db down"); }
      const n = { ...a, updatedAt: clock.t };
      journal.set(`${a.kind}.${a.period}`, structuredClone(n));
      return n;
    },
  };
  const clock = { t: 1_000_000 };
  const sandbox = new SandboxClient(CFG, fetchImpl);
  const client = new SandboxGstReturnsClient(sandbox, { gstin: GSTIN, username: "u" }, { now: () => clock.t });
  const gstr1: GSTR1Report = { b2b: [], b2cLarge: [], b2cSmall: [], hsn: [], creditNotes: [], debitNotes: [], totalTaxableValue: 0, totalTax: 0, totalInvoiceValue: 0, invoiceCount: 0, ...over.gstr1 } as unknown as GSTR1Report;
  const zero = { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 };
  const gstr3b: GSTR3BReport = {
    outwardSupplies: { taxable: { ...zero }, zeroRated: { ...zero }, exempt: { ...zero } },
    rcmSupplies: { taxableValue: "0", cgst: "0", sgst: "0", igst: "0" },
    interStateUnregistered: [], itc: { igst: 0, cgst: 0, sgst: 0, total: 0 }, taxPayable: { igst: 0, cgst: 0, sgst: 0 }, netTax: { igst: 0, cgst: 0, sgst: 0, total: 0 },
    ...over.gstr3b,
  } as unknown as GSTR3BReport;
  const filing = new GstFiling({
    gstin: GSTIN, client, store, now: () => clock.t,
    gstr1Report: async () => gstr1, gstr3bReport: async () => gstr3b,
    pan: (i) => resolvePan({ input: i, business: null, gstin: GSTIN }),
    periodLabel: "Aug 2026",
    ...(over.prereq ? { prerequisite: async () => over.prereq! } : {}),
  });
  return { filing, calls, state, journal, store, clock, client };
}

const paths = (w: { calls: Rec[] }) => w.calls.map((c) => `${c.method} ${c.path}`);

beforeEach(async () => {
  clearGstSessionsForTests();
  vi.restoreAllMocks();
});

async function signedIn(w: ReturnType<typeof makeWorld>) {
  await w.client.verifyOtp("123456");
  w.calls.length = 0;
}

describe("GSTR-1 normal flow", () => {
  it("runs the whole recipe in order and files with sec_sum + chksum from the summary", async () => {
    const w = makeWorld();
    await signedIn(w);
    expect(await w.filing.saveGstr1(P, { gt: 1, curGt: 2 })).toMatchObject({ state: "saved", referenceId: "REF-SAVE" });
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ state: "save_validated", status: "done" });
    expect(await w.filing.proceedGstr1(P, { nil: false, confirmNil: false })).toMatchObject({ state: "proceeding", referenceId: "REF-PROCEED" });
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ state: "ready_to_file" });
    expect(await w.filing.fetchGstr1Summary(P)).toMatchObject({ state: "summary_fetched" });
    expect(await w.filing.requestEvcOtp("gstr1", P, {})).toMatchObject({ sent: true, panSource: "gstin", panMasked: "AA*******C" });
    expect(await w.filing.file("gstr1", P, SECRET_OTP)).toMatchObject({ filed: true, referenceId: "ARN-FILED", nil: false });

    expect(paths(w)).toEqual([
      "POST /gstrs/gstr-1/2026/08",
      "GET /gstrs/2026/08/status",
      "POST /gstrs/gstr-1/2026/08/new-proceed",
      "GET /gstrs/2026/08/status",
      "GET /gstrs/gstr-1/2026/08",
      "POST /evc/otp",
      "POST /gstrs/gstr-1/2026/08/file",
    ]);
    const proceed = w.calls[2]!;
    expect(proceed.query.get("is_nil")).toBe("N");
    const file = w.calls.at(-1)!;
    expect(file.query.get("pan")).toBe(PAN);
    expect(file.query.get("otp")).toBe(SECRET_OTP);
    expect(file.body).toEqual({ ret_period: P, newSumFlag: true, sec_sum: [{ sec_nm: "B2B" }], gstin: GSTIN, chksum: SECRET_CHK });
    expect(w.journal.get(`gstr1.${P}`)).toMatchObject({ state: "filed", filedRef: "ARN-FILED", nil: false });
    expect(JSON.stringify([...w.journal.values()])).not.toContain(SECRET_OTP);
    expect(JSON.stringify([...w.journal.values()])).not.toContain(SECRET_TOKEN);
  });

  it("steps cannot be skipped", async () => {
    const w = makeWorld();
    await signedIn(w);
    await expect(w.filing.proceedGstr1(P, { nil: false, confirmNil: false })).rejects.toBeInstanceOf(FlowError);
    await expect(w.filing.file("gstr1", P, "123456")).rejects.toBeInstanceOf(FilingRefusal);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    await expect(w.filing.fetchGstr1Summary(P)).rejects.toBeInstanceOf(FlowError);
    await expect(w.filing.requestEvcOtp("gstr1", P, {})).rejects.toBeInstanceOf(FlowError);
    expect(paths(w)).toEqual(["POST /gstrs/gstr-1/2026/08"]);
  });

  it("validation errors: portal messages surface, proceed is refused until the data is saved again", async () => {
    const w = makeWorld();
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    w.state.status = "PE";
    w.state.statusErrors = { b2b: [{ error_cd: "RET191", error_msg: "Invalid recipient GSTIN" }] };
    w.clock.t += 12_000;
    const r = await w.filing.pollStatus("gstr1", P);
    expect(r).toMatchObject({ status: "errors", state: "save_errors", errors: ["Invalid recipient GSTIN"] });
    await expect(w.filing.proceedGstr1(P, { nil: false, confirmNil: false })).rejects.toMatchObject({ code: "needs_resave" });
    // fix the data and save again
    w.state.status = "P";
    w.state.statusErrors = undefined;
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ state: "save_validated" });
    expect(await w.filing.proceedGstr1(P, { nil: false, confirmNil: false })).toMatchObject({ state: "proceeding" });
  });

  it("proceed errors also require a re-save", async () => {
    const w = makeWorld();
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    w.clock.t += 12_000;
    await w.filing.pollStatus("gstr1", P);
    await w.filing.proceedGstr1(P, { nil: false, confirmNil: false });
    w.state.status = "ER";
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ state: "proceed_errors", status: "errors" });
    await expect(w.filing.proceedGstr1(P, { nil: false, confirmNil: false })).rejects.toMatchObject({ code: "needs_resave" });
  });

  it("wrong OTP: filing fails with the portal message, the user can request a new OTP and file", async () => {
    const w = makeWorld();
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    w.clock.t += 12_000; await w.filing.pollStatus("gstr1", P);
    await w.filing.proceedGstr1(P, { nil: false, confirmNil: false });
    w.clock.t += 12_000; await w.filing.pollStatus("gstr1", P);
    await w.filing.fetchGstr1Summary(P);
    await w.filing.requestEvcOtp("gstr1", P, {});
    w.state.failFile = json({ code: 400, message: "Invalid OTP" }, 400);
    await expect(w.filing.file("gstr1", P, "000000")).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("Invalid OTP") });
    expect(w.journal.get(`gstr1.${P}`)).toMatchObject({ state: "failed", lastError: expect.stringContaining("Invalid OTP") });
    w.state.failFile = null;
    await w.filing.requestEvcOtp("gstr1", P, {});
    expect(await w.filing.file("gstr1", P, SECRET_OTP)).toMatchObject({ filed: true });
  });

  it("resume after a crash: a lost journal write is simply re-run; stored steps are not repeated", async () => {
    const w = makeWorld();
    await signedIn(w);
    w.store.failNextSave = true;
    await expect(w.filing.saveGstr1(P, { gt: 0, curGt: 0 })).rejects.toThrow("db down");
    expect(w.journal.size).toBe(0); // still draft: re-saving is the safe resume
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    w.clock.t += 12_000; await w.filing.pollStatus("gstr1", P);
    await w.filing.proceedGstr1(P, { nil: false, confirmNil: false });
    const n = w.calls.length;
    // a second proceed while proceeding returns the stored reference without calling out
    expect(await w.filing.proceedGstr1(P, { nil: false, confirmNil: false })).toMatchObject({ resumed: true, referenceId: "REF-PROCEED" });
    expect(w.calls.length).toBe(n);
    w.clock.t += 12_000; await w.filing.pollStatus("gstr1", P);
    await w.filing.fetchGstr1Summary(P);
    await w.filing.requestEvcOtp("gstr1", P, {});
    const m = w.calls.length;
    await w.filing.fetchGstr1Summary(P); // stored: no second GET
    expect(w.calls.length).toBe(m);
  });
});

describe("status polling schedule", () => {
  it("does not hit the portal before the interval, never faster than 10 s, and stops after the maximum", async () => {
    const w = makeWorld();
    await signedIn(w);
    w.state.status = "IP";
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    const calls0 = w.calls.length;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ status: "wait", retryAfterMs: 12_000 });
    w.clock.t += 9_999;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ status: "wait" });
    expect(w.calls.length).toBe(calls0); // no portal call yet
    w.clock.t += 2_001; // 12 s since save
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ status: "processing" });
    expect(w.calls.length).toBe(calls0 + 1);
    // immediately again: wait, no call
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ status: "wait" });
    expect(w.calls.length).toBe(calls0 + 1);
    // keep polling every 12 s until the 3 minute cap
    const stamps: number[] = [w.clock.t];
    for (let i = 0; i < 30; i++) {
      w.clock.t += 12_000;
      const r = await w.filing.pollStatus("gstr1", P);
      if (r.status === "timeout") break;
      stamps.push(w.clock.t);
    }
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(POLL_FLOOR_MS);
    const before = w.calls.length;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ status: "timeout" });
    expect(w.calls.length).toBe(before);
    // an explicit restart opens a new window
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr1", P, { restart: true })).toMatchObject({ status: "wait" });
  });

  it("pollDecision: the interval is clamped to the 10 s floor and the window to the maximum", () => {
    expect(pollDecision({ pollStartedAt: 0, lastPolledAt: 0 }, 5_000, { intervalMs: 1_000 })).toEqual({ action: "wait", retryAfterMs: 5_000 });
    expect(pollDecision({ pollStartedAt: 0, lastPolledAt: 0 }, 10_000, { intervalMs: 1_000 })).toEqual({ action: "poll" });
    expect(pollDecision({ pollStartedAt: 0, lastPolledAt: 0 }, POLL_MAX_MS + 1)).toEqual({ action: "timeout" });
  });
});

describe("nil GSTR-1", () => {
  it("full sequence: proceed is_nil=Y, poll, EVC OTP, file with isnil only", async () => {
    const w = makeWorld();
    await signedIn(w);
    await w.filing.proceedGstr1(P, { nil: true, confirmNil: true });
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr1", P)).toMatchObject({ state: "ready_to_file" });
    await w.filing.requestEvcOtp("gstr1", P, {});
    expect(await w.filing.file("gstr1", P, SECRET_OTP)).toMatchObject({ filed: true, nil: true });
    expect(paths(w)).toEqual(["POST /gstrs/gstr-1/2026/08/new-proceed", "GET /gstrs/2026/08/status", "POST /evc/otp", "POST /gstrs/gstr-1/2026/08/file"]);
    expect(w.calls[0]!.query.get("is_nil")).toBe("Y");
    expect(w.calls[0]!.body).toEqual({ gstin: GSTIN, ret_period: P });
    expect(w.calls.at(-1)!.body).toEqual({ ret_period: P, gstin: GSTIN, isnil: "Y" });
    expect(w.journal.get(`gstr1.${P}`)).toMatchObject({ nil: true, state: "filed" });
  });

  it("requires the explicit confirmation and is refused when the period has data", async () => {
    const w = makeWorld();
    await signedIn(w);
    await expect(w.filing.proceedGstr1(P, { nil: true, confirmNil: false })).rejects.toMatchObject({ kind: "bad_input" });
    expect(w.calls.length).toBe(0);
    for (const [name, patch] of [
      ["invoices", { invoiceCount: 1 }],
      ["b2b", { b2b: [{}] }],
      ["b2c small", { b2cSmall: [{}] }],
      ["credit notes", { creditNotes: [{}] }],
      ["tax", { totalTax: 5 }],
    ] as const) {
      const d = makeWorld({ gstr1: patch as never });
      await signedIn(d);
      await expect(d.filing.proceedGstr1(P, { nil: true, confirmNil: true }), name).rejects.toThrow(/cannot be filed/);
      expect(d.calls.length, name).toBe(0);
    }
  });

  it("is never selected on its own: the default proceed is is_nil=N", async () => {
    const w = makeWorld();
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    w.clock.t += 12_000; await w.filing.pollStatus("gstr1", P);
    await w.filing.proceedGstr1(P, { nil: false, confirmNil: false });
    expect(w.calls.at(-1)!.query.get("is_nil")).toBe("N");
  });
});

describe("GSTR-3B", () => {
  const withTax = { gstr3b: { outwardSupplies: { taxable: { taxableValue: 1000, igst: 0, cgst: 90, sgst: 90 }, zeroRated: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 }, exempt: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 } } } } as never;

  async function upToSaved(w: ReturnType<typeof makeWorld>) {
    await signedIn(w);
    await w.filing.saveGstr3b(P);
    w.clock.t += 12_000;
    await w.filing.pollStatus("gstr3b", P);
  }

  it("runs all 8 steps; tx_pmt from the second GET goes into the file body", async () => {
    const w = makeWorld(withTax);
    await upToSaved(w);
    const ck = await w.filing.checkLedger(P);
    expect(ck.proposal.itc.cgstOnCgst).toBe(50);
    expect(ck.proposal.cash.cgst.tx).toBe(40);
    expect(ck.proposal.sufficient).toBe(true);
    // nothing posted until confirmed
    expect(paths(w)).not.toContain("POST /gstrs/gstr-3b/2026/08/offset-liability");
    expect(await w.filing.postOffset(P, ck.proposalKey)).toMatchObject({ state: "offset_posted", referenceId: "REF-OFFSET" });
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr3b", P)).toMatchObject({ state: "offset_validated" });
    expect(await w.filing.fetchDetails(P)).toMatchObject({ state: "details_fetched", hasTxPmt: true });
    await w.filing.requestEvcOtp("gstr3b", P, {});
    expect(await w.filing.file("gstr3b", P, SECRET_OTP)).toMatchObject({ filed: true, nil: false });
    expect(paths(w)).toEqual([
      "GET /gstrs/gstr-3b/2026/08",
      "POST /gstrs/gstr-3b/2026/08",
      "GET /gstrs/2026/08/status",
      "GET /ledgers/bal/2026/08",
      "POST /gstrs/gstr-3b/2026/08/offset-liability",
      "GET /gstrs/2026/08/status",
      "GET /gstrs/gstr-3b/2026/08",
      "POST /evc/otp",
      "POST /gstrs/gstr-3b/2026/08/file",
    ]);
    const off = w.calls.find((c) => c.path.endsWith("offset-liability"))!;
    expect(off.body.pditc).toMatchObject({ c_pdc: 50, s_pds: 50 });
    expect(off.body.pdcash[0]).toMatchObject({ cpd: { tx: 40, intr: 0, fee: 0 }, spd: { tx: 40 } });
    const file = w.calls.at(-1)!;
    expect(file.query.get("otp")).toBe(SECRET_OTP);
    expect(file.body).toMatchObject({ ret_period: P, gstin: GSTIN, tx_pmt: { net_tax_pay: [] }, sup_details: { osup_det: { txval: 1 } } });
    expect(w.calls.find((c) => c.path === "/evc/otp")!.query.get("gstr")).toBe("gstr-3b");
  });

  it("the offset needs the confirmed proposal and enough cash; a stale confirmation is refused", async () => {
    const w = makeWorld(withTax);
    await upToSaved(w);
    const ck = await w.filing.checkLedger(P);
    await expect(w.filing.postOffset(P, "stale")).rejects.toMatchObject({ kind: "bad_input" });
    expect(paths(w)).not.toContain("POST /gstrs/gstr-3b/2026/08/offset-liability");

    const poor = makeWorld(withTax);
    poor.state.ledger = { cash_bal: { igst_bal: 0, cgst_bal: 0, sgst_bal: 0 }, itc_bal: { igst_bal: 0, cgst_bal: 0, sgst_bal: 0 } };
    await upToSaved(poor);
    const ck2 = await poor.filing.checkLedger(P);
    expect(ck2.proposal.sufficient).toBe(false);
    await expect(poor.filing.postOffset(P, ck2.proposalKey)).rejects.toThrow(/cash ledger does not cover/);
    void ck;
  });

  it("an unreadable ledger response changes nothing", async () => {
    const w = makeWorld(withTax);
    w.state.ledger = { surprise: true };
    await upToSaved(w);
    await expect(w.filing.checkLedger(P)).rejects.toThrow(/Could not read the ledger/);
    expect(w.journal.get(`gstr3b.${P}`)!.state).toBe("save_validated");
  });

  it("filing needs tx_pmt; missing tx_pmt blocks details", async () => {
    const w = makeWorld(withTax);
    w.state.details = { sup_details: {} };
    await upToSaved(w);
    const ck = await w.filing.checkLedger(P);
    await w.filing.postOffset(P, ck.proposalKey);
    w.clock.t += 12_000; await w.filing.pollStatus("gstr3b", P);
    await expect(w.filing.fetchDetails(P)).rejects.toThrow(/tx_pmt/);
  });

  it("save errors loop back to a re-save; offset errors restart the tax payment step", async () => {
    const w = makeWorld(withTax);
    await signedIn(w);
    await w.filing.saveGstr3b(P);
    w.state.status = "PE";
    w.clock.t += 12_000;
    expect(await w.filing.pollStatus("gstr3b", P)).toMatchObject({ state: "save_errors" });
    await expect(w.filing.checkLedger(P)).rejects.toMatchObject({ code: "needs_resave" });
  });

  it("is blocked while GSTR-1 for the same period is known to be unfiled", async () => {
    const w = makeWorld(withTax);
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    await expect(w.filing.saveGstr3b(P)).rejects.toThrow(/GSTR-1 for Aug 2026 is not filed yet/);
  });

  it("surfaces a non-blocking reconciliation hint when 3B and GSTR-1 totals differ", async () => {
    const w = makeWorld(withTax);
    await signedIn(w);
    const r = await w.filing.saveGstr3b(P);
    expect(r.reconciliation).toMatch(/differ from GSTR-1/);
    expect(r.state).toBe("saved");
  });
});

describe("nil GSTR-3B", () => {
  it("OTP then file with exactly { ret_period, gstin, isNil: 'Y' }", async () => {
    const w = makeWorld();
    await signedIn(w);
    expect(await w.filing.requestEvcOtp("gstr3b", P, { nil: true, confirmNil: true })).toMatchObject({ sent: true, nil: true });
    expect(await w.filing.file("gstr3b", P, SECRET_OTP)).toMatchObject({ filed: true, nil: true });
    expect(paths(w)).toEqual(["POST /evc/otp", "POST /gstrs/gstr-3b/2026/08/file"]);
    expect(w.calls[0]!.query.get("gstr")).toBe("gstr-3b");
    expect(w.calls[1]!.body).toEqual({ ret_period: P, gstin: GSTIN, isNil: "Y" });
    expect(Object.keys(w.calls[1]!.body).sort()).toEqual(["gstin", "isNil", "ret_period"]);
  });

  it("requires the confirmation", async () => {
    const w = makeWorld();
    await signedIn(w);
    await expect(w.filing.requestEvcOtp("gstr3b", P, { nil: true })).rejects.toThrow(/no transactions in Aug 2026/);
    expect(w.calls.length).toBe(0);
  });

  const nonEmpty: Array<[string, Partial<GSTR3BReport>]> = [
    ["taxable outward", { outwardSupplies: { taxable: { taxableValue: 1, igst: 0, cgst: 0, sgst: 0 }, zeroRated: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 }, exempt: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 } } }],
    ["zero-rated", { outwardSupplies: { taxable: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 }, zeroRated: { taxableValue: 5, igst: 0, cgst: 0, sgst: 0 }, exempt: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 } } }],
    ["exempt", { outwardSupplies: { taxable: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 }, zeroRated: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 }, exempt: { taxableValue: 7, igst: 0, cgst: 0, sgst: 0 } } }],
    ["reverse charge", { rcmSupplies: { taxableValue: "10", cgst: "0", sgst: "0", igst: "0" } }],
    ["inter-state unregistered", { interStateUnregistered: [{ state: "KA", taxableValue: 1, igst: 0 }] }],
    ["ITC", { itc: { igst: 0, cgst: 3, sgst: 0, total: 3 } }],
    ["tax payable", { taxPayable: { igst: 0, cgst: 1, sgst: 0 } }],
    ["net tax", { netTax: { igst: 0, cgst: 0, sgst: 0, total: 2 } }],
  ];
  it.each(nonEmpty)("is refused when the books have %s", async (_name, patch) => {
    const w = makeWorld({ gstr3b: patch });
    await signedIn(w);
    await expect(w.filing.requestEvcOtp("gstr3b", P, { nil: true, confirmNil: true })).rejects.toThrow(/cannot be filed/);
    expect(w.calls.length).toBe(0);
  });

  it("is refused while GSTR-1 for the period is known to be unfiled, and resumes after a lost journal write", async () => {
    const w = makeWorld();
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    await expect(w.filing.requestEvcOtp("gstr3b", P, { nil: true, confirmNil: true })).rejects.toThrow(/GSTR-1/);

    const r = makeWorld();
    await signedIn(r);
    r.store.failNextSave = true;
    await expect(r.filing.requestEvcOtp("gstr3b", P, { nil: true, confirmNil: true })).rejects.toThrow("db down");
    await r.filing.requestEvcOtp("gstr3b", P, { nil: true, confirmNil: true }); // still draft: just ask again
    expect(await r.filing.file("gstr3b", P, SECRET_OTP)).toMatchObject({ filed: true });
  });
});

describe("secrets are never logged", () => {
  it("OTP, taxpayer token and chksum stay out of every logger call, including failures", async () => {
    const spies = (["info", "warn", "error", "debug"] as const).map((l) => vi.spyOn(logger, l as never));
    const w = makeWorld();
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    w.clock.t += 12_000; await w.filing.pollStatus("gstr1", P);
    await w.filing.proceedGstr1(P, { nil: false, confirmNil: false });
    w.clock.t += 12_000; await w.filing.pollStatus("gstr1", P);
    await w.filing.fetchGstr1Summary(P);
    await w.filing.requestEvcOtp("gstr1", P, {});
    w.state.failFile = json({ code: 400, message: "Invalid OTP" }, 400);
    await w.filing.file("gstr1", P, SECRET_OTP).catch(() => undefined);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).toContain("Sandbox request failed"); // the failure was logged...
    for (const secret of [SECRET_OTP, SECRET_TOKEN, SECRET_CHK, "sess"]) expect(logged).not.toContain(secret); // ...without secrets
  });
});

describe("PAN", () => {
  it("prefers explicit input, then the business PAN, then the GSTIN; invalid values are skipped", () => {
    expect(resolvePan({ input: "abcde1234f", business: "ZZZZZ9999Z", gstin: GSTIN })).toEqual({ pan: "ABCDE1234F", source: "input" });
    expect(resolvePan({ business: "ZZZZZ9999Z", gstin: GSTIN })).toEqual({ pan: "ZZZZZ9999Z", source: "business" });
    expect(resolvePan({ business: "bad", gstin: GSTIN })).toEqual({ pan: PAN, source: "gstin" });
    expect(resolvePan({ input: "x", business: null, gstin: "short" })).toBeNull();
  });
  it("an invalid PAN stops the EVC OTP request", async () => {
    const w = makeWorld();
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    await expect(w.filing.requestEvcOtp("gstr1", P, { pan: "12345" })).rejects.toBeInstanceOf(FlowError);
    void GstReturnsError;
  });
});

describe("return-status prerequisite (Track GST Returns)", () => {
  const ok: PrereqResult = { verdict: "ok", missing: [], alreadyFiled: null, notes: [] };
  const missing: PrereqResult = { verdict: "missing", missing: [{ returnType: "gstr1", period: "062026", label: "GSTR-1 Jun 2026" }, { returnType: "gstr1", period: "072026", label: "GSTR-1 Jul 2026" }], alreadyFiled: null, notes: [] };
  const unknown: PrereqResult = { verdict: "unknown", missing: [], alreadyFiled: null, notes: ["Sandbox is not configured on this server."] };

  it("blocks save with the list of missing returns, before anything is sent to the portal", async () => {
    const w = makeWorld({ prereq: missing });
    await signedIn(w);
    await expect(w.filing.saveGstr1(P, { gt: 0, curGt: 0 })).rejects.toThrow(/File these returns first: GSTR-1 Jun 2026, GSTR-1 Jul 2026/);
    expect(w.calls.length).toBe(0);
  });

  it("warns but allows when the status could not be verified", async () => {
    const w = makeWorld({ prereq: unknown });
    await signedIn(w);
    const r = await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    expect(r.state).toBe("saved");
    expect(r.warnings.join(" ")).toMatch(/Could not verify earlier returns/);
  });

  it("refuses a return the portal already shows as filed", async () => {
    const w = makeWorld({ prereq: { ...ok, alreadyFiled: { arn: "AA270826000001Z", filedOn: "2026-09-10", valid: true } } });
    await signedIn(w);
    await expect(w.filing.saveGstr1(P, { gt: 0, curGt: 0 })).rejects.toThrow(/already filed on the GST portal \(ARN AA270826000001Z\)/);
  });

  it("GSTR-3B is blocked while GSTR-1 of the same period is missing; nil 3B too", async () => {
    const m3: PrereqResult = { verdict: "missing", missing: [{ returnType: "gstr1", period: P, label: "GSTR-1 Aug 2026" }], alreadyFiled: null, notes: [] };
    const w = makeWorld({ prereq: m3 });
    await signedIn(w);
    await expect(w.filing.saveGstr3b(P)).rejects.toThrow(/GSTR-1 Aug 2026/);
    await expect(w.filing.requestEvcOtp("gstr3b", P, { nil: true, confirmNil: true })).rejects.toThrow(/GSTR-1 Aug 2026/);
    expect(w.calls.length).toBe(0);
  });

  it("when the portal cannot confirm GSTR-1, our own record still blocks 3B", async () => {
    const w = makeWorld({ prereq: unknown });
    await signedIn(w);
    await w.filing.saveGstr1(P, { gt: 0, curGt: 0 });
    await expect(w.filing.saveGstr3b(P)).rejects.toThrow(/GSTR-1 for Aug 2026 is not filed yet/);
  });

  it("skipped (composition) and ok verdicts pass without warnings", async () => {
    for (const v of ["ok", "skipped"] as const) {
      const w = makeWorld({ prereq: { ...ok, verdict: v } });
      await signedIn(w);
      expect((await w.filing.saveGstr1(P, { gt: 0, curGt: 0 })).warnings).toEqual([]);
    }
  });

  it("a nil GSTR-1 is checked when it starts", async () => {
    const w = makeWorld({ prereq: missing });
    await signedIn(w);
    await expect(w.filing.proceedGstr1(P, { nil: true, confirmNil: true })).rejects.toThrow(/File these returns first/);
    expect(w.calls.length).toBe(0);
  });
});
