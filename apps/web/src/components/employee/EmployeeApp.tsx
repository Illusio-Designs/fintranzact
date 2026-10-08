import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc, setBusinessId, queryClient } from "@/lib/trpc";
import { clearDesktopToken } from "@/lib/desktop-session";
import { Logo } from "@/components/ui/Logo";
import { UnderlineTabs } from "@/components/ui/Tabs";
import { CheckInPanel } from "./CheckInPanel";
import { MyAttendance } from "./MyAttendance";
import { MyPayslips } from "./MyPayslips";
import { MyLeave } from "./MyLeave";

export const EMPLOYEE_TABS = [
  { value: "home", label: "Check in" },
  { value: "attendance", label: "Attendance" },
  { value: "payslips", label: "Payslips and Form 16" },
  { value: "leave", label: "Leave" },
] as const;
export type EmployeeTab = (typeof EMPLOYEE_TABS)[number]["value"];

const BUSINESS_KEY = "selectedBusinessId";

/**
 * The restricted app an employee login sees instead of the accounting app (root layout): check in and
 * out, my attendance, my payslips and Form 16, my leave. No accounting navigation, no other route. Every
 * call is the employee's own: the server finds the employee from the signed-in membership.
 */
export function EmployeeApp({ tenantName }: { tenantName: string | null }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<EmployeeTab>("home");
  const places = trpc.payrollSelf.workplaces.useQuery();
  const orgs = trpc.tenant.list.useQuery();
  const utils = trpc.useUtils();
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(BUSINESS_KEY);
    } catch {
      return null;
    }
  });
  const active = places.data?.find((p) => p.businessId === chosen) ?? places.data?.[0] ?? null;

  // The business header every call carries (set during render so the first queries already have it).
  setBusinessId(active?.businessId ?? null);
  useEffect(() => {
    try {
      if (active) sessionStorage.setItem(BUSINESS_KEY, active.businessId);
    } catch {
      // Private mode: the choice just is not remembered.
    }
  }, [active]);

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await clearDesktopToken();
      try {
        sessionStorage.removeItem(BUSINESS_KEY);
      } catch {
        // ignore
      }
      setBusinessId(null);
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });
  const selectTenant = trpc.tenant.select.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      void queryClient.invalidateQueries();
    },
  });

  return (
    <div className="min-h-screen bg-surface-1" data-testid="employee-app">
      <header className="border-b border-border-light bg-surface-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <div>
              <p className="text-sm font-semibold text-text-primary">{active?.businessName ?? tenantName ?? "Employee app"}</p>
              {active && <p className="text-xs text-text-tertiary">{active.employeeName}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(places.data?.length ?? 0) > 1 && (
              <select aria-label="Business" className="input !w-auto" value={active?.businessId ?? ""} onChange={(e) => setChosen(e.target.value)}>
                {places.data!.map((p) => <option key={p.businessId} value={p.businessId}>{p.businessName}</option>)}
              </select>
            )}
            {(orgs.data?.length ?? 0) > 1 && (
              <select aria-label="Organisation" className="input !w-auto" value="" onChange={(e) => e.target.value && selectTenant.mutate({ tenantId: e.target.value })}>
                <option value="">Switch organisation</option>
                {orgs.data!.map((o) => <option key={o.tenantId} value={o.tenantId}>{o.tenantName}</option>)}
              </select>
            )}
            <button className="btn-secondary btn-sm" onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">
        {places.isLoading ? (
          <p className="text-sm text-text-tertiary">Loading...</p>
        ) : !active ? (
          <div role="status" className="rounded-xl border border-border-light bg-surface-0 px-5 py-4 text-sm text-text-secondary" data-testid="employee-unlinked">
            <p className="text-base font-semibold text-text-primary">Your login is not linked to an employee record</p>
            <p className="mt-1">Payroll may be switched off for this business, or your access was removed. Ask HR to invite you again.</p>
          </div>
        ) : (
          <>
            <UnderlineTabs label="Employee sections" value={tab} onChange={(v) => setTab(v as EmployeeTab)} tabs={EMPLOYEE_TABS.map((t) => ({ value: t.value, label: t.label }))} className="mb-5 border-b border-border-light" />
            {tab === "home" && <CheckInPanel />}
            {tab === "attendance" && <MyAttendance />}
            {tab === "payslips" && <MyPayslips />}
            {tab === "leave" && <MyLeave />}
          </>
        )}
      </main>
    </div>
  );
}
