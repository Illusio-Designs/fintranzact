/**
 * The help centre (/help): its table of contents must list every article on
 * disk, every article must be public and in the sitemap, and links inside the
 * articles must stay on this site with no #hash links.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_ENTRIES, HELP_PAGE_PATHS, HELP_SLUGS, helpPath, helpSlugFromPath, isHelpPath } from "@/lib/help-paths";
import { isMarketingPath } from "@/lib/public-paths";
import { buildSitemap, sitemapPaths } from "@/lib/seo";

const CONTENT_DIR = path.resolve(__dirname, "../content/help");

function articleFiles(dir = CONTENT_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? articleFiles(full) : entry.endsWith(".mdx") ? [full] : [];
  });
}

const FILES = articleFiles();
const slugOf = (file: string) =>
  path
    .relative(CONTENT_DIR, file)
    .split(path.sep)
    .join("/")
    .replace(/\.mdx$/, "")
    .replace(/(^|\/)index$/, "");

/** Article text with fenced code blocks removed (code samples may contain anything). */
function prose(file: string): string {
  return readFileSync(file, "utf-8").replace(/```[\s\S]*?```/g, "");
}

describe("help table of contents", () => {
  it("lists every article on disk exactly once", () => {
    expect(FILES.length).toBeGreaterThan(0);
    expect([...HELP_SLUGS].sort()).toEqual(FILES.map(slugOf).sort());
    expect(new Set(HELP_SLUGS).size).toBe(HELP_SLUGS.length);
  });

  it("starts with the help home page", () => {
    expect(HELP_ENTRIES[0].slug).toBe("");
    expect(HELP_PAGE_PATHS[0]).toBe("/help");
  });

  it("builds /help URLs", () => {
    expect(helpPath("")).toBe("/help");
    expect(helpPath("gst/e-invoicing")).toBe("/help/gst/e-invoicing");
    expect(helpPath("/invoicing/")).toBe("/help/invoicing");
    expect(helpSlugFromPath("/help/gst/gstr1/")).toBe("gst/gstr1");
    expect(helpSlugFromPath("/help")).toBe("");
    expect(helpSlugFromPath("/invoices")).toBeNull();
  });
});

describe("help pages are public", () => {
  it("treats /help and everything under it as a public marketing page", () => {
    for (const p of HELP_PAGE_PATHS) expect(isHelpPath(p), p).toBe(true);
    expect(isMarketingPath("/help")).toBe(true);
    expect(isMarketingPath("/help/")).toBe(true);
    expect(isMarketingPath("/help/gst/e-invoicing")).toBe(true);
    expect(isMarketingPath("/help/no-such-article")).toBe(true);
  });

  it("does not open up app routes that merely start with the same letters", () => {
    expect(isHelpPath("/helpdesk")).toBe(false);
    expect(isMarketingPath("/invoices")).toBe(false);
  });

  it("lists every help page in the sitemap", () => {
    const paths = sitemapPaths();
    for (const p of HELP_PAGE_PATHS) expect(paths).toContain(p);
    const xml = buildSitemap("https://www.example.in");
    expect(xml).toContain("<loc>https://www.example.in/help/inventory/stock-valuation</loc>");
  });
});

describe("help article content", () => {
  const known = new Set(HELP_PAGE_PATHS);

  it.each(FILES.map((f) => [slugOf(f) || "(home)", f]))("%s has a title and description", (_slug, file) => {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf-8"))?.[1] ?? "";
    expect(front).toMatch(/^title: \S/m);
    expect(front).toMatch(/^description: \S/m);
  });

  it("links only to help pages that exist", () => {
    const broken: string[] = [];
    for (const file of FILES) {
      for (const [, target] of prose(file).matchAll(/\]\((\/help[^)\s]*)\)/g)) {
        if (!known.has(target)) broken.push(`${slugOf(file)} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("has no #hash links and no links to the old docs sites", () => {
    const bad: string[] = [];
    for (const file of FILES) {
      const text = prose(file);
      for (const [link] of text.matchAll(/\]\([^)]*#[^)]*\)/g)) bad.push(`${slugOf(file)}: ${link}`);
      for (const [link] of text.matchAll(/(api-)?docs\.fintranzact\.com[^\s)]*/g)) bad.push(`${slugOf(file)}: ${link}`);
    }
    expect(bad).toEqual([]);
  });

  it("links to other site pages without a hard-coded host", () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const [link] of prose(file).matchAll(/\]\(https:\/\/fintranzact-web\.vercel\.app[^)]*\)/g)) {
        bad.push(`${slugOf(file)}: ${link}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("imports components from the web app, not the old Starlight site", () => {
    const bad = FILES.filter((f) => /^import .*(\.astro|@astrojs)/m.test(readFileSync(f, "utf-8"))).map(slugOf);
    expect(bad).toEqual([]);
  });
});
