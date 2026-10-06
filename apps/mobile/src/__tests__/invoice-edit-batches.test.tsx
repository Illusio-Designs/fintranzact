/**
 * Invoice edit on mobile: batch fields come back pre-filled from the saved lines. A sale line
 * shows the batch picker on the batch it was sold from; a purchase line shows the inward fields
 * with the saved number and dates. On a plan without batches the notice shows and nothing
 * batch-related is sent.
 */
import React from "react";
import { Alert } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme as render } from "../test-utils";
import { useBusinessStore } from "../stores/business";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: "inv1" }),
}));
jest.mock("../lib/haptics", () => ({ haptic: { success: jest.fn(), error: jest.fn(), light: jest.fn() } }));

const mockMutate = jest.fn();
const mockFetch = jest.fn();
const mockState: { status: unknown; invoice: unknown; batches: unknown[] } = { status: undefined, invoice: null, batches: [] };

jest.mock("../lib/trpc", () => {
  const q = (read: () => unknown) => ({ useQuery: () => ({ data: read(), isLoading: false, error: null }) });
  const inval = { invalidate: jest.fn() };
  return {
    trpc: {
      useUtils: () => ({
        invoice: { list: inval, getById: inval },
        dashboard: { summary: inval },
        party: { list: inval },
        item: { list: inval },
        batch: { list: { fetch: (...a: unknown[]) => mockFetch(...a) } },
      }),
      business: { list: q(() => [{ id: "biz1", state: "Maharashtra" }]) },
      party: { getById: q(() => ({ id: "p1", state: "Maharashtra" })), list: q(() => ({ data: [] })) },
      item: {
        list: q(() => ({
          data: [
            { id: "item1", name: "Syrup", unit: "bottle", taxPercent: "12", trackBatches: true, trackExpiry: true },
          ],
        })),
      },
      billing: { status: q(() => mockState.status) },
      batch: { list: { useQuery: () => ({ data: { data: mockState.batches, unbatched: "0.000", asOf: "2026-10-07" }, isLoading: false }) } },
      invoice: {
        getById: q(() => mockState.invoice),
        update: { useMutation: () => ({ mutate: mockMutate, isPending: false }) },
      },
    },
  };
});

import InvoiceEditScreen from "../../app/(app)/(invoices)/edit";

const savedBatch = { id: "bat1", batchNumber: "SY-77", mfgDate: "2026-06-01", expiryDate: "2027-06-01", mrp: "55.00" };

function invoice(type: "sale" | "purchase", quantity = "4") {
  return {
    id: "inv1",
    type,
    partyId: "p1",
    party: { name: "Party One" },
    invoiceNumber: "INV-1",
    invoiceDate: "2026-10-01T00:00:00.000Z",
    dueDate: null,
    notes: null,
    lineItems: [
      {
        id: "l1",
        itemId: "item1",
        itemName: "Syrup",
        description: null,
        quantity,
        unitPrice: "40",
        taxPercent: "12",
        discountPercent: "0",
        conversionFactor: "1",
        variantId: null,
        batchId: "bat1",
        batch: savedBatch,
      },
    ],
  };
}

const noBatches = {
  canManageBilling: true,
  topPlanName: "Business",
  features: { batchesExpiry: false },
  featureRequiredPlans: { batchesExpiry: "Growth" },
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockMutate.mockClear();
  mockFetch.mockReset();
  mockState.status = undefined;
  mockState.batches = [];
  useBusinessStore.setState({ businessId: "biz1", businessName: "Biz" });
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

describe("Invoice edit: batch fields", () => {
  it("purchase: shows the saved batch number and dates and sends the saved batch back as is", async () => {
    mockState.invoice = invoice("purchase");
    render(<InvoiceEditScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-in-fields")).toBeTruthy());
    expect(screen.getByDisplayValue("SY-77")).toBeTruthy();

    fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    const line = mockMutate.mock.calls[0][0].lineItems[0];
    expect(line).toMatchObject({ itemId: "item1", batchId: "bat1" });
    expect(line.batchNumber).toBeUndefined();
  });

  it("purchase: typing a different batch number sends it as a typed-in batch", async () => {
    mockState.invoice = invoice("purchase");
    render(<InvoiceEditScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-in-fields")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("batch-number-input"), "SY-78");
    fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    const line = mockMutate.mock.calls[0][0].lineItems[0];
    expect(line).toMatchObject({ batchNumber: "SY-78" });
    expect(line.batchId).toBeUndefined();
  });

  it("purchase: a tracked-expiry batch typed over without an expiry date is refused", async () => {
    mockState.invoice = invoice("purchase");
    render(<InvoiceEditScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-in-fields")).toBeTruthy());
    // Typing a new number keeps the dates already on the line; clear the expiry.
    fireEvent.changeText(screen.getByTestId("batch-number-input"), "SY-78");
    fireEvent.press(screen.getByLabelText("Clear Expiry *"));
    fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith("Batch", expect.stringMatching(/Enter an expiry date for batch SY-78/));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("sale: shows the batch the line was sold from and keeps it, counting the line's own quantity as available", async () => {
    mockState.invoice = invoice("sale", "4");
    // The batch now holds only 1 (the other 4 are on this very invoice).
    mockState.batches = [
      { id: "bat1", batchNumber: "SY-77", mfgDate: null, expiryDate: "2027-06-01", mrp: null, quantity: "1.000", expired: false, daysToExpiry: 200 },
    ];
    mockFetch.mockResolvedValue({ data: mockState.batches });
    render(<InvoiceEditScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-out-picker")).toBeTruthy());
    expect(screen.getByText("SY-77")).toBeTruthy();
    expect(screen.getByText(/5 bottle left/)).toBeTruthy();
    expect(screen.queryByTestId("batch-picked-error")).toBeNull();

    fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0][0].lineItems[0]).toMatchObject({ batchId: "bat1" });
  });

  it("sale: refuses to save more than the batch holds", async () => {
    mockState.invoice = invoice("sale", "4");
    mockState.batches = [
      { id: "bat1", batchNumber: "SY-77", mfgDate: null, expiryDate: "2027-06-01", mrp: null, quantity: "1.000", expired: false, daysToExpiry: 200 },
    ];
    mockFetch.mockResolvedValue({ data: mockState.batches });
    render(<InvoiceEditScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-out-picker")).toBeTruthy());
    // 4 were sold; the batch holds 1 more, so 5 is the most this line can take.
    fireEvent.changeText(screen.getByDisplayValue("4"), "9");
    fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith("Batch", expect.stringMatching(/Only 5 left in batch SY-77/));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it.each(["sale", "purchase"] as const)("%s on a plan without batches: notice, and no batch fields are sent", async (type) => {
    mockState.status = noBatches;
    mockState.invoice = invoice(type);
    render(<InvoiceEditScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-plan-note")).toBeTruthy());
    expect(screen.queryByTestId("batch-in-fields")).toBeNull();
    expect(screen.queryByTestId("batch-out-picker")).toBeNull();

    fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    const line = mockMutate.mock.calls[0][0].lineItems[0];
    expect(line.batchId).toBeUndefined();
    expect(line.batchNumber).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
