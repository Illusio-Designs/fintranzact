/**
 * store-policies.test.ts — store policy pages (Terms, Refund, Shipping,
 * Contact, Privacy): the editor procedures and the public pages.
 *
 * Invariants:
 *   1. Untouched pages follow the default template and the business details
 *      (name, address, GSTIN, phone, email, return window).
 *   2. Saved text replaces the template; reset brings the template back.
 *   3. Only admins/owners can edit; any member can read.
 *   4. The public pages answer without sign-in, only for a store that is
 *      switched on, and never emit raw HTML from the owner's text.
 *   5. Another business's policies never leak into a store's pages.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// server.ts starts listening on import; capture its fetch handler instead.
const captured = vi.hoisted(() => ({ fetch: null as null | ((req: Request) => Promise<Response>) }));
vi.mock("@hono/node-server", () => ({
  serve: (opts: { fetch: (req: Request) => Promise<Response> }) => {
    captured.fetch = opts.fetch;
    return { close: () => undefined };
  },
}));

let world: TestWorld;

const ownerCaller = () =>
  createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });

const sellerCaller = () =>
  createTestCaller({
    userId: world.suresh.id,
    email: world.suresh.email,
    name: world.suresh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return captured.fetch!(new Request(`http://localhost${path}`, { headers }));
}

beforeAll(async () => {
  process.env.DISABLE_RATE_LIMIT = "1";
  const realOn = process.on.bind(process);
  const spy = vi.spyOn(process, "on").mockImplementation(((event: string, fn: (...a: unknown[]) => void) =>
    ["unhandledRejection", "uncaughtException", "SIGINT", "SIGTERM"].includes(event) ? process : realOn(event, fn)) as typeof process.on);
  await import("../../server.js");
  spy.mockRestore();
  if (!captured.fetch) throw new Error("server.ts did not hand its fetch handler to serve()");
  world = await createTestWorld();
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("store.getPolicies", () => {
  it("returns the five pages as untouched templates with the business details", async () => {
    const res = await ownerCaller().store.getPolicies();
    expect(res.policies.map((p) => p.kind)).toEqual(["terms", "refund", "shipping", "contact", "privacy"]);
    for (const p of res.policies) {
      expect(p.isCustom).toBe(false);
      expect(p.content).toBeNull();
      expect(p.template.length).toBeGreaterThan(100);
    }
    expect(res.variables.businessName).toBe("Acme Trading Co");
    expect(res.variables.gstin).toBe("27AABCA0000R1ZM");
    expect(res.variables.returnWindowDays).toBe(7);
    expect(res.variables.address).toContain("123 MG Road");
    expect(res.variables.address).toContain("Mumbai");
  });

  it("is readable by a seller", async () => {
    const res = await sellerCaller().store.getPolicies();
    expect(res.policies).toHaveLength(5);
  });
});

describe("return window", () => {
  it("is saved with the store settings and feeds the variables", async () => {
    await ownerCaller().store.updateSettings({ storeReturnWindowDays: 14 });
    expect((await ownerCaller().store.getSettings()).storeReturnWindowDays).toBe(14);
    expect((await ownerCaller().store.getPolicies()).variables.returnWindowDays).toBe(14);
  });

  it("rejects zero and absurd values", async () => {
    await expect(ownerCaller().store.updateSettings({ storeReturnWindowDays: 0 })).rejects.toThrow();
    await expect(ownerCaller().store.updateSettings({ storeReturnWindowDays: 4000 })).rejects.toThrow();
  });
});

describe("store.updatePolicy and resetPolicy", () => {
  it("saves custom text, then reset restores the template", async () => {
    const saved = await ownerCaller().store.updatePolicy({
      kind: "refund",
      content: "## Returns\n\nNo returns at {{businessName}} except damaged goods.",
    });
    expect(saved.kind).toBe("refund");

    const after = await ownerCaller().store.getPolicies();
    const refund = after.policies.find((p) => p.kind === "refund")!;
    expect(refund.isCustom).toBe(true);
    expect(refund.content).toContain("No returns at {{businessName}}");
    expect(refund.updatedAt).toBeTruthy();
    expect(after.policies.find((p) => p.kind === "terms")!.isCustom).toBe(false);

    await ownerCaller().store.resetPolicy({ kind: "refund" });
    const reset = (await ownerCaller().store.getPolicies()).policies.find((p) => p.kind === "refund")!;
    expect(reset.isCustom).toBe(false);
    expect(reset.content).toBeNull();
  });

  it("keeps the other pages when one is edited", async () => {
    await ownerCaller().store.updatePolicy({ kind: "terms", content: "Terms text one" });
    await ownerCaller().store.updatePolicy({ kind: "privacy", content: "Privacy text one" });
    const res = await ownerCaller().store.getPolicies();
    expect(res.policies.filter((p) => p.isCustom).map((p) => p.kind).sort()).toEqual(["privacy", "terms"]);
    await ownerCaller().store.resetPolicy({ kind: "terms" });
    await ownerCaller().store.resetPolicy({ kind: "privacy" });
    const clean = await getTestClient()`SELECT store_policies FROM businesses WHERE id = ${world.business1.id}`;
    expect(clean[0]!.store_policies).toBeNull();
  });

  it("refuses empty text and unknown pages", async () => {
    await expect(ownerCaller().store.updatePolicy({ kind: "terms", content: "   \n " })).rejects.toThrow(/cannot be empty/);
    await expect(ownerCaller().store.updatePolicy({ kind: "cookies" as never, content: "x" })).rejects.toThrow();
  });

  it("is refused for a seller", async () => {
    await expect(sellerCaller().store.updatePolicy({ kind: "terms", content: "hacked" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerCaller().store.resetPolicy({ kind: "terms" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not touch another business", async () => {
    await ownerCaller().store.updatePolicy({ kind: "contact", content: "Only for business one" });
    const rows = await getTestClient()`SELECT store_policies FROM businesses WHERE id = ${world.business2.id}`;
    expect(rows[0]!.store_policies).toBeNull();
    await ownerCaller().store.resetPolicy({ kind: "contact" });
  });
});

describe("public policy pages", () => {
  const slug = "policy-test-shop";

  beforeAll(async () => {
    const sql = getTestClient();
    await sql`UPDATE businesses SET store_enabled = true, store_slug = ${slug} WHERE id = ${world.business1.id}`;
  });

  it("serves all five pages as JSON without sign-in", async () => {
    const res = await get(`/store/${slug}/policies.json`);
    expect(res.status).toBe(200);
    const body = await res.json() as { business: { name: string }; policies: Array<{ kind: string; path: string; updatedAt: string | null }> };
    expect(body.business.name).toBe("Acme Trading Co");
    expect(body.policies.map((p) => p.kind)).toEqual(["terms", "refund", "shipping", "contact", "privacy"]);
    expect(body.policies[0]!.path).toBe(`/${slug}/policies/terms`);
    expect(body.policies.every((p) => p.updatedAt === null)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("{{");
  });

  it("serves each page as server-rendered HTML with the business details filled", async () => {
    const res = await get(`/store/${slug}/policies/contact`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain("<h1>Contact Us</h1>");
    expect(html).toContain("Acme Trading Co");
    expect(html).toContain("27AABCA0000R1ZM");
    expect(html).toContain("123 MG Road");
    expect(html).not.toContain("{{");
    expect(html).not.toContain("<script");

    const refund = await (await get(`/store/${slug}/policies/refund`)).text();
    expect(refund).toContain("within <strong>14 days</strong>");
  });

  it("renders the owner's text and never raw HTML", async () => {
    await ownerCaller().store.updatePolicy({
      kind: "shipping",
      content: '## Delivery\n\n<script>alert(1)</script> <img src=x onerror=alert(1)> [bad](javascript:alert(1)) **fast**',
    });
    const html = await (await get(`/store/${slug}/policies/shipping`)).text();
    expect(html).toContain("<strong>fast</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("Last updated:");
  });

  it("answers 404 for an unknown page, an unknown store and a switched-off store", async () => {
    expect((await get(`/store/${slug}/policies/cookies`)).status).toBe(404);
    expect((await get(`/store/no-such-shop/policies/terms`)).status).toBe(404);
    expect((await get(`/store/no-such-shop/policies.json`)).status).toBe(404);
    await getTestClient()`UPDATE businesses SET store_enabled = false WHERE id = ${world.business1.id}`;
    // The slug lookup is cached for a few minutes; the page still checks storeEnabled itself.
    expect((await get(`/store/${slug}/policies/terms`)).status).toBe(404);
    expect((await get(`/store/${slug}/policies.json`)).status).toBe(404);
  });
});
