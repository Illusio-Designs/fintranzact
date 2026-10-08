import { CA_ACCESS_CHOICES, CA_ROLES, isCaRole, memberRoleLabel } from "@fintranzact/shared";

/** Display label of a member role (viewer shows as the bookkeeping accountant it maps to). */
export function roleLabel(role: string): string {
  return memberRoleLabel(role);
}

/** Roles anyone who may invite can give; CA roles go through "Invite my CA". */
export const STAFF_INVITE_ROLES: Array<{ key: string; label: string }> = [
  { key: "admin", label: "Admin" },
  { key: "seller_manager", label: "Seller Manager" },
  { key: "seller", label: "Seller" },
  { key: "accountant", label: "Accountant (bookkeeping)" },
  { key: "hr", label: "HR / Payroll manager" },
];

/** The two choices in "Invite my CA". */
export const CA_INVITE_CHOICES = CA_ACCESS_CHOICES.map((c) => ({ key: c.role as string, title: c.title, description: c.description }));

/** Only the owner (and superadmin) may invite a CA or move someone to or from a CA role. */
export function canManageCa(role: string | null | undefined): boolean {
  return role === "owner" || role === "superadmin";
}

/** Roles shown in the change-role sheet: CA roles only for the owner. */
export function changeRoleOptions(callerRole: string | null | undefined): Array<{ key: string; label: string }> {
  if (!canManageCa(callerRole)) return STAFF_INVITE_ROLES;
  return [...STAFF_INVITE_ROLES, ...CA_ROLES.map((r) => ({ key: r as string, label: roleLabel(r) }))];
}

/** May the caller change this member's role? An admin cannot touch a CA's access. */
export function canChangeMemberRole(callerRole: string | null | undefined, memberRole: string): boolean {
  if (memberRole === "owner" || memberRole === "superadmin") return false;
  // An employee login is managed in Payroll (it is linked to one employee record).
  if (memberRole === "employee") return false;
  return canManageCa(callerRole) || !isCaRole(memberRole);
}
