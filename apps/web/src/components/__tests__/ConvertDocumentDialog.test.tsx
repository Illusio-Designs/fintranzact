/**
 * ConvertDocumentDialog — free quantities and rejections on receipt.
 *
 * Billed and free quantities are taken separately; receiving a purchase
 * order on a GRN also records rejected quantities, which need a reason.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { convertMutate, fulfilment } = vi.hoisted(() => ({
  convertMutate: vi.fn(),
  fulfilment: {
    current: null as unknown,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    orders: { fulfilment: { useQuery: () => ({ data: fulfilment.current, isLoading: false }) } },
    stock: { warehouses: { useQuery: () => ({ data: [{ id: "wh-1", name: "Main", status: "active" }], isLoading: false }) } },
    document: { convert: { useMutation: () => ({ mutate: convertMutate, isPending: false }) } },
    useUtils: () => ({}),
  },
}));

vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConvertDocumentDialog } from "../ConvertDocumentDialog";

function poWith(line: Record<string, unknown>) {
  return {
    id: "po-1",
    documentType: "purchase_order",
    status: "open",
    closedAt: null,
    convertsTo: ["goods_receipt_note", "invoice"],
    rejections: [],
    linkedDocuments: [],
    lines: [{
      lineId: "11111111-1111-4111-8111-111111111111",
      documentId: "po-1",
      itemId: "item-1",
      variantId: null,
      itemName: "Soap",
      description: null,
      selectedUnit: null,
      conversionFactor: "1",
      unitPrice: "10",
      taxPercent: "0",
      discountPercent: "0",
      ordered: 10, fulfilled: 0, pending: 10,
      freeOrdered: 1, freeFulfilled: 0, freePending: 1,
      rejected: 0,
      ...line,
    }],
  };
}

const targets = [
  { type: "goods_receipt_note" as const, label: "GRN" },
  { type: "invoice" as const, label: "Purchase Invoice" },
];

describe("ConvertDocumentDialog", () => {
  beforeEach(() => {
    convertMutate.mockClear();
    fulfilment.current = poWith({});
  });

  it("starts at what is pending, billed and free, and sends both", () => {
    render(<ConvertDocumentDialog sourceId="po-1" targets={targets} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Accepted quantity of Soap") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Free quantity of Soap") as HTMLInputElement).value).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Create GRN" }));
    expect(convertMutate).toHaveBeenCalledWith(expect.objectContaining({
      targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: "11111111-1111-4111-8111-111111111111", quantity: "10", freeQuantity: "1" }],
    }));
  });

  it("records rejected goods with a reason when receiving", () => {
    render(<ConvertDocumentDialog sourceId="po-1" targets={targets} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Accepted quantity of Soap"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Rejected quantity of Soap"), { target: { value: "3" } });

    const create = screen.getByRole("button", { name: "Create GRN" });
    expect(screen.getByText("Give a reason for each rejection.")).toBeInTheDocument();
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for rejecting Soap"), { target: { value: "Damaged" } });
    fireEvent.click(create);
    expect(convertMutate).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{
        sourceLineId: "11111111-1111-4111-8111-111111111111",
        quantity: "7", freeQuantity: "1", rejectedQuantity: "3", rejectionReason: "Damaged",
      }],
    }));
  });

  it("refuses accepted + rejected beyond what is pending", () => {
    render(<ConvertDocumentDialog sourceId="po-1" targets={targets} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Rejected quantity of Soap"), { target: { value: "1" } });
    expect(screen.getByText("Accepted and rejected come to more than what is pending.")).toBeInTheDocument();
  });

  it("has no rejection columns when billing", () => {
    render(<ConvertDocumentDialog sourceId="po-1" targets={targets} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Purchase Invoice" }));
    expect(screen.queryByLabelText("Rejected quantity of Soap")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity of Soap")).toBeInTheDocument();
  });

  it("has no free column when nothing on the order is free", () => {
    fulfilment.current = poWith({ freeOrdered: 0, freePending: 0 });
    render(<ConvertDocumentDialog sourceId="po-1" targets={targets} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Free quantity of Soap")).not.toBeInTheDocument();
  });

  it("shows goods rejected on earlier GRNs", () => {
    fulfilment.current = poWith({ fulfilled: 6, pending: 4, rejected: 4 });
    render(<ConvertDocumentDialog sourceId="po-1" targets={targets} onClose={vi.fn()} />);
    expect(screen.getByText(/4 rejected earlier/)).toBeInTheDocument();
  });
});
