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
import { AccessTab } from "./AccessTab";
import { PunchesTab } from "./PunchesTab";
import { ImportTab } from "./ImportTab";
import { BonusTab } from "./BonusTab";
import { GratuityTab } from "./GratuityTab";
import { LoansTab } from "./LoansTab";
import { FnfTab } from "./FnfTab";

export const PAYROLL_TABS = [
  { value: "employees", label: "Employees" },
  { value: "salary", label: "Salary structures" },
  { value: "attendance", label: "Attendance" },
  { value: "leave", label: "Leave" },
  { value: "punches", label: "Check-ins" },
  { value: "import", label: "Device import" },
  { value: "access", label: "Employee app" },
  { value: "runs", label: "Payroll runs" },
  { value: "bonus", label: "Bonus" },
  { value: "gratuity", label: "Gratuity" },
  { value: "loans", label: "Loans and advances" },
  { value: "fnf", label: "Full and final" },
  { value: "statutory", label: "Statutory settings" },
  { value: "dues", label: "Statutory dues" },
  { value: "filings", label: "Filings and registers" },
] as const;

export type PayrollTab = (typeof PAYROLL_TABS)[number]["value"];

/**
 * The Payroll page: the add-on notice when the organisation does not have the
 * add-on, otherwise its fifteen sections. (The route file only wires the ?tab=
 * search parameter to this component.)
 */
export function PayrollPage({ tab, onTabChange }: { tab: PayrollTab; onTabChange: (tab: PayrollTab) => void }) {
  const access = usePayrollAccess();
  // A read-only organisation (trial over) keeps seeing the payroll data it has; the server refuses its changes.
  const usable = access.active || access.readOnly;

  return (
    <div>
      <PageHeader title="Payroll" description="Employees, attendance and leave, check-ins and device import, the employee app, salary structures, monthly payroll runs and payslips, bonus, gratuity, loans and advances, full and final settlement, and statutory deductions, dues and filings." />
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
          {tab === "punches" && <PunchesTab />}
          {tab === "import" && <ImportTab />}
          {tab === "access" && <AccessTab />}
          {tab === "runs" && <RunsTab />}
          {tab === "bonus" && <BonusTab />}
          {tab === "gratuity" && <GratuityTab />}
          {tab === "loans" && <LoansTab />}
          {tab === "fnf" && <FnfTab />}
          {tab === "statutory" && <StatutoryTab />}
          {tab === "dues" && <DuesTab />}
          {tab === "filings" && <FilingsTab />}
        </>
      )}
    </div>
  );
}
