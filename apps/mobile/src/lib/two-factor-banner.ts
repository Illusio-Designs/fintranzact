import dayjs from "dayjs";
import { twoFactorBannerText } from "@fintranzact/shared";
import type { BannerTone } from "./billing-banner";

export interface TwoFactorRequirementLike {
  required: boolean;
  blocked: boolean;
  graceEndsAt: Date | string | null;
}

export interface TwoFactorBannerSpec {
  kind: "grace" | "blocked";
  tone: BannerTone;
  title: string;
  text: string;
  cta: string;
}

/**
 * The two-factor notice to show, if any. Pure. `hasTwoFactor` (from auth.me)
 * wins over a stale requirement so the banner clears the moment setup finishes.
 */
export function twoFactorBannerFor(
  requirement: TwoFactorRequirementLike | null | undefined,
  opts: { hasTwoFactor?: boolean } = {},
): TwoFactorBannerSpec | null {
  if (!requirement || opts.hasTwoFactor) return null;
  const banner = twoFactorBannerText(
    { required: requirement.required, blocked: requirement.blocked, graceEndsAt: requirement.graceEndsAt ? new Date(requirement.graceEndsAt) : null },
    (d) => dayjs(d).format("D MMM YYYY"),
  );
  if (!banner) return null;
  return {
    kind: banner.kind,
    tone: banner.kind === "blocked" ? "danger" : "warning",
    title: banner.kind === "blocked" ? "Two-factor required." : "Two-factor authentication.",
    text: banner.text,
    cta: "Set up",
  };
}

/** True when the member is blocked (and has not just set 2FA up). */
export function isTwoFactorBlocked(
  requirement: TwoFactorRequirementLike | null | undefined,
  opts: { hasTwoFactor?: boolean } = {},
): boolean {
  return !!requirement && requirement.required && requirement.blocked && !opts.hasTwoFactor;
}
