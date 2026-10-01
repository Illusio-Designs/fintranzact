/**
 * Router gaps: eInvoice.
 *
 * e-invoicing.test.ts covers the IRP mapping and the main generate/cancel
 * flows. This file covers testConnection, retryFailed, bulkRetry, and the
 * validation, not-found, permission and document-type rules of every
 * procedure.
 *
 * The IRP client is mocked: no request ever leaves the process.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { eInvoiceConfigs, invoices } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createInvoiceWithItems, createParty, createTestWorld, type TestParty, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";

const irp = vi.hoisted(() => {
  class IRPError extends Error {
    constructor(message: string, public readonly code: string, public readonly httpStatus?: number) {
      super(message);
      this.name = "IRPError";
    }
    get isRetryable() {
      return this.code === "RETRYABLE" || (this.httpStatus !== undefined && this.httpStatus >= 500);
    }
  }
  let n = 0;
  return {
    IRPError,
    generateIRN: vi.fn(async () => ({
      irn: `GAPIRN${String(++n).padStart(58, "0")}`,
      ackNo: `1${String(n).padStart(14, "0")}`,
      ackDt: new Date(),
      signedQrCode: "QR",
      signedInvoice: "SIGNED",
    })),
    cancelIRN: vi.fn(async (irn: string) => ({ irn, cancelDate: new Date() })),
    authenticate: vi.fn(async () => undefined),
  };
});

vi.mock("../../lib/irp-client.js", () => {
  class MockIRPClient {
    authenticate = irp.authenticate;
    generateIRN = irp.generateIRN;
    cancelIRN = irp.cancelIRN;
  }
  return { IRPClient: MockIRPClient, IRPError: irp.IRPError };
});

let world: TestWorld;
let b2b: TestParty;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");

const CONFIG = {
  gstin: "27AABCA0000R1ZM",
  clientId: "cid",
  clientSecret: "csecret",
  username: "u",
  password: "p",
  isSandbox: true,
  isEnabled: true,
  thresholdCrore: "5",
};

async function saleInvoice(overrides: Record<string, unknown> = {}) {
  const { invoice } = await createInvoiceWithItems(getTenantTestDb(), world.business1.id, b2b.id,
    [{ description: "Steel", quantity: "2", unitPrice: "500", taxPercent: "18" }], overrides as never);
  return invoice;
}

async function statusOf(id: string) {
  const [row] = await getTenantTestDb().select().from(invoices).where(eq(invoices.id, id));
  return row!;
}

beforeAll(async () => {
  world = await createTestWorld();
  b2b = await createParty(getTenantTestDb(), world.business1.id, {
    name: "IRN Buyer", gstin: "29AABCB0000R1ZM", stateCode: "29", state: "Karnataka",
  });
});

beforeEach(() => {
  irp.generateIRN.mockClear();
  irp.cancelIRN.mockClear();
  irp.authenticate.mockClear();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("before configuration", () => {
  it("getConfig is null; testConnection, cancel and bulkRetry need a config", async () => {
    expect(await caller().eInvoice.getConfig()).toBeNull();
    await expectCode(caller().eInvoice.testConnection(), "NOT_FOUND");
    const inv = await saleInvoice();
    await expectCode(caller().eInvoice.generate({ invoiceId: inv.id }), "PRECONDITION_FAILED");
    await expectCode(caller().eInvoice.cancel({ invoiceId: inv.id, cancelReason: "1" }), "NOT_FOUND");
    await expectCode(caller().eInvoice.bulkRetry(), "PRECONDITION_FAILED");
    expect(irp.generateIRN).not.toHaveBeenCalled();
  });
});

describe("eInvoice.configure / getConfig", () => {
  it("validates input", async () => {
    await expectCode(caller().eInvoice.configure({ ...CONFIG, gstin: "SHORT" }), "BAD_REQUEST");
    await expectCode(caller().eInvoice.configure({ ...CONFIG, username: "" }), "BAD_REQUEST");
    await expectCode(caller().eInvoice.configure({ ...CONFIG, thresholdCrore: "abc" }), "BAD_REQUEST");
  });

  it("clears a cached token when the credentials are saved again", async () => {
    // (Field encryption is a pass-through without ENCRYPTION_KEY, as in tests.)
    await caller().eInvoice.configure(CONFIG);
    const db = getTenantTestDb();
    await db.update(eInvoiceConfigs).set({ authToken: "cached", tokenExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(eInvoiceConfigs.businessId, world.business1.id));
    await caller().eInvoice.configure(CONFIG);
    const [after] = await db.select().from(eInvoiceConfigs).where(eq(eInvoiceConfigs.businessId, world.business1.id));
    expect(after!.authToken).toBeNull();
    const shown = await caller().eInvoice.getConfig();
    expect(shown).toMatchObject({ username: "u", password: "••••••••", clientSecret: "csec••••••••" });
  });

  // Regression (J11 settings journey): the settings form leaves the password
  // and client secret blank ("enter to update"), so re-saving it — to change
  // the threshold, say — was refused (password too short) or, for the client
  // secret, wiped the stored one.
  it("a re-save with the password and client secret left blank keeps the stored ones", async () => {
    await caller().eInvoice.configure(CONFIG);
    await caller().eInvoice.configure({ ...CONFIG, password: "", clientSecret: "", thresholdCrore: "10" });
    const [row] = await getTenantTestDb().select().from(eInvoiceConfigs).where(eq(eInvoiceConfigs.businessId, world.business1.id));
    expect(row).toMatchObject({ password: "p", clientSecret: "csecret", thresholdCrore: "10.00" });
    await caller().eInvoice.configure(CONFIG);
  });

  it("the first save needs a password", async () => {
    await expectCode(other().eInvoice.configure({ ...CONFIG, password: "" }), "BAD_REQUEST");
    expect(await other().eInvoice.getConfig()).toBeNull();
  });

  it("each business has its own config", async () => {
    expect(await other().eInvoice.getConfig()).toBeNull();
  });

  it("sellers can't configure or read the config", async () => {
    await expectCode(seller().eInvoice.configure(CONFIG), "FORBIDDEN");
    await expectCode(seller().eInvoice.getConfig(), "FORBIDDEN");
    await expectCode(seller().eInvoice.testConnection(), "FORBIDDEN");
  });
});

describe("eInvoice.testConnection", () => {
  it("reports success when the IRP authenticates", async () => {
    await expect(caller().eInvoice.testConnection()).resolves.toEqual({ success: true, message: "Successfully connected to IRP" });
    expect(irp.authenticate).toHaveBeenCalledTimes(1);
  });

  it("reports the IRP's message on failure instead of throwing", async () => {
    irp.authenticate.mockRejectedValueOnce(new irp.IRPError("Invalid credentials", "AUTH"));
    await expect(caller().eInvoice.testConnection()).resolves.toEqual({ success: false, message: "Invalid credentials" });
    irp.authenticate.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(caller().eInvoice.testConnection()).resolves.toEqual({ success: false, message: "Connection failed" });
  });

  // Regression (J11 settings journey): with no GSP client credentials saved or
  // on the server, the app stops before calling the IRP — and said only
  // "Connection failed". It now says why.
  it("says when the server has no GSP client credentials, without calling the IRP", async () => {
    const saved = { id: process.env.IRP_CLIENT_ID, secret: process.env.IRP_CLIENT_SECRET };
    delete process.env.IRP_CLIENT_ID;
    delete process.env.IRP_CLIENT_SECRET;
    try {
      await caller().eInvoice.configure({ ...CONFIG, clientId: "", clientSecret: "" });
      await expect(caller().eInvoice.testConnection()).resolves.toEqual({
        success: false,
        message: "IRP GSP credentials are not configured on this server. Contact your administrator.",
      });
      expect(irp.authenticate).not.toHaveBeenCalled();
    } finally {
      if (saved.id !== undefined) process.env.IRP_CLIENT_ID = saved.id;
      if (saved.secret !== undefined) process.env.IRP_CLIENT_SECRET = saved.secret;
      await caller().eInvoice.configure(CONFIG);
    }
  });
});

describe("eInvoice.generate", () => {
  it("NOT_FOUND for unknown, foreign and deleted invoices; validates the id", async () => {
    await expectCode(caller().eInvoice.generate({ invoiceId: UNKNOWN }), "NOT_FOUND");
    const { invoice: theirs } = await createInvoiceWithItems(getTenantTestDb(), world.business2.id, world.party2.id, [{ quantity: "1", unitPrice: "1" }]);
    await expectCode(caller().eInvoice.generate({ invoiceId: theirs.id }), "NOT_FOUND");
    const gone = await saleInvoice({ deletedAt: new Date() });
    await expectCode(caller().eInvoice.generate({ invoiceId: gone.id }), "NOT_FOUND");
    await expectCode(caller().eInvoice.generate({ invoiceId: "x" }), "BAD_REQUEST");
    expect(irp.generateIRN).not.toHaveBeenCalled();
  });

  it("refuses purchase invoices and documents that are not tax invoices or notes", async () => {
    const purchase = await saleInvoice({ type: "purchase" });
    await expectCode(caller().eInvoice.generate({ invoiceId: purchase.id }), "BAD_REQUEST");
    const quote = await saleInvoice({ documentType: "quotation" });
    await expectCode(caller().eInvoice.generate({ invoiceId: quote.id }), "BAD_REQUEST");
    const challan = await saleInvoice({ documentType: "delivery_challan" });
    await expectCode(caller().eInvoice.generate({ invoiceId: challan.id }), "BAD_REQUEST");
    expect(irp.generateIRN).not.toHaveBeenCalled();
    expect((await statusOf(purchase.id)).eInvoiceStatus).toBeNull();
  });

  it("generates for a credit note", async () => {
    const cn = await saleInvoice({ documentType: "credit_note" });
    await expect(caller().eInvoice.generate({ invoiceId: cn.id })).resolves.toMatchObject({ eInvoiceStatus: "generated" });
    expect((irp.generateIRN.mock.calls[0] as unknown[])[0]).toMatchObject({ DocDtls: { Typ: "CRN" } });
  });

  it("a retryable IRP error leaves the invoice pending and counts the attempt", async () => {
    const inv = await saleInvoice();
    irp.generateIRN.mockRejectedValueOnce(new irp.IRPError("IRP down", "RETRYABLE", 503));
    await expectCode(caller().eInvoice.generate({ invoiceId: inv.id }), "INTERNAL_SERVER_ERROR");
    expect(await statusOf(inv.id)).toMatchObject({ eInvoiceStatus: "pending", eInvoiceError: "IRP down", eInvoiceRetryCount: 1 });
  });

  it("refuses to regenerate a cancelled e-invoice", async () => {
    const inv = await saleInvoice({ eInvoiceStatus: "cancelled", irn: "X".repeat(64) });
    await expectCode(caller().eInvoice.generate({ invoiceId: inv.id }), "BAD_REQUEST");
  });

  it("a business without a GSTIN gets a clear error, not a server error", async () => {
    const db = getTenantTestDb();
    const { businesses } = await import("@fintranzact/db");
    await db.update(businesses).set({ gstin: null }).where(eq(businesses.id, world.business1.id));
    try {
      const inv = await saleInvoice();
      await expectCode(caller().eInvoice.generate({ invoiceId: inv.id }), "BAD_REQUEST");
    } finally {
      await db.update(businesses).set({ gstin: world.business1.gstin }).where(eq(businesses.id, world.business1.id));
    }
  });

  it("is refused to a seller", async () => {
    const inv = await saleInvoice();
    await expectCode(seller().eInvoice.generate({ invoiceId: inv.id }), "FORBIDDEN");
  });
});

describe("eInvoice.retryFailed", () => {
  it("retries a failed invoice to generated", async () => {
    const inv = await saleInvoice();
    irp.generateIRN.mockRejectedValueOnce(new irp.IRPError("Bad HSN", "2172"));
    await expectCode(caller().eInvoice.generate({ invoiceId: inv.id }), "BAD_REQUEST");
    expect((await statusOf(inv.id)).eInvoiceStatus).toBe("failed");
    await expect(caller().eInvoice.retryFailed({ invoiceId: inv.id })).resolves.toMatchObject({ eInvoiceStatus: "generated", eInvoiceError: null });
  });

  it("refuses invoices that are not failed or pending", async () => {
    const fresh = await saleInvoice();
    await expectCode(caller().eInvoice.retryFailed({ invoiceId: fresh.id }), "BAD_REQUEST");
    const done = await saleInvoice();
    await caller().eInvoice.generate({ invoiceId: done.id });
    await expectCode(caller().eInvoice.retryFailed({ invoiceId: done.id }), "BAD_REQUEST");
  });

  it("NOT_FOUND for unknown, foreign and deleted invoices; seller refused", async () => {
    await expectCode(caller().eInvoice.retryFailed({ invoiceId: UNKNOWN }), "NOT_FOUND");
    const gone = await saleInvoice({ eInvoiceStatus: "failed", deletedAt: new Date() });
    await expectCode(caller().eInvoice.retryFailed({ invoiceId: gone.id }), "NOT_FOUND");
    const failed = await saleInvoice({ eInvoiceStatus: "failed" });
    await expectCode(other().eInvoice.retryFailed({ invoiceId: failed.id }), "NOT_FOUND");
    await expectCode(seller().eInvoice.retryFailed({ invoiceId: failed.id }), "FORBIDDEN");
  });
});

describe("eInvoice.bulkRetry", () => {
  it("retries every failed and pending invoice and reports the tally", async () => {
    const db = getTenantTestDb();
    // Start from a clean slate for this business's retry queue.
    await db.update(invoices).set({ eInvoiceStatus: null }).where(eq(invoices.businessId, world.business1.id));
    const a = await saleInvoice({ eInvoiceStatus: "failed" });
    const b = await saleInvoice({ eInvoiceStatus: "pending" });
    const c = await saleInvoice({ eInvoiceStatus: "failed" });
    await saleInvoice({ eInvoiceStatus: "failed", deletedAt: new Date() }); // not retried
    irp.generateIRN.mockImplementationOnce(async () => { throw new irp.IRPError("Still bad", "2172"); });

    const res = await caller().eInvoice.bulkRetry();
    expect(res).toEqual({ attempted: 3, succeeded: 2, failed: 1 });
    const statuses = await Promise.all([a, b, c].map((i) => statusOf(i.id).then((r) => r.eInvoiceStatus)));
    expect(statuses.filter((s) => s === "generated")).toHaveLength(2);
    expect(statuses.filter((s) => s === "failed")).toHaveLength(1);
  });

  it("does nothing when nothing needs retrying", async () => {
    const db = getTenantTestDb();
    await db.update(invoices).set({ eInvoiceStatus: null }).where(eq(invoices.businessId, world.business1.id));
    await expect(caller().eInvoice.bulkRetry()).resolves.toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(irp.generateIRN).not.toHaveBeenCalled();
  });

  it("is refused to a seller and needs e-invoicing enabled", async () => {
    await expectCode(seller().eInvoice.bulkRetry(), "FORBIDDEN");
    await caller().eInvoice.configure({ ...CONFIG, isEnabled: false });
    await expectCode(caller().eInvoice.bulkRetry(), "PRECONDITION_FAILED");
    await caller().eInvoice.configure(CONFIG);
  });
});

describe("eInvoice.cancel", () => {
  it("cancels via the IRP and records the reason", async () => {
    const inv = await saleInvoice();
    await caller().eInvoice.generate({ invoiceId: inv.id });
    const res = await caller().eInvoice.cancel({ invoiceId: inv.id, cancelReason: "2", cancelRemarks: "Typo" });
    expect(res).toMatchObject({ eInvoiceStatus: "cancelled", eInvoiceCancelReason: "2" });
    expect(irp.cancelIRN).toHaveBeenCalledWith(res!.irn, "2", "Typo");
    await expectCode(caller().eInvoice.cancel({ invoiceId: inv.id, cancelReason: "2" }), "BAD_REQUEST");
  });

  it("validates the reason and remarks; NOT_FOUND for unknown and foreign invoices", async () => {
    await expectCode(caller().eInvoice.cancel({ invoiceId: UNKNOWN, cancelReason: "5" as never }), "BAD_REQUEST");
    await expectCode(caller().eInvoice.cancel({ invoiceId: UNKNOWN, cancelReason: "1", cancelRemarks: "x".repeat(101) }), "BAD_REQUEST");
    await expectCode(caller().eInvoice.cancel({ invoiceId: UNKNOWN, cancelReason: "1" }), "NOT_FOUND");
    const { invoice: theirs } = await createInvoiceWithItems(getTenantTestDb(), world.business2.id, world.party2.id, [{ quantity: "1", unitPrice: "1" }], { irn: "Y".repeat(64) });
    await expectCode(caller().eInvoice.cancel({ invoiceId: theirs.id, cancelReason: "1" }), "NOT_FOUND");
  });

  it("an IRP failure leaves the IRN active", async () => {
    const inv = await saleInvoice();
    await caller().eInvoice.generate({ invoiceId: inv.id });
    irp.cancelIRN.mockRejectedValueOnce(new irp.IRPError("Already cancelled on portal", "9999"));
    await expect(caller().eInvoice.cancel({ invoiceId: inv.id, cancelReason: "1" })).rejects.toThrow();
    expect((await statusOf(inv.id)).eInvoiceStatus).toBe("generated");
  });

  it("is refused to a seller", async () => {
    const inv = await saleInvoice();
    await expectCode(seller().eInvoice.cancel({ invoiceId: inv.id, cancelReason: "1" }), "FORBIDDEN");
  });
});

describe("eInvoice.dashboard / getStatus", () => {
  it("dashboard filters by date and search and validates input", async () => {
    const inv = await saleInvoice({ eInvoiceStatus: "failed", invoiceNumber: "EINV-SEARCH-1", invoiceDate: new Date("2026-03-10T00:00:00Z") });
    const bySearch = await caller().eInvoice.dashboard({ search: "EINV-SEARCH", page: 1, limit: 10 });
    expect(bySearch.data.map((d) => d.id)).toEqual([inv.id]);
    const byParty = await caller().eInvoice.dashboard({ search: "IRN Buy", page: 1, limit: 100 });
    expect(byParty.data.map((d) => d.id)).toContain(inv.id);
    const outside = await caller().eInvoice.dashboard({ fromDate: "2026-03-11T00:00:00Z", search: "EINV-SEARCH", page: 1, limit: 10 });
    expect(outside.total).toBe(0);
    const inside = await caller().eInvoice.dashboard({ fromDate: "2026-03-01T00:00:00Z", toDate: "2026-03-31T00:00:00Z", search: "EINV-SEARCH", page: 1, limit: 10 });
    expect(inside.total).toBe(1);
    await expectCode(caller().eInvoice.dashboard({ status: "odd" as never, page: 1, limit: 10 }), "BAD_REQUEST");
    await expectCode(caller().eInvoice.dashboard({ fromDate: "March", page: 1, limit: 10 }), "BAD_REQUEST");
    expect((await other().eInvoice.dashboard({ page: 1, limit: 10 })).total).toBe(0);
  });

  it("getStatus is null for unknown and foreign invoices (documented: not NOT_FOUND)", async () => {
    const inv = await saleInvoice({ eInvoiceStatus: "failed" });
    expect(await caller().eInvoice.getStatus({ invoiceId: UNKNOWN })).toBeNull();
    expect(await other().eInvoice.getStatus({ invoiceId: inv.id })).toBeNull();
    await expect(caller().eInvoice.getStatus({ invoiceId: inv.id })).resolves.toMatchObject({ id: inv.id, eInvoiceStatus: "failed" });
  });

  it("a seller cannot read e-invoice status", async () => {
    await expectCode(seller().eInvoice.dashboard({ page: 1, limit: 10 }), "FORBIDDEN");
    await expectCode(seller().eInvoice.getStatus({ invoiceId: UNKNOWN }), "FORBIDDEN");
  });
});
