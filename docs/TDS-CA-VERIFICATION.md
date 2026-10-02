# TDS / TCS: yearly CA verification checklist

The TDS/TCS module computes from rules in code. Rates and thresholds are **defaults per financial year**; a business can override each section per year (Settings of the TDS page). The values below are what the code holds today, read from the source, not legal advice. The CA must confirm each one before every financial year and before filing.

## 0. How the defaults are versioned

`defaultTdsSectionRules(fy)` (`packages/shared/src/tds.ts`) and `defaultTcsSectionRules(fy)` (`tcs.ts`) return the built-in rules **for the financial year asked**. Years before 2026-27 use the Income-tax Act 1961 values; 2026-27 onward use the Income-tax Act 2025 values. Resolution for a transaction: **the business's per-year override (TDS page, Settings tab) first, else the built-in default of that year**. The financial year of a transaction is always derived from its own date (invoice date, expense date, payment date), never from today.

The old code (`194C`, `206C_SCRAP` ...) stays the stable id in every year, so stored rows, overrides, exports and returns do not change. The new-Act reference (`actSection`) and `paymentCode` are display metadata only, shown for 2026-27 onward. Per-year metadata (`tdsRulesMetaFor(fy)`, `tcsRulesMetaFor(fy)`): source notes, `lastReviewed` (2026-10-02), `verifyWithCA: true`, `actNote`. The `tds.sections` procedure returns it as `meta`.

**History is never recomputed.** A recorded deduction keeps the rate, base and amount stored on its row; returns, certificates, challans and the 26AS match read the stored values. Rules are applied only when a bill, expense, payment or sale invoice is created or edited (`syncBillTds`, `syncInvoiceTcs` and the payment/expense paths), using that document's own financial year. Editing an old 2025-26 invoice therefore re-works it at the 2025-26 rate, not today's.

All values below are **secondary-source, verify with CA** (see the sources at the end).

## 1. TDS section rates and thresholds

Same rates and limits in both years (read from the code); only the new-Act reference changes. Basis: payments, except 194Q (purchases, tax only on the excess).

### FY 2025-26 and earlier (Income-tax Act 1961)

| Code | Rate % | Individual/HUF % | No-PAN % | Single limit | Yearly limit |
|---|---|---|---|---|---|
| 194Q purchase of goods | 0.1 | - | 5 | none | 5,000,000 |
| 194C contractors | 2 | 1 | 20 | 30,000 | 100,000 |
| 194J technical / royalty | 2 | - | 20 | none | 50,000 |
| 194J professional | 10 | - | 20 | none | 50,000 |
| 194H commission | 2 | - | 20 | none | 20,000 |
| 194I plant and machinery | 2 | - | 20 | none | 600,000 |
| 194I land and building | 10 | - | 20 | none | 600,000 |

### FY 2026-27 onward (Income-tax Act 2025, section 393)

| Code | Rate % | Individual/HUF % | No-PAN % | Single limit | Yearly limit | Act 2025 reference | Payment code |
|---|---|---|---|---|---|---|---|
| 194Q purchase of goods | 0.1 | - | 5 | none | 5,000,000 | 393(1) Table 8(ii) | 1031 |
| 194C contractors | 2 | 1 | 20 | 30,000 | 100,000 | 393(1) Table 6(i) | 1023 (individual/HUF) / 1024 (others) |
| 194J technical / royalty | 2 | - | 20 | none | 50,000 | 393(1) Table 6(iii) | 1026 |
| 194J professional | 10 | - | 20 | none | 50,000 | 393(1) Table 6(iii) | 1027 |
| 194H commission | 2 | - | 20 | none | 20,000 | 393(1) | not confirmed (one source says 1006) |
| 194I plant and machinery | 2 | - | 20 | none | 600,000 | 393(1) Table 2(ii) | 1008 |
| 194I land and building | 10 | - | 20 | none | 600,000 | 393(1) Table 2(ii) | 1009 |

Individual rate applies only when the party's constitution is proprietorship or HUF. The 194J split (1026 technical / 1027 professional; a separate 1028 for director fees exists but the app has no such section) and the 194H row and code are the least certain items here. The 194Q buyer-turnover condition (above 10 crore in the previous year) is not tracked.

## 2. TCS rates

### FY 2025-26 and earlier (s.206C)

| Code | Rate % | No-PAN % | Single sale limit |
|---|---|---|---|
| 206C alcoholic liquor | 1 | 5 | none |
| 206C tendu leaves | 5 | 10 | none |
| 206C timber under forest lease | 2.5 | 5 | none |
| 206C timber (other) | 2.5 | 5 | none |
| 206C other forest produce | 2.5 | 5 | none |
| 206C scrap | 1 | 5 | none |
| 206C coal, lignite, iron ore | 1 | 5 | none |
| 206C parking lot, toll plaza, mining | 2 | 5 | none |
| 206C motor vehicle | 1 | 5 | 1,000,000 |

### FY 2026-27 onward (Income-tax Act 2025, section 394(1))

| Code | Rate % | No-PAN % | Single sale limit | Payment code |
|---|---|---|---|---|
| 206C alcoholic liquor | **2** (was 1) | 5 | none | 1068 |
| 206C tendu leaves | **2** (was 5) | 5 | none | not found |
| 206C timber under forest lease | 2.5 (**see below**) | 5 | none | not found |
| 206C timber (other) | 2.5 (**see below**) | 5 | none | not found |
| 206C other forest produce | 2.5 (**see below**) | 5 | none | not found |
| 206C scrap | **2** (was 1) | 5 | none | 1073 |
| 206C coal, lignite, iron ore | **2** (was 1) | 5 | none | not found |
| 206C parking lot, toll plaza, mining | 2 | 5 | none | not found |
| 206C motor vehicle | 1 | 5 | 1,000,000 | not found |

**Conflict, flagged:** some 2026-27 chart pages print timber and other forest produce at 2% ("remains at 2%"), while the earlier values here are 2.5%. Per the rule "keep the older value where sources conflict", 2.5% is kept for 2026-27. The CA must decide; if 2% is right, set a per-year override for the three forest codes (TDS page, TCS, Settings), or change the 2026-27 value in `tcs.ts`.

Not in the app: TCS on overseas tour packages (flat 2% from 2026-27) and on LRS remittances (education / medical 5% to 2%) are the seller-bank/tour-operator cases, outside the sale-of-goods sections the app models.

No-PAN TCS rate in code (s.206CC): twice the rate or 5%, whichever is higher. Base is taxable value excluding GST where GST is shown separately. TCS is rounded to the nearest rupee.

## 3. Items that need a CA decision

- **s.206AA (no PAN):** if the party has no PAN (and no GSTIN to derive one from), the higher no-PAN rate is applied. PAN verification through Sandbox (`tds.verifyDeductee`, "Verify PAN" on the party) is advisory only: if it says the PAN is invalid or the name does not match, the app shows a warning and does **not** change the rate or block anything. The CA decides whether such a party should be treated as having no PAN.
- **s.206AB / 206CCA (non-filers of returns, higher rate):** **not implemented.** The code has no specified-person check. The CA must decide whether it applies and, if so, rates must be overridden by hand or the check built.
- **s.194Q:** applies only above the yearly threshold for purchases from one seller and only if the buyer's turnover in the preceding year exceeded the limit in the section note. The app tracks the threshold, not the buyer-turnover condition; confirm it is met. Interaction with TCS on the seller side and with s.194O/GST-inclusive base is for the CA.
- **TCS on sale of goods, old s.206C(1H):** removed from 1 April 2025. The app has no 1H section. Confirm no transactions before that date need it.
- **Income-tax Act, 2025, in force from 1 April 2026:** non-salary TDS is s.393 with four-digit payment codes, TCS is s.394, and "tax year" replaces previous / assessment year. The app keeps the old codes as stable ids and shows the new reference and payment code for 2026-27 onward (section 1 and 2 tables). **Form and certificate names are not changed in the product:** Form 26Q / 27EQ / 16A / 27D are the 1961-Act names and the numbers for tax years from 2026-27 have not been confirmed. Confirm the new form names and numbers, and whether the challan and return file formats change, before the first return of FY 2026-27. The payment-code and Table references above come from secondary sources and have not been checked against the Act.
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
| Income-tax Act 2025 mapping and payment codes (from 1 April 2026) | | |
| TCS 2026-27 rates, timber / forest produce 2% vs 2.5% | | |
| Form names and numbers for tax years from 2026-27 | | |
| Due dates | | |
| Certificates and 26AS handling accepted | | |

## How to update yearly (runbook)

**Admin, per business, per financial year (no deploy).** TDS & TCS page, pick the year, **Settings** tab (switch TDS / TCS at the top):

1. Each section shows its effective rate and limits, a **Default** or **Overridden** badge, the built-in default beside an override, the Income-tax Act 2025 reference and payment code (2026-27 onward) and the last-reviewed date with a "verify with your CA" note.
2. **Edit** a section to change rates and limits as the CA advises, or switch it off. **Reset to defaults** removes the override.
3. New bills, expenses, payments and sale invoices dated in that year use it at once. Already recorded deductions keep their stored rate.

**Developer (new built-in defaults for everybody).** In `packages/shared/src/tds.ts` update `THRESHOLDS` / the section table in `party-compliance.ts`, and add a year entry (rates, `ACT_2025_REFS`, a new `TaxRulesMeta`) with the first year it applies; in `tcs.ts` add the year's rates (as `RATES_FROM_2026_27` does) and meta. **Do not change what an earlier year returns**: earlier years must keep computing as before. Set `lastReviewed`, keep `verifyWithCA: true`, add tests in `packages/shared/src/__tests__/tds.test.ts` / `tcs.test.ts` and `packages/api/src/__tests__/tds-rules-by-year.test.ts`, and update this document, the help article (`apps/web/src/content/help/accounting/tds.mdx`) and the developer docs (`apps/web/src/content/developers/tds.ts`). Adding a section is a schema change (the code enums and the data-audit / row schemas); a new rate or limit is not.

## Sources consulted (secondary; verify with CA)

Primary government sites could not be reached. Found through web search on 2026-10-02:

- https://taxguru.in/income-tax/tcs-rate-chart-tax-year-2026-27-income-tax-act-2025.html (TCS rate chart, scrap code 1073, alcohol code 1068)
- https://taxguru.in/income-tax/tcs-rates-rationalised-uniform-2-percent-1st-april-2026.html (Finance Act 2026 TCS changes; timber / forest produce "remains at 2%")
- https://taxguru.in/income-tax/tcs-rates-section-3941-w-e-f-01-04-2026.html
- https://cleartax.in/s/tds-and-tcs-changes-from-april-2026
- https://www.terra-insight.com/insights/tds-payment-codes-1001-1092-india/ and https://taxroutine.com/income-tax-act-2025/new-tds-and-tcs-payment-codes/ (payment codes)
- https://www.karnanica.com/new-tds-challan-codes-fy-2026-27/ (payment codes with old section references)
- https://calcguru.in/tds-new-section-codes-393-migration-checklist/ and https://saral.pro/blogs/tds-section-194c/ (194C under 393(1) Table 6(i), codes 1023 / 1024)
- https://blog.tdsman.com/2026/03/tds-tcs-rate-chart-fy-2026-27/ and https://taxgarden.in/blog/income-tax-act-2025-section-393-tds-new-numbers-old-194c-194j-194q (TDS mapping)

Unconfirmed: the 194H code and table row (sources disagree), the 194J sub-codes, TCS payment codes other than alcohol and scrap, timber / forest produce rate in 2026-27, and every form name and number for tax years from 2026-27.
