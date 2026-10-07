import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const BASIC = "11111111-1111-4111-8111-111111111111";
const HRA = "22222222-2222-4222-8222-222222222222";
const SPECIAL = "33333333-3333-4333-8333-333333333333";
const TPL = "44444444-4444-4444-8444-444444444444";
const EMP = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  seed: vi.fn(),
  del: vi.fn(),
  assign: vi.fn(),
  tplCreate: vi.fn(),
  tplUpdate: vi.fn(),
  invalidate: vi.fn(),
  canDelete: { current: true },
  components: { data: [] as unknown[] },
  templates: { data: [] as unknown[] },
  overview: { data: [] as unknown[] },
  statutory: { data: undefined as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    payrollStatutory: { settings: { useQuery: () => ({ data: h.statutory.data, isLoading: false }) } },
    useUtils: () => ({ payrollSalary: { componentList: { invalidate: h.invalidate }, templateList: { invalidate: h.invalidate }, overview: { invalidate: h.invalidate } } }),
    payrollSalary: {
      componentList: { useQuery: () => ({ data: h.components.data }) },
      templateList: { useQuery: () => ({ data: h.templates.data }) },
      overview: { useQuery: () => ({ data: h.overview.data }) },
      componentSeedDefaults: { useMutation: () => ({ mutate: h.seed, isPending: false }) },
      componentCreate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      templateDelete: { useMutation: () => ({ mutate: h.del, isPending: false }) },
      templateCreate: { useMutation: () => ({ mutate: h.tplCreate, isPending: false }) },
      templateUpdate: { useMutation: () => ({ mutate: h.tplUpdate, isPending: false }) },
      assign: { useMutation: () => ({ mutate: h.assign, isPending: false }) },
    },
  },
}));
vi.mock("@/lib/permissions", () => ({ useCan: () => h.canDelete.current }));
vi.mock("@/hooks/useToast", () => ({ toast: vi.fn() }));

import { SalaryTab, previewBreakdown } from "../SalaryTab";

const comp = (id: string, code: string, name: string, category: string, isWage = false) => ({ id, code, name, type: "earning", category, prorate: true, isWage, isActive: true });

const COMPONENTS = [comp(BASIC, "BASIC", "Basic", "basic", true), comp(HRA, "HRA", "House rent allowance", "hra"), comp(SPECIAL, "SPECIAL", "Special allowance", "special_allowance")];

const template = (over: Record<string, unknown> = {}) => ({
  id: TPL, name: "Staff 50k", description: null, sampleAnnualCtc: "600000.00", employeeCount: 2,
  lines: [
    { id: "l1", componentId: BASIC, name: "Basic", calcType: "percent_of_ctc", value: "50.00" },
    { id: "l2", componentId: HRA, name: "House rent allowance", calcType: "percent_of_basic", value: "40.00" },
    { id: "l3", componentId: SPECIAL, name: "Special allowance", calcType: "balance", value: "0.00" },
  ],
  ...over,
});

describe("previewBreakdown (CTC to monthly)", () => {
  const lines = [
    { componentId: BASIC, calcType: "percent_of_ctc" as const, value: "50" },
    { componentId: HRA, calcType: "percent_of_basic" as const, value: "40" },
    { componentId: SPECIAL, calcType: "balance" as const, value: "0" },
  ];
  it("splits an annual CTC into monthly amounts", () => {
    const { breakdown, error } = previewBreakdown(600000, lines, COMPONENTS);
    expect(error).toBeNull();
    expect(breakdown!.monthlyCtcPaise).toBe(5_000_000);
    expect(breakdown!.lines.map((l) => [l.code, l.monthlyPaise])).toEqual([["BASIC", 2_500_000], ["HRA", 1_000_000], ["SPECIAL", 1_500_000]]);
    expect(breakdown!.warnings).toEqual([]);
  });
  it("warns, without blocking, when wages are under half of the remuneration", () => {
    const { breakdown } = previewBreakdown(600000, [{ ...lines[0]!, value: "30" }, lines[1]!, lines[2]!], COMPONENTS);
    expect(breakdown!.warnings.map((w) => w.code)).toContain("wages_below_50_percent");
  });
  it("returns the reason when a structure cannot work", () => {
    const { breakdown, error } = previewBreakdown(12000, [{ componentId: BASIC, calcType: "fixed", value: "50000" }, lines[2]!], COMPONENTS);
    expect(breakdown).toBeNull();
    expect(error).toMatch(/more than the monthly CTC/);
  });
});

describe("SalaryTab", () => {
  beforeEach(() => {
    for (const f of [h.seed, h.del, h.assign, h.tplCreate, h.tplUpdate, h.invalidate]) f.mockReset();
    h.canDelete.current = true;
    h.components.data = COMPONENTS;
    h.templates.data = [template()];
    h.overview.data = [{ employeeId: EMP, employeeCode: "E001", name: "Asha Verma", annualCtc: "600000.00", monthlyCtc: "50000.00", effectiveFrom: "2026-04-01", templateName: "Staff 50k" }];
  });

  it("says statutory deductions are calculated automatically and names only the registered schemes", () => {
    h.statutory.data = { flags: { pfRegistered: true, esiRegistered: true, ptStates: ["27"], lwfState: null, tdsEnabled: false } };
    const { unmount } = render(<SalaryTab />);
    expect(screen.getByText(/calculated automatically in each payroll run from your Statutory settings/i)).toHaveTextContent("provident fund, ESI and professional tax");
    unmount();
    // Without PF the word never appears.
    h.statutory.data = { flags: { pfRegistered: false, esiRegistered: true, ptStates: [], lwfState: null, tdsEnabled: false } };
    render(<SalaryTab />);
    expect(document.body.textContent).not.toMatch(/provident|\bPF\b/i);
    expect(screen.getByText(/Statutory deductions \(ESI\)/)).toBeInTheDocument();
  });

  it("offers the standard components when there are none", () => {
    h.components.data = [];
    render(<SalaryTab />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add standard components" })[0]!);
    expect(h.seed).toHaveBeenCalledTimes(1);
  });

  it("lists templates with their employees and lines, and the salaries in force", () => {
    render(<SalaryTab />);
    expect(screen.getAllByText("Staff 50k").length).toBeGreaterThanOrEqual(2); // the template row and the salary row
    expect(screen.getByText("Basic, House rent allowance, Special allowance")).toBeInTheDocument();
    expect(screen.getByText("₹6,00,000.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revise" })).toBeInTheDocument();
  });

  it("hides template deletion from a role that may not delete", () => {
    h.canDelete.current = false;
    render(<SalaryTab />);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("the template editor previews the monthly breakdown live, with the wage warning", () => {
    render(<SalaryTab />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    const preview = within(dialog).getByTestId("salary-breakdown");
    expect(preview.textContent).toContain("₹50,000.00");
    expect(within(preview).queryByRole("status")).not.toBeInTheDocument();
    // Basic down to 30% of CTC: wages are 30% of the remuneration.
    fireEvent.change(within(dialog).getByLabelText("Value for Basic"), { target: { value: "30" } });
    expect(within(dialog).getByTestId("salary-breakdown").textContent).toContain("below 50%");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save template" }));
    expect(h.tplUpdate).toHaveBeenCalledTimes(1);
    expect(h.tplUpdate.mock.calls[0]![0]).toMatchObject({ id: TPL, name: "Staff 50k", sampleAnnualCtc: 600000 });
  });

  it("refuses to save a template whose lines cannot be calculated", () => {
    render(<SalaryTab />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Preview with an annual CTC of"), { target: { value: "1000" } });
    fireEvent.change(within(dialog).getByLabelText("Value for Basic"), { target: { value: "90" } });
    fireEvent.change(within(dialog).getByLabelText("Value for House rent allowance"), { target: { value: "90" } });
    expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save template" }));
    expect(h.tplUpdate).not.toHaveBeenCalled();
  });

  it("sets a salary: template, annual CTC and an effective date, with the monthly breakdown shown", () => {
    render(<SalaryTab />);
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Annual CTC/), { target: { value: "720000" } });
    expect(within(dialog).getByTestId("salary-breakdown").textContent).toContain("₹60,000.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Set salary" }));
    expect(h.assign).toHaveBeenCalledTimes(1);
    expect(h.assign.mock.calls[0]![0]).toMatchObject({ employeeId: EMP, templateId: TPL, annualCtc: 720000 });
  });
});
