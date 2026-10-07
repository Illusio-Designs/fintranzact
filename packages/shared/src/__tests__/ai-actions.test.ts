import { describe, it, expect } from "vitest";
import {
  AI_ACTION_KINDS,
  AI_ACTION_PERMISSIONS,
  AI_ACTION_TOOL_NAMES,
  AI_ACTION_TTL_MS,
  AI_EDIT_KEY_PATTERN,
  AI_WHATSAPP_URL_PATTERN,
  aiActionExpiresAt,
  aiActionKindsFor,
  aiActionPurgeCutoff,
  aiActionResultHref,
  aiConfirmationCardSchema,
  aiCreateInvoiceInputSchema,
  aiCreateItemInputSchema,
  aiCreatePartyInputSchema,
  aiEditsSchema,
  aiPageContextFromRoute,
  aiPageContextSchema,
  aiRecordPaymentInputSchema,
  aiSendReminderInputSchema,
  buildAiConfirmationCard,
  effectiveAiActionStatus,
  isAiActionExpired,
  isAiActionKind,
  parseAiCards,
  parseTrustedAiCards,
  type AiActionKind,
} from "../index.js";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-09T06:00:00Z");

describe("action kinds and permissions", () => {
  it("lists six kinds, each with a tool name and the permission the real procedure checks", () => {
    expect([...AI_ACTION_KINDS]).toEqual(["create_invoice", "create_quotation", "record_payment", "create_party", "create_item", "send_payment_reminder"]);
    for (const k of AI_ACTION_KINDS) {
      expect(AI_ACTION_TOOL_NAMES[k]).toMatch(/^propose_[a-z_]+$/);
      expect(AI_ACTION_PERMISSIONS[k]).toBeDefined();
    }
    expect(AI_ACTION_PERMISSIONS).toMatchObject({
      create_invoice: { action: "create", subject: "Invoice" },
      create_quotation: { action: "create", subject: "Invoice" },
      record_payment: { action: "create", subject: "Payment" },
      create_party: { action: "create", subject: "Party" },
      create_item: { action: "create", subject: "Item" },
      send_payment_reminder: { action: "update", subject: "Invoice" },
    });
    // No tool name can be mistaken for confirming, cancelling or editing.
    for (const name of Object.values(AI_ACTION_TOOL_NAMES)) expect(name).not.toMatch(/confirm|cancel|edit|update|execute|approve/);
  });

  it("recognises a kind and nothing else", () => {
    expect(isAiActionKind("create_invoice")).toBe(true);
    for (const v of ["", "invoice.create", "__proto__", "constructor", null, undefined, 1]) expect(isAiActionKind(v)).toBe(false);
  });

  it("offers a person only the kinds their abilities allow", () => {
    const can = (allowed: string[]) => (action: string, subject: string) => allowed.includes(`${action}:${subject}`);
    expect(aiActionKindsFor(can([]))).toEqual([]);
    expect(aiActionKindsFor(can(["create:Payment"]))).toEqual(["record_payment"]);
    expect(aiActionKindsFor(can(["create:Invoice", "create:Party"]))).toEqual(["create_invoice", "create_quotation", "create_party"]);
    // Reading an invoice is not enough to send a reminder: that is an update.
    expect(aiActionKindsFor(can(["read:Invoice"]))).toEqual([]);
    expect(aiActionKindsFor(can(["update:Invoice"]))).toEqual(["send_payment_reminder"]);
  });
});

describe("expiry maths", () => {
  it("a proposal lives 30 minutes", () => {
    expect(AI_ACTION_TTL_MS).toBe(30 * 60_000);
    expect(aiActionExpiresAt(NOW).toISOString()).toBe("2026-10-09T06:30:00.000Z");
  });

  it("expires exactly at the deadline, not before", () => {
    const at = aiActionExpiresAt(NOW);
    expect(isAiActionExpired(at, new Date(at.getTime() - 1))).toBe(false);
    expect(isAiActionExpired(at, at)).toBe(true);
    expect(isAiActionExpired(at.toISOString(), new Date(at.getTime() + 1))).toBe(true);
  });

  it("only a pending action can show as expired; finished ones keep their state", () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(effectiveAiActionStatus("pending", past, NOW)).toBe("expired");
    for (const s of ["confirmed", "cancelled", "failed", "expired"] as const) expect(effectiveAiActionStatus(s, past, NOW)).toBe(s);
    expect(effectiveAiActionStatus("pending", new Date(NOW.getTime() + 1000), NOW)).toBe("pending");
  });

  it("finished rows are purged after 30 days", () => {
    expect(aiActionPurgeCutoff(NOW).toISOString()).toBe("2026-09-09T06:00:00.000Z");
  });
});

describe("what the model may propose", () => {
  const line = { itemId: ID, quantity: 2 };

  it("an invoice needs a party reference and at least one line", () => {
    expect(aiCreateInvoiceInputSchema.safeParse({ partyId: ID, lines: [line] }).success).toBe(true);
    expect(aiCreateInvoiceInputSchema.safeParse({ partyName: "Asha", lines: [line] }).success).toBe(true);
    expect(aiCreateInvoiceInputSchema.safeParse({ lines: [line] }).success).toBe(false);
    expect(aiCreateInvoiceInputSchema.safeParse({ partyId: ID, lines: [] }).success).toBe(false);
    expect(aiCreateInvoiceInputSchema.safeParse({ partyId: ID, lines: Array.from({ length: 21 }, () => line) }).success).toBe(false);
  });

  it("lines: an item id or a name; numbers or strings; quantity above zero; free text needs a rate", () => {
    const ok = (l: unknown) => aiCreateInvoiceInputSchema.safeParse({ partyId: ID, lines: [l] }).success;
    expect(ok({ itemId: ID, quantity: "2.5" })).toBe(true);
    expect(ok({ itemName: "Packing", quantity: 1, unitPrice: 100, freeText: true })).toBe(true);
    expect(ok({ quantity: 1 })).toBe(false);
    expect(ok({ itemId: ID, quantity: 0 })).toBe(false);
    expect(ok({ itemId: ID, quantity: -1 })).toBe(false);
    expect(ok({ itemId: ID, quantity: 1.2345 })).toBe(false);
    expect(ok({ itemName: "Packing", quantity: 1, freeText: true })).toBe(false);
    expect(ok({ itemId: ID, quantity: 1, discountPercent: 101 })).toBe(false);
    expect(ok({ itemId: ID, quantity: 1, unitPrice: -5 })).toBe(false);
    expect(ok({ itemId: ID, quantity: 1, unitPrice: "1e9" })).toBe(false);
    expect(ok({ itemId: "not-a-uuid", quantity: 1 })).toBe(false);
    // Numbers become the strings the real schemas want.
    const parsed = aiCreateInvoiceInputSchema.parse({ partyId: ID, lines: [{ itemId: ID, quantity: 2, unitPrice: 99.5, taxPercent: 18 }] });
    expect(parsed.lines[0]).toMatchObject({ quantity: "2", unitPrice: "99.5", taxPercent: "18" });
  });

  it("dates must be real calendar days", () => {
    const ok = (d: unknown) => aiCreateInvoiceInputSchema.safeParse({ partyId: ID, date: d, lines: [{ itemId: ID, quantity: 1 }] }).success;
    expect(ok("2026-10-09")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "09-10-2026", "yesterday", "2026-10-09T00:00:00Z", 20261009]) expect(ok(bad)).toBe(false);
  });

  it("a payment needs an amount above zero and a known mode, and a party or an invoice", () => {
    expect(aiRecordPaymentInputSchema.safeParse({ partyId: ID, amount: 5000, mode: "upi" }).success).toBe(true);
    expect(aiRecordPaymentInputSchema.safeParse({ invoiceId: ID, amount: "500.50", mode: "cash" }).success).toBe(true);
    expect(aiRecordPaymentInputSchema.safeParse({ amount: 5000, mode: "upi" }).success).toBe(false);
    expect(aiRecordPaymentInputSchema.safeParse({ partyId: ID, amount: 0, mode: "upi" }).success).toBe(false);
    expect(aiRecordPaymentInputSchema.safeParse({ partyId: ID, amount: 5, mode: "bitcoin" }).success).toBe(false);
    expect(aiRecordPaymentInputSchema.safeParse({ partyId: ID, mode: "upi" }).success).toBe(false);
  });

  it("party, item and reminder inputs", () => {
    expect(aiCreatePartyInputSchema.safeParse({ type: "customer", name: "Meera Stores", email: "m@x.in" }).success).toBe(true);
    expect(aiCreatePartyInputSchema.safeParse({ type: "vendor", name: "x" }).success).toBe(false);
    expect(aiCreatePartyInputSchema.safeParse({ type: "customer", name: "x", email: "not-an-email" }).success).toBe(false);
    expect(aiCreateItemInputSchema.safeParse({ name: "Lamp", unit: "pcs", salePrice: 1200, openingStock: 5 }).success).toBe(true);
    expect(aiCreateItemInputSchema.safeParse({ name: "Lamp", unit: "parsec" }).success).toBe(false);
    expect(aiSendReminderInputSchema.safeParse({ invoiceId: ID, channel: "whatsapp" }).success).toBe(true);
    expect(aiSendReminderInputSchema.safeParse({ invoiceId: ID, channel: "fax" }).success).toBe(false);
  });
});

describe("edits from a card", () => {
  it("keys are plain field names or lines.<n>.<field>: never ids, paths or prototypes", () => {
    for (const ok of ["date", "notes", "lines.0.quantity", "lines.12.unitPrice", "referenceNumber"]) expect(AI_EDIT_KEY_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["", "../x", "lines.0", "lines.123.quantity", "a b", "lines..quantity", ".x", "x.", "0abc", "a".repeat(40)]) expect(AI_EDIT_KEY_PATTERN.test(bad), bad).toBe(false);
    expect(aiEditsSchema.safeParse({ notes: "hello", "lines.0.quantity": "3" }).success).toBe(true);
    expect(aiEditsSchema.safeParse({}).success).toBe(false);
    expect(aiEditsSchema.safeParse({ notes: "x".repeat(501) }).success).toBe(false);
    expect(aiEditsSchema.safeParse({ "bad key": "x" }).success).toBe(false);
  });
});

describe("the confirmation card", () => {
  const preview = {
    title: "New sales invoice",
    fields: [{ label: "Customer", value: "Asha Traders" }],
    table: { columns: ["Item", "Qty"], rows: [["Cotton", "4"]] },
    totals: [{ label: "Total", value: "₹1,168.00", strong: true }],
    warnings: ["Only 3 in stock"],
    note: "Nothing is saved until you tap Confirm.",
    edits: [{ key: "notes", label: "Notes", input: "text" as const, value: "", maxLength: 500 }],
  };
  const row = (over: Record<string, unknown> = {}) => ({ id: ID, kind: "create_invoice" as AiActionKind, status: "pending" as const, expiresAt: new Date(NOW.getTime() + 600_000), preview, ...over });

  it("is built from a stored action: its id, state and the editable fields while pending", () => {
    const card = buildAiConfirmationCard(row(), NOW)!;
    expect(card).toMatchObject({ type: "confirmation", actionId: ID, kind: "create_invoice", status: "pending", title: "New sales invoice" });
    expect(card.edits).toHaveLength(1);
    expect(card.expiresAt).toBe("2026-10-09T06:10:00.000Z");
  });

  it("is not editable once it is not pending, and shows expired when its time has passed", () => {
    expect(buildAiConfirmationCard(row({ status: "confirmed", result: { entityType: "invoice", id: ID2, label: "Invoice INV-00007" } }), NOW)).toMatchObject({ status: "confirmed", edits: [], result: { entityType: "invoice", id: ID2 } });
    expect(buildAiConfirmationCard(row({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toMatchObject({ status: "expired", edits: [] });
    expect(buildAiConfirmationCard(row({ status: "failed", error: "Period is locked" }), NOW)).toMatchObject({ status: "failed", error: "Period is locked" });
  });

  it("returns null for a stored preview that is not valid, instead of showing something half-built", () => {
    expect(buildAiConfirmationCard(row({ preview: { title: 5 } }), NOW)).toBeNull();
    expect(buildAiConfirmationCard(row({ preview: null }), NOW)).toBeNull();
  });

  it("strips control characters and angle brackets from every text, and caps lengths", () => {
    const card = buildAiConfirmationCard(row({ preview: { ...preview, title: "<script>alert(1)</script>\u0000Invoice", fields: [{ label: "A", value: "x\ny".repeat(200) }] } }), NOW);
    expect(card).toBeNull(); // 600 chars is over the 300 limit: dropped, never truncated silently into something misleading
    const ok = buildAiConfirmationCard(row({ preview: { ...preview, title: "<b>Pay</b>\u0007 now", note: "a\nb" } }), NOW)!;
    expect(ok.title).toBe(" b Pay /b  now".replace(/\s+/g, " ").trim());
    expect(ok.title).not.toMatch(/[<>\u0007]/);
    expect(ok.note).toBe("a b");
  });

  it("limits the table, totals, warnings and fields", () => {
    const rows = Array.from({ length: 31 }, () => ["x", "1"]);
    expect(buildAiConfirmationCard(row({ preview: { ...preview, table: { columns: ["Item", "Qty"], rows } } }), NOW)).toBeNull();
    expect(buildAiConfirmationCard(row({ preview: { ...preview, warnings: Array.from({ length: 7 }, () => "w") } }), NOW)).toBeNull();
  });

  it("a message keeps its line breaks but nothing else control-like", () => {
    const card = buildAiConfirmationCard(row({ preview: { ...preview, message: "Hello Asha,\r\n\r\n\r\n\r\nPay <now>\u0007." } }), NOW)!;
    expect(card.message).toBe("Hello Asha,\n\nPay  now .".replace(/ {2,}/g, " "));
    expect(card.message).not.toMatch(/[<>\u0007\r]/);
  });

  it("a result link may only be a WhatsApp click-to-send URL", () => {
    expect(AI_WHATSAPP_URL_PATTERN.test("https://wa.me/919000000001?text=Hello%20Asha%0A")).toBe(true);
    for (const bad of ["http://wa.me/919000000001?text=x", "https://evil.example/919000000001?text=x", "https://wa.me.evil.example/9190000000?text=x", "javascript:alert(1)", "https://wa.me/12?text=x", "https://wa.me/919000000001?text=<script>"]) {
      expect(AI_WHATSAPP_URL_PATTERN.test(bad), bad).toBe(false);
    }
    const card = aiConfirmationCardSchema.safeParse({ ...buildAiConfirmationCard(row(), NOW)!, result: { entityType: "reminder", label: "ok", externalUrl: "https://evil.example/x" } });
    expect(card.success).toBe(false);
  });

  it("maps a finished action to an allowlisted in-app route", () => {
    expect(aiActionResultHref({ entityType: "invoice", id: ID })).toEqual({ to: "/invoices", search: { id: ID } });
    expect(aiActionResultHref({ entityType: "quotation", id: ID })).toEqual({ to: "/quotations", search: { id: ID } });
    expect(aiActionResultHref({ entityType: "payment", id: ID })).toEqual({ to: "/payments", search: { id: ID } });
    expect(aiActionResultHref({ entityType: "reminder", id: ID })).toEqual({ to: "/invoices", search: { id: ID } });
    expect(aiActionResultHref({ entityType: "party", id: ID })).toEqual({ to: "/parties" });
    expect(aiActionResultHref({ entityType: "item", id: ID })).toEqual({ to: "/items" });
  });

  it("the model's own cards can never be a confirmation card; trusted parsing accepts the server's", () => {
    const real = buildAiConfirmationCard(row(), NOW)!;
    expect(parseAiCards([real])).toEqual({ cards: [], dropped: 1 });
    expect(parseAiCards(JSON.stringify([{ ...real, status: "confirmed" }]))).toEqual({ cards: [], dropped: 1 });
    const trusted = parseTrustedAiCards([real, { type: "link", label: "x", target: { kind: "page", page: "invoices" } }, { type: "confirmation", actionId: "nope" }, { type: "html", html: "<b>" }]);
    expect(trusted.map((c) => c.type)).toEqual(["confirmation", "link"]);
    expect(parseTrustedAiCards("not an array")).toEqual([]);
  });
});

describe("page context", () => {
  it("accepts only the allowlisted shapes with UUIDs", () => {
    expect(aiPageContextSchema.safeParse({ kind: "invoice", id: ID }).success).toBe(true);
    expect(aiPageContextSchema.safeParse({ kind: "report", report: "outstanding", from: "2026-04-01", to: "2026-10-09" }).success).toBe(true);
    expect(aiPageContextSchema.safeParse({ kind: "page", page: "invoices" }).success).toBe(true);
    for (const bad of [{ kind: "invoice", id: "1" }, { kind: "invoice" }, { kind: "payroll", id: ID }, { kind: "report", report: "secret" }, { kind: "page", page: "platform" }, { kind: "report", report: "pnl", from: "2026-02-30" }, null, "invoice"]) {
      expect(aiPageContextSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("derives the context from allowlisted routes only", () => {
    expect(aiPageContextFromRoute("/invoices", { id: ID })).toEqual({ kind: "invoice", id: ID });
    expect(aiPageContextFromRoute("/quotations", { id: ID })).toEqual({ kind: "quotation", id: ID });
    expect(aiPageContextFromRoute("/invoices/", { id: ID })).toEqual({ kind: "invoice", id: ID });
    expect(aiPageContextFromRoute("/reports", { report: "outstanding" })).toEqual({ kind: "report", report: "outstanding" });
    expect(aiPageContextFromRoute("/reports", { report: "pnl", from: "2026-04-01", to: "2026-10-09" })).toEqual({ kind: "report", report: "pnl", from: "2026-04-01", to: "2026-10-09" });
    // A bad date range drops the range, not the report.
    expect(aiPageContextFromRoute("/reports", { report: "pnl", from: "yesterday" })).toEqual({ kind: "report", report: "pnl" });
    expect(aiPageContextFromRoute("/", {})).toEqual({ kind: "page", page: "dashboard" });
    expect(aiPageContextFromRoute("/parties", {})).toEqual({ kind: "page", page: "parties" });
    expect(aiPageContextFromRoute("/parties", {}, { kind: "party", id: ID })).toEqual({ kind: "party", id: ID });
    expect(aiPageContextFromRoute("/items", {}, { kind: "item", id: ID })).toEqual({ kind: "item", id: ID });
  });

  it("unknown routes, bad ids and a party selected on the wrong page send nothing", () => {
    expect(aiPageContextFromRoute("/payroll", { id: ID })).toBeNull();
    expect(aiPageContextFromRoute("/settings", {})).toBeNull();
    expect(aiPageContextFromRoute("/platform", { id: ID })).toBeNull();
    expect(aiPageContextFromRoute("/invoices", { id: "123" })).toEqual({ kind: "page", page: "invoices" });
    expect(aiPageContextFromRoute("/invoices", { id: ["a"] })).toEqual({ kind: "page", page: "invoices" });
    expect(aiPageContextFromRoute("/reports", { report: "../../etc/passwd" })).toEqual({ kind: "page", page: "reports" });
    expect(aiPageContextFromRoute("/invoices", {}, { kind: "party", id: ID })).toEqual({ kind: "page", page: "invoices" });
    expect(aiPageContextFromRoute("/parties", {}, { kind: "party", id: "nope" })).toEqual({ kind: "page", page: "parties" });
    expect(aiPageContextFromRoute("/settings", undefined)).toBeNull();
  });
});
