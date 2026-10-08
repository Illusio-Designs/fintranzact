# Payroll: CA verification checklist

Before go-live (and every year after), a chartered accountant should sign off on the items below. Payroll is money and compliance: **every rate, ceiling, slab and due date is data** that the owner edits per financial year (Payroll, Statutory settings), but the **shipped defaults and the calculation rules are ours** and must be confirmed. The code is in `packages/shared/src/payroll-calc.ts`, `payroll-statutory.ts` and `payroll-filings.ts`; the rules are described in [`architecture/payroll.md`](architecture/payroll.md).

Fintranzact **files nothing and pays nothing**: it produces files and records payments. No file layout below has been validated by any portal.

How to read the confidence column: **stated** = the figure is in the roadmap text; **long-standing** = a figure we are confident has been stable for years but that is not in the roadmap; **assumption** = a modelling choice we made; **empty** = shipped without a value on purpose.

## 1. Figures shipped as defaults (`defaultStatutoryRates()`)

| Item | Default | Basis | Confirm |
|---|---|---|---|
| PF employee share | 12% | stated | [ ] |
| PF employer share | 12% | stated | [ ] |
| EPS share of the employer's PF | 8.33% of wages up to the EPS ceiling | stated | [ ] |
| PF wage ceiling / EPS wage ceiling | ₹15,000 / ₹15,000 a month | stated | [ ] |
| EPS cut-off for new members above the ceiling | members joining **on or after 1 Sep 2014** with wages above the ceiling have no EPS | stated (the roadmap says "after"; the rule is implemented as "on or after": confirm the boundary day) | [ ] |
| Age at which EPS stops | 58 (applied from the first day of the month in which the age is reached) | stated (the exact month is an assumption) | [ ] |
| ESI employee / employer | 0.75% / 3.25% | stated | [ ] |
| ESI wage ceiling | ₹21,000 a month | stated | [ ] |
| Professional tax yearly maximum | ₹2,500 | stated | [ ] |
| **Maharashtra (27) professional tax slabs** | Men: up to ₹7,500 nil; above ₹7,500 up to ₹10,000 ₹175; above ₹10,000 ₹200 (February ₹300). Women: up to ₹25,000 nil; above ₹25,000 ₹200 (February ₹300). A year totals at most ₹2,500 | long-standing; the only state seeded | [ ] |
| New-regime standard deduction | ₹75,000 | stated | [ ] |
| Health and education cess | 4% | long-standing | [ ] |
| Income and tax rounding | to a multiple of ₹10 (s.288A / s.288B) | long-standing | [ ] |
| Old-regime declaration limits | 80C ₹1,50,000; home-loan interest ₹2,00,000; 80D no limit set (0 = none) | long-standing (80D depends on age and parents: set it per case) | [ ] |
| Surcharge warning threshold | warn when projected taxable income is above ₹50,00,000 (surcharge itself is **not** computed) | long-standing | [ ] |
| Due dates | PF and ESI the 15th and TDS the 7th of the following month; the March TDS on 30 April; Form 24Q quarter ends 31 Jul, 31 Oct, 31 Jan, 31 May; Form 16 by 15 June | long-standing (the app only displays them; PT and LWF days ship **empty**) | [ ] |
| Gratuity register | 15 days for every 26 working days per completed year, minimum 5 years, limit ₹20,00,000, part year of more than six months counted as a full year | long-standing; completed years (not the rounded-up figure) are tested against the minimum | [ ] |

### Shipped EMPTY on purpose (the owner or CA must enter them)

- [ ] **Professional tax slabs of every state except Maharashtra** (including Karnataka, Gujarat and West Bengal): the screen says "Slabs not configured: add your state's slabs", the run deducts 0 and shows a warning.
- [ ] **Labour welfare fund** amounts, frequency and months for every state (same warning).
- [ ] **Income-tax slabs for both regimes**, the section 87A rebate limit and amount, and marginal relief, and the old-regime standard deduction: with no slabs no TDS is deducted and the run warns. (The unit tests use slab figures as fixtures only; the product does not ship them.)
- [ ] **Bonus** wage ceiling and percentage (the bonus register shows the wages and "not configured" until set).
- [ ] **Professional tax and LWF due days**.

## 2. Calculation rules and assumptions

### Provident fund

- [ ] **PF wages** = Basic + DA + retaining allowance (plus any component flagged as a wage) **as earned** after loss of pay; the ceiling is applied to earned wages. Confirm this is the wage definition to use (the Labour Codes wage definition and special allowances are not special-cased).
- [ ] Contributions on the wages capped at the ceiling unless the employee is on **actual wages**.
- [ ] **VPF** = the chosen percentage of the **actual** wages (not capped), on top of the 12%, in the employee's EPF share (it appears in the ECR EPF contribution).
- [ ] **EPS wages** = contribution wages up to the EPS ceiling; EPS = 8.33% of them; the employer's EPF share = the rounded employer 12% less the rounded EPS. Confirm the rounding.
- [ ] **Rounding**: each PF amount rounded **once to the nearest rupee** (default; editable).
- [ ] **International worker**: modelled only as "no wage ceiling" plus a "review with your CA" flag; EPS treatment is not decided automatically. Confirm what is required.
- [ ] **Excluded employee**: no PF at all; the app only warns when wages are within the ceiling.
- [ ] **EPS suggestion** uses the first salary assignment's wages as "wages at joining" and the PF join date (joining date when blank). It is a suggestion; the employee's flag is what payroll uses.
- [ ] Employer PF and EPS are added **on top** of the salary structure when the run is calculated (they are not inside the structure's CTC).
- [ ] The EDLI wage in the ECR is the wage capped at the ceiling; the app does not compute EDLI or admin charges.

### ESI

- [ ] **Eligibility** tested on the **full-month wages of the structure**, all earnings except overtime (one-off adjustments and leave encashment excluded); exactly ₹21,000 is covered; above it is not.
- [ ] **Contributions** on the **earned** wages of the month (the same definition), employee 0.75% and employer 3.25%, each **rounded up to the next rupee** (our understanding of ESIC practice: confirm).
- [ ] **Contribution-period rule as implemented**: periods are April-September and October-March; an employee who **contributed in an earlier month of the current period** (found in approved runs) stays covered to the end of the period even if wages rise above the ceiling; tested afresh at the start of the next period. A person first covered mid-period is covered until the period ends. Confirm, including how a mid-period joiner is treated.
- [ ] The disability threshold and other ESI special cases are not modelled.

### Professional tax and labour welfare fund

- [ ] PT is on the month's **gross salary** (all earnings including one-offs); the slab applies when gross is above its lower limit and up to its upper limit.
- [ ] Slab by **gender** when the state has gender-specific slabs; an employee with no gender uses the male slabs and a warning is shown.
- [ ] The **February** amount is used only where a slab has one configured; the yearly cap is applied against PT deducted so far in the financial year.
- [ ] State of the employee: the work state if it is one of the business's PT states, otherwise (no work state) the business's only PT state; a work state outside the PT states means no PT.
- [ ] Only **monthly** PT deduction is modelled (no half-yearly or yearly PT states).
- [ ] LWF: amounts deducted in the configured months, for employees whose work state is blank or the LWF state.

### TDS on salary (section 192)

- [ ] **Projection**: gross to date from approved runs + this month + the **full monthly gross** (structure, excluding overtime) for each remaining month to March (or the exit month) + previous-employer income.
- [ ] **Regime** from the employee master; the new-regime standard deduction ₹75,000; the **old regime** takes declarations (80C, 80D, home-loan interest within limits; HRA exemption and others as entered, **not validated**) and the projected professional tax.
- [ ] Tax by slabs, **87A rebate** and optional **marginal relief** (a single threshold and maximum per regime), **cess** 4%, total rounded to ₹10.
- [ ] **Spreading**: (tax - tax already deducted - previous employer's TDS) / months left including this one, rounded to the rupee, never negative, capped at the pay left after other deductions (the shortfall rolls forward and a warning is shown).
- [ ] **Not applied** (warnings only): surcharge, senior-citizen slabs (60 and 80+), the s.206AA higher rate for a missing PAN, NPS and other employer contributions, perquisites, arrears relief.
- [ ] Earlier months with **no approved payroll** are not projected: a warning is shown and the tax already deducted may be incomplete (mid-year start of the app).
- [ ] The **Income-tax Act 2025** (in force from 1 April 2026) renumbers sections; the screens still use the familiar section numbers (192, 87A, 80C). Confirm the terminology and any changes for the tax year 2026-27.

## 3. Files and registers (layouts to verify against the portals)

- [ ] **PF ECR text file**: `UAN#~#Member Name#~#Gross Wages#~#EPF Wages#~#EPS Wages#~#EDLI Wages#~#EPF Contribution Remitted#~#EPS Contribution Remitted#~#EPF EPS Diff Remitted#~#NCP Days#~#Refund of Advances`, whole rupees, one member per line, only members with a UAN. Check against the EPFO portal's **current** ECR template and its validation. A member without EPS has zero EPS wages and contribution and the whole employer 12% in the "EPF EPS diff" column.
- [ ] **ESIC monthly contribution file**: CSV with IP Number, IP Name, days paid, total monthly wages, reason code (0), last working day (DD/MM/YYYY). Check against ESIC's current bulk-upload template (which is usually a spreadsheet template).
- [ ] **PT and LWF sheets**: plain working sheets per state, not any state's return format.
- [ ] **Form 24Q working data**: deductee and challan CSVs; not an FVU file; the deduction date is taken as the last day of the wage month.
- [ ] **Form 16 working copy**: a Part A and Part B **style** summary labelled "Working copy for CA review"; it is **not** a TRACES certificate.
- [ ] **Registers**: wages, attendance, leave, bonus and gratuity registers are working registers, not the statutory forms of any Act or state.
- [ ] **Bonus register**: wages after the (configurable) ceiling, bonus at the configured percentage; no default percentage or ceiling is shipped.
- [ ] **Gratuity register**: last drawn Basic + DA per completed year; completed years are measured from the joining date to the "as on" date counting the end date.

## 4. Books

- [ ] Statutory amounts are credited to **2430 PF and EPS Payable, 2431 ESI Payable, 2432 Professional Tax Payable, 2433 Labour Welfare Fund Payable, 2434 TDS on Salary Payable**, employee and employer shares together; the employer shares are debited to 5204 Employer Contributions to Staff. Confirm the account structure and the existing 2200 TDS Payable (which is **not** used for salary TDS).
- [ ] Payment of a due is Dr payable / Cr cash or bank, dated the payment date.
- [ ] Employer statutory contributions are an expense of the wage month and are not inside the structure's CTC.

## 5. Carried over from Phase 1 (still open)

- [ ] The Labour Codes **50% wage rule** (warning only), the **overtime rate** (2x of the ordinary hourly wage, 8 hours a day) and the **rounding rule** (half up once per amount).

## 6. Sign-off

- [ ] The statutory settings for the current financial year have been entered and the **last verified** note filled in on the Statutory settings screen.
- [ ] A sample payroll month was recomputed independently by the CA and matched, line by line.

## 7. Phase 4: bonus, gratuity, full and final, loans and registers

The code is in `packages/shared/src/payroll-phase4.ts`; the design is in [`architecture/payroll-phase-4.md`](architecture/payroll-phase-4.md). **The roadmap line "CA verification of bonus and gratuity rules" is not ticked: nobody has confirmed any of this.** Same confidence column as above.

### Figures shipped as defaults and figures shipped EMPTY

| Item | Default | Basis | Confirm |
|---|---|---|---|
| Lowest and highest bonus percentage | 8.33% and 20% | stated (roadmap) | [ ] |
| Days worked in the year to be eligible for bonus | 30 | long-standing | [ ] |
| Gratuity minimum years, ordinary staff | 5 completed years | stated | [ ] |
| Gratuity minimum years, fixed-term | 1 completed year | stated (the roadmap says "under the new Labour Codes") | [ ] |
| Gratuity days per year / divisor / limit | 15 / 26 / ₹20,00,000 | stated / long-standing (from Phase 2) | [ ] |
| Loan recovery cap | 50% of net pay (a setting per business) | assumption | [ ] |

Shipped **EMPTY on purpose** (a bonus run refuses to calculate until they are set; confirm the right figures for each year and enter them with a "last verified" note):

- [ ] **Bonus eligibility wage ceiling** (a monthly figure).
- [ ] **Bonus calculation ceiling** (a monthly figure).
- [ ] **Minimum wage for bonus** (a monthly figure; optional when the calculation ceiling is set).

### Bonus rules and assumptions

- [ ] **One bonus run per financial year (April to March)**, from the Basic + DA of the **approved payroll runs** of that year. Months without an approved run are not counted (a warning names them).
- [ ] **Wage definition** = Basic + DA only (categories basic and DA of the salary structure), **as earned** after loss of pay. Retaining allowance and other wage components are not included, unlike the PF wage. Confirm.
- [ ] **Eligibility** is tested on the **full-month Basic + DA of the last month the employee was paid in the year** (not on every month, not on the highest month): eligible when it is **up to** the ceiling (equal is eligible). The Act speaks of salary or wage "per mensem"; this is our reading. Confirm.
- [ ] **Days worked** is measured by **paid days** (including weekly offs, holidays and paid leave) summed over the year; fewer than the minimum (30) makes the employee not eligible. Confirm paid days are an acceptable proxy for "days worked".
- [ ] **Calculation wage** each month = the **lower** of the Basic + DA earned and the **cap**, where the cap is the **higher of the calculation ceiling and the minimum wage**, reduced for a part month (cap x paid days / days in month, rounded half up). The brief for this feature described it as "the higher of the ceiling-limited wage and the minimum wage"; we implemented the Act's reading (the cap is the higher of the two) so that a wage below the minimum wage is **not** raised to it. Confirm which is right.
- [ ] **Bonus** = the total of the monthly calculation wages x the chosen percentage, rounded half up **once per employee** to the paisa.
- [ ] **Percentage** chosen per run between the lowest and highest. No allocable-surplus test.
- [ ] **Not built, on purpose:** set-on and set-off of allocable surplus (sections 15 and 16), the minimum-bonus-versus-surplus logic, and bonus-related PF. Confirm none is needed for your clients.
- [ ] **Manual "not eligible" flag** with a reason (for example dismissal for misconduct); nothing decides misconduct automatically.
- [ ] An employee whose bonus for the year is paid in an **approved full and final settlement** is left out of that year's bonus run, and the settlement refuses a bonus a run already pays.
- [ ] **Books:** Dr 5202 Salary - Bonus & Incentives / Cr 2440 Bonus Payable on the **last day of the financial year** (today if it has not ended); payment is Dr 2440 / Cr bank or cash.

### Gratuity

- [ ] **Formula:** last drawn **Basic + DA** (the monthly figures of the salary structure in force on the date, not an average) x 15 / 26 x years; rounded half up to the paisa once.
- [ ] **Years:** completed years (service measured from the joining date to the end date, **counting the end date**), plus one when the part year is **more than six months** (exactly six months does not round up). The **minimum is tested on completed years**, not on the rounded-up figure.
- [ ] **Fixed-term:** the employment type **Contract** is treated as fixed-term (1 year). The app has no separate fixed-term flag. Confirm, and confirm the 1-year rule under the Labour Codes for your contracts.
- [ ] **Death and disablement:** the exit reasons "Death" and "Disablement" remove the minimum service entirely. The amount is still the formula (a person with less than six months of service therefore gets nothing). Confirm.
- [ ] **Limit** from Statutory settings (₹20,00,000 shipped); 0 means no limit.
- [ ] **Tax on gratuity is not calculated**, in the estimate or in a settlement.
- [ ] **Provision (optional):** the liability is the sum of what is **payable today** to employees who have met the minimum service. The provision posts only when someone presses the button, books the difference from the balance of 2441 Gratuity Provision (Dr 5205 Salary - Gratuity / Cr 2441), and a settlement draws gratuity from the provision first. This is a simple "payable if everyone eligible left today" policy, **not an actuarial valuation**. Confirm the accounting policy.

### Full and final settlement

- [ ] **Order:** amounts due (leave encashment, gratuity, bonus due, arrears and other earnings) less notice-period recovery, a manual TDS amount and other recoveries, then **loan principal last**, from what is left, never below zero (the rest stays outstanding on the loan).
- [ ] **The last month's salary is paid by the exit month's payroll run, not in the settlement**, so PF, ESI, professional tax, TDS, the payslip and the statutory files stay complete. The settlement cannot be submitted until that run is approved. Confirm this is acceptable (the alternative, computing it inside the settlement, would have left those filings short).
- [ ] **Leave encashment:** every **encashable** leave type; days = the balance in the leave year of the last working day, **limited by the type's carry-forward maximum** when it carries forward with a limit; rate = **Basic + DA / 26** (default), Basic + DA / 30 or gross / 30 (a choice per settlement); amount = days x rate, rounded half up once. Confirm the divisor and the cap.
- [ ] **Notice-period recovery:** shortfall days x **gross monthly salary / 30** (half days allowed), rounded half up. Confirm.
- [ ] **Bonus due** is only a suggestion at the **lowest** percentage on the wages of the financial year of the exit (to the exit month).
- [ ] **TDS on the settlement is NOT computed** beyond a manual amount line and a warning. Leave encashment and gratuity have their own exemption rules and the settlement is not part of the Phase 2 TDS projection.
- [ ] **No reversal** of an approved settlement (none exists for payroll runs either): correct with a journal entry.
- [ ] **Books:** Dr Salary - Allowances (leave encashment and other dues), Salary & Wages (arrears), Salary - Bonus & Incentives, Gratuity Provision / Salary - Gratuity; Cr 2442 Full and Final Settlements Payable (net), 1260 Loans and Advances (loan recovered), 2410 Payroll Deductions Payable (notice and other recoveries) and 2434 TDS on Salary Payable (the manual amount). Dated the last working day.

### Loans and advances

- [ ] **Interest** is simple reducing-balance, monthly: balance x yearly rate / 12, rounded half up to the paisa; **no day count**. Interest income is credited to 4110 as it is recovered. Confirm the tax treatment of interest on loans to employees, and any perquisite (interest-free or concessional loan) implications. **None is computed.**
- [ ] **EMI** = the standard formula rounded half up to the paisa (double-precision arithmetic); with 0 percent, the amount divided by the instalments, rounded half up. The **last instalment** clears the exact balance (a few paise different). Given an EMI instead of a count, instalments continue until the balance is cleared (refused above 600 months or if the EMI does not cover the interest).
- [ ] **Recovery in payroll:** at most the configured share of net pay **before loan recovery** (50% default); interest is taken before principal, oldest instalment first; the rest is carried forward as arrears. Confirm the legal limit on deductions from wages that applies to you.
- [ ] **Part-payment** reschedules the balance at the same EMI (shorter loan); a **skipped** month charges no interest; unpaid interest on a replaced instalment is not carried.
- [ ] **Full and final** recovers the **principal outstanding only** (no accrued interest).
- [ ] **Books:** Dr 1260 Loans and Advances to Employees / Cr bank or cash at disbursement; instalments in payroll credit 1260 (principal) and 4110 (interest) instead of 2410.

### Relieving letters and registers

- [ ] The letter wording is the business's own text with placeholders; the shipped default is a plain certificate. **Not digitally signed.** Have a lawyer check the wording.
- [ ] The employment, deductions and advances, overtime and settlement registers are **working copies**. State and Act formats differ; none is claimed to be a statutory form.

### Sign-off for Phase 4

- [ ] The bonus ceilings and the percentage for the current financial year have been entered with a "last verified" note.
- [ ] A sample bonus run, gratuity amount, loan schedule and settlement were recomputed independently by the CA and matched.
