/**
 * Platform admin: the add-on price editor (AI Assistant, AI Plus, the extra pack) and the per-organisation
 * AI add-on grant / purchases view.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  save: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  invalidate: vi.fn(),
  // Stable references, like react-query's.
  prices: {
    addons: [
      { id: "ai_assistant", name: "AI Assistant", builtInMonthlyPriceInr: 399, monthlyPriceInr: 399, yearlyPriceInr: null, edited: false },
      { id: "ai_plus", name: "AI Plus", builtInMonthlyPriceInr: 999, monthlyPriceInr: 1099, yearlyPriceInr: 10_000, edited: true },
      { id: "payroll", name: "Payroll", builtInMonthlyPriceInr: 499, monthlyPriceInr: 499, yearlyPriceInr: null, edited: false },
      { id: "store_pro", name: "Store Pro", builtInMonthlyPriceInr: 499, monthlyPriceInr: 499, yearlyPriceInr: null, edited: false },
    ],
    aiPack: { builtInPriceInr: 199, priceInr: 199, edited: false },
  },
  purchases: {
    purchases: [
      { id: "p1", packs: 2, credits: 200, totalPaise: 46_964, status: "paid", createdAt: "2026-10-05T00:00:00.000Z", invoiceNumber: "FIN-00042", creditsLeft: 150, used: 50, provider: "razorpay", paidAt: null, paymentId: "x" },
      { id: "p2", packs: 1, credits: 100, totalPaise: 23_482, status: "failed", createdAt: "2026-10-04T00:00:00.000Z", invoiceNumber: null, creditsLeft: 0, used: 0, provider: "razorpay", paidAt: null, paymentId: null },
    ],
    addons: [{ id: "s1", addon: "ai_assistant", status: "active", provider: "admin", cycle: "monthly", basePaise: 0, currentPeriodEnd: null, graceUntil: null }],
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ platform: { addonPrices: { invalidate: h.invalidate }, aiPurchases: { invalidate: h.invalidate }, aiCredits: { invalidate: h.invalidate } } }),
    platform: {
      addonPrices: { useQuery: () => ({ data: h.prices }) },
      saveAddonPrices: { useMutation: (o: { onSuccess?: () => void } = {}) => ({ isPending: false, mutate: (v: unknown) => { h.save(v); o.onSuccess?.(); } }) },
      aiPurchases: { useQuery: () => ({ data: h.purchases }) },
      grantAddon: { useMutation: (o: { onSuccess?: () => void } = {}) => ({ isPending: false, mutate: (v: unknown) => { h.grant(v); o.onSuccess?.(); } }) },
      revokeAddon: { useMutation: (o: { onSuccess?: () => void } = {}) => ({ isPending: false, mutate: (v: unknown) => { h.revoke(v); o.onSuccess?.(); } }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import { AddonPriceEditor, AiPurchasesSection } from "../AddonBillingAdmin";

beforeEach(() => vi.clearAllMocks());

describe("AddonPriceEditor", () => {
  it("has a row for each add-on and for the extra AI pack, filled from the prices in force", () => {
    render(<AddonPriceEditor />);
    const plus = screen.getByTestId("addon-price-row-ai_plus");
    expect(within(plus).getByLabelText("Monthly ₹")).toHaveValue(1099);
    expect(within(plus).getByLabelText("Yearly ₹ (optional)")).toHaveValue(10000);
    expect(within(screen.getByTestId("addon-price-row-ai_assistant")).getByLabelText("Monthly ₹")).toHaveValue(399);
    expect(within(screen.getByTestId("addon-price-row-ai_pack")).getByLabelText("Price ₹")).toHaveValue(199);
  });

  it("saves only what differs from the built-in price, and the pack price", async () => {
    render(<AddonPriceEditor />);
    const row = screen.getByTestId("addon-price-row-ai_assistant");
    const monthly = within(row).getByLabelText("Monthly ₹");
    await userEvent.clear(monthly);
    await userEvent.type(monthly, "449");
    const pack = within(screen.getByTestId("addon-price-row-ai_pack")).getByLabelText("Price ₹");
    await userEvent.clear(pack);
    await userEvent.type(pack, "249");
    await userEvent.click(screen.getByRole("button", { name: "Save add-on prices" }));
    expect(h.save).toHaveBeenCalledWith({
      addons: { ai_assistant: { monthlyPriceInr: 449, yearlyPriceInr: null }, ai_plus: { monthlyPriceInr: 1099, yearlyPriceInr: 10000 } },
      aiPackPriceInr: 249,
    });
  });

  it("an empty or zero price cannot be saved", async () => {
    render(<AddonPriceEditor />);
    const monthly = within(screen.getByTestId("addon-price-row-ai_assistant")).getByLabelText("Monthly ₹");
    await userEvent.clear(monthly);
    expect(screen.getByRole("button", { name: "Save add-on prices" })).toBeDisabled();
    await userEvent.type(monthly, "0");
    expect(screen.getByRole("button", { name: "Save add-on prices" })).toBeDisabled();
  });
});

describe("AiPurchasesSection", () => {
  it("lists the add-ons (a free grant can be revoked) and the purchases with invoices", async () => {
    render(<AiPurchasesSection tenantId="t1" />);
    const list = screen.getByTestId("ai-addon-list");
    expect(list).toHaveTextContent("AI Assistant");
    expect(list).toHaveTextContent("granted free");
    await userEvent.click(within(list).getByRole("button", { name: "Revoke" }));
    expect(h.revoke).toHaveBeenCalledWith({ tenantId: "t1", addon: "ai_assistant" });
    expect(screen.getByText("FIN-00042")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("grants an AI add-on free with a reason (the button waits for one)", async () => {
    render(<AiPurchasesSection tenantId="t1" />);
    const button = screen.getByRole("button", { name: "Grant add-on" });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Add-on to grant"), "ai_plus");
    await userEvent.type(screen.getByLabelText("Reason (kept with the grant)"), "Launch partner");
    await userEvent.click(button);
    expect(h.grant).toHaveBeenCalledWith({ tenantId: "t1", addon: "ai_plus", reason: "Launch partner" });
  });
});
