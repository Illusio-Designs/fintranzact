/**
 * The read-only / suspended gate, as a pure decision plus its two allowlists.
 *
 * trpc.ts appends an `entitlementGate` middleware to the three tenant-scoped
 * bases (tenantProcedure, businessProcedure, authorizedProcedure). It loads
 * the organisation's entitlements and asks gateDecision what to do. Keeping the
 * decision pure (no database, no context) lets it be unit-tested exhaustively.
 *
 * Rules:
 *  - queries and subscriptions always pass, EXCEPT for a suspended
 *    organisation, which is blocked for everything but SUSPENDED_ALLOWED;
 *  - mutations are refused while the organisation is read-only (trial over,
 *    payment failed, plan ended) or suspended, unless the path is in
 *    READ_ONLY_EXEMPT. Mutations are gated BY DEFAULT: a new mutation is
 *    refused in read-only mode until someone adds it to the allowlist.
 *
 * The gate only runs on tenant-scoped bases. Procedures built on
 * publicProcedure / protectedProcedure (auth, billing, platform, ...) have no
 * gate; their entries below document intent and keep working if one of them is
 * ever moved onto a gated base.
 */

import type { EntitlementReason } from "@fintranzact/shared";

/**
 * Mutations that stay open while an organisation is read-only (and, where the
 * caller can reach them at all, while suspended: see gateDecision). Paths must
 * exist in appRouter (entitlement-exempt.test.ts guards against typos).
 */
export const READ_ONLY_EXEMPT: ReadonlySet<string> = new Set([
  // Account and session: signing in/out and managing the login never depend on the plan.
  "auth.register",
  "auth.login",
  "auth.completeProfile",
  "auth.updateName",
  "auth.requestEmailChange",
  "auth.confirmEmailChange",
  "auth.logout",
  "auth.logoutAll",
  "auth.revokeSession",
  "auth.issueAccessToken",
  // Account security (two-factor enrolment) never depends on the plan.
  "auth.twoFactorBeginSetup",
  "auth.twoFactorConfirmSetup",
  "auth.twoFactorDisable",
  "auth.regenerateBackupCodes",
  // Second step of sign-in and trusted-device management: same reasoning.
  "auth.verifyTwoFactor",
  "auth.revokeTrustedDevice",
  "auth.revokeAllTrustedDevices",

  // Billing: the way out of read-only. A halted organisation must be able to
  // buy a plan, change plan, fix billing details and cancel.
  "billing.demoCheckout",
  "billing.subscribePlan",
  "billing.subscribeAddon",
  "billing.verifyCheckout",
  "billing.updateBillingDetails",
  "billing.changePlan",
  "billing.cancelSubscription",

  // Organisation membership: choosing/accepting an organisation, and
  // REDUCING access (removing a member, revoking an invitation) which also
  // lowers seat cost. Inviting and role changes stay gated.
  "tenant.updatePlan",
  "tenant.select",
  "tenant.acceptInvitation",
  "tenant.acceptById",
  "tenant.removeMember",
  "tenant.revokeInvitation",

  // Revoking credentials and links is a safety action, never refused.
  "apiKey.revoke",
  "share.revoke",

  // Data exports: read-only mode promises "export your data" still works.
  "business.exportData",
  "selfExport.request",

  // Mutations that only read (they are mutations because they call an
  // external service or have side effects on a third party, not our data).
  "party.lookupGstin",
  "eInvoice.testConnection",

  // Not tenant-scoped: platform admin, partner and public contact forms.
  "platform.setPlan",
  "platform.setTrial",
  "platform.savePlan",
  "platform.resetPlan",
  "platform.closeGovUsageMonth",
  "platform.updatePartner",
  "platform.recordPayout",
  "platform.updatePayout",
  "platform.deletePayout",
  "platform.roadmapCreate",
  "platform.roadmapUpdate",
  "platform.roadmapDelete",
  "platform.roadmapReorder",
  "partner.submitApplication",
  "contact.submit",
]);

/**
 * Write mutations that sit on a protected/public base (so entitlementGate never
 * runs) but still must be refused while read-only or suspended. Each one calls
 * assertWritable (or assertOwnedOrgsWritable) explicitly inside its router.
 * entitlement-exempt.test.ts asserts this is exactly the set of ungated
 * mutations that are not in READ_ONLY_EXEMPT, so a new protected-base write
 * cannot be forgotten.
 *   apiKey.create       - issuing a credential for the selected organisation
 *   selfImport.request  - restoring a backup into the organisation (also re-checked on the upload route)
 *   tenant.create       - a new organisation, refused while any owned organisation is read-only/suspended
 */
export const INLINE_WRITE_GUARDED: ReadonlySet<string> = new Set([
  "apiKey.create",
  "selfImport.request",
  "tenant.create",
]);

/**
 * What a SUSPENDED organisation may still call on a gated base: just enough
 * for the client to learn why it is blocked and show the suspended screen.
 * Everything else (every other query, every mutation not in READ_ONLY_EXEMPT)
 * is refused with tenant_suspended.
 *   tenant.current  - the organisation's name/status for the header
 *   billing.status  - state, reason and message for the banner
 * (auth, billing.overview, tenant.list, tenant.select are protected-base and
 * never reach the gate.)
 */
export const SUSPENDED_ALLOWED: ReadonlySet<string> = new Set([
  "tenant.current",
  "billing.status",
]);

export interface GateInput {
  type: "query" | "mutation" | "subscription";
  path: string;
  entitlements: { readOnly: boolean; reason: EntitlementReason | null };
}

export type GateDecision = { allow: true } | { allow: false; reason: EntitlementReason };

export function gateDecision({ type, path, entitlements }: GateInput): GateDecision {
  const { readOnly, reason } = entitlements;

  if (reason === "tenant_suspended") {
    // Suspended: only the allowlisted calls get through. READ_ONLY_EXEMPT
    // mutations that are tenant-scoped (removing a member, exports) stay
    // blocked too: a suspended organisation is shut, not just read-only.
    if (SUSPENDED_ALLOWED.has(path)) return { allow: true };
    return { allow: false, reason: "tenant_suspended" };
  }

  if (type !== "mutation") return { allow: true };
  if (!readOnly || !reason) return { allow: true };
  if (READ_ONLY_EXEMPT.has(path)) return { allow: true };
  return { allow: false, reason };
}
