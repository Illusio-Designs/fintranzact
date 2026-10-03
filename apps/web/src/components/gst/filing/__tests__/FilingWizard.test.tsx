/**
 * FilingWizard: each step renders; polling never runs faster than every 12 s and stops;
 * save errors force a re-save; nil needs the server's say-so and a confirmation;
 * the 3B set-off sends the proposalKey after an explicit confirmation; the final
 * confirmation gates the file button; the OTP behaves; resume jumps to the persisted
 * step; no OTP, token or checksum shows up in the DOM or the logs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fyStatus, gstr1Report, gstr3bReport, ledger, makeAttempt, proposal } from "./fake-server";

const h = vi.hoisted(() => ({
  server: {
    attempt: null as unknown,
    status: null as unknown,
    prevStatus: null as unknown,
    g1: null as unknown,
    g3: null as unknown,
    can: true,
  },
  listeners: new Set<() => void>(),
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

const notify = () => h.listeners.forEach((l) => l());
const setAttempt = (over: Record<string, unknown>) => {
  h.server.attempt = { ...(h.server.attempt as object), ...over };
  notify();
};
const fn = (name: string) => (h.fns[name] ??= vi.fn(async () => ({})));

vi.mock("@/lib/trpc", async () => {
  const React = await import("react");
  const useStore = () => {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    React.useEffect(() => {
      h.listeners.add(force);
      return () => void h.listeners.delete(force);
    }, []);
  };
  const query = (read: (input: unknown, opts?: { enabled?: boolean }) => unknown) => ({
    useQuery: (input: unknown, opts?: { enabled?: boolean }) => {
      useStore();
      if (opts?.enabled === false) return { data: undefined, isLoading: false, error: null, refetch: async () => ({}) };
      return { data: read(input, opts), isLoading: false, error: null, refetch: async () => { notify(); return {}; } };
    },
  });
  const mutation = (name: string) => ({
    useMutation: () => ({ mutateAsync: (input: unknown) => fn(name)(input), isPending: false }),
  });
  const gstReturns: Record<string, unknown> = {
    filingAttempt: query(() => h.server.attempt),
    filingStatus: query((input) => ((input as { fyStartYear: number }).fyStartYear === 2025 ? h.server.prevStatus : h.server.status)),
  };
  for (const n of ["requestOtp", "verifyOtp", "saveGstr1", "proceedGstr1", "fetchGstr1Summary", "pollReturnStatus", "requestEvcOtp", "fileGstr1", "saveGstr3b", "checkLedgerGstr3b", "postOffsetGstr3b", "fetchGstr3bDetails", "fileGstr3b"]) {
    gstReturns[n] = mutation(n);
  }
  return {
    trpc: { gstReturns, gst: { gstr1: query(() => h.server.g1), gstr3b: query(() => h.server.g3) } },
    getBusinessId: () => "biz1",
  };
});
vi.mock("@/lib/permissions", () => ({ useCan: () => h.server.can }));
vi.mock("@/components/ui/SlideOver", () => ({
  SlideOver: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

import { FilingWizard } from "../FilingWizard";
import { FileReturnButton } from "../FileReturnButton";

const SESSION_KEY = "fintranzact_gst_portal_session:biz1";
const signIn = () => localStorage.setItem(SESSION_KEY, JSON.stringify({ verifiedAt: Date.now(), username: "portal.user" }));

function wizard(over: Partial<React.ComponentProps<typeof FilingWizard>> = {}) {
  const onClose = vi.fn();
  const onSwitch = vi.fn();
  const utils = render(<FilingWizard open onClose={onClose} kind="gstr1" year={2026} month={8} gstin="27ABCDE1234F1Z5" onSwitch={onSwitch} {...over} />);
  return { ...utils, onClose, onSwitch };
}

beforeEach(() => {
  h.fns = {};
  h.listeners.clear();
  h.server.can = true;
  h.server.attempt = makeAttempt();
  h.server.status = fyStatus(["042026", "052026", "062026", "072026"], ["042026", "052026", "062026", "072026"]);
  h.server.prevStatus = null;
  h.server.g1 = gstr1Report;
  h.server.g3 = gstr3bReport;
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup();

describe("1. pre-flight", () => {
  it("shows prerequisites, the books summary and the monthly note, then continues to sign-in", async () => {
    wizard();
    expect(screen.getByRole("heading", { name: "Before you start" })).toBeInTheDocument();
    expect(screen.getByText(/Earlier returns are filed/)).toBeInTheDocument();
    const books = screen.getByTestId("books-summary");
    expect(within(books).getByText("12")).toBeInTheDocument();
    expect(within(books).getByText(/1,00,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Monthly filing is assumed/)).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    expect(screen.getByRole("heading", { name: "Sign in to the GST portal" })).toBeInTheDocument();
  });

  it("blocks on a missing earlier return and links to file it first", async () => {
    h.server.status = fyStatus(["042026", "062026", "072026"], []);
    const { onSwitch } = wizard();
    expect(screen.getAllByText(/GSTR-1 May 2026/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue to GST portal sign-in" })).toBeDisabled();
    await user().click(screen.getByRole("button", { name: /File it first/ }));
    expect(onSwitch).toHaveBeenCalledWith("gstr1", 2026, 5);
  });

  it("only warns when the portal cannot be checked ('unknown')", () => {
    h.server.status = { status: "unavailable", reason: "Sandbox is not enabled", financialYear: "FY 2026-27", composition: false, months: [], fetchedAt: null, cached: false };
    wizard();
    expect(screen.getByText(/Could not check earlier returns on the GST portal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to GST portal sign-in" })).toBeEnabled();
  });

  it("stops when the portal already shows the return as filed", () => {
    h.server.status = fyStatus(["042026", "052026", "062026", "072026", "082026"], []);
    wizard();
    expect(screen.getByText(/already filed on the GST portal \(ARN ARN1-082026\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to GST portal sign-in" })).toBeDisabled();
  });

  it("GSTR-3B: needs GSTR-1 of the same period, and hints when 3B differs from GSTR-1", () => {
    h.server.status = fyStatus(["042026", "052026", "062026", "072026"], ["042026", "052026", "062026", "072026"]);
    h.server.attempt = makeAttempt({ kind: "gstr3b" });
    h.server.g3 = { ...gstr3bReport, outwardSupplies: { ...gstr3bReport.outwardSupplies, taxable: { taxableValue: 50000, igst: 0, cgst: 4500, sgst: 4500 } } };
    wizard({ kind: "gstr3b" });
    expect(screen.getAllByText(/GSTR-1 Aug 2026/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue to GST portal sign-in" })).toBeDisabled();
    expect(screen.getByText(/GSTR-3B outward supplies differ from GSTR-1/)).toBeInTheDocument();
  });
});

describe("2. GST portal sign-in", () => {
  it("sends the OTP to the registered mobile, verifies it, and never stores it", async () => {
    h.server.attempt = makeAttempt();
    const u = user();
    wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    await u.type(screen.getByLabelText("GST portal username"), "portal.user");
    await u.click(screen.getByRole("button", { name: "Send OTP" }));
    expect(fn("requestOtp")).toHaveBeenCalledWith({ username: "portal.user" });
    const field = screen.getByLabelText("OTP from the GST portal");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await u.type(field, "482913");
    await u.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(fn("verifyOtp")).toHaveBeenCalledWith({ username: "portal.user", otp: "482913" });
    // On to the choice, with the session clock showing.
    expect(await screen.findByRole("heading", { name: /Prepare GSTR-1 for Aug 2026/ })).toBeInTheDocument();
    expect(screen.getByTestId("session-left")).toHaveTextContent(/5 h/);
    const stored = JSON.stringify(Object.entries(localStorage));
    expect(stored).not.toContain("482913");
    expect(document.body.innerHTML).not.toContain("482913");
  });

  it("a wrong sign-in OTP stays on the step with the server's message", async () => {
    const u = user();
    fn("verifyOtp").mockRejectedValueOnce(new Error("The OTP is incorrect."));
    wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    await u.type(screen.getByLabelText("GST portal username"), "portal.user");
    await u.click(screen.getByRole("button", { name: "Send OTP" }));
    await u.type(screen.getByLabelText("OTP from the GST portal"), "111111");
    await u.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByText("The OTP is incorrect.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in to the GST portal" })).toBeInTheDocument();
  });

  it("resend is available only after 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    await u.type(screen.getByLabelText("GST portal username"), "portal.user");
    await u.click(screen.getByRole("button", { name: "Send OTP" }));
    expect(screen.getByRole("button", { name: /Resend OTP in \d+ s/ })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(screen.getByRole("button", { name: "Resend OTP" })).toBeEnabled();
  });

  it("an expired portal session sends a mid-flow return back to sign-in, then resumes", () => {
    // Saved on the portal earlier; the 6 hours are over (no stored session).
    h.server.attempt = makeAttempt({ state: "summary_fetched", hasSummary: true });
    wizard();
    expect(screen.getByRole("heading", { name: "Sign in to the GST portal" })).toBeInTheDocument();
    expect(screen.getByText(/Then you continue where you stopped/)).toBeInTheDocument();
  });

  it("a session of more than 6 hours ago counts as expired", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ verifiedAt: Date.now() - 7 * 3600_000, username: "u" }));
    h.server.attempt = makeAttempt({ state: "otp_requested" });
    wizard();
    expect(screen.getByRole("heading", { name: "Sign in to the GST portal" })).toBeInTheDocument();
    expect((screen.getByLabelText("GST portal username") as HTMLInputElement).value).toBe("u");
  });

  it("a portal-session error (401) on a filing call routes back to sign-in with a notice", async () => {
    signIn();
    h.server.attempt = makeAttempt({ state: "summary_fetched", hasSummary: true });
    fn("fetchGstr1Summary").mockResolvedValue({ state: "summary_fetched", secSum: [{ sec_nm: "B2B", ttl_rec: 1, ttl_tax: 1000 }] });
    fn("requestEvcOtp").mockRejectedValueOnce({ message: "no session", data: { code: "UNAUTHORIZED", path: "gstReturns.requestEvcOtp" } });
    const u = user();
    wizard();
    await u.click(await screen.findByRole("button", { name: "The summary is correct: continue" }));
    await u.click(screen.getByRole("button", { name: "Send OTP" }));
    expect(await screen.findByRole("heading", { name: "Sign in to the GST portal" })).toBeInTheDocument();
    expect(screen.getByText(/Your session with the GST portal has ended/)).toBeInTheDocument();
  });
});

describe("3. GSTR-1: choose, turnover, nil", () => {
  beforeEach(signIn);

  it("asks for both turnover figures with plain help text; save is disabled until they are numbers", async () => {
    const u = user();
    h.server.attempt = makeAttempt();
    wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    const save = screen.getByRole("button", { name: /Save to GST portal/ });
    expect(save).toBeDisabled();
    expect(screen.getByText(/whole last financial year/)).toBeInTheDocument();
    expect(screen.getByText(/from 1 April of this financial year up to the end of Aug 2026/)).toBeInTheDocument();
    await u.type(screen.getByLabelText(/previous financial year/), "2500000");
    await u.type(screen.getByLabelText(/current financial year up to this period/), "1,100,000");
    expect(save).toBeEnabled();
    fn("saveGstr1").mockImplementation(async () => {
      setAttempt({ state: "saved", saveRef: "r1" });
      return { state: "saved", referenceId: "r1", warnings: [] };
    });
    await u.click(save);
    expect(fn("saveGstr1")).toHaveBeenCalledWith({ year: 2026, month: 8, gt: 2500000, curGt: 1100000 });
    expect(await screen.findByText("Checking with the GST portal...")).toBeInTheDocument();
  });

  it("offers a nil return only when the server says the books are empty", async () => {
    const u = user();
    h.server.attempt = makeAttempt({ nilEligible: false, nilBlockers: ["sales invoices", "B2B supplies"] });
    const { unmount } = wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    expect(screen.queryByRole("radio", { name: /Nil return/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("nil-unavailable")).toHaveTextContent("your books have sales invoices, B2B supplies for Aug 2026");
    unmount();
    h.server.attempt = makeAttempt({ nilEligible: true });
    wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    expect(screen.getByRole("radio", { name: /Nil return/ })).toBeInTheDocument();
  });

  it("a nil return needs the explicit confirmation before it starts", async () => {
    const u = user();
    h.server.attempt = makeAttempt({ nilEligible: true });
    wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    await u.click(screen.getByRole("radio", { name: /Nil return/ }));
    const start = screen.getByRole("button", { name: "Start nil return" });
    expect(start).toBeDisabled();
    await u.click(screen.getByRole("checkbox", { name: "I confirm there were no outward supplies in Aug 2026" }));
    expect(start).toBeEnabled();
    fn("proceedGstr1").mockImplementation(async () => {
      setAttempt({ state: "proceeding", nil: true, proceedRef: "p1" });
      return { state: "proceeding", referenceId: "p1", resumed: false, warnings: [] };
    });
    await u.click(start);
    expect(fn("proceedGstr1")).toHaveBeenCalledWith({ year: 2026, month: 8, nil: true, confirmNil: true });
    expect(await screen.findByText("Checking with the GST portal...")).toBeInTheDocument();
  });

  it("a nil return skips the review step (no Review in the stepper) and goes to the OTP", () => {
    h.server.attempt = makeAttempt({ state: "ready_to_file", nil: true });
    wizard();
    const steps = within(screen.getByRole("navigation", { name: "Filing steps" })).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).not.toContain("Review");
    expect(screen.getByRole("heading", { name: "Send the filing OTP" })).toBeInTheDocument();
  });
});

describe("polling the GST portal", () => {
  beforeEach(signIn);

  it("checks no sooner than every 12 s, even if the server hints less, and stops with a retry button", async () => {
    vi.useFakeTimers();
    h.server.attempt = makeAttempt({ state: "saved", saveRef: "r1" });
    const times: number[] = [];
    fn("pollReturnStatus").mockImplementation(async () => {
      times.push(Date.now());
      return { state: "saved", status: "processing", retryAfterMs: 3000, errors: [] };
    });
    const t0 = Date.now();
    wizard();
    expect(screen.getByText("Checking with the GST portal...")).toBeInTheDocument();
    expect(screen.getByText(/usually takes 1-2 minutes/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_900);
    });
    expect(times).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(times.length).toBeGreaterThan(5);
    expect(times[0]! - t0).toBeGreaterThanOrEqual(12_000);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(12_000);
    // Gave up after about three minutes: a retry button, and no more calls.
    const total = times.length;
    expect(times[total - 1]! - t0).toBeLessThanOrEqual(195_000);
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(times).toHaveLength(total);
    // The retry restarts the server's clock.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fn("pollReturnStatus")).toHaveBeenLastCalledWith({ kind: "gstr1", year: 2026, month: 8, restart: true });
  });

  it("shows elapsed time in a polite live region", async () => {
    vi.useFakeTimers();
    h.server.attempt = makeAttempt({ state: "saved", saveRef: "r1" });
    wizard();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const live = screen.getByText("Checking with the GST portal...");
    expect(live.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/Waiting 5 s/)).toBeInTheDocument();
  });

  it("moves on when the portal finishes", async () => {
    vi.useFakeTimers();
    h.server.attempt = makeAttempt({ state: "saved", saveRef: "r1" });
    fn("pollReturnStatus").mockImplementation(async () => {
      setAttempt({ state: "save_validated" });
      return { state: "save_validated", status: "done", retryAfterMs: 0, errors: [] };
    });
    wizard();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_100);
    });
    expect(screen.getByRole("heading", { name: "Saved on the GST portal" })).toBeInTheDocument();
    expect(screen.getByText(/not filed yet/)).toBeInTheDocument();
  });
});

describe("save errors", () => {
  beforeEach(signIn);

  it("lists the portal's messages by section with 'Fix in your books', and forces Save again before anything else", async () => {
    const u = user();
    h.server.attempt = makeAttempt({
      state: "save_errors",
      errors: ["B2B invoice INV-1: invalid GSTIN of the recipient", "HSN 9983: description missing", "Unknown thing"],
    });
    wizard();
    const errs = screen.getByTestId("portal-errors");
    expect(within(errs).getByRole("region", { name: "B2B invoices" })).toHaveTextContent("INV-1");
    const fix = within(errs).getAllByRole("link", { name: /Fix in your books/ });
    expect(fix.map((a) => a.getAttribute("href"))).toEqual(["/invoices", "/items"]);
    expect(within(errs).getByRole("region", { name: "Other messages from the GST portal" })).toBeInTheDocument();
    // No way forward but saving again.
    expect(screen.queryByRole("button", { name: /Prepare for filing|continue|Send OTP|Load summary/i })).not.toBeInTheDocument();
    const again = screen.getByRole("button", { name: /Save again/ });
    expect(again).toBeDisabled(); // the turnover figures are asked for again
    await u.type(screen.getByLabelText(/previous financial year/), "100");
    await u.type(screen.getByLabelText(/current financial year up to this period/), "50");
    fn("saveGstr1").mockImplementation(async () => {
      setAttempt({ state: "saved", errors: [] });
      return { state: "saved", referenceId: "r2", warnings: [] };
    });
    await u.click(again);
    expect(fn("saveGstr1")).toHaveBeenCalledWith({ year: 2026, month: 8, gt: 100, curGt: 50 });
  });
});

describe("GSTR-1 review", () => {
  beforeEach(signIn);

  it("ready_to_file: loads the summary on request and shows section totals, never the checksum", async () => {
    const u = user();
    h.server.attempt = makeAttempt({ state: "ready_to_file" });
    fn("fetchGstr1Summary").mockImplementation(async () => {
      setAttempt({ state: "summary_fetched", hasSummary: true });
      return { state: "summary_fetched", period: "082026", secSum: [{ sec_nm: "B2B", ttl_rec: 3, ttl_tax: 100000, ttl_cgst: 9000, ttl_sgst: 9000, ttl_igst: 0 }, { sec_nm: "HSN", ttl_rec: 2 }] };
    });
    wizard();
    expect(fn("fetchGstr1Summary")).not.toHaveBeenCalled();
    await u.click(screen.getByRole("button", { name: /Load summary/ }));
    const table = await screen.findByTestId("gstr1-summary");
    expect(within(table).getByRole("rowheader", { name: "B2B invoices" })).toBeInTheDocument();
    expect(within(table).getByText(/1,00,000\.00/)).toBeInTheDocument();
    expect(document.body.innerHTML.toLowerCase()).not.toContain("chksum");
    expect(document.body.innerHTML.toLowerCase()).not.toContain("checksum");
  });

  it("resuming at summary_fetched re-reads the stored summary without a button", async () => {
    h.server.attempt = makeAttempt({ state: "summary_fetched", hasSummary: true });
    fn("fetchGstr1Summary").mockResolvedValue({ state: "summary_fetched", secSum: [{ sec_nm: "B2CS", ttl_rec: 4, ttl_tax: 500 }] });
    wizard();
    expect(await screen.findByRole("rowheader", { name: "B2C small supplies" })).toBeInTheDocument();
    expect(fn("fetchGstr1Summary")).toHaveBeenCalledTimes(1);
  });
});

describe("GSTR-3B set-off", () => {
  beforeEach(() => {
    signIn();
    h.server.attempt = makeAttempt({ kind: "gstr3b", state: "ledger_checked", ledger, proposal: proposal(), proposalKey: "KEY-1" });
  });

  it("shows ledger balances, the proposed set-off and cash payable, and sends confirm + proposalKey only after the explicit confirmation", async () => {
    const u = user();
    fn("postOffsetGstr3b").mockImplementation(async () => {
      setAttempt({ state: "offset_posted", offsetRef: "o1" });
      return { state: "offset_posted", referenceId: "o1", resumed: false, period: "082026" };
    });
    wizard({ kind: "gstr3b" });
    const ledgerTable = screen.getByTestId("ledger-table");
    expect(within(ledgerTable).getByText("Credit ledger")).toBeInTheDocument();
    expect(within(ledgerTable).getAllByText(/6,000\.00/)).toHaveLength(2);
    const setoff = screen.getByTestId("setoff-table");
    expect(within(setoff).getByText("CGST credit")).toBeInTheDocument();
    expect(screen.getByTestId("cash-payable")).toHaveTextContent("10,000.00");
    expect(screen.getByText("How the credit is used")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: /Confirm set-off and record on the GST portal/ });
    expect(confirm).toBeDisabled();
    await u.click(confirm);
    expect(fn("postOffsetGstr3b")).not.toHaveBeenCalled();
    await u.click(screen.getByRole("checkbox", { name: "I have reviewed this set-off" }));
    await u.click(confirm);
    expect(fn("postOffsetGstr3b")).toHaveBeenCalledWith({ year: 2026, month: 8, confirm: true, proposalKey: "KEY-1" });
  });

  it("a new proposal clears the confirmation (it applies to the proposal that was shown)", async () => {
    const u = user();
    wizard({ kind: "gstr3b" });
    await u.click(screen.getByRole("checkbox", { name: "I have reviewed this set-off" }));
    act(() => setAttempt({ proposalKey: "KEY-2" }));
    expect(screen.getByRole("checkbox", { name: "I have reviewed this set-off" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Confirm set-off/ })).toBeDisabled();
  });

  it("when cash is short it says what is needed, that the deposit happens on the portal, and offers no confirm", () => {
    h.server.attempt = makeAttempt({
      kind: "gstr3b",
      state: "ledger_checked",
      ledger,
      proposal: proposal({ sufficient: false, cashShortfall: { igst: 0, cgst: 1200, sgst: 0 } }),
      proposalKey: "KEY-3",
    });
    wizard({ kind: "gstr3b" });
    expect(screen.getByText(/does not cover the tax that credit cannot pay/)).toBeInTheDocument();
    expect(screen.getByText(/Add ₹1,200\.00 to the CGST cash ledger/)).toBeInTheDocument();
    expect(screen.getByText(/This app cannot make the payment/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm set-off/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "I have reviewed this set-off" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check balances again" })).toBeInTheDocument();
  });

  it("a stale proposal is refused by the server: the message is shown and nothing moves on", async () => {
    const u = user();
    fn("postOffsetGstr3b").mockRejectedValue(new Error("The proposed tax payment changed or was not shown. Check the ledger balances again and confirm the new proposal."));
    wizard({ kind: "gstr3b" });
    await u.click(screen.getByRole("checkbox", { name: "I have reviewed this set-off" }));
    await u.click(screen.getByRole("button", { name: /Confirm set-off/ }));
    expect(await screen.findByText(/changed or was not shown/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review the tax payment (set-off)" })).toBeInTheDocument();
  });

  it("final review shows the tax payment and continues to the OTP", async () => {
    const u = user();
    h.server.attempt = makeAttempt({ kind: "gstr3b", state: "details_fetched", hasDetails: true, ledger, proposal: proposal(), proposalKey: "K" });
    wizard({ kind: "gstr3b" });
    const pay = screen.getByTestId("final-payment");
    expect(pay).toHaveTextContent("8,000.00");
    expect(pay).toHaveTextContent("10,000.00");
    await u.click(screen.getByRole("button", { name: "Continue to OTP" }));
    expect(screen.getByRole("heading", { name: "Send the filing OTP" })).toBeInTheDocument();
  });
});

describe("5. EVC OTP and the final confirmation", () => {
  beforeEach(() => {
    signIn();
    h.server.attempt = makeAttempt({ state: "ready_to_file", nil: true });
  });

  async function toOtpEntry(u = user()) {
    fn("requestEvcOtp").mockImplementation(async () => {
      setAttempt({ state: "otp_requested", updatedAt: Date.now() });
      return { sent: true, panMasked: "AB*******F", panSource: "gstin", nil: true, warnings: [], period: "082026", kind: "gstr1" };
    });
    wizard();
    await u.click(screen.getByRole("button", { name: "Send OTP" }));
    return u;
  }

  it("sends the OTP, takes a numeric 6-digit code (paste works), and resend waits 30 s", async () => {
    const u = await toOtpEntry();
    expect(fn("requestEvcOtp")).toHaveBeenCalledWith({ kind: "gstr1", year: 2026, month: 8, nil: true, confirmNil: true });
    const field = await screen.findByLabelText("Filing OTP (6 digits)");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("inputmode", "numeric");
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await u.click(field);
    await u.paste("12 34-56");
    expect(field).toHaveValue("123456");
    expect(cont).toBeEnabled();
    await u.clear(field);
    await u.type(field, "12ab34");
    expect(field).toHaveValue("1234");
    expect(cont).toBeDisabled();
    expect(screen.getByRole("button", { name: /Resend OTP in \d+ s/ })).toBeDisabled();
    expect(screen.getByText(/PAN AB\*{7}F/)).toBeInTheDocument();
  });

  it("the final confirmation names the return, period and GSTIN; the file button waits for the tick; the OTP is used once and not left in the page", async () => {
    const u = await toOtpEntry();
    fn("fileGstr1").mockImplementation(async () => {
      setAttempt({ state: "filed" });
      return { filed: true, period: "082026", referenceId: "R", nil: true, tracked: { arn: "AA270826000001Z", filedOn: "2026-09-05", valid: true } };
    });
    await u.type(await screen.findByLabelText("Filing OTP (6 digits)"), "654321");
    await u.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "File GSTR-1 for Aug 2026 for GSTIN 27ABCDE1234F1Z5" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("654321");
    const fileBtn = screen.getByRole("button", { name: "File GSTR-1 now" });
    expect(fileBtn).toBeDisabled();
    await u.click(fileBtn);
    expect(fn("fileGstr1")).not.toHaveBeenCalled();
    await u.click(screen.getByRole("checkbox", { name: "I understand this files the return with the government and cannot be undone" }));
    expect(fileBtn).toBeEnabled();
    await u.click(fileBtn);
    expect(fn("fileGstr1")).toHaveBeenCalledTimes(1);
    expect(fn("fileGstr1")).toHaveBeenCalledWith({ year: 2026, month: 8, evcOtp: "654321" });
    // Result: ARN and date.
    expect(await screen.findByRole("heading", { name: "GSTR-1 for Aug 2026 is filed" })).toBeInTheDocument();
    expect(screen.getByTestId("filed-result")).toHaveTextContent("AA270826000001Z");
    expect(screen.getByTestId("filed-result")).toHaveTextContent("2026-09-05");
    expect(document.body.innerHTML).not.toContain("654321");
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("654321");
    await u.click(screen.getByRole("button", { name: "Back to GST" }));
  });

  it("never files on its own: reaching the confirmation, even with the OTP typed, calls nothing", async () => {
    const u = await toOtpEntry();
    await u.type(await screen.findByLabelText("Filing OTP (6 digits)"), "654321");
    await u.click(screen.getByRole("button", { name: "Continue" }));
    expect(fn("fileGstr1")).not.toHaveBeenCalled();
    expect(fn("fileGstr3b")).not.toHaveBeenCalled();
  });

  it("a wrong OTP: the server's reason is shown, nothing is filed, and a new OTP can be requested", async () => {
    const u = await toOtpEntry();
    fn("fileGstr1").mockImplementation(async () => {
      setAttempt({ state: "failed", lastError: "GST file failed: Invalid OTP" });
      throw new Error("GST file failed: Invalid OTP");
    });
    await u.type(await screen.findByLabelText("Filing OTP (6 digits)"), "111111");
    await u.click(screen.getByRole("button", { name: "Continue" }));
    await u.click(screen.getByRole("checkbox", { name: /cannot be undone/ }));
    await u.click(screen.getByRole("button", { name: "File GSTR-1 now" }));
    expect(await screen.findByRole("heading", { name: "The return was not filed" })).toBeInTheDocument();
    expect(screen.getAllByText(/Invalid OTP/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send a new OTP" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("111111");
  });

  it("GSTR-3B files through fileGstr3b", async () => {
    const u = user();
    h.server.attempt = makeAttempt({ kind: "gstr3b", state: "otp_requested", updatedAt: Date.now() - 60_000, nil: true });
    fn("fileGstr3b").mockImplementation(async () => {
      setAttempt({ state: "filed" });
      return { filed: true, period: "082026", referenceId: "R", nil: true, tracked: null };
    });
    wizard({ kind: "gstr3b" });
    await u.type(await screen.findByLabelText("Filing OTP (6 digits)"), "222222");
    await u.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "File GSTR-3B for Aug 2026 for GSTIN 27ABCDE1234F1Z5" })).toBeInTheDocument();
    await u.click(screen.getByRole("checkbox", { name: /cannot be undone/ }));
    await u.click(screen.getByRole("button", { name: "File GSTR-3B now" }));
    expect(fn("fileGstr3b")).toHaveBeenCalledWith({ year: 2026, month: 8, evcOtp: "222222" });
    expect(await screen.findByText("The GST portal has not shown the ARN yet. It usually appears within a few minutes.")).toBeInTheDocument();
  });

  it("a nil GSTR-3B (nothing persisted yet) asks for the confirmation, then sends nil + confirmNil with the OTP request", async () => {
    const u = user();
    h.server.attempt = makeAttempt({ kind: "gstr3b", nilEligible: true });
    h.server.status = fyStatus(["042026", "052026", "062026", "072026", "082026"], ["042026", "052026", "062026", "072026"]);
    fn("requestEvcOtp").mockImplementation(async () => {
      setAttempt({ state: "otp_requested", nil: true, updatedAt: Date.now() });
      return { sent: true, panMasked: "AB*******F", panSource: "business", nil: true, warnings: [], period: "082026", kind: "gstr3b" };
    });
    wizard({ kind: "gstr3b" });
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    await u.click(screen.getByRole("radio", { name: /Nil return/ }));
    const go = screen.getByRole("button", { name: "Continue with nil return" });
    expect(go).toBeDisabled();
    await u.click(screen.getByRole("checkbox", { name: "I confirm there were no transactions in Aug 2026" }));
    await u.click(go);
    await u.click(screen.getByRole("button", { name: "Send OTP" }));
    expect(fn("requestEvcOtp")).toHaveBeenCalledWith({ kind: "gstr3b", year: 2026, month: 8, nil: true, confirmNil: true });
  });
});

describe("6. resume from the persisted step", () => {
  beforeEach(signIn);

  const cases: Array<[string, Record<string, unknown>, string, "gstr1" | "gstr3b"]> = [
    ["GSTR-1 save_validated", { state: "save_validated" }, "Saved on the GST portal", "gstr1"],
    ["GSTR-1 proceeding", { state: "proceeding" }, "Saved on the GST portal", "gstr1"],
    ["GSTR-1 ready_to_file", { state: "ready_to_file" }, "Return is ready on the GST portal", "gstr1"],
    ["GSTR-1 otp_requested", { state: "otp_requested", updatedAt: Date.now() }, "Enter the filing OTP", "gstr1"],
    ["GSTR-1 failed", { state: "failed", lastError: "bad otp" }, "The return was not filed", "gstr1"],
    ["GSTR-3B save_validated", { kind: "gstr3b", state: "save_validated" }, "Saved on the GST portal", "gstr3b"],
    ["GSTR-3B offset_posted", { kind: "gstr3b", state: "offset_posted" }, "Recording the tax payment", "gstr3b"],
    ["GSTR-3B offset_validated", { kind: "gstr3b", state: "offset_validated" }, "Tax payment recorded", "gstr3b"],
    ["GSTR-3B offset_errors", { kind: "gstr3b", state: "offset_errors", errors: ["Insufficient balance"] }, "Review the tax payment (set-off)", "gstr3b"],
    ["GSTR-3B details_fetched", { kind: "gstr3b", state: "details_fetched", hasDetails: true }, "Final review", "gstr3b"],
  ];
  it.each(cases)("%s jumps straight to its step", (_n, over, heading, kind) => {
    h.server.attempt = makeAttempt(over);
    wizard({ kind });
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    // not at the start of the flow
    expect(screen.queryByRole("heading", { name: "Before you start" })).not.toBeInTheDocument();
  });

  it("a filed return opens on the result with its ARN from the portal status, even with no session", () => {
    localStorage.clear();
    h.server.attempt = makeAttempt({ state: "filed" });
    h.server.status = fyStatus(["082026"], []);
    wizard();
    expect(screen.getByRole("heading", { name: "GSTR-1 for Aug 2026 is filed" })).toBeInTheDocument();
    expect(screen.getByTestId("filed-result")).toHaveTextContent("ARN1-082026");
  });
});

describe("permissions, trial and errors", () => {
  it("a read-only role gets no file button on the tab", () => {
    h.server.can = false;
    render(<FileReturnButton kind="gstr1" year={2026} month={8} gstin="27ABCDE1234F1Z5" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-return")).not.toBeInTheDocument();
  });

  it("the wizard itself refuses to act for a read-only role", () => {
    h.server.can = false;
    wizard();
    expect(screen.getByText(/cannot file returns/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue|Send OTP|Save/ })).not.toBeInTheDocument();
  });

  it("the tab button says File return, or Resume filing when an attempt is under way", () => {
    const { unmount } = render(<FileReturnButton kind="gstr1" year={2026} month={8} gstin="27ABCDE1234F1Z5" />);
    expect(screen.getByRole("button", { name: /File return/ })).toBeInTheDocument();
    unmount();
    h.server.attempt = makeAttempt({ state: "saved" });
    render(<FileReturnButton kind="gstr1" year={2026} month={8} gstin="27ABCDE1234F1Z5" />);
    expect(screen.getByRole("button", { name: /Resume filing/ })).toBeInTheDocument();
  });

  it("an entitlement or other refusal on save is shown as text, not a crash", async () => {
    signIn();
    const u = user();
    fn("saveGstr1").mockRejectedValue(new Error("Your trial has ended. Choose a plan to continue."));
    wizard();
    await u.click(screen.getByRole("button", { name: "Continue to GST portal sign-in" }));
    await u.type(screen.getByLabelText(/previous financial year/), "1");
    await u.type(screen.getByLabelText(/current financial year up to this period/), "1");
    await u.click(screen.getByRole("button", { name: /Save to GST portal/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your trial has ended");
    expect(screen.getByRole("button", { name: /Save to GST portal/ })).toBeEnabled();
  });

  it("the stepper marks the current step with aria-current", () => {
    h.server.attempt = makeAttempt({ state: "otp_requested", updatedAt: Date.now() });
    signIn();
    wizard();
    const nav = screen.getByRole("navigation", { name: "Filing steps" });
    const current = nav.querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent("OTP and file");
  });

  it("logs nothing that holds an OTP while filing", async () => {
    signIn();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    h.server.attempt = makeAttempt({ state: "otp_requested", updatedAt: Date.now() - 60_000, nil: true });
    fn("fileGstr1").mockImplementation(async () => {
      setAttempt({ state: "filed" });
      return { filed: true, period: "082026", referenceId: "R", nil: true, tracked: null };
    });
    const u = user();
    wizard();
    await u.type(await screen.findByLabelText("Filing OTP (6 digits)"), "909090");
    await u.click(screen.getByRole("button", { name: "Continue" }));
    await u.click(screen.getByRole("checkbox", { name: /cannot be undone/ }));
    await u.click(screen.getByRole("button", { name: "File GSTR-1 now" }));
    await waitFor(() => expect(fn("fileGstr1")).toHaveBeenCalled());
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("909090");
  });
});
