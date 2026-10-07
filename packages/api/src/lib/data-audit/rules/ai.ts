/** Data audit rules for the AI assistant's conversation history (tenant tables). */

import type { TableCoverage } from "../types.js";
import { rule } from "../sql-fragments.js";

export const aiTables: TableCoverage[] = [
  {
    table: "ai_conversations",
    rules: [],
    noExtraRequirements:
      "A conversation is a title, its owner (a plain user id, users live in the control database) and two timestamps; nothing is derived and nothing must reconcile.",
  },
  {
    table: "ai_messages",
    rules: [
      rule("ai_messages", "same-business", "error",
        "A message belongs to the same business as its conversation (history is private to one business and one person).",
        ["lib/ai/service.ts beginQuestion / finishQuestion"],
        `SELECT m.business_id, m.id::text, 'message in business ' || m.business_id || ' but its conversation is in ' || c.business_id
         FROM ai_messages m
         JOIN ai_conversations c ON c.id = m.conversation_id
         WHERE m.business_id <> c.business_id`),
    ],
  },
];
