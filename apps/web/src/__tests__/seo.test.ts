/**
 * Search-engine files: the sitemap is generated from MARKETING_PATHS, and
 * public/robots.txt must block every app route while leaving the marketing
 * pages crawlable. Reading src/routes here keeps robots.txt from drifting
 * when a new app screen is added.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETING_PATHS } from "@/lib/public-paths";
import { DEFAULT_SITE_URL, absoluteUrl, buildSitemap, resolveSiteUrl, sitemapPaths } from "@/lib/seo";

const WEB_ROOT = path.resolve(__dirname, "../..");
const robots = readFileSync(path.join(WEB_ROOT, "public/robots.txt"), "utf-8");
const disallowed = robots
  .split(/\r?\n/)
  .filter((line) => line.startsWith("Disallow:"))
  .map((line) => line.slice("Disallow:".length).trim());

/** Top-level route segments that are public but not marketing pages. */
const OTHER_PUBLIC = new Set(["index", "__root", "register"]);

describe("resolveSiteUrl", () => {
  it("falls back to the production URL", () => {
    expect(resolveSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("")).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("not a url")).toBe(DEFAULT_SITE_URL);
  });

  it("drops a trailing slash", () => {
    expect(resolveSiteUrl("https://www.example.in/")).toBe("https://www.example.in");
  });
});

describe("sitemap", () => {
  const xml = buildSitemap("https://www.example.in");

  it("lists the home page and every marketing page", () => {
    expect(xml).toContain("<loc>https://www.example.in/</loc>");
    for (const p of MARKETING_PATHS) {
      expect(xml).toContain(`<loc>https://www.example.in${p}</loc>`);
    }
    expect(xml.match(/<url>/g)).toHaveLength(MARKETING_PATHS.length + 1);
  });

  it("builds canonical URLs without query, hash or trailing slash", () => {
    expect(absoluteUrl("https://x.in", "/pricing/?a=1#plans")).toBe("https://x.in/pricing");
    expect(absoluteUrl("https://x.in", "/")).toBe("https://x.in/");
  });
});

describe("robots.txt", () => {
  it("points at the sitemap on the production URL (swapped for VITE_SITE_URL at build)", () => {
    expect(robots).toContain(`Sitemap: ${DEFAULT_SITE_URL}/sitemap.xml`);
  });

  it("never blocks a marketing page", () => {
    for (const page of sitemapPaths()) {
      const blockedBy = disallowed.filter((rule) => rule && page.startsWith(rule));
      expect(blockedBy, `${page} is blocked`).toEqual([]);
    }
  });

  it("blocks shared links, invitations and sign-in pages", () => {
    for (const rule of ["/i/", "/invite/", "/auth/", "/login"]) {
      expect(disallowed).toContain(rule);
    }
  });

  it("blocks every app route in src/routes", () => {
    const routesDir = path.join(WEB_ROOT, "src/routes");
    const segments = readdirSync(routesDir, { withFileTypes: true }).map((entry) =>
      entry.isDirectory() ? entry.name : entry.name.replace(/\.tsx?$/, ""),
    );
    const missing = segments.filter((segment) => {
      if (OTHER_PUBLIC.has(segment) || sitemapPaths().includes(`/${segment}`)) return false;
      return !disallowed.some((rule) => `/${segment}/`.startsWith(rule));
    });
    expect(missing, "add a Disallow line to public/robots.txt").toEqual([]);
  });
});
