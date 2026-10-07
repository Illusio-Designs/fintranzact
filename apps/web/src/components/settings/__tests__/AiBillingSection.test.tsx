import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  onSale: { current: false },
  calls: { subscribe: vi.fn(), change: vi.fn(), cancel: vi.fn(), buyPack: vi.fn(), verifyPack: vi.fn(), verifySub: vi.fn() },
  buyResult: { current: { status: "paid", orderId: "o1", providerOrderId: "order_1", razorpayKeyId: null as string | null, packs: 1, credits: 100, totalPaise: 23_482 } as Record<string, unknown> },
  checkout: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@fintranzact/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fintranzact/shared")>();
  return { ...actual, isAddonAvailable: (id: string) => (id === "ai_assistant" || id === "ai_plus" ? h.onSale.current : false) };
});
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));
vi.mock("@/lib/razorpay-checkout", () => ({ openRazorpayCheckout: (o: unknown) => h.checkout(o) }));

function mut(fn: (v: unknown) => void, resultOf?: () => unknown) {
  return (opts: { onSuccess?: (r: unknown, v: unknown) => unknown } = {}) => ({
    isPending: false,
    mutate: (v: unknown) => {
      fn(v);
      void opts.onSuccess?.(resultOf ? resultOf() : {}, v);
    },
  });
}
vi.mock("@/lib/trpc", () => ({
  trpc: {
    billing: {
      verifyCheckout: { useMutation: mut((v) => h.calls.verifySub(v)) },
      verifyAiPackPayment: { useMutation: mut((v) => h.calls.verifyPack(v), () => ({ credits: 100 })) },
      subscribeAddon: { useMutation: mut((v) => h.calls.subscribe(v), () => ({ status: "active" })) },
      changeAddon: { useMutation: mut((v) => h.calls.change(v), () => ({ applied: "now" })) },
      cancelSubscription: { useMutation: mut((v) => h.calls.cancel(v)) },
      buyAiPack: { useMutation: mut((v) => h.calls.buyPack(v), () => h.buyResult.current) },
    },
  },
}));

import { AiBillingSection } from "../AiBillingSection";
import { axe } from "vitest-axe";

const addon = (id: string, name: string, tagline: string, monthly: number, yearly: number) => ({
  id, name, tagline, group: "ai", features: [], monthlyPriceInr: monthly, available: h.onSale.current,
  monthly: { basePaise: monthly * 100, gstPaise: Math.round(monthly * 18), totalPaise: monthly * 118 },
  yearly: { basePaise: yearly * 100, gstPaise: Math.round(yearly * 18), totalPaise: yearly * 118 },
});

const allowance = (over: Record<string, unknown> = {}) => ({
  tier: "assistant", scope: "month", limit: 150, used: 42, includedRemaining: 108, creditsRemaining: 200, remaining: 308, resetsAt: "2026-11-01T00:00:00.000Z", ...over,
});
const sub = (over: Record<string, unknown> = {}) => ({
  id: "s1", kind: "addon", plan: null, addon: "ai_assistant", cycle: "monthly", status: "active", statusLabel: "Active", basePaise: 39_900,
  currentPeriodEnd: "2026-11-05T00:00:00.000Z", cancelAtPeriodEnd: false, scheduledPlan: null, scheduledAddon: null, scheduledCycle: null, graceUntil: null, provider: "demo", ...over,
});

function data(over: { subs?: unknown[]; allowance?: unknown; purchases?: unknown[]; creditsRemaining?: number } = {}) {
  return {
    addons: [addon("ai_assistant", "AI Assistant", "150 questions a month", 399, 3_990), addon("ai_plus", "AI Plus", "500 questions a month", 999, 9_990)],
    addonSubscriptions: over.subs ?? [],
    ai: {
      packAvailable: h.onSale.current,
      pack: { questions: 100, priceInr: 199, maxPacks: 50, amount: { packs: 1, credits: 100, basePaise: 19_900, gstPaise: 3_582, totalPaise: 23_482 } },
      creditsRemaining: over.creditsRemaining ?? 0,
      allowance: over.allowance === undefined ? null : over.allowance,
      purchases: over.purchases ?? [],
    },
  } as never;
}

const renderSection = (d: unknown, extra: Partial<{ cycle: "monthly" | "yearly"; onPaidPlan: boolean; config: unknown }> = {}) =>
  render(<AiBillingSection data={d as never} config={(extra.config ?? { razorpayKeyId: null }) as never} cycle={extra.cycle ?? "monthly"} onPaidPlan={extra.onPaidPlan ?? true} refresh={h.refresh} />);

beforeEach(() => {
  vi.clearAllMocks();
  h.onSale.current = false;
  h.buyResult.current = { status: "paid", orderId: "o1", providerOrderId: "order_1", razorpayKeyId: null, packs: 1, credits: 100, totalPaise: 23_482 };
});

describe("while the AI add-on is not on sale", () => {
  it("renders nothing for an organisation that does not hold it", () => {
    const { container } = renderSection(data());
    expect(container).toBeEmptyDOMElement();
  });

  it("an organisation that holds it (admin grant) sees its allowance and a coming soon note, with no buy or subscribe controls", () => {
    renderSection(data({ subs: [sub({ provider: "admin" })], allowance: allowance() }));
    expect(screen.getByTestId("ai-used")).toHaveTextContent("42 of 150");
    expect(screen.getByTestId("ai-credits")).toHaveTextContent("200");
    expect(screen.getByTestId("ai-reset")).toHaveTextContent("01 Nov 2026");
    expect(screen.getByTestId("ai-coming-soon")).toBeInTheDocument();
    expect(screen.getByText(/Provided by the Fintranzact team/)).toBeInTheDocument();
    expect(screen.queryByTestId("ai-tiers")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-packs")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy|subscribe|upgrade|add ai/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument(); // a grant is ours to remove
  });
});

describe("when the AI add-on is on sale", () => {
  beforeEach(() => {
    h.onSale.current = true;
  });

  it("an organisation with no AI plan sees both tiers with GST-exclusive prices and can subscribe; packs wait for a plan", async () => {
    renderSection(data());
    const tiers = screen.getByTestId("ai-tiers");
    expect(within(tiers).getByText("AI Assistant")).toBeInTheDocument();
    expect(within(tiers).getByText("AI Plus")).toBeInTheDocument();
    expect(tiers).toHaveTextContent("399.00");
    expect(tiers).toHaveTextContent("999.00");
    expect(tiers).toHaveTextContent("+ GST");
    expect(screen.getByTestId("ai-packs-need-plan")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add AI Plus" }));
    expect(h.calls.subscribe).toHaveBeenCalledWith({ addon: "ai_plus", cycle: "monthly" });
    expect(h.toast.success).toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalled();
  });

  it("yearly shows the yearly price", () => {
    renderSection(data(), { cycle: "yearly" });
    expect(screen.getByTestId("ai-tiers")).toHaveTextContent("3,990.00");
    expect(screen.getByTestId("ai-tiers")).toHaveTextContent("/yr");
  });

  it("subscribing needs a paid plan first", () => {
    renderSection(data(), { onPaidPlan: false });
    expect(screen.getByRole("button", { name: "Add AI Assistant" })).toBeDisabled();
  });

  it("with Assistant held: current tier, an upgrade button for Plus, a cancel link and the allowance", async () => {
    renderSection(data({ subs: [sub()], allowance: allowance() }));
    expect(screen.getByTestId("ai-sub-status")).toHaveTextContent("Active");
    expect(screen.getByText("Your AI plan")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to AI Plus" }));
    expect(h.calls.change).toHaveBeenCalledWith({ addon: "ai_plus", cycle: "monthly" });
    expect(screen.getByText(/never billed for both/i)).toBeInTheDocument();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Cancel AI plan" }));
    expect(h.calls.cancel).toHaveBeenCalledWith({ subscriptionId: "s1" });
  });

  it("with Plus held, Assistant is offered as a switch", async () => {
    renderSection(data({ subs: [sub({ addon: "ai_plus", id: "s2" })], allowance: allowance({ tier: "plus", limit: 500 }) }));
    await userEvent.click(screen.getByRole("button", { name: "Switch to AI Assistant" }));
    expect(h.calls.change).toHaveBeenCalledWith({ addon: "ai_assistant", cycle: "monthly" });
  });

  it("a scheduled switch and a halted subscription are explained", () => {
    const { unmount } = renderSection(data({ subs: [sub({ addon: "ai_plus", scheduledAddon: "ai_assistant" })], allowance: allowance({ tier: "plus" }) }));
    expect(screen.getByText(/Moves to AI Assistant on/)).toBeInTheDocument();
    unmount();
    renderSection(data({ subs: [sub({ status: "halted", statusLabel: "On hold" })], allowance: null, creditsRemaining: 100 }));
    expect(screen.getByTestId("ai-allowance")).toHaveTextContent("on hold");
    expect(screen.getByTestId("ai-allowance")).toHaveTextContent("100 extra questions waiting");
    expect(screen.getByRole("button", { name: /Upgrade to AI Plus/ })).toBeDisabled();
  });

  it("the quantity stepper prices the order with GST and buys that many packs", async () => {
    renderSection(data({ subs: [sub()], allowance: allowance() }));
    expect(screen.getByTestId("ai-pack-total")).toHaveTextContent("100 questions");
    expect(screen.getByTestId("ai-pack-total")).toHaveTextContent("234.82");
    await userEvent.click(screen.getByRole("button", { name: "More packs" }));
    await userEvent.click(screen.getByRole("button", { name: "More packs" }));
    expect(screen.getByLabelText("Packs")).toHaveValue(3);
    expect(screen.getByTestId("ai-pack-total")).toHaveTextContent("300 questions");
    expect(screen.getByTestId("ai-pack-total")).toHaveTextContent("704.46");
    await userEvent.click(screen.getByRole("button", { name: "Buy 3 packs" }));
    expect(h.calls.buyPack).toHaveBeenCalledWith({ packs: 3 });
    expect(h.toast.success).toHaveBeenCalledWith("Questions added", "100 extra questions are ready to use.");
  });

  it("the stepper stays between 1 and 50", async () => {
    renderSection(data({ subs: [sub()], allowance: allowance() }));
    expect(screen.getByRole("button", { name: "Fewer packs" })).toBeDisabled();
    const input = screen.getByLabelText("Packs");
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    expect(input).toHaveValue(50);
    expect(screen.getByRole("button", { name: "More packs" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Buy 50 packs" })).toBeInTheDocument();
  });

  it("with Razorpay the checkout opens on the order and the signature goes to the server for verification", async () => {
    h.buyResult.current = { status: "checkout", orderId: "o9", providerOrderId: "order_RZP9", razorpayKeyId: "rzp_test_fake", packs: 2, credits: 200, totalPaise: 46_964 };
    h.checkout.mockImplementation(async (o: { onSuccess: (r: unknown) => void }) => o.onSuccess({ razorpay_payment_id: "pay_1", razorpay_signature: "sig_1", razorpay_order_id: "order_RZP9" }));
    renderSection(data({ subs: [sub()], allowance: allowance() }), { config: { razorpayKeyId: "rzp_test_fake" } });
    await userEvent.click(screen.getByRole("button", { name: "Buy 1 pack" }));
    await waitFor(() => expect(h.checkout).toHaveBeenCalled());
    expect(h.checkout.mock.calls[0]![0]).toMatchObject({ keyId: "rzp_test_fake", orderId: "order_RZP9" });
    expect(h.calls.verifyPack).toHaveBeenCalledWith({ orderId: "o9", razorpayPaymentId: "pay_1", razorpaySignature: "sig_1" });
  });

  it("lists the purchases with their invoice numbers", () => {
    renderSection(data({
      subs: [sub()], allowance: allowance(),
      purchases: [
        { id: "p1", packs: 2, credits: 200, totalPaise: 46_964, status: "paid", createdAt: "2026-10-05T00:00:00.000Z", invoiceNumber: "FIN-00042" },
        { id: "p2", packs: 1, credits: 100, totalPaise: 23_482, status: "failed", createdAt: "2026-10-04T00:00:00.000Z", invoiceNumber: null },
      ],
    }));
    const list = screen.getByTestId("ai-purchases");
    expect(list).toHaveTextContent("FIN-00042");
    expect(list).toHaveTextContent("Payment failed");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection(data({ subs: [sub()], allowance: allowance() }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
