import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  can: { current: true },
  mutate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ store: { getOrder: { invalidate: vi.fn() }, listOrders: { invalidate: vi.fn() } } }),
    store: { refundOrder: { useMutation: () => ({ mutate: h.mutate, isPending: false }) } },
  },
}));
vi.mock("@/lib/permissions", () => ({ useCan: () => h.can.current }));
vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { StoreOrderPayment, hasRefundableMoney, type StoreOrderPaymentData } from "../StoreOrderPayment";

function order(over: Partial<StoreOrderPaymentData> = {}): StoreOrderPaymentData {
  return {
    id: "ord-1",
    orderNumber: "ORD-00001",
    paymentMethod: "online",
    paymentStatus: "paid",
    paidAt: "2026-10-06T10:00:00.000Z",
    refundedAmount: "0.00",
    refundable: "118.00",
    razorpayPayments: [{ razorpayPaymentId: "pay_Abc123", amount: "118.00", fee: "2.36", method: "upi", createdAt: "2026-10-06T10:00:00.000Z" }],
    refunds: [],
    ...over,
  };
}

describe("StoreOrderPayment", () => {
  beforeEach(() => {
    h.mutate.mockReset();
    h.can.current = true;
  });

  it("shows how the order was paid, the Razorpay reference and the status", () => {
    render(<StoreOrderPayment order={order()} />);
    expect(screen.getByText("Paid online (Razorpay)")).toBeInTheDocument();
    expect(screen.getByTestId("payment-status")).toHaveTextContent("Paid");
    expect(screen.getByTestId("razorpay-payment")).toHaveTextContent("pay_Abc123");
    expect(screen.getByTestId("razorpay-payment")).toHaveTextContent("fee");
  });

  it("shows a Cash on Delivery order as such, with no refund action", () => {
    render(<StoreOrderPayment order={order({ paymentMethod: "cod", paymentStatus: "unpaid", paidAt: null, refundable: "0.00", razorpayPayments: [] })} />);
    expect(screen.getByText("Cash on Delivery")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refund/i })).toBeNull();
  });

  it("an unpaid online order says it is waiting for the shopper", () => {
    render(<StoreOrderPayment order={order({ paymentStatus: "unpaid", paidAt: null, refundable: "0.00", razorpayPayments: [] })} />);
    expect(screen.getByTestId("payment-status")).toHaveTextContent("Unpaid");
    expect(screen.getByText(/Waiting for the shopper/)).toBeInTheDocument();
  });

  it("refunds everything left when the amount is blank, after a confirmation", () => {
    render(<StoreOrderPayment order={order()} />);
    fireEvent.click(screen.getByRole("button", { name: /Refund…/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review refund" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("118.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Refund" }));
    expect(h.mutate).toHaveBeenCalledTimes(1);
    const call = h.mutate.mock.calls[0]![0];
    expect(call).toMatchObject({ orderId: "ord-1", amount: undefined });
    expect(call.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("refunds a typed part, with the reason, and rejects an amount above what is left", () => {
    render(<StoreOrderPayment order={order()} />);
    fireEvent.click(screen.getByRole("button", { name: /Refund…/ }));
    fireEvent.change(screen.getByLabelText(/Amount to refund/), { target: { value: "500" } });
    expect(screen.getByRole("button", { name: "Review refund" })).toBeDisabled();
    expect(screen.getByText(/Enter an amount from 1.00 up to 118.00/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Amount to refund/), { target: { value: "50.50" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Scratched" } });
    fireEvent.click(screen.getByRole("button", { name: "Review refund" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Refund" }));
    expect(h.mutate.mock.calls[0]![0]).toMatchObject({ orderId: "ord-1", amount: "50.50", reason: "Scratched" });
  });

  it("lists refunds made, and offers no refund once everything is back", () => {
    render(
      <StoreOrderPayment
        order={order({
          paymentStatus: "refunded",
          refundedAmount: "118.00",
          refundable: "0.00",
          refunds: [{ id: "r1", amount: "118.00", status: "processed", razorpayRefundId: "rfnd_1", reason: "Out of stock", createdAt: "2026-10-06T11:00:00.000Z" }],
        })}
      />,
    );
    expect(screen.getByTestId("payment-status")).toHaveTextContent("Refunded");
    expect(screen.getByTestId("store-refund")).toHaveTextContent("Out of stock");
    expect(screen.queryByRole("button", { name: /Refund…/ })).toBeNull();
  });

  it("hides the refund action from someone who cannot manage the store", () => {
    h.can.current = false;
    render(<StoreOrderPayment order={order()} />);
    expect(screen.queryByRole("button", { name: /Refund…/ })).toBeNull();
    expect(screen.getByText(/Only an owner or admin can refund/)).toBeInTheDocument();
  });
});

describe("hasRefundableMoney", () => {
  it("is true only while something can still be refunded", () => {
    expect(hasRefundableMoney({ refundable: "118.00" })).toBe(true);
    expect(hasRefundableMoney({ refundable: "0.00" })).toBe(false);
  });
});
