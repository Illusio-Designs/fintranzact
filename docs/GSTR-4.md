# GSTR-4 and CMP-08: CA verification checklist

CMP-08 (quarterly) and GSTR-4 (annual) for composition taxpayers compute from rules in code. The rates and dates below are **defaults**, read from the source, not legal advice. The CA must confirm each one before every financial year and before filing. Nothing here has been checked against the GST portal.

Code: `packages/shared/src/composition.ts` (rates, dates), `packages/api/src/lib/cmp08.ts`, `lib/gstr4.ts`, `lib/gstr4-json.ts`. Procedures: `gst.cmp08`, `gst.cmp08Year`, `gst.gstr4`, `gst.gstr4Json`, `gst.compositionSettings`, `gst.updateCompositionSettings`. Pages: GST page, CMP-08 and GSTR-4 tabs.

## 1. Composition rates (`defaultCompositionRules`)

| Category code | Rate % of turnover | Split |
|---|---|---|
| manufacturer_trader (default) | 1 | central 0.5 + state 0.5 |
| restaurant (not serving alcohol) | 5 | 2.5 + 2.5 |
| other_service | 6 | 3 + 3 |

- [ ] Confirm each rate for the financial year. A business can override the rate per year (`composition_settings.rate`); `defaultCompositionRules` ignores the year argument, so the same defaults apply to every year.
- [ ] Mixed businesses (goods and services): the app applies the one category the business picks to all turnover. The CA decides which category and rate apply.
- [ ] Exempt supplies and supplies of services in the manufacturer/trader category (the 10% / 0.5% rules) are not modelled.
- [ ] A composition dealer makes no inter-state outward supply: central and state tax are always an even split; integrated tax on outward supplies is `0.00`.

## 2. Due dates and interest

| Item | Rule in code | Verify |
|---|---|---|
| CMP-08 Q1 / Q2 / Q3 | 18 Jul / 18 Oct / 18 Jan | extensions |
| CMP-08 Q4 (Jan-Mar) | none: tax goes in GSTR-4 (`cmp08Applicable: false`) | |
| GSTR-4 | 30 April after the financial year (`gstr4DueDate`) | extended often |
| Interest on late tax | 18% a year, simple, from the day after the due date (`COMPOSITION_INTEREST_RATE_PERCENT`) | rate and basis |
| GSTR-4 late fee | **not computed** (shown as 0.00 with a note) | CA calculates |

- [ ] Interest is worked out only when a payment date (`paidOn`) is given to `gst.cmp08`. The web page never sends it, so it shows no interest and says the payment date is unknown.
- [ ] Interest on the GSTR-4 balance paid after 30 April is not computed.

## 3. Payments are not tracked

The app has no record of CMP-08 payments. `gst.gstr4` takes `cmp08Paid` for Q1-Q3; a quarter left out is **assumed paid in full** and `paidAssumed` is true (the page shows an "assumed paid" warning).

- [ ] Compare the "paid through CMP-08" figure with the challans and the cash ledger.
- [ ] Balance payable = total payable less paid. Overpayment is shown as `excessPaid`, not refunded or carried.

## 4. Table 4 row mapping (inward supplies)

Rows follow the post-2021 form numbering as understood when written. **Confirm the numbering and row meanings against the current GSTR-4 form.**

| App row (`kind`) | Table 4 code in the JSON | Rule |
|---|---|---|
| registered_non_rcm | 4A | Supplier has a GSTIN or type regular/composition/sez/uin, not flagged reverse charge. Only taxable value shown; supplier's tax is no liability here |
| registered_rcm | 4B | Registered supplier, document flagged reverse charge. Tax by head shown |
| unregistered_rcm | 4C | Unregistered supplier, flagged reverse charge. Tax shown |
| unregistered_non_rcm | 4C | Unregistered supplier, not flagged. Tax shown as zero: the app does not apply s.9(4) by itself |
| import_of_services | 4D | Supplier registration type "overseas". Goods and services are not told apart |

- [ ] Purchases from a composition supplier (bill of supply) are shown under registered; the form may want a separate exempt/nil row.
- [ ] Credit/debit notes and purchase returns reduce the row they belong to.
- [ ] Intra-state RCM tax is split evenly into central and state; inter-state and imports go to integrated tax.
- [ ] Table 5 (turnover by quarter) and Table 6 (tax by rate) come straight from CMP-08 figures, so they cannot differ from them. Exempt, nil-rated, non-GST outward supplies and cess are not tracked: always zero.

## 5. JSON export: best-effort keys

`gst.gstr4Json` returns `{ filename, json }` (`GSTR4_FY2026_27_portal.json`). **It has not been validated against the GST offline tool or portal schema.** Every name that is a guess sits in one block, `GSTR4_PORTAL_KEYS` in `packages/api/src/lib/gstr4-json.ts`, marked "VERIFY against the GST offline tool / portal schema before upload".

| Part | Status |
|---|---|
| `gstin`, `fy` header | Believed right (standard on portal JSON) |
| amount keys `txval`, `iamt`, `camt`, `samt`, `csamt`, `rt` | Standard portal amount keys; believed right |
| Table keys `table4`, `table5`, `table6`, `table7` and row codes `4A`-`4D` | **Guessed** |
| Quarter keys `qtrs` / `qtr`, `tax`, `exempt`, `nil`, `non_gst` | **Guessed** |
| Tax-paid keys `cmp_tax`, `rcm_tax`, `tot_tax`, `paid_cmp08`, `bal_pay`, `excess_paid`, `intr`, `lfee` | **Guessed**; the portal may not take a tax-paid section in the file at all |
| Period format, file hash, amendments table | Not included |

- [ ] Download the sample JSON template from the GST offline tool for GSTR-4, compare keys and nesting, and fix `GSTR4_PORTAL_KEYS` (and the mapping in `gstr4ToPortalJson` if the nesting differs).
- [ ] Upload a test file to the offline tool before telling customers it works. Until then, treat the file as a reference for keying figures in.

## 6. Settings

- Category and rate are per business per financial year (`composition_settings`), edited on the GST page's CMP-08 and GSTR-4 tabs (admin only, audited as `gst.updateCompositionSettings`). Until saved, manufacturer_trader at 1% applies.
- [ ] Each new financial year: confirm the category, the rate and these dates, and save the category for the year.
