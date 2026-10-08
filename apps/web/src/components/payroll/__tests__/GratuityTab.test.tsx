import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  post: vi.fn(), invalidate: vi.fn(), toast: vi.fn(), asOfSeen: vi.fn(),
  estimate: { data: undefined as unknown }, history: { data: [] as unknown[] },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollGratuity: { estimate: { invalidate: h.invalidate }, provisionHistory: { invalidate: h.invalidate } } }),
    payrollGratuity: {
      estimate: { useQuery: (input: { asOf: string }) => { h.asOfSeen(input.asOf); return { data: h.estimate.data, isLoading: !h.estimate.data }; } },
      provisionHistory: { useQuery: () => ({ data: h.history.data }) },
      postProvision: {
        useMutation: (o?: { onSuccess?: () => void }) => ({
          mutate: (v: unknown) => {
            h.post(v);
            o?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, todayISODate: () => "2026-10-08" };
});

import { GratuityTab } from "../GratuityTab";

const row = (over: Record<string, unknown> = {}) => ({
  employeeId: "e1", employeeCode: "E102", name: "Bharat Joshi", joinedOn: "2019-04-01", employmentType: "permanent", hasSalary: true, lastDrawnWages: "25000.00",
  completedYears: 7, yearsUsed: 7, minYearsRequired: 5, rule: "standard", eligible: true, amount: "100961.54", ifEligible: "100961.54", capped: false, ...over,
});
const estimate = (over: Record<string, unknown> = {}) => ({
  asOf: "2026-10-08", verifyLabel: "Verify with your CA", liability: "268269.23", ifEligible: "300000.00", eligibleCount: 3, provisionInBooks: "0.00", toProvide: "268269.23",
  rows: [row(), row({ employeeId: "e2", employeeCode: "E101", name: "Asha Verma", completedYears: 2, yearsUsed: 2, eligible: false, amount: "0.00", ifEligible: "20000.00", joinedOn: "2024-04-01" })], ...over,
});

describe("GratuityTab", () => {
  beforeEach(() => {
    for (const f of [h.post, h.invalidate, h.toast, h.asOfSeen]) f.mockReset();
    h.estimate.data = estimate();
    h.history.data = [];
  });

  it("shows the liability, what is in the books and who is eligible, with the verify reminder", () => {
    render(<GratuityTab />);
    expect(screen.getByTestId("verify-with-ca")).toHaveTextContent(/Tax on gratuity is not calculated/);
    expect(screen.getByTestId("gratuity-liability-today")).toHaveTextContent("2,68,269.23");
    expect(screen.getByTestId("gratuity-to-provide")).toHaveTextContent("2,68,269.23");
    const rows = screen.getAllByRole("row");
    expect(within(rows.find((r) => /Bharat Joshi/.test(r.textContent ?? ""))!).getAllByText("₹1,00,961.54")).toHaveLength(2);
    const asha = rows.find((r) => /Asha Verma/.test(r.textContent ?? ""))!;
    expect(asha).toHaveTextContent("needs 5 years");
    expect(asha).toHaveTextContent("₹20,000.00"); // the amount if eligible
  });

  it("asks for today's date first and shows nothing alarming while loading", () => {
    h.estimate.data = undefined;
    render(<GratuityTab />);
    expect(h.asOfSeen).toHaveBeenCalledWith("2026-10-08");
    expect(screen.getByText("Working out gratuity...")).toBeInTheDocument();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("posts the provision after a confirmation that names the amount", () => {
    render(<GratuityTab />);
    fireEvent.click(screen.getByRole("button", { name: "Post provision" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("2,68,269.23");
    fireEvent.click(within(dialog).getByRole("button", { name: "Post provision" }));
    expect(h.post).toHaveBeenCalledWith({ asOf: "2026-10-08" });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Gratuity provision posted" }));
  });

  it("has nothing to post when the books already hold the liability", () => {
    h.estimate.data = estimate({ provisionInBooks: "268269.23", toProvide: "0.00" });
    render(<GratuityTab />);
    expect(screen.getByRole("button", { name: "Post provision" })).toBeDisabled();
  });

  it("warns about employees with no salary structure and lists the provisions posted", () => {
    h.estimate.data = estimate({ rows: [row({ hasSalary: false, amount: "0.00" })] });
    h.history.data = [{ id: "p1", asOf: "2026-03-31", liability: "268269.23", previousBalance: "0.00", amount: "268269.23" }];
    render(<GratuityTab />);
    expect(screen.getByText(/no salary structure/)).toBeInTheDocument();
    expect(screen.getByText("Provisions posted")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing posted yet/)).not.toBeInTheDocument();
  });
});
