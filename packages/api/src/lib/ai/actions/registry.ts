/**
 * The per-kind registry of the assistant's actions. To add a kind: write its
 * module beside these (schema in shared, permission in AI_ACTION_PERMISSIONS,
 * `propose`, `build`, `applyEdits`, `execute`), add it here, and add the kind to
 * AI_ACTION_KINDS. See docs/architecture/ai-assistant.md ("How to add an action kind").
 */

import { AI_ACTION_KINDS, type AiActionKind } from "@fintranzact/shared";
import { createInvoiceKind, createQuotationKind } from "./kinds/document.js";
import { recordPaymentKind } from "./kinds/payment.js";
import { createItemKind, createPartyKind } from "./kinds/master.js";
import { sendReminderKind } from "./kinds/reminder.js";
import type { AiActionDef } from "./types.js";

export const AI_ACTION_REGISTRY: Record<AiActionKind, AiActionDef> = {
  create_invoice: createInvoiceKind,
  create_quotation: createQuotationKind,
  record_payment: recordPaymentKind,
  create_party: createPartyKind,
  create_item: createItemKind,
  send_payment_reminder: sendReminderKind,
};

/** Tool name to its kind (a Map: `__proto__` and `constructor` are not tools). */
export const AI_ACTION_BY_TOOL = new Map<string, AiActionDef>(AI_ACTION_KINDS.map((k) => [AI_ACTION_REGISTRY[k].toolName, AI_ACTION_REGISTRY[k]]));

export function actionDef(kind: AiActionKind): AiActionDef {
  return AI_ACTION_REGISTRY[kind];
}
