/**
 * payment-reminders.test.ts — the reminder job, the manual send and the
 * settings procedures against a real Postgres.
 *
 * Invariants:
 *   1. Nothing is sent until the owner turns reminders on.
 *   2. Each slot is sent once per invoice and channel, even if the job runs
 *      twice at once or the process restarts (history row claimed first).
 *   3. Reminders stop when the invoice is paid, and for do-not-remind customers.
 *   4. No email / mobile number for a channel: that channel is skipped.
 *   5. Never more than the configured maximum; quiet hours 09:00-19:00 IST.
 *   6. Read-only organisations get none.
 *   7. One business's reminders, settings and history never reach another's.
 *   8. Manual "Send now": one per invoice per channel per 24 h, logged in history.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, invoices, parties, paymentReminders, type TenantDatabase } from "@fintranzact/db";
import { DEFAULT_PAYMENT_REMINDER_SETTINGS, istStartOfDay, type PaymentReminderSettings } from "@fintranzact/shared";
import { createTestWorld, createParty, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { processPaymentReminders, sendReminderNow, tickTenant, type ReminderDeps } from "../../lib/payment-reminders.js";
import { setSmsProviderForTests, type SmsProvider } from "../../lib/sms.js";
import type { ReminderEmail } from "../../lib/email.js";

let world: TestWorld;
let db: TenantDatabase;

const ownerCaller = () =>
  createTestCaller({ userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name, tenantId: world.tenant1.id, businessId: world.business1.id });
const sellerCaller = () =>
  createTestCaller({ userId: world.suresh.id, email: world.suresh.email, name: world.suresh.name, tenantId: world.tenant1.id, businessId: world.business1.id });
const kiranCaller = () =>
  createTestCaller({ userId: world.kiran.id, email: world.kiran.email, name: world.kiran.name, tenantId: world.tenant2.id, businessId: world.business2.id });

/** A time of day (hours, IST) on an Indian calendar day. */
const ist = (y: number, m: number, d: number, hour = 10) => new Date(istStartOfDay(y, m, d).getTime() + hour * 3600_000);
const DUE = istStartOfDay(2026, 10, 10);
const ON: PaymentReminderSettings = { ...DEFAULT_PAYMENT_REMINDER_SETTINGS, enabled: true };

const sentMail: ReminderEmail[] = [];
const smsSent: Array<{ to: string; body: string }> = [];
const fakeSms: SmsProvider = { name: "fake", send: async (m) => void smsSent.push({ to: m.to, body: m.body }) };
const deps: ReminderDeps = { sendEmail: async (m) => void sentMail.push(m), sms: () => null };
const depsWithSms: ReminderDeps = { ...deps, sms: () => fakeSms };

async function setSettings(businessId: string, settings: PaymentReminderSettings | null) {
  await db.update(businesses).set({ paymentReminderSettings: settings }).where(eq(businesses.id, businessId));
}

async function makeInvoice(opts: { businessId?: string; partyId?: string; status?: "sent" | "partial" | "overdue" | "draft" | "paid" | "cancelled"; paid?: string; due?: Date | null; total?: string } = {}) {
  const businessId = opts.businessId ?? world.business1.id;
  const partyId = opts.partyId ?? world.party1.id;
  const total = opts.total ?? "10000.00";
  const { invoice } = await createInvoiceWithItems(
    world.tenantDb,
    businessId,
    partyId,
    [{ itemName: "Cotton", quantity: "1", unitPrice: total }],
    {
      status: opts.status ?? "sent",
      amountPaid: opts.paid ?? "0.00",
      dueDate: opts.due === undefined ? DUE : opts.due,
      invoiceDate: istStartOfDay(2026, 9, 20),
      totalAmount: total,
    },
  );
  return invoice;
}

const history = (invoiceId: string) => db.select().from(paymentReminders).where(eq(paymentReminders.invoiceId, invoiceId));

beforeAll(async () => {
  world = await createTestWorld();
  db = world.tenantDb as unknown as TenantDatabase;
  void getTestClient;
}, 120_000);

beforeEach(async () => {
  sentMail.length = 0;
  smsSent.length = 0;
  setSmsProviderForTests(null);
  await db.delete(paymentReminders);
  await db.delete(invoices);
  await setSettings(world.business1.id, ON);
  await setSettings(world.business2.id, null);
  await db.update(parties).set({ doNotRemind: false, email: "priya.textiles@example.in", phone: "9123456780" }).where(eq(parties.id, world.party1.id));
});

afterAll(async () => {
  setSmsProviderForTests(undefined);
  await truncateAllTables();
  await closeTestDb();
});

describe("settings", () => {
  it("start off, with the documented defaults", async () => {
    await setSettings(world.business1.id, null);
    const res = await ownerCaller().reminder.getSettings();
    expect(res.settings.enabled).toBe(false);
    expect(res.settings).toMatchObject({ daysBefore: 3, onDueDate: true, repeatEveryDays: 7, maxReminders: 4 });
    expect(res.smsAvailable).toBe(false);
  });

  it("the owner saves them; a seller can read but not change them", async () => {
    await ownerCaller().reminder.updateSettings({ ...ON, daysBefore: 5, channels: { email: true, sms: false, whatsapp: false } });
    const read = await sellerCaller().reminder.getSettings();
    expect(read.settings).toMatchObject({ enabled: true, daysBefore: 5 });
    await expect(sellerCaller().reminder.updateSettings(ON)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects out-of-range values", async () => {
    await expect(ownerCaller().reminder.updateSettings({ ...ON, maxReminders: 99 })).rejects.toThrow();
    await expect(ownerCaller().reminder.updateSettings({ ...ON, templates: { ...ON.templates, email: "" } })).rejects.toThrow();
  });

  it("one business's settings never show up in another's", async () => {
    await ownerCaller().reminder.updateSettings({ ...ON, daysBefore: 9 });
    expect((await kiranCaller().reminder.getSettings()).settings.enabled).toBe(false);
  });
});

describe("the scheduled job", () => {
  it("sends nothing while reminders are off", async () => {
    await setSettings(world.business1.id, { ...ON, enabled: false });
    await makeInvoice();
    const s = await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(s.sent).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  it("sends the due-date reminder once, however often the job runs", async () => {
    const inv = await makeInvoice();
    const now = ist(2026, 10, 10);
    const a = await processPaymentReminders(db, now, deps);
    const b = await processPaymentReminders(db, now, deps);
    const c = await processPaymentReminders(db, ist(2026, 10, 10, 15), deps);
    expect([a.sent, b.sent, c.sent]).toEqual([1, 0, 0]);
    expect(sentMail).toHaveLength(1);
    const rows = await history(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "email", kind: "on_due", slotKey: "due", trigger: "auto", status: "sent" });
  });

  it("two jobs running at the same moment still send once", async () => {
    await makeInvoice();
    const now = ist(2026, 10, 10);
    await Promise.all([processPaymentReminders(db, now, deps), processPaymentReminders(db, now, deps), processPaymentReminders(db, now, deps)]);
    expect(sentMail).toHaveLength(1);
  });

  it("goes before, on and after the due date, weekly, and then stops at the maximum", async () => {
    const inv = await makeInvoice();
    const days: Array<[number, number]> = [[10, 6], [10, 7], [10, 8], [10, 9], [10, 10], [10, 16], [10, 17], [10, 24], [10, 31], [11, 7], [12, 1]];
    const sentOn: string[] = [];
    for (const [m, d] of days) {
      const before = sentMail.length;
      await processPaymentReminders(db, ist(2026, m, d), deps);
      if (sentMail.length > before) sentOn.push(`${m}-${d}`);
    }
    expect(sentOn).toEqual(["10-7", "10-10", "10-17", "10-24"]);
    expect((await history(inv.id)).map((r) => r.slotKey).sort()).toEqual(["after_1", "after_2", "before", "due"]);
  });

  it("writes the customer's name, the balance and the due date into the email, and replies go to the business", async () => {
    await db.update(businesses).set({ email: "accounts@acme.example", legalName: "Acme Trading Co Pvt Ltd" }).where(eq(businesses.id, world.business1.id));
    const inv = await makeInvoice({ status: "partial", paid: "2500.00" });
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail).toHaveLength(1);
    const mail = sentMail[0]!;
    expect(mail.to).toBe("priya.textiles@example.in");
    expect(mail.fromName).toBe("Acme Trading Co Pvt Ltd");
    expect(mail.replyTo).toBe("accounts@acme.example");
    expect(mail.text).toContain("Priya Textiles Pvt Ltd");
    expect(mail.text).toContain("₹7,500.00");
    expect(mail.text).toContain(inv.invoiceNumber);
    expect(mail.text).toContain("reply to this email");
    expect(mail.text).not.toMatch(/\{\{/);
    expect(mail.subject).toContain(inv.invoiceNumber);
    await db.update(businesses).set({ email: null, legalName: null }).where(eq(businesses.id, world.business1.id));
  });

  it("history holds a masked address, never the full one", async () => {
    const inv = await makeInvoice();
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    const [row] = await history(inv.id);
    expect(row!.recipient).toBe("pr***@example.in");
    expect(JSON.stringify(row)).not.toContain("priya.textiles");
  });

  it("stops once the invoice is paid", async () => {
    const inv = await makeInvoice();
    await processPaymentReminders(db, ist(2026, 10, 7), deps);
    expect(sentMail).toHaveLength(1);
    await db.update(invoices).set({ amountPaid: "10000.00", status: "paid" }).where(eq(invoices.id, inv.id));
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    await processPaymentReminders(db, ist(2026, 10, 17), deps);
    expect(sentMail).toHaveLength(1);
  });

  it("stops when the balance is cleared even if the status was not updated yet", async () => {
    await makeInvoice({ paid: "10000.00", status: "sent" });
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail).toHaveLength(0);
  });

  it("ignores drafts, cancelled invoices, deleted invoices, other documents and invoices without a due date", async () => {
    await makeInvoice({ status: "draft" });
    await makeInvoice({ status: "cancelled" });
    await makeInvoice({ due: null });
    const deleted = await makeInvoice();
    await db.update(invoices).set({ deletedAt: new Date() }).where(eq(invoices.id, deleted.id));
    const quote = await makeInvoice();
    await db.update(invoices).set({ documentType: "quotation" }).where(eq(invoices.id, quote.id));
    const credit = await makeInvoice();
    await db.update(invoices).set({ documentType: "credit_note" }).where(eq(invoices.id, credit.id));
    const purchase = await makeInvoice();
    await db.update(invoices).set({ type: "purchase" }).where(eq(invoices.id, purchase.id));
    const s = await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(s.sent).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  it("an invoice already paid by a credit note is not reminded", async () => {
    const inv = await makeInvoice();
    await createInvoiceWithItems(world.tenantDb, world.business1.id, world.party1.id, [{ itemName: "Return", quantity: "1", unitPrice: "10000.00" }], {
      documentType: "credit_note",
      status: "sent",
      referenceDocumentId: inv.id,
    });
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail).toHaveLength(0);
  });

  it("skips a customer marked do-not-remind, and resumes when the flag is cleared", async () => {
    await db.update(parties).set({ doNotRemind: true }).where(eq(parties.id, world.party1.id));
    await makeInvoice();
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail).toHaveLength(0);
    await db.update(parties).set({ doNotRemind: false }).where(eq(parties.id, world.party1.id));
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail).toHaveLength(1);
  });

  it("skips a customer with no email, without writing history", async () => {
    await db.update(parties).set({ email: null }).where(eq(parties.id, world.party1.id));
    const inv = await makeInvoice();
    const s = await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(s.skipped).toBe(1);
    expect(sentMail).toHaveLength(0);
    expect(await history(inv.id)).toHaveLength(0);
  });

  it("sends only between 09:00 and 19:00 India time", async () => {
    await makeInvoice();
    expect((await processPaymentReminders(db, ist(2026, 10, 10, 8), deps)).sent).toBe(0);
    expect((await processPaymentReminders(db, ist(2026, 10, 10, 19), deps)).sent).toBe(0);
    expect((await processPaymentReminders(db, ist(2026, 10, 10, 23), deps)).sent).toBe(0);
    expect((await processPaymentReminders(db, ist(2026, 10, 10, 9), deps)).sent).toBe(1);
  });

  it("a failed send is recorded with its error and is not retried by the schedule", async () => {
    const inv = await makeInvoice();
    const failing: ReminderDeps = { ...deps, sendEmail: async () => { throw new Error("provider down"); } };
    const s = await processPaymentReminders(db, ist(2026, 10, 10), failing);
    expect(s.failed).toBe(1);
    const [row] = await history(inv.id);
    expect(row).toMatchObject({ status: "failed", error: "provider down" });
    await processPaymentReminders(db, ist(2026, 10, 10, 12), deps);
    expect(sentMail).toHaveLength(0);
  });

  it("sends SMS only when the channel is on, a provider is configured and the customer has a number", async () => {
    await setSettings(world.business1.id, { ...ON, channels: { email: false, sms: true, whatsapp: true } });
    const inv = await makeInvoice();
    await processPaymentReminders(db, ist(2026, 10, 10), deps); // no provider
    expect(smsSent).toHaveLength(0);
    await processPaymentReminders(db, ist(2026, 10, 10), depsWithSms);
    expect(smsSent).toHaveLength(1);
    expect(smsSent[0]!.to).toBe("919123456780");
    expect(smsSent[0]!.body).toContain(inv.invoiceNumber);
    expect(sentMail).toHaveLength(0);
    const [row] = await history(inv.id);
    expect(row).toMatchObject({ channel: "sms", status: "sent", recipient: "********6780".slice(-10) });
    // WhatsApp is never sent by the job.
    expect((await history(inv.id)).some((r) => r.channel === "whatsapp")).toBe(false);
  });

  it("puts the payment link in the message when one exists, and leaves the line out when it does not", async () => {
    await makeInvoice();
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail[0]!.text).not.toContain("Pay online");
    await db.delete(paymentReminders);
    sentMail.length = 0;
    await processPaymentReminders(db, ist(2026, 10, 10), { ...deps, paymentLink: async () => "https://pay.example/abc" });
    expect(sentMail[0]!.text).toContain("Pay online: https://pay.example/abc");
  });
});

describe("organisations that are read-only", () => {
  it("send nothing and are not even opened", async () => {
    const process = vi.fn();
    const getDb = vi.fn();
    expect(await tickTenant("t1", { readOnly: async () => true, getDb, process })).toBe("skipped");
    expect(getDb).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    expect(await tickTenant("t1", { readOnly: async () => false, getDb: async () => db as never, process })).toBe("processed");
    expect(process).toHaveBeenCalledTimes(1);
  });
});

describe("one business never reaches another", () => {
  it("each business is reminded with its own settings, name and customers", async () => {
    await db.update(businesses).set({ name: "Acme Trading Co" }).where(eq(businesses.id, world.business1.id));
    await setSettings(world.business2.id, { ...ON, templates: { ...ON.templates, emailSubject: "Kiran says pay {{invoiceNumber}}" } });
    const mine = await makeInvoice();
    const theirs = await makeInvoice({ businessId: world.business2.id, partyId: world.party2.id });
    await db.update(parties).set({ email: "shree@example.in" }).where(eq(parties.id, world.party2.id));
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail).toHaveLength(2);
    const toPriya = sentMail.find((m) => m.to === "priya.textiles@example.in")!;
    const toShree = sentMail.find((m) => m.to === "shree@example.in")!;
    expect(toPriya.fromName).toBe("Acme Trading Co");
    expect(toPriya.text).toContain(mine.invoiceNumber);
    expect(toPriya.text).not.toContain(theirs.invoiceNumber);
    expect(toShree.subject).toBe(`Kiran says pay ${theirs.invoiceNumber}`);
    expect(toShree.text).not.toContain("Priya");
  });

  it("a business with reminders off stays silent while another sends", async () => {
    await makeInvoice();
    const theirs = await makeInvoice({ businessId: world.business2.id, partyId: world.party2.id });
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail).toHaveLength(1);
    expect(await history(theirs.id)).toHaveLength(0);
  });

  it("history and sending are refused across businesses", async () => {
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    const theirs = await makeInvoice({ businessId: world.business2.id, partyId: world.party2.id });
    await expect(ownerCaller().reminder.getForInvoice({ invoiceId: theirs.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller().reminder.sendNow({ invoiceId: theirs.id, channel: "email" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await kiranCaller().reminder.getForInvoice({ invoiceId: theirs.id })).history).toHaveLength(0);
  });

  it("a party from another business cannot be joined onto an invoice", async () => {
    // The job joins parties on (id, business_id): a mismatched party row is never mailed.
    const other = await createParty(world.tenantDb, world.business2.id, { email: "leak@example.in" });
    const inv = await makeInvoice();
    await db.execute(`UPDATE invoices SET party_id = '${other.id}' WHERE id = '${inv.id}'` as never).catch(() => undefined);
    await processPaymentReminders(db, ist(2026, 10, 10), deps);
    expect(sentMail.find((m) => m.to === "leak@example.in")).toBeUndefined();
  });
});

describe("Send reminder now", () => {
  it("sends an email, logs it in the invoice history with who sent it, and allows one per 24 hours", async () => {
    const inv = await makeInvoice({ due: ist(2026, 9, 25, 0) });
    const first = await sellerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "email" });
    expect(first).toMatchObject({ channel: "email", status: "sent" });
    await expect(sellerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "email" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    const info = await ownerCaller().reminder.getForInvoice({ invoiceId: inv.id });
    expect(info.history).toHaveLength(1);
    expect(info.history[0]).toMatchObject({ channel: "email", trigger: "manual", status: "sent", sentByName: "Suresh Sharma" });
    expect(info.channels.email.available).toBe(false);
    expect(info.channels.email.reason).toMatch(/24 hours/);
    expect(info.channels.email.nextAt).toBeInstanceOf(Date);
    expect(JSON.stringify(info)).not.toContain("priya.textiles");
  });

  it("the limit is per channel, and lapses after 24 hours (library, injectable clock)", async () => {
    const inv = await makeInvoice();
    const user = { id: world.ramesh.id, name: "Ramesh" };
    const t0 = ist(2026, 10, 5);
    await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user, now: t0, deps });
    await expect(sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user, now: new Date(t0.getTime() + 3600_000), deps })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // SMS is a different channel
    const s = await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "sms", user, now: t0, deps: depsWithSms });
    expect(s.status).toBe("sent");
    // The limit counts the stored time of the last send, which is real "now": rewind it by a day.
    await db.update(paymentReminders).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(paymentReminders.invoiceId, inv.id));
    await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user, deps });
    expect(sentMail).toHaveLength(2);
  });

  it("a failed manual send is shown in the history and does not use up the day's one", async () => {
    const inv = await makeInvoice();
    const user = { id: world.ramesh.id, name: "Ramesh" };
    const failing: ReminderDeps = { ...deps, sendEmail: async () => { throw new Error("mailbox full"); } };
    await expect(sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user, deps: failing })).rejects.toThrow(/mailbox full/);
    expect((await history(inv.id))[0]).toMatchObject({ status: "failed", error: "mailbox full" });
    await sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user, deps });
    expect(sentMail).toHaveLength(1);
  });

  it("two clicks at once send once", async () => {
    const inv = await makeInvoice();
    const user = { id: world.ramesh.id, name: "Ramesh" };
    const results = await Promise.allSettled([1, 2, 3].map(() => sendReminderNow(db, { businessId: world.business1.id, invoiceId: inv.id, channel: "email", user, deps })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sentMail).toHaveLength(1);
  });

  it("the WhatsApp link is a wa.me link with the message in it, and opening it is logged without sending", async () => {
    const inv = await makeInvoice();
    const info = await ownerCaller().reminder.getForInvoice({ invoiceId: inv.id });
    expect(info.channels.whatsapp.available).toBe(true);
    const url = info.channels.whatsapp.url!;
    expect(url.startsWith("https://wa.me/919123456780?text=")).toBe(true);
    const text = decodeURIComponent(url.split("?text=")[1]!);
    expect(text).toContain(inv.invoiceNumber);
    expect(text).toContain("₹10,000.00");
    const r = await ownerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "whatsapp" });
    expect(r).toMatchObject({ status: "link_opened", url });
    expect(sentMail).toHaveLength(0);
    expect((await ownerCaller().reminder.getForInvoice({ invoiceId: inv.id })).history[0]).toMatchObject({ channel: "whatsapp", status: "link_opened" });
  });

  it("refuses a do-not-remind customer, a paid invoice, a draft, and a missing address", async () => {
    const inv = await makeInvoice();
    await db.update(parties).set({ doNotRemind: true }).where(eq(parties.id, world.party1.id));
    await expect(ownerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "email" })).rejects.toThrow(/do not remind/i);
    const info = await ownerCaller().reminder.getForInvoice({ invoiceId: inv.id });
    expect(info.doNotRemind).toBe(true);
    expect(info.channels.email.available).toBe(false);
    expect(info.channels.whatsapp.available).toBe(false);
    await db.update(parties).set({ doNotRemind: false, email: null }).where(eq(parties.id, world.party1.id));
    await expect(ownerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "email" })).rejects.toThrow(/no email/i);
    const paid = await makeInvoice({ status: "paid", paid: "10000.00" });
    await expect(ownerCaller().reminder.sendNow({ invoiceId: paid.id, channel: "whatsapp" })).rejects.toThrow(/Nothing is due/);
    const draft = await makeInvoice({ status: "draft" });
    await expect(ownerCaller().reminder.sendNow({ invoiceId: draft.id, channel: "whatsapp" })).rejects.toThrow(/draft/i);
  });

  it("SMS says plainly when the server has no provider", async () => {
    const inv = await makeInvoice();
    await expect(ownerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "sms" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const info = await ownerCaller().reminder.getForInvoice({ invoiceId: inv.id });
    expect(info.channels.sms).toMatchObject({ available: false, reason: "SMS is not set up on this server." });
    setSmsProviderForTests(fakeSms);
    expect((await ownerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "sms" })).status).toBe("sent");
    expect(smsSent).toHaveLength(1);
  });

  it("works while reminders are switched off (the switch is for the automatic job)", async () => {
    await setSettings(world.business1.id, null);
    const inv = await makeInvoice();
    expect((await ownerCaller().reminder.sendNow({ invoiceId: inv.id, channel: "email" })).status).toBe("sent");
  });
});

describe("do-not-remind on the party", () => {
  it("is saved by party.update and listed by party.list and party.getById", async () => {
    await ownerCaller().party.update({ id: world.party1.id, data: { doNotRemind: true } });
    expect((await ownerCaller().party.getById({ id: world.party1.id }))?.doNotRemind).toBe(true);
    const list = await ownerCaller().party.list({ page: 1, limit: 50 });
    expect(list.data.find((p) => p.id === world.party1.id)?.doNotRemind).toBe(true);
    const created = await ownerCaller().party.create({ type: "customer", name: "No Nag Ltd", doNotRemind: true, openingBalance: "0" });
    expect(created.doNotRemind).toBe(true);
  });
});
