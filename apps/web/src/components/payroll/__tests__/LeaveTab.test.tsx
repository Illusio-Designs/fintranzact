import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const EMP = "55555555-5555-4555-8555-555555555555";
const CL = "99999999-9999-4999-8999-999999999999";
const EL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const h = vi.hoisted(() => ({
  decide: vi.fn(),
  cancel: vi.fn(),
  request: vi.fn(),
  accrue: vi.fn(),
  closeYear: vi.fn(),
  encash: vi.fn(),
  seed: vi.fn(),
  invalidate: vi.fn(),
  apps: { data: [] as unknown[] },
  balances: { data: undefined as unknown },
  types: { data: [] as unknown[] },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollLeave: { applications: { invalidate: h.invalidate }, balances: { invalidate: h.invalidate }, typeList: { invalidate: h.invalidate } },
      payrollAttendance: { month: { invalidate: h.invalidate } },
    }),
    payrollEmployee: { list: { useQuery: () => ({ data: { data: [{ id: EMP, name: "Asha Verma", employeeCode: "E001" }] } }) } },
    payrollLeave: {
      applications: { useQuery: () => ({ data: h.apps.data }) },
      balances: { useQuery: () => ({ data: h.balances.data }) },
      typeList: { useQuery: () => ({ data: h.types.data }) },
      decide: { useMutation: () => ({ mutate: h.decide, isPending: false }) },
      cancel: { useMutation: () => ({ mutate: h.cancel, isPending: false }) },
      request: { useMutation: () => ({ mutate: h.request, isPending: false }) },
      accrue: { useMutation: () => ({ mutate: h.accrue, isPending: false }) },
      closeYear: { useMutation: () => ({ mutate: h.closeYear, isPending: false }) },
      encash: { useMutation: () => ({ mutate: h.encash, isPending: false }) },
      typeSeedDefaults: { useMutation: () => ({ mutate: h.seed, isPending: false }) },
      typeCreate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: vi.fn() }));

import { LeaveTab } from "../LeaveTab";

const app = (over: Record<string, unknown> = {}) => ({
  id: "ap1", employeeId: EMP, employeeName: "Asha Verma", employeeCode: "E001", leaveCode: "EL", leaveName: "Earned leave", fromDate: "2026-07-06", toDate: "2026-07-08",
  days: "3.00", paidDays: "0.00", lopDays: "0.00", status: "pending", ...over,
});

describe("LeaveTab", () => {
  beforeEach(() => {
    for (const f of [h.decide, h.cancel, h.request, h.accrue, h.closeYear, h.encash, h.seed, h.invalidate]) f.mockReset();
    h.apps.data = [app()];
    h.types.data = [
      { id: CL, code: "CL", name: "Casual leave", isPaid: true, isActive: true, encashable: false, accrualType: "annual", accrualDays: "12.00", carryForward: false, carryForwardMax: "0.00" },
      { id: EL, code: "EL", name: "Earned leave", isPaid: true, isActive: true, encashable: true, accrualType: "monthly", accrualDays: "1.50", carryForward: true, carryForwardMax: "30.00" },
    ];
    h.balances.data = {
      leaveYear: 2026, yearStart: "2026-04-01",
      types: [{ id: CL, code: "CL", name: "Casual leave", isPaid: true }, { id: EL, code: "EL", name: "Earned leave", isPaid: true }],
      employees: [{ id: EMP, employeeCode: "E001", name: "Asha Verma", balances: { [CL]: 12, [EL]: 1.5 } }],
    };
  });

  it("approves and rejects a pending application", () => {
    render(<LeaveTab />);
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(h.decide).toHaveBeenLastCalledWith({ id: "ap1", decision: "approve" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(h.decide).toHaveBeenLastCalledWith({ id: "ap1", decision: "reject" });
  });

  it("shows loss of pay on an approved application and offers cancel", () => {
    h.apps.data = [app({ status: "approved", paidDays: "1.50", lopDays: "1.50" })];
    render(<LeaveTab />);
    expect(screen.getByText("1.5 LOP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.cancel).toHaveBeenCalledWith({ id: "ap1" });
  });

  it("records an application only with an employee and a leave type", () => {
    render(<LeaveTab />);
    fireEvent.click(screen.getByRole("button", { name: "+ Leave application" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    expect(h.request).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose the employee and the leave type.");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Employee/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Asha Verma (E001)" }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Leave type/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Casual leave (CL)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    expect(h.request).toHaveBeenCalledWith(expect.objectContaining({ employeeId: EMP, leaveTypeId: CL }));
  });

  it("shows balances per paid leave type, grants a month's leave and closes the year after confirming", () => {
    render(<LeaveTab />);
    fireEvent.click(screen.getByRole("button", { name: "Balances" }));
    const row = screen.getByRole("row", { name: /Asha Verma/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(expect.arrayContaining(["12", "1.5"]));
    fireEvent.click(screen.getByRole("button", { name: "Grant this month's leave" }));
    expect(h.accrue).toHaveBeenCalledWith({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
    fireEvent.click(screen.getByRole("button", { name: "Close leave year" }));
    expect(h.closeYear).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close the year" }));
    expect(h.closeYear).toHaveBeenCalledWith({ leaveYear: 2026 });
  });

  it("encashment is offered only for encashable types and needs days and an amount", () => {
    render(<LeaveTab />);
    fireEvent.click(screen.getByRole("button", { name: "Balances" }));
    fireEvent.click(screen.getByRole("button", { name: "Encash" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Leave type/ }));
    expect(screen.queryByRole("option", { name: "Casual leave (CL)" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: "Earned leave (EL)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Encash" }));
    expect(h.encash).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Days/), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText(/Amount to pay/), { target: { value: "1200" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Encash" }));
    expect(h.encash).toHaveBeenCalledWith({ employeeId: EMP, leaveTypeId: EL, days: 1, amount: 1200 });
  });

  it("lists leave types with their rules and offers the standard set", () => {
    render(<LeaveTab />);
    fireEvent.click(screen.getByRole("button", { name: "Leave types" }));
    expect(screen.getByText("12 per year")).toBeInTheDocument();
    expect(screen.getByText("1.5 per month")).toBeInTheDocument();
    expect(screen.getByText("Up to 30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add CL, SL, EL and LOP" }));
    expect(h.seed).toHaveBeenCalledTimes(1);
  });
});
