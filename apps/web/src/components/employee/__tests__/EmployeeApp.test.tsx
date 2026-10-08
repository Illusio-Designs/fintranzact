import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  places: { data: undefined as unknown, isLoading: false },
  orgs: [{ tenantId: "t1", tenantName: "People Co" }] as unknown[],
  logout: vi.fn(),
  select: vi.fn(),
  setBusinessId: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  setBusinessId: h.setBusinessId,
  queryClient: { clear: vi.fn(), invalidateQueries: vi.fn() },
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: vi.fn() } } }),
    payrollSelf: { workplaces: { useQuery: () => h.places } },
    tenant: { list: { useQuery: () => ({ data: h.orgs }) }, select: { useMutation: () => ({ mutate: h.select }) } },
    auth: { logout: { useMutation: () => ({ mutate: h.logout, isPending: false }) } },
  },
}));
vi.mock("@/lib/desktop-session", () => ({ clearDesktopToken: vi.fn(async () => undefined) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("../CheckInPanel", () => ({ CheckInPanel: () => <div data-testid="panel-home" /> }));
vi.mock("../MyAttendance", () => ({ MyAttendance: () => <div data-testid="panel-attendance" /> }));
vi.mock("../MyPayslips", () => ({ MyPayslips: () => <div data-testid="panel-payslips" /> }));
vi.mock("../MyLeave", () => ({ MyLeave: () => <div data-testid="panel-leave" /> }));

import { EmployeeApp } from "../EmployeeApp";

const place = (over: Record<string, unknown> = {}) => ({ businessId: "b1", businessName: "People Co", employeeName: "Asha Verma", ...over });

describe("EmployeeApp (the restricted shell)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    for (const f of [h.logout, h.select, h.setBusinessId, h.navigate]) f.mockReset();
    h.places = { data: [place()], isLoading: false };
    h.orgs = [{ tenantId: "t1", tenantName: "People Co" }];
  });

  it("shows only the four employee sections and no accounting navigation", () => {
    render(<EmployeeApp tenantName="People Co" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Check in", "Attendance", "Payslips and Form 16", "Leave"]);
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByTestId("panel-home")).toBeInTheDocument();
    for (const word of [/invoices/i, /parties/i, /payroll/i, /settings/i, /reports/i, /dashboard/i, /assistant/i]) {
      expect(screen.queryByRole("link", { name: word })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("opens each section from its tab", () => {
    render(<EmployeeApp tenantName="People Co" />);
    fireEvent.click(screen.getByRole("tab", { name: "Attendance" }));
    expect(screen.getByTestId("panel-attendance")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Payslips and Form 16" }));
    expect(screen.getByTestId("panel-payslips")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Leave" }));
    expect(screen.getByTestId("panel-leave")).toBeInTheDocument();
  });

  it("sends the employee's business with every call, and remembers a choice among several", () => {
    h.places = { data: [place(), place({ businessId: "b2", businessName: "Second Shop" })], isLoading: false };
    render(<EmployeeApp tenantName="People Co" />);
    expect(h.setBusinessId).toHaveBeenLastCalledWith("b1");
    fireEvent.change(screen.getByLabelText("Business"), { target: { value: "b2" } });
    expect(h.setBusinessId).toHaveBeenLastCalledWith("b2");
    expect(sessionStorage.getItem("selectedBusinessId")).toBe("b2");
  });

  it("explains when the login is not linked to an employee record", () => {
    h.places = { data: [], isLoading: false };
    render(<EmployeeApp tenantName="People Co" />);
    expect(screen.getByTestId("employee-unlinked")).toHaveTextContent("not linked to an employee record");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("offers an organisation switch only to someone in several, and signs out", () => {
    render(<EmployeeApp tenantName="People Co" />);
    expect(screen.queryByLabelText("Organisation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(h.logout).toHaveBeenCalled();
  });

  it("switches organisation for someone who belongs to several", () => {
    h.orgs = [{ tenantId: "t1", tenantName: "People Co" }, { tenantId: "t2", tenantName: "My Own Books" }];
    render(<EmployeeApp tenantName="People Co" />);
    fireEvent.change(screen.getByLabelText("Organisation"), { target: { value: "t2" } });
    expect(h.select).toHaveBeenCalledWith({ tenantId: "t2" });
  });
});
