/** Suggested questions to start with: English first, then Hindi and Hinglish examples (the assistant answers in the language of the question). */

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
