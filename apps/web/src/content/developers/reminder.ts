import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

const SETTINGS_EXAMPLE = {
  enabled: true,
  daysBefore: 3,
  onDueDate: true,
  repeatEveryDays: 7,
  maxReminders: 4,
  channels: { email: true, sms: false, whatsapp: true },
  templates: {
    emailSubject: "Payment reminder: invoice {{invoiceNumber}} from {{businessName}}",
    email: "Dear {{customerName}},\n\nThis is a friendly reminder that invoice {{invoiceNumber}} {{dueText}}. The balance due is {{amount}}.\n\nPay online: {{paymentLink}}\n\nThank you,\n{{businessName}}",
    sms: "Dear {{customerName}}, invoice {{invoiceNumber}} {{dueText}}. Balance due {{amount}}. {{paymentLink}} Regards, {{businessName}}",
    whatsapp: "Hello {{customerName}},\n\nA friendly reminder from {{businessName}}: invoice {{invoiceNumber}} {{dueText}}. The balance due is {{amount}}.\n{{paymentLink}}",
  },
};

export const reminderEndpoints: EndpointGroup = {
  id: "reminders",
  title: "Payment Reminders",
  description:
    "Reminders for unpaid sales invoices. An hourly job (off by default per business) sends a reminder a few days before the due date, on it, then every N days while the invoice is unpaid, at most `maxReminders` per invoice and channel, only between 09:00 and 19:00 India time. Each slot is claimed in `payment_reminders` before it is sent, so a restart or a second instance never sends it twice. Reminders stop when the invoice is paid, cancelled or deleted, when the customer has `doNotRemind` set, and for read-only or suspended organizations. Channels: email (from the business name, reply-to the business email), SMS (needs an SMS provider on the server; see the help page) and a wa.me click-to-send WhatsApp link that is never sent automatically. Message templates take the placeholders `{{customerName}}`, `{{invoiceNumber}}`, `{{amount}}` (balance due), `{{dueDate}}`, `{{dueText}}`, `{{businessName}}` and `{{paymentLink}}`; a line holding `{{paymentLink}}` is left out when there is no link. Set `PAYMENT_REMINDERS=off` on the server to switch the job off.",
  endpoints: [
    {
      id: "reminder-get-settings",
      method: "query",
      path: "reminder.getSettings",
      title: "Get Reminder Settings",
      description: "The business's reminder settings. A business that never saved any gets the defaults, with `enabled: false`.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "`smsAvailable` is true only when the server has an SMS provider configured.",
        example: { settings: SETTINGS_EXAMPLE, smsAvailable: false },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/reminder.getSettings" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { settings, smsAvailable } = await trpc.reminder.getSettings.query();`,
      },
      gotchas: ["Requires `Business:read` permission, which every role has."],
      relatedEndpoints: ["reminder-update-settings"],
    },
    {
      id: "reminder-update-settings",
      method: "mutation",
      path: "reminder.updateSettings",
      title: "Update Reminder Settings",
      description: "Replace the business's reminder settings (the whole object). Audit entry `reminder.updateSettings`.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "enabled", type: "boolean", required: true, description: "Switch the automatic reminders on. Off by default; nothing is sent until true." },
        { name: "daysBefore", type: "integer 0-30", required: true, description: "Days before the due date for the first reminder; 0 = none before the due date" },
        { name: "onDueDate", type: "boolean", required: true, description: "Remind on the due date" },
        { name: "repeatEveryDays", type: "integer 0-60", required: true, description: "After the due date, remind every N days while unpaid; 0 = no repeats" },
        { name: "maxReminders", type: "integer 1-20", required: true, description: "Most automatic reminders per invoice and channel, all kinds together" },
        { name: "channels", type: "object", required: true, description: "`{ email, sms, whatsapp }` booleans. WhatsApp is a link only; the job never sends it." },
        { name: "templates", type: "object", required: true, description: "`{ emailSubject, email, sms, whatsapp }` strings with placeholders (subject up to 150 chars, others up to 1000, none empty)" },
      ],
      output: { description: "The saved settings.", example: { settings: SETTINGS_EXAMPLE } },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/reminder.updateSettings" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"enabled":true,"daysBefore":3,"onDueDate":true,"repeatEveryDays":7,"maxReminders":4,"channels":{"email":true,"sms":false,"whatsapp":true},"templates":{"emailSubject":"Reminder: {{invoiceNumber}}","email":"Dear {{customerName}}, {{invoiceNumber}} {{dueText}}.","sms":"{{invoiceNumber}} {{dueText}}","whatsapp":"Hello {{customerName}}"}}}'`,
        javascript: `await trpc.reminder.updateSettings.mutate({ ...settings, enabled: true });`,
      },
      gotchas: [
        "Requires `Business:update` permission (owner and admin). Refused while the organization is read-only.",
        "Validation errors for out-of-range numbers or an empty template.",
      ],
      relatedEndpoints: ["reminder-get-settings"],
    },
    {
      id: "reminder-get-for-invoice",
      method: "query",
      path: "reminder.getForInvoice",
      title: "Get Invoice Reminders",
      description:
        "The reminder history of one sales invoice (newest first, up to 100) and what can be sent for it now. Recipients appear masked (`pr***@example.in`, `******3210`); full addresses are never returned or logged.",
      auth: "business",
      requiredRole: "viewer",
      input: [{ name: "invoiceId", type: "string (UUID)", required: true, description: "A sales invoice of this business" }],
      output: {
        description:
          "`blockedReason` is set when nothing can be sent (nothing due, draft, customer marked do not remind). Per channel: `available`, a `reason` when not, and for email/SMS the time `nextAt` the 24-hour limit lifts. `whatsapp.url` is the wa.me link with the message filled in.",
        example: {
          balanceDue: "7500.00",
          blockedReason: null,
          remindersEnabled: true,
          doNotRemind: false,
          channels: {
            email: { available: true, reason: null, nextAt: null },
            sms: { available: false, reason: "SMS is not set up on this server.", nextAt: null },
            whatsapp: { available: true, reason: null, url: "https://wa.me/919876543210?text=Hello%20Priya..." },
          },
          history: [
            {
              id: "5d3c0d5e-3f0e-4b43-9d7c-0f3a8f7d9a11",
              channel: "email",
              kind: "on_due",
              trigger: "auto",
              status: "sent",
              recipient: "pr***@example.in",
              error: null,
              sentByName: null,
              createdAt: "2026-10-10T04:30:00.000Z",
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/reminder.getForInvoice?input=%7B%22json%22%3A%7B%22invoiceId%22%3A%22INVOICE_ID%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const info = await trpc.reminder.getForInvoice.query({ invoiceId });
for (const r of info.history) console.log(r.createdAt, r.channel, r.status);`,
      },
      gotchas: [
        "Requires `Invoice:read` permission.",
        "`kind` is `before_due`, `on_due`, `after_due` or `manual`; `status` is `sending`, `sent`, `failed` or `link_opened`.",
        "NOT_FOUND `Invoice not found` for purchase documents, other document types, deleted invoices and ids from another business.",
      ],
      relatedEndpoints: ["reminder-send-now"],
    },
    {
      id: "reminder-send-now",
      method: "mutation",
      path: "reminder.sendNow",
      title: "Send Reminder Now",
      description:
        "Send a reminder for one invoice now. Email and SMS go through the same sender as the scheduled job and are written to the invoice's history with who sent them; each channel is limited to one per invoice per 24 hours (a failed attempt does not count). `whatsapp` sends nothing: it records that the link was opened and returns the wa.me URL. Works even while automatic reminders are switched off. Audit entry `reminder.sendNow`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "invoiceId", type: "string (UUID)", required: true, description: "A sales invoice with a balance due" },
        { name: "channel", type: "enum", required: true, description: "Where to send it", enumValues: ["email", "sms", "whatsapp"] },
      ],
      output: {
        description: "`url` is set for `whatsapp` only.",
        example: { channel: "email", status: "sent", url: null },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/reminder.sendNow" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"invoiceId":"INVOICE_ID","channel":"email"}}'`,
        javascript: `await trpc.reminder.sendNow.mutate({ invoiceId, channel: "email" });`,
      },
      gotchas: [
        "Requires `Invoice:update` permission (owner, admin, seller manager and seller). Refused while the organization is read-only.",
        "BAD_REQUEST when nothing is due, the invoice is a draft, the customer is marked do not remind, or has no email / mobile number for the channel.",
        "PRECONDITION_FAILED `SMS is not set up on this server.` when no SMS provider is configured.",
        "TOO_MANY_REQUESTS when an email or SMS reminder was already sent for this invoice in the last 24 hours.",
      ],
      relatedEndpoints: ["reminder-get-for-invoice"],
    },
  ],
};
