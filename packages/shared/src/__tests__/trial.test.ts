import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRIAL_SETTINGS,
  TRIAL_DEFAULT_CAPS,
  TRIAL_MAX_DAYS,
  TRIAL_REMINDER_KINDS,
  deriveAccess,
  gstinCheckChar,
  normaliseEmailForClaim,
  normaliseGstinForClaim,
  normalisePhoneForClaim,
  normaliseTrialSettings,
  planTrialReminders,
  trialDaysForSource,
  trialDaysLeftAt,
  trialReminderCopy,
  trialReminderDueAt,
  trialSettingsSchema,
  trialWindow,
  type TrialReminderKind,
} from "../index.js";

const DAY = 86_400_000;
const T0 = new Date("2026-10-03T09:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

describe("trial window and days left", () => {
  it("a window runs `days` days from the start", () => {
    expect(trialWindow(T0, 14)).toEqual({ startedAt: T0, endsAt: at(14) });
    expect(trialWindow(T0, 30).endsAt).toEqual(at(30));
  });

  it("days left rounds up and is 0 once over", () => {
    const end = at(14);
    expect(trialDaysLeftAt(end, T0)).toBe(14);
    expect(trialDaysLeftAt(end, at(5))).toBe(9);
    expect(trialDaysLeftAt(end, new Date(end.getTime() - 1000))).toBe(1);
    expect(trialDaysLeftAt(end, end)).toBe(0);
    expect(trialDaysLeftAt(end, at(20))).toBe(0);
    expect(trialDaysLeftAt(null, T0)).toBe(0);
  });

  it("partner referrals use the partner length", () => {
    expect(trialDaysForSource("signup", DEFAULT_TRIAL_SETTINGS)).toBe(14);
    expect(trialDaysForSource("partner", DEFAULT_TRIAL_SETTINGS)).toBe(30);
  });
});

describe("trial settings", () => {
  it("defaults are 14 days, 30 partner days, AI 50 and Payroll 10", () => {
    expect(DEFAULT_TRIAL_SETTINGS).toEqual({ days: 14, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } });
    expect(TRIAL_DEFAULT_CAPS).toEqual({ aiQuestions: 50, payrollEmployees: 10 });
  });

  it("normalise falls back per field for missing or out-of-bounds stored values", () => {
    expect(normaliseTrialSettings({})).toEqual(DEFAULT_TRIAL_SETTINGS);
    expect(normaliseTrialSettings({ days: 21, partnerDays: 45, caps: { aiQuestions: 80, payrollEmployees: 5 } })).toEqual({
      days: 21,
      partnerDays: 45,
      caps: { aiQuestions: 80, payrollEmployees: 5 },
    });
    expect(normaliseTrialSettings({ days: 0, partnerDays: 9999, caps: { aiQuestions: -1, payrollEmployees: "x" } })).toEqual(DEFAULT_TRIAL_SETTINGS);
    expect(normaliseTrialSettings({ days: 7.5, caps: "nope" })).toEqual(DEFAULT_TRIAL_SETTINGS);
  });

  it("the save schema enforces 1-90 days and whole-number caps", () => {
    const ok = { days: 14, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } };
    expect(trialSettingsSchema.safeParse(ok).success).toBe(true);
    expect(trialSettingsSchema.safeParse({ ...ok, days: 1 }).success).toBe(true);
    expect(trialSettingsSchema.safeParse({ ...ok, days: TRIAL_MAX_DAYS }).success).toBe(true);
    expect(trialSettingsSchema.safeParse({ ...ok, days: 0 }).success).toBe(false);
    expect(trialSettingsSchema.safeParse({ ...ok, days: 91 }).success).toBe(false);
    expect(trialSettingsSchema.safeParse({ ...ok, partnerDays: 1.5 }).success).toBe(false);
    expect(trialSettingsSchema.safeParse({ ...ok, caps: { aiQuestions: -1, payrollEmployees: 10 } }).success).toBe(false);
    expect(trialSettingsSchema.safeParse({ ...ok, caps: { aiQuestions: 50, payrollEmployees: 100000 } }).success).toBe(false);
  });
});

describe("reminder due dates", () => {
  it("7 days left, 2 days left and the end of the trial", () => {
    const end = at(14);
    expect(trialReminderDueAt(end, "days_7")).toEqual(at(7));
    expect(trialReminderDueAt(end, "days_2")).toEqual(at(12));
    expect(trialReminderDueAt(end, "days_0")).toEqual(end);
  });

  const plan = (days: number, now: Date, recorded: TrialReminderKind[] = []) =>
    planTrialReminders({ startedAt: T0, endsAt: at(days), now, recorded: new Set(recorded) });

  it("a 14-day trial: nothing at the start, then 7, 2 and 0 in turn, each once", () => {
    expect(plan(14, at(1))).toEqual({ send: null, skip: [] });
    expect(plan(14, at(7))).toEqual({ send: "days_7", skip: [] });
    expect(plan(14, at(7.5), ["days_7"])).toEqual({ send: null, skip: [] });
    expect(plan(14, at(12), ["days_7"])).toEqual({ send: "days_2", skip: [] });
    expect(plan(14, at(13), ["days_7", "days_2"])).toEqual({ send: null, skip: [] });
    expect(plan(14, at(14), ["days_7", "days_2"])).toEqual({ send: "days_0", skip: [] });
    expect(plan(14, at(14.5), ["days_7", "days_2", "days_0"])).toEqual({ send: null, skip: [] });
  });

  it("a late run sends only the latest due reminder and skips the earlier ones", () => {
    expect(plan(14, at(12.5))).toEqual({ send: "days_2", skip: ["days_7"] });
    expect(plan(14, at(14.2))).toEqual({ send: "days_0", skip: ["days_7", "days_2"] });
    // after that run records everything, a second run does nothing
    expect(plan(14, at(14.3), [...TRIAL_REMINDER_KINDS])).toEqual({ send: null, skip: [] });
  });

  it("skips a reminder that is already past at the start (short trials)", () => {
    // 5-day trial: 7 days left is before the start, so only 2 and 0 apply.
    expect(plan(5, at(0.5))).toEqual({ send: null, skip: [] });
    expect(plan(5, at(3))).toEqual({ send: "days_2", skip: [] });
    expect(plan(5, at(5))).toEqual({ send: "days_0", skip: ["days_2"] });
    // exactly 7 days: 7 days left is the start itself, never due
    expect(planTrialReminders({ startedAt: T0, endsAt: at(7), now: T0, recorded: new Set() })).toEqual({ send: null, skip: [] });
    // 1-day trial: only the end reminder exists
    expect(plan(1, at(1))).toEqual({ send: "days_0", skip: [] });
    expect(plan(1, at(0.5))).toEqual({ send: null, skip: [] });
  });

  it("a 30-day partner trial reminds at 7, 2 and 0 days left", () => {
    expect(plan(30, at(23))).toEqual({ send: "days_7", skip: [] });
    expect(plan(30, at(28), ["days_7"])).toEqual({ send: "days_2", skip: [] });
  });

  it("the expiry reminder is skipped, not sent, once it is more than 3 days stale", () => {
    expect(plan(14, at(16.5), ["days_7", "days_2"])).toEqual({ send: "days_0", skip: [] });
    expect(plan(14, at(18), ["days_7", "days_2"])).toEqual({ send: null, skip: ["days_0"] });
  });

  it("copy says how many days are left", () => {
    expect(trialReminderCopy("days_7", 7).subject).toBe("7 days left in your Fintranzact trial");
    expect(trialReminderCopy("days_2", 1).headline).toMatch(/^1 day left/);
    expect(trialReminderCopy("days_0", 0).headline).toMatch(/read-only until you choose a plan/);
  });
});

describe("claim normalisation", () => {
  it("emails: lowercase, +tag removed, Gmail dots ignored", () => {
    expect(normaliseEmailForClaim("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(normaliseEmailForClaim("alice+shop@example.com")).toBe("alice@example.com");
    expect(normaliseEmailForClaim("a.l.i.c.e+x@gmail.com")).toBe("alice@gmail.com");
    expect(normaliseEmailForClaim("alice@googlemail.com")).toBe("alice@gmail.com");
    // dots are significant elsewhere
    expect(normaliseEmailForClaim("a.lice@example.com")).toBe("a.lice@example.com");
    expect(normaliseEmailForClaim("not-an-email")).toBeNull();
    expect(normaliseEmailForClaim("@example.com")).toBeNull();
    expect(normaliseEmailForClaim("")).toBeNull();
    expect(normaliseEmailForClaim(null)).toBeNull();
  });

  it("phones: E.164, Indian 10-digit numbers get +91", () => {
    expect(normalisePhoneForClaim("98765 43210")).toBe("+919876543210");
    expect(normalisePhoneForClaim("09876543210")).toBe("+919876543210");
    expect(normalisePhoneForClaim("+91 98765-43210")).toBe("+919876543210");
    expect(normalisePhoneForClaim("919876543210")).toBe("+919876543210");
    expect(normalisePhoneForClaim("+1 (415) 555-2671")).toBe("+14155552671");
    expect(normalisePhoneForClaim("12345")).toBeNull();
    expect(normalisePhoneForClaim("abc")).toBeNull();
    expect(normalisePhoneForClaim(undefined)).toBeNull();
  });

  it("GSTINs: uppercase, and only a well-formed one with a correct check digit", () => {
    expect(normaliseGstinForClaim("27aapfu0939f1zv")).toBe("27AAPFU0939F1ZV");
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(normaliseGstinForClaim("24AAACC1206D1ZM")).toBe("24AAACC1206D1ZM");
    expect(normaliseGstinForClaim("27AAPFU0939F1Z5")).toBeNull(); // wrong check digit
    expect(normaliseGstinForClaim("27AAPFU0939F1")).toBeNull(); // too short
    expect(normaliseGstinForClaim("NOTAGSTIN")).toBeNull();
    expect(normaliseGstinForClaim("")).toBeNull();
  });
});

describe("deriveAccess: the Full Access Trial block", () => {
  const base = {
    plan: "starter",
    tenantStatus: "active",
    planSubscription: null,
    everHadPlanSubscription: false,
    addons: [],
  };

  it("while running: trialing, every add-on but AI Plus is on, caps exposed", () => {
    const a = deriveAccess({ ...base, now: at(5), trialStartedAt: T0, trialEndsAt: at(14), trialSource: "signup" });
    expect(a.state).toBe("trialing");
    expect(a.readOnly).toBe(false);
    expect(a.addons).toEqual({ ai_assistant: true, ai_plus: false, payroll: true, store_pro: true });
    expect(a.trial).toMatchObject({
      active: true,
      ended: false,
      startedAt: T0,
      endsAt: at(14),
      daysLeft: 9,
      source: "signup",
      totalDays: 14,
      caps: { aiQuestions: 50, payrollEmployees: 10, storePro: true },
    });
    expect(a.trialDaysLeft).toBe(9);
  });

  it("caps follow the settings passed in", () => {
    const a = deriveAccess({ ...base, now: at(1), trialEndsAt: at(14), trialCaps: { aiQuestions: 80, payrollEmployees: 3 } });
    expect(a.trial.caps).toMatchObject({ aiQuestions: 80, payrollEmployees: 3 });
  });

  it("a partner trial reports its source and length", () => {
    const a = deriveAccess({ ...base, now: at(1), trialStartedAt: T0, trialEndsAt: at(30), trialSource: "partner" });
    expect(a.trial).toMatchObject({ source: "partner", totalDays: 30, daysLeft: 29 });
  });

  it("after the end with no plan: read-only, no add-ons, ended", () => {
    const a = deriveAccess({ ...base, now: at(15), trialStartedAt: T0, trialEndsAt: at(14), trialSource: "signup" });
    expect(a).toMatchObject({ state: "trial_expired", readOnly: true, reason: "read_only_trial_expired" });
    expect(a.addons).toEqual({ ai_assistant: false, ai_plus: false, payroll: false, store_pro: false });
    expect(a.trial).toMatchObject({ active: false, ended: true, daysLeft: 0, caps: null });
  });

  it("buying a plan unlocks at once: active, writable, trial no longer active", () => {
    const a = deriveAccess({
      ...base,
      now: at(15),
      trialStartedAt: T0,
      trialEndsAt: at(14),
      trialSource: "signup",
      planSubscription: { status: "active", graceUntil: null },
      everHadPlanSubscription: true,
    });
    expect(a).toMatchObject({ state: "active", readOnly: false, reason: null });
    expect(a.trial).toMatchObject({ active: false, ended: false, caps: null });
    // add-ons come from what was bought, not from the trial
    expect(a.addons).toEqual({ ai_assistant: false, ai_plus: false, payroll: false, store_pro: false });
  });

  it("a trial that was never granted (source none, ended at once) is read-only", () => {
    const a = deriveAccess({ ...base, now: at(1), trialStartedAt: at(0), trialEndsAt: at(0), trialSource: "none" });
    expect(a).toMatchObject({ state: "trial_expired", readOnly: true });
    expect(a.trial).toMatchObject({ source: "none", active: false, ended: true });
  });

  it("grandfathered organisations have no trial, whatever the row says", () => {
    const a = deriveAccess({ ...base, now: at(1), trialEndsAt: at(14), trialSource: "signup", accessGrandfathered: true });
    expect(a.state).toBe("grandfathered");
    expect(a.trial).toMatchObject({ active: false, caps: null });
  });

  it("the read-only message starts with the spec wording", () => {
    const a = deriveAccess({ ...base, now: at(15), trialEndsAt: at(14) });
    expect(a.reason).toBe("read_only_trial_expired");
  });
});
