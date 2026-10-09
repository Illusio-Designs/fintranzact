/**
 * vercel-headers.test.ts — the response headers vercel.json adds to the web app's pages, and a
 * guard that adding them did not change the redirects or the SPA/API rewrites.
 * (Strict-Transport-Security is added by Vercel itself on its domains.) Notes: docs/security/.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface VercelConfig {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  rewrites: Array<{ source: string; destination: string }>;
  redirects: unknown[];
}

const cfg = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vercel.json"), "utf8"),
) as VercelConfig;

describe("apps/web/vercel.json", () => {
  const rule = cfg.headers.find((h) => h.source === "/((?!api/).*)")!;
  const value = (key: string) => rule.headers.find((h) => h.key === key)?.value;

  it("sets the page headers", () => {
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value("Permissions-Policy")).toBe("camera=(self), microphone=(self), geolocation=(self)");
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'self'");
  });

  it("keeps the API proxy rewrite first and the SPA fallback second, and the redirects", () => {
    expect(cfg.rewrites).toEqual([
      { source: "/api/:path*", destination: "https://fintranzact-production.up.railway.app/api/:path*" },
      { source: "/((?!api/).*)", destination: "/index.html" },
    ]);
    expect(cfg.redirects).toHaveLength(4);
  });

  it("does not put page headers on the proxied /api responses", () => {
    expect(new RegExp(`^${rule.source}$`).test("/api/trpc/x")).toBe(false);
    expect(new RegExp(`^${rule.source}$`).test("/invoices")).toBe(true);
  });
});
