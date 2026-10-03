/**
 * The "Powered by Fintranzact" line through the real PDF routes (server.ts):
 * the invoice PDF and the e-way bill PDF carry a link annotation to
 *   - the sign-up page with the referring partner's code, when the
 *     organisation was referred by an APPROVED partner;
 *   - the plain site otherwise (no partner, or a partner not approved);
 * and no such link when the plan has the footer switched off. The link holds
 * nothing but the referral code. Requests go through the real Hono app with
 * `serve` stubbed out, as in rest-entitlement.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { partners, planSettings, tenants } from "@fintranzact/db";
import { PLAN_DEFAULTS, limitsToStored } from "@fintranzact/shared";
import { buildSweepWorld, seedBusiness, type SweepWorld } from "../helpers/sweep-world.js";
import { createSession } from "../helpers/fixtures.js";
import { getControlDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";

const captured = vi.hoisted(() => ({ fetch: null as null | ((req: Request) => Promise<Response>) }));
vi.mock("@hono/node-server", () => ({
  serve: (opts: { fetch: (req: Request) => Promise<Response> }) => {
    captured.fetch = opts.fetch;
    return { close: () => undefined };
  },
}));

const ORIGIN = "https://app.pdfbrand.test";
const CODE = "FTZ-7K2M9Q";
let world: SweepWorld;
let sessionId: string;
let partnerId: string;

async function pdf(path: string): Promise<string> {
  const res = await captured.fetch!(new Request(`http://localhost${path}`, {
    headers: { origin: ORIGIN, authorization: `Bearer ${sessionId}`, "x-business-id": world.a1.id },
  }));
  expect(res.status, path).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  // Link annotations are plain dictionaries in the file: /URI (https://…)
  return Buffer.from(await res.arrayBuffer()).toString("latin1");
}

const urisOf = (raw: string) => [...raw.matchAll(/\/URI \(([^)]*)\)/g)].map((m) => m[1]!).filter((u) => u.startsWith(ORIGIN));

async function setPartner(status: "approved" | "pending" | null) {
  const db = getControlDb();
  if (status === null) {
    await db.update(tenants).set({ partnerId: null }).where(eq(tenants.id, world.tenantA.id));
  } else {
    await db.update(partners).set({ status }).where(eq(partners.id, partnerId));
    await db.update(tenants).set({ partnerId }).where(eq(tenants.id, world.tenantA.id));
  }
  invalidateEntitlements(world.tenantA.id);
}

async function setPlan(plan: "starter" | "growth" | "business", pdfBranding: boolean) {
  const db = getControlDb();
  await db.delete(planSettings);
  if (!pdfBranding) {
    const base = PLAN_DEFAULTS[plan];
    await db.insert(planSettings).values({
      plan, name: base.name, tagline: base.tagline, monthlyPriceInr: base.monthlyPriceInr, yearlyPriceInr: base.yearlyPriceInr,
      features: base.features, highlight: false, visible: true, limits: { ...limitsToStored(base.limits), pdfBranding: false },
    });
  }
  await db.update(tenants).set({ plan }).where(eq(tenants.id, world.tenantA.id));
  invalidatePlanCatalog();
}

beforeAll(async () => {
  process.env.CORS_ORIGINS = ORIGIN;
  process.env.APP_URL = ORIGIN;
  process.env.DISABLE_RATE_LIMIT = "1";
  const realOn = process.on.bind(process);
  const spy = vi.spyOn(process, "on").mockImplementation(((event: string, fn: (...a: unknown[]) => void) =>
    ["unhandledRejection", "uncaughtException", "SIGINT", "SIGTERM"].includes(event) ? process : realOn(event, fn)) as typeof process.on);
  await import("../../server.js");
  spy.mockRestore();
  if (!captured.fetch) throw new Error("server.ts did not hand its fetch handler to serve()");

  world = await buildSweepWorld();
  await seedBusiness(world.a1);
  sessionId = (await createSession(world.usersA.owner.id, world.tenantA.id)).id;
  const [p] = await getControlDb().insert(partners).values({
    contactName: "Nikhil Shah", companyName: "Shah & Co", email: "nikhil@shahco.in", phone: "9824012345", city: "Surat",
    partnerType: "accountant", status: "approved", referralCode: CODE,
  }).returning({ id: partners.id });
  partnerId = p!.id;
}, 180_000);

afterAll(async () => {
  delete process.env.APP_URL;
  await getControlDb().delete(planSettings);
  invalidatePlanCatalog();
  await truncateAllTables();
  await closeTestDb();
});

describe("invoice PDF footer link", () => {
  for (const plan of ["starter", "growth", "business"] as const) {
    it(`${plan}: an approved partner's code is in the sign-up link`, async () => {
      await setPlan(plan, true);
      await setPartner("approved");
      const raw = await pdf(`/api/invoices/${world.a1.ids.invoice!}/pdf`);
      expect(urisOf(raw)).toContain(`${ORIGIN}/register?ref=${CODE}`);
    });
  }

  it("links the plain site when the organisation has no partner", async () => {
    await setPlan("growth", true);
    await setPartner(null);
    const uris = urisOf(await pdf(`/api/invoices/${world.a1.ids.invoice!}/pdf`));
    expect(uris).toContain(ORIGIN);
    expect(uris.some((u) => u.includes("ref="))).toBe(false);
  });

  it("links the plain site when the partner is not approved", async () => {
    await setPlan("growth", true);
    await setPartner("pending");
    const uris = urisOf(await pdf(`/api/invoices/${world.a1.ids.invoice!}/pdf`));
    expect(uris).toContain(ORIGIN);
    expect(uris.some((u) => u.includes("ref=") || u.includes(CODE))).toBe(false);
  });

  it("has no Fintranzact link at all when the plan switches the footer off", async () => {
    await setPlan("growth", false);
    await setPartner("approved");
    expect(urisOf(await pdf(`/api/invoices/${world.a1.ids.invoice!}/pdf`))).toEqual([]);
  });

  it("carries no partner details, only the code", async () => {
    await setPlan("growth", true);
    await setPartner("approved");
    const raw = await pdf(`/api/invoices/${world.a1.ids.invoice!}/pdf`);
    expect(raw).not.toContain("Shah & Co");
    expect(raw).not.toContain("nikhil@shahco.in");
  });
});

describe("e-way bill PDF footer link", () => {
  it("links to sign-up with the partner's code, and nothing when the footer is off", async () => {
    const sql = getTestClient();
    const [row] = await sql`SELECT id FROM eway_bills WHERE business_id = ${world.a1.id} LIMIT 1`;
    expect(row, "the sweep world has an e-way bill").toBeTruthy();
    const path = `/api/eway-bills/${(row as { id: string }).id}/pdf`;
    await setPlan("starter", true);
    await setPartner("approved");
    expect(urisOf(await pdf(path))).toEqual([`${ORIGIN}/register?ref=${CODE}`]);
    await setPartner(null);
    expect(urisOf(await pdf(path))).toEqual([ORIGIN]);
    await setPlan("starter", false);
    expect(urisOf(await pdf(path))).toEqual([]);
  });
});
