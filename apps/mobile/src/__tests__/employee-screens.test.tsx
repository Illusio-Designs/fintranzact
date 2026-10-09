/**
 * The other employee screens (leave, payslips and Form 16, attendance) and the restricted tab set an
 * employee login gets from the app layout.
 */
import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme as render } from "../test-utils";
import { useAuthStore } from "../stores/auth";
import { useBusinessStore } from "../stores/business";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
const mockShare = jest.fn(async () => undefined);
const mockWrite = jest.fn(async () => undefined);
jest.mock("expo-sharing", () => ({ shareAsync: (...a: unknown[]) => (mockShare as any)(...a) }));
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", EncodingType: { Base64: "base64" }, writeAsStringAsync: (...a: unknown[]) => (mockWrite as any)(...a) }));
jest.mock("@react-native-community/datetimepicker", () => "DateTimePicker");
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual("react-native-safe-area-context"),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// What the layout's Tabs.Screen entries look like.
const screens: Array<{ name: string; hidden: boolean }> = [];
jest.mock("expo-router", () => {
  const { View: V } = require("react-native");
  const Tabs = ({ children }: { children: React.ReactNode }) => <V>{children}</V>;
  Tabs.Screen = ({ name, options }: { name: string; options?: { href?: null } }) => {
    screens.push({ name, hidden: options?.href === null });
    return null;
  };
  return { Tabs, useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) };
});
jest.mock("../components/MaintenanceBanner", () => ({ MaintenanceBanner: () => null }));
jest.mock("../components/BillingBanner", () => ({ BillingBanner: () => null }));
jest.mock("../components/TwoFactorBanner", () => ({ TwoFactorBanner: () => null }));
jest.mock("../hooks/useTwoFactorRequirement", () => ({ useTwoFactorRequirement: () => ({ blocked: false }) }));
jest.mock("../lib/two-factor-enforcement", () => ({ openTwoFactorSetup: jest.fn() }));

const LEAVE_TYPE = "99999999-9999-4999-8999-999999999999";
const calls = { applyBusinessList: 0, ownBusinessList: 0, lowStock: 0 };
const mockApply = jest.fn();
const mockCancel = jest.fn();
const mockFetchSlip = jest.fn();
const state: { role: string; leave: any; slips: any[]; years: any[]; attendance: any; loans: any[]; loansError: boolean; statement: any; statementError: boolean } = { role: "employee", leave: null, slips: [], years: [], attendance: null, loans: [], loansError: false, statement: null, statementError: false };
const mockStatementAsked = jest.fn();
const q = (read: () => unknown, onUse?: (o?: { enabled?: boolean }) => void) => ({
  useQuery: (_i?: unknown, o?: { enabled?: boolean }) => {
    onUse?.(o);
    return { data: read(), isLoading: false, error: null, refetch: jest.fn() };
  },
});
jest.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollSelf: { leaveOverview: { invalidate: jest.fn() }, attendance: { invalidate: jest.fn() }, payslipPdf: { fetch: (...a: unknown[]) => (mockFetchSlip as any)(...a) }, form16Pdf: { fetch: jest.fn() } } }),
    auth: { me: q(() => ({ user: { id: "u1" }, tenantId: "t1", role: state.role })) },
    tenant: { list: q(() => [{ tenantId: "t1" }]), select: { useMutation: () => ({ mutate: jest.fn(), isPending: false }) } },
    business: {
      list: q(() => [{ id: "b-own", name: "Own Biz" }], (o) => { if (o?.enabled !== false) calls.ownBusinessList++; }),
      canCreate: q(() => false),
    },
    item: { lowStockCount: q(() => 0, (o) => { if (o?.enabled) calls.lowStock++; }) },
    payrollSelf: {
      workplaces: q(() => [{ businessId: "b1", businessName: "People Co", employeeName: "Asha Verma" }]),
      leaveOverview: q(() => state.leave),
      leaveApply: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { mockApply(v); o.onSuccess?.(); }, isPending: false }) },
      leaveCancel: { useMutation: () => ({ mutate: mockCancel, isPending: false }) },
      payslips: q(() => state.slips),
      form16Years: q(() => state.years),
      loans: { useQuery: () => ({ data: state.loansError ? undefined : state.loans, isLoading: false, error: state.loansError ? new Error("boom") : null, refetch: jest.fn() }) },
      loanStatement: { useQuery: (i: unknown) => { mockStatementAsked(i); return { data: state.statementError ? undefined : state.statement, isLoading: false, error: state.statementError ? new Error("nf") : null, refetch: jest.fn() }; } },
      attendance: q(() => state.attendance),
    },
  },
}));

import AppLayout from "../../app/(app)/_layout";
import { EmployeeLeave } from "../components/employee/EmployeeLeave";
import { EmployeePayslips } from "../components/employee/EmployeePayslips";
import { EmployeeAttendance } from "../components/employee/EmployeeAttendance";

beforeEach(() => {
  screens.length = 0;
  calls.applyBusinessList = 0;
  calls.ownBusinessList = 0;
  calls.lowStock = 0;
  for (const f of [mockApply, mockCancel, mockFetchSlip, mockShare, mockWrite]) f.mockClear();
  state.role = "employee";
  state.leave = {
    leaveYear: 2026,
    types: [{ id: LEAVE_TYPE, code: "CL", name: "Casual leave", isPaid: true, balance: 11 }],
    applications: [
      { id: "a1", leaveTypeId: LEAVE_TYPE, leaveName: "Casual leave", fromDate: "2026-11-02", toDate: "2026-11-02", days: "1.00", status: "pending", decisionNote: null },
      { id: "a2", leaveTypeId: LEAVE_TYPE, leaveName: "Casual leave", fromDate: "2026-10-12", toDate: "2026-10-12", days: "1.00", status: "approved", decisionNote: null },
    ],
  };
  state.slips = [{ runId: "r1", month: "2026-09", monthLabel: "September 2026", number: "PS-1", netPay: "42000.00", grossEarnings: "50000.00", paidDays: "30.00", lopDays: "0.00" }];
  state.years = [];
  useAuthStore.setState({ token: "tok", isHydrated: true });
  useBusinessStore.setState({ businessId: "b1", businessName: "People Co" });
});

describe("the app layout for an employee login", () => {
  it("shows only the four employee tabs and never loads the accounting lists", () => {
    render(<AppLayout />);
    const visible = screens.filter((s) => !s.hidden).map((s) => s.name);
    expect(visible).toEqual(["(me-home)", "(me-attendance)", "(me-payslips)", "(me-leave)"]);
    expect(screens.filter((s) => s.hidden).map((s) => s.name).sort()).toEqual(["(home)", "(invoices)", "(items)", "(more)", "(parties)", "(payments)", "create-business"].sort());
    expect(calls.ownBusinessList).toBe(0);
    expect(calls.lowStock).toBe(0);
  });

  it("shows the usual tabs, not the employee ones, to everyone else", () => {
    state.role = "owner";
    render(<AppLayout />);
    const visible = screens.filter((s) => !s.hidden).map((s) => s.name);
    expect(visible).toEqual(["(home)", "(invoices)", "(parties)", "(payments)", "(more)"]);
    expect(screens.filter((s) => s.hidden).map((s) => s.name)).toEqual(expect.arrayContaining(["(me-home)", "(me-attendance)", "(me-payslips)", "(me-leave)"]));
    expect(calls.ownBusinessList).toBeGreaterThan(0);
  });
});

describe("EmployeeLeave", () => {
  it("shows balances and applications, and cancels only a pending one", () => {
    render(<EmployeeLeave />);
    expect(screen.getByTestId("balance-CL").props.children).toBe(11);
    expect(screen.getAllByRole("button", { name: /Cancel leave on/ })).toHaveLength(1);
    fireEvent.press(screen.getByRole("button", { name: "Cancel leave on 2026-11-02" }));
    expect(mockCancel).toHaveBeenCalledWith({ id: "a1" });
  });

  it("applies for leave after choosing the type, without ever sending an employee id", () => {
    render(<EmployeeLeave />);
    fireEvent.press(screen.getByRole("button", { name: "Apply for leave" }));
    fireEvent.press(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText("Choose the leave type.")).toBeTruthy();
    expect(mockApply).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Leave type Casual leave" }));
    fireEvent.press(screen.getByRole("button", { name: "Send request" }));
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({ leaveTypeId: LEAVE_TYPE, halfDayStart: false, halfDayEnd: false }));
    expect(mockApply.mock.calls[0]![0]).not.toHaveProperty("employeeId");
  });
});

describe("EmployeePayslips", () => {
  it("opens a payslip through the share sheet", async () => {
    mockFetchSlip.mockResolvedValue({ filename: "PS-2026-09-E001.pdf", base64: "JVBERi0=" });
    render(<EmployeePayslips />);
    fireEvent.press(screen.getByRole("button", { name: "Open payslip for September 2026" }));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    expect(mockFetchSlip).toHaveBeenCalledWith({ runId: "r1" });
    expect(mockWrite).toHaveBeenCalledWith("file:///cache/PS-2026-09-E001.pdf", "JVBERi0=", { encoding: "base64" });
    expect(mockShare).toHaveBeenCalledWith("file:///cache/PS-2026-09-E001.pdf", expect.objectContaining({ mimeType: "application/pdf" }));
  });

  it("explains an empty list and an unreleased Form 16; labels a released one as a working copy", () => {
    state.slips = [];
    const { unmount } = render(<EmployeePayslips />);
    expect(screen.getByText(/appears here once the month's payroll is approved/)).toBeTruthy();
    expect(screen.getByText(/Your Form 16 is not available yet/)).toBeTruthy();
    unmount();
    state.years = [{ financialYear: 2026, label: "2026-27", releasedAt: new Date() }];
    render(<EmployeePayslips />);
    expect(screen.getByRole("button", { name: "Open Form 16 for 2026-27" })).toBeTruthy();
    expect(screen.getByText(/working copy prepared from your payslips/)).toBeTruthy();
  });
});

describe("EmployeeLoans (read only, my own, under the payslips)", () => {
  const LOAN = "11111111-1111-4111-8111-111111111111";
  const loan = (over: Record<string, unknown> = {}) => ({
    id: LOAN, number: "LN-0001", kind: "loan", status: "active", principal: "100000.00", interestRate: "12.00", emi: "8884.88", installmentCount: 12, issueDate: "2026-03-25", disbursedOn: "2026-03-26", purpose: "Medical",
    outstanding: "82230.24", recoveredPrincipal: "17769.76", recoveredInterest: "2000.00", nextInstalmentMonth: "2026-06", nextInstalmentAmount: "8884.88", remainingInstalments: 10, ...over,
  });
  beforeEach(() => {
    mockStatementAsked.mockReset();
    state.slips = [];
    state.years = [];
    state.loans = [loan()];
    state.loansError = false;
    state.statementError = false;
    state.statement = {
      loan: loan(),
      schedule: [{ seq: 1, dueMonth: "2026-04", principal: "7884.88", interest: "1000.00", recovered: "8884.88", status: "paid" }, { seq: 3, dueMonth: "2026-06", principal: "7963.73", interest: "921.15", recovered: "0.00", status: "open" }],
      events: [{ id: "e1", date: "2026-03-26", kind: "disbursed", description: "Paid to you", principal: "0.00", interest: "0.00", balanceAfter: "100000.00" }, { id: "e2", date: "2026-04-01", kind: "emi_recovered", description: "Instalment recovered from your salary", principal: "7884.88", interest: "1000.00", balanceAfter: "92115.12" }],
    };
  });

  it("shows my loan: status, amount, balance, EMI, the next instalment and the instalments left", () => {
    render(<EmployeePayslips />);
    expect(screen.getByText("Loans and advances")).toBeTruthy();
    expect(screen.getByText("Loan LN-0001")).toBeTruthy();
    expect(screen.getByText("Being repaid, Medical")).toBeTruthy();
    expect(screen.getByText("Still to repay")).toBeTruthy();
    expect(screen.getByText(/Next instalment: .*8,884\.88 from your June 2026 salary\./)).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(mockStatementAsked).not.toHaveBeenCalled();
  });

  it("opens the statement: the schedule in force and what was paid out and recovered", () => {
    render(<EmployeePayslips />);
    fireEvent.press(screen.getByRole("button", { name: "Show statement for LN-0001" }));
    expect(mockStatementAsked).toHaveBeenCalledWith({ id: LOAN });
    expect(screen.getByText("Repayment schedule")).toBeTruthy();
    expect(screen.getByText("Paid to you")).toBeTruthy();
    expect(screen.getByText("Instalment recovered from your salary")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Hide statement for LN-0001" }));
    expect(screen.queryByText("Paid to you")).toBeNull();
  });

  it("an approved loan that is not paid out yet says so", () => {
    state.loans = [loan({ status: "approved", outstanding: "0.00", nextInstalmentMonth: null, nextInstalmentAmount: null, remainingInstalments: 0 })];
    render(<EmployeePayslips />);
    expect(screen.getByText("Approved, not paid out yet, Medical")).toBeTruthy();
    expect(screen.getByText(/will start once it has been paid out to you/)).toBeTruthy();
  });

  it("shows no loans section for an employee without loans, and says plainly when loading fails", () => {
    state.loans = [];
    const { unmount } = render(<EmployeePayslips />);
    expect(screen.queryByText("Loans and advances")).toBeNull();
    unmount();
    state.loansError = true;
    render(<EmployeePayslips />);
    expect(screen.getByText(/Could not load your loans/)).toBeTruthy();
  });
});

describe("EmployeeAttendance", () => {
  it("shows the month summary, the days' times and my punches", () => {
    state.attendance = {
      month: "2026-10",
      days: [
        { date: "2026-10-05", employed: true, weekOff: false, holiday: null, status: "present", checkIn: "09:02", checkOut: "18:05" },
        { date: "2026-10-04", employed: true, weekOff: true, holiday: null, status: null, checkIn: null, checkOut: null },
      ],
      punches: [{ id: "p1", kind: "in", date: "2026-10-05", time: "09:02", flags: ["late"], review: null }],
      summary: { present: 1, halfDay: 0, absent: 0, leave: 0 },
    };
    render(<EmployeeAttendance now={new Date("2026-10-08T05:00:00Z")} />);
    expect(screen.getByText("October 2026")).toBeTruthy();
    expect(screen.getByTestId("attendance-summary").props.children.join("")).toContain("Present 1");
    expect(screen.getByText("09:02-18:05")).toBeTruthy();
    expect(screen.getByText("Week off")).toBeTruthy();
    expect(screen.getByText("Late")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next month" }).props.accessibilityState?.disabled ?? true).toBeTruthy();
  });
});
