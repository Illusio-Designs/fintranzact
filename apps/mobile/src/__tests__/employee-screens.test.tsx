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
const state: { role: string; leave: any; slips: any[]; years: any[]; attendance: any } = { role: "employee", leave: null, slips: [], years: [], attendance: null };
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
