/**
 * What each tenant role may do in the web app, mirroring the API's CASL rules
 * (packages/api/src/lib/permissions.ts) closely enough to hide what a role
 * cannot use: the sidebar, and actions such as creating an invoice. The API
 * still enforces every rule; this only keeps refused actions out of sight.
 */
import { trpc } from "@/lib/trpc";

export const ROLE_ABILITIES: Record<string, Set<string>> = {
  owner: new Set(["*"]),
  admin: new Set(["*"]),
  seller_manager: new Set([
    "Invoice:read",
    "Invoice:create",
    "Party:read",
    "Item:read",
    "Payment:read",
    "Store:read",
    "RecurringInvoice:read",
    "Business:read",
  ]),
  seller: new Set([
    "Invoice:read",
    "Invoice:create",
    "Party:read",
    "Item:read",
    "Payment:read",
    "Store:read",
    "Business:read",
    "RecurringInvoice:read",
  ]),
  accountant: new Set([
    "Payment:read",
    "Expense:read",
    "BankAccount:read",
    "Invoice:read",
    "Party:read",
    "Item:read",
    "Store:read",
    "RecurringInvoice:read",
    "Report:read",
    "GstReport:read",
    "Business:read",
    // Mirrors the API: accountants manage the books and read compliance docs
    "Account:read",
    "BankReconciliation:read",
    "ITC:read",
    "EInvoice:read",
    "EWayBill:read",
  ]),
};

export function canAccess(
  role: string | null | undefined,
  resource: string,
  action: string,
): boolean {
  if (!role) return true; // graceful degradation while loading
  const abilities = ROLE_ABILITIES[role];
  if (!abilities) return true; // unknown role — show all
  if (abilities.has("*")) return true;
  return abilities.has(`${resource}:${action}`);
}

/** Whether the signed-in member's role allows `action` on `resource`. */
export function useCan(resource: string, action: string): boolean {
  const { data: session } = trpc.auth.me.useQuery();
  return canAccess(session?.role, resource, action);
}
