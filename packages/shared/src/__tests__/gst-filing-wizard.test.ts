import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deriveWizardStep,
  wizardSteps,
  nextPollDelay,
  POLL_INTERVAL_MS,
  sessionRemainingMs,
  PORTAL_SESSION_MS,
  PORTAL_SESSION_MARGIN_MS,
  formatRemaining,
  formatElapsed,
  isPortalSessionError,
  preflightFromStatus,
  reconcile3bWithGstr1,
  groupPortalErrors,
  summariseSecSum,
  itcRows,
  itcUsedTotal,
  cleanOtp,
  isOtpComplete,
  finalConfirmationTitle,
  NIL_CONFIRM_TEXT,
  gstnPeriodOf,
  periodFromGstn,
  fyStartOf,
  wizardPeriodLabel,
  startPortalPolling,
  canFileGstReturns,
  POLL_TIMEOUT_MS,
  type AttemptStateName,
  type StatusMonth,
} from "../gst-filing-wizard";

const base = { signedIn: true, checked: true };

describe("deriveWizardStep", () => {
  it("a fresh return starts at the pre-flight, then sign-in, then the choice", () => {
    expect(deriveWizardStep({ kind: "gstr1", state: "draft", nil: false, signedIn: false, checked: false })).toEqual({ step: "check", phase: "check" });
    expect(deriveWizardStep({ kind: "gstr1", state: "draft", nil: false, signedIn: false, checked: true })).toMatchObject({ step: "signin", resume: { step: "prepare", phase: "choose" } });
    expect(deriveWizardStep({ kind: "gstr1", state: "draft", nil: false, ...base })).toEqual({ step: "prepare", phase: "choose" });
  });

  const gstr1: Array<[AttemptStateName, string, string]> = [
    ["saved", "prepare", "polling_save"],
    ["save_validated", "prepare", "save_ok"],
    ["save_errors", "prepare", "save_errors"],
    ["proceeding", "prepare", "polling_proceed"],
    ["proceed_errors", "prepare", "proceed_errors"],
    ["ready_to_file", "review", "load_summary"],
    ["summary_fetched", "review", "summary"],
    ["otp_requested", "otp", "otp_enter"],
    ["failed", "otp", "otp_failed"],
    ["filed", "done", "filed"],
  ];
  it.each(gstr1)("GSTR-1 %s resumes at %s / %s", (state, step, phase) => {
    expect(deriveWizardStep({ kind: "gstr1", state, nil: false, ...base })).toEqual({ step, phase });
  });

  const gstr3b: Array<[AttemptStateName, string, string]> = [
    ["saved", "prepare", "polling_save"],
    ["save_validated", "review", "load_ledger"],
    ["save_errors", "prepare", "save_errors"],
    ["ledger_checked", "review", "setoff"],
    ["offset_confirmed", "review", "setoff"],
    ["offset_posted", "review", "polling_offset"],
    ["offset_validated", "review", "load_details"],
    ["offset_errors", "review", "offset_errors"],
    ["details_fetched", "review", "final"],
    ["otp_requested", "otp", "otp_enter"],
    ["failed", "otp", "otp_failed"],
    ["filed", "done", "filed"],
  ];
  it.each(gstr3b)("GSTR-3B %s resumes at %s / %s", (state, step, phase) => {
    expect(deriveWizardStep({ kind: "gstr3b", state, nil: false, ...base })).toEqual({ step, phase });
  });

  it("nil GSTR-1: proceeding polls, ready_to_file goes straight to the OTP (no summary)", () => {
    expect(deriveWizardStep({ kind: "gstr1", state: "proceeding", nil: true, ...base })).toEqual({ step: "prepare", phase: "polling_proceed" });
    expect(deriveWizardStep({ kind: "gstr1", state: "ready_to_file", nil: true, ...base })).toEqual({ step: "otp", phase: "otp_request" });
  });

  it("nil GSTR-3B resumes at the OTP", () => {
    expect(deriveWizardStep({ kind: "gstr3b", state: "otp_requested", nil: true, ...base })).toEqual({ step: "otp", phase: "otp_enter" });
  });

  it("without a portal session, sign-in comes first and remembers where to resume", () => {
    expect(deriveWizardStep({ kind: "gstr3b", state: "ledger_checked", nil: false, signedIn: false, checked: true })).toEqual({
      step: "signin",
      phase: "signin",
      resume: { step: "review", phase: "setoff" },
    });
  });

  it("a filed return never asks for sign-in", () => {
    expect(deriveWizardStep({ kind: "gstr1", state: "filed", nil: false, signedIn: false, checked: false })).toEqual({ step: "done", phase: "filed" });
  });

  it("every state of the machine maps to a position", () => {
    const all: AttemptStateName[] = ["saved", "save_validated", "save_errors", "proceeding", "ready_to_file", "proceed_errors", "summary_fetched", "ledger_checked", "offset_confirmed", "offset_posted", "offset_validated", "offset_errors", "details_fetched", "otp_requested", "filed", "failed"];
    for (const kind of ["gstr1", "gstr3b"] as const) {
      for (const state of all) {
        for (const nil of [false, true]) {
          const p = deriveWizardStep({ kind, state, nil, ...base });
          expect(p.step).toBeTruthy();
          expect(p.phase).toBeTruthy();
        }
      }
    }
  });

  it("the stepper drops Review for a nil return", () => {
    expect(wizardSteps(false).map((s) => s.step)).toContain("review");
    expect(wizardSteps(true).map((s) => s.step)).not.toContain("review");
  });
});

describe("polling and session clocks", () => {
  it("never polls faster than 12 s, whatever the server hints", () => {
    expect(POLL_INTERVAL_MS).toBe(12_000);
    expect(nextPollDelay(0)).toBe(12_000);
    expect(nextPollDelay(null)).toBe(12_000);
    expect(nextPollDelay(3000)).toBe(12_000);
    expect(nextPollDelay(20_000)).toBe(20_000);
  });

  it("the portal session lasts 6 hours less the 10 minute margin", () => {
    const t0 = 1_000_000;
    expect(sessionRemainingMs(t0, t0)).toBe(PORTAL_SESSION_MS - PORTAL_SESSION_MARGIN_MS);
    expect(sessionRemainingMs(t0, t0 + PORTAL_SESSION_MS)).toBe(0);
    expect(sessionRemainingMs(null, t0)).toBe(0);
    expect(sessionRemainingMs(NaN, t0)).toBe(0);
  });

  it("formats remaining time and elapsed time", () => {
    expect(formatRemaining(0)).toBe("expired");
    expect(formatRemaining(30_000)).toBe("less than a minute");
    expect(formatRemaining(42 * 60_000)).toBe("42 min");
    expect(formatRemaining((5 * 60 + 12) * 60_000)).toBe("5 h 12 min");
    expect(formatElapsed(45_000)).toBe("45 s");
    expect(formatElapsed(125_000)).toBe("2 min 05 s");
  });

  it("an UNAUTHORIZED on a filing procedure is a portal session error, but not on the sign-in calls", () => {
    const err = (path: string, code = "UNAUTHORIZED") => ({ data: { code, path } });
    expect(isPortalSessionError(err("gstReturns.fileGstr1"))).toBe(true);
    expect(isPortalSessionError(err("gstReturns.pollReturnStatus"))).toBe(true);
    expect(isPortalSessionError(err("gstReturns.verifyOtp"))).toBe(false);
    expect(isPortalSessionError(err("gstReturns.requestOtp"))).toBe(false);
    expect(isPortalSessionError(err("invoice.list"))).toBe(false);
    expect(isPortalSessionError(err("gstReturns.fileGstr1", "BAD_REQUEST"))).toBe(false);
    expect(isPortalSessionError(null)).toBe(false);
  });
});

const filed = (arn: string) => ({ arn, filedOn: "2026-05-11" });
const m = (period: string, over: Partial<StatusMonth> = {}): StatusMonth => ({ period, label: period, gstr1: null, gstr3b: null, ...over });

describe("preflightFromStatus", () => {
  const fy = (over: Record<string, Partial<StatusMonth>>) =>
    ["042026", "052026", "062026", "072026", "082026", "092026"].map((p) => m(p, over[p] ?? {}));

  it("is ok when earlier returns are filed", () => {
    const r = preflightFromStatus({ kind: "gstr1", period: "062026", composition: false, months: fy({ "042026": { gstr1: filed("A") }, "052026": { gstr1: filed("B") } }) });
    expect(r.verdict).toBe("ok");
    expect(r.missing).toEqual([]);
  });

  it("is missing, naming the return, when an earlier month is not filed", () => {
    const r = preflightFromStatus({ kind: "gstr1", period: "072026", composition: false, months: fy({ "042026": { gstr1: filed("A") }, "062026": { gstr1: filed("C") } }) });
    expect(r.verdict).toBe("missing");
    expect(r.missing).toEqual([{ kind: "gstr1", period: "052026", label: "GSTR-1 May 2026" }]);
  });

  it("GSTR-3B also needs GSTR-1 of the same period", () => {
    const r = preflightFromStatus({ kind: "gstr3b", period: "062026", composition: false, months: fy({ "052026": { gstr3b: filed("A"), gstr1: filed("B") } }) });
    expect(r.verdict).toBe("missing");
    expect(r.missing).toEqual([{ kind: "gstr1", period: "062026", label: "GSTR-1 Jun 2026" }]);
  });

  it("nothing filed at all is allowed with a note (first return)", () => {
    const r = preflightFromStatus({ kind: "gstr1", period: "062026", composition: false, months: fy({}) });
    expect(r.verdict).toBe("ok");
    expect(r.notes.join(" ")).toMatch(/first return/);
  });

  it("an unavailable portal is unknown (a warning), composition is skipped", () => {
    expect(preflightFromStatus({ kind: "gstr1", period: "062026", composition: false, months: null }).verdict).toBe("unknown");
    expect(preflightFromStatus({ kind: "gstr1", period: "062026", composition: true, months: [] }).verdict).toBe("skipped");
  });

  it("reports a return the portal already shows as filed", () => {
    const r = preflightFromStatus({ kind: "gstr1", period: "062026", composition: false, months: fy({ "062026": { gstr1: filed("ARN1") } }) });
    expect(r.alreadyFiled).toEqual({ arn: "ARN1", filedOn: "2026-05-11" });
  });

  it("April looks back to March of the previous year, and no further", () => {
    const months = [m("022026", { gstr1: filed("X") }), m("032026"), m("042026")];
    const r = preflightFromStatus({ kind: "gstr1", period: "042026", composition: false, months });
    expect(r.missing.map((x) => x.period)).toEqual(["032026"]);
  });
});

describe("reconcile3bWithGstr1", () => {
  it("is quiet when they agree and warns when they differ", () => {
    expect(reconcile3bWithGstr1({ gstr1: { totalTaxableValue: 1000, totalTax: 180 }, gstr3b: { outwardTaxableValue: 1000.4, outwardTax: 180 } })).toBeNull();
    expect(reconcile3bWithGstr1({ gstr1: { totalTaxableValue: 1000, totalTax: 180 }, gstr3b: { outwardTaxableValue: 900, outwardTax: 162 } })).toMatch(/differ/);
  });
});

describe("groupPortalErrors", () => {
  it("groups by section, keeps order, drops blanks and duplicates, and marks where to fix", () => {
    const g = groupPortalErrors([
      "B2B invoice INV-1: invalid GSTIN",
      "HSN 9983 is not valid for the turnover",
      "b2b invoice INV-2: place of supply missing",
      "B2B invoice INV-1: invalid GSTIN",
      "  ",
      "Something unexpected",
      "CDNR note CN-1 refers to a missing invoice",
    ]);
    expect(g.map((x) => x.section)).toEqual(["b2b", "hsn", "other", "cdnr"]);
    expect(g[0]).toMatchObject({ fix: "invoices", messages: ["B2B invoice INV-1: invalid GSTIN", "b2b invoice INV-2: place of supply missing"] });
    expect(g[1]).toMatchObject({ fix: "items" });
    expect(g[2]).toMatchObject({ fix: null, label: "Other messages from the GST portal" });
    expect(g[3]).toMatchObject({ fix: "credit-notes" });
  });
});

describe("summariseSecSum", () => {
  it("reads section totals, with friendly names", () => {
    const rows = summariseSecSum([
      { sec_nm: "B2B", ttl_rec: 3, ttl_val: 1180, ttl_tax: 1000, ttl_igst: 0, ttl_cgst: 90, ttl_sgst: "90", ttl_cess: 0 },
      { sec_nm: "HSN" },
      { nothing: true },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ section: "B2B invoices", records: 3, value: 1180, taxable: 1000, cgst: 90, sgst: 90 });
    expect(rows[1]).toMatchObject({ section: "HSN summary", records: null, value: null });
    expect(summariseSecSum("x")).toEqual([]);
  });
});

describe("set-off helpers", () => {
  const p = {
    itc: { igstOnIgst: 100, igstOnCgst: 0, igstOnSgst: 20.5, cgstOnCgst: 50, cgstOnIgst: 0, sgstOnSgst: 0, sgstOnIgst: 0 },
    cash: { igst: { tx: 0, intr: 0, fee: 0 }, cgst: { tx: 0, intr: 0, fee: 0 }, sgst: { tx: 0, intr: 0, fee: 0 } },
    cashNeeded: { igst: 0, cgst: 0, sgst: 0 },
    cashShortfall: { igst: 0, cgst: 0, sgst: 0 },
    sufficient: true,
    itcRemaining: { igst: 0, cgst: 0, sgst: 0 },
  };
  it("lists only the credit that is used and totals it exactly", () => {
    expect(itcRows(p)).toEqual([
      { credit: "IGST credit", against: "IGST", amount: 100 },
      { credit: "IGST credit", against: "SGST", amount: 20.5 },
      { credit: "CGST credit", against: "CGST", amount: 50 },
    ]);
    expect(itcUsedTotal(p)).toBe(170.5);
  });
});

describe("confirmations and OTP", () => {
  it("builds the words the user must confirm", () => {
    expect(finalConfirmationTitle("gstr1", "Aug 2026", "27ABCDE1234F1Z5")).toBe("File GSTR-1 for Aug 2026 for GSTIN 27ABCDE1234F1Z5");
    expect(NIL_CONFIRM_TEXT.gstr1("Aug 2026")).toBe("I confirm there were no outward supplies in Aug 2026");
  });
  it("keeps only digits (paste with spaces or dashes) up to 8, and wants 6", () => {
    expect(cleanOtp(" 123-456 ")).toBe("123456");
    expect(cleanOtp("1234567890")).toBe("12345678");
    expect(isOtpComplete("123456")).toBe(true);
    expect(isOtpComplete("12345")).toBe(false);
  });
  it("period helpers", () => {
    expect(gstnPeriodOf(2026, 8)).toBe("082026");
    expect(periodFromGstn("082026")).toEqual({ year: 2026, month: 8 });
    expect(fyStartOf(2026, 3)).toBe(2025);
    expect(fyStartOf(2026, 4)).toBe(2026);
    expect(wizardPeriodLabel(2026, 8)).toBe("Aug 2026");
  });
});

describe("startPortalPolling", () => {
  afterEach(() => vi.useRealTimers());

  it("first check at 12 s, every later one at least 12 s after, gives up after ~3 minutes", async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const onTimeout = vi.fn();
    const t0 = Date.now();
    startPortalPolling({
      poll: async () => {
        times.push(Date.now());
        return { status: "processing", retryAfterMs: 1000 };
      },
      onSettled: vi.fn(),
      onTimeout,
      onSessionLost: vi.fn(),
      onError: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(11_999);
    expect(times).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(times[0]! - t0).toBe(12_000);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(12_000);
    expect(times.length).toBeLessThanOrEqual(Math.ceil(POLL_TIMEOUT_MS / 12_000) + 1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("settles on done/errors, stops on cancel, reports a lost session, and a retry starts at once with restart", async () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    const poll = vi.fn(async () => ({ status: "errors" as const, errors: ["B2B bad"] }));
    startPortalPolling({ poll, onSettled, onTimeout: vi.fn(), onSessionLost: vi.fn(), onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onSettled).toHaveBeenCalledWith("errors", ["B2B bad"]);

    const stopped = vi.fn(async () => ({ status: "processing" as const }));
    const stop = startPortalPolling({ poll: stopped, onSettled: vi.fn(), onTimeout: vi.fn(), onSessionLost: vi.fn(), onError: vi.fn() });
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stopped).not.toHaveBeenCalled();

    const lost = vi.fn();
    startPortalPolling({
      poll: async () => {
        throw { data: { code: "UNAUTHORIZED", path: "gstReturns.pollReturnStatus" } };
      },
      onSettled: vi.fn(),
      onTimeout: vi.fn(),
      onSessionLost: lost,
      onError: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(lost).toHaveBeenCalled();

    const retry = vi.fn(async () => ({ status: "processing" as const }));
    startPortalPolling({ poll: retry, restart: true, onSettled: vi.fn(), onTimeout: vi.fn(), onSessionLost: vi.fn(), onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(retry).toHaveBeenCalledWith(true);
  });

  it("who may file", () => {
    expect(["owner", "admin", "ca_filing"].every(canFileGstReturns)).toBe(true);
    expect(["auditor", "accountant", "seller", "viewer", "", null, undefined].some((r) => canFileGstReturns(r))).toBe(false);
  });
});
