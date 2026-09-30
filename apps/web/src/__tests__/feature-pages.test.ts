/**
 * Public feature pages (/features/<slug>): the slug list in lib/feature-slugs
 * drives the sitemap, and lib/feature-pages holds the content. These checks
 * keep the two in step and make sure every link between pages resolves.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_PAGES, featurePage } from "@/lib/feature-pages";
import { FEATURE_PAGE_PATHS, FEATURE_SLUGS } from "@/lib/feature-slugs";
import { isMarketingPath } from "@/lib/public-paths";
import { sitemapPaths } from "@/lib/seo";

const HELP_DIR = path.resolve(__dirname, "../content/help");
const known = new Set<string>(FEATURE_SLUGS);

/** "/help/gst/e-invoicing" → the .mdx file (or folder index) that serves it. */
function helpFileExists(helpPath: string) {
  const rel = helpPath.replace(/^\/help\/?/, "");
  if (!rel) return existsSync(path.join(HELP_DIR, "index.mdx"));
  return existsSync(path.join(HELP_DIR, `${rel}.mdx`)) || existsSync(path.join(HELP_DIR, rel, "index.mdx"));
}

describe("feature pages that exist", () => {
  it("each has a known slug, and no slug is used twice", () => {
    const slugs = FEATURE_PAGES.map((p) => p.slug);
    for (const slug of slugs) expect(known.has(slug), `${slug} is not in FEATURE_SLUGS`).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("link only to feature pages that are in FEATURE_SLUGS, never to themselves", () => {
    for (const page of FEATURE_PAGES) {
      for (const slug of page.related) {
        expect(known.has(slug), `${page.slug} → ${slug}`).toBe(true);
        expect(slug, `${page.slug} lists itself`).not.toBe(page.slug);
      }
    }
  });

  it("have the content the page layout expects", () => {
    for (const page of FEATURE_PAGES) {
      const at = page.slug;
      expect(page.summary.length, `${at} summary length`).toBeGreaterThanOrEqual(120);
      expect(page.summary.length, `${at} summary length`).toBeLessThanOrEqual(160);
      expect(page.highlights.length, `${at} highlights`).toBeGreaterThanOrEqual(4);
      expect(page.highlights.length, `${at} highlights`).toBeLessThanOrEqual(6);
      expect(page.steps.length, `${at} steps`).toBeGreaterThanOrEqual(3);
      expect(page.steps.length, `${at} steps`).toBeLessThanOrEqual(5);
      expect(page.details.length, `${at} details`).toBeGreaterThanOrEqual(2);
      expect(page.details.length, `${at} details`).toBeLessThanOrEqual(4);
      expect(page.faqs.length, `${at} faqs`).toBeGreaterThanOrEqual(3);
      expect(page.faqs.length, `${at} faqs`).toBeLessThanOrEqual(6);
      expect(page.related.length, `${at} related`).toBeGreaterThanOrEqual(2);
      expect(page.related.length, `${at} related`).toBeLessThanOrEqual(4);
    }
  });

  it("point at help articles that exist", () => {
    for (const page of FEATURE_PAGES) {
      if (page.helpPath) expect(helpFileExists(page.helpPath), `${page.slug} → ${page.helpPath}`).toBe(true);
    }
  });

  it("never link to a #section of a page", () => {
    for (const page of FEATURE_PAGES) {
      expect(page.helpPath ?? "", page.slug).not.toContain("#");
    }
  });

  it("featurePage finds a page by slug and returns nothing for an unknown one", () => {
    for (const page of FEATURE_PAGES) expect(featurePage(page.slug)).toBe(page);
    expect(featurePage("no-such-feature")).toBeUndefined();
  });
});

describe("feature pages are public and in the sitemap", () => {
  it("serves /features and every /features/<slug> with the marketing layout", () => {
    expect(isMarketingPath("/features")).toBe(true);
    for (const p of FEATURE_PAGE_PATHS) expect(isMarketingPath(p), p).toBe(true);
    expect(isMarketingPath("/features/")).toBe(true);
  });

  it("lists every feature page in the sitemap", () => {
    const paths = sitemapPaths();
    for (const p of FEATURE_PAGE_PATHS) expect(paths).toContain(p);
  });
});

// Passes once the sales-money, gst-platform and inventory data files are all
// merged; each is written separately.
describe("feature page coverage", () => {
  it("has exactly one page for every slug in FEATURE_SLUGS", () => {
    const covered = FEATURE_PAGES.map((p) => p.slug).sort();
    expect(covered).toEqual([...FEATURE_SLUGS].sort());
  });
});
