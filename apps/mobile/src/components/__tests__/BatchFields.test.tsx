import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockStatus: { current: unknown } = { current: undefined };
const mockBatches: { current: unknown[] } = { current: [] };
const mockListInputs: unknown[] = [];

jest.mock("../../lib/trpc", () => ({
  trpc: {
    billing: { status: { useQuery: () => ({ data: mockStatus.current }) } },
    batch: {
      list: {
        useQuery: (input: unknown) => {
          mockListInputs.push(input);
          return { data: { data: mockBatches.current, unbatched: "0.000", asOf: "2026-10-05" }, isLoading: false };
        },
      },
    },
  },
}));

import { BatchInFields, BatchLineFields, BatchOutPicker, ExpiryBadge } from "../BatchFields";
import { ThemeProvider } from "../../contexts/ThemeContext";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider initialMode="dark">{ui}</ThemeProvider>);
}

const batch = (over: Record<string, unknown>) => ({
  id: "id",
  batchNumber: "B",
  mfgDate: null,
  expiryDate: null,
  mrp: null,
  quantity: "10.000",
  expired: false,
  daysToExpiry: null,
  ...over,
});

const starter = {
  canManageBilling: true,
  topPlanName: "Business",
  features: { batchesExpiry: false },
  featureRequiredPlans: { batchesExpiry: "Growth" },
};

beforeEach(() => {
  mockStatus.current = undefined;
  mockBatches.current = [];
  mockListInputs.length = 0;
});

describe("ExpiryBadge", () => {
  it("shows near-expiry in amber and expired in red, nothing otherwise", () => {
    const { rerender } = wrap(<ExpiryBadge batch={{ daysToExpiry: 12 }} />);
    expect(screen.getByText("12d left")).toBeTruthy();
    expect(screen.getByTestId("expiry-badge-near")).toBeTruthy();
    rerender(<ThemeProvider initialMode="dark"><ExpiryBadge batch={{ daysToExpiry: -4, expired: true }} /></ThemeProvider>);
    expect(screen.getByText("Expired 4d ago")).toBeTruthy();
    expect(screen.getByTestId("expiry-badge-expired")).toBeTruthy();
    rerender(<ThemeProvider initialMode="dark"><ExpiryBadge batch={{ daysToExpiry: 200 }} /></ThemeProvider>);
    expect(screen.queryByTestId("expiry-badge-near")).toBeNull();
    expect(screen.queryByTestId("expiry-badge-expired")).toBeNull();
  });
});

describe("BatchOutPicker", () => {
  const props = { itemId: "item-1", date: "2026-10-05", needed: 5, unit: "pcs", value: {}, onChange: jest.fn() };

  it("asks for batches as of the document date", () => {
    wrap(<BatchOutPicker {...props} />);
    expect(mockListInputs[0]).toEqual({ itemId: "item-1", variantId: null, warehouseId: null, asOf: "2026-10-05" });
  });

  it("previews the FEFO split by default, earliest expiry first", () => {
    mockBatches.current = [
      batch({ id: "late", batchNumber: "LATE", expiryDate: "2027-06-01", daysToExpiry: 239, quantity: "20.000" }),
      batch({ id: "soon", batchNumber: "SOON", expiryDate: "2026-10-20", daysToExpiry: 15, quantity: "3.000" }),
    ];
    wrap(<BatchOutPicker {...props} />);
    expect(screen.getByText("Earliest expiry first")).toBeTruthy();
    expect(screen.getByText("SOON × 3, LATE × 2")).toBeTruthy();
    // The first batch FEFO takes is near expiry: warn right on the line.
    expect(screen.getByText("15d left")).toBeTruthy();
  });

  it("warns when unexpired batches cannot cover the line", () => {
    mockBatches.current = [batch({ id: "a", batchNumber: "A", quantity: "2.000" })];
    wrap(<BatchOutPicker {...props} />);
    expect(screen.getByTestId("batch-short-warning")).toBeTruthy();
    expect(screen.getByText(/3 pcs short/)).toBeTruthy();
  });

  it("lists batches with available quantity and expiry, and disables ones that hold too little", () => {
    mockBatches.current = [
      batch({ id: "full", batchNumber: "FULL", expiryDate: "2027-01-01", daysToExpiry: 88, quantity: "9.000" }),
      batch({ id: "low", batchNumber: "LOW", expiryDate: "2026-12-01", daysToExpiry: 57, quantity: "2.000" }),
    ];
    const onChange = jest.fn();
    wrap(<BatchOutPicker {...props} onChange={onChange} />);
    fireEvent.press(screen.getByTestId("batch-out-select"));
    expect(screen.getByText(/exp 1 Jan 2027 · 9 pcs left/)).toBeTruthy();
    expect(screen.getByText(/exp 1 Dec 2026 · 2 pcs left/)).toBeTruthy();
    expect(screen.getByText(/Only 2 pcs left; this line needs 5 pcs/)).toBeTruthy();

    fireEvent.press(screen.getByTestId("batch-option-LOW"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("batch-option-FULL"));
    expect(onChange).toHaveBeenCalledWith({ batchId: "full", allowExpired: false });
  });

  it("blocks expired batches until expired stock is allowed", () => {
    mockBatches.current = [batch({ id: "old", batchNumber: "OLD", expiryDate: "2026-10-01", daysToExpiry: -4, expired: true })];
    const onChange = jest.fn();
    wrap(<BatchOutPicker {...props} needed={1} onChange={onChange} />);
    fireEvent.press(screen.getByTestId("batch-out-select"));
    expect(screen.getByText("Expired 4d ago")).toBeTruthy();
    expect(screen.getByText(/allow expired stock to use it/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("batch-option-OLD"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId("allow-expired-switch"), "valueChange", true);
    expect(onChange).toHaveBeenCalledWith({ allowExpired: true });
  });

  it("flags a picked batch that holds less than the line needs", () => {
    mockBatches.current = [batch({ id: "low", batchNumber: "LOW", quantity: "2.000" })];
    wrap(<BatchOutPicker {...props} value={{ batchId: "low" }} />);
    expect(screen.getByTestId("batch-picked-error")).toBeTruthy();
    expect(screen.getByText(/Only 2 left in batch LOW/)).toBeTruthy();
  });
});

describe("BatchInFields", () => {
  it("edits the batch number and shows existing batches as suggestions", () => {
    mockBatches.current = [batch({ id: "e", batchNumber: "B100", expiryDate: "2027-05-01", daysToExpiry: 207, mfgDate: "2026-05-01", quantity: "7.000" })];
    const onChange = jest.fn();
    wrap(<BatchInFields itemId="i" trackExpiry value={{}} onChange={onChange} />);
    fireEvent.changeText(screen.getByTestId("batch-number-input"), "B200");
    expect(onChange).toHaveBeenCalledWith({ batchNumber: "B200" });
    fireEvent.press(screen.getByLabelText("Use batch B100"));
    expect(onChange).toHaveBeenLastCalledWith({ batchNumber: "B100", mfgDate: "2026-05-01", expiryDate: "2027-05-01", batchMrp: "" });
  });

  it("marks expiry required when the item tracks expiry, and notes an existing batch", () => {
    mockBatches.current = [batch({ id: "e", batchNumber: "B100", expiryDate: "2027-05-01", quantity: "7.000" })];
    wrap(<BatchInFields itemId="i" trackExpiry value={{ batchNumber: "B100", expiryDate: "2027-05-01" }} onChange={jest.fn()} />);
    expect(screen.getByText("Expiry *")).toBeTruthy();
    expect(screen.getByTestId("batch-existing-note")).toBeTruthy();
  });

  it("shows an error when expiry is before manufacture, and an expired warning for a past expiry", () => {
    wrap(<BatchInFields itemId="i" trackExpiry={false} value={{ batchNumber: "B1", mfgDate: "2020-06-01", expiryDate: "2020-05-01" }} onChange={jest.fn()} />);
    expect(screen.getByTestId("batch-date-error")).toBeTruthy();
    expect(screen.getByText("This batch has already expired")).toBeTruthy();
  });
});

describe("BatchLineFields plan gate", () => {
  const base = {
    itemId: "i",
    trackExpiry: false,
    date: "2026-10-05",
    needed: 1,
    onBatchIn: jest.fn(),
    onBatchOut: jest.fn(),
  };

  it("shows the plan notice instead of fields when the plan lacks batches", () => {
    mockStatus.current = starter;
    wrap(<BatchLineFields {...base} direction="in" />);
    expect(screen.getByTestId("batch-plan-note")).toBeTruthy();
    expect(screen.getByTestId("feature-notice")).toBeTruthy();
    expect(screen.queryByTestId("batch-in-fields")).toBeNull();
    expect(mockListInputs).toHaveLength(0);
  });

  it("says the server picks batches on an outward line", () => {
    mockStatus.current = starter;
    wrap(<BatchLineFields {...base} direction="out" />);
    expect(screen.getByText("Batches are picked for you, earliest expiry first.")).toBeTruthy();
    expect(screen.queryByTestId("batch-out-picker")).toBeNull();
  });

  it("allows everything while billing status loads", () => {
    mockStatus.current = undefined;
    wrap(<BatchLineFields {...base} direction="in" />);
    expect(screen.getByTestId("batch-in-fields")).toBeTruthy();
    expect(screen.queryByTestId("feature-notice")).toBeNull();
  });

  it("shows the picker for outward lines when the plan has batches", () => {
    mockStatus.current = { ...starter, features: { batchesExpiry: true } };
    wrap(<BatchLineFields {...base} direction="out" />);
    expect(screen.getByTestId("batch-out-picker")).toBeTruthy();
  });
});
