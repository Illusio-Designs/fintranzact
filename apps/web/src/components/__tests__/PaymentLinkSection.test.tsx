import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  data: { current: undefined as unknown },
  isLoading: { current: false },
  mutate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ onlinePayments: { invoiceLink: { invalidate: vi.fn() } } }),
    onlinePayments: {
      invoiceLink: { useQuery: () => ({ data: h.data.current, isLoading: h.isLoading.current }) },
      createInvoiceLink: { useMutation: () => ({ mutate: h.mutate, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PaymentLinkSection } from "../PaymentLinkSection";

const props = { invoiceId: "inv-1", documentLabel: "Invoice INV-001", partyPhone: "98765 43210" };

describe("PaymentLinkSection", () => {
  beforeEach(() => {
    h.mutate.mockReset();
    h.isLoading.current = false;
  });

  it("renders nothing when Razorpay is not connected or the invoice cannot be paid online", () => {
    h.data.current = { connected: false, canPay: false, reason: null, balance: "100.00", link: null };
    const { container, rerender } = render(<PaymentLinkSection {...props} />);
    expect(container).toBeEmptyDOMElement();
    h.data.current = { connected: true, canPay: false, reason: "paid", balance: "0.00", link: null };
    rerender(<PaymentLinkSection {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to make a link for the balance due", () => {
    h.data.current = { connected: true, canPay: true, reason: null, balance: "1180.00", link: null };
    render(<PaymentLinkSection {...props} />);
    expect(screen.getByTestId("payment-link-section")).toHaveTextContent("1,180");
    fireEvent.click(screen.getByRole("button", { name: /Get payment link/ }));
    // Only the invoice id goes to the server: the amount is computed there.
    expect(h.mutate).toHaveBeenCalledWith({ invoiceId: "inv-1" });
  });

  it("shows copy, WhatsApp and open for a current link", () => {
    h.data.current = { connected: true, canPay: true, reason: null, balance: "1180.00", link: { url: "https://rzp.io/i/abc", amount: "1180.00", current: true, createdAt: new Date() } };
    render(<PaymentLinkSection {...props} />);
    expect(screen.getByLabelText("Payment link")).toHaveValue("https://rzp.io/i/abc");
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://rzp.io/i/abc");
    const wa = screen.getByRole("link", { name: "WhatsApp" }).getAttribute("href")!;
    expect(wa).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(decodeURIComponent(wa)).toContain("https://rzp.io/i/abc");
  });

  it("offers a new link when the balance moved since the last one", () => {
    h.data.current = { connected: true, canPay: true, reason: null, balance: "600.00", link: { url: "https://rzp.io/i/old", amount: "1000.00", current: false, createdAt: new Date() } };
    render(<PaymentLinkSection {...props} />);
    expect(screen.queryByLabelText("Payment link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /New link/ }));
    expect(h.mutate).toHaveBeenCalledWith({ invoiceId: "inv-1" });
  });
});
