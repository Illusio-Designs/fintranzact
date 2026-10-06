import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  settings: { current: undefined as unknown },
  mutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ store: { getSettings: { invalidate: h.invalidate } } }),
    store: {
      getSettings: { useQuery: () => ({ data: h.settings.current, isLoading: !h.settings.current }) },
      updateSettings: { useMutation: () => ({ mutate: h.mutate, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { StoreDeliveryCard, validateDeliveryAmount } from "../StoreDeliveryCard";

function settings(over: Record<string, unknown> = {}) {
  return { storeDeliveryFee: "0.00", storeFreeDeliveryAbove: null, storeDeliveryNote: null, ...over };
}

const fee = () => screen.getByLabelText(/Delivery fee/);
const freeAbove = () => screen.getByLabelText(/Free delivery on orders of/);
const note = () => screen.getByLabelText("Delivery Note");

describe("StoreDeliveryCard", () => {
  beforeEach(() => {
    h.mutate.mockReset();
    h.settings.current = settings();
  });

  it("starts with free delivery and nothing to save", () => {
    render(<StoreDeliveryCard />);
    expect(fee()).toHaveValue("0");
    expect(freeAbove()).toHaveValue("");
    expect(screen.getByTestId("store-delivery-preview-free")).toHaveTextContent("Free delivery");
    expect(screen.getByRole("button", { name: "No changes" })).toBeDisabled();
  });

  it("shows saved values as plain numbers and previews what shoppers see", () => {
    h.settings.current = settings({ storeDeliveryFee: "49.00", storeFreeDeliveryAbove: "500.00", storeDeliveryNote: "Delivery in 3-5 working days" });
    render(<StoreDeliveryCard />);
    expect(fee()).toHaveValue("49");
    expect(freeAbove()).toHaveValue("500");
    expect(note()).toHaveValue("Delivery in 3-5 working days");
    expect(screen.getByTestId("store-delivery-preview-fee")).toHaveTextContent(/Delivery .*49\.00.*Add .*250\.00 more for free delivery/);
    expect(screen.getByTestId("store-delivery-preview-threshold")).toHaveTextContent(/500\.00.* or more: Free delivery/);
    expect(screen.getByTestId("store-delivery-preview")).toHaveTextContent("Delivery in 3-5 working days");
  });

  it("saves the fee, the threshold and the note together", () => {
    render(<StoreDeliveryCard />);
    fireEvent.change(fee(), { target: { value: "49.50" } });
    fireEvent.change(freeAbove(), { target: { value: "999" } });
    fireEvent.change(note(), { target: { value: "  Ships in 2 days " } });
    fireEvent.click(screen.getByRole("button", { name: "Save delivery settings" }));
    expect(h.mutate).toHaveBeenCalledWith({ storeDeliveryFee: "49.50", storeFreeDeliveryAbove: "999", storeDeliveryNote: "Ships in 2 days" });
  });

  it("clears the threshold and the note with null, and a fee of 0 means free delivery", () => {
    h.settings.current = settings({ storeDeliveryFee: "49.00", storeFreeDeliveryAbove: "500.00", storeDeliveryNote: "x" });
    render(<StoreDeliveryCard />);
    fireEvent.change(fee(), { target: { value: "0" } });
    fireEvent.change(freeAbove(), { target: { value: "" } });
    fireEvent.change(note(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save delivery settings" }));
    expect(h.mutate).toHaveBeenCalledWith({ storeDeliveryFee: "0", storeFreeDeliveryAbove: null, storeDeliveryNote: null });
  });

  it("validates the amounts and blocks saving", () => {
    render(<StoreDeliveryCard />);
    fireEvent.change(fee(), { target: { value: "-5" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/amount in rupees/);
    expect(screen.getByRole("button", { name: "Save delivery settings" })).toBeDisabled();
    fireEvent.change(fee(), { target: { value: "10001" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/At most/);
    fireEvent.change(fee(), { target: { value: "40" } });
    fireEvent.change(freeAbove(), { target: { value: "12.345" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/amount in rupees/);
    expect(screen.getByRole("button", { name: "Save delivery settings" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save delivery settings" }));
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("tells the owner how the invoice treats GST on the fee", () => {
    render(<StoreDeliveryCard />);
    expect(screen.getByTestId("store-delivery-gst-note")).toHaveTextContent(/highest GST rate/);
    expect(screen.getByTestId("store-delivery-gst-note")).toHaveTextContent(/CA/);
  });
});

describe("validateDeliveryAmount", () => {
  it("accepts amounts up to the maximum with at most two decimals", () => {
    expect(validateDeliveryAmount("0", 10000, { required: true })).toBeNull();
    expect(validateDeliveryAmount("10000", 10000, { required: true })).toBeNull();
    expect(validateDeliveryAmount("49.5", 10000, { required: true })).toBeNull();
    expect(validateDeliveryAmount("", 10000, { required: false })).toBeNull();
  });
  it("refuses empty (when required), negative, long decimals, text and too much", () => {
    expect(validateDeliveryAmount("", 10000, { required: true })).not.toBeNull();
    for (const bad of ["-1", "1.234", "abc", "1e3", "10000.01"]) expect(validateDeliveryAmount(bad, 10000, { required: true })).not.toBeNull();
  });
});
