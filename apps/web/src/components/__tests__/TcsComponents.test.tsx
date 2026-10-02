import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TcsInvoicePanel, type TcsPreviewData } from "../TcsInvoicePanel";
import { TcsSectionField } from "../TcsSectionField";

const scrap: TcsPreviewData = {
  hasPan: true,
  amount: "1000.00",
  sections: [{ sectionCode: "206C_SCRAP", label: "206C · Scrap", base: "100000.00", rate: "1", amount: "1000.00" }],
  warnings: [],
};

describe("TcsInvoicePanel", () => {
  it("shows nothing when the invoice has no TCS items", () => {
    const { container } = render(<TcsInvoicePanel mode="auto" onModeChange={vi.fn()} preview={{ ...scrap, sections: [], amount: "0.00" }} />);
    expect(container).toBeEmptyDOMElement();
    const none = render(<TcsInvoicePanel mode="auto" onModeChange={vi.fn()} preview={undefined} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it("lists each section with its rate, base and TCS", () => {
    render(<TcsInvoicePanel mode="auto" onModeChange={vi.fn()} preview={scrap} />);
    expect(screen.getByTestId("tcs-invoice-panel")).toBeInTheDocument();
    expect(screen.getByText(/206C · Scrap — 1% of ₹1,00,000\.00/)).toBeInTheDocument();
    expect(screen.getByText("₹1,000.00")).toBeInTheDocument();
  });

  it("warns when the customer has no PAN", () => {
    render(<TcsInvoicePanel mode="auto" onModeChange={vi.fn()} preview={{ ...scrap, hasPan: false, warnings: ["The customer has no PAN or GSTIN: TCS is collected at the higher rate (s.206CC)."] }} />);
    expect(screen.getByText(/higher rate \(s\.206CC\)/)).toBeInTheDocument();
  });

  it("stays visible when switched off, so it can be switched back on, and says no TCS will be collected", () => {
    render(<TcsInvoicePanel mode="none" onModeChange={vi.fn()} preview={undefined} />);
    expect(screen.getByText(/No TCS will be collected/)).toBeInTheDocument();
  });

  it("reports a change of mode", async () => {
    const onModeChange = vi.fn();
    render(<TcsInvoicePanel mode="auto" onModeChange={onModeChange} preview={scrap} />);
    await userEvent.click(screen.getByLabelText("TCS on this invoice"));
    await userEvent.click(await screen.findByRole("option", { name: "No TCS on this invoice" }));
    expect(onModeChange).toHaveBeenCalledWith("none");
  });
});

describe("TcsSectionField", () => {
  it("explains what it is for when nothing is chosen", () => {
    render(<TcsSectionField value="" onChange={vi.fn()} />);
    expect(screen.getByText(/Only for specified goods such as scrap/)).toBeInTheDocument();
  });

  it("says what a chosen section collects", () => {
    render(<TcsSectionField value="206C_SCRAP" onChange={vi.fn()} financialYear="2025-26" />);
    expect(screen.getByText(/collect 1% TCS from the customer, with the invoice/)).toBeInTheDocument();
  });

  it("shows the 2026-27 rate for a 2026-27 year", () => {
    render(<TcsSectionField value="206C_SCRAP" onChange={vi.fn()} financialYear="2026-27" />);
    expect(screen.getByText(/collect 2% TCS from the customer, with the invoice \(FY 2026-27/)).toBeInTheDocument();
  });

  it("mentions the value limit for motor vehicles", () => {
    render(<TcsSectionField value="206C_VEHICLE" onChange={vi.fn()} />);
    expect(screen.getByText(/when a line is above ₹10,00,000/)).toBeInTheDocument();
  });

  it("offers every TCS section and reports the choice", async () => {
    const onChange = vi.fn();
    render(<TcsSectionField value="" onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("TCS section"));
    expect(await screen.findAllByRole("option")).toHaveLength(10); // "Not applicable" + 9 sections
    await userEvent.click(screen.getByRole("option", { name: "206C · Scrap" }));
    expect(onChange).toHaveBeenCalledWith("206C_SCRAP");
  });
});
