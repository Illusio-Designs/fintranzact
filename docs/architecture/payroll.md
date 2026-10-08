# Payroll (add-on), Phase 1

Employees, attendance and leave, salary structures, monthly payroll runs, payslips, a bank payment file and posting to the books. It is the first feature of the paid **Payroll add-on** (`payroll`). Phase 1 has **no statutory computation**: PF, ESI, professional tax and income-tax TDS (and their filings) are Phase 2, described in the last part of this document. Roadmap item: "Payroll — Phase 1: employees, attendance, salary and payroll run". Entitlement rules: [`../ENTITLEMENTS.md`](../ENTITLEMENTS.md) ("The Payroll add-on").

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

## What Phase 2 plugs into (built: see "Payroll, Phase 2" below, which supersedes this list where they differ)

- `salary_components.statutory_kind` (PF employee and employer, EPS, ESI, professional tax, TDS, gratuity, LWF; the allowed values are `STATUTORY_KINDS` in `payroll-calc.ts`) is already stored and carried through assignments, run lines and the posting totals (`AssignedComponent.statutoryKind`). Phase 2 adds components of those kinds and computes their amounts where `computePayrollLine` builds the component list, with per-financial-year rates held in settings.
- `payroll_run_lines.components` already holds employee deductions and employer contributions separately, so PF/ESI/PT/TDS lines slot in without a migration of existing runs; Phase 2 adds columns (for example a rates version) rather than reshaping anything.
- `buildPostingTotals` groups by component type and category: Phase 2 adds payable accounts (PF, ESI, TDS, PT) in `PAYROLL_ACCOUNTS` and splits `deductionsPayable` by statutory kind.
- `employees` already carry PAN, UAN, ESIC number, tax regime and work state, which the statutory rules need; filings (ECR, challans, Form 24Q, Form 16) read from approved runs.

## Not built (Phase 1 limits; statutory computation and filings are now built in Phase 2)

Mobile, CLI and MCP; the Payroll add-on billing lines (per-employee counting beyond the trial cap); statutory computation and filings; loans and recurring deductions as first-class records (use adjustments); a payslip share link; off-cycle runs; a bank-specific payment file; a CA review of the rules and figures before go-live (still open: the Labour Codes points, the overtime rate and the rounding rule need the CA).

---

# Payroll, Phase 2: PF, ESI, PT, LWF, TDS and statutory filings

Roadmap item "Payroll — Phase 2: PF, ESI, PT, TDS and statutory filings". It is part of the same paid add-on (`payroll`), gated exactly like Phase 1 (`assertPayroll`, read-only gate, trial employee cap; `ADDON_FEATURES.payroll.implemented` is still false). **Every figure a CA has to confirm is listed in [`../PAYROLL-CA-VERIFICATION.md`](../PAYROLL-CA-VERIFICATION.md).** Nothing is filed with, or paid to, any government system: the app produces files and records payments.

## The principle: rates are data

No rate, ceiling, slab or due date is in code. `StatutoryRates` (zod schema `statutoryRatesSchema`, `packages/shared/src/payroll-statutory.ts`) is one JSON document stored per business and financial year in `payroll_statutory_settings` (`financial_year` = start year; a payroll month uses the **latest row at or before its year**, else `defaultStatutoryRates()`), with a last-verified note and date. Owners and admins edit it on **Payroll → Statutory settings**, which shows "Verify with your CA". The defaults ship only what the roadmap states plus a few long-standing figures; **state PT slabs (except Maharashtra), LWF amounts and the income-tax slabs ship empty**: the calculation yields 0 and the run shows a warning (`pt_slabs_missing`, `lwf_not_configured`, `tax_slabs_missing`, once per run) rather than guess. A run copies the rates it used into `payroll_runs.statutory` when it is calculated, so editing a year never changes a calculated or approved run.

## Where things live

| Part | Path |
|---|---|
| Pure rules (no DB, no clock) | `packages/shared/src/payroll-statutory.ts` (PF, EPS, VPF, ESI, PT, LWF, TDS projection, FY helpers, input schemas, due dates, `computeStatutoryLine`, `applyStatutoryToLine`), `payroll-filings.ts` (ECR, ESIC, PT/LWF sheets, 24Q, Form 16, registers, gratuity and bonus computation) |
| Tables | `packages/db/src/tenant-schema.ts`: new columns on `payroll_settings` (registrations), `employees` (PF, EPS, VPF, ESI fields), `payroll_runs.statutory`, `payroll_run_lines.statutory`; new tables `payroll_statutory_settings`, `employee_tax_declarations`, `payroll_statutory_payments`; migrations unified `0066_payroll_phase_2`, tenant `0040_payroll_phase_2` |
| Engine glue | `packages/api/src/lib/payroll/statutory.ts` (flags, rates, history, applying to a line), `dues.ts` (dues and recording a payment), `filings.ts`, `form16-pdf.ts`; `run.ts` calls it from `calculateRun` |
| Router | `payrollStatutory` (`packages/api/src/routers/payrollStatutory.ts`), 16 procedures |
| Web | `apps/web/src/components/payroll/StatutoryTab.tsx`, `DuesTab.tsx`, `FilingsTab.tsx`, `EmployeeStatutoryDialog.tsx`, `statutory-ui.tsx`; run review columns in `RunsTab.tsx` |

## Registrations and "PF off means PF nowhere"

`payroll_settings` holds `pf_registered` (+ establishment code), `esi_registered` (+ code), `pt_states`, `lwf_state` and `tds_enabled`; all default off, so a business that never registers gets exactly the Phase 1 run (`payroll_runs.statutory` and the lines' `statutory` stay null). With PF off: no PF, VPF or EPS component is produced (`computeStatutoryLine` never touches PF), the payslip leaves off the UAN (and the ESIC number when ESI is off), the PF file is refused, the dues list has no PF row, the PF payable account is never created, the registers have no PF columns, and the UI hides the UAN field, the PF section of settings and the employee's PF fields. The data audit enforces it (`no-pf-without-registration`, `no-esi-without-registration`) from the run's frozen flags.

## Statutory components in the run

Statutory amounts are **not** user-made salary components: `salaryComponentSchema` still accepts only `statutory_kind = null`, and the PF/ESI/... lines are produced by the run. They are appended to the calculated line as components with `source = "statutory"` and a `statutoryKind` (`pf_employee`, `vpf`, `pf_employer` = the employer's EPF share, `eps_employer`, `esi_employee`, `esi_employer`, `professional_tax`, `income_tax_tds`, `lwf_employee`, `lwf_employer`): employee shares are `deduction`s, employer shares `employer_contribution`s, so net pay, totals, the payslip and the maker-checker flow all work unchanged. The line's `statutory` JSON (paise integers) keeps the working the filings need (PF, EPF, EPS and EDLI wages, ESI coverage and reason, PT state, TDS projection). Approval freezes lines, payslips and these details like anything else.

Caveat: employer statutory contributions are added on top of the structure when the run is calculated; they are not inside the structure's monthly CTC unless the owner reduces a balance component.

### Rules implemented (details and assumptions are in the CA checklist)

- **PF**: PF wages = Basic + DA + retaining allowance (and `is_wage` components) **earned** that month; contribution wages are capped at the ceiling unless the employee is on actual wages (or an international worker). Employee 12%; VPF = vpf% of actual wages; employer 12% with EPS = 8.33% of wages up to the EPS ceiling and the rest to EPF, or the whole 12% to EPF without EPS; each rounded once (nearest rupee) and the EPF share is the rounded total less EPS. Excluded employees and PF-not-applicable have none. EPS suggestion: joined PF on or after 1 Sep 2014 with wages above the ceiling: no; age 58 and over: EPS stops (applied automatically in the run from the first of the month the age is reached).
- **ESI**: covered while the **full-month structure wages** (earnings except overtime) are at or below the ceiling (exactly the ceiling is covered); contributions on earned wages, rounded up to the next rupee. **Contribution periods** April-September and October-March: an employee who contributed in an earlier month of the current period (from approved runs) stays covered until it ends.
- **PT**: on the month's gross, slab chosen by gender when the state has gender slabs (missing gender uses the male slabs and warns), a per-slab February amount where configured, yearly cap applied against PT deducted so far this year. The state is the employee's work state (if it is a PT state) or the business's only PT state.
- **LWF**: configured amounts in the configured deduction months (monthly, half-yearly or yearly).
- **TDS (s.192)**, `projectSalaryTds`: annual income = gross to date (approved runs) + this month + the full monthly gross for each remaining month (to the exit month) + previous-employer income; less the regime's standard deduction; old regime also declarations within their limits and projected PT; tax by slabs, rebate (and marginal relief if on), cess, rounded to a multiple of 10 rupees; less TDS already deducted; this month = remaining / months left including this, rounded to the rupee; capped by the pay left after other deductions (the rest rolls forward). Surcharge, senior-citizen slabs and the s.206AA higher rate are **not** applied (warnings only).

## Posting and paying

`buildPostingTotals` splits statutory amounts by authority (`statutoryPayableGroup`): they are credited to **2430 PF and EPS Payable, 2431 ESI Payable, 2432 Professional Tax Payable, 2433 Labour Welfare Fund Payable, 2434 TDS on Salary Payable** (created lazily like the Phase 1 accounts) instead of 2410/2420; the entry stays balanced (debits = gross + employer contributions) and idempotent. `payrollStatutory.recordPayment` writes Dr payable / Cr cash or bank and a bank withdrawal, with the challan number and date, in `payroll_statutory_payments`; the run row is locked while the outstanding amount is re-checked, so payments never exceed what was accrued.

## Files and registers

All are built from the **frozen lines of approved runs**, returned over tRPC as text (needs Payroll `update`, never logged): PF ECR (`#~#` layout, UAN holders only), ESIC contribution CSV, PT and LWF working sheets per state, Form 24Q working data (deductees and challans), Form 16 working copy (PDF and CSV, labelled for CA review), and the wages, attendance, leave, bonus and gratuity registers (computed; no bonus or gratuity payments, which belong to Phase 4). The layouts must be checked against the portals' current templates before upload.

## Self-export, data audit, tests

The three new tables are in `TABLE_REGISTRY` and `ROW_SCHEMAS`; new columns on existing tables are optional in the row schemas so a Phase 1 export still imports. Data-audit rules: no PF/ESI components without the registration, statutory component typing, payments within accrued, payment journal entries balance. Tests: shared unit tests (`payroll-statutory.test.ts`, `payroll-filings.test.ts`: boundaries at 15,000 and 21,000, slab edges, February, EPS rules, TDS spreading), `integration/payroll-statutory.test.ts` (real Postgres: exact statutory lines, books, dues, files, PF off, add-on gate, roles, isolation, audit) and the web component tests.

## Not built in Phase 2

Mobile, CLI and MCP (parity exceptions); loans and recurring deductions as records; bonus and gratuity payments, full and final settlement (Phase 4); self-service, biometrics (Phase 3); surcharge, senior-citizen slabs and s.206AA; state PT rules beyond monthly slabs (half-yearly or annual PT frequencies); reversing or deleting a recorded statutory payment (use a correcting journal entry); an NPS or other employer-contribution deduction in TDS; and the CA review itself.

## Phase 3

Mobile attendance with a selfie and location, employee logins and self-service, HR and employee roles, and biometric import are described in [`payroll-self-service.md`](payroll-self-service.md).
