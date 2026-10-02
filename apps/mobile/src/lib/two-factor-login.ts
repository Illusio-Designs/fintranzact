/**
 * Pure mapping from a tRPC failure on `auth.verifyTwoFactor` to what the
 * sign-in second step should do (docs/TWO-FACTOR.md, "Error codes").
 *  - wrong:   stay on the code screen, clear the field, show the message
 *  - expired: the challenge is gone, go back to the password step
 *  - locked:  stay, disable the form, show "Too many attempts. Try again at ..."
 */
import { lockedMessage } from "@fintranzact/shared";

export type TwoFactorFailure =
  | { kind: "wrong"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "locked"; message: string };

export const WRONG_CODE_FALLBACK = "That code is not right. Check the code and try again.";
const EXPIRED_RE = /sign-in has expired|enter your password again/i;

export function mapVerifyError(error: unknown): TwoFactorFailure {
  const e = (error ?? {}) as { message?: string; data?: { code?: string } | null };
  const message = typeof e.message === "string" ? e.message : "";
  if (e.data?.code === "TOO_MANY_REQUESTS") return { kind: "locked", message: lockedMessage(message) };
  if (EXPIRED_RE.test(message)) return { kind: "expired", message };
  return { kind: "wrong", message: message || WRONG_CODE_FALLBACK };
}

/**
 * A login that carried a trusted-device token but still returned a challenge
 * means the token is expired or revoked: it should be dropped.
 */
export function shouldClearTrustedToken(sentToken: string | null | undefined, twoFactorRequired: boolean): boolean {
  return !!sentToken && twoFactorRequired;
}
