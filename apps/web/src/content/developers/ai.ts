import type { EndpointDef, EndpointGroup, EndpointParam } from "./types";
import { API_BASE_URL } from "./api-base";

const UUID = "5d3c0d5e-3f0e-4b43-9d7c-0f3a8f7d9a11";
const id = (name: string, description: string): EndpointParam => ({ name, type: "string (UUID)", required: true, description });

type Role = "viewer" | "member" | "admin";

/** One AI assistant endpoint. */
function ep(spec: {
  slug: string;
  path: string;
  method: "query" | "mutation";
  title: string;
  description: string;
  auth?: "business" | "protected";
  role?: Role;
  input?: EndpointParam[];
  output: string;
  example: unknown;
  sample?: Record<string, unknown>;
  gotchas?: string[];
  related?: string[];
}): EndpointDef {
  const input = spec.sample ?? {};
  const hasInput = (spec.input ?? []).length > 0;
  const body = JSON.stringify({ json: input });
  const business = (spec.auth ?? "business") === "business";
  return {
    id: `ai-${spec.slug}`,
    method: spec.method,
    path: spec.path,
    title: spec.title,
    description: spec.description,
    auth: spec.auth ?? "business",
    ...(business ? { requiredRole: spec.role ?? (spec.method === "query" ? "viewer" : "member") } : {}),
    input: spec.input ?? [],
    output: { description: spec.output, example: spec.example },
    codeExamples: {
      curl:
        spec.method === "query"
          ? `curl "${API_BASE_URL}/api/trpc/${spec.path}${hasInput ? `?input=${encodeURIComponent(body)}` : ""}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"${business ? ` \\
  -H "x-business-id: YOUR_BUSINESS_ID"` : ""}`
          : `curl -X POST "${API_BASE_URL}/api/trpc/${spec.path}" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\${business ? `
  -H "x-business-id: YOUR_BUSINESS_ID" \\` : ""}
  -H "Content-Type: application/json" \\
  -d '${body}'`,
      javascript: `const result = await trpc.${spec.path}.${spec.method === "query" ? "query" : "mutate"}(${hasInput ? JSON.stringify(input) : ""});`,
    },
    gotchas: spec.gotchas,
    relatedEndpoints: spec.related?.map((r) => `ai-${r}`),
  };
}

const ADDON = "Needs the AI Assistant add-on (a Full Access Trial, an admin grant, or a subscription; AI Plus includes it).";
const PERM = "Requires the `Ai` permission (owner, admin, sales manager, salesperson and accountant; not the auditor and filing-CA roles).";
const OWNER = "Owner only (tenant role owner or superadmin).";

const CONVERSATION = { id: UUID, title: "How much do customers owe me?", createdAt: "2026-10-09T05:00:00.000Z", updatedAt: "2026-10-09T05:01:10.000Z" };

const ACTION_CARD = {
  type: "confirmation",
  actionId: UUID,
  kind: "create_invoice",
  title: "New sales invoice",
  status: "pending",
  fields: [{ label: "Customer", value: "Asha Traders, Pune" }, { label: "Date", value: "9 Oct 2026" }],
  table: { columns: ["Item", "Qty", "Rate", "Disc %", "GST %", "Amount incl. GST"], rows: [["Cotton Fabric", "4", "₹250.00", "0", "5", "₹1,050.00"]] },
  totals: [{ label: "Subtotal", value: "₹1,000.00" }, { label: "CGST", value: "₹25.00" }, { label: "SGST", value: "₹25.00" }, { label: "Total", value: "₹1,050.00", strong: true }],
  warnings: [],
  note: "Nothing is saved until you tap Confirm. The invoice number is given when it is saved.",
  edits: [{ key: "date", label: "Date", input: "date", value: "2026-10-09" }, { key: "lines.0.quantity", label: "Line 1 (Cotton Fabric): quantity", input: "number", value: "4" }],
  expiresAt: "2026-10-09T05:30:00.000Z",
};

export const aiEndpoints: EndpointGroup = {
  id: "ai-assistant",
  title: "AI Assistant (add-on)",
  description:
    "Ask Fintranzact AI: a chat that answers questions about one business from its live data (sales, dues, stock, expiring batches, GST payable, cash and bank, comparisons). It is a paid add-on (`ai_assistant`; `ai_plus` includes it) and answers questions without changing anything. **Actions (Phase 2).** It can also PREPARE an invoice, quotation, payment, party, item or payment reminder: the model only proposes (`propose_*` tools); the proposal is validated against the real procedure's input, stored as a pending action and shown as a confirmation card. Nothing is saved until the person taps Confirm, which calls `ai.confirmAction` as them (the same permissions, plan limits, period locks, numbering, GST and audit as the normal screen). The model has no tool to confirm, edit or cancel, and none of those procedures can be reached from the chat stream. **Where the answer comes from.** The assistant calls the same procedures documented in this reference (dashboard, reports, invoices, parties, stock, banking and GST reads) through a server-side caller built from the signed-in user's own session: the same business, the same permissions, the same entitlement checks. A procedure the user may not call comes back to the model as a polite refusal. The business id never comes from the model. Payroll is not exposed. **Streaming route.** `POST /api/ai/stream` with `{ conversationId?, message, context? }` (message 1 to 1000 characters; `context` is the page the person is on, one of `{ kind: \"invoice\" | \"quotation\" | \"party\" | \"item\", id }`, `{ kind: \"report\", report, from?, to? }` or `{ kind: \"page\", page }`: ids are checked on the server through the person's own permissions and anything that does not check out is dropped silently) answers with server-sent events: `meta { conversationId, model, tier }`, `tool { name, status }`, `text { delta }`, `done { conversationId, messageId, text, cards, remaining }` or `error { code, message }`. Authentication, `X-Requested-With` (cookie sessions), `x-business-id` and the entitlement checks are the same as for tRPC calls. A refusal before the stream starts is plain JSON `{ error, code, entitlement? }` with HTTP 400/401/403/404/429/503 and a `code` of `addon_required`, `quota_exhausted`, `read_only`, `switched_off`, `forbidden`, `not_configured`, `rate_limited` or `bad_request`. The route is refused for read-only and suspended organizations (403 with the standard entitlement body). Each person may ask about 12 questions a minute. Closing the connection stops the answer; nothing useful produced means the question is given back. **Cards.** `done.cards` holds validated cards only: `table`, `bar_chart` and `link` (to an invoice, one of a fixed list of reports or one of a fixed list of pages), plus `confirmation` cards for actions the assistant prepared. A `confirmation` card is built by the server from a stored pending action; the model cannot write one (a model-written `confirmation` card is dropped like any unknown type). It carries `actionId`, `kind`, `title`, `status` (`pending`, `confirmed`, `cancelled`, `expired`, `failed`), `fields`, a `table` of lines, `totals`, `warnings`, a `message` to review (a reminder's text), the editable `edits`, `expiresAt`, and, once done, a `result` `{ entityType, id, label, externalUrl? }`. **Quota.** One question is one message that gets an answer. AI Assistant includes 150 a month and AI Plus 500 (calendar month, Indian time); a Full Access Trial includes `trial.caps.aiQuestions` (default 50) for the whole trial; extra packs of 100 are credits an admin grants and are used after the included questions. A question given back after a provider failure is not counted. **Owner controls.** The owner can switch the assistant off for the organization or for roles; it is enforced on the server. **Audit.** Every question (a short truncated copy, no business data) and each tool call (its name and outcome) is written to the audit log with `source: \"via AI assistant\"` (`ai.question`, `ai.toolCall`). **Pending actions.** A proposal lives 30 minutes (`expiresAt`), is private to the person it was prepared for in that business (another admin, even the owner, cannot see, edit, confirm or cancel it: NOT_FOUND), and is not part of the data export. The kinds are `create_invoice`, `create_quotation`, `record_payment`, `create_party`, `create_item` and `send_payment_reminder`; each needs the same permission as the screen (invoice, quotation: create Invoice; payment: create Payment; party: create Party; item: create Item; reminder: update Invoice), checked when the tool is offered, when it is proposed and again when it is confirmed. The assistant resolves parties, items and invoices by the ids its lookup tools return, never by name alone, and uses only values the person gave. A reminder by email or SMS is sent when confirmed, exactly like Send reminder on the invoice; a WhatsApp reminder is recorded and returns a click-to-send `wa.me` link for the person to open (nothing is sent by the app). Audit entries `ai.action.propose`, `ai.action.edit`, `ai.action.confirm`, `ai.action.cancel` and `ai.action.fail` carry `source: \"via AI assistant\"`, and so does the record's own entry (for example `invoice.create`) with `aiActionId`. Confirming, editing and cancelling cost no question. **Owner controls for actions.** The owner can switch actions off for the organization or for roles (`actionsEnabled`, `actionsDisabledRoles`), separately from the chat. **Languages, tips and help answers (Phase 3).** Each person has a reply language (`auto`, `en`, `hi`, `gu`, `hinglish`) and a tips switch, stored per business and person (`ai.preferences`, `ai.updatePreferences`); the stream route reads the stored language, never one sent in the request, and it can only select one of those values. Replies in Hindi and Gujarati keep amounts, dates and names exactly as the books have them. `ai.tips` returns a few deterministic tips for the dashboard (overdue invoices, items below reorder level, expiring or expired batches, a GST return near its due date): no model is called, no question is used, nothing is audited, and every figure is read with the person's own permissions. The assistant can also answer \"how do I...\" questions from the help centre with the read-only `search_help` tool; its answers can carry a `link` card whose target is `{ kind: \"help\", path }`, where `path` must be an existing help article (anything else is dropped). Voice input is a browser feature (the browser's own speech recognition fills the question box); no audio is sent to Fintranzact and there is no speech endpoint. **The API key** for the AI provider is a server setting (`ANTHROPIC_API_KEY`) and is never returned to clients; without it `ai.status` says `configured: false`. Without the add-on a call fails with FORBIDDEN and `error.data.entitlement = { reason: \"addon_required\", addon: \"ai_assistant\" }`.",
  endpoints: [
    ep({
      slug: "status", path: "ai.status", method: "query", title: "Assistant Status",
      description: "What the chat panel needs: whether the server has an AI provider key, whether this person may use the assistant (and why not), the tier and the questions left. Never fails for a missing add-on.",
      output: "`configured`, `access` (`ok`, `addon_required`, `org_disabled`, `role_disabled`, `read_only` or `suspended`), `isOwner`, `tier` (`trial`, `assistant`, `plus` or `null`), `allowance` (`scope` `month` or `trial`, `limit`, `used`, `includedRemaining`, `creditsRemaining`, `remaining`, `exhausted`) or `null`, and `actionKinds`: the action kinds the assistant may prepare for this person right now (empty when actions are switched off or the role has no permission).",
      example: { configured: true, access: "ok", isOwner: true, tier: "assistant", allowance: { scope: "month", limit: 150, used: 12, includedRemaining: 138, creditsRemaining: 0, remaining: 138, exhausted: false }, actionKinds: ["create_invoice", "create_quotation", "record_payment", "create_party", "create_item", "send_payment_reminder"] },
      gotchas: [PERM],
      related: ["begin", "settings"],
    }),
    ep({
      slug: "conversations", path: "ai.conversations", method: "query", title: "List My Conversations",
      description: "The signed-in person's own conversations in this business, newest first. Nobody else's are ever returned, not even to an owner.",
      output: "An array of `{ id, title, createdAt, updatedAt }`.",
      example: [CONVERSATION],
      gotchas: [PERM, ADDON + " A read-only organization still reads its saved chats.", "FORBIDDEN while the assistant is switched off for the organization or the role."],
      related: ["conversation", "delete-conversation"],
    }),
    ep({
      slug: "conversation", path: "ai.conversation", method: "query", title: "Open A Conversation",
      description: "One of the person's own conversations with its messages. Assistant messages carry validated `cards` and a `toolCalls` summary (tool name and outcome only, never the data a tool returned).",
      input: [id("id", "The conversation")],
      output: "`{ id, title, createdAt, updatedAt, messages: [{ id, role, content, cards, toolCalls, createdAt }] }`.",
      example: { ...CONVERSATION, messages: [{ id: UUID, role: "user", content: "How much do customers owe me?", cards: [], toolCalls: [], createdAt: "2026-10-09T05:00:00.000Z" }, { id: UUID, role: "assistant", content: "You are owed ₹10,500.00 (Outstanding report, as of 9 Oct 2026).", cards: [{ type: "bar_chart", title: "Dues", unit: "₹", bars: [{ label: "Asha Traders", value: 10500 }] }], toolCalls: [{ name: "outstanding_balances", status: "ok" }], createdAt: "2026-10-09T05:00:05.000Z" }] },
      sample: { id: UUID },
      gotchas: [PERM, ADDON, "NOT_FOUND for a conversation that is not yours, including another person's in the same business."],
    }),
    ep({
      slug: "delete-conversation", path: "ai.deleteConversation", method: "mutation", title: "Delete A Conversation",
      description: "Delete one of the person's own conversations and its messages.",
      input: [id("id", "The conversation")],
      output: "The id.",
      example: { id: UUID },
      sample: { id: UUID },
      gotchas: [PERM, "NOT_FOUND for a conversation that is not yours. Refused while the organization is read-only like every write."],
    }),
    ep({
      slug: "begin", path: "ai.begin", method: "mutation", title: "Begin A Question",
      description: "Start a question: checks the permission, the add-on, the owner's switches and that the server has a provider key, takes ONE question from the quota atomically, saves the person's message (creating the conversation when none is given) and records the audit entry. `POST /api/ai/stream` calls it for you and then asks the model; call it directly only if you build your own client. A question that is never answered is given back after a few minutes.",
      input: [
        { name: "conversationId", type: "string (UUID)", required: false, description: "Continue one of your own conversations; omit to start a new one" },
        { name: "message", type: "string", required: true, description: "The question, 1 to 1000 characters" },
      ],
      output: "The `conversationId`, the `usageId` of the ledger row, the `tier`, whether the conversation is new, the earlier `history` (text turns only, with a one-line note on where each card stands), the `actionKinds` the assistant may prepare for this person and their permission `role`.",
      example: { conversationId: UUID, usageId: UUID, tier: "assistant", isNewConversation: true, history: [], actionKinds: ["create_invoice", "record_payment"], role: "seller" },
      sample: { message: "How much do customers owe me?" },
      gotchas: [
        PERM,
        ADDON,
        "FORBIDDEN `plan_limit` with the wording \"Your organisation has used all its AI questions for this month. Ask your owner to add more.\" when the monthly (or trial) questions and any extra packs are used up.",
        "FORBIDDEN `The AI assistant is switched off for your organisation / your role.` when the owner has switched it off; SERVICE_UNAVAILABLE when the server has no provider key.",
      ],
      related: ["status"],
    }),
    ep({
      slug: "settings", path: "ai.settings", method: "query", title: "Get Assistant Switches",
      description: "The owner's switches: the assistant on or off for the organization, the roles it is off for, and the roles that can be switched.",
      auth: "protected",
      output: "`{ enabled, disabledRoles, actionsEnabled, actionsDisabledRoles, roles: [{ role, label }] }`.",
      example: { enabled: true, disabledRoles: ["seller"], actionsEnabled: true, actionsDisabledRoles: [], roles: [{ role: "admin", label: "Admin" }, { role: "seller_manager", label: "Sales manager" }, { role: "seller", label: "Salesperson" }, { role: "accountant", label: "Accountant" }] },
      gotchas: [OWNER, "Uses the selected organization (no business needed)."],
      related: ["update-settings"],
    }),
    ep({
      slug: "update-settings", path: "ai.updateSettings", method: "mutation", title: "Update Assistant Switches",
      description: "Switch the assistant off for the whole organization or for roles (`admin`, `seller_manager`, `seller`, `accountant`). Enforced on the server: a refused role cannot ask, list or open chats. The owner is never locked out, so the assistant can always be switched back on.",
      auth: "protected",
      input: [
        { name: "enabled", type: "boolean", required: true, description: "The assistant on for the organization" },
        { name: "disabledRoles", type: "string[]", required: true, description: "Roles it is off for", enumValues: ["admin", "seller_manager", "seller", "accountant"] },
        { name: "actionsEnabled", type: "boolean", required: false, description: "The assistant may prepare actions (default on). Left out = unchanged" },
        { name: "actionsDisabledRoles", type: "string[]", required: false, description: "Roles actions are off for. Left out = unchanged", enumValues: ["admin", "seller_manager", "seller", "accountant"] },
      ],
      output: "The saved switches.",
      example: { enabled: true, disabledRoles: ["seller"], actionsEnabled: true, actionsDisabledRoles: [] },
      sample: { enabled: true, disabledRoles: ["seller"] },
      gotchas: [OWNER, "Refused while the organization is read-only like every write."],
      related: ["settings"],
    }),
    ep({
      slug: "preferences", path: "ai.preferences", method: "query", title: "Get My Assistant Preferences",
      description: "The signed-in person's own reply language and dashboard-tips switch for this business. Defaults (`auto`, tips on) when never saved. Private to the person.",
      output: "`{ language, tipsEnabled }` with `language` one of `auto`, `en`, `hi`, `gu`, `hinglish`.",
      example: { language: "gu", tipsEnabled: true },
      gotchas: [PERM, "Readable while the organization is read-only or the add-on lapsed: it is the person's own setting."],
      related: ["update-preferences", "tips"],
    }),
    ep({
      slug: "update-preferences", path: "ai.updatePreferences", method: "mutation", title: "Update My Assistant Preferences",
      description: "Change the reply language and/or switch the dashboard tips on or off, for this person only. A field left out is unchanged. The language is also what the microphone listens for in the web app.",
      input: [
        { name: "language", type: "string", required: false, description: "Reply language", enumValues: ["auto", "en", "hi", "gu", "hinglish"] },
        { name: "tipsEnabled", type: "boolean", required: false, description: "Show the assistant's tips on the dashboard" },
      ],
      output: "The saved preferences.",
      example: { language: "hi", tipsEnabled: false },
      sample: { language: "hi" },
      gotchas: [PERM, ADDON, "At least one field is required (BAD_REQUEST otherwise); a language outside the list is BAD_REQUEST. Refused while the organization is read-only like every write. Costs no question."],
      related: ["preferences"],
    }),
    ep({
      slug: "tips", path: "ai.tips", method: "query", title: "Dashboard Tips",
      description: "A few proactive tips for the dashboard, worked out from the books without calling a model: overdue sales invoices (count, total owed, oldest due date), items below reorder level, expired and soon-expiring batches, and a GST return (GSTR-1 on the 11th, GSTR-3B on the 20th) due within a week for a regular GST registration that had sales in the month. Computed through the person's own permissions, so a data area the role cannot read gives no tip; payroll is never read. At most 4 tips, cached for 5 minutes per person and business. Costs no question and works when the monthly questions are used up; nothing is audited.",
      output: "`{ available, reason, tips, day }`. `reason` is `ok` or why there are none: `addon_required`, `read_only`, `suspended`, `org_disabled`, `role_disabled`, `tips_off`. Each tip is `{ id, kind (overdue_invoices, low_stock, expiring_batches, gst_due), severity (critical, warning, info), text, ask?, link: { label, target } }` where `target` is an allowlisted link (a report, a page, an invoice or a help article), never a free URL; `ask` is a question to prefill in the assistant. `day` is the India date the tips were computed for.",
      example: { available: true, reason: "ok", day: "2026-10-09", tips: [{ id: "overdue_invoices", kind: "overdue_invoices", severity: "warning", text: "3 invoices are overdue (₹1,20,000.00 to collect). The oldest was due on 2 Aug 2026.", ask: "Which customers have overdue invoices, and how much does each owe?", link: { label: "Open the Outstanding report", target: { kind: "report", report: "outstanding" } } }] },
      gotchas: [PERM, "Never throws for a missing add-on or a switch: check `available` and `reason`. Needs the add-on, a writable organization, the owner's organization and role switches on and the person's own tips switch on."],
      related: ["preferences", "settings"],
    }),
    ep({
      slug: "action", path: "ai.action", method: "query", title: "Get An Action Card",
      description: "One of the person's own pending or finished actions as its confirmation card, as it is now (a waiting one past its time is `expired`). The chat polls it while a confirmation is still saving.",
      input: [id("id", "The action (`actionId` on the card)")],
      output: "The confirmation card.",
      example: ACTION_CARD,
      sample: { id: UUID },
      gotchas: [PERM, ADDON + " A read-only organization still reads its cards.", "NOT_FOUND for an action that is not yours, including another person's in the same business."],
      related: ["confirm-action", "update-action", "cancel-action"],
    }),
    ep({
      slug: "update-action", path: "ai.updateAction", method: "mutation", title: "Edit An Action Card",
      description: "The person edits fields on the card before confirming: dates, quantities, rates, discounts, notes, a payment's amount, mode, date and reference, a party's or item's details, a reminder's channel. The server applies the edit to the stored payload, validates it against the real procedure's schema and recomputes the card (totals, GST); the model is not involved. Ids cannot be edited. Only while the action is pending and not expired.",
      input: [
        id("id", "The action"),
        { name: "edits", type: "object", required: true, description: "Field key to new text, using the keys on the card's `edits` (for example `date`, `notes`, `lines.0.quantity`, `amount`, `mode`). Between 1 and 40 fields" },
      ],
      output: "The updated confirmation card.",
      example: ACTION_CARD,
      sample: { id: UUID, edits: { "lines.0.quantity": "10", notes: "Deliver Monday" } },
      gotchas: [PERM + " Also needs the permission for the action itself and the owner's action switches.", "BAD_REQUEST with a message for a value that is not valid; CONFLICT once the action is confirmed, cancelled or expired; NOT_FOUND for an action that is not yours. Refused while the organization is read-only like every write."],
      related: ["confirm-action"],
    }),
    ep({
      slug: "confirm-action", path: "ai.confirmAction", method: "mutation", title: "Confirm An Action",
      description: "The person taps Confirm. The only place an assistant proposal becomes a write. Checks the add-on, the owner's switches and the permission for this kind of action (a role changed since the proposal is refused and the action stays waiting), claims the action exactly once (pending to confirmed under a row lock) and then runs the real procedure (`invoice.create`, `quotation.create`, `payment.create`, `party.create`, `item.create` or `reminder.sendNow`) through a caller built from the person's own request, so every normal rule applies: validation, plan limits, period locks, numbering, GST, stock, idempotency and audit (entries say `via AI assistant`). Idempotent: a second or concurrent call returns the first outcome and creates nothing more.",
      input: [id("id", "The action")],
      output: "`{ status, card, message, executedNow }`. `status` is `confirmed`, `failed` (the procedure refused: `message` and `card.error` say why, for example a locked period, and the action is not retried), `expired` or `cancelled`. `executedNow` is false when this call returned an earlier outcome. `card.result` names the record created and, for a WhatsApp reminder, the `externalUrl` to open.",
      example: { status: "confirmed", message: null, executedNow: true, card: { ...ACTION_CARD, status: "confirmed", edits: [], result: { entityType: "invoice", id: UUID, label: "Invoice INV-00007" } } },
      sample: { id: UUID },
      gotchas: [PERM + " Also needs the permission for the action itself (FORBIDDEN \"You do not have permission to do this. Ask your owner for access.\" if it changed since the proposal), the add-on and the owner's action switches (FORBIDDEN with the wording of the switch).", "Refused while the organization is read-only or suspended, with the standard entitlement body. NOT_FOUND for an action that is not yours. Costs no AI question."],
      related: ["action", "cancel-action"],
    }),
    ep({
      slug: "cancel-action", path: "ai.cancelAction", method: "mutation", title: "Cancel An Action",
      description: "The person taps Cancel on a waiting card. Nothing was saved and nothing is. Cancelling a finished action does not undo it (it returns the card as it stands).",
      input: [id("id", "The action")],
      output: "The confirmation card.",
      example: { ...ACTION_CARD, status: "cancelled", edits: [] },
      sample: { id: UUID },
      gotchas: [PERM, "NOT_FOUND for an action that is not yours. Refused while the organization is read-only like every write."],
      related: ["confirm-action"],
    }),
  ],
};
