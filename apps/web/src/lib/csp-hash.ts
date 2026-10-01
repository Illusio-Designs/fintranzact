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

/**
 * The page's Content-Security-Policy directives. `inlineScriptSources` are
 * the quoted hashes from `inlineScriptHashes`.
 */
export function cspDirectives(opts: { isDev: boolean; apiOrigin: string | null; inlineScriptSources: string }): string[] {
  const { isDev, apiOrigin, inlineScriptSources } = opts;
  // When API_URL is set the app calls the API directly (not via the
  // /api proxy), so its origin must be allowed in dev as well as prod.
  const connectSrc = isDev
    ? `connect-src 'self' ws:${apiOrigin ? ` ${apiOrigin}` : ""}`
    : apiOrigin
      ? `connect-src 'self' ${apiOrigin}`
      : "connect-src 'self'";
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptSources} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    connectSrc,
    // blob: — the POS prints its thermal receipt from a PDF the app fetched,
    // loaded into a hidden iframe as a blob: URL.
    "frame-src 'self' blob: https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
  ];
}
