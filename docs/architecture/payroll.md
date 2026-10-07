# Payroll (add-on), Phase 1

Employees, attendance and leave, salary structures, monthly payroll runs, payslips, a bank payment file and posting to the books. It is the first feature of the paid **Payroll add-on** (`payroll`). Phase 1 has **no statutory computation**: PF, ESI, professional tax and income-tax TDS (and their filings) are Phase 2. Roadmap item: "Payroll — Phase 1: employees, attendance, salary and payroll run". Entitlement rules: [`../ENTITLEMENTS.md`](../ENTITLEMENTS.md) ("The Payroll add-on").

Everything is per business. Money is `numeric(15,2)` rupees like the rest of the app; the calculation works in integer paise.

## Where things live

| Part | Path |
|---|---|
| Pure rules (no DB, no clock) | `packages/shared/src/payroll-calc.ts` (components, salary breakdown, pay line, posting totals, status machine, maker-checker), `payroll-calendar.ts` (days, attendance summary, leave), `payroll.ts` (formats, masking, input schemas, bank file) |
| Tables | `packages/db/src/tenant-schema.ts` ("Payroll (add-on)"); migrations unified `0065_payroll_phase_1`, tenant `0039_payroll_phase_1` |
| Run engine | `packages/api/src/lib/payroll/run.ts` (create, lock, calculate, submit, approve, reopen, post, mark paid), `books.ts` (accounts and the journal writer), `data.ts` (settings, calendars, employee views), `access.ts` (permission, add-on, trial cap), `payslip-pdf.ts` |
| Routers | `payrollEmployee`, `payrollSalary`, `payrollAttendance`, `payrollLeave`, `payrollRun` (`packages/api/src/routers/payroll*.ts`) |
| Web | `apps/web/src/routes/payroll.tsx`, `apps/web/src/components/payroll/*` (Employees, Salary structures, Attendance, Leave, Payroll runs) |
| Mobile, CLI, MCP | None in Phase 1: `parity-exceptions.yaml` lists every payroll procedure used by the web with the reason |

## Data model

- `payroll_settings` (one row per business): default weekly offs, standard hours, overtime multiplier, leave year start month.
- `payroll_departments`, `payroll_designations`, `payroll_shifts` (hours and weekly offs).
- `employees`: personal, job, bank and exit fields. **Sensitive**: `pan`, `aadhaar`, `uan`, `esic_number`, `bank_account_number`, `bank_ifsc` (plain columns; the API masks them, see below). `photo_data_url` is a small data URL. `status` is `active` or `exited`; `fnf_payroll_run_id` links the run that settled the last month.
- `salary_components`: `type` (`earning`, `deduction`, `employer_contribution`), `category` (basic, da, retaining_allowance, hra, conveyance, special_allowance, bonus, incentive, overtime, other_earning; manual_deduction, advance_recovery, other_deduction; other_employer), `prorate`, `is_wage`, and **`statutory_kind`** (reserved, null in Phase 1).
- `salary_templates` + `salary_template_lines` (`calc_type`: `fixed`, `percent_of_basic`, `percent_of_ctc`, `balance`).
- `employee_salary_assignments`: effective-dated; stores the annual and monthly CTC and a **snapshot** `breakdown` (every component with its monthly amount), so changing a template or component never changes what was assigned.
- `attendance_records` (one per employee and day; `status` present, absent, half_day, week_off, holiday, leave; check-in/out, overtime hours, `source` manual/leave/lock), `payroll_holidays` (scope national, state or branch).
- Leave: `leave_types`, `leave_ledger` (balance = sum of ledger rows per employee, type and leave year; kinds accrual, carry_forward, closing, taken, cancelled, encashment; a unique `period_key` makes accrual and year closing idempotent), `leave_applications`, `leave_encashments` (waiting for payroll).
- Runs: `payroll_runs` (one per business and month; totals; `accrual_journal_entry_id` and `payment_journal_entry_id` link the journal entries), `payroll_run_lines` (a frozen result per employee, including every component as jsonb), `payroll_run_adjustments`, `payslips` (a `snapshot` jsonb of everything the PDF shows, with masked identity numbers).

## Calculation rules

- **Monthly salary**: annual CTC / 12, rounded half up to the paisa. Template lines resolve in order: fixed and % of CTC, then % of Basic, then the single `balance` earning (monthly CTC less every other earning and employer contribution; a negative balance is refused). Deductions are not part of CTC.
- **Paid days** = employed days - LOP days, in half-day steps. Employed days are the days of the month between the joining date and the last working day. Present, weekly offs, holidays and paid leave are paid; absent and unpaid leave are LOP; a half day is half paid and half LOP (a half-day paid leave pays the whole day). Weekly offs come from the employee's shift or the business default; holidays are national, the employee's state, or the employee's branch.
- **Proration**: each earning pays `monthly x paid days / days in month` (as `monthly x paid half-days / (2 x days)`), rounded half up **once** per amount. A component with `prorate = false` pays in full when there is at least one paid day, otherwise nothing. Zero paid days pays nothing. Totals are the sums of the rounded parts and are never rounded again.
- **Overtime** = hours x ordinary hourly wage x multiplier, where the hourly wage is the **full-month** Basic + DA + retaining allowance / days in month / standard hours (not reduced by LOP). Defaults 2x and 8 hours. Confirm yearly with the CA.
- **Net pay** = gross earnings - deductions (manual deductions, advance recoveries and one-off adjustments). Employer contributions are in CTC but not in net pay. A negative net pay is a warning on the line and blocks `submit`.
- **Labour Codes 50% wage rule**: wages (Basic + DA + retaining allowance) vs total remuneration (gross + employer contributions). Below half is a **warning**, never an error.
- Leave: approving a paid-type application uses the balance first and turns the rest into LOP (it writes `leave` attendance rows with the paid or the LOP leave type); unmarked working days must be marked or filled (`fillUnmarked`) before attendance can be locked.

The unit tests (`packages/shared/src/__tests__/payroll*.test.ts`) cover joining and exit mid-month, 28/29/30/31-day months, leap years, half days, zero paid days and rounding totals.

## Status machine and maker-checker

```
draft -> attendance_locked -> calculated -> pending_approval -> approved -> posted -> paid
```

- `calculated` may be recalculated; `pending_approval` can go back to `calculated`; any state before approval can be **reopened** to `draft` (lines discarded, attendance and adjustments kept). Adding or removing an adjustment on a `pending_approval` run sends it back to `calculated`.
- Attendance of a month (marking, bulk marking, holidays, leave approval or cancellation) is **locked** while its run is past `draft`.
- **Maker-checker**: the user who last **calculated** the run (`calculated_by_user_id`) cannot approve it unless the business has a single member (`business_members` count 1). Approval needs `Payroll:manage` (owner, admin).
- **Approval freezes**: the bank details are copied onto the lines (for the payment file), one `payslips` row with its snapshot is inserted per employee, an exited employee's `fnf_payroll_run_id` is set for a final-month line, and the totals are re-checked against the lines. After this the engine refuses every change to the run; the payslip PDF is drawn from the snapshot. A payslip never changes.

## Posting to the books

`postRun` (idempotent: a run with an accrual entry returns it with `created: false`; the run row is locked `FOR UPDATE`) writes **one** balanced `journal_entries` row (`source = "system"`) dated the last day of the month:

| Dr | Cr |
|---|---|
| 5200 Salary & Wages (basic, da, retaining) | 2400 Salaries Payable (net pay) |
| 5201 Salary - Allowances | 2410 Payroll Deductions Payable |
| 5202 Salary - Bonus & Incentives | 2420 Employer Contributions Payable |
| 5203 Salary - Overtime | |
| 5204 Employer Contributions to Staff | |

Accounts are created lazily per business (`ensurePayrollAccounts`; an account with the code but another type gets a `P`-prefixed code instead). `writeJournalEntry` refuses an unbalanced entry. `markRunPaid` writes the second entry (Dr 2400 / Cr 1000 cash or 1010 bank, per the account type, like expenses and payments) and a withdrawal on the chosen bank account with its balance. Both respect period locks (`assertPeriodOpen`, checked before the transaction) and the journal's void is refused for payroll entries. Salaries payable nets to zero once paid; deductions and employer-contribution liabilities stay until remitted (Phase 2 adds PF, ESI, PT and TDS payable accounts).

## Sensitive data

PAN, Aadhaar, UAN, ESIC number and bank account number are returned masked (last four characters) by every list and view; `payrollEmployee.get` returns them in full only to `Payroll:manage`. They are never written to logs, audit entries (which carry ids and field names), emails or payslips (masked). The bank payment file contains full account numbers and needs `Payroll:update`. Self-export (owner only) contains them as optional columns of the row schemas, so an export without them still imports. The role matrix (`integration/__snapshots__/role-matrix.md`) shows no other role can call a payroll procedure.

## Payslips, email, the bank file

`payslip-pdf.ts` draws an A4 payslip (business header, employee details, earnings and deductions, net pay in figures and words, paid and LOP days). `payrollRun.payslipPdf` returns it base64 over tRPC (draft before approval, frozen after); `payrollRun.payslipEmail` sends the approved PDF through the existing email sender (`sendPayslip`; Resend or console). There is **no share link** for payslips: salary data should not sit behind a long-lived public URL. `payrollRun.bankFile` returns a generic NEFT/RTGS-style CSV (Sr No, Employee Code, Beneficiary Name, Account Number, IFSC, Amount, Payment Mode, Narration); it is **not any bank's own format**. Cells are quoted and neutralised against spreadsheet formula injection.

## Self-export, data audit

The 19 payroll tables are in `TABLE_REGISTRY` and `ROW_SCHEMAS` (`employees.manager_id` is a self FK). `integration/payroll-export-import.test.ts` round-trips them. The data audit (`lib/data-audit/rules/payroll.ts`) checks: run totals equal the sum of their lines, a line's net is gross - deductions and its components add up, an approved run has its payslips, a posted run has a balanced journal entry equal to gross + employer contributions, a paid run has its payment entry for the net total, payslip snapshots match their lines.

## What Phase 2 plugs into

- `salary_components.statutory_kind` (PF employee and employer, EPS, ESI, professional tax, TDS, gratuity, LWF; the allowed values are `STATUTORY_KINDS` in `payroll-calc.ts`) is already stored and carried through assignments, run lines and the posting totals (`AssignedComponent.statutoryKind`). Phase 2 adds components of those kinds and computes their amounts where `computePayrollLine` builds the component list, with per-financial-year rates held in settings.
- `payroll_run_lines.components` already holds employee deductions and employer contributions separately, so PF/ESI/PT/TDS lines slot in without a migration of existing runs; Phase 2 adds columns (for example a rates version) rather than reshaping anything.
- `buildPostingTotals` groups by component type and category: Phase 2 adds payable accounts (PF, ESI, TDS, PT) in `PAYROLL_ACCOUNTS` and splits `deductionsPayable` by statutory kind.
- `employees` already carry PAN, UAN, ESIC number, tax regime and work state, which the statutory rules need; filings (ECR, challans, Form 24Q, Form 16) read from approved runs.

## Not built (Phase 1 limits)

Mobile, CLI and MCP; the Payroll add-on billing lines (per-employee counting beyond the trial cap); statutory computation and filings; loans and recurring deductions as first-class records (use adjustments); a payslip share link; off-cycle runs; a bank-specific payment file; a CA review of the rules and figures before go-live (still open: the Labour Codes points, the overtime rate and the rounding rule need the CA).
