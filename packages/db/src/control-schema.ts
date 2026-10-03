import { pgTable, text, timestamp, uuid, pgEnum, pgSequence, index, primaryKey, uniqueIndex, boolean, jsonb, integer, numeric, bigint, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────────────

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended", "deleted"]);
export const tenantPlanEnum = pgEnum("tenant_plan", ["starter", "growth", "business"]);
export const billingSubscriptionKindEnum = pgEnum("billing_subscription_kind", ["plan", "addon"]);
export const billingSubscriptionStatusEnum = pgEnum("billing_subscription_status", [
  "created", "active", "past_due", "halted", "cancelled",
]);
export const billingCycleEnum = pgEnum("billing_cycle", ["monthly", "yearly"]);
export const memberRoleEnum = pgEnum("member_role", [
  // Legacy values (kept for backward compat with existing DB rows)
  "owner", "admin", "member", "viewer",
  // New CASL-based roles (require ALTER TYPE migration in production)
  "superadmin", "seller_manager", "seller", "accountant",
  // Accountant access (read-only / filing-only); see docs/ACCOUNTANT-ACCESS.md
  "auditor", "ca_filing",
]);

// ── Tenants ────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  // DB connection info (null in self-hosted mode — uses same DB)
  dbName: text("db_name"),
  dbHost: text("db_host"),
  dbPort: text("db_port"),
  dbUser: text("db_user"),
  // Encrypted at rest via AES-256-GCM when DB_ENCRYPTION_KEY is set (see crypto.ts).
  // Legacy plaintext values are handled gracefully on read.
  dbPassword: text("db_password"),
  referralCode: text("referral_code"),
  /** The partner whose referral code this organisation signed up with. */
  partnerId: uuid("partner_id").references((): AnyPgColumn => partners.id, { onDelete: "set null" }),
  // Three paid plans; there is no free plan. New sign-ups set the plan they
  // chose (default growth) and start a trial (trial_ends_at). The column
  // default only serves rows inserted without one (admin-created
  // organisations, test fixtures).
  plan: tenantPlanEnum("plan").default("starter").notNull(),
  /**
   * Permanent full access: no trial, no payment, never read-only. True only
   * for the organisations that were on the removed Forever Free plan when the
   * three-plan model shipped (migration 0056 / control 0019). Never set for a
   * new organisation; shown as "Grandfathered" in the admin console.
   */
  accessGrandfathered: boolean("access_grandfathered").default(false).notNull(),
  status: tenantStatusEnum("status").default("active").notNull(),
  /**
   * When the owner chose a plan. NULL means "not chosen yet"
   * and sends the owner to the plan page. Defaults to now() so existing rows,
   * seeds and admin-created orgs count as chosen; only self sign-up inserts NULL.
   */
  planSelectedAt: timestamp("plan_selected_at", { withTimezone: true }).defaultNow(),
  /**
   * End of the free trial, or NULL when the organisation has none. Past this
   * instant with no live plan subscription the organisation is read-only
   * (see deriveAccess in @fintranzact/shared). Self sign-up starts a 14-day trial.
   */
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /** When the Full Access Trial began; NULL for rows from before it existed. */
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  /**
   * How the trial started: signup, partner (a partner referral: longer trial),
   * admin (granted or extended in the console) or none (a trial was already
   * used for this email / phone / GSTIN, so this organisation has none).
   * Text so the set can grow; the allowed values are TRIAL_SOURCES (@fintranzact/shared).
   */
  trialSource: text("trial_source"),
  /**
   * Two-factor policy: "off" | "admins" (owners/admins) | "all" (every member).
   * Text rather than an enum so the set can grow without ALTER TYPE; the allowed
   * values live in TWO_FACTOR_POLICIES (@fintranzact/shared).
   */
  twoFactorPolicy: text("two_factor_policy").default("off").notNull(),
  /** When the current policy was switched on; the grace period counts from here. */
  twoFactorEnforcedAt: timestamp("two_factor_enforced_at", { withTimezone: true }),
  twoFactorGraceDays: integer("two_factor_grace_days").default(7).notNull(),
  // Billing details printed on the GST invoices Finvera issues to this
  // organisation. Separate from the businesses' own profiles: an organisation
  // can hold many businesses but is one paying customer.
  billingName: text("billing_name"),
  billingGstin: text("billing_gstin"),
  billingAddress: text("billing_address"),
  billingEmail: text("billing_email"),
  /** GST state code (e.g. "24") the subscription GST invoice is taxed by when there is no GSTIN; null = unknown (IGST). */
  billingState: text("billing_state"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tenants_slug_idx").on(t.slug),
]);

// ── Users (moved from schema.ts) ───────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  referralCode: text("referral_code"),
  passwordHash: text("password_hash"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  /** True once the user has confirmed an authenticator app (see user_two_factor). */
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
]);

// ── Session auth method enum ───────────────────────────────────

export const sessionAuthMethodEnum = pgEnum("session_auth_method", ["cookie", "bearer"]);

// ── Sessions (modified — added tenantId) ───────────────────────

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // tenantId can be null for users who haven't selected a tenant yet
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  // authMethod distinguishes cookie-based sessions (web) from Bearer-token sessions
  // (mobile + desktop). Default 'cookie' keeps all existing rows valid.
  authMethod: sessionAuthMethodEnum("auth_method").notNull().default("cookie"),
  // maxExpiresAt is the absolute hard cap for Bearer sessions (createdAt + 30 days).
  // Null for cookie sessions — they use the existing 30-day expiresAt semantics.
  maxExpiresAt: timestamp("max_expires_at", { withTimezone: true }),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
  index("sessions_tenant_idx").on(t.tenantId),
]);

// ── Access Tokens (short-lived, 15-min, desktop only) ─────────
//
// Each row represents a single issued access token for a Bearer session.
// Clients send these as `Authorization: Bearer at_<token>` for normal API
// calls; the long-lived session_id (refresh token) is held in the OS
// keychain and is only sent to `auth.issueAccessToken`.
//
// Cascade-delete on session delete is load-bearing: when a refresh token
// is revoked (logout, privilege rotation, admin action), all access tokens
// it spawned die immediately — stolen access tokens cannot outlive the
// revocation window of their parent session.

export const accessTokens = pgTable("access_tokens", {
  id: text("id").primaryKey(), // "at_" + base64url(randomBytes(48))
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("access_tokens_session_idx").on(t.sessionId),
  index("access_tokens_expires_idx").on(t.expiresAt),
]);

// ── Tenant Members ─────────────────────────────────────────────

export const tenantMembers = pgTable("tenant_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").default("member").notNull(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tenant_members_unique_idx").on(t.tenantId, t.userId),
  index("tenant_members_user_idx").on(t.userId),
]);

// ── Per-user organisation preferences (client switcher) ───────

/** What one person pinned and last opened in the organisation switcher. Control DB only. */
export const userTenantPrefs = pgTable("user_tenant_prefs", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.tenantId] }),
  index("user_tenant_prefs_tenant_idx").on(t.tenantId),
]);

// ── Invitations ────────────────────────────────────────────────

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: memberRoleEnum("role").default("member").notNull(),
  token: text("token").notNull(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  /** CA invites only: the owner asked to credit the CA, a partner, as the organisation's referrer on accept (opt-in, default none). */
  creditPartner: boolean("credit_partner"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("invitations_token_idx").on(t.token),
  index("invitations_email_idx").on(t.email),
  index("invitations_tenant_idx").on(t.tenantId),
]);

// ── Magic Link Tokens ─────────────────────────────────────────

/**
 * Email-change tokens: the link sent to a NEW address to confirm it. The
 * table kept its first name, "magic_link_tokens", from when it also held
 * sign-in links (removed), so no migration was needed. `referral_code` is an
 * unused leftover of that.
 */
export const emailChangeTokens = pgTable("magic_link_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  // Bound server-side so confirmEmailChange never trusts a client-supplied userId
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("magic_link_tokens_email_idx").on(t.email),
  index("magic_link_tokens_hash_idx").on(t.tokenHash),
]);

// ── API Keys ───────────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  // Store the hash, never the raw key
  keyHash: text("key_hash").notNull(),
  // First 20 chars of the raw key for display: "fintranzact_key_abc12345..."
  keyPrefix: text("key_prefix").notNull(),
  name: text("name").notNull(), // User-given label like "CLI", "CI/CD", "MCP Server"
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = never expires
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("api_keys_user_idx").on(t.userId),
  index("api_keys_hash_idx").on(t.keyHash),
]);

// ── System Config ─────────────────────────────────────────────
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Document share links ──────────────────────────────────────
// A public link to one invoice (or quotation, proforma, …) that its customer
// can open without an account: view it, download the PDF and pay. Kept in the
// control DB so a link resolves to its tenant in one lookup. Only a SHA-256
// hash of the token is searchable; the token itself is stored encrypted so
// the business can copy the same link again. Revoking stamps `revokedAt`.

export const shareLinks = pgTable("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull(),
  documentId: uuid("document_id").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  viewCount: integer("view_count").default(0).notNull(),
}, (t) => [
  uniqueIndex("share_links_token_hash_idx").on(t.tokenHash),
  // At most one live link per document.
  uniqueIndex("share_links_live_document_idx").on(t.tenantId, t.documentId).where(sql`${t.revokedAt} IS NULL`),
]);

// ── Plan settings ──────────────────────────────────────────────
// A platform admin's edits to a plan. A plan with no row uses the built-in
// definition from @fintranzact/shared (PLAN_DEFAULTS).
export const planSettings = pgTable("plan_settings", {
  plan: tenantPlanEnum("plan").primaryKey(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  /** Monthly price in rupees; null = priced on request. */
  monthlyPriceInr: integer("monthly_price_inr"),
  /** Yearly price in rupees, before GST; null = ten times the monthly price (2 months free). */
  yearlyPriceInr: integer("yearly_price_inr"),
  features: jsonb("features").$type<string[]>().notNull(),
  highlight: boolean("highlight").default(false).notNull(),
  /** Shown on the pricing page and sign-up plan picker. */
  visible: boolean("visible").default(true).notNull(),
  /** Every limit; numbers are null for unlimited. */
  limits: jsonb("limits").$type<Record<string, number | boolean | null>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

// ── Partners ───────────────────────────────────────────────────
// Applications from the public "Become a partner" form. A platform admin
// approves or rejects them; approved partners who agreed are listed in the
// public partner directory.
export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactName: text("contact_name").notNull(),
  companyName: text("company_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  city: text("city").notNull(),
  state: text("state"),
  website: text("website"),
  /** reseller | referral | implementation | accountant */
  partnerType: text("partner_type").notNull(),
  clientCount: text("client_count"),
  message: text("message"),
  listPublicly: boolean("list_publicly").default(false).notNull(),
  /** Given on approval; organisations that sign up with it are this partner's referrals. */
  referralCode: text("referral_code"),
  /** Commission on referred organisations' plan price. Null = the badge's rate. */
  commissionPercent: integer("commission_percent"),
  /** pending | approved | rejected */
  status: text("status").default("pending").notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("partners_status_idx").on(t.status, t.createdAt),
  index("partners_email_idx").on(t.email),
  uniqueIndex("partners_referral_code_idx").on(t.referralCode),
]);

// Money paid (or owed) to a partner for a month of referrals.
export const partnerPayouts = pgTable("partner_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  /** "2026-09" */
  period: text("period").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  /** pending | paid */
  status: text("status").default("pending").notNull(),
  /** Bank / UPI reference once paid. */
  reference: text("reference"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("partner_payouts_period_idx").on(t.partnerId, t.period),
]);

// ── Upcoming features (platform admin roadmap) ─────────────────
// The operators' own board of what is planned and being built. Not shown to
// customers. Seeded with the starting roadmap the first time it is opened.

export const roadmapItems = pgTable("roadmap_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  /** Plain text with light markdown: paragraphs, "- " bullets, "### " headings, **bold**. */
  description: text("description").default("").notNull(),
  /** Free text; the console suggests Payroll, Inventory, GST, Mobile, Platform, Other. */
  category: text("category").notNull(),
  /** idea | planned | in_progress | done | dropped */
  status: text("status").default("idea").notNull(),
  /** high | medium | low */
  priority: text("priority").default("medium").notNull(),
  /** before_launch | after_launch */
  launchStage: text("launch_stage").default("after_launch").notNull(),
  /** Phase number within the category (Payroll phase 1, 2…). */
  phase: integer("phase"),
  /** Position on the board; lower first. */
  sortOrder: integer("sort_order").default(0).notNull(),
  /** Target month, "2026-11". */
  target: text("target"),
  /** included | paid_add_on */
  billing: text("billing").default("included").notNull(),
  priceNote: text("price_note"),
  /** Sub-tasks: [{ text, done }] */
  checklist: jsonb("checklist").$type<{ text: string; done: boolean }[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("roadmap_items_status_idx").on(t.status, t.sortOrder),
]);

// ── Subscription billing ───────────────────────────────────────
// What each organisation is paying for: one subscription row per plan or
// add-on bought, mirroring a Razorpay subscription (or a demo one before the
// gateway is configured). Control-schema because webhooks resolve by tenant
// and the platform admin sees every organisation's billing in one query.

export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  kind: billingSubscriptionKindEnum("kind").notNull(),
  /** Plan id when kind = plan (tenant_plan value). */
  plan: text("plan"),
  /** Add-on id when kind = addon (ai_assistant | ai_plus | payroll | store_pro). */
  addon: text("addon"),
  cycle: billingCycleEnum("cycle").notNull(),
  status: billingSubscriptionStatusEnum("status").default("created").notNull(),
  /** demo | razorpay */
  provider: text("provider").default("demo").notNull(),
  providerSubscriptionId: text("provider_subscription_id"),
  /** Price per cycle, before GST, in paise — frozen when bought. */
  basePaise: integer("base_paise").notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /** The owner cancelled: the subscription runs out at the period end. */
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  /** Downgrade scheduled for the period end (plan subscriptions only). */
  scheduledPlan: text("scheduled_plan"),
  scheduledCycle: billingCycleEnum("scheduled_cycle"),
  /** Set when a renewal fails; past it the organisation goes read-only. */
  graceUntil: timestamp("grace_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (t) => [
  index("billing_subscriptions_tenant_idx").on(t.tenantId),
  index("billing_subscriptions_status_idx").on(t.status, t.currentPeriodEnd),
  uniqueIndex("billing_subscriptions_provider_idx").on(t.providerSubscriptionId).where(sql`${t.providerSubscriptionId} IS NOT NULL`),
  // One live plan subscription per organisation; one live row per add-on.
  uniqueIndex("billing_subscriptions_live_plan_idx").on(t.tenantId).where(sql`${t.kind} = 'plan' AND ${t.status} <> 'cancelled'`),
  uniqueIndex("billing_subscriptions_live_addon_idx").on(t.tenantId, t.addon).where(sql`${t.kind} = 'addon' AND ${t.status} <> 'cancelled'`),
]);

// Every charge (and failed charge) on a subscription. A captured row IS the
// GST invoice from Finvera Solutions LLP: invoice_seq numbers them, and the
// billing_* columns freeze the customer details the invoice was issued with.

/** Numbers Finvera's GST invoices (FIN-00001). Separate from the column
 * default so failed charges never consume a number. */
export const billingInvoiceSeq = pgSequence("billing_invoice_seq");

export const billingPayments = pgTable("billing_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * Sequential GST invoice number (FIN-00001). Only captured and credit rows
   * take one (from the billing_invoice_seq sequence), so failed charges never
   * punch holes in the invoice series.
   */
  invoiceSeq: integer("invoice_seq"),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => billingSubscriptions.id, { onDelete: "set null" }),
  /** captured | failed | refunded | credit */
  status: text("status").default("captured").notNull(),
  /** "Pro plan — monthly", "AI Assistant add-on — yearly", "Credit: unused Pro time". */
  description: text("description").notNull(),
  /** Negative for credit notes (unused time on an upgrade). */
  basePaise: integer("base_paise").notNull(),
  gstPaise: integer("gst_paise").notNull(),
  totalPaise: integer("total_paise").notNull(),
  method: text("method"),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  providerInvoiceId: text("provider_invoice_id"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  billingName: text("billing_name"),
  billingGstin: text("billing_gstin"),
  billingAddress: text("billing_address"),
  /** Frozen with the invoice: the GST state code the tax split used (null = unknown). */
  billingState: text("billing_state"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("billing_payments_tenant_idx").on(t.tenantId, t.createdAt),
  index("billing_payments_subscription_idx").on(t.subscriptionId),
]);

// Webhook deliveries and the lifecycle steps the API takes itself, kept for
// idempotency (a Razorpay event is applied once) and as the billing audit
// trail — the tenant-DB audit log is business-scoped and cannot hold these.

export const billingEvents = pgTable("billing_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** demo | razorpay | local (steps the API took itself) */
  provider: text("provider").notNull(),
  /** The gateway's event id; unique so a redelivered webhook is a no-op. */
  eventId: text("event_id"),
  type: text("type").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  subscriptionId: uuid("subscription_id").references(() => billingSubscriptions.id, { onDelete: "set null" }),
  payload: jsonb("payload"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("billing_events_event_idx").on(t.provider, t.eventId).where(sql`${t.eventId} IS NOT NULL`),
  index("billing_events_tenant_idx").on(t.tenantId, t.createdAt),
]);

// ── Government API usage (Sandbox.co.in) ───────────────────────
// One row per chargeable document sent to the government through the gateway
// (successful calls only). Customers are billed per document after the month
// ends; the unique index makes a retried call charge once.

export const govApiUsage = pgTable("gov_api_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** Business inside the tenant DB (no FK: lives in another database). */
  businessId: uuid("business_id"),
  gstin: text("gstin"),
  /** e_invoice | e_way_bill | gstr1_filed | gstr3b_filed */
  kind: text("kind").notNull(),
  /** IRN, e-way bill number or return period — what was generated. */
  reference: text("reference").notNull(),
  /** Price charged for this document, before GST, in paise (frozen at the time). */
  ratePaise: integer("rate_paise").notNull(),
  /** Calendar month in IST, "YYYY-MM". */
  period: text("period").notNull(),
  /** Set once the month is closed onto a billing_payments row. */
  statementPaymentId: uuid("statement_payment_id").references(() => billingPayments.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("gov_api_usage_doc_idx").on(t.tenantId, t.kind, t.reference),
  index("gov_api_usage_period_idx").on(t.tenantId, t.period),
]);

/** Successful Sandbox calls per month across the whole deployment — drives quota alerts. */
export const sandboxCallCounters = pgTable("sandbox_call_counters", {
  period: text("period").primaryKey(),
  calls: integer("calls").default(0).notNull(),
  /** Highest alert threshold (percent of quota) already raised this month. */
  alertedPercent: integer("alerted_percent").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * HSN / SAC codes re-verified with Sandbox by the daily refresh job. The
 * resolver reads it as a middle layer (live Sandbox, then this table when the
 * row is under 30 days old, then the bundled CBIC list). Platform-wide, never
 * per tenant. status "not_found" rows only record that Sandbox did not list
 * the code, so the job does not retry it first every day.
 */
export const hsnSandboxCodes = pgTable("hsn_sandbox_codes", {
  code: text("code").primaryKey(),
  kind: text("kind").notNull(),
  description: text("description").notNull().default(""),
  rate: numeric("rate", { precision: 6, scale: 2 }),
  active: boolean("active").default(true).notNull(),
  inactiveReason: text("inactive_reason"),
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  status: text("status").default("ok").notNull(),
  source: text("source").default("sandbox").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("hsn_sandbox_codes_checked_idx").on(t.checkedAt),
]);

// ── Two-factor authentication ──────────────────────────────────

/** One row per user: the TOTP secret and its lockout state. confirmed_at NULL = enrolment pending. */
export const userTwoFactor = pgTable("user_two_factor", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** TOTP secret, AES-256-GCM encrypted (fail-closed wrapper in the API's field-encryption). */
  secretEnc: text("secret_enc").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** Time step of the last accepted code; steps <= this are rejected (replay guard). */
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  failedCount: integer("failed_count").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Number of lockouts so far; drives the escalating lockout duration. */
  lockoutCount: integer("lockout_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One-time recovery codes; only a keyed hash is stored. */
export const twoFactorBackupCodes = pgTable("two_factor_backup_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("two_factor_backup_codes_user_idx").on(t.userId),
  uniqueIndex("two_factor_backup_codes_user_hash_idx").on(t.userId, t.codeHash),
]);

/** Short-lived login step between a correct password and a session (token stored as sha256). */
export const twoFactorChallenges = pgTable("two_factor_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").default(0).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  /** "web" | "mobile" | "desktop" */
  clientKind: text("client_kind"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("two_factor_challenges_token_idx").on(t.tokenHash),
  index("two_factor_challenges_user_idx").on(t.userId),
]);

/** "Trust this device" records that skip the second step until expires_at. */
export const trustedDevices = pgTable("trusted_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  label: text("label"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("trusted_devices_token_idx").on(t.tokenHash),
  index("trusted_devices_user_idx").on(t.userId),
]);

/** Append-only security trail (2FA setup, use, failures, resets). Subject and actor survive as NULL if deleted. */
export const securityEvents = pgTable("security_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("security_events_user_idx").on(t.userId, t.createdAt),
  index("security_events_tenant_idx").on(t.tenantId, t.createdAt),
]);

// ── Relations ──────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantMembers),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  tenantMemberships: many(tenantMembers, { relationName: "memberUser" }),
  invitedMembers: many(tenantMembers, { relationName: "memberInviter" }),
  apiKeys: many(apiKeys),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [sessions.tenantId], references: [tenants.id] }),
  accessTokens: many(accessTokens),
}));

export const accessTokensRelations = relations(accessTokens, ({ one }) => ({
  session: one(sessions, { fields: [accessTokens.sessionId], references: [sessions.id] }),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantMembers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [tenantMembers.userId], references: [users.id], relationName: "memberUser" }),
  inviter: one(users, { fields: [tenantMembers.invitedBy], references: [users.id], relationName: "memberInviter" }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  tenant: one(tenants, { fields: [invitations.tenantId], references: [tenants.id] }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [apiKeys.tenantId], references: [tenants.id] }),
}));


// ── Full Access Trial: one trial per business ──────────────────
// A row says "a trial was already used for this email / phone / GSTIN". Only a
// SALTED SHA-256 hash of the normalised value is stored, never the value, so
// the table cannot be read back into contact details. UNIQUE (kind, value_hash)
// is what makes the check race-safe: two sign-ups with the same email cannot
// both claim it. A claim stays after its organisation is deleted (the trial
// was still used), so tenant_id is nulled rather than the row removed.

export const trialClaims = pgTable("trial_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** email | phone | gstin (TRIAL_CLAIM_KINDS in @fintranzact/shared). */
  kind: text("kind").notNull(),
  valueHash: text("value_hash").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("trial_claims_kind_hash_idx").on(t.kind, t.valueHash),
  index("trial_claims_tenant_idx").on(t.tenantId),
]);

// ── Full Access Trial: reminder log ────────────────────────────
// One row per (organisation, reminder) once it has been sent or deliberately
// skipped, claimed before the email goes out so a restart or a second
// instance never sends it twice (the same pattern as tds_reminder_log).

export const trialReminders = pgTable("trial_reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** days_7 | days_2 | days_0 (TRIAL_REMINDER_KINDS). */
  kind: text("kind").notNull(),
  /** sent | skipped (a late run passed it by, or the trial was changed). */
  status: text("status").default("sent").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("trial_reminders_tenant_kind_idx").on(t.tenantId, t.kind),
]);
