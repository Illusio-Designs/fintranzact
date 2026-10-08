/**
 * Who may invite or re-role whom, as pure functions (no database), so the
 * rules are unit-tested exhaustively. Wiring is in routers/tenant.ts.
 *
 *  - Admins and owners invite normal staff roles; only the owner (and
 *    superadmin) may bring in a CA role (auditor / ca_filing).
 *  - CA roles are capped per organisation (members + pending CA invites) and
 *    do not count towards the plan's team-member limit.
 *  - An existing member's role may be changed to or from a CA role by the
 *    owner / superadmin only.
 */
import { MAX_CA_MEMBERS_PER_ORG, isCaRole, isSeatlessRole } from "@fintranzact/shared";

export const INVITER_ROLES: readonly string[] = ["owner", "superadmin", "admin"];
export const CA_MANAGER_ROLES: readonly string[] = ["owner", "superadmin"];

export const CA_INVITE_OWNER_ONLY_MESSAGE = "Only the owner can invite an accountant (CA). Ask the business owner.";
export const CA_ROLE_OWNER_ONLY_MESSAGE = "Only the owner can give or take away accountant (CA) access.";
export const CA_CAP_MESSAGE = `An organisation can have up to ${MAX_CA_MEMBERS_PER_ORG} accountants (CAs), including pending invitations. Remove one to add another.`;

export type RuleResult =
  | { ok: true }
  | { ok: false; code: "FORBIDDEN" | "CONFLICT"; message: string };

/** Does a member / pending invite with this role count towards the plan's maxTeamMembers? CAs and employee logins never do. */
export function countsTowardTeamLimit(role: string): boolean {
  return !isSeatlessRole(role);
}

/** One canonical form for an invited e-mail address: trimmed and lowercased. */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface InviteRuleInput {
  inviterRole: string | null | undefined;
  targetRole: string;
  /** CA members already in the organisation. */
  memberCaCount: number;
  /** Unexpired, unaccepted invitations with a CA role. */
  pendingCaCount: number;
}

export function checkInviteRules(input: InviteRuleInput): RuleResult {
  const { inviterRole, targetRole, memberCaCount, pendingCaCount } = input;
  if (!inviterRole || !INVITER_ROLES.includes(inviterRole)) {
    return { ok: false, code: "FORBIDDEN", message: "Only owners and admins can invite members" };
  }
  if (!isCaRole(targetRole)) return { ok: true };
  if (!CA_MANAGER_ROLES.includes(inviterRole)) {
    return { ok: false, code: "FORBIDDEN", message: CA_INVITE_OWNER_ONLY_MESSAGE };
  }
  if (memberCaCount + pendingCaCount >= MAX_CA_MEMBERS_PER_ORG) {
    return { ok: false, code: "CONFLICT", message: CA_CAP_MESSAGE };
  }
  return { ok: true };
}

export interface RoleChangeRuleInput {
  actorRole: string | null | undefined;
  /** The member's role now (null when they are not a member). */
  currentRole: string | null | undefined;
  newRole: string;
  memberCaCount: number;
  pendingCaCount: number;
}

export function checkRoleChangeRules(input: RoleChangeRuleInput): RuleResult {
  const { actorRole, currentRole, newRole, memberCaCount, pendingCaCount } = input;
  if (!actorRole || !INVITER_ROLES.includes(actorRole)) {
    return { ok: false, code: "FORBIDDEN", message: "Only owners and admins can change roles" };
  }
  const touchesCa = isCaRole(newRole) || isCaRole(currentRole);
  if (touchesCa && !CA_MANAGER_ROLES.includes(actorRole)) {
    return { ok: false, code: "FORBIDDEN", message: CA_ROLE_OWNER_ONLY_MESSAGE };
  }
  // Moving between the two CA roles keeps the head-count; only a new CA is capped.
  if (isCaRole(newRole) && !isCaRole(currentRole) && memberCaCount + pendingCaCount >= MAX_CA_MEMBERS_PER_ORG) {
    return { ok: false, code: "CONFLICT", message: CA_CAP_MESSAGE };
  }
  return { ok: true };
}
