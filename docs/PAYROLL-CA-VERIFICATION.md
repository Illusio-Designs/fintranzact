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
