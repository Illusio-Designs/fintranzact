import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const TYPE = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  attendance: { data: undefined as unknown, isLoading: false },
  payslips: { data: [] as unknown[], isLoading: false },
  years: { data: [] as unknown[], isLoading: false },
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
