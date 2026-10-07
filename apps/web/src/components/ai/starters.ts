/** Suggested questions to start with: English first, then Hindi and Hinglish examples (the assistant answers in the language of the question). */

import type { AiActionKind } from "@fintranzact/shared";

export interface AiStarter {
  text: string;
  /** BCP 47 tag for the question, so screen readers pronounce it properly. */
  lang: "en" | "hi" | "hi-Latn";
}

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
];

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
];

/** The action examples this person may see: only kinds their role can do, none when actions are off. */
export function actionStartersFor(kinds: readonly AiActionKind[] | undefined): AiActionStarter[] {
  if (!kinds || kinds.length === 0) return [];
  return AI_ACTION_STARTERS.filter((s) => kinds.includes(s.kind));
}
