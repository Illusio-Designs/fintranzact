/**
 * The old documentation domains are sent to their new homes in the app with
 * permanent (301) redirects configured in vercel.json: docs.fintranzact.com
 * to /help and api-docs.fintranzact.com to /developers, keeping the path.
 *
 * Vercel's `permanent: true` means 308, so the rules use `statusCode: 301`.
 * Each rule is limited to its host, so the app's own pages are never redirected.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SITE_URL } from "../lib/seo";

interface Rule {
  source: string;
  destination: string;
  statusCode?: number;
  permanent?: boolean;
  has?: Array<{ type: string; value: string }>;
}

const config = JSON.parse(readFileSync(resolve(__dirname, "../../vercel.json"), "utf8")) as { redirects: Rule[]; rewrites: Array<{ source: string }> };

const OLD_HOSTS: Array<[host: string, target: string]> = [
  ["docs.fintranzact.com", "help"],
  ["api-docs.fintranzact.com", "developers"],
];

describe("old documentation domains redirect", () => {
  for (const [host, target] of OLD_HOSTS) {
    const rules = config.redirects.filter((r) => r.has?.some((h) => h.type === "host" && h.value === host));

    it(`${host} → /${target}: root and every path, as 301`, () => {
      expect(rules.map((r) => r.source)).toEqual(["/", "/:path*"]);
      expect(rules.map((r) => r.destination)).toEqual([`${DEFAULT_SITE_URL}/${target}`, `${DEFAULT_SITE_URL}/${target}/:path*`]);
      for (const r of rules) {
        expect(r.statusCode).toBe(301);
        expect(r.permanent).toBeUndefined();
      }
    });
  }

  it("only the old hosts are redirected, never the app's own pages", () => {
    for (const r of config.redirects) {
      expect(r.has?.length, `${r.source} must be limited to a host`).toBeGreaterThan(0);
      expect(OLD_HOSTS.map(([h]) => h)).toContain(r.has![0]!.value);
    }
  });

  it("the app's own rewrites are untouched", () => {
    expect(config.rewrites.map((r) => r.source)).toEqual(["/api/:path*", "/((?!api/).*)"]);
  });
});
