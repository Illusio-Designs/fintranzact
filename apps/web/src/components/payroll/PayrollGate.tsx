import { Link } from "@tanstack/react-router";
import { availableAddonIds } from "@fintranzact/shared";
import { useEntitlements } from "@/hooks/useEntitlements";

/**
 * Whether the organisation has the Payroll add-on right now, from
 * `billing.status` (a mirror for the page: the server refuses every payroll call
 * without it). During the Full Access Trial the add-on is on, with a cap on
 * employees (`trial.caps.payrollEmployees`).
 */
export function usePayrollAccess() {
  const { status, isLoading, canManageBilling } = useEntitlements();
  const active = !!status?.addons?.payroll;
  const trialCap = status?.trial?.active && status.trial.caps ? status.trial.caps.payrollEmployees : null;
  return {
    status,
    loading: isLoading && !status,
    active,
    /** The add-on can be bought today (false while it is not on sale). */
    canBuy: availableAddonIds().includes("payroll"),
    canManageBilling,
    trialCap,
    readOnly: !!status?.readOnly,
  };
}

/**
 * Shown instead of the payroll pages when the add-on is not active. There is no
 * purchase button while Payroll is not on sale (availableAddonIds); an owner is
 * pointed at Billing only when it can be bought.
 */
export function PayrollAddonNotice() {
  const { canBuy, canManageBilling } = usePayrollAccess();
  return (
    <div
      role="status"
      data-testid="payroll-addon-notice"
      className="rounded-xl border border-border-light bg-surface-1 px-5 py-4 text-sm text-text-secondary"
    >
      <p className="text-base font-semibold text-text-primary">Payroll is an add-on</p>
      <p className="mt-1 max-w-2xl">
        Employees, attendance and leave, salary structures, monthly payroll runs and payslips are part of the Payroll add-on, which your organisation does not have.
        {canBuy
          ? " You can add it from Billing."
          : " It is not on sale yet. Organisations in the Full Access Trial can try it with up to 10 employees."}
      </p>
      {canBuy && (
        <div className="mt-3">
          {canManageBilling ? (
            <Link to="/settings" search={{ tab: "billing" }} className="btn-primary">
              See add-ons
            </Link>
          ) : (
            <p className="text-text-tertiary">Ask an owner of the organisation to add it from Billing.</p>
          )}
        </div>
      )}
    </div>
  );
}
