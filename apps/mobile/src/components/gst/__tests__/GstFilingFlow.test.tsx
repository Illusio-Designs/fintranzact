/**
 * GstFilingFlow (mobile): the compact filing flow renders each step, resumes from the
 * persisted state, gates every irreversible step behind an explicit confirmation,
 * polls no faster than every 12 s, and never keeps the OTP.
 */
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { renderWithTheme as render } from "../../../test-utils";
import { useBusinessStore } from "../../../stores/business";
import { useGstSessionStore } from "../../../stores/gst-session";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockServer: { attempt: any; status: any; fns: Record<string, jest.Mock> } = { attempt: null, status: null, fns: {} };
const mockListeners = new Set<() => void>();
const mockNotify = () => mockListeners.forEach((l) => l());
const setAttempt = (over: Record<string, unknown>) => {
  mockServer.attempt = { ...mockServer.attempt, ...over };
  mockNotify();
};
const fn = (name: string): jest.Mock => (mockServer.fns[name] ??= jest.fn(async () => ({})));

jest.mock("../../../lib/trpc", () => {
  const R = require("react");
  const useStore = () => {
    const [, force] = R.useReducer((x: number) => x + 1, 0);
    R.useEffect(() => {
      mockListeners.add(force);
      return () => void mockListeners.delete(force);
    }, []);
  };
  const query = (read: (i: any) => unknown) => ({
    useQuery: (input: any, opts?: { enabled?: boolean }) => {
      useStore();
      if (opts?.enabled === false) return { data: undefined, isLoading: false, error: null, refetch: async () => ({}) };
      return { data: read(input), isLoading: false, error: null, refetch: async () => { mockNotify(); return {}; } };
    },
  });
  const mutation = (name: string) => ({ useMutation: () => ({ mutateAsync: (i: unknown) => fn(name)(i), isPending: false }) });
  const gstReturns: Record<string, unknown> = {
    filingAttempt: query(() => mockServer.attempt),
    filingStatus: query(() => mockServer.status),
  };
  for (const n of ["requestOtp", "verifyOtp", "saveGstr1", "proceedGstr1", "fetchGstr1Summary", "pollReturnStatus", "requestEvcOtp", "fileGstr1", "saveGstr3b", "checkLedgerGstr3b", "postOffsetGstr3b", "fetchGstr3bDetails", "fileGstr3b"]) {
    gstReturns[n] = mutation(n);
  }
  return { trpc: { gstReturns } };
});

import { GstFilingFlow } from "../GstFilingFlow";

const makeAttempt = (over: Record<string, unknown> = {}) => ({
  kind: "gstr1", period: "082026", state: "draft", nil: false, saveRef: null, proceedRef: null, offsetRef: null,
  errors: [] as string[], hasSummary: false, hasDetails: false, ledger: null, proposal: null, proposalKey: null,
  filedRef: null, lastError: null, updatedAt: null, prerequisite: "", nilEligible: false, nilBlockers: [] as string[], ...over,
});
const filed = (arn: string) => ({ arn, filedOn: "2026-05-11", mode: "GSP", valid: true, status: "Filed", rawType: "GSTR1" });
const fyStatus = (g1: string[], g3: string[]) => ({
  status: "ok", reason: null, financialYear: "FY 2026-27", composition: false, cached: false, fetchedAt: 1,
  months: ["042026", "052026", "062026", "072026", "082026", "092026"].map((period) => ({
    period, label: period, gstr1: g1.includes(period) ? filed(`ARN1-${period}`) : null, gstr3b: g3.includes(period) ? filed(`ARN3-${period}`) : null, others: [],
  })),
});
const proposal = (over: Record<string, unknown> = {}) => ({
  itc: { igstOnIgst: 0, igstOnCgst: 0, igstOnSgst: 0, cgstOnCgst: 4000, cgstOnIgst: 0, sgstOnSgst: 4000, sgstOnIgst: 0 },
  cash: { igst: { tx: 0, intr: 0, fee: 0 }, cgst: { tx: 5000, intr: 0, fee: 0 }, sgst: { tx: 5000, intr: 0, fee: 0 } },
  cashNeeded: { igst: 0, cgst: 5000, sgst: 5000 },
  cashShortfall: { igst: 0, cgst: 0, sgst: 0 },
  sufficient: true,
  itcRemaining: { igst: 0, cgst: 0, sgst: 0 },
  ...over,
});
const ledger = { itc: { igst: 0, cgst: 4000, sgst: 4000 }, cash: { igst: 0, cgst: 6000, sgst: 6000 } };

const signIn = () => useGstSessionStore.setState({ entries: { biz1: { verifiedAt: Date.now(), username: "portal.user" } } });
const flow = (over: Partial<React.ComponentProps<typeof GstFilingFlow>> = {}) => {
  const onExit = jest.fn();
  const onSwitch = jest.fn();
  const utils = render(<GstFilingFlow kind="gstr1" year={2026} month={8} gstin="27ABCDE1234F1Z5" onExit={onExit} onSwitch={onSwitch} {...over} />);
  return { ...utils, onExit, onSwitch };
};
const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
const pressCheck = (name: string) => fireEvent.press(screen.getByRole("checkbox", { name }));

beforeEach(() => {
  mockServer.fns = {};
  mockListeners.clear();
  mockServer.attempt = makeAttempt();
  mockServer.status = fyStatus(["042026", "052026", "062026", "072026"], ["042026", "052026", "062026", "072026"]);
  useBusinessStore.setState({ businessId: "biz1", businessName: "Biz" });
  useGstSessionStore.setState({ entries: {}, isHydrated: true });
});
afterEach(() => {
  jest.useRealTimers();
});

describe("pre-flight and sign-in", () => {
  it("shows the pre-flight and continues to the GST portal sign-in", async () => {
    flow();
    expect(screen.getByText("Before you start")).toBeTruthy();
    expect(screen.getByText(/Earlier returns are filed/)).toBeTruthy();
    expect(screen.getByText("Step 1 of 6: Check")).toBeTruthy();
    press("Continue to GST portal sign-in");
    expect(screen.getByText("Sign in to the GST portal")).toBeTruthy();
  });

  it("blocks when an earlier return is missing and offers to open it", () => {
    mockServer.status = fyStatus(["042026", "062026", "072026"], []);
    const { onSwitch } = flow();
    expect(screen.getByRole("button", { name: "Continue to GST portal sign-in" }).props.accessibilityState.disabled).toBe(true);
    press("File GSTR-1 May 2026 first");
    expect(onSwitch).toHaveBeenCalledWith("gstr1", 2026, 5);
  });

  it("signs in with an OTP (numeric keypad), then shows the session clock; the OTP is not stored", async () => {
    flow();
    press("Continue to GST portal sign-in");
    fireEvent.changeText(screen.getByLabelText("GST portal username"), "portal.user");
    press("Send OTP");
    await waitFor(() => expect(fn("requestOtp")).toHaveBeenCalledWith({ username: "portal.user" }));
    const field = await screen.findByLabelText("OTP from the GST portal");
    expect(field.props.keyboardType).toBe("number-pad");
    expect(field.props.textContentType).toBe("oneTimeCode");
    fireEvent.changeText(field, "48 29-13");
    expect(screen.getByLabelText("OTP from the GST portal").props.value).toBe("482913");
    press("Verify and continue");
    await waitFor(() => expect(fn("verifyOtp")).toHaveBeenCalledWith({ username: "portal.user", otp: "482913" }));
    expect(await screen.findByText(/Prepare GSTR-1 for Aug 2026/)).toBeTruthy();
    expect(screen.getByText(/GST portal session: 5 h/)).toBeTruthy();
    expect(JSON.stringify(useGstSessionStore.getState().entries)).not.toContain("482913");
  });

  it("without a session, a persisted step asks for sign-in first and says it will resume", () => {
    mockServer.attempt = makeAttempt({ state: "summary_fetched", hasSummary: true });
    flow();
    expect(screen.getByText("Sign in to the GST portal")).toBeTruthy();
    expect(screen.getByText(/Then you continue where you stopped/)).toBeTruthy();
  });

  it("a lost portal session (401) on a filing call goes back to sign-in with a notice", async () => {
    signIn();
    mockServer.attempt = makeAttempt({ state: "ready_to_file", nil: true });
    fn("requestEvcOtp").mockRejectedValueOnce({ message: "no session", data: { code: "UNAUTHORIZED", path: "gstReturns.requestEvcOtp" } });
    flow();
    press("Send OTP");
    expect(await screen.findByText("Sign in to the GST portal")).toBeTruthy();
    expect(screen.getByText(/Your session with the GST portal has ended/)).toBeTruthy();
  });
});

describe("GSTR-1 path", () => {
  beforeEach(signIn);

  it("asks for both turnover figures with plain help; save sends them as numbers", async () => {
    flow();
    press("Continue to GST portal sign-in");
    expect(screen.getByRole("button", { name: "Save to GST portal" }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/whole last financial year/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Aggregate turnover of the previous financial year"), "2500000");
    fireEvent.changeText(screen.getByLabelText("Aggregate turnover of the current financial year up to this period"), "1,100,000");
    fn("saveGstr1").mockImplementation(async () => {
      setAttempt({ state: "saved", saveRef: "r1" });
      return { state: "saved", referenceId: "r1", warnings: [] };
    });
    press("Save to GST portal");
    await waitFor(() => expect(fn("saveGstr1")).toHaveBeenCalledWith({ year: 2026, month: 8, gt: 2500000, curGt: 1100000 }));
    expect(await screen.findByText("Checking with the GST portal...")).toBeTruthy();
  });

  it("offers nil only when the server says so, and needs the confirmation", async () => {
    mockServer.attempt = makeAttempt({ nilEligible: false, nilBlockers: ["sales invoices"] });
    const first = flow();
    press("Continue to GST portal sign-in");
    expect(screen.queryByRole("checkbox", { name: /Nil return/ })).toBeNull();
    expect(screen.getByText(/your books have sales invoices for Aug 2026/)).toBeTruthy();
    first.unmount();

    mockServer.attempt = makeAttempt({ nilEligible: true });
    flow();
    press("Continue to GST portal sign-in");
    pressCheck("Nil return: your books show nothing for Aug 2026");
    expect(screen.getByRole("button", { name: "Start nil return" }).props.accessibilityState.disabled).toBe(true);
    pressCheck("I confirm there were no outward supplies in Aug 2026");
    fn("proceedGstr1").mockImplementation(async () => {
      setAttempt({ state: "proceeding", nil: true });
      return { state: "proceeding", referenceId: "p", resumed: false, warnings: [] };
    });
    press("Start nil return");
    await waitFor(() => expect(fn("proceedGstr1")).toHaveBeenCalledWith({ year: 2026, month: 8, nil: true, confirmNil: true }));
  });

  it("save errors: grouped messages, a cap with a pointer to the web app, and only Save again", () => {
    mockServer.attempt = makeAttempt({
      state: "save_errors",
      errors: [...Array.from({ length: 12 }, (_, i) => `B2B invoice INV-${i}: invalid GSTIN`), "HSN 9983 missing"],
    });
    flow();
    const errs = screen.getByTestId("portal-errors");
    expect(within(errs).getByText("B2B invoices")).toBeTruthy();
    expect(within(errs).getByText(/5 more messages from the GST portal/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Prepare for filing|Continue|Send OTP/ })).toBeNull();
  });

  it("ready_to_file: Load summary, then section cards; the checksum is never shown", async () => {
    mockServer.attempt = makeAttempt({ state: "ready_to_file" });
    fn("fetchGstr1Summary").mockImplementation(async () => {
      setAttempt({ state: "summary_fetched", hasSummary: true });
      return { state: "summary_fetched", secSum: [{ sec_nm: "B2B", ttl_rec: 3, ttl_tax: 100000, ttl_cgst: 9000, ttl_sgst: 9000 }] };
    });
    flow();
    press("Load summary");
    const sum = await screen.findByTestId("gstr1-summary");
    expect(within(sum).getByText("B2B invoices")).toBeTruthy();
    expect(JSON.stringify(screen.toJSON()).toLowerCase()).not.toContain("chksum");
  });
});

describe("polling", () => {
  beforeEach(signIn);

  it("checks no sooner than every 12 s and stops with a retry button", async () => {
    jest.useFakeTimers();
    mockServer.attempt = makeAttempt({ state: "saved", saveRef: "r1" });
    const times: number[] = [];
    fn("pollReturnStatus").mockImplementation(async () => {
      times.push(Date.now());
      return { state: "saved", status: "processing", retryAfterMs: 2000, errors: [] };
    });
    const t0 = Date.now();
    flow();
    expect(screen.getByText("Checking with the GST portal...")).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(11_900);
    });
    expect(times).toHaveLength(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300_000);
    });
    expect(times[0]! - t0).toBeGreaterThanOrEqual(12_000);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(12_000);
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    const total = times.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(times).toHaveLength(total);
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Check again" }));
      await jest.advanceTimersByTimeAsync(5);
    });
    expect(fn("pollReturnStatus")).toHaveBeenLastCalledWith({ kind: "gstr1", year: 2026, month: 8, restart: true });
  });
});

describe("GSTR-3B set-off", () => {
  beforeEach(() => {
    signIn();
    mockServer.attempt = makeAttempt({ kind: "gstr3b", state: "ledger_checked", ledger, proposal: proposal(), proposalKey: "KEY-1" });
  });

  it("shows ledger, proposal and cash payable; sends confirm + proposalKey only after the explicit confirmation", async () => {
    flow({ kind: "gstr3b" });
    expect(screen.getByTestId("ledger-table")).toBeTruthy();
    expect(within(screen.getByTestId("setoff-table")).getByText("CGST credit pays CGST")).toBeTruthy();
    expect(within(screen.getByTestId("cash-payable")).getByText("₹10,000")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm set-off and record on the GST portal" });
    expect(confirm.props.accessibilityState.disabled).toBe(true);
    pressCheck("I have reviewed this set-off");
    fn("postOffsetGstr3b").mockImplementation(async () => {
      setAttempt({ state: "offset_posted", offsetRef: "o1" });
      return { state: "offset_posted", referenceId: "o1", resumed: false };
    });
    press("Confirm set-off and record on the GST portal");
    await waitFor(() => expect(fn("postOffsetGstr3b")).toHaveBeenCalledWith({ year: 2026, month: 8, confirm: true, proposalKey: "KEY-1" }));
  });

  it("cash short: says what is needed, that the deposit is outside the app, and offers no confirm", () => {
    mockServer.attempt = makeAttempt({ kind: "gstr3b", state: "ledger_checked", ledger, proposal: proposal({ sufficient: false, cashShortfall: { igst: 0, cgst: 1200, sgst: 0 } }), proposalKey: "K3" });
    flow({ kind: "gstr3b" });
    expect(screen.getByText(/Add ₹1,200 to the CGST cash ledger/)).toBeTruthy();
    expect(screen.getByText(/This app cannot make the payment/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm set-off/ })).toBeNull();
  });
});

describe("EVC OTP and the final confirmation", () => {
  beforeEach(() => {
    signIn();
    mockServer.attempt = makeAttempt({ state: "ready_to_file", nil: true });
    fn("requestEvcOtp").mockImplementation(async () => {
      setAttempt({ state: "otp_requested", updatedAt: Date.now() });
      return { sent: true, panMasked: "AB*******F", panSource: "gstin", nil: true, warnings: [], period: "082026", kind: "gstr1" };
    });
  });

  it("the file button waits for the acknowledgement; the OTP is used once and left nowhere", async () => {
    fn("fileGstr1").mockImplementation(async () => {
      setAttempt({ state: "filed" });
      return { filed: true, period: "082026", referenceId: "R", nil: true, tracked: { arn: "AA270826000001Z", filedOn: "2026-09-05", valid: true } };
    });
    flow();
    press("Send OTP");
    const field = await screen.findByLabelText("Filing OTP (6 digits)");
    expect(field.props.keyboardType).toBe("number-pad");
    expect(screen.getByRole("button", { name: "Continue" }).props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(field, "654321");
    press("Continue");
    expect(screen.getByText("File GSTR-1 for Aug 2026 for GSTIN 27ABCDE1234F1Z5")).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain("654321");
    const fileBtn = screen.getByRole("button", { name: "File GSTR-1 now" });
    expect(fileBtn.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(fileBtn);
    expect(fn("fileGstr1")).not.toHaveBeenCalled();
    pressCheck("I understand this files the return with the government and cannot be undone");
    press("File GSTR-1 now");
    await waitFor(() => expect(fn("fileGstr1")).toHaveBeenCalledWith({ year: 2026, month: 8, evcOtp: "654321" }));
    expect(await screen.findByText("GSTR-1 for Aug 2026 is filed")).toBeTruthy();
    expect(within(screen.getByTestId("filed-result")).getByText("AA270826000001Z")).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain("654321");
  });

  it("never files on its own", async () => {
    flow();
    press("Send OTP");
    fireEvent.changeText(await screen.findByLabelText("Filing OTP (6 digits)"), "654321");
    press("Continue");
    expect(fn("fileGstr1")).not.toHaveBeenCalled();
    expect(fn("fileGstr3b")).not.toHaveBeenCalled();
  });

  it("a wrong OTP: nothing filed, the reason shown, a new OTP can be requested", async () => {
    fn("fileGstr1").mockImplementation(async () => {
      setAttempt({ state: "failed", lastError: "GST file failed: Invalid OTP" });
      throw new Error("GST file failed: Invalid OTP");
    });
    flow();
    press("Send OTP");
    fireEvent.changeText(await screen.findByLabelText("Filing OTP (6 digits)"), "111111");
    press("Continue");
    pressCheck("I understand this files the return with the government and cannot be undone");
    press("File GSTR-1 now");
    expect(await screen.findByText("The return was not filed")).toBeTruthy();
    expect(screen.getAllByText(/Invalid OTP/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send a new OTP" })).toBeTruthy();
  });
});

describe("resume from the persisted step", () => {
  beforeEach(signIn);
  const cases: Array<[string, Record<string, unknown>, string, "gstr1" | "gstr3b"]> = [
    ["GSTR-1 save_validated", { state: "save_validated" }, "Saved on the GST portal", "gstr1"],
    ["GSTR-1 ready_to_file", { state: "ready_to_file" }, "Return is ready on the GST portal", "gstr1"],
    ["GSTR-1 otp_requested", { state: "otp_requested", updatedAt: Date.now() }, "Enter the filing OTP", "gstr1"],
    ["GSTR-3B save_validated", { kind: "gstr3b", state: "save_validated" }, "Saved on the GST portal", "gstr3b"],
    ["GSTR-3B offset_validated", { kind: "gstr3b", state: "offset_validated" }, "Tax payment recorded", "gstr3b"],
    ["GSTR-3B details_fetched", { kind: "gstr3b", state: "details_fetched", hasDetails: true }, "Final review", "gstr3b"],
  ];
  it.each(cases)("%s jumps to its step", (_n, over, text, kind) => {
    mockServer.attempt = makeAttempt(over);
    flow({ kind });
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText("Before you start")).toBeNull();
  });

  it("a filed return shows the result with its ARN from the portal status", () => {
    useGstSessionStore.setState({ entries: {} });
    mockServer.attempt = makeAttempt({ state: "filed" });
    mockServer.status = fyStatus(["082026"], []);
    flow();
    expect(screen.getByText("GSTR-1 for Aug 2026 is filed")).toBeTruthy();
    expect(within(screen.getByTestId("filed-result")).getByText("ARN1-082026")).toBeTruthy();
  });
});
