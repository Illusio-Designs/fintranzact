/**
 * Payment reminders for unpaid sales invoices.
 *
 * What is due is the pure planAutoReminder (@fintranzact/shared). This file is
 * the job and the manual send around it:
 *
 *  - Off by default: nothing is sent for a business until its owner turns
 *    reminders on (businesses.payment_reminder_settings.enabled).
 *  - One row in payment_reminders per (invoice, channel, slot), inserted BEFORE
 *    the message goes out (UNIQUE), so a restart or a second instance never
 *    sends a slot twice. A failed send keeps its row (status "failed", with the
 *    error) and is not retried by the schedule: a person can send it by hand.
 *  - Stops at payment (the invoice is no longer outstanding), when the invoice
 *    is cancelled/deleted/draft, and when the customer is marked do-not-remind.
 *  - A customer with no email (or no usable mobile number) is skipped for that
 *    channel. WhatsApp is never sent automatically: it is a click-to-send link
 *    shown on the invoice (the WhatsApp Business API is not connected).
 *  - Quiet hours: automatic reminders go out only 09:00 - 19:00 India time.
 *  - Read-only and suspended organisations get none (tickTenant, like the
 *    recurring invoice scheduler).
 *  - Logs carry counts and ids only, never an address, number or message.
 */

import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getTenantDb, controlDb, tenants, businesses, invoices, parties, paymentReminders, type TenantDatabase } from "@fintranzact/db";
import {
  buildReminderVariables,
  buildWhatsAppLink,
  isWithinReminderHours,
  manualReminderAvailableAt,
  maskEmail,
  maskPhone,
  normalizeIndianMobile,
  planAutoReminder,
  renderReminderLine,
  renderReminderTemplate,
  resolveReminderSettings,
  type PaymentReminderSettings,
  type ReminderChannel,
  type ReminderKind,
  type ReminderVariables,
} from "@fintranzact/shared";
import { emailService, buildReminderEmail, type ReminderEmail } from "./email.js";
import { getEntitlements } from "./entitlements.js";
import { getSmsProvider, type SmsProvider } from "./sms.js";
import { outstandingOnRow } from "./outstanding.js";
import { logger } from "./logger.js";
import { reminderPaymentLink } from "./razorpay/reminder-link.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60_000;
/** Invoices looked at per business per run. */
const MAX_INVOICES_PER_RUN = 500;
const ERROR_MAX = 300;
const isMultiTenant = process.env.MULTI_TENANT === "true";
let timer: ReturnType<typeof setInterval> | null = null;

export interface ReminderDeps {
  sendEmail?: (mail: ReminderEmail) => Promise<void>;
  /** The SMS provider, or null when SMS is not configured. */
  sms?: () => SmsProvider | null;
  /**
   * The payment link to put in {{paymentLink}} for an invoice, or null (the
   * placeholder, and its line, are then left out). The default is the
   * business's Razorpay link for the current balance due (lib/razorpay/
   * reminder-link.ts). `create` is true only when a reminder is about to be
   * sent; previews and listings pass false and never make a link.
   */
  paymentLink?: (db: TenantDatabase, businessId: string, invoiceId: string, opts: { create: boolean }) => Promise<string | null>;
  /** The organisation this run is for (multi-tenant): read-only ones make no links. */
  tenantId?: string;
}

/** No link at all (tests, or callers that want none). */
export async function noPaymentLink(): Promise<string | null> {
  return null;
}

/** The link for an invoice's reminder: never throws, never blocks the reminder. */
async function resolvePaymentLink(db: TenantDatabase, deps: ReminderDeps, businessId: string, invoiceId: string, create: boolean): Promise<string | null> {
  const fn = deps.paymentLink ?? ((d, b, i, o) => reminderPaymentLink(d, b, i, { ...o, tenantId: deps.tenantId }));
  return fn(db, businessId, invoiceId, { create }).catch(() => null);
}

interface BusinessRow {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  settings: PaymentReminderSettings;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  status: string;
  balance: number;
  partyId: string;
  partyName: string;
  partyEmail: string | null;
  partyPhone: string | null;
  doNotRemind: boolean;
}

function businessDisplayName(b: { name: string; legalName: string | null }): string {
  return b.legalName || b.name;
}

/** The invoice statuses a reminder can still be about. */
const REMINDABLE_STATUSES = ["sent", "partial", "overdue"] as const;

const invoiceSelect = {
  id: invoices.id,
  invoiceNumber: invoices.invoiceNumber,
  invoiceDate: invoices.invoiceDate,
  dueDate: invoices.dueDate,
  status: invoices.status,
  balance: sql<string>`(${outstandingOnRow})::text`,
  partyId: invoices.partyId,
  partyName: parties.name,
  partyEmail: parties.email,
  partyPhone: parties.phone,
  doNotRemind: parties.doNotRemind,
};

function toInvoiceRow(r: { balance: string } & Omit<InvoiceRow, "balance">): InvoiceRow {
  return { ...r, balance: parseFloat(r.balance) };
}

function buildMessage(
  business: BusinessRow,
  inv: InvoiceRow,
  channel: ReminderChannel,
  now: Date,
  paymentLink: string | null,
): { vars: ReminderVariables; subject: string; body: string } {
  const vars = buildReminderVariables({
    customerName: inv.partyName,
    invoiceNumber: inv.invoiceNumber,
    balanceDue: inv.balance,
    dueDate: inv.dueDate,
    businessName: businessDisplayName(business),
    paymentLink,
    now,
  });
  const t = business.settings.templates;
  if (channel === "email") {
    return { vars, subject: renderReminderLine(t.emailSubject, vars), body: renderReminderTemplate(t.email, vars) };
  }
  if (channel === "sms") return { vars, subject: "", body: renderReminderLine(t.sms, vars) };
  return { vars, subject: "", body: renderReminderTemplate(t.whatsapp, vars) };
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Provider errors never carry the customer's address here, but keep the history short and single-line.
  return msg.replace(/\s+/g, " ").slice(0, ERROR_MAX);
}

interface DeliverInput {
  business: BusinessRow;
  inv: InvoiceRow;
  channel: ReminderChannel;
  kind: ReminderKind;
  slotKey: string;
  trigger: "auto" | "manual";
  user?: { id: string; name: string } | null;
  now: Date;
  deps: ReminderDeps;
  /** A claim row already inserted by the caller (manual sends claim under a lock). */
  claimedId?: string;
}

/**
 * Claim the slot, send, and record the outcome. Returns "duplicate" when
 * somebody else already holds the slot (nothing is sent in that case).
 */
async function deliver(db: TenantDatabase, input: DeliverInput): Promise<{ outcome: "sent" | "failed" | "duplicate"; error?: string; rowId?: string }> {
  const { business, inv, channel, now, deps } = input;
  const recipient = channel === "email" ? inv.partyEmail : inv.partyPhone;
  const masked = recipient ? (channel === "email" ? maskEmail(recipient) : maskPhone(recipient)) : null;

  let rowId = input.claimedId;
  if (!rowId) {
    const [claimed] = await db
      .insert(paymentReminders)
      .values({
        businessId: business.id,
        invoiceId: inv.id,
        channel,
        kind: input.kind,
        slotKey: input.slotKey,
        trigger: input.trigger,
        status: "sending",
        recipient: masked,
        sentByUserId: input.user?.id ?? null,
        sentByName: input.user?.name ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: paymentReminders.id });
    if (!claimed) return { outcome: "duplicate" };
    rowId = claimed.id;
  }

  try {
    const link = await resolvePaymentLink(db, deps, business.id, inv.id, true);
    const msg = buildMessage(business, inv, channel, now, link);
    if (channel === "email") {
      if (!inv.partyEmail) throw new Error("The customer has no email address");
      const built = buildReminderEmail({ subject: msg.subject, text: msg.body, businessName: businessDisplayName(business) });
      await (deps.sendEmail ?? ((m) => emailService.sendReminder(m)))({
        to: inv.partyEmail,
        fromName: businessDisplayName(business),
        replyTo: business.email,
        subject: built.subject,
        text: built.text,
        html: built.html,
      });
    } else if (channel === "sms") {
      const provider = (deps.sms ?? getSmsProvider)();
      const to = normalizeIndianMobile(inv.partyPhone);
      if (!provider) throw new Error("SMS is not set up on this server");
      if (!to) throw new Error("The customer has no usable mobile number");
      await provider.send({ to, body: msg.body, variables: msg.vars });
    }
    await db.update(paymentReminders).set({ status: channel === "whatsapp" ? "link_opened" : "sent" }).where(eq(paymentReminders.id, rowId));
    return { outcome: "sent", rowId };
  } catch (err) {
    const error = errorText(err);
    await db.update(paymentReminders).set({ status: "failed", error }).where(eq(paymentReminders.id, rowId)).catch(() => {});
    return { outcome: "failed", error, rowId };
  }
}

// ── Scheduler ──────────────────────────────────────────────────

export interface ReminderRunSummary {
  businesses: number;
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * One run for every business in a tenant database. Safe to run any number of
 * times, concurrently or not. Does nothing outside 09:00 - 19:00 India time.
 */
export async function processPaymentReminders(
  db: TenantDatabase,
  now: Date = new Date(),
  deps: ReminderDeps = {},
): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = { businesses: 0, considered: 0, sent: 0, failed: 0, skipped: 0 };
  if (!isWithinReminderHours(now)) return summary;

  const bizRows = await db
    .select({ id: businesses.id, name: businesses.name, legalName: businesses.legalName, email: businesses.email, settings: businesses.paymentReminderSettings })
    .from(businesses)
    .where(sql`${businesses.paymentReminderSettings}->>'enabled' = 'true'`);

  for (const row of bizRows) {
    const settings = resolveReminderSettings(row.settings);
    if (!settings.enabled) continue;
    const business: BusinessRow = { id: row.id, name: row.name, legalName: row.legalName, email: row.email, settings };
    summary.businesses++;
    try {
      await processBusiness(db, business, now, deps, summary);
    } catch (err) {
      summary.failed++;
      logger.error({ businessId: business.id, err: errorText(err) }, "[payment-reminders] business failed");
    }
  }
  return summary;
}

async function processBusiness(db: TenantDatabase, business: BusinessRow, now: Date, deps: ReminderDeps, summary: ReminderRunSummary) {
  const s = business.settings;
  const autoChannels: ReminderChannel[] = [];
  if (s.channels.email) autoChannels.push("email");
  if (s.channels.sms && (deps.sms ?? getSmsProvider)()) autoChannels.push("sms");
  if (autoChannels.length === 0) return;

  const horizonPast = new Date(now.getTime() - (s.maxReminders * Math.max(s.repeatEveryDays, 1) + 2) * DAY_MS);
  const horizonAhead = new Date(now.getTime() + (s.daysBefore + 1) * DAY_MS);
  const rows = await db
    .select(invoiceSelect)
    .from(invoices)
    .innerJoin(parties, and(eq(parties.id, invoices.partyId), eq(parties.businessId, invoices.businessId)))
    .where(and(
      eq(invoices.businessId, business.id),
      eq(invoices.type, "sale"),
      eq(invoices.documentType, "invoice"),
      isNull(invoices.deletedAt),
      inArray(invoices.status, [...REMINDABLE_STATUSES]),
      eq(parties.doNotRemind, false),
      gte(invoices.dueDate, horizonPast),
      lte(invoices.dueDate, horizonAhead),
      sql`${outstandingOnRow} > 0.01`,
    ))
    .orderBy(invoices.dueDate)
    .limit(MAX_INVOICES_PER_RUN);
  if (rows.length === 0) return;

  const recorded = await db
    .select({ invoiceId: paymentReminders.invoiceId, channel: paymentReminders.channel, slotKey: paymentReminders.slotKey })
    .from(paymentReminders)
    .where(and(
      eq(paymentReminders.businessId, business.id),
      eq(paymentReminders.trigger, "auto"),
      inArray(paymentReminders.invoiceId, rows.map((r) => r.id)),
    ));
  const keysFor = new Map<string, Set<string>>();
  for (const r of recorded) {
    const k = `${r.invoiceId}:${r.channel}`;
    if (!keysFor.has(k)) keysFor.set(k, new Set());
    keysFor.get(k)!.add(r.slotKey);
  }

  for (const raw of rows) {
    const inv = toInvoiceRow(raw);
    summary.considered++;
    for (const channel of autoChannels) {
      if (channel === "email" && !inv.partyEmail) { summary.skipped++; continue; }
      if (channel === "sms" && !normalizeIndianMobile(inv.partyPhone)) { summary.skipped++; continue; }
      const slot = planAutoReminder({
        dueDate: inv.dueDate,
        invoiceDate: inv.invoiceDate,
        now,
        settings: s,
        recordedKeys: keysFor.get(`${inv.id}:${channel}`) ?? new Set(),
      });
      if (!slot) continue;
      const res = await deliver(db, { business, inv, channel, kind: slot.kind, slotKey: slot.key, trigger: "auto", now, deps });
      if (res.outcome === "sent") summary.sent++;
      else if (res.outcome === "failed") summary.failed++;
    }
  }
}

type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;

export interface ReminderTenantDeps {
  readOnly: (tenantId: string) => Promise<boolean>;
  getDb: (tenantId: string) => Promise<TenantDb>;
  process: (db: TenantDb) => Promise<unknown>;
}

/**
 * One organisation's turn. A read-only organisation (trial over, payment
 * failed, plan ended) sends nothing and records nothing. Suspended
 * organisations never get here: the tick only lists active tenants.
 */
export async function tickTenant(tenantId: string, deps: ReminderTenantDeps): Promise<"skipped" | "processed"> {
  if (await deps.readOnly(tenantId)) {
    logger.debug({ tenantId }, "[payment-reminders] organisation is read-only; sending no reminders");
    return "skipped";
  }
  await deps.process(await deps.getDb(tenantId));
  return "processed";
}

export async function runPaymentReminders(now: Date = new Date(), deps: ReminderDeps = {}): Promise<void> {
  try {
    if (!isWithinReminderHours(now)) return;
    if (!isMultiTenant) {
      const s = await processPaymentReminders(await getTenantDb("single"), now, deps);
      if (s.sent + s.failed > 0) logger.info(s, "[payment-reminders] run");
      return;
    }
    const active = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
    for (const t of active) {
      try {
        await tickTenant(t.id, {
          readOnly: async (id) => (await getEntitlements(id, now)).readOnly,
          getDb: getTenantDb,
          process: async (db) => {
            const s = await processPaymentReminders(db, now, { ...deps, tenantId: t.id });
            if (s.sent + s.failed > 0) logger.info({ tenantId: t.id, ...s }, "[payment-reminders] run");
          },
        });
      } catch (err) {
        logger.error({ tenantId: t.id, err: errorText(err) }, "[payment-reminders] organisation failed");
      }
    }
  } catch (err) {
    logger.error({ err: errorText(err) }, "[payment-reminders] run failed");
  }
}

/** Checked hourly; the history makes each slot go out once. PAYMENT_REMINDERS=off switches the job off (e2e). */
export function startPaymentReminderScheduler(): void {
  if (timer) return;
  if (process.env.PAYMENT_REMINDERS === "off") return;
  console.log("[payment-reminders] Started (hourly check, 09:00-19:00 IST, each slot sent once)");
  timer = setInterval(() => void runPaymentReminders(), TICK_MS);
  timer.unref();
}

export function stopPaymentReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ── Per business / per invoice reads and the manual send ───────

export async function loadBusinessReminderSettings(db: TenantDatabase, businessId: string): Promise<{ business: BusinessRow }> {
  const [row] = await db
    .select({ id: businesses.id, name: businesses.name, legalName: businesses.legalName, email: businesses.email, settings: businesses.paymentReminderSettings })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  return { business: { id: row.id, name: row.name, legalName: row.legalName, email: row.email, settings: resolveReminderSettings(row.settings) } };
}

async function loadInvoice(db: TenantDatabase, businessId: string, invoiceId: string): Promise<InvoiceRow> {
  const [row] = await db
    .select(invoiceSelect)
    .from(invoices)
    .innerJoin(parties, and(eq(parties.id, invoices.partyId), eq(parties.businessId, invoices.businessId)))
    .where(and(
      eq(invoices.id, invoiceId),
      eq(invoices.businessId, businessId),
      eq(invoices.type, "sale"),
      eq(invoices.documentType, "invoice"),
      isNull(invoices.deletedAt),
    ))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
  return toInvoiceRow(row);
}

/** Why a reminder cannot be sent for this invoice at all, or null. */
function invoiceBlockedReason(inv: InvoiceRow): string | null {
  if (!(REMINDABLE_STATUSES as readonly string[]).includes(inv.status) || inv.balance <= 0.01) {
    return inv.status === "draft" ? "A draft invoice cannot be reminded." : "Nothing is due on this invoice.";
  }
  if (inv.doNotRemind) return "This customer is marked Do not remind.";
  return null;
}

export interface ReminderHistoryRow {
  id: string;
  channel: string;
  kind: string;
  trigger: string;
  status: string;
  recipient: string | null;
  error: string | null;
  sentByName: string | null;
  createdAt: Date;
}

export async function listInvoiceReminders(db: TenantDatabase, businessId: string, invoiceId: string): Promise<ReminderHistoryRow[]> {
  return db
    .select({
      id: paymentReminders.id,
      channel: paymentReminders.channel,
      kind: paymentReminders.kind,
      trigger: paymentReminders.trigger,
      status: paymentReminders.status,
      recipient: paymentReminders.recipient,
      error: paymentReminders.error,
      sentByName: paymentReminders.sentByName,
      createdAt: paymentReminders.createdAt,
    })
    .from(paymentReminders)
    .where(and(eq(paymentReminders.businessId, businessId), eq(paymentReminders.invoiceId, invoiceId)))
    .orderBy(desc(paymentReminders.createdAt))
    .limit(100);
}

export interface InvoiceReminderInfo {
  balanceDue: string;
  /** Set when no reminder can be sent for this invoice at all. */
  blockedReason: string | null;
  remindersEnabled: boolean;
  doNotRemind: boolean;
  channels: {
    email: { available: boolean; reason: string | null; nextAt: Date | null };
    sms: { available: boolean; reason: string | null; nextAt: Date | null };
    whatsapp: { available: boolean; reason: string | null; url: string | null };
  };
  history: ReminderHistoryRow[];
}

export async function getInvoiceReminderInfo(
  db: TenantDatabase,
  businessId: string,
  invoiceId: string,
  opts: { now?: Date; deps?: ReminderDeps } = {},
): Promise<InvoiceReminderInfo> {
  const now = opts.now ?? new Date();
  const deps = opts.deps ?? {};
  const { business } = await loadBusinessReminderSettings(db, businessId);
  const inv = await loadInvoice(db, businessId, invoiceId);
  const history = await listInvoiceReminders(db, businessId, invoiceId);
  const blockedReason = invoiceBlockedReason(inv);

  const lastManual = (channel: string): Date | null => {
    const r = history.find((h) => h.trigger === "manual" && h.channel === channel && h.status !== "failed");
    return r ? r.createdAt : null;
  };
  const emailAt = manualReminderAvailableAt(lastManual("email"), now);
  const smsAt = manualReminderAvailableAt(lastManual("sms"), now);
  const smsOn = (deps.sms ?? getSmsProvider)() !== null;

  const email = blockedReason ?? (!inv.partyEmail ? "The customer has no email address." : emailAt ? "Already sent in the last 24 hours." : null);
  const sms =
    blockedReason ??
    (!smsOn ? "SMS is not set up on this server." : !normalizeIndianMobile(inv.partyPhone) ? "The customer has no mobile number." : smsAt ? "Already sent in the last 24 hours." : null);

  let whatsappUrl: string | null = null;
  let whatsapp = blockedReason;
  if (!whatsapp) {
    const link = await resolvePaymentLink(db, deps, businessId, invoiceId, false);
    whatsappUrl = buildWhatsAppLink(inv.partyPhone, buildMessage(business, inv, "whatsapp", now, link).body);
    if (!whatsappUrl) whatsapp = "The customer has no mobile number.";
  }

  return {
    balanceDue: inv.balance.toFixed(2),
    blockedReason,
    remindersEnabled: business.settings.enabled,
    doNotRemind: inv.doNotRemind,
    channels: {
      email: { available: email === null, reason: email, nextAt: emailAt },
      sms: { available: sms === null, reason: sms, nextAt: smsAt },
      whatsapp: { available: whatsapp === null, reason: whatsapp, url: whatsappUrl },
    },
    history,
  };
}

export interface SendNowResult {
  channel: ReminderChannel;
  status: "sent" | "link_opened";
  /** WhatsApp only: the wa.me link to open. */
  url: string | null;
}

/**
 * "Send reminder now". Email and SMS are limited to one per invoice per
 * channel per 24 hours (a failed attempt does not count); the WhatsApp link
 * sends nothing, so it is only recorded, without a limit.
 */
export async function sendReminderNow(
  db: TenantDatabase,
  input: { businessId: string; invoiceId: string; channel: ReminderChannel; user: { id: string; name: string }; now?: Date; deps?: ReminderDeps },
): Promise<SendNowResult> {
  const now = input.now ?? new Date();
  const deps = input.deps ?? {};
  const { business } = await loadBusinessReminderSettings(db, input.businessId);
  const inv = await loadInvoice(db, input.businessId, input.invoiceId);
  const blocked = invoiceBlockedReason(inv);
  if (blocked) throw new TRPCError({ code: "BAD_REQUEST", message: blocked });

  const channel = input.channel;
  if (channel === "email" && !inv.partyEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "The customer has no email address." });
  if (channel !== "email" && !normalizeIndianMobile(inv.partyPhone)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The customer has no mobile number." });
  }
  if (channel === "sms" && !(deps.sms ?? getSmsProvider)()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SMS is not set up on this server." });
  }

  const slotKey = `manual:${crypto.randomUUID()}`;
  const masked = channel === "email" ? maskEmail(inv.partyEmail!) : maskPhone(inv.partyPhone!);

  // Claim under a lock on the invoice row, so two quick clicks cannot both pass the limit.
  const claimedId = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM invoices WHERE id = ${input.invoiceId} AND business_id = ${input.businessId} FOR UPDATE`);
    if (channel !== "whatsapp") {
      const [last] = await tx
        .select({ createdAt: paymentReminders.createdAt })
        .from(paymentReminders)
        .where(and(
          eq(paymentReminders.invoiceId, input.invoiceId),
          eq(paymentReminders.businessId, input.businessId),
          eq(paymentReminders.channel, channel),
          eq(paymentReminders.trigger, "manual"),
          sql`${paymentReminders.status} <> 'failed'`,
        ))
        .orderBy(desc(paymentReminders.createdAt))
        .limit(1);
      const next = manualReminderAvailableAt(last?.createdAt ?? null, now);
      if (next) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `A ${channel === "email" ? "email" : "SMS"} reminder was already sent for this invoice in the last 24 hours. You can send another after ${next.toISOString()}.`,
        });
      }
    }
    const [row] = await tx
      .insert(paymentReminders)
      .values({
        businessId: input.businessId,
        invoiceId: input.invoiceId,
        channel,
        kind: "manual",
        slotKey,
        trigger: "manual",
        status: "sending",
        recipient: masked,
        sentByUserId: input.user.id,
        sentByName: input.user.name,
      })
      .returning({ id: paymentReminders.id });
    return row.id;
  });

  const res = await deliver(db, { business, inv, channel, kind: "manual", slotKey, trigger: "manual", user: input.user, now, deps, claimedId });
  if (res.outcome === "failed") {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `The reminder could not be sent: ${res.error ?? "unknown error"}` });
  }
  let url: string | null = null;
  if (channel === "whatsapp") {
    const link = await resolvePaymentLink(db, deps, input.businessId, input.invoiceId, true);
    url = buildWhatsAppLink(inv.partyPhone, buildMessage(business, inv, "whatsapp", now, link).body);
  }
  return { channel, status: channel === "whatsapp" ? "link_opened" : "sent", url };
}
