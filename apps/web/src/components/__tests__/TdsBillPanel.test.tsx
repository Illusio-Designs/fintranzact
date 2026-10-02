import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TdsBillPanel, emptyTdsBill, type TdsBillValue } from "../TdsBillPanel";

let preview: unknown;
let isLoading = false;
const previewArgs = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    tds: {
      preview: {
        useQuery: (input: unknown, opts: unknown) => {
          previewArgs(input, opts);
          return { data: preview, isLoading };
        },
      },
    },
  },
}));

const section = { code: "194J_PROF", label: "194J · Professional fees" };

function renderPanel(value: TdsBillValue = emptyTdsBill, props: Partial<Parameters<typeof TdsBillPanel>[0]> = {}) {
  const onChange = vi.fn();
  render(<TdsBillPanel partyId="p1" taxable={60000} total={70800} value={value} onChange={onChange} {...props} />);
  return onChange;
}

beforeEach(() => {
  preview = undefined;
  isLoading = false;
  previewArgs.mockClear();
});

describe("TdsBillPanel", () => {
  it("asks the server for the TDS on the bill's taxable value, only once there is a supplier and an amount", () => {
    renderPanel();
    expect(previewArgs).toHaveBeenCalledWith(
      { partyId: "p1", amount: "60000.00", paymentDate: undefined },
      { enabled: true },
    );
  });

  it("does not query without a supplier, without items, or when TDS is off", () => {
    renderPanel(emptyTdsBill, { partyId: "" });
    expect(previewArgs).toHaveBeenLastCalledWith(expect.anything(), { enabled: false });
    renderPanel(emptyTdsBill, { taxable: 0 });
    expect(previewArgs).toHaveBeenLastCalledWith(expect.anything(), { enabled: false });
    renderPanel({ ...emptyTdsBill, mode: "none" });
    expect(previewArgs).toHaveBeenLastCalledWith(expect.anything(), { enabled: false });
  });

  it("shows the TDS, its basis and what is payable after it", () => {
    preview = {
      section,
      ytdPaid: "30000.00",
      warnings: [],
      result: { applicable: true, tds: "6000.00", rate: "10", base: "60000.00" },
    };
    renderPanel();
    expect(screen.getByText(/₹6,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/194J · Professional fees/)).toBeInTheDocument();
    // 70,800 total less 6,000 TDS
    expect(screen.getByText("₹64,800.00")).toBeInTheDocument();
  });

  it("says when earlier purchases are caught up by crossing the yearly limit", () => {
    preview = {
      section,
      ytdPaid: "30000.00",
      warnings: [],
      result: { applicable: true, tds: "9000.00", rate: "10", base: "90000.00" },
    };
    renderPanel();
    expect(screen.getByText(/includes earlier purchases/)).toBeInTheDocument();
  });

  it("explains when the supplier is still under the limit", () => {
    preview = { section, ytdPaid: "10000.00", warnings: [], result: { applicable: false, tds: "0.00", rate: "10", base: "0.00" } };
    renderPanel({ ...emptyTdsBill }, { taxable: 20000, total: 23600 });
    expect(screen.getByText(/No TDS yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Payable to supplier after TDS/)).not.toBeInTheDocument();
  });

  it("points to the supplier when it has no TDS section", () => {
    preview = { section: null, result: null, warnings: ["No TDS section is set on this party."] };
    renderPanel();
    expect(screen.getByText(/Set one on the supplier/)).toBeInTheDocument();
  });

  it("warns that a missing PAN raises the rate", () => {
    preview = {
      section,
      ytdPaid: "0",
      warnings: ["No PAN on file — TDS is at the higher 20% rate (s.206AA)."],
      result: { applicable: true, tds: "12000.00", rate: "20", base: "60000.00" },
    };
    renderPanel();
    expect(screen.getByText(/No PAN on file/)).toBeInTheDocument();
  });

  it("lets the user enter the section and amount by hand and shows the net payable", async () => {
    const onChange = renderPanel({ mode: "manual", section: "194C", amount: "1500" });
    expect(screen.getByLabelText("TDS amount")).toHaveValue("1500");
    expect(screen.getByText("₹69,300.00")).toBeInTheDocument(); // 70,800 - 1,500

    await userEvent.type(screen.getByLabelText("TDS amount"), "5");
    expect(onChange).toHaveBeenCalledWith({ mode: "manual", section: "194C", amount: "15005" });
  });

  it("only accepts digits and a decimal point in the manual amount", async () => {
    const onChange = renderPanel({ mode: "manual", section: "194C", amount: "" });
    await userEvent.type(screen.getByLabelText("TDS amount"), "1a2");
    expect(onChange).toHaveBeenLastCalledWith({ mode: "manual", section: "194C", amount: "2" });
  });

  it("switching the mode reports the new mode and keeps the rest", async () => {
    const onChange = renderPanel();
    // The app's Select is a listbox popover: open it, then choose the option.
    await userEvent.click(screen.getByLabelText("TDS on this bill"));
    await userEvent.click(await screen.findByRole("option", { name: "No TDS on this bill" }));
    expect(onChange).toHaveBeenCalledWith({ ...emptyTdsBill, mode: "none" });
  });

  it("shows no deduction line when TDS is off", () => {
    renderPanel({ ...emptyTdsBill, mode: "none" });
    expect(screen.queryByText(/Payable to supplier after TDS/)).not.toBeInTheDocument();
  });
});
