/**
 * Payroll (add-on): employees, salary structures, attendance, leave, payroll
 * runs, payslips. The invariants the run engine (lib/payroll/run.ts) keeps and
 * nothing in the database enforces: a run's totals are the sum of its lines, a
 * line adds up, an approved run has its payslips, a posted run has a balanced
 * journal entry, and what is stored matches what was posted.
 */

import type { TableCoverage } from "../types.js";
import { MONEY_TOLERANCE, rule } from "../sql-fragments.js";

const RUN_WRITERS = ["payrollRun.calculate / approve / post / markPaid (Payroll runs)"];

export const payrollTables: TableCoverage[] = [
  {
    table: "payroll_settings",
    rules: [],
    noExtraRequirements: "One row per business (unique index) holding payroll defaults (weekly offs, standard hours, overtime multiplier, leave year); every column is NOT NULL with a default and nothing else reads across tables.",
  },
  {
    table: "payroll_departments",
    rules: [],
    noExtraRequirements: "A name per business (unique index); employees point at it with an FK that clears on delete.",
  },
  {
    table: "payroll_designations",
    rules: [],
    noExtraRequirements: "A name per business (unique index); employees point at it with an FK that clears on delete.",
  },
  {
    table: "payroll_shifts",
    rules: [],
    noExtraRequirements: "A name per business (unique index) with times and weekly-off weekdays; employees point at it with an FK that clears on delete.",
  },
  {
    table: "employees",
    rules: [
      rule("employees", "exit-has-last-working-day", "error",
        "An exited employee has a last working day, and an active employee has none.",
        ["payrollEmployee.exit / reactivate"],
        `SELECT e.business_id, e.id::text, e.employee_code || ': status ' || e.status || ', last working day ' || COALESCE(e.last_working_day::text, 'NULL')
         FROM employees e WHERE (e.status = 'exited' AND e.last_working_day IS NULL) OR (e.status = 'active' AND e.last_working_day IS NOT NULL)`),
      rule("employees", "last-day-not-before-joining", "error",
        "The last working day is not before the joining date.",
        ["payrollEmployee.exit"],
        `SELECT e.business_id, e.id::text, e.employee_code || ': joined ' || e.date_of_joining || ', left ' || e.last_working_day
         FROM employees e WHERE e.last_working_day IS NOT NULL AND e.last_working_day < e.date_of_joining`),
    ],
  },
  {
    table: "salary_components",
    rules: [],
    noExtraRequirements: "A coded earning, deduction or employer contribution per business (unique code); type and category agree when it is saved, and statutory_kind is null in Phase 1 (reserved for the statutory phase).",
  },
  {
    table: "salary_templates",
    rules: [],
    noExtraRequirements: "A named set of component lines per business (unique name); its lines cascade with it and assignments keep their own snapshot.",
  },
  {
    table: "salary_template_lines",
    rules: [],
    noExtraRequirements: "One line per component in a template (unique index); the template cascades, the component is an FK; calculation validity is checked when the template is saved.",
  },
  {
    table: "employee_salary_assignments",
    rules: [
      rule("employee_salary_assignments", "has-breakdown", "error",
        "Every salary assignment stores a monthly breakdown with at least one component (payroll calculates from it).",
        ["payrollSalary.assign"],
        `SELECT a.business_id, a.id::text, 'monthly CTC ' || a.monthly_ctc || ', components ' || jsonb_array_length(a.breakdown)
         FROM employee_salary_assignments a WHERE jsonb_array_length(a.breakdown) = 0`),
    ],
  },
  {
    table: "attendance_records",
    rules: [
      rule("attendance_records", "inside-employment", "warning",
        "A day is marked only between the employee's joining date and last working day.",
        ["payrollAttendance.mark / bulkMark", "payrollLeave.decide", "payrollRun.lockAttendance"],
        `SELECT r.business_id, r.id::text, e.employee_code || ' ' || r.date || ' outside ' || e.date_of_joining || ' to ' || COALESCE(e.last_working_day::text, 'now')
         FROM attendance_records r JOIN employees e ON e.id = r.employee_id
         WHERE r.date < e.date_of_joining OR (e.last_working_day IS NOT NULL AND r.date > e.last_working_day AND r.source = 'manual')`),
    ],
  },
  {
    table: "payroll_holidays",
    rules: [],
    noExtraRequirements: "A dated, named holiday with a scope; the scope's state or branch is checked when it is saved and nothing else reads across tables.",
  },
  {
    table: "leave_types",
    rules: [],
    noExtraRequirements: "A code per business (unique index) with the leave rules; employees' balances and applications point at it.",
  },
  {
    table: "leave_ledger",
    rules: [
      rule("leave_ledger", "sign-matches-kind", "error",
        "Leave taken, closing, lapse and encashment rows are negative; accrual and carry-forward rows are positive.",
        ["payrollLeave.decide / cancel / accrue / closeYear / encash"],
        `SELECT l.business_id, l.id::text, l.kind || ' ' || l.days
         FROM leave_ledger l
         WHERE (l.kind IN ('taken', 'closing', 'lapse', 'encashment') AND l.days > 0)
            OR (l.kind IN ('accrual', 'carry_forward', 'cancelled') AND l.days < 0)`),
    ],
  },
  {
    table: "leave_applications",
    rules: [
      rule("leave_applications", "split-adds-up", "error",
        "An approved application's paid days plus loss-of-pay days equal its days.",
        ["payrollLeave.decide"],
        `SELECT a.business_id, a.id::text, 'days ' || a.days || ', paid ' || a.paid_days || ', LOP ' || a.lop_days
         FROM leave_applications a WHERE a.status = 'approved' AND ABS(a.paid_days + a.lop_days - a.days) > 0.001`),
    ],
  },
  {
    table: "leave_encashments",
    rules: [],
    noExtraRequirements: "Days and amount for one employee and leave type, waiting for (or attached to) a payroll run; the amount is paid as an earning on that run's line and nothing else is derived from it.",
  },
  {
    table: "payroll_runs",
    rules: [
      rule("payroll_runs", "totals-match-lines", "error",
        "A run's gross, deductions, employer and net totals and its employee count are the sums of its lines.",
        RUN_WRITERS,
        `SELECT r.business_id, r.id::text, r.month || ': run net ' || r.net_total || ' vs lines ' || l.n || ', run gross ' || r.gross_total || ' vs lines ' || l.g || ', count ' || r.employee_count || ' vs ' || l.c
         FROM payroll_runs r
         JOIN (SELECT run_id, COUNT(*) c, SUM(gross_earnings) g, SUM(total_deductions) d, SUM(employer_contributions) e, SUM(net_pay) n FROM payroll_run_lines GROUP BY run_id) l ON l.run_id = r.id
         WHERE ABS(r.gross_total - l.g) > ${MONEY_TOLERANCE} OR ABS(r.deductions_total - l.d) > ${MONEY_TOLERANCE}
            OR ABS(r.employer_total - l.e) > ${MONEY_TOLERANCE} OR ABS(r.net_total - l.n) > ${MONEY_TOLERANCE} OR r.employee_count <> l.c`),
      rule("payroll_runs", "approved-run-has-payslips", "error",
        "An approved (or posted, or paid) run has one payslip per employee line and was approved by someone.",
        RUN_WRITERS,
        `SELECT r.business_id, r.id::text, r.month || ': status ' || r.status || ', ' || r.employee_count || ' lines, ' || (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) || ' payslips'
         FROM payroll_runs r
         WHERE r.status IN ('approved', 'posted', 'paid')
           AND (r.approved_by_user_id IS NULL OR (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) <> (SELECT COUNT(*) FROM payroll_run_lines l WHERE l.run_id = r.id))`),
      rule("payroll_runs", "posted-run-has-balanced-journal", "error",
        "A posted (or paid) run links the journal entry it posted, that entry balances, and its debits equal the run's gross earnings plus employer contributions.",
        RUN_WRITERS,
        `SELECT r.business_id, r.id::text, r.month || ': journal ' || COALESCE(r.accrual_journal_entry_id::text, 'NULL') || ', debit ' || COALESCE(j.d::text, 'NULL') || ', credit ' || COALESCE(j.c::text, 'NULL')
         FROM payroll_runs r
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d, SUM(credit) c FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = r.accrual_journal_entry_id
         WHERE r.status IN ('posted', 'paid') AND r.net_total + r.deductions_total + r.employer_total > 0
           AND (r.accrual_journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - j.c) > ${MONEY_TOLERANCE} OR ABS(j.d - (r.gross_total + r.employer_total)) > ${MONEY_TOLERANCE})`),
      rule("payroll_runs", "paid-run-has-payment", "error",
        "A paid run records its date and bank or cash account, and (when there is net pay) the journal entry that paid it, for exactly the net total.",
        RUN_WRITERS,
        `SELECT r.business_id, r.id::text, r.month || ': paid on ' || COALESCE(r.paid_on::text, 'NULL') || ', account ' || COALESCE(r.paid_from_bank_account_id::text, 'NULL') || ', payment entry ' || COALESCE(r.payment_journal_entry_id::text, 'NULL')
         FROM payroll_runs r
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = r.payment_journal_entry_id
         WHERE r.status = 'paid'
           AND (r.paid_on IS NULL OR r.paid_from_bank_account_id IS NULL
                OR (r.net_total > 0 AND (r.payment_journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - r.net_total) > ${MONEY_TOLERANCE})))`),
      rule("payroll_runs", "status-matches-links", "error",
        "A run that is not posted has no accrual journal entry, and one that is not paid has no payment entry.",
        RUN_WRITERS,
        `SELECT r.business_id, r.id::text, r.month || ': status ' || r.status
         FROM payroll_runs r
         WHERE (r.status NOT IN ('posted', 'paid') AND r.accrual_journal_entry_id IS NOT NULL) OR (r.status <> 'paid' AND r.payment_journal_entry_id IS NOT NULL)`),
    ],
  },
  {
    table: "payroll_run_lines",
    rules: [
      rule("payroll_run_lines", "net-is-gross-minus-deductions", "error",
        "A line's net pay is its gross earnings less its deductions.",
        RUN_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': net ' || l.net_pay || ' vs ' || (l.gross_earnings - l.total_deductions)
         FROM payroll_run_lines l WHERE ABS(l.net_pay - (l.gross_earnings - l.total_deductions)) > ${MONEY_TOLERANCE}`),
      rule("payroll_run_lines", "components-add-up", "error",
        "A line's stored earnings, deductions and employer contributions equal the sums of its components.",
        RUN_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': gross ' || l.gross_earnings || ' vs ' || s.e || ', deductions ' || l.total_deductions || ' vs ' || s.d
         FROM payroll_run_lines l
         JOIN LATERAL (SELECT
              COALESCE(SUM((c->>'amount')::numeric) FILTER (WHERE c->>'type' = 'earning'), 0) e,
              COALESCE(SUM((c->>'amount')::numeric) FILTER (WHERE c->>'type' = 'deduction'), 0) d,
              COALESCE(SUM((c->>'amount')::numeric) FILTER (WHERE c->>'type' = 'employer_contribution'), 0) x
            FROM jsonb_array_elements(l.components) c) s ON true
         WHERE ABS(l.gross_earnings - s.e) > ${MONEY_TOLERANCE} OR ABS(l.total_deductions - s.d) > ${MONEY_TOLERANCE} OR ABS(l.employer_contributions - s.x) > ${MONEY_TOLERANCE}`),
      rule("payroll_run_lines", "paid-days-within-month", "error",
        "Paid days plus loss-of-pay days equal the employed days, and never exceed the days in the month.",
        RUN_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': paid ' || l.paid_days || ' + LOP ' || l.lop_days || ' vs employed ' || l.employed_days || ' of ' || l.days_in_month
         FROM payroll_run_lines l WHERE ABS(l.paid_days + l.lop_days - l.employed_days) > 0.01 OR l.employed_days > l.days_in_month`),
    ],
  },
  {
    table: "payroll_run_adjustments",
    rules: [],
    noExtraRequirements: "A one-off earning or deduction for an employee in a run: the amount is NOT NULL and the run cascades; its effect is recomputed into the run line every time the run is calculated.",
  },
  {
    table: "payslips",
    rules: [
      rule("payslips", "snapshot-matches-line", "error",
        "A payslip's snapshot shows the same gross, deductions and net pay as the (frozen) run line it was made from.",
        RUN_WRITERS,
        `SELECT p.business_id, p.id::text, p.number || ': payslip net ' || (p.snapshot->>'netPay') || ' vs line ' || l.net_pay
         FROM payslips p JOIN payroll_run_lines l ON l.id = p.line_id
         WHERE (p.snapshot->>'netPay')::numeric <> l.net_pay OR (p.snapshot->>'grossEarnings')::numeric <> l.gross_earnings OR (p.snapshot->>'totalDeductions')::numeric <> l.total_deductions`),
    ],
  },
];
