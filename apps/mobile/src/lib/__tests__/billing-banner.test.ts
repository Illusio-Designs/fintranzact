import { bannerFor, type BillingStatusLike } from "../billing-banner";

const base: BillingStatusLike = {
  state: "active",
  readOnly: false,
  reason: null,
  message: null,
  trialDaysLeft: null,
  graceUntil: null,
  canManageBilling: true,
};
const TODAY = "2026-10-02";

describe("bannerFor", () => {
  it("renders nothing for free, active, unknown status", () => {
    expect(bannerFor(undefined)).toBeNull();
    expect(bannerFor({ ...base, state: "free" })).toBeNull();
    expect(bannerFor(base)).toBeNull();
  });

  it("suspended is a blocking danger banner with no action", () => {
    const b = bannerFor({ ...base, state: "suspended", readOnly: true, message: "Suspended." });
    expect(b).toMatchObject({ kind: "suspended", tone: "danger", cta: null, dismissible: false, text: "Suspended." });
  });

  it.each([
    ["halted", "read_only_halted", "Your last payment did not go through."],
    ["ended", "read_only_subscription_ended", "Your plan has ended."],
  ])("read-only (%s) for an owner offers 'Choose a plan'", (state, reason, lead) => {
    const b = bannerFor({ ...base, state, readOnly: true, reason });
    expect(b?.title).toBe(lead);
    expect(b?.text).toBe("You can view, search and download, but not create or edit. Choose a plan.");
    expect(b?.cta).toBe("Choose a plan");
  });

  it("read-only for a non-owner has no CTA and asks the owner", () => {
    const b = bannerFor({ ...base, state: "halted", readOnly: true, reason: "read_only_halted", canManageBilling: false });
    expect(b?.cta).toBeNull();
    expect(b?.text).toContain("Ask your organisation owner to choose a plan");
  });

  it("past_due grace shows days left", () => {
    const mk = (graceUntil: string) => bannerFor({ ...base, state: "past_due_grace", graceUntil }, { today: TODAY });
    expect(mk("2026-10-05T10:00:00Z")?.text).toContain("in 3 days");
    expect(mk("2026-10-03T10:00:00Z")?.text).toContain("in 1 day ");
    expect(mk("2026-10-02T23:00:00")?.text).toContain("today");
    expect(mk("2026-10-05T10:00:00Z")).toMatchObject({ tone: "warning", cta: "Update payment" });
  });

  const trial = (daysLeft: number, over: object = {}) => ({ active: true, daysLeft, source: "signup", totalDays: 14, ...over });

  it("trial countdown from day one: calm, then amber at 3 days or fewer, dismissible per day only while calm", () => {
    const t = (days: number, dismissedDay: string | null = null, over: object = {}) =>
      bannerFor({ ...base, state: "trialing", trialDaysLeft: days, trial: trial(days), ...over }, { today: TODAY, dismissedDay });
    expect(t(14)).toMatchObject({ kind: "trial", tone: "info", dismissible: true, title: "14 days left in your Full Access Trial", cta: "Choose a plan" });
    expect(t(9)?.title).toBe("9 days left in your Full Access Trial");
    expect(t(3)).toMatchObject({ tone: "warning", dismissible: false });
    expect(t(1)?.title).toBe("1 day left in your Full Access Trial");
    expect(t(9, TODAY)).toBeNull();
    expect(t(9, "2026-10-01")).not.toBeNull();
    // too late to dismiss once it is amber
    expect(t(3, TODAY)).not.toBeNull();
  });

  it("a partner trial says so", () => {
    const b = bannerFor({ ...base, state: "trialing", trial: trial(30, { source: "partner", totalDays: 30 }) }, { today: TODAY });
    expect(b?.title).toBe("Your 30-day partner trial: 30 days left");
  });

  it("an ended trial is red, says Trial ended: read-only and offers Choose a plan", () => {
    const b = bannerFor({ ...base, state: "trial_expired", readOnly: true, reason: "read_only_trial_expired", trial: trial(0, { active: false }) });
    expect(b).toMatchObject({ kind: "read_only", tone: "danger", title: "Trial ended: read-only", cta: "Choose a plan", dismissible: false });
    expect(b?.text).toContain("Your trial has ended. Choose a plan to continue.");
  });

  it("a trial that was never granted shows the already-used message", () => {
    const b = bannerFor({
      ...base, state: "trial_expired", readOnly: true, reason: "read_only_trial_expired",
      trial: trial(0, { active: false, source: "none" }),
      trialMessage: "A free trial was already used for this email, phone or GSTIN. Choose a plan to continue.",
    });
    expect(b?.text).toContain("A free trial was already used");
  });

  it("no trial banner for paid or grandfathered organisations", () => {
    expect(bannerFor({ ...base, state: "active", trial: trial(5, { active: false }) })).toBeNull();
    expect(bannerFor({ ...base, state: "grandfathered", trial: trial(5, { active: false }) })).toBeNull();
  });
});
