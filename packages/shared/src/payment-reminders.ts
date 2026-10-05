/**
 * Payment reminders: the pure logic shared by the API (the scheduler, the
 * manual "Send reminder now", the settings procedures) and the clients (the
 * settings preview, the WhatsApp link).
 *
 *   - per-business settings (off by default) and their validation
 *   - message templates with {{placeholders}}, rendered the same everywhere
 *   - the reminder schedule: a few days before the due date, on it, then every
 *     N days while the invoice is unpaid, at most `maxReminders` in all
 *   - quiet hours: automatic reminders go out between 09:00 and 19:00 India time
 *   - the wa.me click-to-send link (nothing is sent to WhatsApp automatically)
 *
 * Days are Indian calendar days (Asia/Kolkata), like every other business date.
 */

import { z } from "zod";
import { formatIstDate } from "./dates.js";

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const REMINDER_CHANNELS = ["email", "sms", "whatsapp"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/** What a reminder row stands for: a schedule slot, or a hand-sent reminder. */
export const REMINDER_KINDS = ["before_due", "on_due", "after_due", "manual"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_STATUSES = ["sending", "sent", "failed", "link_opened"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_PLACEHOLDERS = [
  { key: "customerName", label: "Customer name" },
  { key: "invoiceNumber", label: "Invoice number" },
  { key: "amount", label: "Balance due" },
  { key: "dueDate", label: "Due date" },
  { key: "dueText", label: "Due wording (\"is due on 12-10-2026\" / \"was due on ... (3 days overdue)\")" },
  { key: "businessName", label: "Your business name" },
  { key: "paymentLink", label: "Payment link (empty when there is none; a \"Pay online:\" line is left out then)" },
] as const;
export type ReminderPlaceholder = (typeof REMINDER_PLACEHOLDERS)[number]["key"];
export type ReminderVariables = Record<ReminderPlaceholder, string>;

/** Quiet hours: automatic reminders go out from 09:00 until 19:00 India time. */
export const REMINDER_SEND_FROM_HOUR_IST = 9;
export const REMINDER_SEND_UNTIL_HOUR_IST = 19;
/** A hand-sent reminder: at most one per invoice per channel in this many hours. */
export const MANUAL_REMINDER_COOLDOWN_HOURS = 24;

export const REMINDER_TEMPLATE_MAX_LENGTH = 1000;
export const REMINDER_SUBJECT_MAX_LENGTH = 150;

export const DEFAULT_EMAIL_SUBJECT = "Payment reminder: invoice {{invoiceNumber}} from {{businessName}}";
export const DEFAULT_EMAIL_BODY = [
  "Dear {{customerName}},",
  "",
  "This is a friendly reminder that invoice {{invoiceNumber}} {{dueText}}. The balance due is {{amount}}.",
  "",
  "Pay online: {{paymentLink}}",
  "",
  "If you have already paid, please ignore this message. If you have any questions, just reply to this email.",
  "",
  "Thank you,",
  "{{businessName}}",
].join("\n");
export const DEFAULT_SMS_BODY =
  "Dear {{customerName}}, invoice {{invoiceNumber}} {{dueText}}. Balance due {{amount}}. {{paymentLink}} Regards, {{businessName}}";
export const DEFAULT_WHATSAPP_BODY = [
  "Hello {{customerName}},",
  "",
  "A friendly reminder from {{businessName}}: invoice {{invoiceNumber}} {{dueText}}. The balance due is {{amount}}.",
  "{{paymentLink}}",
  "",
  "If you have already paid, please ignore this message. Thank you!",
].join("\n");

const templateText = z.string().trim().min(1).max(REMINDER_TEMPLATE_MAX_LENGTH);

export const paymentReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Days before the due date for the first reminder; 0 = no "before" reminder. */
  daysBefore: z.number().int().min(0).max(30),
  onDueDate: z.boolean(),
  /** After the due date, repeat every N days while unpaid; 0 = no repeats. */
  repeatEveryDays: z.number().int().min(0).max(60),
  /** The most automatic reminders sent for one invoice on one channel. */
  maxReminders: z.number().int().min(1).max(20),
  channels: z.object({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean() }),
  templates: z.object({
    emailSubject: z.string().trim().min(1).max(REMINDER_SUBJECT_MAX_LENGTH),
    email: templateText,
    sms: templateText,
    whatsapp: templateText,
  }),
});
export type PaymentReminderSettings = z.infer<typeof paymentReminderSettingsSchema>;

export const DEFAULT_PAYMENT_REMINDER_SETTINGS: PaymentReminderSettings = {
  enabled: false,
  daysBefore: 3,
  onDueDate: true,
  repeatEveryDays: 7,
  maxReminders: 4,
  channels: { email: true, sms: false, whatsapp: true },
  templates: {
    emailSubject: DEFAULT_EMAIL_SUBJECT,
    email: DEFAULT_EMAIL_BODY,
    sms: DEFAULT_SMS_BODY,
    whatsapp: DEFAULT_WHATSAPP_BODY,
  },
};

/** The settings the owner edits (a stored value may be missing fields added later). */
export const updatePaymentReminderSettingsSchema = paymentReminderSettingsSchema;

/** Stored settings (or null) merged over the defaults; garbage falls back to the defaults. */
export function resolveReminderSettings(stored: unknown): PaymentReminderSettings {
  const d = DEFAULT_PAYMENT_REMINDER_SETTINGS;
  if (!stored || typeof stored !== "object") return d;
  const s = stored as Partial<PaymentReminderSettings>;
  const merged = {
    ...d,
    ...s,
    channels: { ...d.channels, ...(s.channels ?? {}) },
    templates: { ...d.templates, ...(s.templates ?? {}) },
  };
  const parsed = paymentReminderSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : d;
}

// ── Templates ──────────────────────────────────────────────────

function fill(line: string, vars: Partial<ReminderVariables>): string {
  return line.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_m, key: string) => (vars as Record<string, string | undefined>)[key] ?? "");
}

/**
 * Fills {{placeholders}} (unknown ones become empty). When there is no payment
 * link, a line that holds {{paymentLink}} is dropped if nothing else is left on
 * it or all that is left is a label ending in a colon ("Pay online: "), so no
 * label dangles. Runs of blank lines are collapsed. Output is plain text:
 * escape it for HTML where it is shown as HTML.
 */
export function renderReminderTemplate(template: string, vars: Partial<ReminderVariables>): string {
  const out: string[] = [];
  for (const line of template.split("\n")) {
    if (/\{\{\s*paymentLink\s*\}\}/.test(line) && !vars.paymentLink) {
      const rest = fill(line, vars).trim();
      if (rest === "" || rest.endsWith(":")) continue;
    }
    out.push(fill(line, vars));
  }
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Single-line version (subjects, SMS): newlines become spaces. */
export function renderReminderLine(template: string, vars: Partial<ReminderVariables>): string {
  return renderReminderTemplate(template, vars).replace(/\s*\n+\s*/g, " ").replace(/ {2,}/g, " ").trim();
}

/** "Rs. 1,23,456.00" style amount, Indian grouping. */
export function formatReminderAmount(amount: string | number): string {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(n)) return "";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole Indian calendar days from `a` to `b` (positive when b is later). */
export function istDayNumber(date: Date): number {
  return Math.floor((date.getTime() + IST_OFFSET_MS) / DAY_MS);
}

/** "is due on 12-10-2026", "is due today" or "was due on 01-10-2026 (4 days overdue)". */
export function reminderDueText(dueDate: Date | null, now: Date): string {
  if (!dueDate) return "is awaiting payment";
  const diff = istDayNumber(dueDate) - istDayNumber(now);
  if (diff === 0) return "is due today";
  if (diff > 0) return `is due on ${formatIstDate(dueDate)}`;
  const late = -diff;
  return `was due on ${formatIstDate(dueDate)} (${late} ${late === 1 ? "day" : "days"} overdue)`;
}

export function buildReminderVariables(input: {
  customerName: string;
  invoiceNumber: string;
  balanceDue: string | number;
  dueDate: Date | null;
  businessName: string;
  paymentLink?: string | null;
  now: Date;
}): ReminderVariables {
  return {
    customerName: input.customerName,
    invoiceNumber: input.invoiceNumber,
    amount: formatReminderAmount(input.balanceDue),
    dueDate: input.dueDate ? formatIstDate(input.dueDate) : "",
    dueText: reminderDueText(input.dueDate, input.now),
    businessName: input.businessName,
    paymentLink: input.paymentLink ?? "",
  };
}

/** Sample values for the settings preview. */
export function sampleReminderVariables(businessName: string, now: Date = new Date()): ReminderVariables {
  return buildReminderVariables({
    customerName: "Sharma Traders",
    invoiceNumber: "INV-0042",
    balanceDue: 11800,
    dueDate: new Date(now.getTime() + 3 * DAY_MS),
    businessName,
    paymentLink: null,
    now,
  });
}

// ── Schedule ───────────────────────────────────────────────────

export interface ReminderSlot {
  /** Stable key stored with the history row, one per (invoice, channel, key). */
  key: string;
  kind: Exclude<ReminderKind, "manual">;
  /** Indian day number the slot falls on. */
  day: number;
}

/**
 * Every slot of the schedule in date order, cut off at maxReminders:
 * `before` (daysBefore days ahead, if daysBefore > 0), `due` (if onDueDate),
 * then `after_1`, `after_2`... every repeatEveryDays days past the due date.
 */
export function reminderSlots(dueDate: Date, settings: Pick<PaymentReminderSettings, "daysBefore" | "onDueDate" | "repeatEveryDays" | "maxReminders">): ReminderSlot[] {
  const due = istDayNumber(dueDate);
  const slots: ReminderSlot[] = [];
  if (settings.daysBefore > 0) slots.push({ key: "before", kind: "before_due", day: due - settings.daysBefore });
  if (settings.onDueDate) slots.push({ key: "due", kind: "on_due", day: due });
  if (settings.repeatEveryDays > 0) {
    for (let k = 1; slots.length < settings.maxReminders; k++) {
      slots.push({ key: `after_${k}`, kind: "after_due", day: due + k * settings.repeatEveryDays });
    }
  }
  return slots.slice(0, settings.maxReminders);
}

/**
 * The automatic reminder to send now for one invoice and channel, or null.
 * Only the latest slot that has come due is considered, so a job that was down
 * for a while sends one reminder, not a burst. Slots before the invoice's own
 * date are ignored, so a freshly raised invoice is not reminded the same day.
 * `recordedKeys` are the slot keys already in the history for this channel.
 */
export function planAutoReminder(input: {
  dueDate: Date | null;
  invoiceDate: Date;
  now: Date;
  settings: PaymentReminderSettings;
  recordedKeys: ReadonlySet<string>;
}): ReminderSlot | null {
  if (!input.dueDate || !input.settings.enabled) return null;
  if (input.recordedKeys.size >= input.settings.maxReminders) return null;
  const today = istDayNumber(input.now);
  const invoiceDay = istDayNumber(input.invoiceDate);
  const reached = reminderSlots(input.dueDate, input.settings).filter((s) => s.day <= today && s.day >= invoiceDay);
  const latest = reached[reached.length - 1];
  if (!latest || input.recordedKeys.has(latest.key)) return null;
  return latest;
}

/** Whether automatic reminders may go out now: 09:00 up to (not including) 19:00 India time. */
export function isWithinReminderHours(now: Date): boolean {
  const hour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  return hour >= REMINDER_SEND_FROM_HOUR_IST && hour < REMINDER_SEND_UNTIL_HOUR_IST;
}

/** When a hand-sent reminder may next go out on a channel, or null if it may now. */
export function manualReminderAvailableAt(lastSentAt: Date | null, now: Date): Date | null {
  if (!lastSentAt) return null;
  const next = new Date(lastSentAt.getTime() + MANUAL_REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000);
  return next.getTime() > now.getTime() ? next : null;
}

// ── Addresses ──────────────────────────────────────────────────

/** Digits for wa.me / SMS: country code included (10-digit Indian numbers get 91). Null if unusable. */
export function normalizeIndianMobile(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  if (digits.startsWith("91") && digits.length === 12 && !/^91[6-9]/.test(digits)) return null;
  return digits;
}

/** The click-to-send WhatsApp link with the message filled in, or null without a usable number. */
export function buildWhatsAppLink(phone: string | null | undefined, message: string): string | null {
  const digits = normalizeIndianMobile(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** "ra***@example.com": enough for the history and the logs, never the whole address. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/** "******3210": the last four digits only. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
