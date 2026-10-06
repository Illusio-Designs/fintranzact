import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  settings: { current: null as Record<string, unknown> | null },
  connectMutate: vi.fn(),
  testMutate: vi.fn(),
  disconnectMutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ onlinePayments: { getSettings: { invalidate: h.invalidate } } }),
    onlinePayments: {
      getSettings: { useQuery: () => ({ data: h.settings.current, isLoading: false }) },
      connect: { useMutation: () => ({ mutate: h.connectMutate, isPending: false }) },
      testConnection: { useMutation: () => ({ mutate: h.testMutate, isPending: false }) },
      disconnect: { useMutation: () => ({ mutate: h.disconnectMutate, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OnlinePaymentsTab } from "../OnlinePaymentsTab";

const EVENTS = ["payment_link.paid", "payment_link.partially_paid", "payment_link.cancelled", "payment_link.expired", "payment.captured", "payment.failed"];
const notConnected = { connected: false, keyIdMasked: null, mode: null, hasWebhookSecret: false, webhookUrl: null, webhookEvents: EVENTS, lastTestedAt: null, lastTestOk: null };
const connected = {
  connected: true,
  keyIdMasked: "rzp_live_••••AbCd",
  mode: "live",
  hasWebhookSecret: true,
  webhookUrl: "https://api.example.in/webhooks/razorpay/business/TENANT.TOKEN",
  webhookEvents: EVENTS,
  lastTestedAt: null,
  lastTestOk: null,
};

describe("OnlinePaymentsTab", () => {
  beforeEach(() => {
    h.connectMutate.mockReset();
    h.testMutate.mockReset();
    h.disconnectMutate.mockReset();
  });

  it("asks for the keys when not connected and sends them once, trimmed", () => {
    h.settings.current = notConnected;
    render(<OnlinePaymentsTab />);
    expect(screen.queryByTestId("razorpay-webhook-setup")).toBeNull();
    const submit = screen.getByRole("button", { name: "Connect Razorpay" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Key ID/), { target: { value: "  rzp_live_AbCdEf123456 " } });
    fireEvent.change(screen.getByLabelText(/Key secret/), { target: { value: "the-secret" } });
    fireEvent.change(screen.getByLabelText("Webhook secret"), { target: { value: "whsec" } });
    fireEvent.click(submit);
    expect(h.connectMutate).toHaveBeenCalledWith({ keyId: "rzp_live_AbCdEf123456", keySecret: "the-secret", webhookSecret: "whsec" });
  });

  it("shows only the masked key id and a connected state, never the secrets", () => {
    h.settings.current = connected;
    const { container } = render(<OnlinePaymentsTab />);
    expect(screen.getByTestId("razorpay-connected")).toHaveTextContent("Connected");
    expect(screen.getByTestId("razorpay-key-masked")).toHaveTextContent("rzp_live_••••AbCd");
    expect(container.querySelectorAll("input[type=password]")).toHaveLength(0);
    expect(screen.getByText("Live mode")).toBeInTheDocument();
  });

  it("shows the exact webhook URL and the events to tick", () => {
    h.settings.current = connected;
    render(<OnlinePaymentsTab />);
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("https://api.example.in/webhooks/razorpay/business/TENANT.TOKEN");
    for (const ev of EVENTS) expect(screen.getByText(ev)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns when the webhook secret is not saved yet", () => {
    h.settings.current = { ...connected, hasWebhookSecret: false };
    render(<OnlinePaymentsTab />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not recorded automatically/);
  });

  it("tests the connection and disconnects after confirming", () => {
    h.settings.current = connected;
    render(<OnlinePaymentsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(h.testMutate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(h.disconnectMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" }).at(-1)!);
    expect(h.disconnectMutate).toHaveBeenCalledTimes(1);
  });

  it("opens the key form to change keys, with the secret fields empty", () => {
    h.settings.current = connected;
    render(<OnlinePaymentsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Change keys" }));
    expect(screen.getByLabelText(/Key secret/)).toHaveValue("");
    expect(screen.getByLabelText(/Webhook secret \(leave blank/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save new keys" })).toBeDisabled();
  });
});
