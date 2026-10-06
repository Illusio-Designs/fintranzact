import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const EMP = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  mark: vi.fn(),
  bulk: vi.fn(),
  holidayCreate: vi.fn(),
  invalidate: vi.fn(),
  month: { data: undefined as unknown },
  asked: [] as string[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollAttendance: { month: { invalidate: h.invalidate }, holidayList: { invalidate: h.invalidate }, settings: { invalidate: h.invalidate } }, payrollEmployee: { shiftList: { invalidate: h.invalidate } } }),
    payrollAttendance: {
      month: { useQuery: (i: { month: string }) => { h.asked.push(i.month); return { data: h.month.data, isLoading: !h.month.data }; } },
      mark: { useMutation: (o?: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.mark(v); o?.onSuccess?.(); }, isPending: false }) },
      bulkMark: { useMutation: () => ({ mutate: h.bulk, isPending: false }) },
      holidayList: { useQuery: () => ({ data: [{ id: "h1", date: "2026-08-15", name: "Independence Day", scope: "national", stateCode: null, branch: null }] }) },
      holidayCreate: { useMutation: () => ({ mutate: h.holidayCreate, isPending: false }) },
      holidayDelete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      holidayCopyYear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      settings: { useQuery: () => ({ data: { defaultWeeklyOffDays: [0], standardHoursPerDay: 8, overtimeMultiplier: 2, leaveYearStartMonth: 4 } }) },
      updateSettings: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    payrollLeave: { typeList: { useQuery: () => ({ data: [{ id: "t1", code: "CL", name: "Casual leave", isPaid: true, isActive: true }] }) } },
    payrollEmployee: { shiftList: { useQuery: () => ({ data: [] }) }, shiftCreate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: vi.fn() }));
vi.mock("../payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-ui")>();
  return { ...actual, currentMonth: () => "2026-08" };
});

import { AttendanceTab } from "../AttendanceTab";

function monthData(over: Record<string, unknown> = {}) {
  const dates = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);
  return {
    month: "2026-08",
    dates,
    holidays: [],
    run: null,
    locked: false,
    employees: [
      {
        id: EMP, employeeCode: "E001", name: "Asha Verma", dateOfJoining: "2026-04-01", lastWorkingDay: null, weeklyOffDays: [0], holidayDates: ["2026-08-15"],
        days: { "2026-08-03": { status: "present", leaveTypeId: null, checkIn: null, checkOut: null, overtimeHours: 0, note: null, source: "manual" }, "2026-08-04": { status: "absent", leaveTypeId: null, checkIn: null, checkOut: null, overtimeHours: 0, note: null, source: "manual" } },
        summary: { paidDays: 29, lopDays: 2 },
      },
      {
        id: "66666666-6666-4666-8666-666666666666", employeeCode: "E002", name: "Ravi Nair", dateOfJoining: "2026-08-16", lastWorkingDay: null, weeklyOffDays: [0], holidayDates: [],
        days: {}, summary: { paidDays: 16, lopDays: 0 },
      },
    ],
    ...over,
  };
}

describe("AttendanceTab", () => {
  beforeEach(() => {
    for (const f of [h.mark, h.bulk, h.holidayCreate, h.invalidate]) f.mockReset();
    h.asked.length = 0;
    h.month.data = monthData();
  });

  it("shows the month with each employee's days, paid days and loss of pay", () => {
    render(<AttendanceTab />);
    expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asha Verma, 03 Aug 2026: Present/ })).toHaveTextContent("P");
    expect(screen.getByRole("button", { name: /Asha Verma, 04 Aug 2026: Absent/ })).toHaveTextContent("A");
    // Calendar days need no marking: a Sunday is a weekly off, 15 August a holiday.
    expect(screen.getByRole("button", { name: /Asha Verma, 02 Aug 2026: Week off/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asha Verma, 15 Aug 2026: Holiday/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asha Verma, 05 Aug 2026: not marked/ })).toBeInTheDocument();
    const cells = within(screen.getByRole("row", { name: /Asha Verma/ })).getAllByRole("cell");
    expect(cells.at(-2)).toHaveTextContent("29"); // paid days
    expect(cells.at(-1)).toHaveTextContent("2"); // loss of pay
    expect(cells.at(-1)).toHaveClass("text-red-600");
  });

  it("days before joining are not part of the month", () => {
    render(<AttendanceTab />);
    expect(screen.queryByRole("button", { name: /Ravi Nair, 10 Aug 2026/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ravi Nair, 17 Aug 2026/ })).toBeInTheDocument();
  });

  it("marks a day through the dialog", () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByRole("button", { name: /Asha Verma, 05 Aug 2026/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Half day"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(h.mark).toHaveBeenCalledWith(expect.objectContaining({ employeeId: EMP, date: "2026-08-05", status: "half_day" }));
  });

  it("a leave day needs a leave type before it can be saved", () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByRole("button", { name: /Asha Verma, 05 Aug 2026/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("On leave"));
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("marks everyone present for the month in one click", () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByRole("button", { name: "Mark everyone present" }));
    expect(h.bulk).toHaveBeenCalledTimes(1);
    const arg = h.bulk.mock.calls[0]![0] as { employeeIds: string[]; dates: string[]; status: string };
    expect(arg.employeeIds).toHaveLength(2);
    expect(arg.dates).toHaveLength(31);
    expect(arg.status).toBe("present");
  });

  it("when the payroll run has locked the month, nothing can be changed", () => {
    h.month.data = monthData({ locked: true, run: { id: "r1", status: "calculated" } });
    render(<AttendanceTab />);
    expect(screen.getByRole("status")).toHaveTextContent(/locked by its payroll run/);
    expect(screen.getByRole("button", { name: "Mark everyone present" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bulk mark" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Asha Verma, 03 Aug 2026/ })).toBeDisabled();
  });

  it("moves between months", () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(h.asked.at(-1)).toBe("2026-09");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(h.asked.at(-1)).toBe("2026-07");
  });

  it("the holiday calendar lists holidays and validates a new one", () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByRole("button", { name: "Holiday calendar" }));
    expect(screen.getByText("Independence Day")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add holiday" }));
    expect(h.holidayCreate).not.toHaveBeenCalled(); // no name yet
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Diwali" } });
    fireEvent.click(screen.getByRole("button", { name: "Add holiday" }));
    expect(h.holidayCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Diwali", scope: "national" }));
  });

  it("a state holiday needs a state", () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByRole("button", { name: "Holiday calendar" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Local day" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Applies to" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "One state" }));
    fireEvent.click(screen.getByRole("button", { name: "Add holiday" }));
    expect(h.holidayCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose the state/);
  });
});
