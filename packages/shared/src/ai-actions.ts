/**
 * AI business assistant, Phase 2: actions with confirmation. The pure rules
 * shared by the API and web.
 *
 * - the action kinds, the permission each one needs (the SAME one the real
 *   screen's procedure checks), the 30-minute expiry,
 * - the inputs the MODEL may propose (small, strict, validated): the model
 *   never writes, it only proposes; the server turns a proposal into the
 *   real procedure's input and stores it as a pending action,
 * - the confirmation card (server-built from a stored pending action, validated
 *   again by the web; the model can never produce one),
 * - the page context the web panel sends with a question (allowlisted route
 *   patterns, UUIDs only).
 *
 * Nothing here touches a database, the network or the clock: callers pass `now`.
 */

import { z } from "zod";
import { AI_LINK_PAGE_PATHS, AI_LINK_PAGES, AI_LINK_REPORTS, parseAiCards, stripControlChars, type AiCard } from "./ai.js";
import { paymentModes, partyTypes, units } from "./validators.js";
import { REMINDER_CHANNELS } from "./payment-reminders.js";

// ── Kinds, permissions, lifetime ─────────────────────────────────────────────

export const AI_ACTION_KINDS = [
  "create_invoice",
  "create_quotation",
  "record_payment",
  "create_party",
  "create_item",
  "send_payment_reminder",
] as const;
export type AiActionKind = (typeof AI_ACTION_KINDS)[number];

export const AI_ACTION_LABELS: Record<AiActionKind, string> = {
  create_invoice: "Create invoice",
  create_quotation: "Create quotation",
  record_payment: "Record payment",
  create_party: "Add party",
  create_item: "Add item",
  send_payment_reminder: "Send payment reminder",
};

export type AiActionSubject = "Invoice" | "Payment" | "Party" | "Item";

/**
 * The CASL permission each kind needs: exactly what the real procedure checks
 * (invoice.create and quotation.create: create Invoice; payment.create: create
 * Payment; party.create: create Party; item.create: create Item; reminder.sendNow:
 * update Invoice). Checked when the action is proposed (the tool is not even
 * offered without it) and again when it is confirmed.
 */
export const AI_ACTION_PERMISSIONS: Record<AiActionKind, { action: "create" | "update"; subject: AiActionSubject }> = {
  create_invoice: { action: "create", subject: "Invoice" },
  create_quotation: { action: "create", subject: "Invoice" },
  record_payment: { action: "create", subject: "Payment" },
  create_party: { action: "create", subject: "Party" },
  create_item: { action: "create", subject: "Item" },
  send_payment_reminder: { action: "update", subject: "Invoice" },
};

export function isAiActionKind(value: unknown): value is AiActionKind {
  return typeof value === "string" && (AI_ACTION_KINDS as readonly string[]).includes(value);
}

/** The kinds a person's abilities allow (`can` is the caller's own permission check). */
export function aiActionKindsFor(can: (action: "create" | "update", subject: AiActionSubject) => boolean): AiActionKind[] {
  return AI_ACTION_KINDS.filter((k) => can(AI_ACTION_PERMISSIONS[k].action, AI_ACTION_PERMISSIONS[k].subject));
}

/** A proposal waits this long for the person to confirm it. */
export const AI_ACTION_TTL_MS = 30 * 60_000;
/** Finished (confirmed, cancelled, expired, failed) proposals are deleted after this many days. The audit entries stay. */
export const AI_ACTION_PURGE_DAYS = 30;

export const AI_ACTION_STATUSES = ["pending", "confirmed", "cancelled", "expired", "failed"] as const;
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];

export function aiActionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + AI_ACTION_TTL_MS);
}

export function isAiActionExpired(expiresAt: Date | string, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

/** A pending proposal past its time is "expired" even before a sweep marks the row. */
export function effectiveAiActionStatus(status: AiActionStatus, expiresAt: Date | string, now: Date): AiActionStatus {
  return status === "pending" && isAiActionExpired(expiresAt, now) ? "expired" : status;
}

/** The cut-off before which finished proposals are purged. */
export function aiActionPurgeCutoff(now: Date): Date {
  return new Date(now.getTime() - AI_ACTION_PURGE_DAYS * 86_400_000);
}

export const AI_ACTIONS_OFF_MESSAGE = "Actions are switched off for your organisation. The owner can switch them on in Settings.";
export const AI_ACTIONS_ROLE_OFF_MESSAGE = "Actions are switched off for your role. The owner can change this in Settings.";
export const AI_ACTION_FORBIDDEN_MESSAGE = "You do not have permission to do this. Ask your owner for access.";

// ── What the model may propose ───────────────────────────────────────────────

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const probe = new Date(Date.UTC(y, m - 1, d));
    return y >= 2000 && y <= 2100 && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  }, "Not a real date");
export const aiYmd = ymd;

/** The model may write a number or a string; the real schemas want strings. */
const numStr = (re: RegExp, msg: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v.trim()))
    .pipe(z.string().regex(re, msg));
const amountStr = numStr(/^\d{1,13}(\.\d{1,2})?$/, "Use a plain positive amount with at most 2 decimals");
const qtyStr = numStr(/^\d{1,10}(\.\d{1,3})?$/, "Use a plain quantity with at most 3 decimals");
const percentStr = numStr(/^\d{1,3}(\.\d{1,2})?$/, "Use a percentage between 0 and 100").refine((v) => parseFloat(v) <= 100, "At most 100");

const text = (max: number) => z.string().trim().min(1).max(max);

/** One line of an invoice or quotation the model proposes. */
export const aiActionLineSchema = z
  .object({
    itemId: z.string().uuid().optional(),
    itemName: text(200).optional(),
    quantity: qtyStr.refine((v) => parseFloat(v) > 0, "Quantity must be above 0"),
    unitPrice: amountStr.optional(),
    taxPercent: percentStr.optional(),
    discountPercent: percentStr.optional(),
    description: z.string().trim().max(500).optional(),
    /** A one-off line that is not in the catalogue: needs the itemName and a unitPrice the person gave. */
    freeText: z.boolean().optional(),
  })
  .refine((l) => !!l.itemId || !!l.itemName, "Each line needs an itemId (from find_items) or an itemName")
  .refine((l) => !l.freeText || (!!l.itemName && !!l.unitPrice), "A freeText line needs an itemName and a unitPrice");
export type AiActionLine = z.infer<typeof aiActionLineSchema>;

const partyRef = {
  partyId: z.string().uuid().optional(),
  partyName: text(80).optional(),
};
const needParty = (v: { partyId?: string; partyName?: string }) => !!v.partyId || !!v.partyName;
const PARTY_MSG = "Give the partyId from find_parties (or a partyName to search; the server will return candidates)";

const documentShape = {
  ...partyRef,
  date: ymd.optional(),
  dueDate: ymd.optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(aiActionLineSchema).min(1).max(20),
};

export const aiCreateInvoiceInputSchema = z.object(documentShape).refine(needParty, PARTY_MSG);
export const aiCreateQuotationInputSchema = z.object(documentShape).refine(needParty, PARTY_MSG);

export const aiRecordPaymentInputSchema = z
  .object({
    ...partyRef,
    invoiceId: z.string().uuid().optional(),
    amount: amountStr.refine((v) => parseFloat(v) > 0, "Amount must be above 0"),
    mode: z.enum(paymentModes),
    date: ymd.optional(),
    referenceNumber: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => needParty(v) || !!v.invoiceId, PARTY_MSG);

export const aiCreatePartyInputSchema = z.object({
  type: z.enum(partyTypes),
  name: text(200),
  phone: z.string().trim().max(15).optional(),
  email: z.string().trim().email().max(200).optional(),
  gstin: z.string().trim().max(15).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  billingAddress: z.string().trim().max(500).optional(),
});

export const aiCreateItemInputSchema = z.object({
  name: text(200),
  itemType: z.enum(["product", "service"]).optional(),
  unit: z.enum(units).optional(),
  salePrice: amountStr.optional(),
  purchasePrice: amountStr.optional(),
  taxPercent: percentStr.optional(),
  hsn: z.string().trim().max(20).optional(),
  openingStock: qtyStr.optional(),
});

export const aiSendReminderInputSchema = z.object({
  invoiceId: z.string().uuid(),
  channel: z.enum(REMINDER_CHANNELS),
});

export const AI_ACTION_INPUT_SCHEMAS = {
  create_invoice: aiCreateInvoiceInputSchema,
  create_quotation: aiCreateQuotationInputSchema,
  record_payment: aiRecordPaymentInputSchema,
  create_party: aiCreatePartyInputSchema,
  create_item: aiCreateItemInputSchema,
  send_payment_reminder: aiSendReminderInputSchema,
} as const;

/** The tool the model calls for each kind. They only ever PROPOSE. */
export const AI_ACTION_TOOL_NAMES: Record<AiActionKind, string> = {
  create_invoice: "propose_create_invoice",
  create_quotation: "propose_create_quotation",
  record_payment: "propose_record_payment",
  create_party: "propose_create_party",
  create_item: "propose_create_item",
  send_payment_reminder: "propose_payment_reminder",
};

// ── The edits a person may make on a card ────────────────────────────────────

/** Keys the card's inline editor may send: dates, quantities, rates, notes, amounts, details. Never ids. */
export const AI_EDIT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,30}(\.\d{1,2}\.[A-Za-z][A-Za-z0-9]{0,30})?$/;

export const aiEditsSchema = z
  .record(z.string().regex(AI_EDIT_KEY_PATTERN), z.string().max(500))
  .refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 40, "Between 1 and 40 fields");

// ── The confirmation card ────────────────────────────────────────────────────

/** Multi-line text (a reminder message) shown as plain text: control characters other than newlines are removed. */
function multiline(max: number) {
  return z
    .string()
    .transform((s) =>
      s
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => stripControlChars(line, true).replace(/ {2,}/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .pipe(z.string().max(max));
}

function plain(max: number) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => stripControlChars(String(v), true).replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));
}

export const AI_RESULT_ENTITY_TYPES = ["invoice", "quotation", "payment", "party", "item", "reminder"] as const;
export type AiResultEntityType = (typeof AI_RESULT_ENTITY_TYPES)[number];

/** The only external link a result may carry: WhatsApp's click-to-send page, with the message in the query. */
export const AI_WHATSAPP_URL_PATTERN = /^https:\/\/wa\.me\/\d{10,15}\?text=[A-Za-z0-9%._~!*'()-]{0,4000}$/;

export const aiActionResultSchema = z.object({
  entityType: z.enum(AI_RESULT_ENTITY_TYPES),
  id: z.string().uuid().optional(),
  label: plain(120),
  externalUrl: z.string().regex(AI_WHATSAPP_URL_PATTERN).optional(),
});
export type AiActionResult = z.infer<typeof aiActionResultSchema>;

const editFieldSchema = z.object({
  key: z.string().regex(AI_EDIT_KEY_PATTERN),
  label: plain(60),
  input: z.enum(["text", "number", "date", "select"]),
  value: plain(500),
  options: z.array(z.object({ value: plain(40), label: plain(60) })).max(30).optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
});
export type AiCardEditField = z.infer<typeof editFieldSchema>;

export const aiConfirmationCardSchema = z.object({
  type: z.literal("confirmation"),
  actionId: z.string().uuid(),
  kind: z.enum(AI_ACTION_KINDS),
  title: plain(100),
  status: z.enum(AI_ACTION_STATUSES),
  fields: z.array(z.object({ label: plain(40), value: plain(300) })).max(16),
  table: z
    .object({
      title: plain(60).optional(),
      columns: z.array(plain(30)).min(1).max(7),
      rows: z.array(z.array(plain(120)).max(7)).max(30),
    })
    .optional(),
  totals: z.array(z.object({ label: plain(40), value: plain(60), strong: z.boolean().optional() })).max(10),
  warnings: z.array(plain(300)).max(6),
  /** A longer text to review, such as the reminder message. */
  message: multiline(1500).optional(),
  note: plain(400).optional(),
  edits: z.array(editFieldSchema).max(80),
  expiresAt: z.string().datetime(),
  result: aiActionResultSchema.optional(),
  error: plain(400).optional(),
});
export type AiConfirmationCard = z.infer<typeof aiConfirmationCardSchema>;

/** What the server computes when it proposes or edits an action: everything on the card except status, result and error. */
export const aiActionPreviewSchema = aiConfirmationCardSchema.pick({
  title: true, fields: true, table: true, totals: true, warnings: true, message: true, note: true, edits: true,
});
export type AiActionPreview = z.infer<typeof aiActionPreviewSchema>;

/** Build the card from a stored pending action (the one place a card is made). */
export function buildAiConfirmationCard(row: {
  id: string;
  kind: AiActionKind;
  status: AiActionStatus;
  expiresAt: Date | string;
  preview: unknown;
  result?: unknown;
  error?: string | null;
}, now: Date): AiConfirmationCard | null {
  const preview = aiActionPreviewSchema.safeParse(row.preview);
  if (!preview.success) return null;
  const status = effectiveAiActionStatus(row.status, row.expiresAt, now);
  const result = row.result ? aiActionResultSchema.safeParse(row.result) : null;
  const card = aiConfirmationCardSchema.safeParse({
    type: "confirmation",
    actionId: row.id,
    kind: row.kind,
    ...preview.data,
    // Only a pending card can be edited.
    edits: status === "pending" ? preview.data.edits : [],
    status,
    expiresAt: new Date(row.expiresAt).toISOString(),
    ...(result?.success ? { result: result.data } : {}),
    ...(row.error ? { error: row.error } : {}),
  });
  return card.success ? card.data : null;
}

/** The in-app route a finished action's link opens (always an allowlisted path). */
export function aiActionResultHref(result: Pick<AiActionResult, "entityType" | "id">): { to: string; search?: Record<string, string> } {
  const search = result.id ? { id: result.id } : undefined;
  switch (result.entityType) {
    case "invoice":
    case "reminder":
      return { to: "/invoices", ...(search ? { search } : {}) };
    case "quotation":
      return { to: "/quotations", ...(search ? { search } : {}) };
    case "payment":
      return { to: "/payments", ...(search ? { search } : {}) };
    case "party":
      return { to: "/parties" };
    case "item":
      return { to: "/items" };
  }
}

// ── Page context ─────────────────────────────────────────────────────────────

/**
 * What page the person is on, sent with a question so "this invoice" or "this
 * customer" can be resolved. Only these shapes are accepted; every id is a
 * UUID and is verified on the server through the person's own permissions
 * before anything about it reaches the model.
 */
export const aiPageContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), id: z.string().uuid() }),
  z.object({ kind: z.literal("quotation"), id: z.string().uuid() }),
  z.object({ kind: z.literal("party"), id: z.string().uuid() }),
  z.object({ kind: z.literal("item"), id: z.string().uuid() }),
  z.object({ kind: z.literal("report"), report: z.enum(AI_LINK_REPORTS), from: ymd.optional(), to: ymd.optional() }),
  z.object({ kind: z.literal("page"), page: z.enum(AI_LINK_PAGES) }),
]);
export type AiPageContext = z.infer<typeof aiPageContextSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Derive the page context from the current route (allowlisted patterns only):
 *   /invoices?id=<uuid>   /quotations?id=<uuid>   /reports?report=<known id>[&from&to]
 *   a list page from the fixed list (dashboard, invoices, parties, ...)
 * Party and item pages keep their selection in the page, so they pass it as `entity`.
 * Anything else returns null: nothing is sent.
 */
export function aiPageContextFromRoute(
  pathname: string,
  search: Record<string, unknown> | undefined,
  entity?: { kind: "party" | "item"; id: string } | null,
): AiPageContext | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const q = (k: string): string | undefined => {
    const v = search?.[k];
    return typeof v === "string" ? v : undefined;
  };
  const candidates: unknown[] = [];
  if (path === "/invoices" || path === "/quotations") {
    const id = q("id");
    if (id && UUID_RE.test(id)) candidates.push({ kind: path === "/invoices" ? "invoice" : "quotation", id });
  } else if (path === "/reports") {
    const report = q("report");
    if (report) {
      candidates.push({ kind: "report", report, ...(q("from") ? { from: q("from") } : {}), ...(q("to") ? { to: q("to") } : {}) });
      candidates.push({ kind: "report", report });
    }
  }
  if (entity && ((entity.kind === "party" && path === "/parties") || (entity.kind === "item" && path === "/items")) && UUID_RE.test(entity.id)) {
    candidates.unshift({ kind: entity.kind, id: entity.id });
  }
  for (const c of candidates) {
    const parsed = aiPageContextSchema.safeParse(c);
    if (parsed.success) return parsed.data;
  }
  const page = (Object.entries(AI_LINK_PAGE_PATHS) as Array<[(typeof AI_LINK_PAGES)[number], string]>).find(([, p]) => p === path)?.[0];
  return page ? { kind: "page", page } : null;
}

// ── Cards from the server (trusted) ──────────────────────────────────────────

export type AiAnyCard = AiCard | AiConfirmationCard;

/**
 * Cards the SERVER built or stored (answer cards plus confirmation cards),
 * validated again. The model's own cards go through `parseAiCards`, which
 * never accepts a confirmation card: only a stored pending action can make one.
 */
export function parseTrustedAiCards(raw: unknown): AiAnyCard[] {
  if (!Array.isArray(raw)) return [];
  const out: AiAnyCard[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && (item as { type?: unknown }).type === "confirmation") {
      const c = aiConfirmationCardSchema.safeParse(item);
      if (c.success) out.push(c.data);
    } else {
      out.push(...parseAiCards([item]).cards);
    }
  }
  return out;
}
