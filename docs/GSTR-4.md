# GSTR-4 and CMP-08: CA verification checklist

CMP-08 (quarterly) and GSTR-4 (annual) for composition taxpayers compute from **settings-driven, year-versioned defaults**, not from hard-wired constants. The values below are researched from **secondary sources only** (see the end) and last reviewed **2026-10-02**. They are not legal advice and nothing has been checked against the GST portal or the notifications. The CA must confirm each one before every financial year and before filing.

Code: `packages/shared/src/composition.ts` (defaults, resolution, late fee, dates), `packages/api/src/lib/cmp08.ts`, `lib/gstr4.ts`, `lib/gstr4-json.ts`. Procedures: `gst.cmp08`, `gst.cmp08Year`, `gst.gstr4`, `gst.gstr4Json`, `gst.compositionSettings`, `gst.updateCompositionSettings`. Pages: GST page, CMP-08 and GSTR-4 tabs (settings card on both).

## 1. Settings and resolution order

Every compliance value resolves the same way, everywhere (`resolveCompositionSettings`):

> business financial-year override (`composition_settings` row) -> built-in versioned default (`COMPOSITION_DEFAULTS`)

Changing a setting changes CMP-08 and GSTR-4 output at once (nothing is cached or stored in the figures). The card and `gst.compositionSettings` show, for each value, the effective value, the default, whether it is `default` or `override`, the defaults' `lastReviewed` date and their source notes.

| Value | Built-in default | Per-business-year override column |
|---|---|---|
| Rate % of turnover | manufacturer_trader 1, restaurant 5, other_service 6 | `rate` |
| CMP-08 due day | 18 (month after the quarter) | `cmp08_due_day` (1-28) |
| GSTR-4 due date | 30 June after the FY (FY 2024-25 onward); 30 April for earlier years | `gstr4_due_date` |
| Interest % a year | 18, simple | `interest_rate` |
| GSTR-4 late fee per day | 50 (25 CGST + 25 SGST) | `late_fee_per_day` |
| GSTR-4 late fee cap | 2,000 | `late_fee_cap` |
| Nil-return late fee per day | 20 | `late_fee_nil_per_day` |
| Nil-return late fee cap | 500 | `late_fee_nil_cap` |

A null override column means "follow the default". The category itself is `composition_settings.category`. Saving is admin-only (`Business:update`) and audited as `gst.updateCompositionSettings` (metadata carries every override). A value equal to the default is saved as null so it follows the default again.

- [ ] Confirm each value for the financial year. Mixed businesses (goods and services): the app applies the one category the business picks to all turnover; the CA decides which category and rate apply.
- [ ] Exempt supplies and the 10% / 0.5% rules for services within the manufacturer/trader category are not modelled.
- [ ] A composition dealer makes no inter-state outward supply: central and state tax are an even split; integrated tax on outward supplies is `0.00`.

## 2. Due dates, interest and late fee

| Item | Rule | Verify |
|---|---|---|
| CMP-08 Q1 / Q2 / Q3 / **Q4** | 18 Jul / 18 Oct / 18 Jan / **18 Apr**. CMP-08 is filed for **all four quarters**, Jan-Mar included | extensions |
| GSTR-4 | **30 June** after the FY since FY 2024-25 (CGST Notification 12/2024, 10 Jul 2024); 30 April before. Some sites still print 30 April | extended often: use the override |
| Interest on late tax | 18% a year, simple, from the day after the due date (`compositionInterest`) | rate and basis |
| GSTR-4 late fee | 50 a day (25 + 25) up to 2,000; nil return 20 a day up to 500 (`gstr4LateFee`) | **unconfirmed**: one source quoted 200 a day up to 5,000 for the FY 2019-20 portal text; keep these editable |

- [ ] Interest on CMP-08 is worked out only when `paidOn` is given to `gst.cmp08`; the web CMP-08 tab does not send it, so it says the payment date is unknown.
- [ ] GSTR-4: enter **Filed / paid on** (`filedOn` on `gst.gstr4`) to get interest on the balance and the late fee. Without it both are `0.00` and the page says "Enter filing date".
- [ ] Interest on the GSTR-4 balance runs from the **GSTR-4 due date** to the filing date. Strictly, unpaid tax is late from its own CMP-08 due date: approximation.
- [ ] A "nil return" is taken as no outward turnover and no tax payable (including reverse charge) for the year.

## 3. Payments are not tracked

The app has no record of CMP-08 payments. `gst.gstr4` takes `cmp08Paid` for **Q1-Q4**; a quarter left out is **assumed paid in full** and `paidAssumed` is true (the page shows an "assumed paid" warning).

- [ ] Compare the "paid through CMP-08" figure with the challans and the cash ledger.
- [ ] Balance payable = total payable less paid. Overpayment is shown as `excessPaid`, not refunded or carried.

## 4. GSTR-4 tables as built (best effort)

Layout as understood from secondary sources for the annual GSTR-4 (FY 2019-20 onward). **Exact row numbers and JSON keys remain best effort and must be verified against the GST offline tool.**

| Table | Content | Source in the app |
|---|---|---|
| 4 | Inward supplies: 4A registered non-RCM, 4B registered RCM, 4C unregistered, 4D import of services | purchase documents of the year (`report.inward`) |
| 5 | Summary of self-assessed liability per CMP-08, four quarters | the four CMP-08 quarters (`report.cmp08Summary`) |
| 6 | Tax rate-wise: inward (reverse charge) and outward supplies | CMP-08 figures (`report.rateWise.outward`, `.inwardRcm`) |
| 7 | TDS / TCS credit received | none: `0.00` with a note (`report.tdsTcs`) |
| 8 | Tax, interest and late fee payable / paid | `report.taxPaid` |

Table 4 row mapping:

| App row (`kind`) | Code in the JSON | Rule |
|---|---|---|
| registered_non_rcm | 4A | Supplier has a GSTIN or type regular/composition/sez/uin, not flagged reverse charge. Only taxable value shown |
| registered_rcm | 4B | Registered supplier, document flagged reverse charge. Tax by head shown |
| unregistered_rcm | 4C | Unregistered supplier, flagged reverse charge. Tax shown |
| unregistered_non_rcm | 4C | Unregistered, not flagged. Tax zero: the app does not apply s.9(4) by itself |
| import_of_services | 4D | Supplier type "overseas". Goods and services are not told apart |

- [ ] Purchases from a composition supplier (bill of supply) are shown under registered; the form may want a separate exempt/nil row.
- [ ] Credit/debit notes and purchase returns reduce their row. Intra-state RCM tax is split evenly; inter-state and imports go to integrated tax.
- [ ] Exempt, nil-rated, non-GST outward supplies, cess and TDS/TCS credit are not tracked: always zero.

## 5. JSON export: best-effort keys

`gst.gstr4Json` returns `{ filename, json }` (`GSTR4_FY2026_27_portal.json`). **It has not been validated against the GST offline tool or portal schema.** Every name that is a guess sits in one block, `GSTR4_PORTAL_KEYS` in `packages/api/src/lib/gstr4-json.ts`, marked "VERIFY against the GST offline tool / portal schema before upload".

| Part | Status |
|---|---|
| `gstin`, `fy` header | Believed right (standard on portal JSON) |
| amount keys `txval`, `iamt`, `camt`, `samt`, `csamt`, `rt` | Standard portal amount keys; believed right |
| Section keys `table4` ... `table8` and row codes `4A`-`4D` | **Best effort** (numbering from secondary sources) |
| Quarter keys `qtrs` / `qtr`, `tax`, `rcm_tax`, `tot_tax`, `exempt`, `nil`, `non_gst`, `inward_rcm`, `tds`, `tcs` | **Guessed** |
| Tax-paid keys `cmp_tax`, `rcm_tax`, `tot_tax`, `paid_cmp08`, `bal_pay`, `excess_paid`, `intr`, `lfee` | **Guessed**; the portal may not take a tax-paid section in the file at all |
| Period format, file hash, amendments table | Not included |

- [ ] Download the sample JSON from the GST offline tool for GSTR-4, compare keys and nesting, and fix `GSTR4_PORTAL_KEYS` (and `gstr4ToPortalJson` if the nesting differs).
- [ ] Upload a test file to the offline tool before telling customers it works. Until then, treat the file as a reference for keying figures in.

## 6. How to update yearly (runbook)

**Admin (no deploy), per business, per financial year.** GST page -> CMP-08 or GSTR-4 tab -> settings card for the year:

1. Pick the composition **category** (sets the rate).
2. Edit **Rate**, **CMP-08 due day**, **GSTR-4 due date** (e.g. a notified extension), **Interest**, **late fee per day / cap** and **nil return late fee per day / cap** as the CA advises. Each shows Default or Overridden and the default beside it.
3. **Reset** an overridden value to follow the built-in default again; **Save**.
4. CMP-08 and GSTR-4 recompute at once. Re-check the due dates and fees shown there.

**Developer (new built-in defaults for everybody).** In `packages/shared/src/composition.ts`, add an entry to `COMPOSITION_DEFAULTS` with `effectiveFromFy` set to the first year it applies. **Do not edit an old entry**: earlier years must keep computing as before. Fill categories/rates, `cmp08` (due day and months per quarter), `gstr4` (due month and day), `interestRatePercent`, `lateFee`, and `meta` (`sourceNotes`, `lastReviewed`, `verifyWithCA: true`). Add a unit test in `packages/shared/src/__tests__/composition.test.ts` and update this document and the help article. A new override field needs a `composition_settings` column (tenant migration plus the unified one, as `0033` / `0049`), the row schema in `selfExport/rowSchemas.ts`, the data-audit rule in `data-audit/rules/money.ts`, and `resolveCompositionSettings`.

## Sources consulted (secondary; verify with CA)

- https://busy.in/guide-to-gstr-4 (busy.in guide-to-gstr-4)
- Taxscan, GSTR-4 vs CMP-08 for 2025-26 (taxscan.in)
- https://cleartax.in/s/gstr4 (cleartax gstr4 page)
- https://tutorial.gst.gov.in GSTR-4 annual, manual (tutorial.gst.gov.in)
- https://caportal.saginfotech.com/gstr-4-due-dates (caportal.saginfotech.com gstr-4-due-dates)

Primary sites (gst.gov.in, the notifications) could not be reached when this was written: the GSTR-4 June due date (CGST Notification 12/2024), CMP-08 for all four quarters, the late-fee amounts and the table numbering are all unconfirmed against the official text.
