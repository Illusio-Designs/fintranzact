import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DEFAULT_PAYMENT_REMINDER_SETTINGS } from "@fintranzact/shared";

const { saveMutate, invalidate, state, toastSuccess, toastError } = vi.hoisted(() => ({
  saveMutate: vi.fn(),
  invalidate: vi.fn(),
  state: { data: undefined as unknown },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    reminder: {
      getSettings: { useQuery: () => ({ data: state.data, isLoading: !state.data }) },
      updateSettings: { useMutation: () => ({ mutate: saveMutate, isPending: false }) },
    },
    useUtils: () => ({ reminder: { getSettings: { invalidate } } }),
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { PaymentRemindersTab } from "../PaymentRemindersTab";

describe("PaymentRemindersTab", () => {
  beforeEach(() => {
    saveMutate.mockReset();
    state.data = { settings: DEFAULT_PAYMENT_REMINDER_SETTINGS, smsAvailable: false };
  });

  it("starts switched off with the default schedule and nothing to save", () => {
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    expect(screen.getByRole("switch", { name: /send payment reminders automatically/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Days before the due date")).toHaveValue(3);
    expect(screen.getByLabelText("Repeat every days after the due date")).toHaveValue(7);
    expect(screen.getByLabelText("Most reminders per invoice")).toHaveValue(4);
    expect(screen.getByRole("button", { name: /save settings/i })).toBeDisabled();
  });

  it("saves the owner's changes", () => {
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    fireEvent.click(screen.getByRole("switch", { name: /send payment reminders automatically/i }));
    fireEvent.change(screen.getByLabelText("Days before the due date"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0]![0]).toMatchObject({ enabled: true, daysBefore: 5, repeatEveryDays: 7, maxReminders: 4 });
  });

  it("previews each message with sample values and the business name", () => {
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    const email = screen.getByTestId("preview-email");
    expect(email.textContent).toContain("Sharma Traders");
    expect(email.textContent).toContain("INV-0042");
    expect(email.textContent).toContain("Sharma Electronics");
    expect(email.textContent).not.toContain("{{");
    // No payment link in the sample, so the "Pay online" line is left out of the preview.
    expect(email.textContent).not.toContain("Pay online");
    expect(screen.getByTestId("preview-sms").textContent).not.toContain("{{");
  });

  it("the preview follows the wording being typed, as text and never as markup", () => {
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    fireEvent.change(screen.getByLabelText("WhatsApp message"), { target: { value: "Hi {{customerName}} <b>pay</b>" } });
    const wa = screen.getByTestId("preview-whatsapp");
    expect(wa.textContent).toBe("Hi Sharma Traders <b>pay</b>");
    expect(wa.querySelector("b")).toBeNull();
  });

  it("cannot be saved with an empty message", () => {
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    fireEvent.change(screen.getByLabelText("Email message"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /save settings/i })).toBeDisabled();
    expect(screen.getByText(/every message needs some text/i)).toBeInTheDocument();
  });

  it("offers the standard wording back after an edit", () => {
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    const box = screen.getByLabelText("SMS message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "custom" } });
    fireEvent.click(within(screen.getByTestId("template-sms")).getByRole("button", { name: /standard wording/i }));
    expect(box.value).toBe(DEFAULT_PAYMENT_REMINDER_SETTINGS.templates.sms);
  });

  it("says SMS is not set up on this server, and does not let it be switched on", () => {
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    expect(screen.getByTestId("sms-note").textContent).toMatch(/not available on this server/i);
    expect(screen.getByRole("checkbox", { name: /^SMS/ })).toBeDisabled();
  });

  it("lets SMS be switched on when the server has a provider", () => {
    state.data = { settings: DEFAULT_PAYMENT_REMINDER_SETTINGS, smsAvailable: true };
    render(<PaymentRemindersTab biz={{ name: "Sharma Electronics" }} />);
    const sms = screen.getByRole("checkbox", { name: /^SMS/ });
    expect(sms).not.toBeDisabled();
    fireEvent.click(sms);
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    expect(saveMutate.mock.calls[0]![0].channels).toEqual({ email: true, sms: true, whatsapp: true });
  });
});
