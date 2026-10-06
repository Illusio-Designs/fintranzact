import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  exit: vi.fn(),
  reactivate: vi.fn(),
  invalidate: vi.fn(),
  list: { data: undefined as unknown },
  capacity: { data: { active: 2, cap: null as number | null } },
  detail: { data: undefined as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollEmployee: { list: { invalidate: h.invalidate }, capacity: { invalidate: h.invalidate } },
      payrollSalary: { overview: { invalidate: h.invalidate } },
    }),
    payrollEmployee: {
      list: { useQuery: () => ({ data: h.list.data, isLoading: !h.list.data }) },
      capacity: { useQuery: () => ({ data: h.capacity.data }) },
      get: { useQuery: (_i: unknown, o?: { enabled?: boolean }) => ({ data: o?.enabled === false ? undefined : h.detail.data }) },
      departmentList: { useQuery: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Operations", isActive: true }] }) },
      designationList: { useQuery: () => ({ data: [{ id: "22222222-2222-4222-8222-222222222222", name: "Executive", isActive: true }] }) },
      shiftList: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: h.create, isPending: false }) },
      update: { useMutation: () => ({ mutate: h.update, isPending: false }) },
      exit: { useMutation: () => ({ mutate: h.exit, isPending: false }) },
      reactivate: { useMutation: () => ({ mutate: h.reactivate, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: vi.fn() }));

import { EmployeesTab } from "../EmployeesTab";

const row = (over: Record<string, unknown> = {}) => ({
  id: "e1", employeeCode: "E001", name: "Asha Verma", department: "Operations", designation: "Executive", departmentId: "11111111-1111-4111-8111-111111111111", designationId: "22222222-2222-4222-8222-222222222222", branch: null,
  employmentType: "permanent", status: "active", dateOfJoining: "2026-04-01", lastWorkingDay: null, phone: null, email: null,
  panMasked: "XXXXXX234F", uanMasked: null, bankAccountMasked: "XXXXXXXXXX6789", hasBankDetails: true, ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  id: "e1", employeeCode: "E001", name: "Asha Verma", dateOfBirth: null, gender: null, fatherOrSpouseName: null, address: null, phone: "9876543210", email: "asha@example.in",
  photoDataUrl: null, dateOfJoining: "2026-04-01", departmentId: "11111111-1111-4111-8111-111111111111", designationId: "22222222-2222-4222-8222-222222222222", branch: "Mumbai", workState: "27", managerId: null, shiftId: null,
  employmentType: "permanent", taxRegime: "new", bankAccountName: "ASHA VERMA", bankName: "HDFC", status: "active", lastWorkingDay: null, exitReason: null, exitNote: null,
  fnfNote: null, fnfPayrollRunId: null, pan: "ABCDE1234F", aadhaar: "234567890123", uan: null, esicNumber: null, bankAccountNumber: "50100123456789", bankIfsc: "HDFC0001234",
  panMasked: "XXXXXX234F", aadhaarMasked: "XXXXXXXX0123", uanMasked: null, esicMasked: null, bankAccountMasked: "XXXXXXXXXX6789", sensitiveIncluded: true, ...over,
});

describe("EmployeesTab", () => {
  beforeEach(() => {
    for (const f of [h.create, h.update, h.exit, h.reactivate, h.invalidate]) f.mockReset();
    h.list.data = { data: [row(), row({ id: "e2", employeeCode: "E002", name: "Ravi Nair", panMasked: null, hasBankDetails: false, bankAccountMasked: null })], total: 2, page: 1, limit: 200 };
    h.capacity.data = { active: 2, cap: null };
    h.detail.data = detail();
  });

  it("lists employees with masked numbers only and flags missing bank details", () => {
    render(<EmployeesTab />);
    expect(screen.getByText("XXXXXX234F")).toBeInTheDocument();
    expect(screen.getByText("XXXXXXXXXX6789")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("ABCDE1234F");
    expect(document.body.textContent).not.toContain("50100123456789");
  });

  it("shows the trial cap and stops adding at the cap", () => {
    h.capacity.data = { active: 10, cap: 10 };
    render(<EmployeesTab />);
    expect(screen.getByTestId("trial-employee-cap")).toHaveTextContent("Full Access Trial: 10 of 10 employees");
    expect(screen.getByRole("button", { name: "+ Add employee" })).toBeDisabled();
  });

  it("does not offer the cap line outside a trial", () => {
    render(<EmployeesTab />);
    expect(screen.queryByTestId("trial-employee-cap")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add employee" })).toBeEnabled();
  });

  it("checks formats before saving: a bad PAN, Aadhaar, IFSC and mobile are refused with messages", () => {
    render(<EmployeesTab />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add employee" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Employee code/), { target: { value: "E010" } });
    fireEvent.change(within(dialog).getByLabelText(/Full name/), { target: { value: "New Person" } });
    fireEvent.change(within(dialog).getByLabelText("PAN"), { target: { value: "ABCDE12345" } });
    fireEvent.change(within(dialog).getByLabelText("Aadhaar number"), { target: { value: "1234" } });
    fireEvent.change(within(dialog).getByLabelText("IFSC"), { target: { value: "HDFC1001234" } });
    fireEvent.change(within(dialog).getByLabelText("Mobile number"), { target: { value: "12345" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(h.create).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("PAN")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByLabelText("Aadhaar number")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByLabelText("IFSC")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
    expect(dialog.textContent).toContain("PAN must look like AAAAA9999A.");
    expect(dialog.textContent).toContain("Aadhaar must be 12 digits.");
  });

  it("saves a valid employee with normalised identity numbers", () => {
    render(<EmployeesTab />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add employee" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Employee code/), { target: { value: "E010" } });
    fireEvent.change(within(dialog).getByLabelText(/Full name/), { target: { value: "New Person" } });
    fireEvent.change(within(dialog).getByLabelText("PAN"), { target: { value: "abcde1234f" } });
    fireEvent.change(within(dialog).getByLabelText("IFSC"), { target: { value: "hdfc0001234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0]![0]).toMatchObject({ employeeCode: "E010", name: "New Person", pan: "ABCDE1234F", bankIfsc: "HDFC0001234", employmentType: "permanent", taxRegime: "new" });
  });

  it("an owner sees the full numbers in the employee form", () => {
    render(<EmployeesTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("PAN")).toHaveValue("ABCDE1234F");
    expect(within(dialog).getByLabelText("Account number")).toHaveValue("50100123456789");
  });

  it("an accountant sees only masked hints and a blank number keeps what is stored", () => {
    h.detail.data = detail({ pan: null, aadhaar: null, uan: null, esicNumber: null, bankAccountNumber: null, bankIfsc: null, sensitiveIncluded: false });
    render(<EmployeesTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("PAN")).toHaveValue("");
    expect(within(dialog).getByLabelText("PAN")).toHaveAttribute("placeholder", "Current: XXXXXX234F");
    expect(dialog.textContent).toContain("Only an owner or admin sees them in full");
    fireEvent.change(within(dialog).getByLabelText(/Full name/), { target: { value: "Asha V" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(h.update).toHaveBeenCalledTimes(1);
    const sent = h.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: "e1", name: "Asha V" });
    for (const k of ["pan", "aadhaar", "uan", "esicNumber", "bankAccountNumber", "bankIfsc"]) expect(sent).not.toHaveProperty(k);
  });

  it("records an exit with a last working day and reason", () => {
    render(<EmployeesTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "Exit" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("full and final settlement");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as left" }));
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit.mock.calls[0]![0]).toMatchObject({ id: "e1", reason: "resignation" });
  });

  it("an employee who left can be reactivated", () => {
    h.list.data = { data: [row({ status: "exited", lastWorkingDay: "2026-08-20" })], total: 1, page: 1, limit: 200 };
    render(<EmployeesTab />);
    expect(screen.getByText(/Left 20 Aug 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    expect(h.reactivate).toHaveBeenCalledWith({ id: "e1" });
  });

  it("explains an empty list", () => {
    h.list.data = { data: [], total: 0, page: 1, limit: 200 };
    render(<EmployeesTab />);
    expect(screen.getByText("No employees yet")).toBeInTheDocument();
  });
});
