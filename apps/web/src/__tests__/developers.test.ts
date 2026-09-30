/**
 * The API reference at /developers: the UI-free path list (used by the
 * sitemap and the public-page check) must match the content, and every
 * cross-link inside the content must point at a page that exists.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEVELOPER_GROUP_SLUGS,
  DEVELOPER_GUIDE_SLUGS,
  DEVELOPER_PAGE_PATHS,
  isDeveloperPath,
} from "@/lib/developer-paths";
import { isMarketingPath } from "@/lib/public-paths";
import { sitemapPaths } from "@/lib/seo";
import { allEndpointGroups, endpointById, groupById } from "@/content/developers";
import { FAQ_ITEMS } from "@/components/developers/faq";
import { GUIDES } from "@/components/developers/guides";
import { PERSONAS } from "@/components/developers/persona";

describe("developer page list", () => {
  it("lists every endpoint group, in sidebar order", () => {
    expect([...DEVELOPER_GROUP_SLUGS]).toEqual(allEndpointGroups.map((g) => g.id));
  });

  it("has a route file and a sidebar entry for every guide", () => {
    const routesDir = path.resolve(__dirname, "../routes/developers");
    const files = readdirSync(routesDir).map((f) => f.replace(/(\.lazy)?\.tsx$/, ""));
    for (const slug of DEVELOPER_GUIDE_SLUGS) expect(files).toContain(slug);
    expect(GUIDES.map((g) => g.slug)).toEqual([...DEVELOPER_GUIDE_SLUGS]);
  });

  it("never lets a guide slug clash with an endpoint group", () => {
    for (const slug of DEVELOPER_GUIDE_SLUGS) expect(groupById.has(slug)).toBe(false);
  });

  it("puts the overview, guides and groups in the sitemap", () => {
    const paths = sitemapPaths();
    expect(DEVELOPER_PAGE_PATHS).toHaveLength(1 + DEVELOPER_GUIDE_SLUGS.length + DEVELOPER_GROUP_SLUGS.length);
    for (const p of DEVELOPER_PAGE_PATHS) expect(paths).toContain(p);
    expect(paths).toContain("/developers/invoices");
  });

  it("treats /developers and everything under it as public", () => {
    for (const p of ["/developers", "/developers/", "/developers/faq", "/developers/invoices/invoice-create"]) {
      expect(isDeveloperPath(p)).toBe(true);
      expect(isMarketingPath(p)).toBe(true);
    }
    expect(isDeveloperPath("/developer")).toBe(false);
    expect(isDeveloperPath("/developersx")).toBe(false);
    expect(isMarketingPath("/invoices")).toBe(false);
  });
});

describe("developer content", () => {
  it("gives every endpoint a unique id", () => {
    const ids = allEndpointGroups.flatMap((g) => g.endpoints.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only links related endpoints that exist", () => {
    const missing = allEndpointGroups.flatMap((g) =>
      g.endpoints.flatMap((e) => (e.relatedEndpoints ?? []).filter((id) => !endpointById.has(id)).map((id) => `${e.id} -> ${id}`)),
    );
    expect(missing).toEqual([]);
  });

  it("points FAQ answers and personas at real endpoint groups", () => {
    for (const item of FAQ_ITEMS) for (const id of item.relatedGroups) expect(groupById.has(id), id).toBe(true);
    for (const persona of PERSONAS) for (const id of persona.highlightedGroups) expect(groupById.has(id), id).toBe(true);
  });
});
