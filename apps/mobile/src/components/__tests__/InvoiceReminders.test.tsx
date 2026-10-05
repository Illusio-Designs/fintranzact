import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockInfo: { current: unknown } = { current: undefined };
const mockSend = jest.fn();
let mockSendOptions: { onSuccess?: (r: unknown) => void } = {};

jest.mock("../../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ reminder: { getForInvoice: { invalidate: jest.fn() } } }),
    reminder: {
      getForInvoice: { useQuery: () => ({ data: mockInfo.current, isLoading: !mockInfo.current }) },
      sendNow: {
        useMutation: (opts: { onSuccess?: (r: unknown) => void }) => {
          mockSendOptions = opts;
          return { mutate: mockSend, isPending: false };
        },
      },
    },
  },
}));

import { InvoiceReminders } from "../InvoiceReminders";
import { ThemeProvider } from "../../contexts/ThemeContext";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider initialMode="dark">{ui}</ThemeProvider>);
}

const ok = { available: true, reason: null, nextAt: null };
function info(over: Record<string, unknown> = {}) {
  return {
    balanceDue: "7500.00",
    blockedReason: null,
    remindersEnabled: true,
    doNotRemind: false,
    channels: {
      email: ok,
      sms: { available: false, reason: "SMS is not set up on this server.", nextAt: null },
      whatsapp: { available: true, reason: null, url: "https://wa.me/919876543210?text=Hello" },
    },
    history: [],
    ...over,
  };
}

beforeEach(() => {
  mockSend.mockReset();
  mockInfo.current = info();
});

describe("InvoiceReminders", () => {
  it("shows the state and an empty history, and sends an email reminder", () => {
    wrap(<InvoiceReminders invoiceId="inv-1" />);
    expect(screen.getByTestId("reminder-state").props.children).toMatch(/automatic reminders are on/i);
    expect(screen.getByTestId("reminder-history-empty")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Send email reminder"));
    expect(mockSend).toHaveBeenCalledWith({ invoiceId: "inv-1", channel: "email" });
  });

  it("does not send SMS when the server has no provider, and says why", () => {
    wrap(<InvoiceReminders invoiceId="inv-1" />);
    fireEvent.press(screen.getByLabelText("Send SMS reminder"));
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByText("SMS: SMS is not set up on this server.")).toBeTruthy();
  });

  it("opens the WhatsApp link the server returned after recording it", () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    wrap(<InvoiceReminders invoiceId="inv-1" />);
    fireEvent.press(screen.getByLabelText("Send on WhatsApp"));
    expect(mockSend).toHaveBeenCalledWith({ invoiceId: "inv-1", channel: "whatsapp" });
    mockSendOptions.onSuccess?.({ channel: "whatsapp", status: "link_opened", url: "https://wa.me/919876543210?text=Hello" });
    expect(open).toHaveBeenCalledWith("https://wa.me/919876543210?text=Hello");
    open.mockRestore();
  });

  it("lists who sent what, when and how it went", () => {
    mockInfo.current = info({
      history: [
        { id: "a", channel: "email", kind: "manual", trigger: "manual", status: "sent", recipient: "pr***@example.in", error: null, sentByName: "Suresh Sharma", createdAt: new Date("2026-10-05T05:00:00Z") },
        { id: "b", channel: "sms", kind: "on_due", trigger: "auto", status: "failed", recipient: "******6780", error: "SMS provider refused the message (HTTP 502)", sentByName: null, createdAt: new Date("2026-10-04T05:00:00Z") },
      ],
    });
    wrap(<InvoiceReminders invoiceId="inv-1" />);
    expect(screen.getByText(/Suresh Sharma/)).toBeTruthy();
    expect(screen.getByText(/by Automatic/)).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("SMS provider refused the message (HTTP 502)")).toBeTruthy();
  });

  it("hides the send buttons when nothing can be sent and shows the reason", () => {
    mockInfo.current = info({ blockedReason: "This customer is marked Do not remind.", doNotRemind: true });
    wrap(<InvoiceReminders invoiceId="inv-1" />);
    expect(screen.queryByLabelText("Send email reminder")).toBeNull();
    expect(screen.getByTestId("reminder-blocked").props.children).toBe("This customer is marked Do not remind.");
  });
});
