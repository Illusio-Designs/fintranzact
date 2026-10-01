/**
 * J15 — The public website, as a visitor (signed out) sees it.
 *
 *   - Every URL in /sitemap.xml answers 200, stays on its own address (no
 *     bounce to the login page), renders its page heading without console
 *     errors and, on a phone, without sideways scroll. The sitemap is split
 *     into groups (site, features, solutions, help, developers) so each test
 *     stays short; it covers every /features/<slug> page and every
 *     /developers group page.
 *   - Every link in the site header (each mega menu opened, or the phone
 *     menu with every section expanded) and the footer is a real address:
 *     no "#" placeholders, and each internal one opens a page.
 *   - The contact form sends a message.
 *   - The help centre's search finds an article and opens it.
 *   - The legal pages (privacy, terms, refund policy) name the operator,
 *     Finvera Solutions LLP, with its registered office and the grievance
 *     contact; the footer does too.
 *   - Light and dark theme (the site follows India time, like the app).
 *
 * External services: none. Turnstile (contact form) is replaced by a stub
 * that passes, and the API runs without TURNSTILE_SECRET_KEY or
 * RESEND_API_KEY, so the message goes to the dev console mailer. Google Fonts
 * are stubbed; external links (mailto:, tel:, other sites) are checked for
 * shape only, never fetched.
 */
import type { Page } from "@playwright/test";
import { test, expect, expectNoHorizontalScroll, expectTheme, isPhone, newJourneyContext } from "../../helpers/journey";

/** Paths in the sitemap, grouped. Read once per worker. */
let sitemapPaths: string[] | null = null;

async function sitemap(page: Page): Promise<string[]> {
  if (sitemapPaths) return sitemapPaths;
  const res = await page.request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/xml/);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  expect(locs.length, "sitemap entries").toBeGreaterThan(100);
  expect(new Set(locs).size, "no duplicate sitemap entries").toBe(locs.length);
  sitemapPaths = locs;
  return locs;
}

const GROUPS: Array<{ name: string; match: (p: string) => boolean }> = [
  { name: "features", match: (p) => p.startsWith("/features") },
  { name: "solutions", match: (p) => p.startsWith("/solutions") },
  { name: "help", match: (p) => p.startsWith("/help") },
  { name: "developers", match: (p) => p.startsWith("/developers") },
];
const isSitePage = (p: string) => !GROUPS.some((g) => g.match(p));

/** Open a public page and check it renders as itself. */
async function expectPageRenders(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${path} status`).toBe(200);
  await expect(page.locator("h1").first(), `${path} has its page heading`).toBeVisible({ timeout: 20_000 });
  // Still on the same page: not sent to /login (the app's answer to an unknown address).
  expect(new URL(page.url()).pathname, `${path} stays on its address`).toBe(path);
  await expectNoHorizontalScroll(page, path);
}

/** All links of a region as [label, href]. */
async function linksIn(page: Page, scope: ReturnType<Page["locator"]>) {
  return scope.locator("a").evaluateAll((as) =>
    as.map((a) => [(a.textContent ?? "").trim() || a.getAttribute("aria-label") || "", a.getAttribute("href") ?? ""] as [string, string]),
  );
}

test.describe("J15 public site", () => {
  test.setTimeout(600_000);

  test("sitemap: site pages render", async ({ page }) => {
    const paths = (await sitemap(page)).filter(isSitePage);
    expect(paths).toEqual(expect.arrayContaining(["/", "/pricing", "/about", "/contact", "/partners", "/privacy", "/terms", "/refund-policy"]));
    for (const path of paths) await expectPageRenders(page, path);
  });

  for (const group of GROUPS) {
    test(`sitemap: ${group.name} pages render`, async ({ page }) => {
      const paths = (await sitemap(page)).filter(group.match);
      expect(paths.length).toBeGreaterThan(group.name === "developers" ? 20 : 5);
      for (const path of paths) await expectPageRenders(page, path);
    });
  }

  test("header, mega menu and footer links go to real pages", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator("h1").first()).toBeVisible();
    const header = page.getByRole("banner");
    const links: Array<[string, string]> = [];

    if (isPhone(page)) {
      await header.getByRole("button", { name: "Open menu" }).click();
      const mobile = page.getByRole("navigation", { name: "Mobile" });
      links.push(...(await linksIn(page, mobile)));
      // Open each section of the phone menu in turn (one is open at a time).
      const sections = mobile.getByRole("button");
      const count = await sections.count();
      expect(count, "phone menu sections").toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const section = sections.nth(i);
        if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
        await expect(section).toHaveAttribute("aria-expanded", "true");
        links.push(...(await linksIn(page, mobile)));
      }
      await expectNoHorizontalScroll(page, "phone menu");
    } else {
      links.push(...(await linksIn(page, page.getByRole("navigation", { name: "Main" }))));
      const triggers = page.getByRole("navigation", { name: "Main" }).getByRole("button");
      const count = await triggers.count();
      expect(count, "mega menus").toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const trigger = triggers.nth(i);
        // Pointing at a menu opens it (a click toggles it).
        await trigger.hover();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        const panel = page.locator(`#${await trigger.getAttribute("aria-controls")}`);
        await expect(panel.locator("a").first()).toBeVisible();
        links.push(...(await linksIn(page, panel)));
      }
    }
    links.push(...(await linksIn(page, header.locator(":scope > div").first())));
    links.push(...(await linksIn(page, page.getByRole("contentinfo"))));

    // No placeholders: every link has a real target.
    const bad = links.filter(([, href]) => !href || href.includes("#") || href.startsWith("javascript:"));
    expect(bad, "links without a real target").toEqual([]);
    // Off-site links are well formed (not fetched).
    for (const [label, href] of links.filter(([, h]) => !h.startsWith("/"))) {
      expect(href, label).toMatch(/^(mailto:[^@\s]+@[^@\s]+|tel:\+?\d+|https:\/\/[^\s]+)$/);
    }

    // Each internal one opens a page (signed out, the partner portal asks to log in).
    const internal = [...new Set(links.map(([, h]) => h).filter((h) => h.startsWith("/")))];
    expect(internal.length).toBeGreaterThan(20);
    for (const href of internal) {
      const res = await page.goto(href, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `${href} status`).toBe(200);
      await expect(page.locator("h1").first(), `${href} has its page heading`).toBeVisible({ timeout: 20_000 });
      const landed = new URL(page.url()).pathname;
      if (href === "/partner-portal") expect(landed).toMatch(/^\/(login|partner-portal)$/);
      else expect(landed, `${href} stays on its address`).toBe(new URL(href, "http://x").pathname);
    }
  });

  test("contact form sends a message", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: "We're here to help", level: 1 })).toBeVisible();
    await expectTheme(page, "light");
    await page.getByRole("textbox", { name: /^Name/ }).fill("Asha Iyer");
    await page.getByRole("textbox", { name: /^Email/ }).fill("asha.iyer@example.com");
    await page.getByRole("textbox", { name: /^Message/ }).fill("Do you support multiple GSTINs in one account? We have two branches.");
    await expectNoHorizontalScroll(page, "contact form");
    const sent = page.waitForResponse((r) => r.url().includes("/api/trpc/contact.") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Send message" }).click();
    expect((await sent).status()).toBe(200);
    await expect(page.getByText("Thanks, your message is on its way")).toBeVisible();
  });

  test("help search finds an article", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "How can we help?", level: 1 })).toBeVisible();
    const search = page.getByRole("main").getByRole("combobox", { name: "Search help articles" }).last();
    await search.fill("e-way bill");
    const option = page.getByRole("option", { name: /e-?way bill/i }).first();
    await expect(option).toBeVisible();
    await expectNoHorizontalScroll(page, "help search");
    await option.click();
    await expect(page).toHaveURL(/\/help\/gst\/eway-bills$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/e-?way bill/i);
  });

  test("legal pages name Finvera Solutions LLP, its office and grievance contact", async ({ page }) => {
    for (const path of ["/privacy", "/terms", "/refund-policy"]) {
      await page.goto(path);
      const main = page.getByRole("main");
      await expect(main.locator("h1").first()).toBeVisible();
      await expect(main).toContainText("Finvera Solutions LLP");
      await expect(main).toContainText("Rajkot - 360005, Gujarat, India");
      await expect(main).toContainText(/finverasolutionsllp@gmail\.com|\+91 76000 46416/);
      await expectNoHorizontalScroll(page, path);
    }
    await page.goto("/privacy");
    await expect(page.getByRole("main")).toContainText("Grievance Officer");
    // The footer on every public page.
    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText(`© ${new Date().getFullYear()} Finvera Solutions LLP`);
    await expect(footer).toContainText("B-603, 6th Floor, Darshan Srushti Apartment");
  });

  test("the site in the dark", async ({ browser, guard, page }) => {
    const night = await newJourneyContext(browser, guard, {
      theme: "dark",
      viewport: page.viewportSize()!,
      hasTouch: isPhone(page),
    });
    const nightPage = await night.newPage();
    for (const path of ["/", "/pricing", "/help"]) {
      await nightPage.goto(path);
      await expect(nightPage.locator("h1").first()).toBeVisible();
      await expectTheme(nightPage, "dark");
      await expectNoHorizontalScroll(nightPage, `${path} (dark)`);
    }
    await night.close();
  });
});
