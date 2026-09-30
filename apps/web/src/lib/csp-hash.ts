/**
 * Build-time only (imported by vite.config.ts and tests, never by the app):
 * CSP hashes for the inline <script> blocks in index.html.
 *
 * The CSP meta tag allows inline scripts by hash. Hard-coding that hash let it
 * drift from index.html, and the browser then refused to run the theme script
 * (every page logged a CSP violation). Deriving it from the file keeps the two
 * in step.
 */
import { createHash } from "node:crypto";

/** `sha256-…` source expressions for every inline (src-less) script in `html`. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    hashes.push(`sha256-${createHash("sha256").update(m[2]).digest("base64")}`);
  }
  return hashes;
}
