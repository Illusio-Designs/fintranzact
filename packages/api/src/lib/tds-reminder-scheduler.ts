/**
 * In-process scheduler for TDS / TCS due-date reminders. Ticks hourly, and
 * once per business emails its admins a digest of items that are within a week
 * of their due date, due today, or overdue.
 *
 * Idempotent: every (business, item, offset) is claimed by inserting into
 * tds_reminder_log (unique index) before anything is sent, so a restart or a
 * second instance never sends it twice. If sending fails the claim is released
 * and the next tick retries.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getTenantDb, controlDb, tenants, users, businesses, businessMembers, tdsReminderLog, type TenantDatabase } from "@fintranzact/db";
import { emailService } from "./email.js";
import { loadTdsReminders, reminderEmail, reminderOffset, type ReminderItem } from "./tds-reminders.js";

const TICK_MS = 60 * 60_000;
const isMultiTenant = process.env.MULTI_TENANT === "true";
let timer: ReturnType<typeof setInterval> | null = null;

/** Claim each (item, offset) not yet sent; returns the items this call now owns. */
async function claim(db: TenantDatabase, businessId: string, items: ReminderItem[]): Promise<Array<{ item: ReminderItem; offset: number }>> {
  const mine: Array<{ item: ReminderItem; offset: number }> = [];
  for (const item of items) {
    const offset = reminderOffset(item.daysUntil);
    if (offset === null) continue;
    const [row] = await db
      .insert(tdsReminderLog)
      .values({ businessId, itemKey: item.key, dayOffset: offset })
      .onConflictDoNothing()
      .returning({ id: tdsReminderLog.id });
    if (row) mine.push({ item, offset });
  }
  return mine;
}

async function release(db: TenantDatabase, businessId: string, claimed: Array<{ item: ReminderItem; offset: number }>) {
  for (const c of claimed) {
    await db
      .delete(tdsReminderLog)
      .where(and(eq(tdsReminderLog.businessId, businessId), eq(tdsReminderLog.itemKey, c.item.key), eq(tdsReminderLog.dayOffset, c.offset)))
      .catch(() => {});
  }
}

/** Send the reminders due now for every business in a tenant DB. Returns the number of emails sent. */
export async function processTdsReminders(db: TenantDatabase, now: Date = new Date()): Promise<number> {
  const bizRows = await db
    .select({ id: businesses.id, name: businesses.name, legalName: businesses.legalName })
    .from(businesses);
  let sent = 0;

  for (const biz of bizRows) {
    try {
      const items = await loadTdsReminders(db, biz.id, now);
      if (!items.some((i) => reminderOffset(i.daysUntil) !== null)) continue;

      const admins = await db
        .select({ userId: businessMembers.userId })
        .from(businessMembers)
        .where(and(eq(businessMembers.businessId, biz.id), eq(businessMembers.role, "admin")));
      if (admins.length === 0) continue;
      const emails = await controlDb
        .select({ email: users.email })
        .from(users)
        .where(inArray(users.id, admins.map((a) => a.userId)));
      if (emails.length === 0) continue;

      const claimed = await claim(db, biz.id, items);
      if (claimed.length === 0) continue;
      const { subject, text } = reminderEmail(biz.legalName || biz.name, claimed.map((c) => c.item));
      try {
        for (const e of emails) await emailService.sendNotice(e.email, subject, text);
        sent += emails.length;
      } catch (err) {
        await release(db, biz.id, claimed);
        throw err;
      }
    } catch (err) {
      console.error(`[tds-reminders] business ${biz.id} error:`, err);
    }
  }
  return sent;
}

async function tick() {
  try {
    if (!isMultiTenant) {
      await processTdsReminders(await getTenantDb("single"));
    } else {
      const active = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
      for (const t of active) {
        try {
          await processTdsReminders(await getTenantDb(t.id));
        } catch (err) {
          console.error(`[tds-reminders] tenant ${t.id} error:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[tds-reminders] tick error:", err);
  }
}

export function startTdsReminderScheduler() {
  if (timer) return;
  console.log("[tds-reminders] Started (hourly)");
  timer = setInterval(tick, TICK_MS);
  timer.unref();
}

export function stopTdsReminderScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
