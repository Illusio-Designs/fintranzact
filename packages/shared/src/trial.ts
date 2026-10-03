/**
 * Full Access Trial (roadmap P2): the pure rules, shared by the API, web,
 * mobile and the admin console so every surface counts the same days.
 *
 * Every new organisation starts a trial instead of a free plan: Business-level
 * access plus the add-ons, with caps, and no card. At the end, with no plan
 * bought, the organisation is read-only (deriveAccess); nothing is deleted.
 *
 * Nothing here touches a database or the clock: callers pass `now`.
 */

import { gstinCheckChar } from "./gstin.js";
import { z } from "zod";
import { TRIAL_DAYS } from "./plans.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How a trial started. "none" means the organisation never got one (a trial was already used). */
export const TRIAL_SOURCES = ["signup", "partner", "admin", "none"] as const;
export type TrialSource = (typeof TRIAL_SOURCES)[number];

export function isTrialSource(value: unknown): value is TrialSource {
  return typeof value === "string" && (TRIAL_SOURCES as readonly string[]).includes(value);
}

// ── Settings (system_config: trial.days, trial.partnerDays, trial.caps) ─────

export const TRIAL_DEFAULT_DAYS = TRIAL_DAYS;
export const TRIAL_DEFAULT_PARTNER_DAYS = 30;
export const TRIAL_MIN_DAYS = 1;
export const TRIAL_MAX_DAYS = 90;
/** The longest a platform admin may extend or grant in one action. */
export const TRIAL_ADMIN_MAX_DAYS = 365;

export interface TrialCaps {
  /** AI Assistant questions during the trial. */
  aiQuestions: number;
  /** Payroll employees during the trial. */
  payrollEmployees: number;
}

export const TRIAL_DEFAULT_CAPS: TrialCaps = { aiQuestions: 50, payrollEmployees: 10 };

export interface TrialSettings {
  days: number;
  partnerDays: number;
  caps: TrialCaps;
}

export const DEFAULT_TRIAL_SETTINGS: TrialSettings = {
  days: TRIAL_DEFAULT_DAYS,
  partnerDays: TRIAL_DEFAULT_PARTNER_DAYS,
  caps: { ...TRIAL_DEFAULT_CAPS },
};

const daysField = z.number().int().min(TRIAL_MIN_DAYS).max(TRIAL_MAX_DAYS);

/** What a platform admin may save. Bounds are enforced here and by the API. */
export const trialSettingsSchema = z.object({
  days: daysField,
  partnerDays: daysField,
  caps: z.object({
    aiQuestions: z.number().int().min(0).max(10_000),
    payrollEmployees: z.number().int().min(0).max(1_000),
  }),
});

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** Stored values (possibly missing or edited by hand) to a valid settings object; bad parts fall back to the default. */
export function normaliseTrialSettings(raw: {
  days?: unknown;
  partnerDays?: unknown;
  caps?: unknown;
}): TrialSettings {
  const caps = (raw.caps && typeof raw.caps === "object" ? raw.caps : {}) as Record<string, unknown>;
  return {
    days: intInRange(raw.days, TRIAL_MIN_DAYS, TRIAL_MAX_DAYS, TRIAL_DEFAULT_DAYS),
    partnerDays: intInRange(raw.partnerDays, TRIAL_MIN_DAYS, TRIAL_MAX_DAYS, TRIAL_DEFAULT_PARTNER_DAYS),
    caps: {
      aiQuestions: intInRange(caps.aiQuestions, 0, 10_000, TRIAL_DEFAULT_CAPS.aiQuestions),
      payrollEmployees: intInRange(caps.payrollEmployees, 0, 1_000, TRIAL_DEFAULT_CAPS.payrollEmployees),
    },
  };
}

// ── The window ──────────────────────────────────────────────────────────────

/** The trial window for a trial that starts at `start` and runs `days` days. */
export function trialWindow(start: Date, days: number): { startedAt: Date; endsAt: Date } {
  return { startedAt: start, endsAt: new Date(start.getTime() + days * DAY_MS) };
}

/** Whole days left, rounded up (so "1 day left" until the very end); 0 once it has ended. */
export function trialDaysLeftAt(endsAt: Date | null | undefined, now: Date): number {
  if (!endsAt) return 0;
  const ms = endsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/** The days a sign-up gets: the partner length for a partner referral, else the standard one. */
export function trialDaysForSource(source: "signup" | "partner", settings: TrialSettings): number {
  return source === "partner" ? settings.partnerDays : settings.days;
}

/** The trial block in the entitlements payload (additive; the older trialEndsAt/trialDaysLeft stay). */
export interface TrialInfo {
  /** True while a trial is running and no plan has been bought. */
  active: boolean;
  /** True once a trial existed and has run out (or was ended) with no plan bought. */
  ended: boolean;
  startedAt: Date | null;
  endsAt: Date | null;
  /** Whole days left (rounded up) while active, otherwise 0. */
  daysLeft: number;
  source: TrialSource | null;
  /** The add-on caps in force; null unless the trial is active. */
  caps: (TrialCaps & { storePro: true }) | null;
  /** Length in days, when both ends are known. */
  totalDays: number | null;
}

// ── Reminders (days left 7, 2 and 0) ────────────────────────────────────────

/** The spec's "day 7, 12 and 14" of a 14-day trial, as days left: 7, 2 and 0. */
export const TRIAL_REMINDER_KINDS = ["days_7", "days_2", "days_0"] as const;
export type TrialReminderKind = (typeof TRIAL_REMINDER_KINDS)[number];

export const TRIAL_REMINDER_DAYS_LEFT: Record<TrialReminderKind, number> = {
  days_7: 7,
  days_2: 2,
  days_0: 0,
};

/** After this many days past the end, the expiry reminder is no longer sent (it is skipped). */
export const TRIAL_EXPIRY_REMINDER_GRACE_DAYS = 3;

/** When a reminder becomes due: `daysLeft` days before the end (the end itself for days_0). */
export function trialReminderDueAt(endsAt: Date, kind: TrialReminderKind): Date {
  return new Date(endsAt.getTime() - TRIAL_REMINDER_DAYS_LEFT[kind] * DAY_MS);
}

export interface ReminderPlan {
  /** The one reminder to send now (the latest that is due), or null. */
  send: TrialReminderKind | null;
  /** Reminders to record as skipped without sending: earlier ones passed by a late run, or too stale. */
  skip: TrialReminderKind[];
}

/**
 * Which reminders to act on for one trial, given those already recorded
 * (sent or skipped).
 *  - A reminder is due once its moment has passed, and never if that moment is
 *    at or before the trial's start (a 5-day trial has no "7 days left").
 *  - A job that runs late sends only the latest due reminder; the earlier due
 *    ones are recorded as skipped, so nobody gets three emails at once.
 *  - The expiry reminder stops being sent after TRIAL_EXPIRY_REMINDER_GRACE_DAYS;
 *    every reminder past its useful time is skipped.
 *  - Pure and idempotent: with every kind recorded, nothing is returned.
 */
export function planTrialReminders(input: {
  startedAt: Date;
  endsAt: Date;
  now: Date;
  recorded: ReadonlySet<TrialReminderKind>;
}): ReminderPlan {
  const { startedAt, endsAt, now, recorded } = input;
  const due: TrialReminderKind[] = [];
  for (const kind of TRIAL_REMINDER_KINDS) {
    if (recorded.has(kind)) continue;
    const at = trialReminderDueAt(endsAt, kind);
    if (at.getTime() <= startedAt.getTime()) continue; // before the trial began: never applies
    if (at.getTime() > now.getTime()) continue; // not yet
    due.push(kind);
  }
  if (due.length === 0) return { send: null, skip: [] };
  // Latest threshold last: TRIAL_REMINDER_KINDS runs 7, 2, 0.
  const latest = due[due.length - 1]!;
  const stale =
    now.getTime() - endsAt.getTime() > TRIAL_EXPIRY_REMINDER_GRACE_DAYS * DAY_MS;
  return stale ? { send: null, skip: due } : { send: latest, skip: due.slice(0, -1) };
}

/** What each reminder says. Plain text; the clients and the email share the wording. */
export function trialReminderCopy(kind: TrialReminderKind, daysLeft: number): { subject: string; headline: string } {
  if (kind === "days_0") {
    return {
      subject: "Your Fintranzact trial has ended",
      headline: "Your Full Access Trial has ended. Your data is safe, but the account is read-only until you choose a plan.",
    };
  }
  const n = daysLeft > 0 ? daysLeft : TRIAL_REMINDER_DAYS_LEFT[kind];
  const label = `${n} day${n === 1 ? "" : "s"} left`;
  return {
    subject: `${label} in your Fintranzact trial`,
    headline: `${label} in your Full Access Trial. Choose a plan to keep creating and editing after it ends.`,
  };
}

// ── One trial per business: normalising what is checked ─────────────────────

export const TRIAL_CLAIM_KINDS = ["email", "phone", "gstin"] as const;
export type TrialClaimKind = (typeof TRIAL_CLAIM_KINDS)[number];

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * An email in the form claims compare on: lowercase, a "+tag" removed from the
 * local part (a universal convention), and dots removed only for Gmail, where
 * they are ignored. Null when it is not an email.
 */
export function normaliseEmailForClaim(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return local ? `${local}@${domain}` : null;
}

/**
 * A phone number as E.164, or null when it cannot be one. Ten-digit numbers
 * (optionally with a leading 0) are Indian mobiles (+91); anything else must
 * carry its country code, with or without "+".
 */
export function normalisePhoneForClaim(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  let e164: string;
  if (hasPlus) e164 = digits;
  else if (digits.length === 10) e164 = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) e164 = `91${digits.slice(1)}`;
  else if (digits.length === 12 && digits.startsWith("91")) e164 = digits;
  else if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0")) e164 = digits;
  else return null;
  if (e164.length < 8 || e164.length > 15) return null;
  return `+${e164}`;
}

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * A GSTIN in the form claims compare on: uppercase, and only when it is a
 * well-formed GSTIN with a correct check digit (so a made-up value cannot be
 * used to block someone's real one). Null otherwise.
 */
export function normaliseGstinForClaim(raw: string | null | undefined): string | null {
  const value = raw?.trim().toUpperCase();
  if (!value || !GSTIN_FORMAT.test(value)) return null;
  return gstinCheckChar(value.slice(0, 14)) === value[14] ? value : null;
}

export function normaliseClaimValue(kind: TrialClaimKind, raw: string | null | undefined): string | null {
  switch (kind) {
    case "email":
      return normaliseEmailForClaim(raw);
    case "phone":
      return normalisePhoneForClaim(raw);
    case "gstin":
      return normaliseGstinForClaim(raw);
  }
}

/** What a person is told when a trial was already used. Never says by whom. */
export const TRIAL_ALREADY_USED_MESSAGE =
  "A free trial was already used for this email, phone or GSTIN. Choose a plan to continue.";

// ── The countdown banner (web and mobile share the wording and rules) ───────

export interface TrialBannerInput {
  state: string;
  readOnly: boolean;
  trial?: { active: boolean; daysLeft: number; source: string | null; totalDays: number | null } | null;
  /** Set by the server when the organisation has no trial because one was already used. */
  trialMessage?: string | null;
  /** True for owners and admins, who can open the billing page. */
  canManageBilling: boolean;
}

export interface TrialBannerSpec {
  kind: "trial" | "trial_ended";
  /** calm while there is time, warning at 3 days or fewer, danger once ended. Never the only signal: the text says it too. */
  tone: "calm" | "warning" | "danger";
  /** Bold lead-in. */
  title: string;
  text: string;
  /** Button label; null when the person cannot act on it. */
  cta: string | null;
  /** Dismissible for the rest of the day, but only while more than 3 days are left. */
  dismissible: boolean;
}

/** From this many days left the banner turns amber and can no longer be dismissed. */
export const TRIAL_BANNER_WARNING_DAYS = 3;

/**
 * The trial notice to show, or null (a paid, grandfathered, halted or
 * suspended organisation, or a trial notice dismissed for today). Pure:
 * `today` and `dismissedDay` are "YYYY-MM-DD" strings.
 */
export function trialBannerFor(
  input: TrialBannerInput,
  opts: { today: string; dismissedDay?: string | null },
): TrialBannerSpec | null {
  const owner = input.canManageBilling;
  const askOwner = owner ? "" : " Ask your organisation owner to choose a plan.";

  if (input.state === "trialing" && input.trial?.active) {
    const left = Math.max(1, input.trial.daysLeft);
    const urgent = left <= TRIAL_BANNER_WARNING_DAYS;
    if (!urgent && opts.dismissedDay === opts.today) return null;
    const days = `${left} day${left === 1 ? "" : "s"} left`;
    const title =
      input.trial.source === "partner"
        ? `Your ${input.trial.totalDays ?? 30}-day partner trial: ${days}`
        : `${days} in your Full Access Trial`;
    return {
      kind: "trial",
      tone: urgent ? "warning" : "calm",
      title,
      text: `Choose a plan to keep creating and editing after it ends.${askOwner}`,
      cta: owner ? "Choose a plan" : null,
      dismissible: !urgent,
    };
  }

  if (input.state === "trial_expired" && input.readOnly) {
    return {
      kind: "trial_ended",
      tone: "danger",
      title: "Trial ended: read-only",
      text:
        (input.trialMessage ? `${input.trialMessage} ` : "Your trial has ended. Choose a plan to continue. ") +
        `You can still view, search, download and export, but not create or edit.${owner ? "" : " Ask your organisation owner to choose a plan."}`,
      cta: owner ? "Choose a plan" : null,
      dismissible: false,
    };
  }
  return null;
}
