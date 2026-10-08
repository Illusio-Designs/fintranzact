import { AbilityBuilder, PureAbility, createMongoAbility } from "@casl/ability";
import { TRPCError } from "@trpc/server";

// Action types
export type Action = "create" | "read" | "update" | "delete" | "manage";

// Resource types
export type Resource =
  | "Invoice" | "Payment" | "Party" | "Item" | "Expense"
  | "BankAccount" | "BankTransaction"
  | "Business" | "Team" | "Import" | "Report" | "GstReport"
  | "Store" | "SalesTarget" | "RecurringInvoice"
  | "Account" | "ITC" | "Tds" | "PeriodLock"
  | "BankReconciliation" | "EInvoice" | "EWayBill"
  | "Payroll"
  // Payroll Phase 3: posting a payroll run (and statutory payments) to the books, which HR does not do.
  | "PayrollPosting"
  // Payroll Phase 3: the employee self-service procedures (payrollSelf.*). Only the employee role holds it.
  | "PayrollSelf"
  | "Ai"
  | "all";

export type AppAbility = PureAbility<[Action, Resource]>;

interface PermissionContext {
  userId: string;
  role: string;
}

/** Everything the read-only and filing accountant roles may read. */
export const ACCOUNTANT_READ_SUBJECTS: readonly Resource[] = [
  "Invoice", "Payment", "Party", "Item", "Expense",
  "BankAccount", "BankTransaction", "BankReconciliation", "Account",
  "Report", "GstReport", "ITC", "Tds", "EInvoice", "EWayBill",
  "Business", "Store", "RecurringInvoice",
];

/** Roles that may only read, apart from the filing allowlist below. */
export const CA_ROLES = ["auditor", "ca_filing"] as const;

/**
 * The only mutations a `ca_filing` role may call (`auditor` may call none).
 * Enforced in trpc.ts withPermissions via caRoleMutationAllowed. To let
 * ca_filing use a new filing procedure, add its path here (the typo guard in
 * ca-role-backstop.test.ts fails if a path is not a real mutation).
 */
export const CA_FILING_MUTATIONS: readonly string[] = [
  "gstReturns.requestOtp",
  "gstReturns.verifyOtp",
  "gstReturns.saveGstr1",
  "gstReturns.proceedGstr1",
  "gstReturns.fetchGstr1Summary",
  "gstReturns.pollReturnStatus",
  "gstReturns.requestEvcOtp",
  "gstReturns.fileGstr1",
  "gstReturns.saveGstr3b",
  "gstReturns.checkLedgerGstr3b",
  "gstReturns.postOffsetGstr3b",
  "gstReturns.fetchGstr3bDetails",
  "gstReturns.fileGstr3b",
  "gstReturns.pull2b",
  "gstr2b.upload",
  "gstr2b.linkInvoice",
  "gstr2b.ignoreRecord",
  "period.lockGstMonth",
];

export const CA_READ_ONLY_MESSAGE = "Your access is read-only. Ask the business owner for a role that can make changes.";
export const CA_FILING_ONLY_MESSAGE = "Filing access only. You can prepare and file GST returns, but not change the business's books.";

/** May this (already mapped) role call the mutation at `path`? Non-CA roles: always yes (CASL decides). */
export function caRoleMutationAllowed(role: string, path: string): boolean {
  if (role === "auditor") return false;
  if (role !== "ca_filing") return true;
  return CA_FILING_MUTATIONS.includes(path);
}

/** The refusal message for a CA role (use with caRoleMutationAllowed on tenant-base mutations). */
export function caRoleRefusalMessage(role: string): string {
  return role === "auditor" ? CA_READ_ONLY_MESSAGE : CA_FILING_ONLY_MESSAGE;
}

/** Marking a GST return as filed: the owner-side lock permission, or the filing permission. */
export function canMarkGstFiled(ability: AppAbility): boolean {
  return ability.can("create", "PeriodLock") || ability.can("create", "GstReport");
}

export function defineAbilityFor(ctx: PermissionContext): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const { role } = ctx;

  switch (role) {
    case "superadmin":
      can("manage", "all");
      break;

    case "admin":
      can("manage", "all");
      // Cannot demote or remove superadmin (handled in team management logic, not CASL)
      break;

    case "seller_manager":
      // Invoices: full CRUD, delete only unpaid <2hrs (time check done at endpoint level)
      can("create", "Invoice");
      can("read", "Invoice");
      can("update", "Invoice");
      can("delete", "Invoice"); // API enforces: unpaid + <2hrs
      // Parties & Items
      can("create", "Party");
      can("read", "Party");
      can("update", "Party");
      can("create", "Item");
      can("read", "Item");
      can("update", "Item");
      // Payments: create for own invoices, edit within 2hrs
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment"); // API enforces: own + <2hrs
      // View only
      can("read", "Expense");
      can("read", "BankAccount");
      can("read", "BankTransaction");
      can("read", "Account");
      can("read", "Business");
      can("read", "Report");
      // AI assistant (add-on): ask questions and keep own chat history. What it can read is still
      // decided by this role's own permissions, per tool (lib/ai/tools.ts).
      can("create", "Ai");
      can("read", "Ai");
      // GST returns: read (docs/architecture/role-based-ui.md §3)
      can("read", "GstReport");
      // Store: create/read/update (toggle items, confirm orders)
      can("create", "Store");
      can("read", "Store");
      can("update", "Store");
      // Sales targets: read own targets + manage targets for their team
      can("read", "SalesTarget");
      can("manage", "SalesTarget");
      // Recurring invoices: full CRUD
      can("create", "RecurringInvoice");
      can("read", "RecurringInvoice");
      can("update", "RecurringInvoice");
      can("delete", "RecurringInvoice");
      break;

    case "seller":
      // Invoices: create, edit own only within 2hrs
      can("create", "Invoice");
      can("read", "Invoice");
      can("update", "Invoice"); // API enforces: own + <2hrs
      // Parties: create + read
      can("create", "Party");
      can("read", "Party");
      // Items: read only
      can("read", "Item");
      // Payments: create for own invoices, edit within 2hrs
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment"); // API enforces: own + <2hrs
      // View basics
      can("read", "Business");
      // Store: read only (view orders)
      can("read", "Store");
      // Sales targets: read (myTargets is self-scoped, list filtered by admin)
      can("read", "SalesTarget");
      // Recurring invoices: read only
      can("read", "RecurringInvoice");
      // Reports
      can("read", "Report");
      // AI assistant (add-on): see the seller_manager note.
      can("create", "Ai");
      can("read", "Ai");
      break;

    case "accountant":
      // Full financial access
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment");
      can("create", "Expense");
      can("read", "Expense");
      can("update", "Expense");
      can("delete", "Expense");
      can("manage", "BankAccount");
      can("manage", "BankTransaction");
      can("manage", "Account");
      can("manage", "ITC");
      can("manage", "Tds");
      can("manage", "PeriodLock");
      can("manage", "BankReconciliation");
      can("read", "EInvoice");
      can("read", "EWayBill");
      can("read", "Report");
      can("read", "GstReport");
      // Read-only on non-financial
      can("read", "Invoice");
      can("read", "Party");
      can("read", "Item");
      can("read", "Business");
      // Store: read only (view orders for reconciliation)
      can("read", "Store");
      // Recurring invoices: read only
      can("read", "RecurringInvoice");
      // Payroll (add-on): an accountant prepares payroll (employees, attendance,
      // leave, calculating a run, posting to the books, marking it paid) but
      // cannot approve it, delete payroll setup, or see full identity and bank
      // numbers: approval, delete and the unmasked view need "manage", which
      // only owners and admins hold. No other role can see salary data.
      can("create", "Payroll");
      can("read", "Payroll");
      can("update", "Payroll");
      // Posting a run to the books and recording statutory payments is bookkeeping, which an accountant does.
      can("create", "PayrollPosting");
      // AI assistant (add-on): see the seller_manager note.
      can("create", "Ai");
      can("read", "Ai");
      break;

    case "hr":
      // HR / Payroll manager (docs/architecture/payroll-self-service.md): everything in Payroll
      // that an accountant prepares (employees, attendance, leave, runs, payslips, statutory
      // views and files), but nothing in the books: no posting, no approval or delete (those need
      // "manage", which only owners and admins hold), no unmasked identity numbers, no
      // business settings, billing or team. No AI assistant (it is the books' assistant).
      can("create", "Payroll");
      can("read", "Payroll");
      can("update", "Payroll");
      can("read", "Business");
      break;

    case "employee":
      // Employee self-service: only the payrollSelf procedures, which resolve the employee from
      // the signed-in membership. Nothing else, not even Business. The API also refuses every
      // procedure outside the allowlist for this role (trpc.ts).
      can("create", "PayrollSelf");
      can("read", "PayrollSelf");
      can("update", "PayrollSelf");
      break;

    case "auditor":
    case "ca_filing": {
      // Accountant access without bookkeeping rights: read everything a CA
      // needs to review the books. No create/update/delete/manage anywhere.
      // Mutations are additionally refused by caRoleMutationAllowed (trpc.ts).
      for (const subject of ACCOUNTANT_READ_SUBJECTS) can("read", subject);
      // ca_filing alone may prepare/file GST returns (gstReturns.*, gstr2b.*).
      if (role === "ca_filing") can("create", "GstReport");
      break;
    }

    default:
      // Unknown role gets nothing
      break;
  }

  return build();
}

// Map legacy DB enum values to the new permission roles
export function mapDbRole(dbRole: string): string {
  const mapping: Record<string, string> = {
    "owner": "superadmin",        // Legacy: owner = superadmin
    "admin": "admin",
    "member": "seller",           // Legacy: member = seller (most common)
    "viewer": "accountant",       // Legacy: viewer = accountant
    // New roles (once enum is extended):
    "superadmin": "superadmin",
    "seller_manager": "seller_manager",
    "seller": "seller",
    "accountant": "accountant",
    "auditor": "auditor",
    "ca_filing": "ca_filing",
    "hr": "hr",
    "employee": "employee",
  };
  // Unknown roles map to an empty string — defineAbilityFor hits the default case (no permissions)
  return mapping[dbRole] ?? "";
}

// Helper to enforce CASL permissions in tRPC procedures
export function requireCan(ability: AppAbility, action: Action, resource: Resource): void {
  if (!ability.can(action, resource)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Cannot ${action} ${resource}` });
  }
}
