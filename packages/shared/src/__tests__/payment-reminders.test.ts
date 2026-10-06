import { describe, it, expect } from "vitest";
import {
  DEFAULT_PAYMENT_REMINDER_SETTINGS,
  buildReminderVariables,
  buildWhatsAppLink,
  isWithinReminderHours,
  manualReminderAvailableAt,
  maskEmail,
  maskPhone,
  normalizeIndianMobile,
  paymentReminderSettingsSchema,
  planAutoReminder,
  reminderDueText,
  reminderSlots,
  renderReminderLine,
  renderReminderTemplate,
  resolveReminderSettings,
  sampleReminderVariables,
  istStartOfDay,
  type PaymentReminderSettings,
} from "../index.js";

/** 10:00 India time on the given day. */
const ist10 = (y: number, m: number, d: number) => new Date(istStartOfDay(y, m, d).getTime() + 10 * 3600_000);
const due = istStartOfDay(2026, 10, 10);
const on: PaymentReminderSettings = { ...DEFAULT_PAYMENT_REMINDER_SETTINGS, enabled: true };

describe("defaults", () => {
  it("are off, 3 days before, on the due date, weekly, at most 4, email on and SMS off", () => {
    const d = DEFAULT_PAYMENT_REMINDER_SETTINGS;
    expect(d.enabled).toBe(false);
    expect([d.daysBefore, d.onDueDate, d.repeatEveryDays, d.maxReminders]).toEqual([3, true, 7, 4]);
    expect(d.channels).toEqual({ email: true, sms: false, whatsapp: true });
    expect(paymentReminderSettingsSchema.safeParse(d).success).toBe(true);
  });

  it("resolveReminderSettings fills gaps and falls back on garbage", () => {
    expect(resolveReminderSettings(null)).toEqual(DEFAULT_PAYMENT_REMINDER_SETTINGS);
    expect(resolveReminderSettings({ enabled: true, daysBefore: 5 })).toMatchObject({ enabled: true, daysBefore: 5, repeatEveryDays: 7 });
    expect(resolveReminderSettings({ enabled: "yes", daysBefore: -4 })).toEqual(DEFAULT_PAYMENT_REMINDER_SETTINGS);
  });

  it("the schema rejects absurd values", () => {
    expect(paymentReminderSettingsSchema.safeParse({ ...on, maxReminders: 0 }).success).toBe(false);
    expect(paymentReminderSettingsSchema.safeParse({ ...on, daysBefore: 90 }).success).toBe(false);
    expect(paymentReminderSettingsSchema.safeParse({ ...on, templates: { ...on.templates, sms: "" } }).success).toBe(false);
  });
});

describe("renderReminderTemplate", () => {
  const vars = buildReminderVariables({
    customerName: "Sharma Traders",
    invoiceNumber: "INV-7",
    balanceDue: "11800",
    dueDate: due,
    businessName: "Acme Co",
    paymentLink: null,
    now: ist10(2026, 10, 7),
  });

  it("fills the placeholders", () => {
    const out = renderReminderTemplate("Hi {{customerName}}, {{invoiceNumber}}: {{amount}} due {{dueDate}} - {{businessName}}", vars);
    expect(out).toBe("Hi Sharma Traders, INV-7: ₹11,800.00 due 10-10-2026 - Acme Co");
  });

  it("drops a line holding {{paymentLink}} when there is no link, keeps it when there is", () => {
    const t = "Hello\n\nPay online: {{paymentLink}}\n\nThanks";
    expect(renderReminderTemplate(t, vars)).toBe("Hello\n\nThanks");
    expect(renderReminderTemplate(t, { ...vars, paymentLink: "https://pay.example/x" })).toBe("Hello\n\nPay online: https://pay.example/x\n\nThanks");
  });

  it("keeps a line that has other words around {{paymentLink}}, just without the link", () => {
    expect(renderReminderLine("Balance {{amount}}. {{paymentLink}} Regards, {{businessName}}", vars)).toBe("Balance ₹11,800.00. Regards, Acme Co");
    expect(renderReminderLine("Balance {{amount}}. {{paymentLink}} Regards, {{businessName}}", { ...vars, paymentLink: "https://p/x" })).toBe(
      "Balance ₹11,800.00. https://p/x Regards, Acme Co",
    );
  });

  it("renders unknown placeholders empty and does not escape (plain text out)", () => {
    expect(renderReminderTemplate("a {{nope}} b {{customerName}}", { customerName: "<b>X</b> & Co" })).toBe("a  b <b>X</b> & Co");
  });

  it("does not re-expand placeholders found inside values", () => {
    expect(renderReminderTemplate("{{customerName}}", { customerName: "{{businessName}}", businessName: "Evil" })).toBe("{{businessName}}");
  });

  it("renderReminderLine collapses to one line", () => {
    expect(renderReminderLine("A {{customerName}}\nB\n{{paymentLink}}", { customerName: "X" })).toBe("A X B");
  });

  it("sample variables render the default templates without leftovers", () => {
    const v = sampleReminderVariables("Acme Co", ist10(2026, 10, 5));
    for (const t of Object.values(DEFAULT_PAYMENT_REMINDER_SETTINGS.templates)) {
      expect(renderReminderTemplate(t, v)).not.toMatch(/\{\{|\}\}/);
    }
  });

  it("the sample payment link is clearly an example, and a real link replaces the line, no link drops it", () => {
    const sample = sampleReminderVariables("Acme Co", ist10(2026, 10, 5));
    expect(sample.paymentLink).toContain("example");
    const t = "Pay online: {{paymentLink}}\nThanks";
    expect(renderReminderTemplate(t, sample)).toContain("Pay online: https://rzp.io/");
    expect(renderReminderTemplate(t, { ...sample, paymentLink: "https://rzp.io/i/abc" })).toBe("Pay online: https://rzp.io/i/abc\nThanks");
    expect(renderReminderTemplate(t, { ...sample, paymentLink: "" })).toBe("Thanks");
  });

  it("dueText reads right before, on and after the due date", () => {
    expect(reminderDueText(due, ist10(2026, 10, 7))).toBe("is due on 10-10-2026");
    expect(reminderDueText(due, ist10(2026, 10, 10))).toBe("is due today");
    expect(reminderDueText(due, ist10(2026, 10, 11))).toBe("was due on 10-10-2026 (1 day overdue)");
    expect(reminderDueText(due, ist10(2026, 10, 17))).toBe("was due on 10-10-2026 (7 days overdue)");
    expect(reminderDueText(null, new Date())).toBe("is awaiting payment");
  });
});

describe("reminderSlots", () => {
  it("default: 3 days before, on the due date, then weekly, 4 in all", () => {
    const slots = reminderSlots(due, on);
    expect(slots.map((s) => s.key)).toEqual(["before", "due", "after_1", "after_2"]);
    const days = slots.map((s) => s.day - slots[1]!.day);
    expect(days).toEqual([-3, 0, 7, 14]);
  });

  it("no 'before' reminder when daysBefore is 0; the repeats fill the cap", () => {
    expect(reminderSlots(due, { ...on, daysBefore: 0 }).map((s) => s.key)).toEqual(["due", "after_1", "after_2", "after_3"]);
  });

  it("no repeats when repeatEveryDays is 0, and the cap cuts the list", () => {
    expect(reminderSlots(due, { ...on, repeatEveryDays: 0 }).map((s) => s.key)).toEqual(["before", "due"]);
    expect(reminderSlots(due, { ...on, maxReminders: 2 }).map((s) => s.key)).toEqual(["before", "due"]);
  });
});

describe("planAutoReminder", () => {
  const base = { dueDate: due, invoiceDate: istStartOfDay(2026, 9, 1), settings: on, recordedKeys: new Set<string>() };

  it("nothing more than 3 days ahead", () => {
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 6) })).toBeNull();
  });

  it("before slot three days ahead, on the due date, then weekly", () => {
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 7) })?.key).toBe("before");
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 9), recordedKeys: new Set(["before"]) })).toBeNull();
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 10), recordedKeys: new Set(["before"]) })?.key).toBe("due");
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 16), recordedKeys: new Set(["before", "due"]) })).toBeNull();
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 17), recordedKeys: new Set(["before", "due"]) })?.key).toBe("after_1");
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 24), recordedKeys: new Set(["before", "due", "after_1"]) })?.key).toBe("after_2");
  });

  it("a recorded slot is never planned again", () => {
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 10), recordedKeys: new Set(["due"]) })).toBeNull();
  });

  it("after a long outage only the latest slot is sent, not a burst", () => {
    expect(planAutoReminder({ ...base, now: ist10(2026, 10, 20) })?.key).toBe("after_1");
  });

  it("never more than maxReminders", () => {
    expect(planAutoReminder({ ...base, now: ist10(2026, 12, 1), recordedKeys: new Set(["before", "due", "after_1", "after_2"]) })).toBeNull();
    // Slots past the cap do not exist, however long the invoice stays unpaid.
    expect(planAutoReminder({ ...base, now: ist10(2026, 12, 1) })?.key).toBe("after_2");
    expect(planAutoReminder({ ...base, settings: { ...on, maxReminders: 1 }, now: ist10(2026, 10, 7), recordedKeys: new Set(["x"]) })).toBeNull();
  });

  it("is off when disabled or when there is no due date", () => {
    expect(planAutoReminder({ ...base, settings: DEFAULT_PAYMENT_REMINDER_SETTINGS, now: ist10(2026, 10, 10) })).toBeNull();
    expect(planAutoReminder({ ...base, dueDate: null, now: ist10(2026, 10, 10) })).toBeNull();
  });

  it("does not remind about a slot from before the invoice existed", () => {
    // Raised on the 9th with a due date of the 10th: the 'before' slot (7th) is skipped, 'due' still happens.
    const fresh = { ...base, invoiceDate: istStartOfDay(2026, 10, 9) };
    expect(planAutoReminder({ ...fresh, now: ist10(2026, 10, 9) })).toBeNull();
    expect(planAutoReminder({ ...fresh, now: ist10(2026, 10, 10) })?.key).toBe("due");
  });

  it("works on Indian days: 23:30 IST on the 6th is still the 6th", () => {
    const lateSixth = new Date(istStartOfDay(2026, 10, 6).getTime() + 23.5 * 3600_000);
    expect(planAutoReminder({ ...base, now: lateSixth })).toBeNull();
    const earlySeventh = new Date(istStartOfDay(2026, 10, 7).getTime() + 0.5 * 3600_000);
    expect(planAutoReminder({ ...base, now: earlySeventh })?.key).toBe("before");
  });
});

describe("quiet hours", () => {
  const at = (iso: string) => new Date(iso);
  it("sends from 09:00 until 19:00 India time only", () => {
    expect(isWithinReminderHours(at("2026-10-05T03:29:00Z"))).toBe(false); // 08:59 IST
    expect(isWithinReminderHours(at("2026-10-05T03:30:00Z"))).toBe(true); // 09:00 IST
    expect(isWithinReminderHours(at("2026-10-05T13:29:00Z"))).toBe(true); // 18:59 IST
    expect(isWithinReminderHours(at("2026-10-05T13:30:00Z"))).toBe(false); // 19:00 IST
    expect(isWithinReminderHours(at("2026-10-05T20:00:00Z"))).toBe(false); // 01:30 IST next day
  });
});

describe("manual send limit", () => {
  it("allows when never sent, blocks for 24 hours, then allows", () => {
    const now = new Date("2026-10-05T10:00:00Z");
    expect(manualReminderAvailableAt(null, now)).toBeNull();
    const sent = new Date("2026-10-05T04:00:00Z");
    expect(manualReminderAvailableAt(sent, now)?.toISOString()).toBe("2026-10-06T04:00:00.000Z");
    expect(manualReminderAvailableAt(new Date("2026-10-04T10:00:00Z"), now)).toBeNull();
  });
});

describe("WhatsApp link and numbers", () => {
  it("normalises Indian mobiles to a country-coded number", () => {
    expect(normalizeIndianMobile("98765 43210")).toBe("919876543210");
    expect(normalizeIndianMobile("+91 98765-43210")).toBe("919876543210");
    expect(normalizeIndianMobile("09876543210")).toBe("919876543210");
    expect(normalizeIndianMobile("0091 9876543210")).toBe("919876543210");
    expect(normalizeIndianMobile("+1 415 555 2671")).toBe("14155552671");
    expect(normalizeIndianMobile("12345")).toBeNull();
    expect(normalizeIndianMobile("1234567890")).toBeNull();
    expect(normalizeIndianMobile(null)).toBeNull();
  });

  it("builds a wa.me link with the message encoded", () => {
    const link = buildWhatsAppLink("98765 43210", "Hi & bye\nline 2 ₹5");
    expect(link).toBe(`https://wa.me/919876543210?text=${encodeURIComponent("Hi & bye\nline 2 ₹5")}`);
    expect(buildWhatsAppLink("abc", "x")).toBeNull();
  });

  it("masks addresses for history and logs", () => {
    expect(maskEmail("priya.textiles@example.in")).toBe("pr***@example.in");
    expect(maskEmail("nope")).toBe("***");
    expect(maskPhone("+91 98765 43210")).toBe("********3210");
    expect(maskPhone("12")).toBe("***");
    expect(maskPhone("9876543210")).not.toContain("98765");
  });
});
