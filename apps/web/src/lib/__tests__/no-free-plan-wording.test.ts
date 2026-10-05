/**
 * There is no free plan. Customer-facing copy (the pricing page, sign-up and
 * plan picker, the home page, solution pages, the legal and about pages and
 * the whole help centre) must not promise one. A "free trial" is fine; so are
 * sentences that say there is no free plan.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");

function walk(dir: string, ext: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p, ext);
    return ext.some((e) => p.endsWith(e)) ? [p] : [];
  });
}

const FILES = [
  "routes/pricing.tsx",
  "routes/about.tsx",
  "routes/refund-policy.tsx",
  "routes/auth/plan-selection.tsx",
  "components/LandingPage.tsx",
  "components/auth/AuthScreen.tsx",
  "components/marketing/sections.tsx",
  "components/marketing/MarketingLayout.tsx",
  "components/marketing/SiteHeader.tsx",
  "components/marketing/solutions.tsx",
  "lib/solutions-content.ts",
  "lib/plans.ts",
  ...walk(join(SRC, "content/help"), [".mdx"]).map((p) => p.slice(SRC.length + 1)),
  ...walk(join(SRC, "lib/feature-pages"), [".ts"]).map((p) => p.slice(SRC.length + 1)),
];

const FREE_PLAN = /free plan|forever.?free|free forever|free tier|start free(?! trial)|get started free|free account|free for life|free to start/i;
/** Sentences that say there is none. */
const ALLOWED = /no free plan|is there a free plan|there is no free/i;

describe("no free-plan wording in customer-facing copy", () => {
  for (const file of FILES) {
    it(file, () => {
      const offending = readFileSync(join(SRC, file), "utf8")
        .split("\n")
        .filter((line) => FREE_PLAN.test(line) && !ALLOWED.test(line));
      expect(offending).toEqual([]);
    });
  }

  it("the pricing page carries the trial call to action, the availability-gated add-ons and the GST note", () => {
    const src = readFileSync(join(SRC, "routes/pricing.tsx"), "utf8");
    expect(src).toContain("Start your ${TRIAL_DAYS}-day Full Access Trial — no card needed");
    // Add-ons are sold only once built: the section and FAQ go through the shared availability helper.
    expect(src).toContain("ADDONS");
    expect(src).toContain("isAddonAvailable");
    expect(src).not.toMatch(/ADDONS\.map\(/);
    expect(src).toMatch(/before \$\{PLAN_GST_RATE_PERCENT\}% GST/);
  });
});
