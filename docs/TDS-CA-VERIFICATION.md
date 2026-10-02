# TDS / TCS: yearly CA verification checklist

The TDS/TCS module computes from rules in code. Rates and thresholds are **defaults per financial year**; a business can override each section per year (Settings of the TDS page). The values below are what the code holds today, read from the source, not legal advice. The CA must confirm each one before every financial year and before filing.

## 1. Section rates and thresholds (`packages/shared/src/tds.ts`, `party-compliance.ts`)

| Code | Rate % | Individual/HUF % | No-PAN % | Single limit | Yearly limit | Basis |
|---|---|---|---|---|---|---|
| 194Q purchase of goods | 0.1 | - | 5 | none | 5,000,000 | purchases, tax only on the excess |
| 194C contractors | 2 | 1 | 20 | 30,000 | 100,000 | payments |
| 194J technical / royalty | 2 | - | 20 | none | 50,000 | payments |
| 194J professional | 10 | - | 20 | none | 50,000 | payments |
| 194H commission | 2 | - | 20 | none | 20,000 | payments |
| 194I plant and machinery | 2 | - | 20 | none | 600,000 | payments |
| 194I land and building | 10 | - | 20 | none | 600,000 | payments |

The threshold comments in the code say "after Finance Act 2025 (effective 1 Apr 2025)". `defaultTdsSectionRules` ignores the year argument: the same defaults apply to every year until overridden, so confirm the table and set overrides for each new year.

Individual rate applies only when the party's constitution is proprietorship or HUF.

## 2. TCS (`packages/shared/src/tcs.ts`)

| Code | Rate % | Single sale limit |
|---|---|---|
| 206C alcoholic liquor | 1 | none |
| 206C tendu leaves | 5 | none |
| 206C timber under forest lease | 2.5 | none |
| 206C timber (other) | 2.5 | none |
| 206C other forest produce | 2.5 | none |
| 206C scrap | 1 | none |
| 206C coal, lignite, iron ore | 1 | none |
| 206C parking lot, toll plaza, mining | 2 | none |
| 206C motor vehicle | 1 | 1,000,000 |

No-PAN TCS rate in code (s.206CC): twice the rate or 5%, whichever is higher. Base is taxable value excluding GST where GST is shown separately. TCS is rounded to the nearest rupee.

## 3. Items that need a CA decision

- **s.206AA (no PAN):** if the party has no PAN (and no GSTIN to derive one from), the higher no-PAN rate is applied. PAN verification through Sandbox (`tds.verifyDeductee`, "Verify PAN" on the party) is advisory only: if it says the PAN is invalid or the name does not match, the app shows a warning and does **not** change the rate or block anything. The CA decides whether such a party should be treated as having no PAN.
- **s.206AB / 206CCA (non-filers of returns, higher rate):** **not implemented.** The code has no specified-person check. The CA must decide whether it applies and, if so, rates must be overridden by hand or the check built.
- **s.194Q:** applies only above the yearly threshold for purchases from one seller and only if the buyer's turnover in the preceding year exceeded the limit in the section note. The app tracks the threshold, not the buyer-turnover condition; confirm it is met. Interaction with TCS on the seller side and with s.194O/GST-inclusive base is for the CA.
- **TCS on sale of goods, old s.206C(1H):** removed from 1 April 2025. The app has no 1H section. Confirm no transactions before that date need it.
- **Income-tax Act, 2025, in force from 1 April 2026:** section numbers and form names change (the code comment notes the TDS provisions fold into s.393). The app keeps the old codes as labels. Confirm the new section mapping, form names (24Q/26Q/27Q/27EQ, 16A, 27D) and whether the challan and return formats change, before the first return of FY 2026-27.
- Whether the amount TDS is calculated on should include GST (the app uses the taxable value where GST is shown separately).
- Lower or nil deduction certificates (s.197) are not handled.

## 3a. Due dates (`tdsDepositDueDate`, `tdsReturnDueDate`)

- Deposit: 7th of the next month; March deductions: 30 April (the code applies the same dates to TCS).
- Quarterly return: Q1 31 July, Q2 31 October, Q3 31 January, Q4 31 May.
- Confirm against the current notified dates each year, including late-fee and interest rules (not computed).

## 4. Certificates and returns

- Form 16A and 27D in the app are **generated from the books, not issued by TRACES**. They are working statements to share, not the statutory TRACES certificate. The deductor must still download the official certificate from TRACES after the return is processed.
- The app prepares 26Q and 27EQ **data**; it does not generate the FVU file, Form 27A, or e-file. See "TDS filing and certificates" in `SANDBOX-INTEGRATION.md`.

## 5. 26AS / AIS reconciliation (`lib/tds-26as-parser.ts`)

- Supported: a CSV or tab-separated export with a header row and columns for deductor TAN, section, transaction date and tax deducted (plus optional name, amount paid, TDS deposited). Dates as dd-MMM-yyyy, dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd; Indian-style amounts.
- **Not supported:** the raw TRACES Form 26AS text file and AIS JSON. They are rejected with a message. Convert to CSV first.
- Confirm that matched entries agree with the books for every TDS receivable claimed.

## Sign-off

| Item | CA | Date |
|---|---|---|
| Rates and thresholds (sections 1 and 2) for the year | | |
| 206AA / 206AB / 194Q decisions | | |
| 206C(1H) not applied after 1 April 2025 | | |
| Income-tax Act 2025 mapping (from 1 April 2026) | | |
| Due dates | | |
| Certificates and 26AS handling accepted | | |
