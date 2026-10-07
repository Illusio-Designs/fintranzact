import { PageHeader } from "@/components/ui/PageHeader";
import { UnderlineTabs } from "@/components/ui/Tabs";
import { PayrollAddonNotice, usePayrollAccess } from "./PayrollGate";
import { EmployeesTab } from "./EmployeesTab";
import { SalaryTab } from "./SalaryTab";
import { AttendanceTab } from "./AttendanceTab";
import { LeaveTab } from "./LeaveTab";
import { RunsTab } from "./RunsTab";
import { StatutoryTab } from "./StatutoryTab";
import { DuesTab } from "./DuesTab";
import { FilingsTab } from "./FilingsTab";

export const PAYROLL_TABS = [
  { value: "employees", label: "Employees" },
  { value: "salary", label: "Salary structures" },
  { value: "attendance", label: "Attendance" },
  { value: "leave", label: "Leave" },
  { value: "runs", label: "Payroll runs" },
  { value: "statutory", label: "Statutory settings" },
  { value: "dues", label: "Statutory dues" },
  { value: "filings", label: "Filings and registers" },
] as const;

export type PayrollTab = (typeof PAYROLL_TABS)[number]["value"];

/**
 * The Payroll page: the add-on notice when the organisation does not have the
 * add-on, otherwise its eight sections. (The route file only wires the ?tab=
 * search parameter to this component.)
 */
export function PayrollPage({ tab, onTabChange }: { tab: PayrollTab; onTabChange: (tab: PayrollTab) => void }) {
  const access = usePayrollAccess();
  // A read-only organisation (trial over) keeps seeing the payroll data it has; the server refuses its changes.
  const usable = access.active || access.readOnly;

  return (
    <div>
      <PageHeader title="Payroll" description="Employees, attendance and leave, salary structures, monthly payroll runs and payslips, and statutory deductions, dues and filings." />
      {access.loading ? (
        <p className="text-sm text-text-tertiary">Loading...</p>
      ) : !usable ? (
        <PayrollAddonNotice />
      ) : (
        <>
          <UnderlineTabs
            label="Payroll sections"
            value={tab}
            onChange={(v) => onTabChange(v as PayrollTab)}
            tabs={PAYROLL_TABS.map((t) => ({ value: t.value, label: t.label }))}
            className="mb-5 border-b border-border-light"
          />
          {tab === "employees" && <EmployeesTab />}
          {tab === "salary" && <SalaryTab />}
          {tab === "attendance" && <AttendanceTab />}
          {tab === "leave" && <LeaveTab />}
          {tab === "runs" && <RunsTab />}
          {tab === "statutory" && <StatutoryTab />}
          {tab === "dues" && <DuesTab />}
          {tab === "filings" && <FilingsTab />}
        </>
      )}
    </div>
  );
}
