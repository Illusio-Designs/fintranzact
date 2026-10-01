/**
 * journey.ts — Shared fixture and helpers for the user journeys in e2e/journeys.
 *
 * Every journey:
 *   - fails on any console error or uncaught page error, in every browser
 *     context it opens (expected errors, e.g. the 401 behind a wrong
 *     password, are allowed one pattern at a time with `guard.allow`);
 *   - runs at 1280px ("journeys-desktop") and 390px ("journeys-phone"), and
 *     on the phone checks each screen for page-level horizontal scroll;
 *   - sets the browser clock so the app's India-time theme is light or dark
 *     on purpose (the app has no manual toggle: light 06:00–18:59 IST).
 *
 * External services are never reached: Cloudflare Turnstile and Google Fonts
 * are stubbed at the network layer (stubExternalServices) and the API runs without
 * RESEND_API_KEY, so "emails" go to the dev console mailer — journeys read
 * magic links through the database instead (see db.ts).
 */
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { closeDb } from "./db";

export const API_URL = process.env.API_URL ?? "http://localhost:3000";

type Problem = { where: string; text: string };

export class ConsoleGuard {
  private problems: Problem[] = [];
  private allowed: RegExp[] = [
    // Vite dev server websocket reconnect noise is not an app error.
    /\[vite\]/i,
  ];

  /** Allow console errors matching `pattern` for the rest of the test. */
  allow(pattern: RegExp) {
    this.allowed.push(pattern);
  }

  watch(context: BrowserContext) {
    context.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = `${msg.text()} ${msg.location()?.url ?? ""}`.trim();
      if (this.allowed.some((re) => re.test(text))) return;
      this.problems.push({ where: msg.page()?.url() ?? "?", text });
    });
    context.on("weberror", (err) => {
      const text = String(err.error()?.stack ?? err.error());
      if (this.allowed.some((re) => re.test(text))) return;
      this.problems.push({ where: err.page()?.url() ?? "?", text: `pageerror: ${text}` });
    });
  }

  assertClean() {
    expect(
      this.problems.map((p) => `${p.where}: ${p.text}`),
      "console errors / uncaught page errors during the journey",
    ).toEqual([]);
  }
}

export type ThemeMode = "light" | "dark";

/**
 * The browser clock's start for a journey: real "now" when India time already
 * gives the wanted theme (with at least 30 minutes before it switches), else
 * the nearest moment on the same UTC calendar date that does. Staying on the
 * server's UTC date keeps the app's "This month" / "today" filters seeing the
 * records the API creates during the journey.
 *
 *   light (06:00–18:59 IST), dark (19:00–05:59 IST)
 */
export function instantFor(mode: ThemeMode, now = new Date()): Date {
  const IST = 330 * 60_000;
  const ist = new Date(now.getTime() + IST);
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const istDay = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const at = (dayOffset: number, hh: number, mm: number) =>
    new Date(istDay + dayOffset * 86_400_000 + (hh * 60 + mm) * 60_000 - IST);
  // Before 05:30 IST the UTC date is still the previous IST day's.
  if (mode === "light") {
    if (m < 330) return at(-1, 12, 0);
    if (m < 360) return at(0, 6, 30);
    if (m < 1110) return now;
    return at(0, 12, 0);
  }
  if (m < 330 || m >= 1140) return now;
  return at(0, 19, 30);
}

const TURNSTILE_STUB = `window.turnstile = {
  render: function (_el, opts) { setTimeout(function () { opts.callback("e2e-turnstile-token"); }, 0); return "e2e"; },
  reset: function () {},
  remove: function () {},
};`;

/**
 * No third-party requests leave the browser: Cloudflare Turnstile gets a
 * passing stub and Google Fonts an empty stylesheet (the app falls back to
 * system fonts), so journeys never depend on reaching them.
 */
export async function stubExternalServices(context: BrowserContext) {
  await context.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
}

/**
 * Start the context's clock at a moment giving `mode` and let it run, so
 * timers, toasts and "x seconds ago" behave normally.
 */
export async function pinTheme(context: BrowserContext, mode: ThemeMode) {
  await context.clock.install({ time: instantFor(mode) });
  await context.clock.resume();
}

export async function expectTheme(page: Page, mode: ThemeMode) {
  const html = page.locator("html");
  if (mode === "dark") await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  // And it actually paints differently: dark body is dark, light is light.
  const luminance = await page.evaluate(() => {
    const parse = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const els = [document.querySelector("main"), document.body];
    for (const el of els) {
      if (!el) continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
        const [r, g, b] = parse(bg);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
    }
    return null;
  });
  if (luminance !== null) {
    if (mode === "dark") expect(luminance, "dark theme background").toBeLessThan(100);
    else expect(luminance, "light theme background").toBeGreaterThan(160);
  }
}

export function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

/** On the phone project: the page must not scroll sideways. */
export async function expectNoHorizontalScroll(page: Page, screen: string) {
  if (!isPhone(page)) return;
  // Let layout settle (fonts, lazy panels) before measuring.
  await page.waitForLoadState("domcontentloaded");
  const measure = () =>
    page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const docOverflow = Math.max(doc.scrollWidth, body.scrollWidth) - doc.clientWidth;
      // Inside the app shell the page scrolls in its content pane, not
      // the document: sideways overflow there is page-level too.
      const pane = document.querySelector<HTMLElement>('[data-testid="app-content"]');
      const paneOverflow = pane ? pane.scrollWidth - pane.clientWidth : 0;
      return Math.max(docOverflow, paneOverflow);
    });
  try {
    await expect.poll(measure, { timeout: 5_000 }).toBeLessThanOrEqual(0);
  } catch {
    // Name the widest offenders so the failure says what to fix.
    const culprits = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const pane = document.querySelector('[data-testid="app-content"]');
      // Content inside its own sideways scroller (a tab strip, a wide table
      // wrapper) does not scroll the page.
      const inOwnScroller = (el: HTMLElement) => {
        for (let p = el.parentElement; p && p !== pane && p !== document.body; p = p.parentElement) {
          if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed" && !inOwnScroller(el);
      });
      const leaves = wide.filter((el) => !wide.some((o) => o !== el && el.contains(o)));
      return leaves.slice(0, 5).map((el) => {
        const r = el.getBoundingClientRect();
        const cls = typeof el.className === "string" ? el.className.slice(0, 60) : "";
        return `<${el.tagName.toLowerCase()} class="${cls}"> right=${Math.round(r.right)} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
      });
    });
    expect(await measure(), `horizontal page scroll at 390px on ${screen}:\n${culprits.join("\n")}`).toBeLessThanOrEqual(0);
  }
}

/** A toast (title or description) in the app's notification area. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByLabel(/^Notifications/).getByText(text).first();
}

/** Open a sidebar destination the way the user would at this width. */
export async function navTo(page: Page, label: string | RegExp) {
  const sidebar = page.getByTestId("app-sidebar");
  if (isPhone(page)) {
    // Toasts sit over the top bar on a phone and pause while the pointer
    // rests on them (where the last tap was). Lift the pointer off so they
    // time out, as they do for a finger.
    await page.mouse.move(1, (page.viewportSize()?.height ?? 800) - 1);
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }
  await sidebar.getByRole("link", { name: label, exact: typeof label === "string" }).click();
}

/** Labels of the links in the sidebar's main nav (what the role can see). */
export async function sidebarLabels(page: Page): Promise<string[]> {
  const nav = page.getByTestId("app-sidebar-nav");
  await expect(nav.getByRole("link").first()).toBeAttached();
  const texts = await nav.getByRole("link").allInnerTexts();
  return texts.map((t) => t.trim()).filter(Boolean);
}

/** Sign out from the sidebar (or top bar while onboarding). */
export async function signOut(page: Page) {
  const sidebar = page.getByTestId("app-sidebar");
  if (await sidebar.count()) {
    if (isPhone(page)) await page.getByRole("button", { name: "Open navigation menu" }).click();
    await sidebar.getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("button", { name: "Sign out" }).click();
  }
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
}

/** A fresh, signed-out browser context watched by the guard. */
export async function newJourneyContext(
  browser: Browser,
  guard: ConsoleGuard,
  options: BrowserContextOptions & { theme?: ThemeMode } = {},
) {
  const { theme = "light", ...rest } = options;
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, ...rest });
  // Same bound on actions as the project's own pages: a missing element fails
  // the step instead of hanging until the test times out.
  context.setDefaultTimeout(15_000);
  guard.watch(context);
  await stubExternalServices(context);
  await pinTheme(context, theme);
  return context;
}

/** Unique suffix for names/emails so reruns never collide. */
export function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const test = base.extend<{ guard: ConsoleGuard; theme: ThemeMode }, { dbPool: void }>({
  // Signed-out context by default; journeys sign up or log in themselves.
  storageState: { cookies: [], origins: [] },
  theme: ["light", { option: true }],
  // Playwright reads fixture dependencies from the first parameter's pattern.
  // oxlint-disable-next-line no-empty-pattern
  guard: async ({}, use) => {
    const guard = new ConsoleGuard();
    await use(guard);
    guard.assertClean();
  },
  context: async ({ context, guard, theme }, use) => {
    guard.watch(context);
    await stubExternalServices(context);
    await pinTheme(context, theme);
    await use(context);
  },
  dbPool: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use();
      await closeDb();
    },
    { scope: "worker", auto: true },
  ],
});

export { expect };
