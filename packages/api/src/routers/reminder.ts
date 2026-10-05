import { eq } from "drizzle-orm";
import { z } from "zod";
import { businesses } from "@fintranzact/db";
import { REMINDER_CHANNELS, paymentReminderSettingsSchema, resolveReminderSettings } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { getInvoiceReminderInfo, loadBusinessReminderSettings, sendReminderNow } from "../lib/payment-reminders.js";
import { smsConfigured } from "../lib/sms.js";

const invoiceInput = z.object({ invoiceId: z.string().uuid() });

/**
 * Payment reminders: the business's settings, an invoice's reminder history,
 * and "Send reminder now". The automatic job lives in lib/payment-reminders.ts.
 */
export const reminderRouter = router({
  /** The business's reminder settings (the defaults, switched off, until saved). */
  getSettings: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Business");
    const { business } = await loadBusinessReminderSettings(ctx.db, ctx.businessId);
    return { settings: business.settings, smsAvailable: smsConfigured() };
  }),

  updateSettings: memberProcedure.input(paymentReminderSettingsSchema).mutation(async ({ ctx, input }) => {
    requireCan(ctx.ability, "update", "Business");
    await ctx.db
      .update(businesses)
      .set({ paymentReminderSettings: input, updatedAt: new Date() })
      .where(eq(businesses.id, ctx.businessId));
    logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "reminder.updateSettings",
      entityType: "business",
      entityId: ctx.businessId,
      metadata: { enabled: input.enabled, channels: input.channels },
      ipAddress: ctx.ipAddress,
    });
    return { settings: resolveReminderSettings(input) };
  }),

  /** One invoice's reminder history and what can be sent for it now. */
  getForInvoice: viewerProcedure.input(invoiceInput).query(async ({ ctx, input }) => {
    requireCan(ctx.ability, "read", "Invoice");
    return getInvoiceReminderInfo(ctx.db, ctx.businessId, input.invoiceId);
  }),

  /** Send a reminder now (email or SMS), or record opening the WhatsApp link. */
  sendNow: memberProcedure
    .input(invoiceInput.extend({ channel: z.enum(REMINDER_CHANNELS) }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Invoice");
      const result = await sendReminderNow(ctx.db, {
        businessId: ctx.businessId,
        invoiceId: input.invoiceId,
        channel: input.channel,
        user: { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email },
      });
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "reminder.sendNow",
        entityType: "invoice",
        entityId: input.invoiceId,
        metadata: { channel: input.channel },
        ipAddress: ctx.ipAddress,
      });
      return result;
    }),
});
