import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const RUN = "77777777-7777-4777-8777-777777777777";
const BANK = "88888888-8888-4888-8888-888888888888";

const h = vi.hoisted(() => ({ pay: vi.fn(), refetch: vi.fn(), dues: { data: undefined as unknown } }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    bankAccount: { list: { useQuery: () => ({ data: [{ id: "88888888-8888-4888-8888-888888888888", accountName: "HDFC Current" }] }) } },
    payrollStatutory: {
      dues: { useQuery: () => ({ data: h.dues.data, isLoading: !h.dues.data, refetch: h.refetch }) },
      recordPayment: {
        useMutation: (o?: { onSuccess?: () => void }) => ({
          mutate: (v: unknown) => {
            h.pay(v);
            o?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, todayISODate: () => "2026-06-20" };
});
vi.mock("../payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-ui")>();
  return { ...actual, currentMonth: () => "2026-06" };
});

import { DuesTab } from "../DuesTab";

const due = (over: Record<string, unknown> = {}) => ({
  runId: RUN, month: "2026-04", monthLabel: "April 2026", runStatus: "posted", kind: "pf", label: "Provident fund (PF and EPS)", accrued: "10680.00", paid: "0.00",
  outstanding: "10680.00", dueDate: "2026-05-15", canPay: true, payments: [], ...over,
});

describe("DuesTab", () => {
  beforeEach(() => {
    h.pay.mockReset();
    h.refetch.mockReset();
    h.dues.data = { financialYear: 2026, financialYearLabel: "2026-27", rows: [due(), due({ kind: "pt", label: "Professional tax", accrued: "800.00", outstanding: "800.00", dueDate: null }), due({ kind: "tds", label: "TDS on salary", accrued: "7345.00", paid: "7345.00", outstanding: "0.00", dueDate: "2026-05-07", payments: [{ id: "p1", amount: "7345.00", paidOn: "2026-05-06", challanNumber: "00123", challanDate: "2026-05-06", reference: "BSR 6360000" }] })] };
  });

  it("lists what is owed with due dates, flags overdue amounts and totals the outstanding", () => {
    render(<DuesTab />);
    expect(screen.getByTestId("verify-with-ca")).toBeInTheDocument();
    expect(screen.getByTestId("dues-outstanding")).toHaveTextContent("11,480");
    const pf = screen.getByText("Provident fund (PF and EPS)").closest("tr")!;
    expect(within(pf).getByText("Overdue")).toBeInTheDocument();
    const pt = screen.getByText("Professional tax").closest("tr")!;
    expect(within(pt).getByText("Not set")).toBeInTheDocument();
    expect(within(pt).queryByText("Overdue")).not.toBeInTheDocument();
    // A fully paid due has no payment button.
    const tds = screen.getByText("TDS on salary").closest("tr")!;
    expect(within(tds).queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });

  it("shows the payments made with their challan details", () => {
    render(<DuesTab />);
    fireEvent.click(screen.getByRole("button", { name: "Payments (1)" }));
    const list = screen.getByRole("list", { name: "TDS on salary payments" });
    expect(list).toHaveTextContent("challan 00123");
    expect(list).toHaveTextContent("BSR 6360000");
  });

  it("records a payment with the challan number and date", () => {
    render(<DuesTab />);
    const pf = screen.getByText("Provident fund (PF and EPS)").closest("tr")!;
    fireEvent.click(within(pf).getByRole("button", { name: "Record payment" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Amount paid/)).toHaveValue("10680.00");
    fireEvent.click(within(dialog).getByRole("combobox", { name: /Paid from/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "HDFC Current" }));
    fireEvent.change(within(dialog).getByLabelText("Challan number"), { target: { value: "TRRN-1001" } });
    fireEvent.change(within(dialog).getByLabelText(/Amount paid/), { target: { value: "5000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect(h.pay).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN, kind: "pf", amount: 5000, bankAccountId: BANK, challanNumber: "TRRN-1001", paidOn: "2026-06-20" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("needs a bank account", () => {
    render(<DuesTab />);
    fireEvent.click(within(screen.getByText("Provident fund (PF and EPS)").closest("tr")!).getByRole("button", { name: "Record payment" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Record payment" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the bank or cash account");
    expect(h.pay).not.toHaveBeenCalled();
  });

  it("a run that is not posted yet cannot be paid", () => {
    h.dues.data = { financialYear: 2026, financialYearLabel: "2026-27", rows: [due({ canPay: false, runStatus: "approved" })] };
    render(<DuesTab />);
    expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
  });

  it("explains an empty list", () => {
    h.dues.data = { financialYear: 2026, financialYearLabel: "2026-27", rows: [] };
    render(<DuesTab />);
    expect(screen.getByText("Nothing to pay yet")).toBeInTheDocument();
  });
});
