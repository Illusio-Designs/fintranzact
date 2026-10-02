import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TdsExpensePanel, emptyTdsExpense, type TdsExpenseValue } from "../TdsExpensePanel";

let preview: unknown;
const previewArgs = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    party: { list: { useQuery: () => ({ data: { data: [{ id: "p1", name: "CA Associates" }] } }) } },
    tds: {
      preview: {
        useQuery: (input: unknown, opts: unknown) => {
          previewArgs(input, opts);
          return { data: preview, isLoading: false };
        },
      },
    },
  },
}));

function renderPanel(value: TdsExpenseValue = emptyTdsExpense, props: Partial<Parameters<typeof TdsExpensePanel>[0]> = {}) {
  const onChange = vi.fn();
  render(<TdsExpensePanel amount={60000} value={value} onChange={onChange} {...props} />);
  return onChange;
}

beforeEach(() => {
  preview = undefined;
  previewArgs.mockClear();
});

describe("TdsExpensePanel", () => {
  it("is off by default: no payee picker, no preview query", () => {
    renderPanel();
    expect(previewArgs).toHaveBeenLastCalledWith(expect.anything(), { enabled: false });
    expect(screen.queryByLabelText("Paid to")).toBeNull();
  });

  it("asks for the TDS on the gross amount once there is a payee, excluding the expense being edited", () => {
    renderPanel({ mode: "auto", partyId: "p1", section: "194J_PROF", amount: "" }, { expenseId: "e1" });
    expect(previewArgs).toHaveBeenCalledWith(
      { partyId: "p1", amount: "60000.00", paymentDate: undefined, sectionCode: "194J_PROF", excludeExpenseId: "e1" },
      { enabled: true },
    );
  });

  it("shows the TDS and what the payee gets after it", () => {
    preview = {
      section: { code: "194J_PROF", label: "194J · Professional fees" },
      ytdPaid: "0.00",
      warnings: [],
      result: { applicable: true, tds: "6000.00", rate: "10", base: "60000.00" },
    };
    renderPanel({ mode: "auto", partyId: "p1", section: "", amount: "" });
    expect(screen.getByText(/194J · Professional fees/)).toBeTruthy();
    expect(screen.getByText(/Paid to the payee after TDS/)).toBeTruthy();
  });

  it("switches mode through the select", async () => {
    const onChange = renderPanel();
    // The app's Select is a listbox popover: open it, then choose the option.
    await userEvent.click(screen.getByLabelText("TDS on this expense"));
    await userEvent.click(await screen.findByRole("option", { name: "Enter it myself" }));
    expect(onChange).toHaveBeenCalledWith({ ...emptyTdsExpense, mode: "manual" });
  });

  it("takes a manual amount, digits only", async () => {
    const onChange = renderPanel({ mode: "manual", partyId: "p1", section: "194I_LB", amount: "" });
    await userEvent.type(screen.getByLabelText("TDS amount"), "5");
    expect(onChange).toHaveBeenCalledWith({ mode: "manual", partyId: "p1", section: "194I_LB", amount: "5" });
  });
});
