/**
 * Full Access Trial reminders: an email to the organisation's owners when 7
 * days are left, 2 days are left, and when the trial has ended (the spec's
 * "day 7, 12 and 14" of a 14-day trial). The in-app side is the countdown
 * banner and the header bell, which both read the same entitlements, so there
 * is no separate in-app notice to store; this log only records the emails.
 *
 * What is due is the pure planTrialReminders (@fintranzact/shared). This file
 * is the job around it:
 *  - one row in trial_reminders per (organisation, kind), inserted BEFORE the
 *    email goes out (UNIQUE), so a restart or a second instance never sends it
 *    twice; a failed send releases the row so the next tick retries;
 *  - a job that was down sends only the latest due reminder and records the
 *    earlier ones as skipped;
 *  - paid, grandfathered and suspended organisations are never emailed, and
 *    neither is a trial that was extended past a reminder (extending resets the
 *    log and records the already-passed reminders as skipped).
 *
 * Reminders go to organisation owners only. There is no email opt-out or
 * bounce store in this codebase; these are billing notices about the account.
 */

import { and, between, eq, inArray, sql } from "drizzle-orm";
import { controlDb, tenantMembers, tenants, trialReminders, users } from "@fintranzact/db";
import {
  BILLING_UPGRADE_PATH,
  TRIAL_DEFAULT_DAYS,
  TRIAL_EXPIRY_REMINDER_GRACE_DAYS,
  TRIAL_REMINDER_KINDS,
  planTrialReminders,
  trialDaysLeftAt,
  trialReminderCopy,
  type TrialReminderKind,
} from "@fintranzact/shared";
import { emailService } from "./email.js";
import { getEntitlements } from "./entitlements.js";
import { logger } from "./logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

type ControlDbLike = Pick<typeof controlDb, "select" | "insert" | "delete">;

function isKind(value: string): value is TrialReminderKind {
  return (TRIAL_REMINDER_KINDS as readonly string[]).includes(value);
}

/**
 * Called when a trial's dates change (extend, custom, end now): forget what
 * was recorded and mark every reminder that is already past, under the new
 * dates, as skipped, so a changed trial is not nagged about moments that have
 * gone by. Reminders still ahead will be sent when they come due.
 */
export async function resetTrialReminders(tenantId: string, now: Date = new Date(), db: ControlDbLike = controlDb): Promise<void> {
  const [t] = await db
    .select({ startedAt: tenants.trialStartedAt, endsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  await db.delete(trialReminders).where(eq(trialReminders.tenantId, tenantId));
  if (!t?.endsAt) return;
  const startedAt = t.startedAt ?? new Date(t.endsAt.getTime() - TRIAL_DEFAULT_DAYS * DAY_MS);
  const plan = planTrialReminders({ startedAt, endsAt: t.endsAt, now, recorded: new Set() });
  const past = [...plan.skip, ...(plan.send ? [plan.send] : [])];
  if (past.length === 0) return;
  await db
    .insert(trialReminders)
    .values(past.map((kind) => ({ tenantId, kind, status: "skipped" })))
    .onConflictDoNothing();
}

/** The text of one reminder email. */
export function trialReminderEmail(kind: TrialReminderKind, daysLeft: number, appUrl: string): { subject: string; text: string } {
  const { subject, headline } = trialReminderCopy(kind, daysLeft);
  const link = `${appUrl.replace(/\/$/, "")}${BILLING_UPGRADE_PATH}`;
  const lines = [headline, ""];
  if (kind === "days_0") {
    lines.push(
      "Nothing has been deleted. You can still view, search, download PDFs and export your data.",
      "Buying any plan unlocks creating and editing straight away.",
    );
  } else {
    lines.push("Your data stays safe either way: after the trial the account becomes read-only until you buy a plan.");
  }
  lines.push("", `Choose a plan: ${link}`);
  return { subject, text: lines.join("\n") };
}

async function ownerEmails(tenantId: string): Promise<string[]> {
  const rows = await controlDb
    .select({ email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, "owner")));
  return [...new Set(rows.map((r) => r.email))];
}

export interface TrialReminderRunSummary {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * One run of the job. Safe to run any number of times, concurrently or not.
 * Never throws; logs counts only (no addresses).
 */
export async function runTrialReminders(
  now: Date = new Date(),
  deps: { send?: (to: string, subject: string, text: string) => Promise<void> } = {},
): Promise<TrialReminderRunSummary> {
  const send = deps.send ?? ((to, subject, text) => emailService.sendNotice(to, subject, text));
  const summary: TrialReminderRunSummary = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  try {
    // Trials that end within the next 7 days (+ a little), or ended within the grace window.
    const candidates = await controlDb
      .select({
        id: tenants.id,
        startedAt: tenants.trialStartedAt,
        endsAt: tenants.trialEndsAt,
      })
      .from(tenants)
      .where(
        and(
          eq(tenants.status, "active"),
          eq(tenants.accessGrandfathered, false),
          inArray(tenants.trialSource, ["signup", "partner", "admin"]),
          between(
            tenants.trialEndsAt,
            sql`${new Date(now.getTime() - (TRIAL_EXPIRY_REMINDER_GRACE_DAYS + 1) * DAY_MS).toISOString()}::timestamptz`,
            sql`${new Date(now.getTime() + 8 * DAY_MS).toISOString()}::timestamptz`,
          ),
        ),
      );

    for (const t of candidates) {
      if (!t.endsAt) continue;
      try {
        summary.considered++;
        // Only a trial that is running or has just run out: never a paid organisation.
        const ent = await getEntitlements(t.id, now);
        if (ent.state !== "trialing" && ent.state !== "trial_expired") continue;

        const rows = await controlDb
          .select({ kind: trialReminders.kind })
          .from(trialReminders)
          .where(eq(trialReminders.tenantId, t.id));
        const recorded = new Set(rows.map((r) => r.kind).filter(isKind));
        const startedAt = t.startedAt ?? new Date(t.endsAt.getTime() - TRIAL_DEFAULT_DAYS * DAY_MS);
        const plan = planTrialReminders({ startedAt, endsAt: t.endsAt, now, recorded });

        if (plan.skip.length > 0) {
          await controlDb
            .insert(trialReminders)
            .values(plan.skip.map((kind) => ({ tenantId: t.id, kind, status: "skipped" })))
            .onConflictDoNothing();
          summary.skipped += plan.skip.length;
        }
        if (!plan.send) continue;

        // Claim first: whoever inserts the row sends the email.
        const [claimed] = await controlDb
          .insert(trialReminders)
          .values({ tenantId: t.id, kind: plan.send, status: "sent" })
          .onConflictDoNothing()
          .returning({ id: trialReminders.id });
        if (!claimed) continue;

        const to = await ownerEmails(t.id);
        const { subject, text } = trialReminderEmail(plan.send, trialDaysLeftAt(t.endsAt, now), appUrl);
        try {
          for (const address of to) await send(address, subject, text);
          summary.sent++;
        } catch (err) {
          await controlDb.delete(trialReminders).where(eq(trialReminders.id, claimed.id)).catch(() => {});
          summary.failed++;
          logger.error({ tenantId: t.id, err: err instanceof Error ? err.message : String(err) }, "[trial-reminders] send failed; will retry");
        }
      } catch (err) {
        summary.failed++;
        logger.error({ tenantId: t.id, err: err instanceof Error ? err.message : String(err) }, "[trial-reminders] organisation failed");
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[trial-reminders] run failed");
  }
  if (summary.considered > 0) logger.info(summary, "[trial-reminders] run");
  return summary;
}

/** Checked hourly; the log makes each reminder go out once, so a daily cadence needs no extra state. */
export function startTrialReminderScheduler(): void {
  if (timer) return;
  if (process.env.TRIAL_REMINDERS === "off") return;
  console.log("[trial-reminders] Started (hourly check, each reminder sent once)");
  timer = setInterval(() => void runTrialReminders(), TICK_MS);
  timer.unref();
}

export function stopTrialReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
