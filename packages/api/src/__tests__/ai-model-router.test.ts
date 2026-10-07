import { describe, it, expect } from "vitest";
import { chooseAiModel, resolveAiModels, LONG_QUESTION_CHARS } from "../lib/ai/model-router.js";

const models = { fast: "fast-model", strong: "strong-model" };

describe("resolveAiModels", () => {
  it("defaults to Haiku 4.5 and Sonnet 5.5", () => {
    expect(resolveAiModels({})).toEqual({ fast: "claude-haiku-4-5-20251001", strong: "claude-sonnet-5-5" });
  });
  it("takes AI_MODEL_FAST / AI_MODEL_STRONG from the environment", () => {
    expect(resolveAiModels({ AI_MODEL_FAST: "claude-x-fast", AI_MODEL_STRONG: "claude-opus-5-5" })).toEqual({ fast: "claude-x-fast", strong: "claude-opus-5-5" });
  });
  it("ignores a malformed model id", () => {
    expect(resolveAiModels({ AI_MODEL_FAST: "bad id; drop table", AI_MODEL_STRONG: "" }).fast).toBe("claude-haiku-4-5-20251001");
  });
});

describe("chooseAiModel", () => {
  const fast = [
    "How much does Asha Traders owe me?",
    "is mahine ki sales kitni hui?",
    "show low stock items",
    "cash balance kitna hai",
    "आज की बिक्री कितनी है?",
    "What is my GST payable for September?",
  ];
  const strong = [
    "Compare this month's sales with last month",
    "Why did my profit drop in September?",
    "pichhle mahine se is mahine ki sales ki tulna karo",
    "क्यों घटी बिक्री?",
    "What is the trend of my expenses over six months?",
    "Which customers are late? And which items should I reorder?",
    "sales, purchases and expenses",
    "x".repeat(LONG_QUESTION_CHARS + 1),
  ];

  it.each(fast)("sends a simple lookup to the fast model: %s", (q) => {
    expect(chooseAiModel(q, models)).toMatchObject({ tier: "fast", model: "fast-model" });
  });

  it.each(strong)("sends comparisons and multi-step questions to the strong model: %s", (q) => {
    expect(chooseAiModel(q, models)).toMatchObject({ tier: "strong", model: "strong-model" });
  });

  it("is a pure function: the same input always gives the same choice", () => {
    expect(chooseAiModel("Compare sales", models)).toEqual(chooseAiModel("Compare sales", models));
  });

  it("says why", () => {
    expect(chooseAiModel("Compare sales with last year", models).reason).toMatch(/compare/);
    expect(chooseAiModel("outstanding?", models, { historyTurns: 2 }).reason).toBe("simple follow-up");
  });
});
