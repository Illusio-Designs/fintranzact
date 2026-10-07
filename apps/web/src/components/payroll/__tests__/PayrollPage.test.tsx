import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { statusData, onSale } = vi.hoisted(() => ({
  statusData: { current: undefined as unknown },
  onSale: { current: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { billing: { status: { useQuery: () => ({ data: statusData.current, isLoading: statusData.current === undefined }) } } },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, ...rest }: { children: React.ReactNode; to: string; search?: { tab?: string } }) => (
    <a href={search?.tab ? `${to}?tab=${search.tab}` : to} {...rest}>{children}</a>
  ),
}));
// The add-on is on sale only when a test says so (ADDON_FEATURES.payroll.implemented is false until release).
vi.mock("@fintranzact/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fintranzact/shared")>();
  return { ...actual, availableAddonIds: () => (onSale.current ? ["payroll"] : []) };
});
vi.mock("../EmployeesTab", () => ({ EmployeesTab: () => <div data-testid="tab-employees" /> }));
vi.mock("../SalaryTab", () => ({ SalaryTab: () => <div data-testid="tab-salary" /> }));
vi.mock("../AttendanceTab", () => ({ AttendanceTab: () => <div data-testid="tab-attendance" /> }));
vi.mock("../LeaveTab", () => ({ LeaveTab: () => <div data-testid="tab-leave" /> }));
vi.mock("../RunsTab", () => ({ RunsTab: () => <div data-testid="tab-runs" /> }));
vi.mock("../StatutoryTab", () => ({ StatutoryTab: () => <div data-testid="tab-statutory" /> }));
vi.mock("../DuesTab", () => ({ DuesTab: () => <div data-testid="tab-dues" /> }));
vi.mock("../FilingsTab", () => ({ FilingsTab: () => <div data-testid="tab-filings" /> }));

import { PayrollPage } from "../PayrollPage";

const status = (over: Record<string, unknown> = {}) => ({
  state: "active", readOnly: false, reason: null, canManageBilling: true, plan: "growth",
  addons: { ai_assistant: false, ai_plus: false, payroll: false, store_pro: false },
  trial: { active: false, caps: null },
  ...over,
});

describe("PayrollPage", () => {
  beforeEach(() => {
    statusData.current = undefined;
    onSale.current = false;
  });

  it("without the add-on shows the notice, no tabs and no purchase button while it is not on sale", () => {
    statusData.current = status();
    render(<PayrollPage tab="employees" onTabChange={() => {}} />);
    const notice = screen.getByTestId("payroll-addon-notice");
    expect(notice).toHaveTextContent("Payroll is an add-on");
    expect(notice).toHaveTextContent("not on sale yet");
    expect(screen.queryByRole("link", { name: /see add-ons/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-employees")).not.toBeInTheDocument();
  });

  it("points an owner to Billing only once the add-on is on sale", () => {
    onSale.current = true;
    statusData.current = status();
    render(<PayrollPage tab="employees" onTabChange={() => {}} />);
    expect(screen.getByRole("link", { name: /see add-ons/i })).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("tells a member who cannot manage billing to ask an owner, when it is on sale", () => {
    onSale.current = true;
    statusData.current = status({ canManageBilling: false });
    render(<PayrollPage tab="employees" onTabChange={() => {}} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("payroll-addon-notice")).toHaveTextContent("Ask an owner");
  });

  it("with the add-on shows the eight sections and the chosen tab", () => {
    statusData.current = status({ addons: { ai_assistant: false, ai_plus: false, payroll: true, store_pro: false } });
    const onTabChange = vi.fn();
    render(<PayrollPage tab="salary" onTabChange={onTabChange} />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Employees", "Salary structures", "Attendance", "Leave", "Payroll runs", "Statutory settings", "Statutory dues", "Filings and registers"]);
    expect(screen.getByTestId("tab-salary")).toBeInTheDocument();
    expect(screen.queryByTestId("payroll-addon-notice")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Payroll runs" }));
    expect(onTabChange).toHaveBeenCalledWith("runs");
  });

  it("the statutory sections open from their tabs", () => {
    statusData.current = status({ addons: { ai_assistant: false, ai_plus: false, payroll: true, store_pro: false } });
    const { rerender } = render(<PayrollPage tab="statutory" onTabChange={() => {}} />);
    expect(screen.getByTestId("tab-statutory")).toBeInTheDocument();
    rerender(<PayrollPage tab="dues" onTabChange={() => {}} />);
    expect(screen.getByTestId("tab-dues")).toBeInTheDocument();
    rerender(<PayrollPage tab="filings" onTabChange={() => {}} />);
    expect(screen.getByTestId("tab-filings")).toBeInTheDocument();
  });

  it("a trial organisation (add-on on) can use it", () => {
    statusData.current = status({ state: "trialing", addons: { ai_assistant: true, ai_plus: false, payroll: true, store_pro: true }, trial: { active: true, caps: { aiQuestions: 50, payrollEmployees: 10, storePro: true } } });
    render(<PayrollPage tab="employees" onTabChange={() => {}} />);
    expect(screen.getByTestId("tab-employees")).toBeInTheDocument();
  });

  it("a read-only organisation keeps seeing its payroll data", () => {
    statusData.current = status({ state: "trial_expired", readOnly: true });
    render(<PayrollPage tab="runs" onTabChange={() => {}} />);
    expect(screen.getByTestId("tab-runs")).toBeInTheDocument();
  });

  it("shows nothing but a loading line while the status loads", () => {
    render(<PayrollPage tab="employees" onTabChange={() => {}} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("payroll-addon-notice")).not.toBeInTheDocument();
  });
});
