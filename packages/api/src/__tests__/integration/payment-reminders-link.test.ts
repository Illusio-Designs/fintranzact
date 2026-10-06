/**
 * payment-reminders-link.test.ts — the Razorpay payment link inside payment
 * reminders, against a real Postgres with a mocked Razorpay HTTP layer.
 *
 * Invariants:
 *   1. A reminder that is SENT carries the business's payment link for the
 *      CURRENT balance due; an active link for the same balance is reused,
 *      a changed balance gets a new link (same code path as the invoice page).
 *   2. Previews and listings (getForInvoice, the WhatsApp link) never create
 *      a link: they show an existing current one or none.
 *   3. No Razorpay connection, an ineligible invoice, a balance under Rs 1 or
 *      a failing Razorpay call: no link, the line is left out, and the
 *      reminder itself is still sent.
 *   4. Read-only organisations make no new link.
 *   5. No key or secret ever reaches a reminder, a log or the history.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, controlDb, invoicePaymentLinks, invoices, parties, paymentReminders, tenants, type TenantDatabase } from "@fintranzact/db";
import { DEFAULT_PAYMENT_REMINDER_SETTINGS, istStartOfDay, type PaymentReminderSettings } from "@fintranzact/shared";
import { createTestWorld, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { closeTestDb, truncateAllTables } from "../helpers/test-db.js";
import { processPaymentReminders, sendReminderNow, type ReminderDeps } from "../../lib/payment-reminders.js";
import { reminderPaymentLink } from "../../lib/razorpay/reminder-link.js";
import { setRazorpayFetch } from "../../lib/razorpay/client.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";
import type { ReminderEmail } from "../../lib/email.js";

const KEY_ID = "rzp_test_ReminderKey12";
const KEY_SECRET = "reminder_key_secret_value";

interface Call { method: string; path: string; body: Record<string, any> | null }
let calls: Call[] = [];
let failCreate = false;
let linkSeq = 0;
const creates = () => calls.filter((c) => c.method === "POST" && c.path === "/payment_links");

function installRazorpay() {
  setRazorpayFetch(async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (method === "GET" && path === "/payment_links") return json(200, { payment_links: [] });
    if (method === "POST" && path === "/payment_links") {
      if (failCreate) return json(500, { error: { description: "boom" } });
      linkSeq += 1;
      return json(200, { id: `plink_Rem${linkSeq}`, short_url: `https://rzp.io/i/rem${linkSeq}`, status: "created", amount: body!.amount });
    }
    if (method === "POST" && /^\/payment_links\/[^/]+\/cancel$/.test(path)) return json(200, { status: "cancelled" });
    return json(404, { error: { description: "unexpected call" } });
  });
}

let world: TestWorld;
let db: TenantDatabase;
const owner = () =>
  createTestCaller({ userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name, tenantId: world.tenant1.id, businessId: world.business1.id });
const user = () => ({ id: world.ramesh.id, name: "Ramesh" });

const ist = (y: number, m: number, d: number, hour = 10) => new Date(istStartOfDay(y, m, d).getTime() + hour * 3600_000);
const DUE = istStartOfDay(2026, 10, 10);
const ON: PaymentReminderSettings = { ...DEFAULT_PAYMENT_REMINDER_SETTINGS, enabled: true };
const sentMail: ReminderEmail[] = [];
const deps: ReminderDeps = { sendEmail: async (m) => void sentMail.push(m), sms: () => null, tenantId: undefined };

async function makeInvoice(opts: { status?: "sent" | "draft" | "paid" | "cancelled"; total?: string; paid?: string } = {}) {
  const total = opts.total ?? "10000.00";
  const { invoice } = await createInvoiceWithItems(
    world.tenantDb,
    world.business1.id,
    world.party1.id,
    [{ itemName: "Cotton", quantity: "1", unitPrice: total }],
    { status: opts.status ?? "sent", amountPaid: opts.paid ?? "0.00", dueDate: DUE, invoiceDate: istStartOfDay(2026, 9, 20), totalAmount: total },
  );
  return invoice;
}

const links = (invoiceId: string) => db.select().from(invoicePaymentLinks).where(eq(invoicePaymentLinks.invoiceId, invoiceId));

beforeAll(async () => {
  world = await createTestWorld();
  db = world.tenantDb as unknown as TenantDatabase;
  installRazorpay();
}, 120_000);

beforeEach(async () => {
  sentMail.length = 0;
  calls = [];
  failCreate = false;
  await db.delete(paymentReminders);
  await db.delete(invoicePaymentLinks);
  await db.delete(invoices);
  await db.update(businesses).set({ paymentReminderSettings: ON }).where(eq(businesses.id, world.business1.id));
  await db.update(parties).set({ doNotRemind: false, email: "priya.textiles@example.in", phone: "9123456780" }).where(eq(parties.id, world.party1.id));
});

afterEach(() => {
  failCreate = false;
});

afterAll(async () => {
  setRazorpayFetch(null);
  await truncateAllTables();
  await closeTestDb();
});

async function connect() {
  await owner().onlinePayments.connect({ keyId: KEY_ID, keySecret: KEY_SECRET });
  calls = [];
}

describe("without a Razorpay connection", () => {
  it("sends the reminder with no link line and never calls Razorpay", async () => {
    await makeInvoice();
    const s = await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(s.sent).toBe(1);
    expect(sentMail[0]!.text).not.toContain("Pay online");
    expect(calls).toHaveLength(0);
  });
});

describe("with Razorpay connected", () => {
  beforeAll(async () => {
    await connect();
  });

  it("the scheduled reminder creates and carries the link for the balance due", async () => {
    const inv = await makeInvoice({ total: "10000.00", paid: "2500.00" });
    const s = await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(s.sent).toBe(1);
    expect(sentMail[0]!.text).toContain("Pay online: https://rzp.io/i/rem");
    expect(creates()).toHaveLength(1);
    expect(creates()[0]!.body!.amount).toBe(750000); // the balance, in paise
    expect(await links(inv.id)).toHaveLength(1);
    // Neither the keys nor the link-creation payload secrets leak into the mail.
    expect(JSON.stringify(sentMail)).not.toContain(KEY_SECRET);
  });

  it("reuses the active link while the balance is unchanged, and makes a new one when it moves", async () => {
    const inv = await makeInvoice({ total: "10000.00" });
    const t0 = ist(2026, 10, 10);
    await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user: user(), now: t0, deps });
    expect(creates()).toHaveLength(1);
    const first = sentMail[0]!.text.match(/https:\/\/rzp\.io\/i\/rem\d+/)![0];

    // Another channel for the same unchanged balance: the same link.
    const wa = await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "whatsapp", user: user(), now: t0, deps });
    expect(creates()).toHaveLength(1);
    expect(decodeURIComponent(wa.url!)).toContain(first);

    // A part payment: the next reminder asks for the new balance with a new link.
    await db.update(invoices).set({ amountPaid: "4000.00" }).where(eq(invoices.id, inv.id));
    await db.delete(paymentReminders);
    sentMail.length = 0;
    await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user: user(), now: t0, deps });
    expect(creates()).toHaveLength(2);
    expect(creates()[1]!.body!.amount).toBe(600000);
    expect(sentMail[0]!.text).not.toContain(first);
    const rows = await links(inv.id);
    expect(rows.filter((r) => r.status === "created")).toHaveLength(1);
  });

  it("listing and the WhatsApp preview never create a link", async () => {
    const inv = await makeInvoice();
    const info = await owner().reminder.getForInvoice({ invoiceId: inv.id });
    expect(creates()).toHaveLength(0);
    expect(info.channels.whatsapp.available).toBe(true);
    expect(decodeURIComponent(info.channels.whatsapp.url!)).not.toContain("rzp.io");
    expect(await links(inv.id)).toHaveLength(0);

    // Once a current link exists (made by a send), the WhatsApp preview shows it.
    await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user: user(), now: ist(2026, 10, 10), deps });
    const after = await owner().reminder.getForInvoice({ invoiceId: inv.id });
    expect(decodeURIComponent(after.channels.whatsapp.url!)).toMatch(/https:\/\/rzp\.io\/i\/rem\d+/);
    expect(creates()).toHaveLength(1);

    // A stale link (balance moved) is not shown, and not replaced by a preview.
    await db.update(invoices).set({ amountPaid: "1000.00" }).where(eq(invoices.id, inv.id));
    const stale = await owner().reminder.getForInvoice({ invoiceId: inv.id });
    expect(decodeURIComponent(stale.channels.whatsapp.url!)).not.toContain("rzp.io");
    expect(creates()).toHaveLength(1);
  });

  it("the router's sendNow carries the link", async () => {
    const inv = await makeInvoice();
    await owner().reminder.sendNow({ invoiceId: inv.id, channel: "whatsapp" }).then((r) => {
      expect(decodeURIComponent(r.url!)).toMatch(/https:\/\/rzp\.io\/i\/rem\d+/);
    });
    expect(creates()).toHaveLength(1);
  });

  it("a failing Razorpay call never blocks the reminder: sent, no link line", async () => {
    await makeInvoice();
    failCreate = true;
    const s = await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(s).toMatchObject({ sent: 1, failed: 0 });
    expect(sentMail[0]!.text).not.toContain("Pay online");
    const [row] = await db.select().from(paymentReminders);
    expect(row).toMatchObject({ status: "sent", error: null });
  });

  it("a balance under Rs 1 gets no link but is still reminded by hand", async () => {
    const inv = await makeInvoice({ total: "100.00", paid: "99.50" });
    await db.update(parties).set({ doNotRemind: false }).where(eq(parties.id, world.party1.id));
    expect(await reminderPaymentLink(db, world.business1.id, inv.id, { create: true })).toBeNull();
    expect(creates()).toHaveLength(0);
  });

  it("draft, cancelled and paid invoices get no link", async () => {
    for (const status of ["draft", "cancelled", "paid"] as const) {
      const inv = await makeInvoice({ status });
      expect(await reminderPaymentLink(db, world.business1.id, inv.id, { create: true })).toBeNull();
    }
    expect(creates()).toHaveLength(0);
  });

  it("an unknown invoice, or one from another business, gets no link", async () => {
    expect(await reminderPaymentLink(db, world.business1.id, "00000000-0000-4000-8000-000000000000", { create: true })).toBeNull();
    const inv = await makeInvoice();
    expect(await reminderPaymentLink(db, world.business2.id, inv.id, { create: true })).toBeNull();
  });

  it("create:false only reads", async () => {
    const inv = await makeInvoice();
    expect(await reminderPaymentLink(db, world.business1.id, inv.id, { create: false })).toBeNull();
    expect(creates()).toHaveLength(0);
    const url = await reminderPaymentLink(db, world.business1.id, inv.id, { create: true });
    expect(url).toMatch(/^https:\/\/rzp\.io\/i\/rem/);
    expect(await reminderPaymentLink(db, world.business1.id, inv.id, { create: false })).toBe(url);
    expect(creates()).toHaveLength(1);
  });

  it("a read-only organisation makes no new link", async () => {
    const inv = await makeInvoice();
    const [t] = await controlDb.select({ trialEndsAt: tenants.trialEndsAt }).from(tenants).where(eq(tenants.id, world.tenant1.id));
    await controlDb.update(tenants).set({ trialEndsAt: new Date(Date.now() - 86_400_000) }).where(eq(tenants.id, world.tenant1.id));
    invalidateEntitlements(world.tenant1.id);
    try {
      expect(await reminderPaymentLink(db, world.business1.id, inv.id, { create: true, tenantId: world.tenant1.id })).toBeNull();
      expect(creates()).toHaveLength(0);
    } finally {
      await controlDb.update(tenants).set({ trialEndsAt: t?.trialEndsAt ?? null }).where(eq(tenants.id, world.tenant1.id));
      invalidateEntitlements(world.tenant1.id);
    }
  });
});
