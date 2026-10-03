import { isTwoFactorBlocked, twoFactorBannerFor } from "../two-factor-banner";

const grace = { required: true, blocked: false, graceEndsAt: new Date("2026-07-01T00:00:00Z") };
const blocked = { required: true, blocked: true, graceEndsAt: new Date("2026-06-01T00:00:00Z") };

describe("twoFactorBannerFor", () => {
  it("renders nothing without a requirement, when not required, or once 2FA is on", () => {
    expect(twoFactorBannerFor(null)).toBeNull();
    expect(twoFactorBannerFor(undefined)).toBeNull();
    expect(twoFactorBannerFor({ required: false, blocked: false, graceEndsAt: null })).toBeNull();
    expect(twoFactorBannerFor(grace, { hasTwoFactor: true })).toBeNull();
    expect(twoFactorBannerFor(blocked, { hasTwoFactor: true })).toBeNull();
  });

  it("grace period: warning with the deadline and a Set up action", () => {
    const b = twoFactorBannerFor(grace);
    expect(b).toMatchObject({ kind: "grace", tone: "warning", cta: "Set up" });
    expect(b?.text).toBe("Your organisation requires two-factor authentication. Set it up by 1 Jul 2026.");
  });

  it("accepts the deadline as an ISO string", () => {
    expect(twoFactorBannerFor({ ...grace, graceEndsAt: "2026-07-01T00:00:00Z" })?.text).toContain("1 Jul 2026");
  });

  it("blocked: danger banner", () => {
    expect(twoFactorBannerFor(blocked)).toMatchObject({ kind: "blocked", tone: "danger" });
  });
});

describe("isTwoFactorBlocked", () => {
  it("only when required and blocked and 2FA is not on", () => {
    expect(isTwoFactorBlocked(blocked)).toBe(true);
    expect(isTwoFactorBlocked(grace)).toBe(false);
    expect(isTwoFactorBlocked(blocked, { hasTwoFactor: true })).toBe(false);
    expect(isTwoFactorBlocked(null)).toBe(false);
  });
});
