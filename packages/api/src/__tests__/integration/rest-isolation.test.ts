/**
 * rest-isolation.test.ts — tenant and business isolation for the REST routes
 * in server.ts / http/ (the ones outside tRPC): invoice PDF, party ledger PDF,
 * business logo/signature, barcode labels, public share links, the data
 * export stream, the shipping webhook and the public store.
 *
 * Same world as the tRPC sweeps (helpers/sweep-world.ts): org A with A1 (whole
 * team) and A2 (owner only), org B with B1 — all in one shared database, as in
 * self-hosted mode. Requests go through the real Hono app (server.ts) with
 * `serve` stubbed out, authenticated with a session id as a Bearer token.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import tarStream from "tar-stream";
import {
  buildSweepWorld,
  seedBusiness,
  callerAs,
  fingerprint,
  changedTables,
  CANARY,
  type SweepWorld,
  type SweepBusiness,
} from "../helpers/sweep-world.js";
import { createSession, type TestUser } from "../helpers/fixtures.js";
import { getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// server.ts starts listening and installs process-wide handlers on import.
// Capture the fetch handler instead of listening, and keep its exit-on-error
// handlers out of the shared test process.
const captured = vi.hoisted(() => ({ fetch: null as null | ((req: Request) => Promise<Response>) }));
vi.mock("@hono/node-server", () => ({
  serve: (opts: { fetch: (req: Request) => Promise<Response> }) => {
    captured.fetch = opts.fetch;
    return { close: () => undefined };
  },
}));

const ORIGIN = "https://app.sweep.test";
let world: SweepWorld;
const sessions = new Map<string, string>();

async function sessionFor(user: TestUser, tenantId: string): Promise<string> {
  const key = `${user.id}:${tenantId}`;
  if (!sessions.has(key)) sessions.set(key, (await createSession(user.id, tenantId)).id);
  return sessions.get(key)!;
}

async function request(
  path: string,
  opts: { as?: TestUser; tenantId?: string; business?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN, ...opts.headers };
  if (opts.as) headers.authorization = `Bearer ${await sessionFor(opts.as, opts.tenantId ?? world.tenantA.id)}`;
  if (opts.business) headers["x-business-id"] = opts.business;
  if (opts.body !== undefined && typeof opts.body !== "string") headers["content-type"] = "application/json";
  return captured.fetch!(new Request(`http://localhost${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  }));
}

/** Response body as text (PDFs included: their text streams carry names). */
async function bodyText(res: Response): Promise<string> {
  return Buffer.from(await res.arrayBuffer()).toString("latin1");
}

function markersOf(b: SweepBusiness): string[] {
  return [b.tag, b.id, ...Object.values(b.ids)];
}

beforeAll(async () => {
  process.env.CORS_ORIGINS = ORIGIN;
  process.env.SHIPPING_WEBHOOK_SECRET = "sweep-webhook-secret";
  process.env.DISABLE_RATE_LIMIT = "1";
  const realOn = process.on.bind(process);
  const spy = vi.spyOn(process, "on").mockImplementation(((event: string, fn: (...a: unknown[]) => void) =>
    ["unhandledRejection", "uncaughtException", "SIGINT", "SIGTERM"].includes(event) ? process : realOn(event, fn)) as typeof process.on);
  await import("../../server.js");
  spy.mockRestore();
  if (!captured.fetch) throw new Error("server.ts did not hand its fetch handler to serve()");

  world = await buildSweepWorld();
  await seedBusiness(world.a1);
  await seedBusiness(world.a2);
  await seedBusiness(world.b1);
  // Labels need barcodes switched on.
  const sql = getTestClient();
  await sql`UPDATE businesses SET barcodes_enabled = true WHERE id IN (${world.a1.id}, ${world.b1.id})`;
}, 180_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("GET /api/invoices/:id/pdf", () => {
  const path = (id: string) => `/api/invoices/${id}/pdf`;

  it("serves the caller's own invoice", async () => {
    const res = await request(path(world.a1.ids.invoice!), { as: world.usersA.owner, business: world.a1.id });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("refuses another org's business in x-business-id", async () => {
    const res = await request(path(world.b1.ids.invoice!), { as: world.usersA.owner, business: world.b1.id });
    expect(res.status).toBe(403);
  });

  it("does not find another org's invoice from the caller's business", async () => {
    const res = await request(path(world.b1.ids.invoice!), { as: world.usersA.owner, business: world.a1.id });
    expect(res.status).toBe(404);
  });

  it("refuses a business the caller is not a member of", async () => {
    const res = await request(path(world.a2.ids.invoice!), { as: world.usersA.seller, business: world.a2.id });
    expect(res.status).toBe(403);
  });

  it("does not find another business's invoice from the caller's business", async () => {
    const res = await request(path(world.a2.ids.invoice!), { as: world.usersA.seller, business: world.a1.id });
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    expect((await request(path(world.a1.ids.invoice!), { business: world.a1.id })).status).toBe(401);
  });
});

describe("GET /api/parties/:id/ledger.pdf", () => {
  const path = (id: string) => `/api/parties/${id}/ledger.pdf`;

  it("serves the caller's own party", async () => {
    const res = await request(path(world.a1.ids.party!), { as: world.usersA.seller, business: world.a1.id });
    expect(res.status).toBe(200);
  });

  it("refuses foreign businesses and does not find foreign parties", async () => {
    expect((await request(path(world.b1.ids.party!), { as: world.usersA.owner, business: world.b1.id })).status).toBe(403);
    expect((await request(path(world.b1.ids.party!), { as: world.usersA.owner, business: world.a1.id })).status).toBe(404);
    expect((await request(path(world.a2.ids.party!), { as: world.usersA.seller, business: world.a2.id })).status).toBe(403);
    expect((await request(path(world.a2.ids.party!), { as: world.usersA.seller, business: world.a1.id })).status).toBe(404);
  });
});

describe("GET /api/businesses/:id/logo and /signature", () => {
  for (const kind of ["logo", "signature"] as const) {
    it(`${kind}: own business ok, foreign ones refused`, async () => {
      expect((await request(`/api/businesses/${world.a1.id}/${kind}`, { as: world.usersA.seller })).status).toBe(200);
      expect((await request(`/api/businesses/${world.b1.id}/${kind}`, { as: world.usersA.owner })).status).toBe(403);
      expect((await request(`/api/businesses/${world.a2.id}/${kind}`, { as: world.usersA.seller })).status).toBe(403);
    });
  }
});

describe("POST /api/items/labels", () => {
  const labels = (itemId: string) => ({ lines: [{ itemId, quantity: 1 }] });

  it("prints the caller's own item", async () => {
    const res = await request("/api/items/labels", { as: world.usersA.owner, business: world.a1.id, method: "POST", body: labels(world.a1.ids.item!) });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-labels-printed")).toBe("1");
  });

  it("refuses another org's or a non-member business", async () => {
    expect((await request("/api/items/labels", { as: world.usersA.owner, business: world.b1.id, method: "POST", body: labels(world.b1.ids.item!) })).status).toBe(403);
    expect((await request("/api/items/labels", { as: world.usersA.seller, business: world.a2.id, method: "POST", body: labels(world.a2.ids.item!) })).status).toBe(403);
  });

  it("prints nothing for another org's item or variant from the caller's business", async () => {
    const res = await request("/api/items/labels", {
      as: world.usersA.owner,
      business: world.a1.id,
      method: "POST",
      body: { lines: [
        { itemId: world.b1.ids.item!, quantity: 1 },
        { itemId: world.a1.ids.variantItem!, variantId: world.b1.ids.variant!, quantity: 1 },
      ] },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-labels-printed")).toBe("0");
    expect(await bodyText(res)).not.toContain(CANARY);
  });
});

describe("public share links", () => {
  async function tokenFor(b: SweepBusiness): Promise<string> {
    const link = await callerAs(b.owner, b.tenantId, b.id).share.create({ documentId: b.ids.invoice! });
    return new URL(link.url, "http://localhost").pathname.split("/").pop()!;
  }

  it("a token opens exactly its own document", async () => {
    const tokenA = await tokenFor(world.a1);
    const res = await request(`/api/share/${tokenA}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(CANARY);
    for (const m of markersOf(world.b1)) expect(body).not.toContain(m);
  });

  it("unknown and revoked tokens answer 404", async () => {
    expect((await request("/api/share/not-a-real-token")).status).toBe(404);
    expect((await request("/api/share/not-a-real-token/pdf")).status).toBe(404);
    const tokenB = await tokenFor(world.b1);
    expect((await request(`/api/share/${tokenB}`)).status).toBe(200);
    await callerAs(world.ownerB, world.tenantB.id, world.b1.id).share.revoke({ documentId: world.b1.ids.invoice! });
    expect((await request(`/api/share/${tokenB}`)).status).toBe(404);
    expect((await request(`/api/share/${tokenB}/pdf`)).status).toBe(404);
    expect((await request(`/api/share/${tokenB}/logo`)).status).toBe(404);
  });

  it("org A cannot create or revoke a link for org B's document", async () => {
    const owner = callerAs(world.usersA.owner, world.tenantA.id, world.a1.id);
    await expect(owner.share.create({ documentId: world.b1.ids.invoice! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.share.revoke({ documentId: world.b1.ids.invoice! })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("GET /api/export/:tenantId", () => {
  async function entries(res: Response): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const extract = tarStream.extract();
    const done = new Promise<void>((resolve, reject) => {
      extract.on("entry", (header, stream, next) => {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => { out.set(header.name, Buffer.concat(chunks).toString("utf8")); next(); });
        stream.resume();
      });
      extract.on("finish", resolve);
      extract.on("error", reject);
    });
    Readable.from(gunzipSync(Buffer.from(await res.arrayBuffer()))).pipe(extract);
    await done;
    return out;
  }

  it("exports only the requesting organisation's businesses", async () => {
    const owner = callerAs(world.usersA.owner, world.tenantA.id, world.a1.id);
    const { url } = await owner.selfExport.request({ tenantId: world.tenantA.id });
    const res = await request(url);
    expect(res.status).toBe(200);
    const files = await entries(res);
    const manifest = JSON.parse(files.get("manifest.json")!) as { businessIds: string[] };
    expect(new Set(manifest.businessIds)).toEqual(new Set([world.a1.id, world.a2.id]));
    const all = [...files.values()].join("\n");
    expect(all).toContain(world.a1.ids.party!);
    expect(all).not.toContain(CANARY);
    for (const m of markersOf(world.b1)) expect(all).not.toContain(m);
  });

  it("a token for one organisation cannot export another", async () => {
    const owner = callerAs(world.usersA.owner, world.tenantA.id, world.a1.id);
    const { url } = await owner.selfExport.request({ tenantId: world.tenantA.id });
    const token = new URL(url, "http://localhost").searchParams.get("token")!;
    const res = await request(`/api/export/${world.tenantB.id}?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
    await expect(owner.selfExport.request({ tenantId: world.tenantB.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("POST /webhooks/shipping/:businessId", () => {
  const sign = (body: string) => createHmac("sha256", process.env.SHIPPING_WEBHOOK_SECRET!).update(body).digest("hex");

  it("never records an event on another business's shipment", async () => {
    const sql = getTestClient();
    const awb = `AWB${Date.now()}`;
    await sql`UPDATE shipments SET tracking_number = ${awb} WHERE id = ${world.b1.ids.shipment!}`;
    const before = await fingerprint({ businessIds: [world.b1.id] });
    const body = JSON.stringify({ awb, status: "delivered" });
    const res = await request(`/webhooks/shipping/${world.a1.id}`, {
      method: "POST",
      body,
      headers: { "x-webhook-signature": sign(body), "content-type": "application/json" },
    });
    expect(res.status).toBe(404);
    expect(changedTables(before, await fingerprint({ businessIds: [world.b1.id] }))).toEqual([]);
  });

  it("rejects an unsigned call", async () => {
    const res = await request(`/webhooks/shipping/${world.b1.id}`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});

describe("public store", () => {
  beforeAll(async () => {
    const sql = getTestClient();
    await sql`UPDATE businesses SET store_enabled = true, store_slug = ${"sweep-store-a1"} WHERE id = ${world.a1.id}`;
    await sql`UPDATE items SET store_enabled = true WHERE id IN (${world.a1.ids.item!}, ${world.b1.ids.item!})`;
  });

  it("a store's catalog lists only its own business's items", async () => {
    const res = await request("/store/sweep-store-a1/catalog.json");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(world.a1.ids.item!);
    expect(body).not.toContain(CANARY);
    expect(body).not.toContain(world.b1.ids.item!);
  });

  it("an order through one store cannot buy another business's item", async () => {
    const before = await fingerprint({ businessIds: [world.b1.id] });
    const res = await request("/store/sweep-store-a1/order", {
      method: "POST",
      body: {
        customerName: "Sweep Buyer",
        customerPhone: "9876543210",
        items: [{ itemId: world.b1.ids.item!, quantity: 1 }],
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(changedTables(before, await fingerprint({ businessIds: [world.b1.id] }))).toEqual([]);
  });
});
