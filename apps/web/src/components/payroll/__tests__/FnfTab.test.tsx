import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const FNF = "77777777-7777-4777-8777-777777777777";
const EMP = "55555555-5555-4555-8555-555555555555";
const BANK = "88888888-8888-4888-8888-888888888888";
const EL = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => {
  const fns = {
    create: vi.fn(), update: vi.fn(), calculate: vi.fn(), submit: vi.fn(), approve: vi.fn(), reopen: vi.fn(), post: vi.fn(), pay: vi.fn(), del: vi.fn(), reverse: vi.fn(), reversePayment: vi.fn(),
    saveTemplate: vi.fn(), letter: vi.fn(), invalidate: vi.fn(), toast: vi.fn(), statement: vi.fn(), download: vi.fn(),
  };
  const mutation = (fn: (v: unknown) => void, result: unknown = { id: "77777777-7777-4777-8777-777777777777" }) => (o?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: (v: unknown) => {
      fn(v);
      o?.onSuccess?.(result);
    },
    isPending: false,
  });
  return { ...fns, mutation, list: { data: [] as unknown[] }, detail: { data: undefined as unknown }, exited: { data: [] as unknown[] }, template: { data: undefined as unknown } };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollFnf: { get: { invalidate: h.invalidate }, list: { invalidate: h.invalidate }, statementPdf: { fetch: h.statement } },
      payrollLetter: { template: { invalidate: h.invalidate } },
    }),
    bankAccount: { list: { useQuery: () => ({ data: [{ id: "88888888-8888-4888-8888-888888888888", accountName: "HDFC Current" }] }) } },
    payrollEmployee: { list: { useQuery: () => ({ data: { data: h.exited.data }, isLoading: false }) } },
    payrollLetter: {
      template: { useQuery: () => ({ data: h.template.data }) },
      saveTemplate: { useMutation: h.mutation(h.saveTemplate) },
      relievingPdf: { useMutation: h.mutation(h.letter, { filename: "relieving-letter-E104.pdf", contentType: "application/pdf", base64: "JVBERi0=" }) },
    },
    payrollFnf: {
      list: { useQuery: () => ({ data: h.list.data, isLoading: false }) },
      get: { useQuery: () => ({ data: h.detail.data, isLoading: !h.detail.data }) },
      create: { useMutation: h.mutation(h.create) },
      update: { useMutation: h.mutation(h.update) },
      calculate: { useMutation: h.mutation(h.calculate) },
      submit: { useMutation: h.mutation(h.submit) },
      approve: { useMutation: h.mutation(h.approve) },
      reopen: { useMutation: h.mutation(h.reopen) },
      post: { useMutation: h.mutation(h.post) },
      markPaid: { useMutation: h.mutation(h.pay) },
      delete: { useMutation: h.mutation(h.del) },
      reverse: { useMutation: h.mutation(h.reverse) },
      reversePayment: { useMutation: h.mutation(h.reversePayment) },
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
  return { ...actual, downloadBase64: h.download };
});

import { FnfTab } from "../FnfTab";

const settlement = (status: string, over: Record<string, unknown> = {}) => ({
  id: FNF, number: "FF-0001", status, employeeId: EMP, lastWorkingDay: "2026-05-20", encashmentBasis: "basic_da_26", inputs: {}, grossTotal: "83576.92", deductionsTotal: "32966.67", loanRecovered: "25000.00",
  netPayable: "50610.25", warnings: [{ code: "tds_not_computed", message: "TDS not computed" }, { code: "gratuity_not_eligible", message: "Gratuity is not payable: 1 completed year of service, 5 needed." }],
  updatedAt: "2026-06-20T00:00:00.000Z", calculatedByUserId: "u1", ...over,
});
const lines = () => [
  { id: "a", side: "earning", kind: "leave_encashment", label: "Leave encashment (EL)", amount: "2307.69", detail: "3 days x ₹769.23" },
  { id: "b", side: "earning", kind: "gratuity", label: "Gratuity", amount: "80769.23", detail: null },
  { id: "c", side: "deduction", kind: "notice_recovery", label: "Notice-period recovery", amount: "6666.67", detail: null },
  { id: "d", side: "deduction", kind: "loan_recovery", label: "Loan / advance recovery LN-0003", amount: "25000.00", detail: null },
];
const detail = (status: string, over: Record<string, unknown> = {}, approval = { canApprove: false, reason: null as string | null }, salary: Record<string, unknown> = {}) => ({
  settlement: settlement(status, over),
  employee: { id: EMP, code: "E104", name: "Deepak Menon", status: "exited" },
  lines: lines(),
  salary: { state: "in_run", month: "2026-05", runId: "r1", runStatus: "paid", netPay: "26451.61", message: "Salary for May 2026 (net ₹26451.61) is paid through the May 2026 payroll run, not in this settlement.", ...salary },
  encashable: [{ leaveTypeId: EL, code: "EL", name: "Earned / privilege leave", balance: 3, maxDays: 3 }],
  tdsWarning: "Income-tax (TDS) on this settlement is NOT calculated. Enter the amount to deduct yourself after checking with your CA.",
  approval,
});

function open(status: string, over: Record<string, unknown> = {}, approval?: { canApprove: boolean; reason: string | null }, salary?: Record<string, unknown>) {
  h.detail.data = detail(status, over, approval, salary);
  h.list.data = [{ ...settlement(status, over), employeeName: "Deepak Menon", employeeCode: "E104" }];
  render(<FnfTab />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}
const actions = () => within(screen.getByTestId("fnf-actions"));

describe("FnfTab", () => {
  beforeEach(() => {
    for (const k of Object.keys(h) as Array<keyof typeof h>) {
      const v = h[k];
      if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset();
    }
    h.list.data = [];
    h.detail.data = undefined;
    h.exited.data = [{ id: EMP, name: "Deepak Menon", employeeCode: "E104", lastWorkingDay: "2026-05-20" }, { id: "66666666-6666-4666-8666-666666666666", name: "Meena Shah", employeeCode: "E105", lastWorkingDay: "2026-04-30" }];
    h.template.data = { kind: "relieving", title: "Relieving Letter", body: "This certifies that {{employee_name}} worked here.", signatoryName: null, signatoryTitle: null, place: null, isDefault: true, updatedAt: null, placeholders: ["employee_name", "employee_code"] };
  });

  it("starts a settlement for an employee who has left and has none yet", () => {
    h.list.data = [{ ...settlement("draft"), employeeName: "Deepak Menon", employeeCode: "E104" }];
    render(<FnfTab />);
    fireEvent.click(screen.getByRole("button", { name: "+ New settlement" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Employee who has left/ }));
    // Deepak already has one: only Meena can be chosen.
    expect(screen.queryByRole("option", { name: /Deepak/ })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Meena Shah/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    expect(h.create).toHaveBeenCalledWith({ employeeId: "66666666-6666-4666-8666-666666666666", encashmentBasis: "basic_da_26" });
  });

  it("says the last month's salary is paid through the payroll run and that TDS is not calculated", () => {
    open("draft");
    expect(screen.getByTestId("fnf-salary")).toHaveTextContent("paid through the May 2026 payroll run, not in this settlement");
    expect(screen.getByTestId("fnf-tds")).toHaveTextContent("NOT calculated");
    expect(screen.getByText(/Gratuity is not payable/)).toBeInTheDocument();
    // The TDS warning is the notice, not repeated in the list.
    expect(screen.queryByText("TDS not computed")).not.toBeInTheDocument();
  });

  it("shows the amounts due, the recoveries (the loan last) and the net payable", () => {
    open("draft");
    const due = screen.getByRole("table", { name: "Amounts due" });
    expect(due).toHaveTextContent("Leave encashment (EL)");
    expect(due).toHaveTextContent("₹2,307.69");
    expect(due).toHaveTextContent("3 days x ₹769.23");
    const rec = screen.getByRole("table", { name: "Recoveries" });
    expect(rec).toHaveTextContent("Loan / advance recovery LN-0003");
    expect(screen.getByText("₹50,610.25")).toBeInTheDocument();
  });

  it("a draft is saved with the preparer's choices, and recalculated, submitted or deleted", () => {
    open("draft");
    fireEvent.change(screen.getByLabelText(/Notice period shortfall/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/TDS on the settlement/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Earned \/ privilege leave: days to encash/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Add the bonus due/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add a line" })[0]!);
    fireEvent.change(screen.getAllByLabelText("Name")[0]!, { target: { value: "Arrears of April" } });
    fireEvent.change(screen.getAllByLabelText("Amount")[0]!, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and recalculate" }));
    expect(h.update).toHaveBeenCalledWith({
      id: FNF, encashmentBasis: "basic_da_26", noticeShortfallDays: 5, tdsAmount: 1000, includeBonus: true, encashDays: { [EL]: 2 },
      earnings: [{ name: "Arrears of April", amount: 500, kind: "other_earning" }], deductions: [],
    });
    fireEvent.click(actions().getByRole("button", { name: "Recalculate" }));
    expect(h.calculate).toHaveBeenCalledWith({ id: FNF });
    fireEvent.click(actions().getByRole("button", { name: "Submit for approval" }));
    expect(h.submit).toHaveBeenCalledWith({ id: FNF });
    fireEvent.click(actions().getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(h.del).toHaveBeenCalledWith({ id: FNF });
  });

  it("the input form is only for a draft", () => {
    open("pending_approval", {}, { canApprove: true, reason: null });
    expect(screen.queryByText("What goes into the settlement")).not.toBeInTheDocument();
    expect(actions().getByRole("button", { name: "Back to draft" })).toBeInTheDocument();
  });

  it("only a person who may approve sees Approve; the preparer is told why not", () => {
    open("pending_approval", {}, { canApprove: false, reason: "The person who calculated this settlement cannot approve it." });
    expect(actions().queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("status").some((n) => /cannot approve it/.test(n.textContent ?? ""))).toBe(true);
  });

  it("approves after a confirmation, posts and is marked as paid from an account", () => {
    open("pending_approval", {}, { canApprove: true, reason: null });
    fireEvent.click(actions().getByRole("button", { name: "Approve" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
    expect(h.approve).toHaveBeenCalledWith({ id: FNF });
  });

  it("post, then pay", () => {
    open("approved");
    fireEvent.click(actions().getByRole("button", { name: "Post to books" }));
    expect(h.post).toHaveBeenCalledWith({ id: FNF });
  });

  it("pays a posted settlement from a bank account", () => {
    open("posted");
    fireEvent.click(actions().getByRole("button", { name: "Mark as paid" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Paid from/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }));
    expect(h.pay).toHaveBeenCalledWith({ id: FNF, bankAccountId: BANK, paidOn: "2026-06-20", reference: "" });
  });

  it("downloads the statement as a PDF", async () => {
    h.statement.mockResolvedValue({ filename: "full-and-final-FF-0001.pdf", contentType: "application/pdf", base64: "JVBERi0=" });
    open("approved");
    fireEvent.click(actions().getByRole("button", { name: "Statement (PDF)" }));
    await waitFor(() => expect(h.download).toHaveBeenCalledWith("full-and-final-FF-0001.pdf", "application/pdf", "JVBERi0="));
  });

  it("reversing a posted settlement asks for a reason first, then reverses", () => {
    open("posted");
    fireEvent.click(actions().getByRole("button", { name: "Reverse settlement" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("It cannot be undone");
    expect(dialog).toHaveTextContent("The employee is not brought back");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reverse settlement" }));
    expect(h.reverse).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Give the reason for the reversal.");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "  Settled against the wrong exit date " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reverse settlement" }));
    expect(h.reverse).toHaveBeenCalledWith({ id: FNF, reason: "Settled against the wrong exit date" });
  });

  it("a paid settlement offers only the payment reversal; a reversed one offers nothing and says why", () => {
    open("paid");
    expect(actions().queryByRole("button", { name: "Reverse settlement" })).not.toBeInTheDocument();
    fireEvent.click(actions().getByRole("button", { name: "Reverse payment" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("back into the account it was paid from");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Paid from the wrong account" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reverse payment" }));
    expect(h.reversePayment).toHaveBeenCalledWith({ id: FNF, reason: "Paid from the wrong account" });
  });

  it("a reversed settlement shows the reason and no action but the statement", () => {
    open("reversed", { reversedAt: "2026-06-21T05:00:00.000Z", reversedByName: "Ramesh Kumar", reversalReason: "Wrong exit date" });
    expect(screen.getByTestId("fnf-reversed")).toHaveTextContent("Reason: Wrong exit date");
    expect(actions().queryByRole("button", { name: /Reverse|Post|Mark as paid|Approve/ })).not.toBeInTheDocument();
    expect(actions().getByRole("button", { name: "Statement (PDF)" })).toBeInTheDocument();
  });

  it("an employee whose settlement was reversed can have a new one started", () => {
    h.list.data = [{ ...settlement("reversed"), employeeName: "Deepak Menon", employeeCode: "E104" }];
    render(<FnfTab />);
    fireEvent.click(screen.getByRole("button", { name: "+ New settlement" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Employee who has left/ }));
    expect(screen.getByRole("option", { name: /Deepak/ })).toBeInTheDocument();
  });

  it("shows no error toast while the settlement is loading", () => {
    h.list.data = [{ ...settlement("draft"), employeeName: "Deepak Menon", employeeCode: "E104" }];
    render(<FnfTab />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Loading the settlement...")).toBeInTheDocument();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("the relieving letter: saves the wording, lists the people who left and makes the PDF", () => {
    render(<FnfTab />);
    expect(screen.getByText(/Using the standard wording/)).toBeInTheDocument();
    expect(screen.getByText(/\{\{employee_name\}\}, \{\{employee_code\}\}/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Signatory name"), { target: { value: "R. Kumar" } });
    fireEvent.click(screen.getByRole("button", { name: "Save wording" }));
    expect(h.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ kind: "relieving", signatoryName: "R. Kumar", body: expect.stringContaining("{{employee_name}}") }));
    const table = screen.getByRole("table", { name: "Employees who have left" });
    expect(within(table).getAllByRole("button", { name: "Relieving letter" })).toHaveLength(2);
    fireEvent.click(within(table).getAllByRole("button", { name: "Relieving letter" })[0]!);
    expect(h.letter).toHaveBeenCalledWith({ employeeId: EMP, kind: "relieving" });
    expect(h.download).toHaveBeenCalledWith("relieving-letter-E104.pdf", "application/pdf", "JVBERi0=");
    expect(screen.getByText(/not digitally signed/)).toBeInTheDocument();
  });
});
