import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { sendMutate, invalidate, state } = vi.hoisted(() => ({
  sendMutate: vi.fn(),
  invalidate: vi.fn(),
  state: { data: undefined as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    reminder: {
      getForInvoice: { useQuery: () => ({ data: state.data, isLoading: !state.data }) },
      sendNow: { useMutation: () => ({ mutate: sendMutate, isPending: false }) },
    },
    useUtils: () => ({ reminder: { getForInvoice: { invalidate } } }),
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InvoiceRemindersSection, reminderStatusBadge } from "../InvoiceRemindersSection";

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

describe("InvoiceRemindersSection", () => {
  beforeEach(() => {
    sendMutate.mockReset();
    state.data = info();
  });

  it("shows the empty state, and sends an email reminder on click", () => {
    render(<InvoiceRemindersSection invoiceId="inv-1" />);
    expect(screen.getByTestId("reminder-history-empty")).toBeInTheDocument();
    expect(screen.getByTestId("reminder-state").textContent).toMatch(/automatic reminders are on/i);
    fireEvent.click(screen.getByRole("button", { name: /send email reminder/i }));
    expect(sendMutate).toHaveBeenCalledWith({ invoiceId: "inv-1", channel: "email" });
  });

  it("disables SMS with the reason", () => {
    render(<InvoiceRemindersSection invoiceId="inv-1" />);
    const sms = screen.getByRole("button", { name: /send sms reminder/i });
    expect(sms).toBeDisabled();
    expect(sms).toHaveAttribute("title", "SMS is not set up on this server.");
  });

  it("the WhatsApp button is a wa.me link that also records the click", () => {
    render(<InvoiceRemindersSection invoiceId="inv-1" />);
    const link = screen.getByRole("link", { name: /send on whatsapp/i });
    expect(link).toHaveAttribute("href", "https://wa.me/919876543210?text=Hello");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    fireEvent.click(link);
    expect(sendMutate).toHaveBeenCalledWith({ invoiceId: "inv-1", channel: "whatsapp" });
  });

  it("lists the history with who, when, channel and outcome (and the error of a failure)", () => {
    state.data = info({
      history: [
        { id: "a", channel: "email", kind: "manual", trigger: "manual", status: "sent", recipient: "pr***@example.in", error: null, sentByName: "Suresh Sharma", createdAt: new Date("2026-10-05T05:00:00Z") },
        { id: "b", channel: "sms", kind: "on_due", trigger: "auto", status: "failed", recipient: "******6780", error: "SMS provider refused the message (HTTP 502)", sentByName: null, createdAt: new Date("2026-10-04T05:00:00Z") },
      ],
    });
    render(<InvoiceRemindersSection invoiceId="inv-1" />);
    const table = screen.getByTestId("reminder-history");
    expect(table.textContent).toContain("Suresh Sharma");
    expect(table.textContent).toContain("Automatic");
    expect(table.textContent).toContain("pr***@example.in");
    expect(table.textContent).toContain("Failed");
    expect(table.textContent).toContain("SMS provider refused the message (HTTP 502)");
    expect(table.textContent).toContain("On the due date");
  });

  it("hides the send buttons when nothing is due or the customer opted out, and says why", () => {
    state.data = info({ blockedReason: "Nothing is due on this invoice." });
    const { unmount } = render(<InvoiceRemindersSection invoiceId="inv-1" />);
    expect(screen.queryByRole("button", { name: /send email reminder/i })).toBeNull();
    expect(screen.getByTestId("reminder-blocked").textContent).toBe("Nothing is due on this invoice.");
    unmount();
    state.data = info({ blockedReason: "This customer is marked Do not remind.", doNotRemind: true });
    render(<InvoiceRemindersSection invoiceId="inv-1" />);
    expect(screen.getByTestId("reminder-state").textContent).toMatch(/do not remind/i);
  });

  it("says automatic reminders are off when the business has not turned them on", () => {
    state.data = info({ remindersEnabled: false });
    render(<InvoiceRemindersSection invoiceId="inv-1" />);
    expect(screen.getByTestId("reminder-state").textContent).toMatch(/automatic reminders are off/i);
  });

  it("maps statuses to badges", () => {
    expect(reminderStatusBadge("sent").label).toBe("Sent");
    expect(reminderStatusBadge("failed").label).toBe("Failed");
    expect(reminderStatusBadge("link_opened").label).toBe("Link opened");
  });
});
