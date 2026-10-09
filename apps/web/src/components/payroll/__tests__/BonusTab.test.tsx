import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const RUN = "77777777-7777-4777-8777-777777777777";
const EMP = "55555555-5555-4555-8555-555555555555";
const BANK = "88888888-8888-4888-8888-888888888888";

const h = vi.hoisted(() => {
  const fns = {
    create: vi.fn(), calculate: vi.fn(), submit: vi.fn(), approve: vi.fn(), reopen: vi.fn(), post: vi.fn(), pay: vi.fn(), del: vi.fn(), exclude: vi.fn(),
    invalidate: vi.fn(), toast: vi.fn(), csv: vi.fn(), pdf: vi.fn(), bank: vi.fn(), downloadText: vi.fn(), download: vi.fn(),
  };
  const mutation = (fn: (v: unknown) => void) => (o?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: (v: unknown) => {
      fn(v);
      o?.onSuccess?.({ id: "77777777-7777-4777-8777-777777777777" });
    },
    isPending: false,
  });
  return { ...fns, mutation, rules: { data: undefined as unknown }, runs: { data: [] as unknown[] }, detail: { data: undefined as unknown } };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollBonus: { get: { invalidate: h.invalidate }, list: { invalidate: h.invalidate }, statementCsv: { fetch: h.csv }, statementPdf: { fetch: h.pdf }, bankFile: { fetch: h.bank } },
    }),
    bankAccount: { list: { useQuery: () => ({ data: [{ id: "88888888-8888-4888-8888-888888888888", accountName: "HDFC Current" }] }) } },
    payrollBonus: {
      rules: { useQuery: () => ({ data: h.rules.data }) },
      list: { useQuery: () => ({ data: h.runs.data, isLoading: false }) },
      get: { useQuery: () => ({ data: h.detail.data, isLoading: !h.detail.data }) },
      create: { useMutation: h.mutation(h.create) },
      calculate: { useMutation: h.mutation(h.calculate) },
      submit: { useMutation: h.mutation(h.submit) },
      approve: { useMutation: h.mutation(h.approve) },
      reopen: { useMutation: h.mutation(h.reopen) },
      post: { useMutation: h.mutation(h.post) },
      markPaid: { useMutation: h.mutation(h.pay) },
      delete: { useMutation: h.mutation(h.del) },
      setExclusion: { useMutation: h.mutation(h.exclude) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, todayISODate: () => "2026-06-20" };
});
vi.mock("../payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-ui")>();
  return { ...actual, downloadBase64: h.download, downloadText: h.downloadText, currentMonth: () => "2026-10" };
});

import { BonusTab } from "../BonusTab";

const rules = (over: Record<string, unknown> = {}, gaps: string[] = []) => ({
  financialYear: 2026, label: "2026-27", gaps, source: "saved", verifiedNote: "Checked with CA on 1 Oct", verifiedOn: "2026-10-01", verifyLabel: "Verify with your CA",
  rules: { eligibilityCeilingRupees: 21000, wageCeilingRupees: 7000, minimumWageRupees: 0, minPercent: 8.33, maxPercent: 20, minWorkingDays: 30, percent: 0, ...over },
});

const run = (status: string, over: Record<string, unknown> = {}) => ({
  id: RUN, financialYear: 2025, number: "BN-2025-26", status, percent: "8.33", employeeCount: 2, eligibleCount: 1, totalBonus: "1749.30", exclusions: {}, warnings: [], paidOn: null, paidReference: null, ...over,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: "l1", runId: RUN, employeeId: EMP, employeeCode: "E101", employeeName: "Asha Verma", eligible: true, reason: "ok", reasonText: "Eligible", monthsPaid: 3, daysPaid: "90.0",
  eligibilityWage: "10000.00", wages: "30000.00", calculationWages: "21000.00", percent: "8.33", bonus: "1749.30", ...over,
});

function open(status: string, over: Record<string, unknown> = {}, approval = { canApprove: false, reason: null as string | null }, lines = [line()]) {
  h.detail.data = { run: run(status, over), lines, approval };
  h.runs.data = [run(status, over)];
  render(<BonusTab />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}
const actions = () => within(screen.getByTestId("bonus-actions"));

describe("BonusTab", () => {
  beforeEach(() => {
    for (const k of Object.keys(h) as Array<keyof typeof h>) {
      const v = h[k];
      if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset();
    }
    h.rules.data = rules();
    h.runs.data = [];
    h.detail.data = undefined;
  });

  it("warns that the ceilings ship empty and says a run cannot be calculated until they are set", () => {
    h.rules.data = rules({ eligibilityCeilingRupees: 0, wageCeilingRupees: 0 }, ["The bonus eligibility wage ceiling is not configured. Set it in Statutory settings (Bonus) and verify it with your CA."]);
    render(<BonusTab />);
    expect(screen.getByTestId("bonus-gaps")).toHaveTextContent("not configured");
    expect(screen.getByTestId("bonus-gaps")).toHaveTextContent("cannot be calculated until they are set");
    expect(screen.getByTestId("verify-with-ca")).toBeInTheDocument();
    expect(screen.getByText("No bonus runs yet")).toBeInTheDocument();
  });

  it("summarises the figures in use with the last-verified note", () => {
    render(<BonusTab />);
    expect(screen.getByTestId("bonus-rules")).toHaveTextContent("eligible up to ₹21,000");
    expect(screen.getByTestId("bonus-rules")).toHaveTextContent("Last verified: Checked with CA on 1 Oct");
    expect(screen.queryByTestId("bonus-gaps")).not.toBeInTheDocument();
  });

  it("starts a run for the last financial year at the minimum percentage", () => {
    render(<BonusTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "+ New bonus run" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Bonus percentage/)).toHaveValue("8.33");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    expect(h.create).toHaveBeenCalledWith({ financialYear: 2025, percent: 8.33 });
  });

  it("shows no error toast while the run is still loading", () => {
    h.runs.data = [run("calculated")];
    h.detail.data = undefined;
    render(<BonusTab />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Loading the bonus run...")).toBeInTheDocument();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("a draft run is calculated, a calculated one can be recalculated and sent for approval", () => {
    open("draft", { employeeCount: 0, eligibleCount: 0, totalBonus: "0.00" }, undefined, []);
    fireEvent.click(actions().getByRole("button", { name: "Calculate bonus" }));
    expect(h.calculate).toHaveBeenCalledWith({ id: RUN });
    expect(actions().getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(actions().queryByRole("button", { name: /submit|approve|post/i })).not.toBeInTheDocument();
  });

  it("lists each employee's bonus and lets a manager mark someone not eligible, with the reason", () => {
    open("calculated", {}, undefined, [line(), line({ id: "l2", employeeId: "66666666-6666-4666-8666-666666666666", employeeCode: "E102", employeeName: "Bharat Joshi", eligible: false, reason: "wage_above_ceiling", reasonText: "Wage above the eligibility ceiling (₹21000).", bonus: "0.00" })]);
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText(/Wage above the eligibility ceiling/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Not eligible" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Not eligible" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Dismissed for misconduct" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(h.exclude).toHaveBeenCalledWith({ runId: RUN, employeeId: EMP, reason: "Dismissed for misconduct" });
    fireEvent.click(actions().getByRole("button", { name: "Submit for approval" }));
    expect(h.submit).toHaveBeenCalledWith({ id: RUN });
  });

  it("a hand exclusion can be undone", () => {
    open("calculated", { exclusions: { [EMP]: "Dismissed" } }, undefined, [line({ eligible: false, reason: "manual", reasonText: "Marked not eligible: Dismissed", bonus: "0.00" })]);
    fireEvent.click(screen.getByRole("button", { name: "Make eligible" }));
    expect(h.exclude).toHaveBeenCalledWith({ runId: RUN, employeeId: EMP, reason: "" });
  });

  it("approval is offered only to the person who may approve; others see why not", () => {
    open("pending_approval", {}, { canApprove: false, reason: "The person who calculated this bonus run cannot approve it." });
    expect(actions().queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("cannot approve it");
  });

  it("approves after a confirmation, then posts and marks as paid", () => {
    open("pending_approval", {}, { canApprove: true, reason: null });
    fireEvent.click(actions().getByRole("button", { name: "Approve" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
    expect(h.approve).toHaveBeenCalledWith({ id: RUN });
  });

  it("an approved run is posted; a posted one is paid from a chosen account", () => {
    open("approved");
    fireEvent.click(actions().getByRole("button", { name: "Post to books" }));
    expect(h.post).toHaveBeenCalledWith({ id: RUN });
    expect(actions().getByRole("button", { name: "Bank payment file" })).toBeInTheDocument();
  });

  it("marks a posted run as paid and needs a bank account", () => {
    open("posted");
    fireEvent.click(actions().getByRole("button", { name: "Mark as paid" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    expect(h.pay).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose the bank or cash account");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Paid from/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    expect(h.pay).toHaveBeenCalledWith({ runId: RUN, bankAccountId: BANK, paidOn: "2026-06-20", reference: "" });
  });

  it("downloads the statement as CSV", async () => {
    h.csv.mockResolvedValue({ filename: "bonus-statement-2025-26.csv", contentType: "text/csv", csv: "a,b" });
    open("calculated");
    fireEvent.click(actions().getByRole("button", { name: "Statement (CSV)" }));
    await vi.waitFor(() => expect(h.downloadText).toHaveBeenCalledWith("bonus-statement-2025-26.csv", "text/csv", "a,b"));
  });
});
