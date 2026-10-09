/**
 * The AI assistant searches a generated copy of the help centre's index
 * (packages/shared/src/help-index.generated.ts) because the API must not read
 * the web app's source at runtime. This test fails when an article was added,
 * renamed or edited (title, description, headings, steps) without regenerating it:
 *
 *   pnpm --filter @fintranzact/web gen:help-index
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP_INDEX } from "@fintranzact/shared";
import { HELP_INDEX_OUTPUT, buildHelpIndex, renderHelpIndexModule } from "../../scripts/help-index-lib";
import { HELP_SLUGS } from "@/lib/help-paths";

describe("generated help index for the AI assistant", () => {
  it("is up to date with src/content/help (run: pnpm --filter @fintranzact/web gen:help-index)", () => {
    const expected = renderHelpIndexModule(buildHelpIndex());
    const actual = readFileSync(HELP_INDEX_OUTPUT, "utf-8");
    expect(actual === expected, "packages/shared/src/help-index.generated.ts is stale: run `pnpm --filter @fintranzact/web gen:help-index` and commit it").toBe(true);
  });

  it("lists exactly the articles in the table of contents, each with a title and summary", () => {
    expect(HELP_INDEX.map((e) => e.slug).sort()).toEqual([...HELP_SLUGS].sort());
    for (const e of HELP_INDEX) {
      expect(e.title, e.slug).not.toBe("");
      if (e.slug !== "") expect(e.summary.length, `${e.slug} needs a description`).toBeGreaterThan(20);
      expect(e.summary.length).toBeLessThanOrEqual(220);
      expect(e.headings.length).toBeLessThanOrEqual(14);
      expect(e.steps.length).toBeLessThanOrEqual(8);
    }
  });

  it("builds the platform tag from the ForDesktop / ForMobile blocks", () => {
    const bySlug = new Map(buildHelpIndex().map((e) => [e.slug, e]));
    expect(bySlug.get("ai/ask-fintranzact-ai")?.platform).toBe("web"); // web only today
    expect(bySlug.get("invoicing/create-invoice")?.platform).toBe("web_and_mobile");
    expect(bySlug.get("faq")?.platform).toBe("any");
  });

  it("keeps article text out of the index except titles, descriptions, headings and the first numbered steps", () => {
    const text = readFileSync(HELP_INDEX_OUTPUT, "utf-8");
    expect(text.length).toBeLessThan(150_000);
    expect(text).not.toContain("<ForDesktop");
    expect(text).not.toContain("import {");
  });
});
