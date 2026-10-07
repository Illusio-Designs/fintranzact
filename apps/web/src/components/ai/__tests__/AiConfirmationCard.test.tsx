import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";

const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  cancel: vi.fn(),
  update: vi.fn(),
  polled: { current: undefined as unknown },
  pollEnabled: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    ai: {
      confirmAction: { useMutation: () => ({ mutateAsync: h.confirm }) },
      cancelAction: { useMutation: () => ({ mutateAsync: h.cancel }) },
      updateAction: { useMutation: () => ({ mutateAsync: h.update }) },
      action: { useQuery: (_i: unknown, o: { enabled?: boolean }) => { h.pollEnabled(o.enabled); return { data: o.enabled ? h.polled.current : undefined }; } },
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, ...rest }: { children: React.ReactNode; to: string; search?: Record<string, string> }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>{children}</a>
  ),
}));

import { AiCards } from "../AiCards";
import { AiConfirmationCardView } from "../AiConfirmationCard";
import { buildAiConfirmationCard, parseAiCards, type AiConfirmationCard } from "@fintranzact/shared";

const ACTION = "3f0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a11";
const INVOICE = "5a0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a22";
const NOW = new Date();

const preview = {
  title: "New sales invoice",
  fields: [
    { label: "Customer", value: "Asha Traders, Pune" },
    { label: "Date", value: "9 Oct 2026" },
  ],
  table: { columns: ["Item", "Qty", "Rate", "Amount incl. GST"], rows: [["Cotton Fabric", "4", "₹250.00", "₹1,050.00"], ["Packing", "1", "₹100.00", "₹118.00"]] },
  totals: [
    { label: "Subtotal", value: "₹1,100.00" },
    { label: "CGST", value: "₹34.00" },
    { label: "SGST", value: "₹34.00" },
    { label: "Total", value: "₹1,168.00", strong: true },
  ],
  warnings: ["Only 3 of Cotton Fabric in stock, and this invoice uses 4."],
  note: "Nothing is saved until you tap Confirm.",
  edits: [
    { key: "date", label: "Date", input: "date" as const, value: "2026-10-09" },
    { key: "notes", label: "Notes", input: "text" as const, value: "", maxLength: 500 },
    { key: "lines.0.quantity", label: "Line 1: quantity", input: "number" as const, value: "4" },
    { key: "mode", label: "Mode", input: "select" as const, value: "cash", options: [{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }] },
  ],
};

function card(over: Record<string, unknown> = {}): AiConfirmationCard {
  const c = buildAiConfirmationCard(
    { id: ACTION, kind: "create_invoice", status: "pending", expiresAt: new Date(NOW.getTime() + 20 * 60_000), preview, ...over },
    NOW,
  );
  if (!c) throw new Error("test card did not validate");
  return c;
}
const done = (over: Record<string, unknown> = {}) => card({ status: "confirmed", result: { entityType: "invoice", id: INVOICE, label: "Invoice INV-00007" }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.polled.current = undefined;
});
afterEach(() => vi.useRealTimers());

describe("a waiting card", () => {
  it("shows the details, the lines as a real table, the totals and the warnings, with Confirm, Edit and Cancel", () => {
    render(<AiConfirmationCardView card={card()} />);
    const region = screen.getByRole("region", { name: "New sales invoice" });
    expect(within(region).getByText("Asha Traders, Pune")).toBeInTheDocument();
    const table = within(region).getByRole("table", { name: /lines/i });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Item", "Qty", "Rate", "Amount incl. GST"]);
    expect(within(table).getByRole("cell", { name: "₹1,050.00" })).toBeInTheDocument();
    const totals = within(region).getByLabelText("Totals");
    expect(within(totals).getByText("₹1,168.00")).toBeInTheDocument();
    expect(within(region).getByRole("list", { name: "Please check" })).toHaveTextContent("Only 3 of Cotton Fabric in stock");
    expect(screen.getByTestId("ai-card-status")).toHaveTextContent("Waiting for you");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(region).toHaveTextContent("Nothing is saved until you tap Confirm.");
  });

  it("shows a message to review as plain text", () => {
    render(<AiConfirmationCardView card={card({ preview: { ...preview, message: "Hello Asha,\n\nA friendly reminder.", edits: [] } })} />);
    expect(screen.getByTestId("ai-card-message")).toHaveTextContent("Hello Asha, A friendly reminder.");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("is a labelled region with a polite status area, and has no accessibility violations", async () => {
    const { container } = render(<AiConfirmationCardView card={card()} />);
    expect(screen.getByTestId("ai-card-live")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("ai-card-live")).toHaveAttribute("role", "status");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("confirming", () => {
  it("calls ai.confirmAction once with the card's own id, then shows the result with a link to the new record", async () => {
    h.confirm.mockResolvedValue({ status: "confirmed", message: null, executedNow: true, card: done() });
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm).toHaveBeenCalledWith({ id: ACTION });
    const outcome = await screen.findByTestId("ai-card-outcome");
    expect(outcome).toHaveTextContent("Invoice INV-00007");
    expect(within(outcome).getByRole("link", { name: "Open" })).toHaveAttribute("href", `/invoices?id=${INVOICE}`);
    expect(screen.getByTestId("ai-card-status")).toHaveTextContent("Done");
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-card-live")).toHaveTextContent("Done. Invoice INV-00007");
  });

  it("ignores a second tap while the first is running (no double confirm), and disables every button meanwhile", async () => {
    let finish!: (v: unknown) => void;
    h.confirm.mockReturnValue(new Promise((r) => { finish = r; }));
    render(<AiConfirmationCardView card={card()} />);
    const confirm = screen.getByRole("button", { name: "Confirm" });
    await userEvent.dblClick(confirm);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole("button", { name: /Confirming/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByTestId("ai-card-live")).toHaveTextContent("Confirming.");
    await act(async () => finish({ status: "confirmed", message: null, executedNow: true, card: done() }));
    expect(await screen.findByTestId("ai-card-outcome")).toHaveTextContent("Invoice INV-00007");
    expect(h.confirm).toHaveBeenCalledTimes(1);
  });

  it("shows why it failed, and offers no retry button (the person asks again)", async () => {
    const failed = card({ status: "failed", error: "Books are locked through 31 Mar 2026." });
    h.confirm.mockResolvedValue({ status: "failed", message: "Books are locked through 31 Mar 2026.", executedNow: true, card: failed });
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const outcome = await screen.findByTestId("ai-card-outcome");
    expect(outcome).toHaveTextContent("Could not be completed. Books are locked through 31 Mar 2026.");
    expect(outcome).toHaveTextContent("Ask me to prepare it again");
    expect(screen.getByTestId("ai-card-status")).toHaveTextContent("Failed");
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-card-live")).toHaveTextContent("Books are locked");
  });

  it("a refusal (permission changed, add-on off) is shown and the card stays waiting so nothing is lost", async () => {
    h.confirm.mockRejectedValue(new Error("You do not have permission to do this. Ask your owner for access."));
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByTestId("ai-card-error")).toHaveTextContent("You do not have permission");
    expect(screen.getByTestId("ai-card-error")).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("a second device already confirmed it: shows the first outcome", async () => {
    h.confirm.mockResolvedValue({ status: "confirmed", message: null, executedNow: false, card: done() });
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByTestId("ai-card-outcome")).toHaveTextContent("Invoice INV-00007");
  });

  it("an external WhatsApp link opens in a new tab, safely, and only that kind of link", async () => {
    const url = "https://wa.me/919000000001?text=Hello%20Asha";
    const reminder = card({ kind: "send_payment_reminder", status: "confirmed", result: { entityType: "reminder", id: INVOICE, label: "WhatsApp reminder recorded", externalUrl: url } });
    render(<AiConfirmationCardView card={reminder} />);
    const link = screen.getByRole("link", { name: "Open WhatsApp to send it" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("while confirmed with no result yet it says it is saving and checks again until the result arrives", async () => {
    const saving = card({ status: "confirmed" });
    render(<AiConfirmationCardView card={saving} />);
    expect(screen.getByTestId("ai-card-outcome")).toHaveTextContent("Saving…");
    expect(h.pollEnabled).toHaveBeenLastCalledWith(true);
    h.polled.current = done();
    // A re-render (the next poll) delivers it.
    const { rerender } = render(<AiConfirmationCardView card={saving} />);
    rerender(<AiConfirmationCardView card={saving} />);
    await waitFor(() => expect(screen.getAllByTestId("ai-card-outcome").some((o) => /Invoice INV-00007/.test(o.textContent ?? ""))).toBe(true));
  });
});

describe("cancelling", () => {
  it("calls ai.cancelAction and says nothing was saved", async () => {
    h.cancel.mockResolvedValue(card({ status: "cancelled" }));
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.cancel).toHaveBeenCalledWith({ id: ACTION });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(await screen.findByTestId("ai-card-outcome")).toHaveTextContent("Cancelled. Nothing was saved.");
    expect(screen.getByTestId("ai-card-status")).toHaveTextContent("Cancelled");
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });
});

describe("expired, and finished states loaded from history", () => {
  it("an expired card has no buttons and says so", () => {
    render(<AiConfirmationCardView card={card({ expiresAt: new Date(NOW.getTime() - 60_000) })} />);
    expect(screen.getByTestId("ai-card-status")).toHaveTextContent("Expired");
    expect(screen.getByTestId("ai-card-outcome")).toHaveTextContent("This action expired. Ask me to prepare it again.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("flips to expired by itself when its time runs out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AiConfirmationCardView card={card({ expiresAt: new Date(Date.now() + 5_000) })} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(screen.getByTestId("ai-card-status")).toHaveTextContent("Expired");
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("shows a failed, cancelled and done card from a reopened chat", () => {
    const { unmount } = render(<AiConfirmationCardView card={card({ status: "failed", error: "Period is locked." })} />);
    expect(screen.getByTestId("ai-card-outcome")).toHaveTextContent("Period is locked.");
    unmount();
    const r2 = render(<AiConfirmationCardView card={card({ status: "cancelled" })} />);
    expect(screen.getByTestId("ai-card-outcome")).toHaveTextContent("Cancelled");
    r2.unmount();
    render(<AiConfirmationCardView card={done()} />);
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", `/invoices?id=${INVOICE}`);
  });
});

describe("editing", () => {
  it("opens the safe fields (dates, quantities, notes, a choice), never ids, and Confirm is hidden while editing", async () => {
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: /Edit: New sales invoice/ });
    expect(within(form).getByLabelText("Date")).toHaveAttribute("type", "date");
    expect(within(form).getByLabelText("Date")).toHaveValue("2026-10-09");
    expect(within(form).getByLabelText("Line 1: quantity")).toHaveValue("4");
    expect(within(form).getByLabelText("Mode")).toHaveValue("cash");
    expect(within(form).getByLabelText("Notes")).toHaveAttribute("maxlength", "500");
    expect(within(form).queryByLabelText(/id/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("sends only what changed, shows the recomputed card, and goes back to review", async () => {
    const updated = card({ preview: { ...preview, totals: [{ label: "Total", value: "₹2,480.50", strong: true }], edits: preview.edits.map((e) => (e.key === "lines.0.quantity" ? { ...e, value: "10" } : e)) } });
    h.update.mockResolvedValue(updated);
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const qty = screen.getByLabelText("Line 1: quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "10");
    await userEvent.selectOptions(screen.getByLabelText("Mode"), "upi");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith({ id: ACTION, edits: { "lines.0.quantity": "10", mode: "upi" } });
    expect(await screen.findByText("₹2,480.50")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByTestId("ai-card-live")).toHaveTextContent("Changes saved");
  });

  it("shows the server's message for a bad value and keeps the form open", async () => {
    h.update.mockRejectedValue(new Error("Line 1 quantity: enter a quantity above 0."));
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Line 1: quantity"));
    await userEvent.type(screen.getByLabelText("Line 1: quantity"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("enter a quantity above 0");
    expect(screen.getByRole("form")).toBeInTheDocument();
    expect(screen.getByLabelText("Line 1: quantity")).toHaveValue("0");
  });

  it("saving without a change just closes the form, and Discard and Escape throw the edits away", async () => {
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(h.update).not.toHaveBeenCalled();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Notes"), "Deliver Monday");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Notes")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Notes"), "x{Escape}");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("an empty form is not flagged with errors before anything is typed", async () => {
    render(<AiConfirmationCardView card={card()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("inside the chat's cards", () => {
  it("renders a confirmation card next to the other card types, from the server's cards only", () => {
    render(<AiCards cards={[card(), ...parseAiCards([{ type: "link", label: "Invoices", target: { kind: "page", page: "invoices" } }]).cards]} />);
    expect(screen.getByTestId("ai-card-confirmation")).toBeInTheDocument();
    expect(screen.getByTestId("ai-card-link")).toBeInTheDocument();
  });

  it("a model-written lookalike is dropped before it reaches the component", () => {
    const forged = { ...card(), actionId: INVOICE };
    const { cards } = parseAiCards([forged]);
    expect(cards).toEqual([]);
    const { container } = render(<AiCards cards={cards} />);
    expect(container).toBeEmptyDOMElement();
  });
});
