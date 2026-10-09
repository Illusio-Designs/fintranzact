/**
 * AI business assistant (Phase 3): the per-person reply language, the speech
 * recognition language it maps to, and the per-person preferences row.
 *
 * The language is ONE of a fixed list. The server reads it from the stored
 * preference (never from the request body or the model) and only a value from
 * this list can reach the system prompt.
 */

import { z } from "zod";

/** auto = reply in the language of the question. */
export const AI_LANGUAGES = ["auto", "en", "hi", "gu", "hinglish"] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];

export const aiLanguageSchema = z.enum(AI_LANGUAGES);

export const AI_DEFAULT_LANGUAGE: AiLanguage = "auto";

/** Labels for the language picker: the language's own name first, so the person can find it in any script. */
export const AI_LANGUAGE_LABELS: Record<AiLanguage, string> = {
  auto: "Auto (reply in the language I ask in)",
  en: "English",
  hi: "हिन्दी (Hindi)",
  gu: "ગુજરાતી (Gujarati)",
  hinglish: "Hinglish (Hindi in English letters)",
};

/** A short name for status lines. */
export const AI_LANGUAGE_SHORT: Record<AiLanguage, string> = {
  auto: "Auto",
  en: "English",
  hi: "Hindi",
  gu: "Gujarati",
  hinglish: "Hinglish",
};

/** BCP 47 tag of the page text a language is written in (for `lang` attributes). */
export const AI_LANGUAGE_HTML_LANG: Record<AiLanguage, string> = {
  auto: "en",
  en: "en",
  hi: "hi",
  gu: "gu",
  hinglish: "hi-Latn",
};

/**
 * The language the browser's speech recognition listens for. Hinglish is
 * spoken Hindi mixed with English, which the Indian-English model handles best.
 */
export const AI_SPEECH_LANGUAGE: Record<AiLanguage, "en-IN" | "hi-IN" | "gu-IN"> = {
  auto: "en-IN",
  en: "en-IN",
  hi: "hi-IN",
  gu: "gu-IN",
  hinglish: "en-IN",
};

/** Anything that is not a known language (a bad row, an old client) is "auto". */
export function normaliseAiLanguage(value: unknown): AiLanguage {
  const r = aiLanguageSchema.safeParse(value);
  return r.success ? r.data : AI_DEFAULT_LANGUAGE;
}

export const aiUserPrefsSchema = z.object({
  language: aiLanguageSchema,
  /** Show the assistant's tips on the dashboard. */
  tipsEnabled: z.boolean(),
});
export type AiUserPrefs = z.infer<typeof aiUserPrefsSchema>;

export const AI_DEFAULT_USER_PREFS: AiUserPrefs = { language: AI_DEFAULT_LANGUAGE, tipsEnabled: true };

/** An update: any field left out keeps what is stored. */
export const aiUserPrefsUpdateSchema = aiUserPrefsSchema.partial().refine((v) => v.language !== undefined || v.tipsEnabled !== undefined, "Nothing to change");
export type AiUserPrefsUpdate = z.infer<typeof aiUserPrefsUpdateSchema>;
