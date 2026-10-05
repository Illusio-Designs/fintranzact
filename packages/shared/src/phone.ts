/**
 * Indian mobile numbers, shared by the sign-up forms (web and mobile), the
 * API and the one-trial-per-business check, so everyone accepts and compares
 * the same thing.
 *
 * A mobile number is 10 digits starting 6, 7, 8 or 9. People type it with a
 * "+91", "91" or "0" in front and with spaces, dashes or brackets; all of
 * that is accepted and removed. What is stored and compared is the 10 digits.
 */

/** Shown under the phone field on every sign-up form. */
export const PHONE_HELP_TEXT =
  "Used to keep one free trial per business and for account recovery. Never shared.";

export const PHONE_INVALID_MESSAGE = "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.";
export const PHONE_REQUIRED_MESSAGE = "Enter your mobile number.";

const MOBILE_RE = /^[6-9][0-9]{9}$/;

/**
 * The 10-digit mobile number, or null when `raw` is not an Indian mobile.
 * Accepts "+91 98765 43210", "09876543210", "91-9876543210", "(98765) 43210".
 */
export function normaliseIndianMobile(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Only digits and the usual separators; a letter means it is not a number.
  const compact = trimmed.replace(/[\s().-]/g, "");
  // A "+" is only allowed in front, and only for +91.
  if (!/^\+?[0-9]+$/.test(compact)) return null;
  const digits = compact.replace(/\D/g, "");
  let national: string;
  if (compact.startsWith("+")) {
    if (!digits.startsWith("91") || digits.length !== 12) return null;
    national = digits.slice(2);
  } else if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith("0")) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91")) national = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith("091")) national = digits.slice(3);
  else return null;
  return MOBILE_RE.test(national) ? national : null;
}

export function isValidIndianMobile(raw: string | null | undefined): boolean {
  return normaliseIndianMobile(raw) !== null;
}

/** "9876543210" as "+91 98765 43210"; anything that is not a valid mobile is returned unchanged. */
export function formatIndianMobile(raw: string | null | undefined): string {
  const n = normaliseIndianMobile(raw);
  if (!n) return raw ?? "";
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

/**
 * What a sign-up form shows under the field, or null when the value is fine.
 * `required` is true on the forms (the API field stays optional).
 */
export function phoneFieldError(raw: string | null | undefined, opts: { required?: boolean } = {}): string | null {
  const value = (raw ?? "").trim();
  if (!value) return opts.required ? PHONE_REQUIRED_MESSAGE : null;
  return normaliseIndianMobile(value) ? null : PHONE_INVALID_MESSAGE;
}
