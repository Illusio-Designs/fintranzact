import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const RUN = "77777777-7777-4777-8777-777777777777";
const EMP = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => {
  const fns = {
    create: vi.fn(), del: vi.fn(), lock: vi.fn(), calculate: vi.fn(), submit: vi.fn(), approve: vi.fn(), reopen: vi.fn(), post: vi.fn(), pay: vi.fn(),
    addAdj: vi.fn(), removeAdj: vi.fn(), email: vi.fn(), invalidate: vi.fn(), fetchPdf: vi.fn(), fetchBank: vi.fn(), download: vi.fn(), downloadText: vi.fn(),
  };
  const mutation = (fn: (v: unknown) => void) => (o?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => ({
    mutate: (v: unknown) => {
      fn(v);
      o?.onSuccess?.({ id: "77777777-7777-4777-8777-777777777777", filled: 0 });
    },
    isPending: false,
  });
  return { ...fns, mutation, runs: { data: [] as unknown[] }, detail: { data: undefined as unknown }, lockError: { current: null as null | Error } };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollRun: {
        list: { invalidate: h.invalidate },
        get: { invalidate: h.invalidate },
        payslipPdf: { fetch: h.fetchPdf },
        bankFile: { fetch: h.fetchBank },
      },
    }),
    bankAccount: { list: { useQuery: () => ({ data: [{ id: "88888888-8888-4888-8888-888888888888", accountName: "HDFC Current" }] }) } },
    payrollRun: {
      list: { useQuery: () => ({ data: h.runs.data, isLoading: false }) },
      get: { useQuery: () => ({ data: h.detail.data, isLoading: !h.detail.data }) },
      create: { useMutation: h.mutation(h.create) },
      delete: { useMutation: h.mutation(h.del) },
      lockAttendance: {
        useMutation: (o?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => ({
          mutate: (v: unknown) => {
            h.lock(v);
            if (h.lockError.current) o?.onError?.(h.lockError.current);
            else o?.onSuccess?.({ filled: 0 });
          },
          isPending: false,
        }),
      },
      calculate: { useMutation: h.mutation(h.calculate) },
      submit: { useMutation: h.mutation(h.submit) },
      approve: { useMutation: h.mutation(h.approve) },
      reopen: { useMutation: h.mutation(h.reopen) },
      post: { useMutation: h.mutation(h.post) },
      markPaid: { useMutation: h.mutation(h.pay) },
      addAdjustment: { useMutation: h.mutation(h.addAdj) },
      removeAdjustment: { useMutation: h.mutation(h.removeAdj) },
      payslipEmail: { useMutation: h.mutation(h.email) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: vi.fn() }));
vi.mock("../payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-ui")>();
  return { ...actual, downloadBase64: h.download, downloadText: h.downloadText, currentMonth: () => "2026-10" };
});

import { RunsTab } from "../RunsTab";

const line = (over: Record<string, unknown> = {}) => ({
  id: "l1", runId: RUN, employeeId: EMP, employeeCode: "E001", employeeName: "Asha Verma", daysInMonth: 31, employedDays: 31, paidDays: "28.5", lopDays: "2.5",
  grossEarnings: "46774.19", totalDeductions: "1000.00", employerContributions: "0.00", netPay: "45774.19", isFinalSettlement: false, hasBankDetails: true,
  payslipNumber: null, payslipEmailedAt: null, warnings: [],
  components: [
    { componentId: null, code: "BASIC", name: "Basic", type: "earning", category: "basic", source: "structure", full: "25000.00", amount: "22983.87" },
    { componentId: null, code: "ADJ", name: "Advance recovery", type: "deduction", category: "manual_deduction", source: "adjustment", full: "0.00", amount: "1000.00" },
  ],
  ...over,
});

const detail = (status: string, over: Record<string, unknown> = {}, approval = { canApprove: false, reason: null as string | null }) => ({
  run: {
    id: RUN, month: "2026-08", status, daysInMonth: 31, employeeCount: 1, grossTotal: "46774.19", deductionsTotal: "1000.00", employerTotal: "0.00", netTotal: "45774.19",
    warnings: [{ code: "wages_below_50_percent", message: "Asha Verma: Wages are below 50% of the total remuneration." }], accrualJournalEntryId: null, paymentJournalEntryId: null,
    postedAt: null, paidOn: null, paidReference: null, ...over,
  },
  lines: [line()],
  adjustments: [{ id: "a1", runId: RUN, employeeId: EMP, name: "Advance recovery", type: "deduction", amount: "1000.00" }],
  approval,
});

function open(status: string, over: Record<string, unknown> = {}, approval?: { canApprove: boolean; reason: string | null }) {
  h.detail.data = detail(status, over, approval);
  h.runs.data = [{ id: RUN, month: "2026-08", status, employeeCount: 1, grossTotal: "46774.19", netTotal: "45774.19" }];
  render(<RunsTab />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}

const actions = () => within(screen.getByTestId("run-actions"));

describe("RunsTab", () => {
  beforeEach(() => {
    for (const k of Object.keys(h) as Array<keyof typeof h>) {
      const v = h[k];
      if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset();
    }
    h.lockError.current = null;
    h.runs.data = [];
    h.detail.data = undefined;
  });

  it("lists runs and starts one for a month", () => {
    h.runs.data = [{ id: RUN, month: "2026-08", status: "paid", employeeCount: 3, grossTotal: "100000.00", netTotal: "90000.00" }];
    render(<RunsTab />);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Start payroll" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    expect(h.create).toHaveBeenCalledWith({ month: "2026-10" });
  });

  it("explains the empty state", () => {
    render(<RunsTab />);
    expect(screen.getByText("No payroll runs yet")).toBeInTheDocument();
  });

  it("a draft run offers locking attendance (and deleting), nothing else", () => {
    open("draft");
    expect(actions().getByRole("button", { name: "Lock attendance" })).toBeInTheDocument();
    expect(actions().queryByRole("button", { name: /calculate|approve|post|paid/i })).not.toBeInTheDocument();
    fireEvent.click(actions().getByRole("button", { name: "Lock attendance" }));
    expect(h.lock).toHaveBeenCalledWith({ id: RUN });
  });

  it("missing attendance asks how to count the days, then locks with the choice", async () => {
    h.lockError.current = new Error("2 employees have 5 working days with no attendance (Asha Verma). Mark them, or lock with the missing days counted as present or absent.");
    open("draft");
    fireEvent.click(actions().getByRole("button", { name: "Lock attendance" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("with no attendance");
    h.lockError.current = null;
    fireEvent.click(within(dialog).getByRole("button", { name: "Count them as present" }));
    expect(h.lock).toHaveBeenLastCalledWith({ id: RUN, fillUnmarked: "present" });
  });

  it("a locked run is calculated next", () => {
    open("attendance_locked");
    fireEvent.click(actions().getByRole("button", { name: "Calculate payroll" }));
    expect(h.calculate).toHaveBeenCalledWith({ id: RUN });
    expect(actions().getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("a calculated run shows each employee's pay, warnings and the adjustments, and can be sent for approval", () => {
    open("calculated");
    expect(screen.getByText("1 thing to check")).toBeInTheDocument();
    expect(screen.getByText(/Wages are below 50%/)).toBeInTheDocument();
    expect(screen.getByText("₹45,774.19", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("Adjustments in this run")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    fireEvent.click(actions().getByRole("button", { name: "Submit for approval" }));
    expect(h.submit).toHaveBeenCalledWith({ id: RUN });
    // Approving is not offered here.
    expect(actions().queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("expands a line to show its components", () => {
    open("calculated");
    fireEvent.click(screen.getByRole("button", { name: "Asha Verma" }));
    const detailTable = screen.getByRole("table", { name: "Asha Verma pay breakdown" });
    expect(detailTable).toHaveTextContent("Basic");
    expect(detailTable).toHaveTextContent("of ₹25,000.00");
    expect(detailTable).toHaveTextContent("Advance recovery (deduction)");
  });

  it("adds an adjustment: a manual deduction needs a name and an amount", () => {
    open("calculated");
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    const dialog = screen.getByRole("dialog");
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Amount/), { target: { value: "500" } });
    fireEvent.click(add);
    expect(h.addAdj).toHaveBeenCalledWith({ runId: RUN, employeeId: EMP, name: "Advance recovery", type: "deduction", amount: 500 });
  });

  it("maker-checker: the person who calculated is told why they cannot approve", () => {
    open("pending_approval", {}, { canApprove: false, reason: "The person who calculated this payroll cannot approve it. Ask another owner or admin to approve it (a business with a single user can approve its own payroll)." });
    expect(screen.getByRole("status")).toHaveTextContent("cannot approve it");
    expect(actions().queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(actions().getByRole("button", { name: "Recalculate" })).toBeInTheDocument();
  });

  it("an approver confirms before approving; approval is final", async () => {
    open("pending_approval", {}, { canApprove: true, reason: null });
    fireEvent.click(actions().getByRole("button", { name: "Approve" }));
    const confirm = screen.getByRole("dialog");
    expect(confirm).toHaveTextContent("cannot be changed or reopened");
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve" }));
    expect(h.approve).toHaveBeenCalledWith({ id: RUN });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("an approved run can be posted, has a bank file, payslips by email, and cannot be reopened or adjusted", async () => {
    h.fetchBank.mockResolvedValue({ filename: "salary-2026-08.csv", contentType: "text/csv", csv: "a,b", count: 1, total: "45774.19", skipped: [] });
    open("approved");
    expect(actions().getByRole("button", { name: "Post to books" })).toBeInTheDocument();
    expect(actions().queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    fireEvent.click(actions().getByRole("button", { name: "Post to books" }));
    expect(h.post).toHaveBeenCalledWith({ id: RUN });
    fireEvent.click(screen.getByRole("button", { name: "Email" }));
    expect(h.email).toHaveBeenCalledWith({ runId: RUN, employeeId: EMP });
    fireEvent.click(actions().getByRole("button", { name: "Bank payment file" }));
    await waitFor(() => expect(h.downloadText).toHaveBeenCalledWith("salary-2026-08.csv", "text/csv", "a,b"));
  });

  it("downloads a payslip PDF", async () => {
    h.fetchPdf.mockResolvedValue({ filename: "PS-2026-08-E001.pdf", contentType: "application/pdf", base64: "JVBERi0=", draft: false });
    open("approved");
    fireEvent.click(screen.getByRole("button", { name: "Payslip" }));
    await waitFor(() => expect(h.download).toHaveBeenCalledWith("PS-2026-08-E001.pdf", "application/pdf", "JVBERi0="));
  });

  it("a posted run is marked paid from a chosen account", () => {
    open("posted", { accrualJournalEntryId: "j1", postedAt: "2026-09-01T00:00:00Z" });
    fireEvent.click(actions().getByRole("button", { name: "Mark as paid" }));
    const dialog = screen.getByRole("dialog");
    // No account chosen yet: refused with a message.
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    expect(h.pay).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Choose the bank or cash account/);
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Paid from/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    expect(h.pay).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN, bankAccountId: "88888888-8888-4888-8888-888888888888" }));
  });

  it("a paid run is read-only, with the payment shown", () => {
    open("paid", { paidOn: "2026-09-05", paidReference: "BATCH-1", accrualJournalEntryId: "j1", paymentJournalEntryId: "j2", postedAt: "2026-09-01T00:00:00Z" });
    expect(screen.getByText(/Paid on 05 Sep 2026 \(BATCH-1\)/)).toBeInTheDocument();
    expect(within(screen.getByTestId("run-actions")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Bank payment file"]);
  });

  it("reopening asks for confirmation first", () => {
    open("calculated");
    fireEvent.click(actions().getByRole("button", { name: "Reopen" }));
    expect(h.reopen).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reopen" }));
    expect(h.reopen).toHaveBeenCalledWith({ id: RUN });
  });
});
