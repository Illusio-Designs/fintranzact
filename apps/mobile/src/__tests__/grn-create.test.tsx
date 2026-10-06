/**
 * The mobile Goods Receipt create screen: supplier, receiving date, item lines, and the inward
 * batch fields for batch-tracked items (batch number required, expiry when the item tracks it),
 * sent only when the plan has batches and expiry.
 */
import React from "react";
import { Alert } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme as render } from "../test-utils";
import { useBusinessStore } from "../stores/business";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }) }));
jest.mock("../lib/haptics", () => ({ haptic: { success: jest.fn(), error: jest.fn(), light: jest.fn() } }));

const mockMutate = jest.fn();
const mockState: { status: unknown; items: unknown[] } = { status: undefined, items: [] };

jest.mock("../lib/trpc", () => {
  const q = (read: () => unknown) => ({ useQuery: () => ({ data: read(), isLoading: false, error: null }) });
  return {
    trpc: {
      useUtils: () => ({
        goodsReceiptNote: { list: { invalidate: jest.fn() } },
        party: { list: { invalidate: jest.fn() } },
        item: { list: { invalidate: jest.fn() } },
        batch: { list: { invalidate: jest.fn() } },
      }),
      business: { list: q(() => [{ id: "biz1", state: "Maharashtra" }]) },
      party: {
        list: q(() => ({ data: [{ id: "sup1", name: "Acme Pharma", phone: null }] })),
        getById: q(() => ({ id: "sup1", state: "Maharashtra" })),
      },
      item: { list: q(() => ({ data: mockState.items })) },
      billing: { status: q(() => mockState.status) },
      batch: { list: q(() => ({ data: [], unbatched: "0.000", asOf: "2026-10-07" })) },
      goodsReceiptNote: {
        create: { useMutation: () => ({ mutate: mockMutate, isPending: false }) },
      },
    },
  };
});

import GoodsReceiptCreateScreen from "../../app/(app)/(more)/goods-receipts/create";

const paracetamol = {
  id: "item1",
  name: "Paracetamol 500",
  salePrice: "30",
  purchasePrice: "20",
  taxPercent: "12",
  unit: "strip",
  trackBatches: true,
  trackExpiry: false,
};

const noBatches = {
  canManageBilling: true,
  topPlanName: "Business",
  features: { batchesExpiry: false },
  featureRequiredPlans: { batchesExpiry: "Growth" },
};

let alertSpy: jest.SpyInstance;

function pickSupplierAndItem() {
  fireEvent.press(screen.getByText("Select supplier..."));
  fireEvent.press(screen.getByText("Acme Pharma"));
  fireEvent.press(screen.getByText("Tap to select item..."));
  fireEvent.press(screen.getByText("Paracetamol 500"));
}

beforeEach(() => {
  mockMutate.mockClear();
  mockState.status = undefined;
  mockState.items = [paracetamol];
  useBusinessStore.setState({ businessId: "biz1", businessName: "Biz" });
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

describe("Goods Receipt create screen", () => {
  it("needs a supplier and an item before it creates anything", () => {
    render(<GoodsReceiptCreateScreen />);
    fireEvent.press(screen.getByText("Create Goods Receipt"));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("asks for a batch number on a batch-tracked item before sending", () => {
    render(<GoodsReceiptCreateScreen />);
    pickSupplierAndItem();
    expect(screen.getByTestId("batch-in-fields")).toBeTruthy();
    // The supplier's price is used for the line.
    expect(screen.getByDisplayValue("20")).toBeTruthy();

    fireEvent.press(screen.getByText("Create Goods Receipt"));
    expect(alertSpy).toHaveBeenCalledWith("Batch", expect.stringMatching(/Enter a batch number for Paracetamol 500/));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("sends a purchase-side goods receipt note with the inward batch fields", () => {
    render(<GoodsReceiptCreateScreen />);
    pickSupplierAndItem();
    fireEvent.changeText(screen.getByTestId("batch-number-input"), "b2407");
    fireEvent.press(screen.getByText("Create Goods Receipt"));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const input = mockMutate.mock.calls[0][0];
    expect(input).toMatchObject({ partyId: "sup1", type: "purchase", documentType: "goods_receipt_note" });
    expect(input.lineItems).toHaveLength(1);
    expect(input.lineItems[0]).toMatchObject({ itemId: "item1", itemName: "Paracetamol 500", quantity: "1", unitPrice: "20", taxPercent: "12", batchNumber: "b2407" });
    // Nothing outward: a GRN brings stock in, it never names a batch to take from.
    expect(input.lineItems[0].batchId).toBeUndefined();
    expect(input.lineItems[0].allowExpired).toBeUndefined();
  });

  it("requires an expiry date when the item tracks expiry", () => {
    mockState.items = [{ ...paracetamol, trackExpiry: true }];
    render(<GoodsReceiptCreateScreen />);
    pickSupplierAndItem();
    expect(screen.getByText("Expiry *")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("batch-number-input"), "B1");
    fireEvent.press(screen.getByText("Create Goods Receipt"));
    expect(alertSpy).toHaveBeenCalledWith("Batch", expect.stringMatching(/Enter an expiry date for batch B1/));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("sends no batch fields and shows the plan notice when the plan lacks batches", () => {
    mockState.status = noBatches;
    render(<GoodsReceiptCreateScreen />);
    pickSupplierAndItem();
    expect(screen.getByTestId("batch-plan-note")).toBeTruthy();
    expect(screen.queryByTestId("batch-in-fields")).toBeNull();

    fireEvent.press(screen.getByText("Create Goods Receipt"));
    expect(alertSpy).not.toHaveBeenCalled();
    const line = mockMutate.mock.calls[0][0].lineItems[0];
    expect(line.batchNumber).toBeUndefined();
    expect(line.expiryDate).toBeUndefined();
    expect(line.batchId).toBeUndefined();
  });

  it("shows no batch block for an item that does not track batches", () => {
    mockState.items = [{ ...paracetamol, trackBatches: false }];
    render(<GoodsReceiptCreateScreen />);
    pickSupplierAndItem();
    expect(screen.queryByTestId("batch-in-fields")).toBeNull();
    fireEvent.press(screen.getByText("Create Goods Receipt"));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0].lineItems[0].batchNumber).toBeUndefined();
  });
});
