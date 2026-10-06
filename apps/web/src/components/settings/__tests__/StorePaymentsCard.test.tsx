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
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, ...rest }: { children: React.ReactNode; to: string; search?: Record<string, string> } & Record<string, unknown>) => (
    <a href={`${to}?tab=${search?.tab ?? ""}`} {...rest}>{children}</a>
  ),
}));

import { StorePaymentsCard } from "../StorePaymentsCard";

function settings(over: Record<string, unknown> = {}, payments: Record<string, unknown> = {}) {
  return {
    storeOnlinePaymentsEnabled: false,
    storeCodEnabled: true,
    payments: { connected: false, hasWebhookSecret: false, mode: null, onlineActive: false, ...payments },
    ...over,
  };
}

describe("StorePaymentsCard", () => {
  beforeEach(() => {
    h.mutate.mockReset();
    h.settings.current = settings();
  });

  it("points an unconnected business to Online payments and keeps Pay online off", () => {
    render(<StorePaymentsCard />);
    expect(screen.getByText("Razorpay is not connected")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Connect Razorpay" });
    expect(link).toHaveAttribute("href", "/settings?tab=payments");
    expect(screen.getByRole("switch", { name: "Accept online payments at checkout" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Offer Cash on Delivery" })).toBeEnabled();
  });

  it("explains that the webhook secret is needed, and keeps Pay online off without it", () => {
    h.settings.current = settings({}, { connected: true, mode: "test", hasWebhookSecret: false });
    render(<StorePaymentsCard />);
    expect(screen.getByRole("alert")).toHaveTextContent(/webhook secret/i);
    expect(screen.getByText(/test mode/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Accept online payments at checkout" })).toBeDisabled();
  });

  it("switches Pay online on once Razorpay is ready, and Cash on Delivery off", () => {
    h.settings.current = settings({}, { connected: true, mode: "live", hasWebhookSecret: true });
    render(<StorePaymentsCard />);
    expect(screen.getByText(/live mode/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Accept online payments at checkout" }));
    expect(h.mutate).toHaveBeenLastCalledWith({ storeOnlinePaymentsEnabled: true });
    fireEvent.click(screen.getByRole("switch", { name: "Offer Cash on Delivery" }));
    expect(h.mutate).toHaveBeenLastCalledWith({ storeCodEnabled: false });
  });

  it("lets the owner switch Pay online off even if the connection was removed", () => {
    h.settings.current = settings({ storeOnlinePaymentsEnabled: true }, { connected: false });
    render(<StorePaymentsCard />);
    const sw = screen.getByRole("switch", { name: "Accept online payments at checkout" });
    expect(sw).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/not ready/i);
    fireEvent.click(sw);
    expect(h.mutate).toHaveBeenLastCalledWith({ storeOnlinePaymentsEnabled: false });
  });

  it("reminds that it is the same webhook as invoice payments and never shows keys", () => {
    h.settings.current = settings({}, { connected: true, mode: "test", hasWebhookSecret: true });
    const { container } = render(<StorePaymentsCard />);
    expect(screen.getByTestId("store-payments-webhook-note")).toHaveTextContent(/same webhook/);
    expect(container.textContent).not.toMatch(/rzp_/);
  });
});
