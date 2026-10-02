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
    ["trial_expired", "read_only_trial_expired", "Your trial has ended."],
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

  it("trial notice only in the last 7 days, dismissible per day", () => {
    const t = (days: number, dismissedDay: string | null = null) =>
      bannerFor({ ...base, state: "trialing", trialDaysLeft: days }, { today: TODAY, dismissedDay });
    expect(t(8)).toBeNull();
    expect(t(7)).toMatchObject({ kind: "trial", tone: "info", dismissible: true, title: "7 days left in your trial." });
    expect(t(1)?.title).toBe("1 day left in your trial.");
    expect(t(0)?.title).toBe("Your trial ends today.");
    expect(t(3, TODAY)).toBeNull();
    expect(t(3, "2026-10-01")).not.toBeNull();
  });
});
