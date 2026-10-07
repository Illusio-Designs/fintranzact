/**
 * Platform admin AI cards: usage and cost per organisation with a month
 * filter, the price table editor, and the extra-pack grant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  usageQuery: vi.fn(),
  savePrices: vi.fn(),
  grant: vi.fn(),
  invalidate: vi.fn(),
  // Stable references, like react-query's: a new object each render would re-run the editor's effect forever.
  prices: { prices: { "claude-haiku-4-5-20251001": { inputPaisePerMTok: 8500, outputPaisePerMTok: 42500 } }, models: { fast: "claude-haiku-4-5-20251001", strong: "claude-sonnet-5-5" } },
  credits: { grants: [], remaining: 100 },
}));

const THIS_MONTH = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ platform: { aiPrices: { invalidate: h.invalidate }, aiCredits: { invalidate: h.invalidate } } }),
    platform: {
      aiUsage: {
        useQuery: (input: { period: string }) => {
          h.usageQuery(input);
          return {
            isLoading: false,
            data: {
              period: input.period,
              periods: [THIS_MONTH, "2026-08"],
              organisations: input.period === "2026-08" ? [] : [
                { tenantId: "t1", name: "Mehta Traders", plan: "growth", questions: 42, refunded: 1, inputTokens: 120000, outputTokens: 30000, costPaise: 31250, lastAt: null },
                { tenantId: "t2", name: "Shah Stores", plan: "business", questions: 8, refunded: 0, inputTokens: 9000, outputTokens: 2000, costPaise: 1500, lastAt: null },
              ],
              totals: { questions: 50, inputTokens: 129000, outputTokens: 32000, costPaise: 32750 },
            },
          };
        },
      },
      aiPrices: {
        useQuery: () => ({ data: h.prices }),
      },
      saveAiPrices: { useMutation: (o: { onSuccess?: () => void } = {}) => ({ isPending: false, mutate: (v: unknown) => { h.savePrices(v); o.onSuccess?.(); } }) },
      aiCredits: { useQuery: () => ({ data: h.credits }) },
      grantAiCredits: { useMutation: (o: { onSuccess?: () => void } = {}) => ({ isPending: false, mutate: (v: unknown) => { h.grant(v); o.onSuccess?.(); } }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import { AiAdminSection, AiCreditsSection } from "../AiAdminSection";

beforeEach(() => vi.clearAllMocks());

describe("AiAdminSection", () => {
  it("shows usage and estimated cost per organisation with totals", () => {
    render(<AiAdminSection />);
    const table = screen.getByRole("table", { name: `AI usage for ${THIS_MONTH}` });
    expect(within(table).getByRole("rowheader", { name: "Mehta Traders" })).toBeInTheDocument();
    expect(within(table).getByText("₹312.50")).toBeInTheDocument();
    expect(within(table).getByText("1,20,000")).toBeInTheDocument();
    const totalRow = within(table).getByRole("rowheader", { name: "Total" }).closest("tr")!;
    expect(totalRow).toHaveTextContent("₹327.50");
  });

  it("filters by month", async () => {
    render(<AiAdminSection />);
    await userEvent.selectOptions(screen.getByLabelText("Month"), "2026-08");
    expect(h.usageQuery).toHaveBeenLastCalledWith({ period: "2026-08" });
    expect(screen.getByText("No questions in 2026-08.")).toBeInTheDocument();
  });

  it("edits the price table in rupees and saves paise per million tokens", async () => {
    render(<AiAdminSection />);
    const editor = screen.getByTestId("ai-price-editor");
    const input = within(editor).getByLabelText("Input ₹ / M tokens");
    expect(input).toHaveValue(85);
    await userEvent.clear(input);
    await userEvent.type(input, "90.5");
    await userEvent.click(within(editor).getByRole("button", { name: "Save price table" }));
    expect(h.savePrices).toHaveBeenCalledWith({ "claude-haiku-4-5-20251001": { inputPaisePerMTok: 9050, outputPaisePerMTok: 42500 } });
  });

  it("can add a model and refuses a duplicate or empty id", async () => {
    render(<AiAdminSection />);
    const editor = screen.getByTestId("ai-price-editor");
    await userEvent.click(within(editor).getByRole("button", { name: "Add a model" }));
    expect(within(editor).getByRole("button", { name: "Save price table" })).toBeDisabled(); // empty id
    const ids = within(editor).getAllByLabelText("Model id");
    await userEvent.type(ids[1]!, "claude-haiku-4-5-20251001");
    expect(within(editor).getByText("Each model id can appear once.")).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Save price table" })).toBeDisabled();
  });
});

describe("AiCreditsSection", () => {
  it("shows what is left and grants a pack of 100 with a reason", async () => {
    render(<AiCreditsSection tenantId="t1" />);
    expect(screen.getByTestId("ai-credits-section")).toHaveTextContent("100 extra questions left.");
    const grant = screen.getByRole("button", { name: "Grant" });
    expect(grant).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason/), "Launch goodwill pack");
    await userEvent.click(grant);
    expect(h.grant).toHaveBeenCalledWith({ tenantId: "t1", credits: 100, reason: "Launch goodwill pack" });
  });

  it("refuses an invalid amount", async () => {
    render(<AiCreditsSection tenantId="t1" />);
    await userEvent.type(screen.getByLabelText(/Reason/), "Because");
    const n = screen.getByLabelText("Questions");
    await userEvent.clear(n);
    await userEvent.type(n, "0");
    expect(screen.getByRole("button", { name: "Grant" })).toBeDisabled();
  });
});
