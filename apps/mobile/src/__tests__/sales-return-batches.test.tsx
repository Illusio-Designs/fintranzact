/**
 * Sales return on mobile: returned goods come back into stock, so a batch-tracked line carries the
 * batch it was sold from (copied from the invoice), or a batch typed in. Nothing batch-related is
 * sent on a plan without batches.
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
  useLocalSearchParams: () => ({ prefillFromInvoiceId: "inv1" }),
}));
jest.mock("../lib/haptics", () => ({ haptic: { success: jest.fn(), error: jest.fn(), light: jest.fn() } }));

const mockMutate = jest.fn();
// One stable object: a fresh one per render would re-run the screen's prefill effect forever.
const mockState: { status: unknown; sourceInvoice: unknown } = {
  status: undefined,
  sourceInvoice: {
    id: "inv1",
    type: "sale",
    partyId: "p1",
    party: { name: "Party One" },
    lineItems: [
      {
        id: "l1",
        itemId: "item1",
        itemName: "Syrup",
        description: null,
        quantity: "2",
        unitPrice: "40",
        taxPercent: "12",
        discountPercent: "0",
        batchId: "bat1",
        batch: { id: "bat1", batchNumber: "SY-77", mfgDate: null, expiryDate: "2027-06-01", mrp: null },
      },
    ],
  },
};

jest.mock("../lib/trpc", () => {
  const q = (read: () => unknown) => ({ useQuery: () => ({ data: read(), isLoading: false, error: null }) });
  const inval = { invalidate: jest.fn() };
  return {
    trpc: {
      useUtils: () => ({ salesReturn: { list: inval }, invoice: { list: inval }, dashboard: { summary: inval }, party: { list: inval }, item: { list: inval } }),
      business: { list: q(() => [{ id: "biz1", state: "Maharashtra" }]) },
      party: { getById: q(() => ({ id: "p1", state: "Maharashtra" })), list: q(() => ({ data: [] })) },
      item: { list: q(() => ({ data: [{ id: "item1", name: "Syrup", unit: "bottle", taxPercent: "12", trackBatches: true, trackExpiry: true }] })) },
      billing: { status: q(() => mockState.status) },
      batch: { list: q(() => ({ data: [], unbatched: "0.000", asOf: "2026-10-07" })) },
      invoice: {
        getById: q(() => mockState.sourceInvoice),
      },
      salesReturn: { create: { useMutation: () => ({ mutate: mockMutate, isPending: false }) } },
    },
  };
});

import SalesReturnCreateScreen from "../../app/(app)/(more)/sales-returns/create";

const noBatches = {
  canManageBilling: true,
  topPlanName: "Business",
  features: { batchesExpiry: false },
  featureRequiredPlans: { batchesExpiry: "Growth" },
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockMutate.mockClear();
  mockState.status = undefined;
  useBusinessStore.setState({ businessId: "biz1", businessName: "Biz" });
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

describe("Sales return: batch fields", () => {
  it("brings the goods back into the batch they were sold from", async () => {
    render(<SalesReturnCreateScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-in-fields")).toBeTruthy());
    expect(screen.getByDisplayValue("SY-77")).toBeTruthy();

    fireEvent.press(screen.getByText("Create Sales Return"));
    expect(alertSpy).not.toHaveBeenCalled();
    const input = mockMutate.mock.calls[0][0];
    expect(input).toMatchObject({ type: "sale", documentType: "sales_return", referenceDocumentId: "inv1" });
    expect(input.lineItems[0]).toMatchObject({ itemId: "item1", batchId: "bat1" });
    expect(input.lineItems[0].batchNumber).toBeUndefined();
  });

  it("sends a different batch typed in instead of the sold one", async () => {
    render(<SalesReturnCreateScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-in-fields")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("batch-number-input"), "SY-99");
    fireEvent.press(screen.getByText("Create Sales Return"));
    const line = mockMutate.mock.calls[0][0].lineItems[0];
    expect(line).toMatchObject({ batchNumber: "SY-99", expiryDate: "2027-06-01" });
    expect(line.batchId).toBeUndefined();
  });

  it("asks for a batch number when the batch was cleared", async () => {
    render(<SalesReturnCreateScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-in-fields")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("batch-number-input"), "");
    fireEvent.press(screen.getByText("Create Sales Return"));
    expect(alertSpy).toHaveBeenCalledWith("Batch", expect.stringMatching(/Enter a batch number for Syrup/));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows the plan notice and sends no batch fields on a plan without batches", async () => {
    mockState.status = noBatches;
    render(<SalesReturnCreateScreen />);
    await waitFor(() => expect(screen.getByTestId("batch-plan-note")).toBeTruthy());
    fireEvent.press(screen.getByText("Create Sales Return"));
    const line = mockMutate.mock.calls[0][0].lineItems[0];
    expect(line.batchId).toBeUndefined();
    expect(line.batchNumber).toBeUndefined();
  });
});
