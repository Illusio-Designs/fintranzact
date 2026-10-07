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

export const aiEndpoints: EndpointGroup = {
  id: "ai-assistant",
  title: "AI Assistant (add-on)",
  description:
    "Ask Fintranzact AI: a chat that answers questions about one business from its live data (sales, dues, stock, expiring batches, GST payable, cash and bank, comparisons). It is a paid add-on (`ai_assistant`; `ai_plus` includes it) and Phase 1 is read-only: it never creates, edits or deletes anything. **Where the answer comes from.** The assistant calls the same procedures documented in this reference (dashboard, reports, invoices, parties, stock, banking and GST reads) through a server-side caller built from the signed-in user's own session: the same business, the same permissions, the same entitlement checks. A procedure the user may not call comes back to the model as a polite refusal. The business id never comes from the model. Payroll is not exposed. **Streaming route.** `POST /api/ai/stream` with `{ conversationId?, message }` (1 to 1000 characters) answers with server-sent events: `meta { conversationId, model, tier }`, `tool { name, status }`, `text { delta }`, `done { conversationId, messageId, text, cards, remaining }` or `error { code, message }`. Authentication, `X-Requested-With` (cookie sessions), `x-business-id` and the entitlement checks are the same as for tRPC calls. A refusal before the stream starts is plain JSON `{ error, code, entitlement? }` with HTTP 400/401/403/404/429/503 and a `code` of `addon_required`, `quota_exhausted`, `read_only`, `switched_off`, `forbidden`, `not_configured`, `rate_limited` or `bad_request`. The route is refused for read-only and suspended organizations (403 with the standard entitlement body). Each person may ask about 12 questions a minute. Closing the connection stops the answer; nothing useful produced means the question is given back. **Cards.** `done.cards` holds validated cards only: `table`, `bar_chart` and `link` (to an invoice, one of a fixed list of reports or one of a fixed list of pages); anything else the model writes is dropped and never sent. **Quota.** One question is one message that gets an answer. AI Assistant includes 150 a month and AI Plus 500 (calendar month, Indian time); a Full Access Trial includes `trial.caps.aiQuestions` (default 50) for the whole trial; extra packs of 100 are credits an admin grants and are used after the included questions. A question given back after a provider failure is not counted. **Owner controls.** The owner can switch the assistant off for the organization or for roles; it is enforced on the server. **Audit.** Every question (a short truncated copy, no business data) and each tool call (its name and outcome) is written to the audit log with `source: \"via AI assistant\"` (`ai.question`, `ai.toolCall`). **The API key** for the AI provider is a server setting (`ANTHROPIC_API_KEY`) and is never returned to clients; without it `ai.status` says `configured: false`. Without the add-on a call fails with FORBIDDEN and `error.data.entitlement = { reason: \"addon_required\", addon: \"ai_assistant\" }`.",
  endpoints: [
    ep({
      slug: "status", path: "ai.status", method: "query", title: "Assistant Status",
      description: "What the chat panel needs: whether the server has an AI provider key, whether this person may use the assistant (and why not), the tier and the questions left. Never fails for a missing add-on.",
      output: "`configured`, `access` (`ok`, `addon_required`, `org_disabled`, `role_disabled`, `read_only` or `suspended`), `isOwner`, `tier` (`trial`, `assistant`, `plus` or `null`) and `allowance` (`scope` `month` or `trial`, `limit`, `used`, `includedRemaining`, `creditsRemaining`, `remaining`, `exhausted`) or `null`.",
      example: { configured: true, access: "ok", isOwner: true, tier: "assistant", allowance: { scope: "month", limit: 150, used: 12, includedRemaining: 138, creditsRemaining: 0, remaining: 138, exhausted: false } },
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
      output: "The `conversationId`, the `usageId` of the ledger row, the `tier`, whether the conversation is new and the earlier `history` (text turns only).",
      example: { conversationId: UUID, usageId: UUID, tier: "assistant", isNewConversation: true, history: [] },
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
      output: "`{ enabled, disabledRoles, roles: [{ role, label }] }`.",
      example: { enabled: true, disabledRoles: ["seller"], roles: [{ role: "admin", label: "Admin" }, { role: "seller_manager", label: "Sales manager" }, { role: "seller", label: "Salesperson" }, { role: "accountant", label: "Accountant" }] },
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
      ],
      output: "The saved switches.",
      example: { enabled: true, disabledRoles: ["seller"] },
      sample: { enabled: true, disabledRoles: ["seller"] },
      gotchas: [OWNER, "Refused while the organization is read-only like every write."],
      related: ["settings"],
    }),
  ],
};
