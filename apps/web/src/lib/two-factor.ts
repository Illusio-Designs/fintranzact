/**
 * Small pure helpers for the two-factor screens: input formatting, the
 * backup-codes text file, and reading the server's lockout message.
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

/** Save text as a file in the browser (client side only, nothing is uploaded). */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Open the browser's print dialog with just the codes on the page. Returns false if a popup blocker stopped it. */
export function printBackupCodes(codes: string[], email: string): boolean {
  const w = window.open("", "_blank", "noopener=no,width=640,height=720");
  if (!w) return false;
  w.document.write(
    `<!doctype html><title>Fintranzact backup codes</title>` +
      `<body style="font-family:system-ui,sans-serif;padding:32px">` +
      `<h1 style="font-size:20px">Fintranzact two-factor backup codes</h1>` +
      `<p>Account: ${escapeHtml(email)}<br>Generated: ${new Date().toISOString().slice(0, 10)}</p>` +
      `<p>Each code works once. Keep this page somewhere safe and private.</p>` +
      `<ol style="font:18px/2 ui-monospace,Menlo,monospace">${codes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol></body>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}
