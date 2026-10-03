/**
 * Pure two-factor display helpers shared by web, desktop and mobile: input
 * formatting, reading the server's lockout message, and the backup-codes text.
 */

/** Keep digits only, at most six: what the authenticator-app field accepts (paste friendly). */
export function formatTotpInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/**
 * Auto-format a typed or pasted backup code as XXXXXX-XXXXXX: upper-case,
 * letters and digits only, 12 characters, a dash after the sixth.
 */
export function formatBackupCodeInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return clean.length > 6 ? `${clean.slice(0, 6)}-${clean.slice(6)}` : clean;
}

/** A complete backup code: 12 letters/digits (the dash is optional on input). */
export function isCompleteBackupCode(value: string): boolean {
  return value.replace(/[^A-Za-z0-9]/g, "").length === 12;
}

/** Pulls the unlock time out of the server's "...(after 2026-01-01T00:00:00.000Z)" message. */
export function parseUnlockTime(message: string): Date | null {
  const m = /\(after ([0-9T:.\-+Z]+)\)/.exec(message);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Too many attempts. Try again at 3:45 pm." (or a generic line when the time is unknown). */
export function lockedMessage(message: string): string {
  const until = parseUnlockTime(message);
  if (!until) return "Too many attempts. Try again later.";
  const time = until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = until.toDateString() === new Date().toDateString();
  const when = sameDay ? time : `${until.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
  return `Too many attempts. Try again at ${when}.`;
}

/** The text saved by "Download (.txt)": account, date, warning, then one code per line. */
export function backupCodesFileContent(codes: string[], email: string, now: Date = new Date()): string {
  return [
    "Fintranzact two-factor backup codes",
    `Account: ${email}`,
    `Generated: ${now.toISOString().slice(0, 10)}`,
    "",
    "Each code works once, in place of the code from your authenticator app.",
    "Keep this file somewhere safe and private. Anyone with these codes and your",
    "password can sign in to your account. Generating new codes makes these stop working.",
    "",
    ...codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`),
    "",
  ].join("\n");
}

export const BACKUP_CODES_FILENAME = "fintranzact-backup-codes.txt";

/** Group a manual key into blocks of four for display (the server already does; this is a fallback). */
export function groupKey(key: string): string {
  const compact = key.replace(/\s+/g, "");
  return compact.replace(/(.{4})/g, "$1 ").trim();
}

// ── Security activity (web and mobile lists) ────────────────────────────────

const ACTIVITY_METHOD_LABELS: Record<string, string> = {
  totp: "Authenticator app",
  backup_code: "Backup code",
  trusted_device: "Trusted device",
};

/** "Chrome 126 on macOS · 203.0.113.7 · Authenticator app": the parts that are present. */
export function securityActivityDetail(item: { device: string | null; ip: string | null; method: string | null }): string {
  return [item.device, item.ip, item.method ? (ACTIVITY_METHOD_LABELS[item.method] ?? item.method) : null]
    .filter((p): p is string => !!p)
    .join(" · ");
}

/** "just now", "5m ago", "3h ago", "2d ago", else a short date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
