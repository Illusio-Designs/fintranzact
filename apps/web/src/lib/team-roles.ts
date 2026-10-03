import { CA_ROLES, isCaRole } from "@fintranzact/shared";
import { formatRole } from "./roles";

export type InvitableRole = "admin" | "seller_manager" | "seller" | "accountant" | "auditor" | "ca_filing";

/** Roles anyone who may invite can give (the normal invite dialog). CA roles go through "Invite my CA". */
export const STAFF_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "admin", label: formatRole("admin") },
  { value: "seller_manager", label: formatRole("seller_manager") },
  { value: "seller", label: formatRole("seller") },
  { value: "accountant", label: formatRole("accountant") },
];

/** Only the owner (and superadmin) may invite a CA or move someone to or from a CA role. */
export function isCaManager(role: string | null | undefined): boolean {
  return role === "owner" || role === "superadmin";
}

/** Options in an existing member's role dropdown: CA roles only for the owner. */
export function memberRoleOptions(callerRole: string | null | undefined): Array<{ value: string; label: string }> {
  if (!isCaManager(callerRole)) return STAFF_ROLE_OPTIONS;
  return [...STAFF_ROLE_OPTIONS, ...CA_ROLES.map((r) => ({ value: r, label: formatRole(r) }))];
}

/** Can the caller change this member's role? An admin cannot touch a CA's access. */
export function canEditMemberRole(callerRole: string | null | undefined, memberRole: string): boolean {
  if (memberRole === "owner" || memberRole === "superadmin") return false;
  return isCaManager(callerRole) || !isCaRole(memberRole);
}
