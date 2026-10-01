/**
 * DemoCheckout — the test-mode plan checkout: field checks (Luhn, expiry,
 * UPI ID), the order total with GST, and paying through billing.demoCheckout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { cvvValid, expiryValid, formatCardNumber, formatExpiry, luhnValid, upiIdValid } from "@/lib/demo-payment";

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useToast", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: { demoCheckout: { useMutation: () => ({ mutateAsync, isPending: false }) } },
  },
}));

import { DemoCheckout } from "../DemoCheckout";

const PRO = { id: "pro" as const, name: "Pro", monthlyPriceInr: 999 };

function renderCheckout(onContinue = vi.fn()) {
  render(<DemoCheckout open plan={PRO} cycle="monthly" onClose={vi.fn()} onContinue={onContinue} processingDelayMs={0} />);
  return { onContinue };
}

const payButton = () => screen.getByRole("button", { name: /^Pay ₹/ });

describe("demo payment field checks", () => {
  it("accepts card numbers that pass the Luhn check", () => {
    expect(luhnValid("4111 1111 1111 1111")).toBe(true);
    expect(luhnValid("5555555555554444")).toBe(true);
    expect(luhnValid("4111 1111 1111 1112")).toBe(false);
    expect(luhnValid("4111")).toBe(false);
    expect(formatCardNumber("4111111111111111")).toBe("4111 1111 1111 1111");
  });

  it("accepts an expiry this month or later, never in the past", () => {
    const now = new Date(2026, 9, 1); // October 2026
    expect(expiryValid("10/26", now)).toBe(true);
    expect(expiryValid("01/30", now)).toBe(true);
    expect(expiryValid("09/26", now)).toBe(false);
    expect(expiryValid("13/27", now)).toBe(false);
    expect(expiryValid("00/27", now)).toBe(false);
    expect(expiryValid("1027", now)).toBe(false);
    expect(formatExpiry("1028")).toBe("10/28");
  });

  it("checks CVV and UPI IDs", () => {
    expect(cvvValid("123")).toBe(true);
    expect(cvvValid("12")).toBe(false);
    expect(cvvValid("12a")).toBe(false);
    expect(upiIdValid("anjali.mehta@okhdfcbank")).toBe(true);
    expect(upiIdValid("9876543210@ybl")).toBe(true);
    expect(upiIdValid("anjali")).toBe(false);
    expect(upiIdValid("anjali@")).toBe(false);
    expect(upiIdValid("@okicici")).toBe(false);
    expect(upiIdValid("anjali@1bank")).toBe(false);
  });
});

describe("DemoCheckout", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it("shows test mode and the total with 18% GST in rupees", () => {
    renderCheckout();
    expect(screen.getByRole("dialog", { name: "Pay for Pro" })).toBeInTheDocument();
    expect(screen.getByText("Test mode — no money is taken")).toBeInTheDocument();
    expect(screen.getByText("₹999.00")).toBeInTheDocument();
    expect(screen.getByText("₹179.82")).toBeInTheDocument();
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("₹1,178.82");
    expect(payButton()).toHaveTextContent("Pay ₹1,178.82");
  });

  it("keeps Pay disabled until the UPI ID is valid", () => {
    renderCheckout();
    const upi = screen.getByLabelText("UPI ID");
    expect(payButton()).toBeDisabled();
    fireEvent.change(upi, { target: { value: "anjali" } });
    fireEvent.blur(upi);
    expect(screen.getByText("Enter a UPI ID like name@bank")).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
    fireEvent.change(upi, { target: { value: "anjali@okhdfcbank" } });
    expect(payButton()).toBeEnabled();
  });

  it("checks the card number, expiry, CVV and name", () => {
    renderCheckout();
    fireEvent.click(screen.getByRole("tab", { name: "Card" }));
    expect(screen.getByText("Use test card 4111 1111 1111 1111")).toBeInTheDocument();

    const number = screen.getByLabelText("Card number") as HTMLInputElement;
    fireEvent.change(number, { target: { value: "4111111111111112" } });
    fireEvent.blur(number);
    expect(number.value).toBe("4111 1111 1111 1112");
    expect(screen.getByText("Enter a valid card number")).toBeInTheDocument();

    fireEvent.change(number, { target: { value: "4111111111111111" } });
    fireEvent.change(screen.getByLabelText("Expiry (MM/YY)"), { target: { value: "0120" } });
    fireEvent.blur(screen.getByLabelText("Expiry (MM/YY)"));
    expect(screen.getByText(/valid expiry date/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("CVV"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Name on card"), { target: { value: "Anjali Mehta" } });
    expect(payButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Expiry (MM/YY)"), { target: { value: "12/99" } });
    expect(payButton()).toBeEnabled();
  });

  it("needs a bank for netbanking", () => {
    renderCheckout();
    fireEvent.click(screen.getByRole("tab", { name: "Netbanking" }));
    expect(payButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "HDFC Bank" }));
    expect(payButton()).toBeEnabled();
  });

  it("pays, shows the payment id and continues", async () => {
    mutateAsync.mockResolvedValue({ paymentId: "pay_demo_AbCdEfGhIjKlMn", plan: "pro", amountPaise: 117_882, cycle: "monthly" });
    const { onContinue } = renderCheckout();
    fireEvent.change(screen.getByLabelText("UPI ID"), { target: { value: "anjali@okhdfcbank" } });
    fireEvent.click(payButton());

    expect(await screen.findByText("Payment successful")).toBeInTheDocument();
    expect(mutateAsync).toHaveBeenCalledWith({ plan: "pro", cycle: "monthly", method: "upi" });
    expect(screen.getByTestId("payment-id")).toHaveTextContent("pay_demo_AbCdEfGhIjKlMn");

    fireEvent.click(screen.getByRole("button", { name: "Continue to set up your business" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
  });

  it("shows a failed payment as a toast and lets the owner try again", async () => {
    mutateAsync.mockRejectedValue(new Error("Only the organization owner can change the plan."));
    renderCheckout();
    fireEvent.change(screen.getByLabelText("UPI ID"), { target: { value: "anjali@okhdfcbank" } });
    fireEvent.click(payButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Payment didn't go through", "Only the organization owner can change the plan."),
    );
    expect(payButton()).toBeEnabled();
    expect(screen.queryByText("Payment successful")).not.toBeInTheDocument();
  });
});
