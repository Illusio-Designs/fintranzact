import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const TYPE = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  attendance: { data: undefined as unknown, isLoading: false },
  payslips: { data: [] as unknown[], isLoading: false },
  years: { data: [] as unknown[], isLoading: false },
  loans: { data: [] as unknown[], isLoading: false, error: null as unknown },
  statement: { data: undefined as unknown, isLoading: false, error: null as unknown },
  statementAsked: vi.fn(),
  leave: { data: undefined as unknown, isLoading: false },
  apply: vi.fn(),
  cancel: vi.fn(),
  fetchPayslip: vi.fn(),
  fetchForm16: vi.fn(),
  download: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollSelf: {
        leaveOverview: { invalidate: h.invalidate },
        attendance: { invalidate: h.invalidate },
        payslipPdf: { fetch: h.fetchPayslip },
        form16Pdf: { fetch: h.fetchForm16 },
      },
    }),
    payrollSelf: {
      attendance: { useQuery: () => h.attendance },
      payslips: { useQuery: () => h.payslips },
      form16Years: { useQuery: () => h.years },
      loans: { useQuery: () => h.loans },
      loanStatement: { useQuery: (i: unknown) => { h.statementAsked(i); return h.statement; } },
      leaveOverview: { useQuery: () => h.leave },
      leaveApply: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.apply(v); o.onSuccess?.(); }, isPending: false }) },
      leaveCancel: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.cancel(v); o.onSuccess?.(); }, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));
vi.mock("@/components/payroll/payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/payroll/payroll-ui")>();
  return { ...actual, downloadBase64: h.download, currentMonth: () => "2026-10" };
});

import { MyAttendance } from "../MyAttendance";
import { MyPayslips } from "../MyPayslips";
import { MyLeave } from "../MyLeave";
import { MyLoans } from "../MyLoans";

describe("MyAttendance", () => {
  beforeEach(() => {
    const days = Array.from({ length: 31 }, (_, i) => {
      const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
      return { date, employed: true, weekOff: [4, 11, 18, 25].includes(i + 1), holiday: i + 1 === 2 ? "Gandhi Jayanti" : null, status: i + 1 === 5 ? "present" : i + 1 === 6 ? "half_day" : null, checkIn: i + 1 === 5 ? "09:02" : null, checkOut: i + 1 === 5 ? "18:05" : null, overtimeHours: 0, source: null, note: null };
    });
    h.attendance = { data: { month: "2026-10", days, punches: [{ id: "p1", kind: "in", date: "2026-10-05", time: "09:02", source: "mobile", geofenceResult: "inside", flags: ["late"], review: null }], leaves: [], summary: { present: 1, halfDay: 1, absent: 0, leave: 0 } }, isLoading: false };
  });

  it("shows the month's days, times, week offs, holidays, summary and punches", () => {
    render(<MyAttendance />);
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByTestId("attendance-summary")).toHaveTextContent("Present 1, half days 1");
    const grid = screen.getByRole("grid", { name: "Calendar" });
    expect(within(grid).getByText("09:02-18:05")).toBeInTheDocument();
    expect(within(grid).getByText("Gandhi Jayanti")).toBeInTheDocument();
    expect(within(grid).getAllByText("Week off")).toHaveLength(4);
    expect(screen.getByText("Late")).toBeInTheDocument();
  });

  it("cannot go past the current month", () => {
    render(<MyAttendance />);
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
  });
});

describe("MyPayslips", () => {
  beforeEach(() => {
    for (const f of [h.fetchPayslip, h.fetchForm16, h.download, h.toast]) f.mockReset();
    h.payslips = { data: [{ runId: "r1", month: "2026-09", monthLabel: "September 2026", number: "PS-2026-09-E001", netPay: "42000.00", grossEarnings: "50000.00", paidDays: "30.00", lopDays: "0.00" }], isLoading: false };
    h.years = { data: [], isLoading: false };
  });

  it("lists approved payslips and downloads one", async () => {
    h.fetchPayslip.mockResolvedValue({ filename: "PS-2026-09-E001.pdf", contentType: "application/pdf", base64: "JVBERi0=" });
    render(<MyPayslips />);
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download payslip for September 2026" }));
    await waitFor(() => expect(h.download).toHaveBeenCalledWith("PS-2026-09-E001.pdf", "application/pdf", "JVBERi0="));
    expect(h.fetchPayslip).toHaveBeenCalledWith({ runId: "r1" });
  });

  it("says when there is nothing yet, for payslips and Form 16", () => {
    h.payslips = { data: [], isLoading: false };
    render(<MyPayslips />);
    expect(screen.getByText(/appears here once the month's payroll is approved/i)).toBeInTheDocument();
    expect(screen.getByText(/Your Form 16 is not available yet/i)).toBeInTheDocument();
  });

  it("offers a released Form 16 with the working-copy label", async () => {
    h.years = { data: [{ financialYear: 2026, label: "2026-27", releasedAt: new Date() }], isLoading: false };
    h.fetchForm16.mockResolvedValue({ filename: "form16.pdf", contentType: "application/pdf", base64: "AAAA", label: "Working copy" });
    render(<MyPayslips />);
    expect(screen.getByText(/working copy prepared from your payslips for your employer's CA to review/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download Form 16 for 2026-27" }));
    await waitFor(() => expect(h.download).toHaveBeenCalledWith("form16.pdf", "application/pdf", "AAAA"));
    expect(h.fetchForm16).toHaveBeenCalledWith({ financialYear: 2026 });
  });

  it("shows a failure to download", async () => {
    h.fetchPayslip.mockRejectedValue(new Error("Payslip not found"));
    render(<MyPayslips />);
    fireEvent.click(screen.getByRole("button", { name: "Download payslip for September 2026" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not download the payslip", variant: "error" })));
  });
});

const LOAN = "11111111-1111-4111-8111-111111111111";
const ownLoan = (over: Record<string, unknown> = {}) => ({
  id: LOAN, number: "LN-0001", kind: "loan", status: "active", principal: "100000.00", interestRate: "12.00", emi: "8884.88", installmentCount: 12, issueDate: "2026-03-25", disbursedOn: "2026-03-26", purpose: "Medical",
  outstanding: "82230.24", recoveredPrincipal: "17769.76", recoveredInterest: "2000.00", nextInstalmentMonth: "2026-06", nextInstalmentAmount: "8884.88", remainingInstalments: 10, ...over,
});

describe("MyLoans (read only, my own)", () => {
  beforeEach(() => {
    h.statementAsked.mockReset();
    h.toast.mockReset();
    h.loans = { data: [ownLoan()], isLoading: false, error: null };
    h.statement = {
      data: {
        loan: ownLoan(),
        schedule: [
          { seq: 1, dueMonth: "2026-04", principal: "7884.88", interest: "1000.00", recovered: "8884.88", status: "paid" },
          { seq: 3, dueMonth: "2026-06", principal: "7963.73", interest: "921.15", recovered: "0.00", status: "open" },
        ],
        events: [
          { id: "e1", date: "2026-03-26", kind: "disbursed", description: "Paid to you", principal: "0.00", interest: "0.00", balanceAfter: "100000.00" },
          { id: "e2", date: "2026-04-01", kind: "emi_recovered", description: "Instalment recovered from your salary", principal: "7884.88", interest: "1000.00", balanceAfter: "92115.12" },
        ],
      },
      isLoading: false,
      error: null,
    };
  });

  it("shows my loan with the status, amount, balance, EMI, the next instalment and the instalments left, and no action but the statement", () => {
    render(<MyLoans />);
    expect(screen.getByRole("heading", { name: "Loans and advances" })).toBeInTheDocument();
    expect(screen.getByText("Loan LN-0001")).toBeInTheDocument();
    expect(screen.getByText(/Being repaid, Medical/)).toBeInTheDocument();
    expect(screen.getByText("₹1,00,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹82,230.24")).toBeInTheDocument();
    expect(screen.getAllByText("₹8,884.88").length).toBeGreaterThan(0);
    expect(screen.getByTestId("next-LN-0001")).toHaveTextContent("Next instalment: ₹8,884.88 from your June 2026 salary.");
    expect(screen.getByText("Instalments left").nextSibling).toHaveTextContent("10");
    // Read only: the only control is the statement toggle.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(h.statementAsked).not.toHaveBeenCalled(); // the statement is fetched only when opened
  });

  it("opens the statement: the schedule in force and what was paid out and recovered", () => {
    render(<MyLoans />);
    fireEvent.click(screen.getByRole("button", { name: "Show statement for LN-0001" }));
    expect(h.statementAsked).toHaveBeenCalledWith({ id: LOAN });
    const schedule = screen.getByRole("table", { name: "Repayment schedule" });
    expect(within(schedule).getByText("April 2026")).toBeInTheDocument();
    expect(within(schedule).getByText("To come")).toBeInTheDocument();
    const statement = screen.getByRole("table", { name: "Loan statement" });
    expect(within(statement).getByText("Paid to you")).toBeInTheDocument();
    expect(within(statement).getByText("Instalment recovered from your salary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide statement for LN-0001" }));
    expect(screen.queryByTestId("loan-statement")).not.toBeInTheDocument();
  });

  it("an approved loan that is not paid out yet says so and shows no instalments", () => {
    h.loans = { data: [ownLoan({ status: "approved", outstanding: "0.00", nextInstalmentMonth: null, nextInstalmentAmount: null, remainingInstalments: 0 })], isLoading: false, error: null };
    render(<MyLoans />);
    expect(screen.getByText(/Approved, not paid out yet/)).toBeInTheDocument();
    expect(screen.getByText(/will start once it has been paid out to you/)).toBeInTheDocument();
    expect(screen.queryByTestId("next-LN-0001")).not.toBeInTheDocument();
  });

  it("shows nothing at all for an employee without loans, while loading, and never an error toast before the data is there", () => {
    h.loans = { data: [], isLoading: false, error: null };
    const { container, rerender } = render(<MyLoans />);
    expect(container).toBeEmptyDOMElement();
    h.loans = { data: undefined as never, isLoading: true, error: null };
    rerender(<MyLoans />);
    expect(container).toBeEmptyDOMElement();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("says plainly when the loans or a statement cannot be loaded", () => {
    h.loans = { data: undefined as never, isLoading: false, error: new Error("boom") };
    const { rerender } = render(<MyLoans />);
    expect(screen.getByText(/Could not load your loans/)).toBeInTheDocument();
    h.loans = { data: [ownLoan()], isLoading: false, error: null };
    h.statement = { data: undefined, isLoading: false, error: new Error("not found") };
    rerender(<MyLoans />);
    fireEvent.click(screen.getByRole("button", { name: "Show statement for LN-0001" }));
    expect(screen.getByText(/Could not load this statement/)).toBeInTheDocument();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("appears under the payslips", () => {
    render(<MyPayslips />);
    expect(screen.getByRole("region", { name: "My loans and advances" })).toBeInTheDocument();
  });
});

describe("MyLeave", () => {
  beforeEach(() => {
    for (const f of [h.apply, h.cancel, h.invalidate, h.toast]) f.mockReset();
    h.leave = {
      data: {
        leaveYear: 2026,
        types: [{ id: TYPE, code: "CL", name: "Casual leave", isPaid: true, balance: 11 }],
        applications: [
          { id: "a1", leaveTypeId: TYPE, leaveName: "Casual leave", fromDate: "2026-11-02", toDate: "2026-11-02", days: "1.00", status: "pending", decisionNote: null },
          { id: "a2", leaveTypeId: TYPE, leaveName: "Casual leave", fromDate: "2026-10-12", toDate: "2026-10-12", days: "1.00", status: "approved", decisionNote: "Enjoy" },
        ],
      },
      isLoading: false,
    };
  });

  it("shows balances and applications; only a pending one can be cancelled", () => {
    render(<MyLeave />);
    expect(screen.getByLabelText("Balances")).toHaveTextContent("11");
    const buttons = screen.getAllByRole("button", { name: "Cancel" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(h.cancel).toHaveBeenCalledWith({ id: "a1" });
    expect(screen.getByText(/Enjoy/)).toBeInTheDocument();
  });

  it("applies for leave, checking the form first", async () => {
    render(<MyLeave />);
    fireEvent.click(screen.getByRole("button", { name: "Apply for leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the leave type.");
    expect(h.apply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("combobox", { name: /Leave type/ }));
    await userEvent.click(screen.getByRole("option", { name: /Casual leave/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(h.apply).toHaveBeenCalledWith(expect.objectContaining({ leaveTypeId: TYPE, halfDayStart: false, halfDayEnd: false }));
    expect(h.apply.mock.calls[0]![0]).not.toHaveProperty("employeeId"); // the employee is never sent
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Leave request sent to HR" }));
  });
});
