/**
 * Links on the public site: every link opens its own page on this site. No
 * #anchor links to a section of another page, no hash= props, and nothing
 * pointing at the old docs.fintranzact.com or api-docs.fintranzact.com hosts
 * (the help centre and API reference now live at /help and /developers).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MENUS } from "@/components/marketing/SiteHeader";
import { FEATURE_SLUGS } from "@/lib/feature-slugs";
import { FEATURES } from "@/lib/solutions-content";
import { MARKETING_PATHS, isMarketingPath } from "@/lib/public-paths";
import { sitemapPaths } from "@/lib/seo";
import { PARTNER_PROGRAMS, parsePartnerType } from "@/lib/partner-programs";

const SRC = path.resolve(__dirname, "..");

/** Source files of the public pages and the components they are built from. */
const PUBLIC_SOURCES = [
  "components/LandingPage.tsx",
  "components/marketing",
  "components/help",
  "components/developers",
  "lib/solutions-content.ts",
  "lib/partner-programs.ts",
  "lib/security-disclosure.ts",
  "routes/about.tsx",
  "routes/contact.tsx",
  "routes/pricing.tsx",
  "routes/privacy.tsx",
  "routes/terms.tsx",
  "routes/refund-policy.tsx",
  "routes/widgets.tsx",
  "routes/find-a-partner.tsx",
  "routes/partner-portal.tsx",
  "routes/features",
  "routes/partners",
  "routes/security",
  "routes/solutions",
  "routes/help",
  "routes/developers",
];

/**
 * routes/features.tsx is the old single features page with an in-page table
 * of contents. The feature-pages work replaces it with routes/features/index.tsx
 * and one page per feature; this exception does nothing once that file is gone.
 */
const LEGACY = new Set(["routes/features.tsx"]);

function sourceFiles(rel: string): string[] {
  const full = path.join(SRC, rel);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [rel];
  return readdirSync(full).flatMap((entry) => sourceFiles(path.join(rel, entry).split(path.sep).join("/")));
}

const FILES = PUBLIC_SOURCES.flatMap(sourceFiles).filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__"));

/** Patterns that mean "a section of a page" or the retired docs hosts. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['href="#…"', /href=\{?["'`]#/],
  ["hash= prop", /\bhash=\{?["'`]?/],
  ['to="…#…"', /\bto=\{?["'`][^"'`]*#/],
  ["docs.fintranzact.com", /\bdocs\.fintranzact\.com/],
  ["api-docs.fintranzact.com", /api-docs\.fintranzact\.com/],
];

describe("public pages link to pages, not sections", () => {
  it("scans the public page sources", () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it("has no #anchor links, hash props or old docs hosts", () => {
    const problems: string[] = [];
    for (const file of FILES) {
      if (LEGACY.has(file)) continue;
      const lines = readFileSync(path.join(SRC, file), "utf-8").split("\n");
      lines.forEach((line, i) => {
        // The docs hosts may be named in a comment explaining they were retired.
        if (/^\s*(\/\/|\/?\*)/.test(line)) return;
        for (const [label, pattern] of FORBIDDEN) {
          if (pattern.test(line)) problems.push(`${file}:${i + 1} ${label}`);
        }
      });
    }
    expect(problems).toEqual([]);
  });
});

describe("header menus", () => {
  const allLinks = MENUS.flatMap((menu) => menu.columns.flatMap((column) => column.links));
  const featureLinks = MENUS.find((m) => m.id === "features")!.columns.flatMap((c) => c.links);

  it("sends every Features item to its own feature page", () => {
    const slugs = featureLinks.map((link) => {
      expect(link.to, link.label).toMatch(/^\/features\/[a-z0-9-]+$/);
      return link.to!.replace("/features/", "");
    });
    // Every feature page is in the menu exactly once.
    expect([...slugs].sort()).toEqual([...FEATURE_SLUGS].sort());
  });

  it("keeps internal links on this site and never uses a #section", () => {
    for (const link of allLinks) {
      const target = link.to ?? link.href ?? "";
      expect(target, link.label).not.toContain("#");
      if (link.href) expect(link.href, link.label).toMatch(/^(mailto:|https?:\/\/)/);
    }
  });

  it("opens help and the API reference on this site", () => {
    const byLabel = new Map(allLinks.map((link) => [link.label, link]));
    expect(byLabel.get("Help & docs")?.to).toBe("/help");
    expect(byLabel.get("API docs")?.to).toBe("/developers");
    expect(byLabel.get("Report a vulnerability")?.to).toBe("/security/report");
  });
});

describe("solutions feature cards", () => {
  it("point at a real feature page", () => {
    for (const [id, feature] of Object.entries(FEATURES)) {
      expect(FEATURE_SLUGS, id).toContain(feature.page);
    }
  });
});

describe("partner application and vulnerability report pages", () => {
  it("are public marketing pages listed in the sitemap", () => {
    for (const p of ["/partners/apply", "/security/report"]) {
      expect(MARKETING_PATHS).toContain(p);
      expect(isMarketingPath(p)).toBe(true);
      expect(isMarketingPath(`${p}/`)).toBe(true);
      expect(sitemapPaths()).toContain(p);
    }
  });

  it("security.txt points at the report page", () => {
    const securityTxt = readFileSync(path.resolve(SRC, "../public/.well-known/security.txt"), "utf-8");
    expect(securityTxt).toMatch(/^Policy: https:\/\/\S+\/security\/report$/m);
  });

  it("preselects the programme from ?type= and ignores anything else", () => {
    for (const program of PARTNER_PROGRAMS) expect(parsePartnerType(program.id)).toBe(program.id);
    expect(parsePartnerType("admin")).toBeUndefined();
    expect(parsePartnerType(undefined)).toBeUndefined();
    expect(parsePartnerType(["accountant"])).toBeUndefined();
  });
});
