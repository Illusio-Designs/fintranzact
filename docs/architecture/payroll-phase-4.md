# Payroll Phase 4: bonus, gratuity, full and final, loans, letters and registers

Phase 4 of the Payroll add-on (see [`payroll.md`](payroll.md) and [`payroll-self-service.md`](payroll-self-service.md)). Roadmap item "Payroll — Phase 4: bonus, gratuity, full & final, loans and registers". It is part of the same paid add-on (`payroll`), gated exactly like the earlier phases, and `ADDON_FEATURES.payroll.implemented` is **still false**: nothing here puts the add-on on sale.

**Every statutory figure, rule and rounding below is the owner's CA's to confirm**: see Phase 4 in [`../PAYROLL-CA-VERIFICATION.md`](../PAYROLL-CA-VERIFICATION.md). The roadmap line "CA verification of bonus and gratuity rules" is deliberately not ticked.

## Where things live

| Part | Path |
|---|---|
| Pure rules (no database, no clock) | `packages/shared/src/payroll-phase4.ts` (bonus, gratuity, EMI schedule and recovery plan, the settlement arithmetic, leave encashment, the letter template, the register builders and all input schemas); `payroll-calc.ts` (loan components and the posting split); `payroll-statutory.ts` (the new `bonus` and `gratuity` fields of the rates) |
| Tables | `packages/db/src/tenant-schema.ts` ("Payroll Phase 4"); migrations unified `0071_payroll_phase_4`, tenant `0044_payroll_phase_4` (control: no change) |
| Engine | `packages/api/src/lib/payroll/` `bonus.ts`, `gratuity.ts`, `fnf.ts`, `loans.ts`, `letters.ts`, `registers4.ts`, `phase4-pdf.ts`; `run.ts` (loan recovery in a run); `books.ts` (new accounts, `moveBank`) |
| Routers | `payrollBonus`, `payrollGratuity`, `payrollFnf`, `payrollLoan`, `payrollLetter` (`packages/api/src/routers/`), plus four new register values on `payrollStatutory.register` |
| Web | `apps/web/src/components/payroll/` `BonusTab`, `GratuityTab`, `LoansTab`, `FnfTab`, `LetterPanel`, `phase4-ui`; Bonus and gratuity fields in `StatutoryTab`; the new registers in `FilingsTab` |
| Mobile, CLI, MCP | None (parity exceptions with reasons). **No `payrollSelf` procedure was added** |

## Roles and workflow (all of it)

HR (and accountants, owners, admins) **prepare**: create and edit bonus runs, settlements, loans, letter wording (Payroll create / update). **Approving** (`payrollBonus.approve`, `payrollFnf.approve`, `payrollLoan.approve` / `reject` / `updateSettings`) needs Payroll `manage` (owner, admin) and is **maker-checker**: not the person who last calculated the run or settlement, or who requested the loan, unless the business has a single member. **Posting and paying** need `PayrollPosting` (owner, admin, accountant; never HR). Every state change is audited (`payroll.bonus.*`, `payroll.gratuity.postProvision`, `payroll.fnf.*`, `payroll.loan.*`, `payroll.letter.*`) with ids, numbers and amounts, never identity numbers. Status machines:

```
bonus run:   draft -> calculated -> pending_approval -> approved -> posted -> paid
settlement:  draft (calculated) -> pending_approval -> approved -> posted -> paid
loan:        pending_approval -> approved -> active -> closed      (rejected, cancelled)
```

## Accounts (all created lazily per business, like 2430-2434)

| Code | Name | Type | Used by |
|---|---|---|---|
| 1260 | Loans and Advances to Employees | asset | loan disbursement (Dr), instalments and settlements (Cr) |
| 4110 | Interest on Staff Loans | income | interest recovered |
| 2440 | Bonus Payable | liability | bonus posting (Cr) and payment (Dr) |
| 2441 | Gratuity Provision | liability | provision (Cr), gratuity paid in a settlement (Dr) |
| 2442 | Full and Final Settlements Payable | liability | settlement net (Cr), payment (Dr) |
| 5205 | Salary - Gratuity | expense | provision and gratuity not covered by it |

The next free codes in each range of `coa-seed.ts`. Existing businesses get them the first time they are needed (`ensurePayrollAccounts`; a code held by an account of another type becomes `P`-prefixed, so an amount never lands in the wrong kind of account). Bonus expense reuses 5202; leave encashment and other dues 5201; arrears 5200; recoveries 2410; TDS on a settlement 2434.

## 1. Bonus (Payment of Bonus Act)

One run per business and financial year (`bonus_runs`, unique), lines in `bonus_run_lines`. The bonus **settings are data**, the `bonus` part of the statutory rates per financial year (so the "last verified" note, the editing roles and the carry-forward to later years are those of Phase 2): `wageCeilingRupees` (already there: now the *calculation ceiling*), new `eligibilityCeilingRupees`, `minimumWageRupees`, `minPercent` 8.33, `maxPercent` 20, `minWorkingDays` 30. The two ceilings and the minimum wage ship **empty** and `calculateBonusRun` refuses (with the message) until they are set; the web shows the same message. Older saved rates documents are filled with these defaults when read.

Rules (all in `computeEmployeeBonus`, boundary-tested): wages come from the **frozen lines of approved payroll runs** (Basic + DA of the structure, as earned); **eligible** when the full-month Basic + DA of the last paid month is **up to** the eligibility ceiling and the paid days in the year reach the minimum and the employee is not marked out by hand; each month's bonus wage is `min(earned, cap x paid days / days in month)` with `cap = max(calculation ceiling, minimum wage)`; bonus = sum x percentage, rounded half up once. **Set-on / set-off are out of scope.**

Maker-checker as for a payroll run (`calculated_by` cannot approve). Approval **re-checks** that the lines still match the run's percentage, the hand exclusions and the full and final settlements, and that the total is the sum of the lines. Posting is Dr 5202 / Cr 2440, dated the last day of the financial year (today when it has not ended), idempotent, behind `assertPeriodOpen`. Paying is Dr 2440 / Cr bank or cash with a bank transaction. Outputs: statement CSV and PDF, a generic bank file.

Double payment: an employee whose bonus for a year sits in an **approved** settlement (`fnf_settlements.inputs.bonusFinancialYear`) is excluded from that year's bonus run with a reason; and the settlement refuses to approve a bonus a bonus run (approved or later) already pays.

## 2. Gratuity

`computeGratuityFull`: last drawn Basic + DA x 15 / 26 x years (rounded half up once). Years = completed years + 1 when the part year is **more than six months**. **Minimum** (tested on *completed* years): 5 (`rules.minYears`); employment type `contract` is treated as **fixed-term** and needs `rules.fixedTermMinYears` (1); exit reason `death` or `disablement` (two new exit reasons) removes the minimum. Capped by `capRupees` (20 lakh, 0 = none). **Tax on gratuity is not computed.** The Phase 2 gratuity register is untouched.

`payrollGratuity.estimate` lists every active employee (completed years, years used, rule, eligibility, payable today, and the amount if eligible) with the **liability today** and the provision in the books. **Report first**: nothing is posted unless `postProvision` is pressed, which books the difference between the liability on the date and the balance of 2441 (Dr 5205 / Cr 2441, or the reverse for a decrease) under an advisory lock; the second press finds nothing to add and refuses. When a settlement pays gratuity it is debited to 2441 up to its balance and only the remainder to 5205. The provision policy ("payable if everyone eligible left today") is not actuarial.

## 3. Full and final settlement

### The decision about the last month's salary (flag for the owner)

The brief recommended computing the last month inside the settlement. **We did not.** The salary of the exit month is paid by the **normal payroll run of that month**, because only a run applies PF, ESI, professional tax and TDS, produces the payslip and feeds the ECR, ESIC and Form 24Q files; a second salary calculation inside the settlement would have left those filings short. The guard against double payment (and against a missed month) is:

- the settlement holds **no salary line** and its payable excludes the month (tested);
- it links the run (`salary_run_id`), shows its state and net pay (`in_run`, `run_pending`, `no_run`, `no_line`), and **`submit` and `approve` are refused** until the exit month's run is approved (or later) with a line for the employee (`no_line`, an employee with no salary structure, is only a warning);
- the run keeps paying the employee for the days to the last working day (the existing exit rules), and an exited employee cannot be brought back (`reactivate`) once a settlement is more than a draft.

### Contents and order

Created for an exited employee on or after the last working day (`createFnf`; one per employee). Calculated at once and again on every edit (`updateFnf`, `calculateFnf`). Amounts due: **leave encashment** (each encashable leave type: the balance in the leave year of the last working day, limited by the type's carry-forward maximum when it carries forward with one, x the rate `Basic + DA / 26` by default or `/ 30` or `gross / 30`), **gratuity**, **bonus due** (optional suggestion at the lowest percentage for the exit financial year, from approved payroll; skipped when a bonus run pays it), **arrears and other** manual earnings. Recoveries, in this order (`computeFnf`): **notice-period shortfall** (days x gross monthly / 30), **TDS (a manual amount, never computed, with a standing warning)**, other manual recoveries, then **loan principal last**, from what is left, never below zero (a shortfall stays outstanding on the loan with a warning). Net payable = due - recoveries - loans; a negative net blocks `submit`.

### Effects and books

`approve` (maker-checker) re-works the plan and refuses if leave, loans or bonus moved since it was calculated; then writes the leave ledger rows (`encashment`, period key `fnf:<id>`, idempotent) and the loan recoveries (event `fnf_recovered`, open instalments replaced, loan closed when nothing is left). `post`: Dr leave encashment and other dues 5201, arrears 5200, bonus 5202, gratuity 2441 then 5205; Cr 2442 (net), 1260 (loans), 2410 (notice and other recoveries), 2434 (TDS), dated the last working day. A settlement with nothing due is "posted" with no entry. `markPaid`: Dr 2442 / Cr bank or cash and a bank transaction. Statement PDF at any time after the first calculation.

**Reversal of an approved (not posted) settlement: none** (as for a payroll run); a draft can be deleted or reopened, and an approved one is posted and then reversed, or corrected with a journal entry. A **posted** or **paid** settlement can be reversed: see "Reversing a posted settlement" below. The data audit checks the totals, that a posted settlement has a balanced entry equal to the amounts due, a paid one a payment entry for the net, and that a reversed one negates its entry and puts back every loan recovery.

### Reversing a posted settlement (`payrollFnf.reverse`, `payrollFnf.reversePayment`)

Status machine now: `draft -> pending_approval -> approved -> posted -> paid`, plus **`reversed`** (terminal; reached only from `posted`) and `paid -> posted` through `reversePayment`. `status` is a text column, so no enum migration; migration unified `0072_payroll_fnf_reversal`, tenant `0045_payroll_fnf_reversal` (control: none) adds the reversal columns, the new loan-event index, and **changes the unique index "one settlement per employee" to a partial index (`WHERE status <> 'reversed'`)** so a new settlement can be prepared after a reversal (the reversed row stays on record).

**Who and how.** `PayrollPosting` (owner, admin, accountant; never HR) plus `Payroll:update`, like `post` and `markPaid`; add-on gated, refused while read-only. A **mandatory reason** (5 to 500 characters) is kept in `reversal_reason` / `payment_reversal_reason` and in the audit log (`payroll.fnf.reverse`, `payroll.fnf.reversePayment`, with the reason and the loans touched). Both are **idempotent** (a second call returns the first result, `created: false`, and writes nothing). Concurrency: the settlement row and the employee row are locked, the loan rows too.

**What `reverse` does, in one transaction.**

| Effect of the settlement | Reversal |
|---|---|
| Accrual journal entry (Dr expenses and 2441 / Cr 2442, 1260, 2410, 2434) | A mirror entry on the **same date** with every line's debit and credit swapped (`reverseJournalEntry` in `books.ts`, the same marking as the manual `journal.void`: the mirror has `reverses_entry_id`, the original `is_voided` and `voided_by_entry_id`). Reports include both, so the pair nets to zero account by account. The period of that date must be open (otherwise it is refused with the lock message). A settlement with nothing due has no entry and nothing to mirror. |
| Loan recoveries (`fnf_recovered`, loan closed, open instalments superseded, balance instalment added) | The loan log is **append-only**: one `fnf_reversed` event per loan puts the principal back (outstanding = principal - recoveries + puts back), a loan the settlement closed becomes `active` again, and the remaining schedule is **replaced, never edited** (open instalments superseded, a new schedule for the restored balance at the loan's own EMI from next month). The unique partial index `employee_loan_events_fnf_idx` (loan, settlement, `fnf_recovered`) is untouched: a later settlement has another id, so it can recover the loan again; a second unique index (loan, settlement, `fnf_reversed`) makes the reversal idempotent. Refused if putting back would exceed the principal lent (the loan moved since). |
| Leave encashed (`leave_ledger` kind `encashment`, key `fnf:<id>`) | A compensating `adjustment` row per leave type (key `fnf-reversed:<id>`) restores the balance; the encashment row stays. |
| Gratuity drawn from the provision (2441) | Given back by the mirror entry itself: the provision balance is derived from the books, there is no separate "paid" flag. |
| Bonus due (`inputs.bonusFinancialYear`) | A bonus run counts only approved, posted or paid settlements, so a reversed one frees the employee: the next bonus calculation takes them in. |
| Employee exit state | **Not touched.** The employee stays `exited`; HR re-opens the exit (`reactivate` is allowed because the settlement is reversed; a reversed row is never deleted by it) or prepares a new settlement. |
| The settlement | `status = reversed` (terminal), `reversed_at`, `reversed_by_*`, `reversal_reason`, `reversal_journal_entry_id`; the original accrual entry id stays. Editing, submitting, approving, posting and paying a reversed settlement are refused. The statement PDF stays available (status shown as "reversed"). |

A **paid** settlement is refused with "Reverse the payment first". `reversePayment` (paid -> posted) mirrors the payment entry (Dr 2442 / Cr bank or cash, negated, same date), puts the net back into the account it left (a deposit bank transaction dated the payment date, reference type `fnf_settlement_reversal`) and clears the paid fields; the settlement can then be paid again or reversed. Limits: a bank transaction that was already **reconciled against a bank statement line** is not detected (the reversal adds a deposit; reconcile it again by hand); the reversal posts on the original dates, so it needs those periods open (it never posts into a locked period); an **approved but not posted** settlement is not reversible (post it first); interest accrued is not modelled (principal only, as in the settlement); a loan whose balance moved after the settlement (prepaid, rescheduled) is refused with a message to correct it by journal entry. Entries posted by a settlement cannot be voided by hand in `journal.void` (the settlement owns them).

Data audit: `fnf_settlements` rules `status-matches-links` (reversal entry only on a reversed settlement), `reversed-negates-original` (account by account, original voided by the mirror, payment reversal likewise), `reversed-puts-loans-back`; the three loan rules count `fnf_reversed` as a put back.

## 4. Relieving letter

`payroll_letter_templates` (one row per business and kind) holds the wording with placeholders (`{{employee_name}}`, `{{employee_code}}`, `{{designation}}`, `{{department}}`, `{{date_of_joining}}`, `{{last_working_day}}`, `{{company_name}}`, `{{letter_date}}`); unknown placeholders are refused when saving. `payrollLetter.relievingPdf` (a mutation, so it is `gated` and audited as `payroll.letter.generate` with the employee id) draws the PDF with the business name, address, logo and, **only if the owner uploaded one**, the signature image above a **blank signature line**. No digital-signature claim anywhere. Available once the exit is recorded.

## 5. Loans and advances

Tables `employee_loans`, `employee_loan_installments` (the schedule; replaced, never edited, with a `superseded` status), `employee_loan_events` (the log and the statement; the **balance is the principal less the principal recovered**, summed from it; unique partial indexes make "recovered in this run" and "recovered in this settlement" idempotent).

- **Issue** (`create`): amount, yearly interest (default 0), **number of instalments or an EMI**, first month, purpose. `buildRepaymentSchedule`: interest = balance x rate / 12 rounded half up to the paisa each month, EMI = the standard formula rounded half up (amount / count at 0%), **the last instalment clears the exact balance**. The web shows the schedule before saving (`schedulePreview`). **Approval** is maker-checker (requester cannot approve) and needs `manage`. **Disbursement** (`PayrollPosting`): Dr 1260 / Cr bank or cash and a bank transaction, once.
- **Recovery in a run.** `calculateRun` appends, after the statutory amounts, one `loan` deduction component per loan for the principal and one for the interest (`source: "loan"`, `loanId`, `loanPart`; category advance recovery), so they print on the payslip and sit inside the existing net-pay, totals and data-audit rules. The amount is `planLoanRecovery`: at most **`payroll_settings.loan_max_deduction_percent` (default 50) of the net pay before loan recovery**, oldest instalment first, interest before principal; the rest stays due on its instalment (**arrears**, carried to the next run) with the warning `loan_arrears`. An employee with a settlement is skipped (`loan_in_fnf`): the balance goes through it.
- **Approval of the run records the recovery.** `applyRunLoanRecoveries` locks the loans, re-plans from today's balances and **refuses if the result differs from the frozen line** (a prepayment, a skip, a settlement or the cap changed in between: "calculate again"), then updates the instalments and writes the events. **Posting** credits 1260 with the principal and 4110 with the interest instead of 2410 (`buildPostingTotals`: `loanPrincipalPaise`, `loanInterestPaise`), so the entry still balances.
- **Part-payment** (`prepay`): Dr bank / Cr 1260 (and 4110 for interest paid), the rest is re-planned at the same EMI (a shorter loan). **Foreclosure**: the whole balance, the loan closes. **Skip** (reason required, audited): the next open instalment is `skipped`, the rest move one month later, no interest for the skipped month. **Reschedule** (reason required): a new count or EMI from a month. Interest unpaid on a replaced instalment is not carried (documented simplification).
- **Statement**: events with principal, interest and balance after, as CSV.
- **Employee-side view (`payrollSelf.loans`) was cut**, as the brief allowed: it would have widened the employee allowlist for a minor benefit. Employees see loan recoveries as lines on their payslips (already allowed).

## 6. Registers

Reused, not rebuilt: the Phase 2 wages, attendance, leave, bonus and gratuity registers. Added to `payrollStatutory.register` (same CSV conventions, `Payroll:update`): `employment` (every employee with joining and exit), `deductions` (a financial year: non-statutory deductions from wages plus loans and advances given and recovered; statutory deductions have their own files), `overtime`, `fnf`. Each carries the note "Working copy for CA or legal review. Formats differ by state and by Act; this is not a statutory form." and the web and help say so. **PDF export (added after Phase 4):** every register, the four above and the Phase 2 wages, attendance, leave, bonus and gratuity registers, can be returned as a PDF through the same procedure: `payrollStatutory.register` takes `format: "csv" | "pdf"` (default `csv`, so existing callers and the CSV bytes are unchanged; same permission, `Payroll:update`, same add-on gating, no new procedure). `registerAsPdf` (`registers4.ts`) reads the rows back from the CSV the builder just made (`parseCsvTable` in `phase4-pdf.ts`; the spreadsheet-formula guard apostrophe is removed), so the PDF can never differ from the file, and `generateRegisterPDF` draws it with pdfkit and Noto Sans like the other Phase 4 PDFs: landscape A4, business name, register title and period, the working-copy label and the header row on every page, `Page x of y` (buffered pages), zebra rows, numbers right aligned. **Pagination**: any number of rows (tested with 300 through the API and 3,000 in the generator: about 3 seconds, a few MB). **Wide registers**: the natural width of each column is measured; the employee columns (`Employee Code`, `Employee Name` / `Name`, `Settlement No`) are repeated and the other columns are split into groups that fit the page (so a wages register with many components, or the 36-column attendance register, is printed in column groups on separate pages, never squeezed); a single cell wider than 150 pt is cut with `...` and a note says so (the CSV has the full text). The PDF response keeps every key of the CSV response (`text` is empty) and adds `base64` and `pages`, with `contentType: "application/pdf"`. Tests: `register-pdf.test.ts` (generator, with pdfjs reading the pages back) and `integration/payroll-registers-pdf.test.ts` (all nine registers, CSV unchanged, permissions, 300 employees).

## 7. Security model

- Same two checks as the rest of Payroll (`assertPayroll`: permission, then add-on; reads pass a read-only organisation). The role matrix, mutation gate and parity files list every new procedure.
- **Employees**: no new `payrollSelf` procedure, so the Phase 3 backstop refuses an employee every Phase 4 procedure; `employee-hr-sweep.test.ts` classifies each new procedure (HR may call all but approve / post / pay / disburse / prepay / foreclose / settings / provision).
- **Isolation**: every query is keyed on the business; `payroll-phase-4.test.ts` and the isolation sweep prove another business cannot read or change any of it.
- **AI**: no assistant tool reads any of it (note in `lib/ai/tools.ts`; tests refuse the new procedure names).
- Self-export / import: nine new tables in `TABLE_REGISTRY` and `ROW_SCHEMAS` (all exportable; new settings column optional). Data-audit rules for all nine (`rules/payroll.ts`).

## Not built, and known limits

- Set-on / set-off, minimum-bonus-versus-surplus logic, tax on gratuity, TDS on a settlement (manual amount only), perquisite tax on cheap loans, an actuarial gratuity valuation.
- Reversing an approved (not yet posted) settlement, or an approved bonus run (a posted or paid settlement can be reversed, see above); writing off a loan balance.
- The employee-side loan or settlement view; mobile, CLI and MCP surfaces.
- The statutory form of any state (the registers, CSV or PDF, are working copies).
- Accrued interest in a settlement (principal only); day-count interest.
- Not run in a browser; no CA has confirmed any figure.
