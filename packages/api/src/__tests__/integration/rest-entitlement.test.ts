/**
 * REST endpoints outside tRPC under a read-only (halted) and a suspended
 * organisation (plans/trial/billing enforcement, part 4). Companion to the
 * route registry in ../rest-entitlement-policy.test.ts: that test makes sure
 * every route has a decision, this one proves the decisions end to end.
 *
 *  - writes over REST (self-import) are refused with 403 { error, entitlement };
 *  - downloads (invoice PDF, ledger PDF, label sheet) and the data export keep
 *    working while read-only, and are refused (PDFs) once suspended;
 *  - the Razorpay webhook is processed for a halted organisation and a late
 *    renewal reactivates it;
 *  - the shipping webhook records events for a read-only organisation and
 *    refuses a suspended one;
 *  - public store/share endpoints answer with a neutral 404.
 *
 * Needs the test Postgres (docker compose -f docker-compose.test.yml up -d).
 * Requests go through the real Hono app (server.ts) with `serve` stubbed out,
 * as in rest-isolation.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { billingSubscriptions, tenants } from "@fintranzact/db";
import { buildSweepWorld, seedBusiness, callerAs, type SweepWorld } from "../helpers/sweep-world.js";
import { createSession, type TestUser } from "../helpers/fixtures.js";
import { getControlDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";
import { signImportToken } from "../../lib/importToken.js";

const captured = vi.hoisted(() => ({ fetch: null as null | ((req: Request) => Promise<Response>) }));
vi.mock("@hono/node-server", () => ({
  serve: (opts: { fetch: (req: Request) => Promise<Response> }) => {
    captured.fetch = opts.fetch;
    return { close: () => undefined };
  },
}));

const ORIGIN = "https://app.entitlement.test";
const RAZORPAY_SECRET = "entitlement-razorpay-secret";
const SHIPPING_SECRET = "entitlement-shipping-secret";
let world: SweepWorld;
let sessionId: string;

async function request(
  path: string,
  opts: { auth?: boolean; business?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN, ...opts.headers };
  if (opts.auth) headers.authorization = `Bearer ${sessionId}`;
  if (opts.business) headers["x-business-id"] = opts.business;
  if (opts.body !== undefined && typeof opts.body !== "string") headers["content-type"] = "application/json";
  return captured.fetch!(new Request(`http://localhost${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  }));
}

type State = "active" | "halted" | "suspended";

/** Put an organisation (A unless told otherwise) into a state; every test sets what it needs. */
async function setState(state: State, tenant: { id: string } = world.tenantA) {
  const db = getControlDb();
  await db.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tenant.id));
  await db.update(tenants).set({ status: state === "suspended" ? "suspended" : "active" }).where(eq(tenants.id, tenant.id));
  if (state === "halted") {
    await db.insert(billingSubscriptions).values({
      tenantId: tenant.id,
      kind: "plan",
      plan: "pro",
      cycle: "monthly",
      status: "halted",
      provider: "razorpay",
      providerSubscriptionId: `sub_RESTENT_${tenant.id.slice(0, 8)}`,
      basePaise: 99900,
    });
  }
  invalidateEntitlements(tenant.id);
}

/**
 * In hosted mode the shipping webhook and the public store find a business by
 * scanning the ACTIVE organisations' databases. The test world keeps every
 * organisation in one shared database, so an active organisation B would find
 * A's business and serve it. To see A's state decide the answer, B is put in the
 * same state for those cases (and set back to active afterwards).
 */
async function setBothStates(state: State) {
  await setState(state, world.tenantA);
  await setState(state, world.tenantB);
}
async function resetB() {
  await setState("active", world.tenantB);
}

const owner = (): TestUser => world.usersA.owner;

beforeAll(async () => {
  process.env.CORS_ORIGINS = ORIGIN;
  process.env.SHIPPING_WEBHOOK_SECRET = SHIPPING_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_SECRET;
  process.env.DISABLE_RATE_LIMIT = "1";
  const realOn = process.on.bind(process);
  const spy = vi.spyOn(process, "on").mockImplementation(((event: string, fn: (...a: unknown[]) => void) =>
    ["unhandledRejection", "uncaughtException", "SIGINT", "SIGTERM"].includes(event) ? process : realOn(event, fn)) as typeof process.on);
  await import("../../server.js");
  spy.mockRestore();
  if (!captured.fetch) throw new Error("server.ts did not hand its fetch handler to serve()");

  world = await buildSweepWorld();
  await seedBusiness(world.a1);
  const sql = getTestClient();
  await sql`UPDATE businesses SET barcodes_enabled = true WHERE id = ${world.a1.id}`;
  sessionId = (await createSession(owner().id, world.tenantA.id)).id;
}, 180_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function expectRefusalBody(body: { error: string; entitlement: { reason: string; upgradePath: string } }, reason: string) {
  expect(body.entitlement).toEqual({ reason, upgradePath: "/settings?tab=billing" });
  expect(body.error.length).toBeGreaterThan(10);
}

describe("REST writes are refused for a read-only organisation", () => {
  it("POST /api/selfImport/:tenantId answers 403 with the entitlement body and the Choose a plan message", async () => {
    await setState("halted");
    const { token } = signImportToken(world.tenantA.id, owner().id);
    const res = await request(`/api/selfImport/${world.tenantA.id}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      body: "x",
      headers: { "content-type": "application/gzip" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expectRefusalBody(body, "read_only_halted");
    expect(body.error).toContain("Choose a plan");
  });

  it("a suspended organisation is refused with tenant_suspended", async () => {
    await setState("suspended");
    const { token } = signImportToken(world.tenantA.id, owner().id);
    const res = await request(`/api/selfImport/${world.tenantA.id}?token=${encodeURIComponent(token)}`, { method: "POST", body: "x" });
    expect(res.status).toBe(403);
    expectRefusalBody(await res.json(), "tenant_suspended");
  });
});

describe("downloads and export stay open while read-only", () => {
  it("invoice PDF, party ledger PDF, label sheet and the data export all work for a halted organisation", async () => {
    await setState("halted");
    const pdf = await request(`/api/invoices/${world.a1.ids.invoice!}/pdf`, { auth: true, business: world.a1.id });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");

    const ledger = await request(`/api/parties/${world.a1.ids.party!}/ledger.pdf`, { auth: true, business: world.a1.id });
    expect(ledger.status).toBe(200);

    const labels = await request("/api/items/labels", {
      auth: true,
      business: world.a1.id,
      method: "POST",
      body: { lines: [{ itemId: world.a1.ids.item!, quantity: 2 }] },
      headers: { "x-requested-with": "fintranzact" },
    });
    expect(labels.status).toBe(200);
    expect(labels.headers.get("content-type")).toBe("application/pdf");

    const { url } = await callerAs(owner(), world.tenantA.id, world.a1.id).selfExport.request({ tenantId: world.tenantA.id });
    const exported = await request(url);
    expect(exported.status).toBe(200);
  });

  it("the same PDF endpoints refuse a suspended organisation", async () => {
    await setState("suspended");
    expect((await request(`/api/invoices/${world.a1.ids.invoice!}/pdf`, { auth: true, business: world.a1.id })).status).toBe(403);
    expect((await request(`/api/parties/${world.a1.ids.party!}/ledger.pdf`, { auth: true, business: world.a1.id })).status).toBe(403);
    expect((await request(`/api/businesses/${world.a1.id}/logo`, { auth: true })).status).toBe(403);
  });
});

describe("POST /webhooks/razorpay", () => {
  const send = (event: string, eventId: string) => {
    const body = JSON.stringify({
      event,
      payload: {
        subscription: { entity: { id: "sub_RESTENT0001" } },
        payment: { entity: { id: `pay_${eventId}`, method: "upi" } },
      },
    });
    const signature = createHmac("sha256", RAZORPAY_SECRET).update(body).digest("hex");
    return request("/webhooks/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId } });
  };

  it("is processed for a halted organisation, and a late renewal reactivates it", async () => {
    await setState("halted");
    const res = await send("subscription.charged", "evt_rest_recover_1");
    expect(res.status).toBe(200);
    const [sub] = await getControlDb().select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, world.tenantA.id));
    expect(sub!.status).toBe("active");
    // Writable again: the tRPC gate no longer refuses.
    await expect(callerAs(owner(), world.tenantA.id, world.a1.id).party.create({ type: "customer", name: "After webhook recovery" } as never)).resolves.toBeDefined();
  });

  it("is also processed for a suspended organisation (the event is recorded; suspension is an admin action)", async () => {
    await setState("halted");
    await getControlDb().update(tenants).set({ status: "suspended" }).where(eq(tenants.id, world.tenantA.id));
    invalidateEntitlements(world.tenantA.id);
    expect((await send("subscription.charged", "evt_rest_suspended_1")).status).toBe(200);
  });
});

describe("POST /webhooks/shipping/:businessId", () => {
  const sign = (body: string) => createHmac("sha256", SHIPPING_SECRET).update(body).digest("hex");
  const send = (awb: string, status: string) => {
    const body = JSON.stringify({ awb, status });
    return request(`/webhooks/shipping/${world.a1.id}`, { method: "POST", body, headers: { "x-webhook-signature": sign(body), "content-type": "application/json" } });
  };

  beforeAll(() => { process.env.MULTI_TENANT = "true"; });
  afterAll(() => { process.env.MULTI_TENANT = "false"; });

  it("records the event for a read-only organisation", async () => {
    await setState("halted");
    const awb = `AWBRO${Date.now()}`;
    const sql = getTestClient();
    await sql`UPDATE shipments SET tracking_number = ${awb} WHERE id = ${world.a1.ids.shipment!}`;
    const res = await send(awb, "in_transit");
    expect(res.status).toBe(200);
    const rows = await sql`SELECT count(*)::int AS n FROM shipment_events WHERE shipment_id = ${world.a1.ids.shipment!} AND status = 'in_transit'`;
    expect(rows[0]!.n).toBe(1);
  });

  it("refuses a suspended organisation and records nothing", async () => {
    await setBothStates("suspended");
    const awb = `AWBSU${Date.now()}`;
    const sql = getTestClient();
    await sql`UPDATE shipments SET tracking_number = ${awb} WHERE id = ${world.a1.ids.shipment!}`;
    const res = await send(awb, "delivered");
    expect(res.status).toBe(404);
    const rows = await sql`SELECT count(*)::int AS n FROM shipment_events WHERE shipment_id = ${world.a1.ids.shipment!} AND status = 'delivered'`;
    expect(rows[0]!.n).toBe(0);
    await resetB();
  });
});

describe("public endpoints are neutral for a read-only organisation", () => {
  it("the store answers 404 'Store not found' with no billing wording (hosted mode)", async () => {
    process.env.MULTI_TENANT = "true";
    try {
      await setBothStates("halted");
      const sql = getTestClient();
      await sql`UPDATE businesses SET store_enabled = true, store_slug = ${"rest-ent-store"} WHERE id = ${world.a1.id}`;
      const res = await request("/store/rest-ent-store/catalog.json");
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toMatch(/plan|trial|billing|suspend/i);
    } finally {
      process.env.MULTI_TENANT = "false";
      await resetB();
    }
  });
});
