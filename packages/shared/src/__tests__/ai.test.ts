import { describe, it, expect } from "vitest";
import {
  AI_INCLUDED_QUESTIONS,
  AI_MAX_CARDS,
  AI_DEFAULT_PRICES,
  aiCounterKey,
  aiLinkHref,
  aiQuotaExhaustedMessage,
  aiQuotaPeriod,
  computeAiAllowance,
  deriveAiTier,
  estimateAiCostPaise,
  normaliseAiPrices,
  parseAiCards,
  type AiLinkCard,
} from "../ai.js";

const none = { ai_assistant: false, ai_plus: false };

describe("aiQuotaPeriod (calendar month in IST)", () => {
  it("rolls over at midnight IST, not UTC", () => {
    // 2026-09-30 18:29:59 UTC is 23:59:59 IST on 30 September.
    expect(aiQuotaPeriod(new Date("2026-09-30T18:29:59Z"))).toBe("2026-09");
    // 18:30 UTC is 00:00 IST on 1 October.
    expect(aiQuotaPeriod(new Date("2026-09-30T18:30:00Z"))).toBe("2026-10");
    expect(aiQuotaPeriod(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01");
  });
});

describe("deriveAiTier", () => {
  it("is null without the add-on", () => {
    expect(deriveAiTier({ addons: none, trialActive: false, subscribed: none })).toBeNull();
  });
  it("is the trial tier during a Full Access Trial with no subscription", () => {
    expect(deriveAiTier({ addons: { ai_assistant: true, ai_plus: false }, trialActive: true, subscribed: none })).toBe("trial");
  });
  it("a subscription (even an admin grant) beats the trial", () => {
    expect(deriveAiTier({ addons: { ai_assistant: true, ai_plus: false }, trialActive: true, subscribed: { ai_assistant: true, ai_plus: false } })).toBe("assistant");
  });
  it("AI Plus also grants AI Assistant and wins", () => {
    expect(deriveAiTier({ addons: { ai_assistant: true, ai_plus: true }, trialActive: false, subscribed: { ai_assistant: false, ai_plus: true } })).toBe("plus");
    expect(deriveAiTier({ addons: { ai_assistant: true, ai_plus: true }, trialActive: false, subscribed: { ai_assistant: true, ai_plus: true } })).toBe("plus");
  });
  it("falls back to the assistant tier when only the entitlement is known", () => {
    expect(deriveAiTier({ addons: { ai_assistant: true, ai_plus: false }, trialActive: false, subscribed: none })).toBe("assistant");
  });
});

describe("aiCounterKey", () => {
  it("counts the whole trial under one key and a later trial under another", () => {
    const a = aiCounterKey("trial", new Date("2026-10-01T00:00:00Z"), new Date("2026-09-20T00:00:00Z"));
    const b = aiCounterKey("trial", new Date("2026-11-20T00:00:00Z"), new Date("2026-09-20T00:00:00Z"));
    const c = aiCounterKey("trial", new Date("2026-11-20T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("counts paid tiers per IST month", () => {
    expect(aiCounterKey("assistant", new Date("2026-10-15T00:00:00Z"), null)).toBe("2026-10");
  });
});

describe("computeAiAllowance", () => {
  it("includes 150 for AI Assistant and 500 for AI Plus", () => {
    expect(computeAiAllowance({ tier: "assistant", trialCap: 50, used: 0, creditsRemaining: 0 }).limit).toBe(AI_INCLUDED_QUESTIONS.assistant);
    expect(computeAiAllowance({ tier: "plus", trialCap: 50, used: 0, creditsRemaining: 0 }).limit).toBe(500);
  });
  it("caps the trial at the admin setting", () => {
    const a = computeAiAllowance({ tier: "trial", trialCap: 50, used: 49, creditsRemaining: 0 });
    expect(a).toMatchObject({ scope: "trial", limit: 50, remaining: 1, exhausted: false });
    expect(computeAiAllowance({ tier: "trial", trialCap: 50, used: 50, creditsRemaining: 0 }).exhausted).toBe(true);
    expect(computeAiAllowance({ tier: "trial", trialCap: 0, used: 0, creditsRemaining: 0 }).exhausted).toBe(true);
  });
  it("adds pack credits after the included questions", () => {
    const a = computeAiAllowance({ tier: "assistant", trialCap: 50, used: 150, creditsRemaining: 100 });
    expect(a).toMatchObject({ includedRemaining: 0, creditsRemaining: 100, remaining: 100, exhausted: false });
    expect(computeAiAllowance({ tier: "assistant", trialCap: 50, used: 120, creditsRemaining: 100 }).remaining).toBe(130);
  });
  it("never goes negative when usage is above the limit (a tier was downgraded)", () => {
    const a = computeAiAllowance({ tier: "assistant", trialCap: 50, used: 400, creditsRemaining: 0 });
    expect(a.includedRemaining).toBe(0);
    expect(a.exhausted).toBe(true);
  });
});

describe("aiQuotaExhaustedMessage", () => {
  it("tells a non-owner to ask their owner", () => {
    expect(aiQuotaExhaustedMessage({ scope: "month", tier: "assistant" }, false)).toMatch(/Ask your owner to add more/);
    expect(aiQuotaExhaustedMessage({ scope: "trial", tier: "trial" }, false)).toMatch(/Full Access Trial/);
  });
  it("points an owner at Billing without promising a sale", () => {
    expect(aiQuotaExhaustedMessage({ scope: "month", tier: "plus" }, true)).toMatch(/Billing/);
  });
});

describe("estimateAiCostPaise", () => {
  it("prices input and output separately per million tokens and rounds up", () => {
    const prices = { m: { inputPaisePerMTok: 10_000, outputPaisePerMTok: 50_000 } };
    expect(estimateAiCostPaise(prices, "m", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(10_000);
    expect(estimateAiCostPaise(prices, "m", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(50_000);
    expect(estimateAiCostPaise(prices, "m", { inputTokens: 1, outputTokens: 1 })).toBe(1);
    expect(estimateAiCostPaise(prices, "m", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
  it("counts cached reads at a tenth and writes at 1.25 times input", () => {
    const prices = { m: { inputPaisePerMTok: 10_000, outputPaisePerMTok: 0 } };
    expect(estimateAiCostPaise(prices, "m", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBe(1_000);
    expect(estimateAiCostPaise(prices, "m", { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 })).toBe(12_500);
  });
  it("is 0 for a model with no price", () => {
    expect(estimateAiCostPaise(AI_DEFAULT_PRICES, "nope", { inputTokens: 100, outputTokens: 100 })).toBe(0);
  });
  it("normaliseAiPrices falls back to the defaults on garbage", () => {
    expect(normaliseAiPrices({ x: { inputPaisePerMTok: -1 } })).toBe(AI_DEFAULT_PRICES);
    expect(normaliseAiPrices(null)).toBe(AI_DEFAULT_PRICES);
    expect(normaliseAiPrices({ "my-model": { inputPaisePerMTok: 1, outputPaisePerMTok: 2 } })).toEqual({ "my-model": { inputPaisePerMTok: 1, outputPaisePerMTok: 2 } });
  });
});

describe("parseAiCards", () => {
  const table = { type: "table", title: "Top customers", columns: ["Customer", "Sales"], rows: [["Asha Traders", "₹1,20,000"], ["B", 5]] };
  const chart = { type: "bar_chart", title: "Sales", unit: "₹", bars: [{ label: "Sep", value: 100 }, { label: "Oct", value: 140.5 }] };
  const link = { type: "link", label: "Open invoice", target: { kind: "invoice", id: "3f0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a11" } };

  it("accepts the three card types, as an array, an object or a JSON string", () => {
    expect(parseAiCards([table, chart, link])).toMatchObject({ dropped: 0, cards: [{ type: "table" }, { type: "bar_chart" }, { type: "link" }] });
    expect(parseAiCards({ cards: [table] }).cards).toHaveLength(1);
    expect(parseAiCards(JSON.stringify([chart])).cards).toHaveLength(1);
  });

  it("turns numeric cells into strings", () => {
    const out = parseAiCards([table]).cards[0] as { rows: string[][] };
    expect(out.rows[1]).toEqual(["B", "5"]);
  });

  it("drops unknown card types, including anything that looks like HTML", () => {
    const r = parseAiCards([{ type: "html", html: "<script>alert(1)</script>" }, { type: "iframe", src: "https://evil.example" }, table]);
    expect(r.cards).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it("rejects links that are not an allowlisted in-app target", () => {
    const bad = [
      { type: "link", label: "x", target: { kind: "url", href: "https://evil.example" } },
      { type: "link", label: "x", href: "https://evil.example" },
      { type: "link", label: "x", target: { kind: "page", page: "../admin" } },
      { type: "link", label: "x", target: { kind: "page", page: "platform" } },
      { type: "link", label: "x", target: { kind: "invoice", id: "not-a-uuid" } },
      { type: "link", label: "x", target: { kind: "report", report: "payroll" } },
      { type: "link", label: "x", target: "/invoices" },
    ];
    const r = parseAiCards(bad);
    expect(r.cards).toEqual([]);
    expect(r.dropped).toBe(bad.length);
  });

  it("maps allowlisted links to in-app routes only", () => {
    const card = parseAiCards([link]).cards[0] as AiLinkCard;
    expect(aiLinkHref(card)).toEqual({ to: "/invoices", search: { id: "3f0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a11" } });
    const rep = parseAiCards([{ type: "link", label: "GST", target: { kind: "report", report: "gstr3b" } }]).cards[0] as AiLinkCard;
    expect(aiLinkHref(rep)).toEqual({ to: "/reports", search: { report: "gstr3b" } });
    const page = parseAiCards([{ type: "link", label: "Home", target: { kind: "page", page: "dashboard" } }]).cards[0] as AiLinkCard;
    expect(aiLinkHref(page)).toEqual({ to: "/" });
  });

  it("enforces size limits", () => {
    const manyRows = { ...table, rows: Array.from({ length: 21 }, () => ["a", "b"]) };
    const manyCols = { ...table, columns: ["a", "b", "c", "d", "e", "f", "g"] };
    const longCell = { ...table, rows: [["x".repeat(121), "y"]] };
    const wideRow = { ...table, rows: [["a", "b", "c"]] };
    const manyBars = { ...chart, bars: Array.from({ length: 13 }, (_, i) => ({ label: `m${i}`, value: i })) };
    const nan = { ...chart, bars: [{ label: "x", value: Number.POSITIVE_INFINITY }] };
    for (const c of [manyRows, manyCols, longCell, wideRow, manyBars, nan]) expect(parseAiCards([c]).cards).toEqual([]);
    expect(parseAiCards("x".repeat(13_000)).cards).toEqual([]);
  });

  it("keeps at most four cards", () => {
    const r = parseAiCards([chart, chart, chart, chart, chart, chart]);
    expect(r.cards).toHaveLength(AI_MAX_CARDS);
    expect(r.dropped).toBe(2);
  });

  it("handles garbage without throwing", () => {
    for (const v of [null, undefined, 5, "not json", "{", [], {}, [null], [1, 2]]) expect(() => parseAiCards(v)).not.toThrow();
    expect(parseAiCards("not json").cards).toEqual([]);
  });

  it("strips angle brackets and control characters from card text", () => {
    const r = parseAiCards([{ type: "table", columns: ["<b>Name</b>"], rows: [["a\u0000<img src=x onerror=alert(1)>"]] }]);
    const t = r.cards[0] as { columns: string[]; rows: string[][] };
    expect(t.columns[0]).not.toMatch(/[<>]/);
    expect(t.rows[0]![0]).not.toMatch(/[<>]/);
    expect([...t.rows[0]![0]!].some((ch) => ch.charCodeAt(0) < 0x20)).toBe(false);
  });
});
