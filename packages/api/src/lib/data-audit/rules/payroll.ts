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
const BONUS_WRITERS = ["payrollBonus.calculate / approve / post / markPaid"];
const FNF_WRITERS = ["payrollFnf.calculate / approve / post / markPaid / reverse / reversePayment"];
const LOAN_WRITERS = ["payrollLoan.create / approve / disburse / receive / skip / reschedule", "payrollRun.approve (instalment recovery)", "payrollFnf.approve (balance recovery)", "payrollFnf.reverse (balance put back)"];

export const payrollTables: TableCoverage[] = [
  {
    table: "payroll_settings",
    rules: [],
    noExtraRequirements: "One row per business (unique index) holding payroll defaults (weekly offs, standard hours, overtime multiplier, leave year) and the statutory registrations (PF, ESI, PT states, LWF state, TDS); every column is NOT NULL with a default (codes may be empty) and nothing else reads across tables. What a run was calculated with is frozen on the run (payroll_runs.statutory).",
  },
  {
    table: "payroll_statutory_settings",
    rules: [],
    noExtraRequirements: "One row per business and financial year (unique index) holding the rates document (PF, ESI, PT and LWF slabs, income-tax slabs, due dates) as validated JSON plus a last-verified note; a payroll run copies what it used onto itself when it is calculated, so editing a row never changes a calculated or approved run.",
  },
  {
    table: "employee_tax_declarations",
    rules: [],
    noExtraRequirements: "One row per employee and financial year (unique index) holding the old-regime declaration amounts as validated JSON; the amounts only feed the next TDS calculation, whose result is frozen on the payroll line.",
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
      rule("payroll_run_lines", "no-pf-without-registration", "error",
        "A line has PF, VPF or EPS components only when its run was calculated for a business registered for PF: with PF off, PF and EPS appear nowhere.",
        RUN_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': PF/EPS component in a run calculated without PF registration'
         FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.run_id
         WHERE COALESCE((r.statutory->'flags'->>'pfRegistered')::boolean, false) = false
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.components) c WHERE c->>'statutoryKind' IN ('pf_employee', 'vpf', 'pf_employer', 'eps_employer'))`),
      rule("payroll_run_lines", "no-esi-without-registration", "error",
        "A line has ESI components only when its run was calculated for a business registered for ESI.",
        RUN_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': ESI component in a run calculated without ESI registration'
         FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.run_id
         WHERE COALESCE((r.statutory->'flags'->>'esiRegistered')::boolean, false) = false
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.components) c WHERE c->>'statutoryKind' IN ('esi_employee', 'esi_employer'))`),
      rule("payroll_run_lines", "statutory-component-types", "error",
        "Statutory components are typed consistently: employee shares are deductions and employer shares are employer contributions, so the line adds up and the posting is balanced.",
        RUN_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': ' || (c->>'statutoryKind') || ' typed ' || (c->>'type')
         FROM payroll_run_lines l, jsonb_array_elements(l.components) c
         WHERE (c->>'statutoryKind' IN ('pf_employee', 'vpf', 'esi_employee', 'professional_tax', 'income_tax_tds', 'lwf_employee') AND c->>'type' <> 'deduction')
            OR (c->>'statutoryKind' IN ('pf_employer', 'eps_employer', 'esi_employer', 'lwf_employer', 'gratuity') AND c->>'type' <> 'employer_contribution')`),
      rule("payroll_run_lines", "paid-days-within-month", "error",
        "Paid days plus loss-of-pay days equal the employed days, and never exceed the days in the month.",
        RUN_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': paid ' || l.paid_days || ' + LOP ' || l.lop_days || ' vs employed ' || l.employed_days || ' of ' || l.days_in_month
         FROM payroll_run_lines l WHERE ABS(l.paid_days + l.lop_days - l.employed_days) > 0.01 OR l.employed_days > l.days_in_month`),
    ],
  },
  {
    table: "payroll_statutory_payments",
    rules: [
      rule("payroll_statutory_payments", "payments-within-accrued", "error",
        "What has been paid to an authority for a run (PF, ESI, PT, LWF or TDS) is never more than that run accrued for it.",
        ["payrollStatutory.recordPayment"],
        `SELECT p.business_id, p.run_id::text, p.kind || ': paid ' || p.paid || ' vs accrued ' || COALESCE(a.accrued::text, 'none')
         FROM (SELECT business_id, run_id, kind, SUM(amount) paid FROM payroll_statutory_payments GROUP BY business_id, run_id, kind) p
         LEFT JOIN (
           SELECT l.run_id,
             CASE c->>'statutoryKind'
               WHEN 'pf_employee' THEN 'pf' WHEN 'vpf' THEN 'pf' WHEN 'pf_employer' THEN 'pf' WHEN 'eps_employer' THEN 'pf'
               WHEN 'esi_employee' THEN 'esi' WHEN 'esi_employer' THEN 'esi'
               WHEN 'professional_tax' THEN 'pt'
               WHEN 'lwf_employee' THEN 'lwf' WHEN 'lwf_employer' THEN 'lwf'
               WHEN 'income_tax_tds' THEN 'tds' END AS kind,
             SUM((c->>'amount')::numeric) accrued
           FROM payroll_run_lines l, jsonb_array_elements(l.components) c
           WHERE c->>'type' <> 'earning' AND c->>'statutoryKind' IS NOT NULL
           GROUP BY l.run_id, 2) a ON a.run_id = p.run_id AND a.kind = p.kind
         WHERE a.accrued IS NULL OR p.paid > a.accrued + ${MONEY_TOLERANCE}`),
      rule("payroll_statutory_payments", "payment-has-balanced-journal", "error",
        "Every statutory payment links its journal entry, that entry balances and its debit equals the amount paid.",
        ["payrollStatutory.recordPayment"],
        `SELECT p.business_id, p.id::text, p.kind || ' ' || p.amount || ', journal ' || COALESCE(p.journal_entry_id::text, 'NULL') || ', debit ' || COALESCE(j.d::text, 'NULL')
         FROM payroll_statutory_payments p
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d, SUM(credit) c FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = p.journal_entry_id
         WHERE p.journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - j.c) > ${MONEY_TOLERANCE} OR ABS(j.d - p.amount) > ${MONEY_TOLERANCE}`),
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

  // ── Phase 3: self-service, mobile punches, biometric import ─────────────────
  {
    table: "employee_logins",
    rules: [
      rule("employee_logins", "login-business-matches-employee", "error",
        "An employee login belongs to the same business as the employee it is linked to.",
        ["tenant.acceptInvitation (employee invitation)"],
        `SELECT l.business_id, l.id::text, 'login ' || l.id || ' links an employee of another business'
         FROM employee_logins l JOIN employees e ON e.id = l.employee_id WHERE e.business_id <> l.business_id`),
    ],
  },
  {
    table: "attendance_settings",
    rules: [],
    noExtraRequirements: "One row per business (unique index) holding the geofence policy, selfie and retention rules and the punch rollup rules; every column is NOT NULL with a default or a deliberate NULL (derived hours) and nothing reads across tables.",
  },
  {
    table: "work_locations",
    rules: [],
    noExtraRequirements: "A name, coordinates and a radius per business; punches keep only the id of the nearest location as a plain value (no foreign key), so deleting a location never changes a stored punch.",
  },
  {
    table: "employee_work_locations",
    rules: [],
    noExtraRequirements: "Links an employee to an allowed work location (unique per pair); both sides cascade on delete.",
  },
  {
    table: "attendance_import_batches",
    rules: [],
    noExtraRequirements: "One row per file import or device push with its counts and date range; punches point at it with an FK that clears on delete, and an undone batch only has its status changed.",
  },
  {
    table: "employee_punches",
    rules: [
      rule("employee_punches", "punch-values-valid", "error",
        "A punch is an in or an out, from the mobile app, a biometric device or HR, with a known geofence result.",
        ["payrollSelf.punch", "payrollImport.commit", "POST /api/attendance/push"],
        `SELECT p.business_id, p.id::text, 'kind ' || p.kind || ', source ' || p.source || ', result ' || p.geofence_result
         FROM employee_punches p
         WHERE p.kind NOT IN ('in','out') OR p.source NOT IN ('mobile','biometric','manual')
            OR p.geofence_result NOT IN ('inside','outside','no_location','low_accuracy','not_checked')`),
      rule("employee_punches", "review-has-reviewer", "error",
        "A punch that was approved or rejected records who decided and when; a pending or unflagged one records neither.",
        ["payrollPunch.review"],
        `SELECT p.business_id, p.id::text, 'review ' || COALESCE(p.review_status, 'none') || ' without a matching reviewer'
         FROM employee_punches p
         WHERE (p.review_status IN ('approved','rejected') AND (p.reviewed_by_user_id IS NULL OR p.reviewed_at IS NULL))
            OR (COALESCE(p.review_status, 'pending') = 'pending' AND p.reviewed_at IS NOT NULL)`),
      rule("employee_punches", "mobile-punch-has-server-and-client-time", "warning",
        "A mobile punch records the phone's clock for reference next to the server's time.",
        ["payrollSelf.punch"],
        `SELECT p.business_id, p.id::text, 'mobile punch without a client time'
         FROM employee_punches p WHERE p.source = 'mobile' AND p.client_time IS NULL`),
    ],
  },
  {
    table: "employee_punch_selfies",
    rules: [],
    noExtraRequirements: "The photo of one punch (primary key = the punch), deleted with it and by the retention purge; nothing else reads it, and it is never exported.",
  },
  {
    table: "attendance_consents",
    rules: [],
    noExtraRequirements: "An employee's agreement to one version of the attendance-data wording (unique per employee and version); it is only ever added.",
  },
  {
    table: "attendance_device_keys",
    rules: [],
    noExtraRequirements: "A per-business secret for biometric middleware, stored as a hash (unique); it is only ever created or revoked, and is never exported.",
  },
  {
    table: "form16_releases",
    rules: [],
    noExtraRequirements: "One row per business and financial year (unique index) meaning HR released that year's Form 16 working copy to employees; the copy itself is computed from approved runs on demand.",
  },

  // ── Phase 4: bonus, gratuity provision, full and final, loans, letters ────
  {
    table: "bonus_runs",
    rules: [
      rule("bonus_runs", "total-matches-lines", "error",
        "A calculated bonus run's total is the sum of its lines' bonus, and its employee count the number of lines.",
        BONUS_WRITERS,
        `SELECT r.business_id, r.id::text, r.number || ': total ' || r.total_bonus || ' vs lines ' || COALESCE(l.t, 0)
         FROM bonus_runs r LEFT JOIN (SELECT run_id, SUM(bonus) t, COUNT(*) n FROM bonus_run_lines GROUP BY run_id) l ON l.run_id = r.id
         WHERE r.status <> 'draft' AND (ABS(r.total_bonus - COALESCE(l.t, 0)) > ${MONEY_TOLERANCE} OR r.employee_count <> COALESCE(l.n, 0))`),
      rule("bonus_runs", "posted-run-has-balanced-entry", "error",
        "A posted bonus run has a balanced journal entry for exactly its total (when the total is above zero).",
        BONUS_WRITERS,
        `SELECT r.business_id, r.id::text, r.number || ': posted, entry ' || COALESCE(r.accrual_journal_entry_id::text, 'NULL')
         FROM bonus_runs r
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d, SUM(credit) c FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = r.accrual_journal_entry_id
         WHERE r.status IN ('posted', 'paid') AND r.total_bonus > 0
           AND (r.accrual_journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - j.c) > ${MONEY_TOLERANCE} OR ABS(j.d - r.total_bonus) > ${MONEY_TOLERANCE})`),
      rule("bonus_runs", "paid-run-has-payment", "error",
        "A paid bonus run records its date and account, and (when the total is above zero) the journal entry that paid it for exactly the total.",
        BONUS_WRITERS,
        `SELECT r.business_id, r.id::text, r.number || ': paid on ' || COALESCE(r.paid_on::text, 'NULL')
         FROM bonus_runs r
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = r.payment_journal_entry_id
         WHERE r.status = 'paid'
           AND (r.paid_on IS NULL OR r.paid_from_bank_account_id IS NULL
                OR (r.total_bonus > 0 AND (r.payment_journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - r.total_bonus) > ${MONEY_TOLERANCE})))`),
      rule("bonus_runs", "status-matches-links", "error",
        "A bonus run that is not posted has no accrual entry, and one that is not paid has no payment entry.",
        BONUS_WRITERS,
        `SELECT r.business_id, r.id::text, r.number || ': status ' || r.status
         FROM bonus_runs r
         WHERE (r.status NOT IN ('posted', 'paid') AND r.accrual_journal_entry_id IS NOT NULL) OR (r.status <> 'paid' AND r.payment_journal_entry_id IS NOT NULL)`),
    ],
  },
  {
    table: "bonus_run_lines",
    rules: [
      rule("bonus_run_lines", "ineligible-pays-nothing", "error",
        "An employee who is not eligible has a bonus of zero, and no bonus is negative.",
        BONUS_WRITERS,
        `SELECT l.business_id, l.id::text, l.employee_code || ': eligible ' || l.eligible || ', bonus ' || l.bonus
         FROM bonus_run_lines l WHERE l.bonus < 0 OR (NOT l.eligible AND l.bonus <> 0)`),
    ],
  },
  {
    table: "gratuity_provisions",
    rules: [
      rule("gratuity_provisions", "has-entry", "error",
        "Every gratuity provision records the journal entry it posted.",
        ["payrollGratuity.postProvision"],
        `SELECT p.business_id, p.id::text, 'as of ' || p.as_of || ', amount ' || p.amount
         FROM gratuity_provisions p WHERE p.journal_entry_id IS NULL`),
    ],
  },
  {
    table: "fnf_settlements",
    rules: [
      rule("fnf_settlements", "net-adds-up", "error",
        "Net payable = amounts due - recoveries - loan recovery; the lines add up to the totals.",
        FNF_WRITERS,
        `SELECT s.business_id, s.id::text, s.number || ': gross ' || s.gross_total || ', deductions ' || s.deductions_total || ', net ' || s.net_payable
         FROM fnf_settlements s
         LEFT JOIN (SELECT settlement_id,
                           SUM(CASE WHEN side = 'earning' THEN amount ELSE 0 END) e,
                           SUM(CASE WHEN side = 'deduction' THEN amount ELSE 0 END) d
                    FROM fnf_settlement_lines GROUP BY settlement_id) l ON l.settlement_id = s.id
         WHERE s.calculated_at IS NOT NULL
           AND (ABS(s.net_payable - (s.gross_total - s.deductions_total)) > ${MONEY_TOLERANCE}
                OR ABS(s.gross_total - COALESCE(l.e, 0)) > ${MONEY_TOLERANCE}
                OR ABS(s.deductions_total - COALESCE(l.d, 0)) > ${MONEY_TOLERANCE})`),
      rule("fnf_settlements", "posted-has-balanced-entry", "error",
        "A posted settlement has a balanced journal entry whose debits equal the amounts due (when above zero).",
        FNF_WRITERS,
        `SELECT s.business_id, s.id::text, s.number || ': posted, entry ' || COALESCE(s.accrual_journal_entry_id::text, 'NULL')
         FROM fnf_settlements s
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d, SUM(credit) c FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = s.accrual_journal_entry_id
         WHERE s.status IN ('posted', 'paid') AND s.gross_total > 0
           AND (s.accrual_journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - j.c) > ${MONEY_TOLERANCE} OR ABS(j.d - s.gross_total) > ${MONEY_TOLERANCE})`),
      rule("fnf_settlements", "paid-has-payment", "error",
        "A paid settlement records its date and, when the net payable is above zero, the account and the journal entry that paid exactly the net payable.",
        FNF_WRITERS,
        `SELECT s.business_id, s.id::text, s.number || ': paid on ' || COALESCE(s.paid_on::text, 'NULL')
         FROM fnf_settlements s
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = s.payment_journal_entry_id
         WHERE s.status = 'paid'
           AND (s.paid_on IS NULL OR (s.net_payable > 0 AND (s.paid_from_bank_account_id IS NULL OR s.payment_journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - s.net_payable) > ${MONEY_TOLERANCE})))`),
      rule("fnf_settlements", "status-matches-links", "error",
        "A settlement that is not posted (or reversed after posting) has no accrual entry, one that is not paid has no payment entry, and only a reversed one has a reversal entry.",
        FNF_WRITERS,
        `SELECT s.business_id, s.id::text, s.number || ': status ' || s.status
         FROM fnf_settlements s
         WHERE (s.status NOT IN ('posted', 'paid', 'reversed') AND s.accrual_journal_entry_id IS NOT NULL)
            OR (s.status <> 'paid' AND s.payment_journal_entry_id IS NOT NULL)
            OR (s.status <> 'reversed' AND s.reversal_journal_entry_id IS NOT NULL)`),
      rule("fnf_settlements", "reversed-negates-original", "error",
        "A reversed settlement has a reversal entry that negates its accrual entry exactly, account by account, and the original is marked voided by it. A reversed payment likewise negates the payment entry it replaced.",
        FNF_WRITERS,
        `SELECT s.business_id, s.id::text, s.number || ': reversed, entry ' || COALESCE(s.accrual_journal_entry_id::text, 'NULL') || ', reversal ' || COALESCE(s.reversal_journal_entry_id::text, 'NULL')
         FROM fnf_settlements s
         WHERE s.status = 'reversed' AND s.accrual_journal_entry_id IS NOT NULL
           AND (s.reversal_journal_entry_id IS NULL
                OR NOT EXISTS (SELECT 1 FROM journal_entries o WHERE o.id = s.accrual_journal_entry_id AND o.is_voided AND o.voided_by_entry_id = s.reversal_journal_entry_id)
                OR NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.id = s.reversal_journal_entry_id AND r.reverses_entry_id = s.accrual_journal_entry_id)
                OR EXISTS (SELECT 1 FROM (SELECT account_id, SUM(debit - credit) n FROM journal_entry_lines
                                          WHERE journal_entry_id IN (s.accrual_journal_entry_id, s.reversal_journal_entry_id) GROUP BY account_id) x
                           WHERE ABS(x.n) > ${MONEY_TOLERANCE}))
         UNION ALL
         SELECT s.business_id, s.id::text, s.number || ': payment reversal entry ' || s.payment_reversal_journal_entry_id::text || ' does not negate a voided payment entry'
         FROM fnf_settlements s
         WHERE s.payment_reversal_journal_entry_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM journal_entries r JOIN journal_entries o ON o.id = r.reverses_entry_id AND o.is_voided AND o.voided_by_entry_id = r.id
                           WHERE r.id = s.payment_reversal_journal_entry_id
                             AND NOT EXISTS (SELECT 1 FROM (SELECT account_id, SUM(debit - credit) n FROM journal_entry_lines WHERE journal_entry_id IN (o.id, r.id) GROUP BY account_id) x WHERE ABS(x.n) > ${MONEY_TOLERANCE}))`),
      rule("fnf_settlements", "reversed-puts-loans-back", "error",
        "A reversed settlement put back exactly the principal it had recovered from each loan.",
        FNF_WRITERS,
        `SELECT s.business_id, s.id::text, s.number || ': loan ' || e.loan_id::text || ' recovered ' || e.rec || ', put back ' || e.back
         FROM fnf_settlements s
         JOIN (SELECT settlement_id, loan_id,
                      SUM(CASE WHEN kind = 'fnf_recovered' THEN principal ELSE 0 END) rec,
                      SUM(CASE WHEN kind = 'fnf_reversed' THEN principal ELSE 0 END) back
               FROM employee_loan_events WHERE settlement_id IS NOT NULL AND kind IN ('fnf_recovered', 'fnf_reversed') GROUP BY settlement_id, loan_id) e ON e.settlement_id = s.id
         WHERE (s.status = 'reversed' AND ABS(e.rec - e.back) > ${MONEY_TOLERANCE}) OR (s.status <> 'reversed' AND e.back > 0)`),
    ],
  },
  {
    table: "fnf_settlement_lines",
    rules: [
      rule("fnf_settlement_lines", "side-matches-kind", "error",
        "Leave encashment, gratuity, bonus, arrears and other earnings are earnings; recoveries, TDS and loan recovery are deductions; amounts are above zero.",
        FNF_WRITERS,
        `SELECT l.business_id, l.id::text, l.kind || ' on side ' || l.side || ', amount ' || l.amount
         FROM fnf_settlement_lines l
         WHERE l.amount <= 0
            OR (l.kind IN ('leave_encashment', 'gratuity', 'bonus', 'arrears', 'other_earning') AND l.side <> 'earning')
            OR (l.kind IN ('notice_recovery', 'tds', 'other_deduction', 'loan_recovery') AND l.side <> 'deduction')`),
    ],
  },
  {
    table: "employee_loans",
    rules: [
      rule("employee_loans", "balance-within-principal", "error",
        "The principal recovered or received never exceeds the principal lent.",
        LOAN_WRITERS,
        `SELECT l.business_id, l.id::text, l.number || ': principal ' || l.principal || ', recovered ' || e.p
         FROM employee_loans l
         JOIN (SELECT loan_id, SUM(CASE WHEN kind = 'fnf_reversed' THEN -principal ELSE principal END) p FROM employee_loan_events WHERE kind IN ('emi_recovered', 'prepaid', 'foreclosed', 'fnf_recovered', 'fnf_reversed') GROUP BY loan_id) e ON e.loan_id = l.id
         WHERE e.p > l.principal + ${MONEY_TOLERANCE}`),
      rule("employee_loans", "disbursed-has-entry", "error",
        "An active or closed loan was disbursed with a journal entry for exactly the principal; one that was never disbursed has none.",
        LOAN_WRITERS,
        `SELECT l.business_id, l.id::text, l.number || ': status ' || l.status
         FROM employee_loans l
         LEFT JOIN (SELECT journal_entry_id, SUM(debit) d, SUM(credit) c FROM journal_entry_lines GROUP BY journal_entry_id) j ON j.journal_entry_id = l.disbursement_journal_entry_id
         WHERE (l.status IN ('active', 'closed') AND (l.disbursement_journal_entry_id IS NULL OR j.d IS NULL OR ABS(j.d - j.c) > ${MONEY_TOLERANCE} OR ABS(j.d - l.principal) > ${MONEY_TOLERANCE}))
            OR (l.status IN ('pending_approval', 'approved', 'rejected', 'cancelled') AND (l.disbursement_journal_entry_id IS NOT NULL OR l.disbursed_at IS NOT NULL))`),
      rule("employee_loans", "closed-has-no-balance", "error",
        "A closed loan has nothing left outstanding.",
        LOAN_WRITERS,
        `SELECT l.business_id, l.id::text, l.number || ': closed with balance ' || (l.principal - COALESCE(e.p, 0))
         FROM employee_loans l
         LEFT JOIN (SELECT loan_id, SUM(CASE WHEN kind = 'fnf_reversed' THEN -principal ELSE principal END) p FROM employee_loan_events WHERE kind IN ('emi_recovered', 'prepaid', 'foreclosed', 'fnf_recovered', 'fnf_reversed') GROUP BY loan_id) e ON e.loan_id = l.id
         WHERE l.status = 'closed' AND ABS(l.principal - COALESCE(e.p, 0)) > ${MONEY_TOLERANCE}`),
    ],
  },
  {
    table: "employee_loan_installments",
    rules: [
      rule("employee_loan_installments", "paid-within-due", "error",
        "An instalment is never recovered for more than it was due, and a paid instalment is fully recovered.",
        LOAN_WRITERS,
        `SELECT i.business_id, i.id::text, 'seq ' || i.seq || ': due ' || i.principal || '+' || i.interest || ', paid ' || i.paid_principal || '+' || i.paid_interest
         FROM employee_loan_installments i
         WHERE i.paid_principal > i.principal + ${MONEY_TOLERANCE} OR i.paid_interest > i.interest + ${MONEY_TOLERANCE}
            OR (i.status = 'paid' AND (ABS(i.paid_principal - i.principal) > ${MONEY_TOLERANCE} OR ABS(i.paid_interest - i.interest) > ${MONEY_TOLERANCE}))`),
    ],
  },
  {
    table: "employee_loan_events",
    rules: [
      rule("employee_loan_events", "amounts-not-negative", "error",
        "The balance after an event and its amounts are never negative.",
        LOAN_WRITERS,
        `SELECT e.business_id, e.id::text, e.kind || ': balance after ' || e.balance_after
         FROM employee_loan_events e WHERE e.balance_after < 0 OR e.principal < 0 OR e.interest < 0`),
    ],
  },
  {
    table: "payroll_letter_templates",
    rules: [],
    noExtraRequirements: "One wording per business and letter kind (unique index) holding validated text with placeholders; the PDF is drawn from it and the employee on demand and nothing is stored from a letter.",
  },
];
