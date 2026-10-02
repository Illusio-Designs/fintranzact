/**
 * The link between the CA access feature and the partner programme.
 *
 * A "CA partner" is an APPROVED partner of type `accountant` whose e-mail is the
 * e-mail of a Fintranzact user: the only link between a person and a partner
 * record is the e-mail (see `partnerForUser` in routers/partner.ts). Rules here
 * are pure and take an injected store so they are unit-tested with fakes; the
 * real store is lib/partner-ca-store.ts.
 *
 *  - badge: owners/admins see "Registered CA partner" on pending invitations and
 *    on member rows (batched, one query for all rows);
 *  - clients you manage: the partner portal lists organisations where the
 *    partner's own login holds a CA role (no financial data);
 *  - attribution is OPT-IN: accepting a CA invite never sets tenants.partnerId
 *    by itself. Only when the owner ticked "credit them as my partner" on the
 *    invite, and the facts still hold at accept time (see shouldAttributePartner).
 *    Commission maths and referral stats are untouched: they count tenants by
 *    tenants.partnerId, as before.
 */
import { isCaRole, memberRoleLabel } from "@fintranzact/shared";

export interface CaPartner {
  id: string;
  companyName: string;
}

export interface CaPartnerRow {
  id: string;
  companyName: string;
  email: string;
  status: string;
  partnerType: string;
  createdAt: Date;
}

export interface CaPartnerStore {
  /** Partner rows (any status/type) whose lower-cased e-mail is one of these (already normalised) addresses. */
  partnersByEmails(emails: string[]): Promise<CaPartnerRow[]>;
  /** The users with these (normalised) e-mails: only those that exist are returned. */
  usersByEmails(emails: string[]): Promise<Array<{ email: string; emailVerified: boolean }>>;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface FindOptions {
  /**
   * Invite time: the CA may not have an account yet, so a missing user is fine
   * (the partner was vetted when approved). An existing but unverified account
   * never matches. Accept time and the portal use the strict default: the user
   * must exist and be verified, as `partnerForUser` requires.
   */
  allowUnregistered?: boolean;
}

/** Approved accountant partners by e-mail, batched. Keys are the normalised e-mails that matched. */
export async function findCaPartnersByEmails(
  store: CaPartnerStore,
  emails: string[],
  opts: FindOptions = {},
): Promise<Map<string, CaPartner>> {
  const out = new Map<string, CaPartner>();
  const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (wanted.length === 0) return out;
  const [partnerRows, userRows] = await Promise.all([store.partnersByEmails(wanted), store.usersByEmails(wanted)]);
  const users = new Map(userRows.map((u) => [normalizeEmail(u.email), u]));
  // Newest approved record wins, as in partnerForUser.
  const candidates = partnerRows
    .filter((p) => p.status === "approved" && p.partnerType === "accountant")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const p of candidates) {
    const email = normalizeEmail(p.email);
    if (out.has(email) || !wanted.includes(email)) continue;
    const user = users.get(email);
    if (user ? !user.emailVerified : !opts.allowUnregistered) continue;
    out.set(email, { id: p.id, companyName: p.companyName });
  }
  return out;
}

/** One e-mail: the approved accountant partner it belongs to, or null. Case-insensitive. */
export async function findCaPartnerByEmail(
  store: CaPartnerStore,
  email: string,
  opts: FindOptions = {},
): Promise<CaPartner | null> {
  return (await findCaPartnersByEmails(store, [email], opts)).get(normalizeEmail(email)) ?? null;
}

// ── Invite input ───────────────────────────────────────────────────────────

export const CREDIT_PARTNER_REFUSAL =
  "That e-mail is not a registered Fintranzact CA partner, so there is no partner to credit. Untick the box to invite them without it.";

export type CreditPartnerDecision = { ok: true; creditPartner: boolean | null } | { ok: false; message: string };

/**
 * What to store on the invitation for the "credit them as my partner" box.
 * Only meaningful for CA roles (ignored, stored as null, for every other role);
 * ticked for an e-mail that is not an approved CA partner is refused.
 */
export function decideCreditPartner(input: {
  role: string;
  creditPartner: boolean | undefined;
  partnerMatch: CaPartner | null;
}): CreditPartnerDecision {
  if (!isCaRole(input.role) || !input.creditPartner) return { ok: true, creditPartner: null };
  if (!input.partnerMatch) return { ok: false, message: CREDIT_PARTNER_REFUSAL };
  return { ok: true, creditPartner: true };
}

// ── Attribution at accept ──────────────────────────────────────────────────

/**
 * True only when the owner opted in, the invitee still matches an approved,
 * verified accountant partner, and the organisation has no partner yet (an
 * existing referral is never overwritten).
 */
export function shouldAttributePartner(input: {
  creditPartner: boolean | null | undefined;
  partnerMatch: CaPartner | null | undefined;
  tenantPartnerId: string | null | undefined;
}): boolean {
  return input.creditPartner === true && !!input.partnerMatch && !input.tenantPartnerId;
}

export interface AttributionStore extends CaPartnerStore {
  tenantPartnerId(tenantId: string): Promise<string | null>;
  /** Sets tenants.partner_id only where it is still NULL; true when this call set it. */
  setTenantPartnerIfNone(tenantId: string, partnerId: string): Promise<boolean>;
}

export interface AttributionInput {
  tenantId: string;
  role: string;
  creditPartner: boolean | null | undefined;
  /** The accepting user's e-mail (the invitation was already checked to be addressed to it). */
  email: string;
  emailVerified: boolean;
}

/**
 * Called after an invitation is accepted. Returns the credited partner or null.
 * Idempotent: the update only applies while partner_id is NULL, so a second
 * accept (or a race) credits once and records one event. The caller records the
 * event for a non-null result.
 */
export async function attributePartnerOnAccept(store: AttributionStore, input: AttributionInput): Promise<CaPartner | null> {
  if (input.creditPartner !== true || !isCaRole(input.role) || !input.emailVerified) return null;
  const partnerMatch = await findCaPartnerByEmail(store, input.email);
  const tenantPartnerId = await store.tenantPartnerId(input.tenantId);
  if (!shouldAttributePartner({ creditPartner: input.creditPartner, partnerMatch, tenantPartnerId })) return null;
  if (!partnerMatch) return null;
  const set = await store.setTenantPartnerIfNone(input.tenantId, partnerMatch.id);
  return set ? partnerMatch : null;
}

// ── Clients you manage ─────────────────────────────────────────────────────

export interface ManagedClientRow {
  tenantId: string;
  name: string;
  role: string;
  /** Membership accepted/created. */
  since: Date;
  lastOpenedAt: Date | null;
  plan: string;
}

export interface ManagedClient {
  tenantId: string;
  name: string;
  role: string;
  roleLabel: string;
  since: string;
  lastOpenedAt: string | null;
  planName: string;
}

export const MANAGED_CLIENTS_LIMIT = 100;

/** CA roles only, newest first; no financial data, only who/when/plan. */
export function toManagedClients(rows: ManagedClientRow[], planName: (plan: string) => string): ManagedClient[] {
  return rows
    .filter((r) => isCaRole(r.role))
    .sort((a, b) => b.since.getTime() - a.since.getTime() || a.name.localeCompare(b.name))
    .map((r) => ({
      tenantId: r.tenantId,
      name: r.name,
      role: r.role,
      roleLabel: memberRoleLabel(r.role),
      since: r.since.toISOString(),
      lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
      planName: planName(r.plan),
    }));
}
