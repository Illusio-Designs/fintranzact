/**
 * send_payment_reminder: runs reminder.sendNow, the "Send reminder now" button
 * of the invoice screen, as the person. NO new sending channel. What Confirm
 * does is exactly what that button does:
 *   - email and SMS: the existing machinery sends the message now (one per
 *     invoice per channel per 24 hours, quiet-hours rules do not apply to a
 *     hand-sent reminder, a payment link is added when online payments are set up),
 *   - WhatsApp: nothing is sent by Fintranzact; the reminder is recorded as "link
 *     opened" and a click-to-send wa.me link with the message is returned for the
 *     person to open and press send in WhatsApp themselves.
 * The card shows the real message text.
 */

import { z } from "zod";
import { AI_ACTION_TOOL_NAMES, AI_WHATSAPP_URL_PATTERN, REMINDER_CHANNELS, aiSendReminderInputSchema, type AiActionPreview, type ReminderChannel } from "@fintranzact/shared";
import { AiActionEditError, AiToolInputError } from "../../errors.js";
import { clip } from "../../format.js";
import { previewInvoiceReminder } from "../../../payment-reminders.js";
import { inr, parseReal } from "../helpers.js";
import type { AiActionCtx, AiActionDef, BuiltAction } from "../types.js";

const CHANNEL_LABELS: Record<ReminderChannel, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const realSchema = z.object({ invoiceId: z.string().uuid(), channel: z.enum(REMINDER_CHANNELS) });

async function build(ctx: AiActionCtx, payload: Record<string, unknown>): Promise<BuiltAction> {
  const input = parseReal(realSchema, payload);
  const p = await previewInvoiceReminder(ctx.db, ctx.businessId, input.invoiceId, input.channel, { now: ctx.now, deps: { tenantId: ctx.tenantId } });
  if (p.blockedReason) throw new AiToolInputError(p.blockedReason);
  if (p.channelReason) {
    const others = p.availableChannels.filter((c) => c !== input.channel);
    throw new AiToolInputError(`${CHANNEL_LABELS[input.channel]} cannot be used: ${p.channelReason}${others.length ? ` Other channels that work now: ${others.map((c) => CHANNEL_LABELS[c]).join(", ")}.` : ""}`);
  }
  const sends = input.channel !== "whatsapp";
  const preview: AiActionPreview = {
    title: `Payment reminder by ${CHANNEL_LABELS[input.channel]}`,
    fields: [
      { label: "Invoice", value: p.invoiceNumber },
      { label: "Customer", value: clip(p.partyName, 80) },
      { label: "Balance due", value: inr(p.balanceDue) },
      { label: "Channel", value: CHANNEL_LABELS[input.channel] },
      ...(p.recipient ? [{ label: "To", value: p.recipient }] : []),
    ],
    totals: [],
    warnings: [],
    message: `${p.subject ? `Subject: ${p.subject}\n\n` : ""}${p.body}`,
    note: sends
      ? `Confirm sends this ${CHANNEL_LABELS[input.channel]} message now, the same as Send reminder on the invoice. A payment link is added when online payments are set up.`
      : "Confirm records the reminder and gives you a WhatsApp link with this message. Nothing is sent until you press send in WhatsApp.",
    edits: [
      {
        key: "channel",
        label: "Channel",
        input: "select",
        value: input.channel,
        options: REMINDER_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] })),
      },
    ],
  };
  return {
    payload: input as unknown as Record<string, unknown>,
    preview,
    summary: clip(`Send ${CHANNEL_LABELS[input.channel]} reminder for invoice ${p.invoiceNumber} to ${p.partyName}`, 200),
  };
}

export const sendReminderKind: AiActionDef = {
  kind: "send_payment_reminder",
  toolName: AI_ACTION_TOOL_NAMES.send_payment_reminder,
  description:
    "Prepare a PAYMENT REMINDER for one unpaid sales invoice for the person to review. Nothing is sent: the person sees the message on a confirmation card and must tap Confirm. Email and SMS are sent by the app when confirmed; WhatsApp gives the person a link to send it themselves. Needs the invoiceId (from find_invoices or overdue_invoices) and the channel the person chose.",
  properties: {
    invoiceId: { type: "string", description: "Invoice id (UUID) of a sales invoice that is not fully paid." },
    channel: { type: "string", enum: [...REMINDER_CHANNELS] },
  },
  required: ["invoiceId", "channel"],
  inputSchema: aiSendReminderInputSchema,

  async propose(ctx, rawInput: never) {
    const input = rawInput as { invoiceId: string; channel: ReminderChannel };
    try {
      return await build(ctx, { invoiceId: input.invoiceId, channel: input.channel });
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "NOT_FOUND") {
        throw new AiToolInputError("No sales invoice with that id in this business. Look it up with find_invoices and use the id it returns.");
      }
      throw err;
    }
  },

  build,

  applyEdits(payload, edits) {
    const next = structuredClone(payload) as Record<string, unknown>;
    for (const [key, raw] of Object.entries(edits)) {
      if (key !== "channel") throw new AiActionEditError(`"${clip(key, 40)}" cannot be edited here.`);
      if (!(REMINDER_CHANNELS as readonly string[]).includes(raw)) throw new AiActionEditError("Channel: pick email, SMS or WhatsApp.");
      next.channel = raw;
    }
    return next;
  },

  async execute(ctx, payload) {
    const input = parseReal(realSchema, payload);
    const r = await ctx.caller.reminder.sendNow({ invoiceId: input.invoiceId, channel: input.channel });
    const url = r.url && AI_WHATSAPP_URL_PATTERN.test(r.url) ? r.url : undefined;
    return {
      entityType: "reminder",
      id: input.invoiceId,
      label: input.channel === "whatsapp" ? "WhatsApp reminder recorded" : `${CHANNEL_LABELS[input.channel]} reminder sent`,
      ...(url ? { externalUrl: url } : {}),
    };
  },
};
