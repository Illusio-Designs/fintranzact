/** Member roles for `tenant invite` / `tenant update-role`, and the help that explains the accountant (CA) roles. */
export const VALID_ROLES = ["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"] as const;
export type TenantRole = (typeof VALID_ROLES)[number];

/** Roles that bring in the business's CA; only the organisation owner may assign them. */
export const CA_ROLES = ["auditor", "ca_filing"] as const;

export function isCaRole(role: string): boolean {
  return (CA_ROLES as readonly string[]).includes(role);
}

export const ROLE_HELP = [
  "Roles:",
  "  admin, seller_manager, seller   staff roles (owners and admins may invite them)",
  "  accountant                      accountant (bookkeeping): keeps the books, reads everything else",
  "  auditor                         accountant (read-only): views everything and downloads reports, changes nothing",
  "  ca_filing                       accountant (filing): as auditor, plus prepares and files GST returns",
  "",
  "auditor and ca_filing are the CA roles for inviting your accountant. Only the organisation owner may",
  "assign them (admins cannot), at most 3 per organisation, and they do not count towards the plan's",
  "team-member limit. The CA gets an email, can be removed at any time, and their activity is logged.",
].join("\n");

/** The line printed after a successful invite. */
export function inviteSuccessLine(email: string, role: string): string {
  return isCaRole(role)
    ? `Invited ${email} as your accountant (${role === "auditor" ? "read-only" : "filing"}); they were emailed`
    : `Invited ${email} as ${role}`;
}

/** The invite link from an inviteMember result (the API returns `inviteUrl` and the raw `token`). */
export function inviteLinkOf(result: { inviteUrl?: string; inviteLink?: string; token?: string; inviteToken?: string }): string | undefined {
  return result.inviteUrl ?? result.inviteLink;
}
