/**
 * Accountant (CA) access: the two roles an owner can invite a CA into, their
 * plain-language descriptions, and the per-organisation cap. Shared by the API
 * (invite rules, emails) and every client (Invite my CA dialog, accept page).
 */

export const CA_ROLES = ["auditor", "ca_filing"] as const;
export type CaRole = (typeof CA_ROLES)[number];

/** CA members (and pending CA invites) one organisation may have. They are outside the plan's team-member limit. */
export const MAX_CA_MEMBERS_PER_ORG = 3;

export const CA_ROLE_DESCRIPTIONS: Record<CaRole, string> = {
  auditor: "Can view everything and download reports. Cannot change anything.",
  ca_filing:
    "Can view everything, prepare and file GST returns, and download reports. Cannot create or edit sales, purchases, payments or other records.",
};

/** Role names as shown in the Team list and on invitations. */
export const CA_ROLE_LABELS: Record<CaRole, string> = {
  auditor: "Accountant (read-only)",
  ca_filing: "Accountant (filing)",
};

/** The two choices in the "Invite your CA" dialog, in display order. */
export const CA_ACCESS_CHOICES: ReadonlyArray<{ role: CaRole; title: string; description: string }> = [
  { role: "auditor", title: "View only", description: CA_ROLE_DESCRIPTIONS.auditor },
  { role: "ca_filing", title: "View and file returns", description: CA_ROLE_DESCRIPTIONS.ca_filing },
];

export const CA_ACCESS_NOTE = "You can remove their access at any time. Their activity is logged.";

export function isCaRole(role: string | null | undefined): role is CaRole {
  return role === "auditor" || role === "ca_filing";
}

/**
 * Roles that never use a plan team-member seat: the accountant (CA) roles, which have their own cap,
 * and the Payroll self-service "employee" login, which is included in the Payroll add-on.
 */
export const SEATLESS_ROLES = ["auditor", "ca_filing", "employee"] as const;

export function isSeatlessRole(role: string | null | undefined): boolean {
  return (SEATLESS_ROLES as readonly string[]).includes(role ?? "");
}

/** Access text for a CA role, or null for any other role. */
export function caRoleDescription(role: string | null | undefined): string | null {
  return isCaRole(role) ? CA_ROLE_DESCRIPTIONS[role] : null;
}

const MEMBER_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  superadmin: "Super Admin",
  admin: "Admin",
  seller_manager: "Sales Manager",
  member: "Member",
  seller: "Seller",
  accountant: "Accountant (bookkeeping)",
  viewer: "Accountant (bookkeeping)",
  hr: "HR / Payroll manager",
  employee: "Employee (self-service)",
  ...CA_ROLE_LABELS,
};

/** Display label of a member role code (unknown codes are title-cased). */
export function memberRoleLabel(role: string): string {
  return MEMBER_ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
}
