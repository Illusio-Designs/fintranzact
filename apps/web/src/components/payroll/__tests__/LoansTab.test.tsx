import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const LOAN = "77777777-7777-4777-8777-777777777777";
const EMP = "55555555-5555-4555-8555-555555555555";
const BANK = "88888888-8888-4888-8888-888888888888";

const h = vi.hoisted(() => {
  const fns = {
    create: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn(), disburse: vi.fn(), prepay: vi.fn(), foreclose: vi.fn(), skip: vi.fn(), reschedule: vi.fn(), updateSettings: vi.fn(),
    invalidate: vi.fn(), toast: vi.fn(), statement: vi.fn(), downloadText: vi.fn(), preview: vi.fn(),
  };
  const mutation = (fn: (v: unknown) => void) => (o?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: (v: unknown) => {
      fn(v);
      o?.onSuccess?.({ id: "77777777-7777-4777-8777-777777777777" });
    },
    isPending: false,
  });
  return { ...fns, mutation, canManage: { current: true }, loans: { data: [] as unknown[] }, detail: { data: undefined as unknown }, previewData: { data: undefined as unknown } };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollLoan: { get: { invalidate: h.invalidate }, list: { invalidate: h.invalidate }, settings: { invalidate: h.invalidate }, statementCsv: { fetch: h.statement } } }),
    bankAccount: { list: { useQuery: () => ({ data: [{ id: "88888888-8888-4888-8888-888888888888", accountName: "HDFC Current" }] }) } },
    payrollEmployee: { list: { useQuery: () => ({ data: { data: [{ id: "55555555-5555-4555-8555-555555555555", name: "Chitra Rao", employeeCode: "E103" }] } }) } },
    payrollLoan: {
      list: { useQuery: () => ({ data: h.loans.data, isLoading: false }) },
      settings: { useQuery: () => ({ data: { maxDeductionPercent: 50 } }) },
      schedulePreview: { useQuery: (input: unknown) => { h.preview(input); return { data: h.previewData.data, isError: false }; } },
      get: { useQuery: () => ({ data: h.detail.data, isLoading: !h.detail.data }) },
      create: { useMutation: h.mutation(h.create) },
      approve: { useMutation: h.mutation(h.approve) },
      reject: { useMutation: h.mutation(h.reject) },
      cancel: { useMutation: h.mutation(h.cancel) },
      disburse: { useMutation: h.mutation(h.disburse) },
      prepay: { useMutation: h.mutation(h.prepay) },
      foreclose: { useMutation: h.mutation(h.foreclose) },
      skip: { useMutation: h.mutation(h.skip) },
      reschedule: { useMutation: h.mutation(h.reschedule) },
      updateSettings: { useMutation: h.mutation(h.updateSettings) },
    },
  },
}));
vi.mock("@/lib/permissions", () => ({ useCan: () => h.canManage.current }));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, todayISODate: () => "2026-10-08" };
});
vi.mock("../payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-ui")>();
  return { ...actual, downloadText: h.downloadText, currentMonth: () => "2026-10" };
});

import { LoansTab } from "../LoansTab";

const loan = (status: string, over: Record<string, unknown> = {}) => ({
  id: LOAN, number: "LN-0001", kind: "loan", status, principal: "100000.00", interestRate: "12.00", installmentCount: 12, emi: "8884.88", startMonth: "2026-11", ...over,
});
const view = (status: string, over: Record<string, unknown> = {}) => ({ loan: loan(status, over), employeeName: "Chitra Rao", employeeCode: "E103", outstanding: "92115.12", recoveredPrincipal: "7884.88", recoveredInterest: "1000.00", nextDueMonth: "2026-11" });
const detail = (status: string, over: Record<string, unknown> = {}) => ({
  ...view(status, over),
  installments: [
    { id: "i1", loanId: LOAN, seq: 1, dueMonth: "2026-11", principal: "7884.88", interest: "1000.00", paidPrincipal: "0.00", paidInterest: "0.00", status: "open", note: null },
    { id: "i0", loanId: LOAN, seq: 0, dueMonth: "2026-10", principal: "1.00", interest: "0.00", paidPrincipal: "0.00", paidInterest: "0.00", status: "superseded", note: null },
  ],
  events: [{ id: "ev1", kind: "issued", eventDate: "2026-10-01", principal: "0.00", interest: "0.00", balanceAfter: "0.00", note: "Medical" }],
});

function open(status: string, over: Record<string, unknown> = {}) {
  h.detail.data = detail(status, over);
  h.loans.data = [view(status, over)];
  render(<LoansTab />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}
const actions = () => within(screen.getByTestId("loan-actions"));

describe("LoansTab", () => {
  beforeEach(() => {
    for (const k of Object.keys(h) as Array<keyof typeof h>) {
      const v = h[k];
      if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset();
    }
    h.canManage.current = true;
    h.loans.data = [];
    h.detail.data = undefined;
    h.previewData.data = undefined;
  });

  it("explains the empty state and shows the recovery limit", () => {
    render(<LoansTab />);
    expect(screen.getByText("No loans or advances yet")).toBeInTheDocument();
    expect(screen.getByLabelText(/Most of net pay to recover/)).toHaveValue("50");
  });

  it("only an owner or admin can change the recovery limit", () => {
    h.canManage.current = false;
    render(<LoansTab />);
    expect(screen.getByLabelText(/Most of net pay to recover/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("saves a new recovery limit", () => {
    render(<LoansTab />);
    fireEvent.change(screen.getByLabelText(/Most of net pay to recover/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.updateSettings).toHaveBeenCalledWith({ maxDeductionPercent: 40 });
  });

  it("issues a loan after showing the schedule: the EMI, the interest and the last instalment", () => {
    h.previewData.data = { emi: "8884.88", count: 12, totalInterest: "6618.56", totalPayable: "106618.56", rows: [{ seq: 1, month: "2026-11", emi: "8884.88", interest: "1000.00" }, { seq: 12, month: "2027-10", emi: "8884.96", interest: "87.96" }] };
    render(<LoansTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "+ Issue loan or advance" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Employee/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /Chitra Rao/ }));
    fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: "100000" } });
    fireEvent.change(within(dialog).getByLabelText(/Interest a year/), { target: { value: "12" } });
    fireEvent.change(within(dialog).getByLabelText(/^Instalments/), { target: { value: "12" } });
    expect(screen.getByTestId("loan-preview")).toHaveTextContent("EMI ₹8,884.88 for 12 months");
    expect(screen.getByTestId("loan-preview")).toHaveTextContent("last instalment clears the balance");
    expect(h.preview).toHaveBeenLastCalledWith({ amount: 100000, interestRate: 12, startMonth: "2026-11", installments: 12 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue for approval" }));
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ employeeId: EMP, kind: "loan", amount: 100000, interestRate: 12, installments: 12, startMonth: "2026-11", issueDate: "2026-10-08" }));
  });

  it("asks for the employee and the amount before issuing", () => {
    render(<LoansTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "+ Issue loan or advance" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue for approval" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose the employee");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a pending loan is approved (by a manager) or rejected with a reason", () => {
    open("pending_approval");
    fireEvent.click(actions().getByRole("button", { name: "Approve" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
    expect(h.approve).toHaveBeenCalledWith({ id: LOAN });
    fireEvent.click(actions().getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Not eligible yet" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(h.reject).toHaveBeenCalledWith({ id: LOAN, note: "Not eligible yet" });
  });

  it("without the approve permission the loan waits and says who approves", () => {
    h.canManage.current = false;
    open("pending_approval");
    expect(actions().queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("An owner or admin approves loans");
    expect(actions().getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("an approved loan is disbursed from a chosen account", () => {
    open("approved");
    fireEvent.click(actions().getByRole("button", { name: "Disburse" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Paid from/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Disburse" }));
    expect(h.disburse).toHaveBeenCalledWith({ id: LOAN, bankAccountId: BANK, paidOn: "2026-10-08", reference: "" });
  });

  it("an active loan takes a part-payment, a foreclosure, a skip and a reschedule", async () => {
    open("active");
    // The replaced instalment is not shown in the schedule.
    expect(screen.queryByText(/superseded/)).not.toBeInTheDocument();

    fireEvent.click(actions().getByRole("button", { name: "Record part-payment" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Principal repaid/), { target: { value: "20000" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Received into/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    expect(h.prepay).toHaveBeenCalledWith({ id: LOAN, bankAccountId: BANK, receivedOn: "2026-10-08", amount: 20000, interest: 0, reference: "" });

    fireEvent.click(actions().getByRole("button", { name: "Foreclose" }));
    dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("whole balance of ₹92,115.12");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Received into/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close the loan" }));
    expect(h.foreclose).toHaveBeenCalledWith({ id: LOAN, bankAccountId: BANK, receivedOn: "2026-10-08", interest: 0, reference: "" });

    fireEvent.click(actions().getByRole("button", { name: "Skip an instalment" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Skip" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "On unpaid leave" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip" }));
    expect(h.skip).toHaveBeenCalledWith({ id: LOAN, reason: "On unpaid leave" });

    fireEvent.click(actions().getByRole("button", { name: "Reschedule" }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Instalments/), { target: { value: "6" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Agreed with employee" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reschedule" }));
    expect(h.reschedule).toHaveBeenCalledWith({ id: LOAN, reason: "Agreed with employee", firstMonth: "2026-11", installments: 6 });
  });

  it("refuses a part-payment above the balance without calling the server", () => {
    open("active");
    fireEvent.click(actions().getByRole("button", { name: "Record part-payment" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Principal repaid/), { target: { value: "999999" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Received into/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    expect(h.prepay).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Check the amount");
  });

  it("downloads the statement", async () => {
    h.statement.mockResolvedValue({ filename: "loan-statement-LN-0001.csv", contentType: "text/csv", csv: "a" });
    open("active");
    fireEvent.click(actions().getByRole("button", { name: "Statement (CSV)" }));
    await waitFor(() => expect(h.downloadText).toHaveBeenCalledWith("loan-statement-LN-0001.csv", "text/csv", "a"));
  });
});
