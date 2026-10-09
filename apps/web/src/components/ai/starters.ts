/**
 * Suggested questions to start with. They follow the person's reply language
 * preference: "auto" shows a mix of English, Hinglish, Hindi and Gujarati (the
 * assistant answers in the language of the question), the other choices show
 * only that language.
 */

import type { AiActionKind, AiLanguage } from "@fintranzact/shared";

export interface AiStarter {
  text: string;
  /** BCP 47 tag for the question, so screen readers pronounce it properly. */
  lang: "en" | "hi" | "hi-Latn" | "gu";
}

/** The mixed list shown for the "auto" language. */
export const AI_STARTERS: AiStarter[] = [
  { text: "How much do customers owe me?", lang: "en" },
  { text: "Which items are low on stock?", lang: "en" },
  { text: "Compare this month's sales with last month", lang: "en" },
  { text: "Which batches expire in the next 30 days?", lang: "en" },
  { text: "What is my GST payable for last month?", lang: "en" },
  { text: "Who are my top 5 customers this year?", lang: "en" },
  { text: "Is mahine ki sales kitni hui?", lang: "hi-Latn" },
  { text: "Cash aur bank mein kitna balance hai?", lang: "hi-Latn" },
  { text: "ग्राहकों से कितना बकाया है?", lang: "hi" },
  { text: "कौन से आइटम का स्टॉक कम है?", lang: "hi" },
  { text: "ગ્રાહકો પાસેથી કેટલી રકમ લેવાની બાકી છે?", lang: "gu" },
  { text: "કયા આઇટમનો સ્ટોક ઓછો છે?", lang: "gu" },
];

/** Hindi (Devanagari) starters, shown when the reply language is Hindi. */
export const HINDI_STARTERS: AiStarter[] = [
  { text: "ग्राहकों से कितना बकाया है?", lang: "hi" },
  { text: "कौन से आइटम का स्टॉक कम है?", lang: "hi" },
  { text: "इस महीने की बिक्री की तुलना पिछले महीने से करो", lang: "hi" },
  { text: "अगले 30 दिनों में कौन से बैच की एक्सपायरी है?", lang: "hi" },
  { text: "पिछले महीने का GST कितना देना है?", lang: "hi" },
  { text: "इस साल मेरे टॉप 5 ग्राहक कौन हैं?", lang: "hi" },
  { text: "कैश और बैंक में कुल कितना बैलेंस है?", lang: "hi" },
  { text: "इनवॉइस कैसे बनाते हैं?", lang: "hi" },
];

/** Gujarati starters, shown when the reply language is Gujarati. */
export const GUJARATI_STARTERS: AiStarter[] = [
  { text: "ગ્રાહકો પાસેથી કેટલી રકમ લેવાની બાકી છે?", lang: "gu" },
  { text: "કયા આઇટમનો સ્ટોક ઓછો છે?", lang: "gu" },
  { text: "આ મહિનાના વેચાણની સરખામણી ગયા મહિના સાથે કરો", lang: "gu" },
  { text: "આવતા 30 દિવસમાં કયા બેચની એક્સપાયરી છે?", lang: "gu" },
  { text: "ગયા મહિનાનો GST કેટલો ભરવાનો છે?", lang: "gu" },
  { text: "આ વર્ષના મારા ટોપ 5 ગ્રાહકો કોણ છે?", lang: "gu" },
  { text: "રોકડ અને બેંકમાં કુલ કેટલું બેલેન્સ છે?", lang: "gu" },
  { text: "ઇનવોઇસ કેવી રીતે બનાવવું?", lang: "gu" },
];

/** Hinglish (Hindi in English letters) starters. */
export const HINGLISH_STARTERS: AiStarter[] = [
  { text: "Customers se kitna baaki hai?", lang: "hi-Latn" },
  { text: "Kin items ka stock kam hai?", lang: "hi-Latn" },
  { text: "Is mahine ki sales kitni hui?", lang: "hi-Latn" },
  { text: "Agle 30 din mein kaun se batch expire honge?", lang: "hi-Latn" },
  { text: "Pichhle mahine ka GST kitna dena hai?", lang: "hi-Latn" },
  { text: "Cash aur bank mein kitna balance hai?", lang: "hi-Latn" },
  { text: "Is saal ke top 5 customers kaun hain?", lang: "hi-Latn" },
  { text: "Invoice kaise banate hain?", lang: "hi-Latn" },
];

export const ENGLISH_STARTERS: AiStarter[] = [
  ...AI_STARTERS.filter((s) => s.lang === "en"),
  { text: "How do I create an invoice?", lang: "en" },
  { text: "How do I record a payment?", lang: "en" },
];

/** The questions to suggest for the person's reply language. */
export function startersFor(language: AiLanguage | undefined): AiStarter[] {
  switch (language) {
    case "en": return ENGLISH_STARTERS;
    case "hi": return HINDI_STARTERS;
    case "gu": return GUJARATI_STARTERS;
    case "hinglish": return HINGLISH_STARTERS;
    default: return AI_STARTERS;
  }
}

/**
 * Action examples (Phase 2). Shown only when the person's role may do the
 * action and the owner has actions switched on. They are NOT sent when tapped:
 * `fill` goes into the question box for the person to complete, because every
 * one of them needs details only the person knows (who, what, how much).
 */
export interface AiActionStarter extends AiStarter {
  kind: AiActionKind;
  /** What is put in the question box. */
  fill: string;
}

export const AI_ACTION_STARTERS: AiActionStarter[] = [
  { kind: "create_invoice", text: "Create an invoice for …", fill: "Create an invoice for ", lang: "en" },
  { kind: "record_payment", text: "Record a payment of … from …", fill: "Record a payment of ₹ from ", lang: "en" },
  { kind: "send_payment_reminder", text: "Send a payment reminder to …", fill: "Send a WhatsApp payment reminder to ", lang: "en" },
  { kind: "create_party", text: "Add a new customer …", fill: "Add a new customer named ", lang: "en" },
  { kind: "create_item", text: "Add a new item …", fill: "Add a new item named ", lang: "en" },
  { kind: "create_quotation", text: "Create a quotation for …", fill: "Create a quotation for ", lang: "en" },
  { kind: "create_invoice", text: "… ke liye invoice banao", fill: "Invoice banao: ", lang: "hi-Latn" },
  { kind: "record_payment", text: "… se ₹ ka payment record karo", fill: "Payment record karo: ₹", lang: "hi-Latn" },
  { kind: "create_invoice", text: "… के लिए इनवॉइस बनाओ", fill: "इनवॉइस बनाओ: ", lang: "hi" },
  { kind: "create_invoice", text: "… માટે ઇનવોઇસ બનાવો", fill: "ઇનવોઇસ બનાવો: ", lang: "gu" },
  { kind: "record_payment", text: "… પાસેથી ₹ ની ચુકવણી નોંધો", fill: "ચુકવણી નોંધો: ₹", lang: "gu" },
];

const ACTION_LANGS: Record<AiLanguage, Array<AiStarter["lang"]> | null> = {
  auto: null,
  en: ["en"],
  hi: ["hi", "en"],
  gu: ["gu", "en"],
  hinglish: ["hi-Latn", "en"],
};

/** The action examples this person may see: only kinds their role can do (none when actions are off), in their reply language. */
export function actionStartersFor(kinds: readonly AiActionKind[] | undefined, language?: AiLanguage): AiActionStarter[] {
  if (!kinds || kinds.length === 0) return [];
  const langs = language ? ACTION_LANGS[language] : null;
  return AI_ACTION_STARTERS.filter((s) => kinds.includes(s.kind) && (!langs || langs.includes(s.lang)));
}
