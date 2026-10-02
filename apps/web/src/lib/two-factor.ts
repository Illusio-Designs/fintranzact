/**
 * Small helpers for the two-factor screens. The pure parts (input formatting,
 * lockout message, backup-codes text) live in @fintranzact/shared so mobile
 * uses the same code; they are re-exported here. The DOM helpers stay on web.
 */
export {
  formatTotpInput,
  formatBackupCodeInput,
  isCompleteBackupCode,
  parseUnlockTime,
  lockedMessage,
  backupCodesFileContent,
  BACKUP_CODES_FILENAME,
  groupKey,
} from "@fintranzact/shared";

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
