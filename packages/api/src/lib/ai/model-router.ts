/**
 * Model routing for the AI assistant: a cheaper, faster model for simple
 * lookups and a stronger one for multi-step analysis. A PURE function of the
 * question (and how long the chat already is), so it is cheap to reason about
 * and to test.
 *
 * Goes to the STRONG model when any of these holds:
 *  - the question is long (over 220 characters),
 *  - it asks for a comparison, a trend, a reason, a forecast, a recommendation
 *    or an explanation (English, Hindi or Hinglish keywords below),
 *  - it asks several things at once (two or more question marks, or "and then"),
 *  - it names three or more different measures in one go.
 * Everything else ("how much did Asha Traders owe me?", "is mahine ki sales
 * kitni hui?") goes to the FAST model.
 */

import { AI_DEFAULT_MODELS } from "@fintranzact/shared";

export interface AiModels {
  fast: string;
  strong: string;
}

export type AiModelTier = "fast" | "strong";

export interface AiModelChoice {
  model: string;
  tier: AiModelTier;
  reason: string;
}

/** The two model ids: env AI_MODEL_FAST / AI_MODEL_STRONG, else the defaults. */
export function resolveAiModels(env: NodeJS.ProcessEnv = process.env): AiModels {
  const clean = (v: string | undefined, fallback: string) => {
    const t = (v ?? "").trim();
    return /^[a-zA-Z0-9._:-]{3,80}$/.test(t) ? t : fallback;
  };
  return {
    fast: clean(env.AI_MODEL_FAST, AI_DEFAULT_MODELS.fast),
    strong: clean(env.AI_MODEL_STRONG, AI_DEFAULT_MODELS.strong),
  };
}

export const LONG_QUESTION_CHARS = 220;

const ANALYSIS_WORDS = [
  // English
  "compare", "comparison", "versus", " vs ", "trend", "why ", "analy", "forecast", "predict", "recommend", "explain",
  "breakdown", "break down", "month on month", "month-on-month", "year on year", "year-on-year", "growth", "decline",
  "what changed", "reason", "insight", "improve", "should i", "which is better", "correlat",
  // Hinglish
  "tulna", "kyun", "kyon", "kaise badla", "vishleshan", "pichhle mahine se", "pichle mahine se", "badhot", "ghata", "badha",
  "salah", "kya karna chahiye", "kaaran",
  // Hindi (Devanagari)
  "तुलना", "क्यों", "विश्लेषण", "बढ़ोतरी", "पिछले महीने से", "सलाह", "कारण",
];

const MEASURES = [
  "sales", "purchase", "expense", "profit", "receivable", "payable", "outstanding", "stock", "gst", "tax", "cash", "bank",
  "bikri", "kharid", "kharcha", "munafa", "udhaar", "baaki", "maal", "बिक्री", "खर्च", "मुनाफा", "उधार", "बाकी",
];

export function chooseAiModel(question: string, models: AiModels, opts: { historyTurns?: number } = {}): AiModelChoice {
  const q = ` ${question.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const strong = (reason: string): AiModelChoice => ({ model: models.strong, tier: "strong", reason });

  if (question.length > LONG_QUESTION_CHARS) return strong("long question");
  const hit = ANALYSIS_WORDS.find((w) => q.includes(w));
  if (hit) return strong(`analysis: "${hit.trim()}"`);
  if ((question.match(/[?？]/g) ?? []).length >= 2 || / and then | aur phir | phir /.test(q)) return strong("several questions at once");
  const measures = new Set(MEASURES.filter((m) => q.includes(m)));
  if (measures.size >= 3) return strong("several measures");
  return { model: models.fast, tier: "fast", reason: (opts.historyTurns ?? 0) > 0 ? "simple follow-up" : "simple lookup" };
}
