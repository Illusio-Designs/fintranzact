# Sandbox.co.in integration

E-invoice, e-way bill, GSTIN lookup, TDS/TCS and GST returns go through Sandbox.co.in. Customers are charged per successfully filed document.

## Architecture

- `packages/api/src/lib/sandbox/` holds the gateway client (`client.ts`) and the adapters `e-invoice.ts`, `e-way-bill.ts` and `gst-returns.ts`, plus `tds.ts` (PAN and TAN lookups only) and `hsn.ts` (HSN / SAC lookup).
- `lib/gov-provider.ts` is the provider switch. With `SANDBOX_API_KEY` / `SANDBOX_API_SECRET` set, `createIRPClient` and `createEWBClient` return Sandbox-backed clients that match the direct NIC client interface (`IRPClientLike`, `EWBClientLike`), so routers do not care which is active. Without keys the direct NIC client is used. `GOV_API_PROVIDER=direct` forces direct (rollback), `sandbox` forces Sandbox. Under `NODE_ENV=test` keys alone never select Sandbox; tests set `GOV_API_PROVIDER=sandbox`.
- Each business still stores its own portal API login (username, password, GSTIN), encrypted. GST returns use a per-GSTIN taxpayer session obtained with an OTP from the GST portal, cached in memory only (valid 6 hours).

## Metering and billing flow

1. Every successful document writes one `gov_api_usage` row per tenant (e-invoice, e-way bill, GSTR-1 filed, GSTR-3B filed). Failed calls are never recorded. A unique (tenant, kind, reference) index makes retries charge once.
2. Prices come from `GOV_RATE_*_PAISE` (defaults: e-invoice 200, e-way bill 200, GSTR-1 0, GSTR-3B 0 paise, before GST). GST is added on the total.
3. After the month ends, a statement is raised per tenant for unbilled usage (billing payment with provider `usage`), stamping the usage rows. No advance is taken.
4. Owners see this month, past months and statements in Settings, Billing, under Government filing usage (`govUsage.summary`, `govUsage.statements`).

## Quota alerts

`sandbox_call_counters` counts every successful (2xx) gateway call across the deployment per IST month. With `SANDBOX_MONTHLY_QUOTA` set, an alert is logged and stored as a billing event (`sandbox.quota`) at 80% and 100%. If Sandbox rejects a call for wallet or quota reasons (HTTP 402 or matching message), `sandbox.wallet_or_quota_blocked` is raised at most hourly. Metering never blocks filing.

## GST returns filing (official Sandbox recipes)

Code: `lib/sandbox/gst-returns.ts` (HTTP calls), `lib/gst-return-flow.ts` (state machine, polling schedule, guards), `lib/gst-filing.ts` (orchestration), `lib/gst-3b-offset.ts` (set-off proposal), `routers/gstReturns.ts` (procedures). Base URL `https://api.sandbox.co.in` (test: `https://test-api.sandbox.co.in`). Every taxpayer call sends `authorization: <taxpayer token>` (the token itself, no "Bearer"), `x-api-key`, `x-api-version: 1.0.0` and `Content-Type: application/json`.

Prerequisites: all earlier period returns are filed; for GSTR-3B, GSTR-1 of the same period is filed and 3B agrees with GSTR-1, and the cash and credit ledgers cover the tax. The taxpayer token is valid 6 hours and must stay valid through the whole filing. The app shows this text with the filing steps. It checks one prerequisite itself: GSTR-3B is refused while our own record shows GSTR-1 of the same period started but not filed. A return filed outside the app is not visible to us, so no record means a warning, not a block.

### GSTR-1 (6 steps)

| Step | Procedure | Request |
|---|---|---|
| 1 Session | `verifyOtp` | taxpayer session (see VERIFY) |
| 2 Save | `saveGstr1` | `POST /gst/compliance/tax-payer/gstrs/gstr-1/{YYYY}/{MM}` body `{fp, gstin, gt, cur_gt, b2b, b2ba, b2cl, b2cla, cdnr, cdnra, b2cs, b2csa, exp, expa, hsn, nil, txpd, txpda, at, ata, doc_issue, cdnur, cdnura}` -> `reference_id` |
| poll | `pollReturnStatus` | GST Return Status by `reference_id` |
| 3 Proceed | `proceedGstr1` | `POST .../gstr-1/{YYYY}/{MM}/new-proceed?is_nil=N` body `{gstin, ret_period}` -> `reference_id` |
| poll | `pollReturnStatus` | |
| 4 Summary | `fetchGstr1Summary` | `GET .../gstr-1/{YYYY}/{MM}?summary_type=long`; `sec_sum` and `chksum` are stored with the attempt |
| 5 EVC OTP | `requestEvcOtp` | `POST /gst/compliance/tax-payer/evc/otp?gstr=gstr-1` body `{pan}` |
| 6 File | `fileGstr1` | `POST .../gstr-1/{YYYY}/{MM}/file?pan={PAN}&otp={OTP}` body `{ret_period, newSumFlag: true, sec_sum, gstin, chksum}` |

`gt` and `cur_gt` (gross turnover) are required inputs of `saveGstr1`; the app does not derive them. Sections the app holds no data for (`exp`, `at`, `txpd`, `doc_issue` and the amendment sections) are sent empty. `fp` and `ret_period` are `MMYYYY` built from the same period as the URL's `{YYYY}/{MM}`.

### Nil GSTR-1 (no save, no summary)

`proceedGstr1` with `nil: true` (`new-proceed?is_nil=Y`), poll, `requestEvcOtp`, `fileGstr1` with body `{ret_period, gstin, isnil: "Y"}` (no `sec_sum`, `chksum` or `newSumFlag`).

### GSTR-3B (8 steps)

| Step | Procedure | Request |
|---|---|---|
| 1 Session | `verifyOtp` | |
| 2 Existing details | (inside `saveGstr3b`) | `GET /gst/compliance/tax-payer/gstrs/gstr-3b/{YYYY}/{MM}` |
| 3 Save | `saveGstr3b` | `POST` same URL, body `{ret_period, gstin, sup_details, itc_elg}` -> `reference_id`; poll |
| 4 Ledgers | `checkLedgerGstr3b` | `GET /gst/compliance/tax-payer/ledgers/bal/{YYYY}/{MM}`; the app then PROPOSES the set-off, nothing is posted |
| 5 Offset | `postOffsetGstr3b` | `POST .../gstr-3b/{YYYY}/{MM}/offset-liability` body `{pdcash, pditc}` -> `reference_id`; only with `confirm: true` and the `proposalKey` the user was shown; poll |
| 6 Updated details | `fetchGstr3bDetails` | same GET as step 2; `tx_pmt` is required |
| 7 EVC OTP | `requestEvcOtp` | `...evc/otp?gstr=gstr-3b` body `{pan}` |
| 8 File | `fileGstr3b` | `POST .../gstr-3b/{YYYY}/{MM}/file?pan=&otp=` body `{ret_period, gstin, sup_details, tx_pmt, itc_elg, ...}` taken from step 6 |

Nil GSTR-3B has 3 steps: `requestEvcOtp` with `nil: true`, then `fileGstr3b` with body `{ret_period, gstin, isNil: "Y"}`. Casing differs between the two nil recipes and is copied literally: GSTR-1 `isnil`, GSTR-3B `isNil` (constants `GSTR1_NIL_FLAG`, `GSTR3B_NIL_FLAG`, with a test that fails if they are swapped).

Money rules for steps 4-5: the split is never decided silently. `proposeOffset` (pure, table-tested) uses IGST credit against IGST, CGST, SGST in that order; CGST credit against CGST then IGST; SGST credit against SGST then IGST; cash for the rest, head by head; reverse-charge tax, interest and late fee in cash only. It is limited by the ledger balances. The user sees the proposal with the balances and must confirm it; a changed proposal needs a new confirmation; a cash shortfall blocks the post. Interest and late fee are not calculated by the app (add them on the portal). CA sign-off: [`GST-RETURNS-CA-VERIFICATION.md`](GST-RETURNS-CA-VERIFICATION.md).

### Nil return guards

Nil is never selected automatically and needs an explicit confirmation ("no outward supplies in the period" for GSTR-1, "no transactions in the period" for GSTR-3B). It is refused with the reason when our books have data: for GSTR-1 any invoice, note, supply row or tax; for GSTR-3B any taxable, zero-rated, exempt or reverse-charge value, inter-state supplies to unregistered persons, ITC, tax payable or net tax. The app keeps no exports, advances or interest, so for those the confirmation is the only guard. A nil 3B is also refused while our record shows GSTR-1 of the period started but not filed.

### State machine and persistence

GSTR-1: `draft -> saved -> save_validated | save_errors -> proceeding -> ready_to_file | proceed_errors -> summary_fetched -> otp_requested -> filed | failed`. Nil: `draft -> proceeding -> ready_to_file -> otp_requested -> filed | failed`.

GSTR-3B: `draft -> saved -> save_validated | save_errors -> ledger_checked -> offset_confirmed -> offset_posted -> offset_validated | offset_errors -> details_fetched -> otp_requested -> filed | failed`. Nil: `draft -> otp_requested -> filed | failed`.

Validation errors (`save_errors`, `proceed_errors`) show the portal's messages and block the next step until the data is saved again. Every step checks its starting state, so a repeated call is harmless: a second `proceedGstr1` while proceeding returns the stored `reference_id` without calling out; a stored summary or details are not fetched again; a crash between a Sandbox call and its journal write leaves the previous state, and the step is simply run again. A wrong OTP moves to `failed` (message kept); request a new OTP and file again. A timeout while filing keeps the step (the portal may or may not have filed: check the return status before retrying).

State is kept without a new table: one row per transition in `audit_log` (action `gstReturns.attempt.<gstr1|gstr3b>.<MMYYYY>`, entity `gst_return_attempt`, newest row wins). Rows hold reference ids, `sec_sum` / `chksum`, the 3B details with `tx_pmt` and the proposed set-off. They never hold the taxpayer token or an OTP, and they are hidden from `business.auditTrail`. Neither the OTP, the token nor `chksum` is logged (covered by a logger-spy test).

### Status polling

`pollReturnStatus` checks the GST Return Status of the last save / proceed / offset `reference_id`. Client-driven: the UI calls it repeatedly and uses `retryAfterMs`. The server never calls the portal more often than every 12 s (floor 10 s), whatever the client does, and reports `timeout` after 3 minutes (call again with `restart: true` to open a new window). No request is held open and no transaction spans a poll.

### Taxpayer session

The token is cached in memory per GSTIN with a 10-minute margin inside the 6 hours, and dropped on 401/403. `SandboxGstReturnsClient` accepts an optional `reauth` hook that is run once on a rejected token and the call retried; the router does not pass one because creating a session needs an OTP from the user. The persisted state means the flow resumes from the same step after signing in again.

### Still unverified (marked `VERIFY` in code)

- GST Return Status: exact URL, query and response shape. Assumed `GET .../gstrs/{YYYY}/{MM}/status?reference_id=` and GSTN codes `P`, `PE`, `ER`, `IP` (`GST_RETURNS_PATHS.returnStatus`, `interpretReturnStatus`). Docs path: `api-reference/gst/compliance/endpoints/taxpayer/common/gst_return_status`.
- Generate Taxpayer Session: endpoint details (`requestOtp` / `verifyOtp` paths are assumed).
- Whether `fp` is `MMYYYY`: the recipe's save example mixes URL `2023/12` with `fp` `112023`. We send `MMYYYY` of the URL's period.
- Error body shapes, and whether `reference_id` is the exact response key.
- Inner shapes of `hsn`, `nil`, `doc_issue` when empty; inner shapes of the 3B sections, `pdcash`, `pditc` (we use the GSTN names `ipd/cpd/spd` and `i_pdi...cs_pdcs`, with `liab_ldg_id` and `trans_typ` only if known) and of the ledger response (`parseLedgerBalances` refuses to guess).
- Whether a repeated `offset-liability` call is safe (resume from `offset_confirmed` re-posts).
- Whether the EVC PAN is the registration PAN or the authorised signatory's (default: explicit input, business PAN, then GSTIN characters 3-12).
- Whether a nil 3B needs a status check after filing (the recipe shows none), and the success response shape.
- Per-call charges of these APIs. None of this has been run against a live Sandbox test account.

CA checklist for TDS/TCS rules: [`TDS-CA-VERIFICATION.md`](TDS-CA-VERIFICATION.md).

## Verify with Sandbox before go-live

- Which APIs are charged to the wallet (outside the plan) and the per-call price.
- Behaviour past the monthly plan quota: blocked, throttled, or overage-billed.
- Whether GST is charged on the plan price (for input credit and pricing).
- TCS 27EQ filing support.
- ASP / partner plan: whether reselling to our customers needs one.
- GSTR-1, nil GSTR-1, GSTR-3B and nil GSTR-3B follow Sandbox's official recipes (see "GST returns filing" below). Not yet run against a live Sandbox test account. What is still unverified is listed in that section.
- GSTR-2B download path (`GST_RETURNS_PATHS.gstr2b`) is still from memory (no recipe yet).
- PAN and TAN lookup paths and response fields in `packages/api/src/lib/sandbox/tds.ts` (`TDS_API_PATHS`, `unwrapPan`, `unwrapTan`) are from memory; verify on the test environment. These calls are counted by the client meter against the plan and are not billed to customers.
- Whether PAN verification needs consent/reason fields and whether name and date-of-birth matching are charged separately.
- HSN / SAC lookup (`packages/api/src/lib/sandbox/hsn.ts`) is from memory; verify on the test environment. Every assumed item is marked `// VERIFY against Sandbox docs`:
  - Path: `GET /gst/hsn-sac/{code}` (`HSN_API_PATHS.lookup`), API-token auth only.
  - 404 means "code not found"; other 4xx are treated as a failed lookup.
  - Response `data` as one object, a list of matches, or wrapped under `hsn` / `sac` / `result` / `details`.
  - Code: `hsn_code` / `sac_code` / `code` / `hsn` / `sac` / `hsn_sac`. Description: `description` / `desc` / `description_of_goods` / `description_of_service` / `name`.
  - Type: `type` / `kind` / `category` ("HSN", "SAC", "goods", "services"); without it, codes starting 99 are SAC.
  - Rate: `gst_rate` / `rate` / `igst_rate` / `igst` / `tax_rate` (number or "18%").
  - Dates: `effective_from` / `effective_date` / `from_date` / `start_date` and `effective_to` / `valid_till` / `to_date` / `end_date` (ISO or DD/MM/YYYY).
  - Inactive: `active` / `is_active` boolean, `status` text (withdrawn, inactive, expired...), `withdrawn: true`, or an `effective_to` in the past; reason from `reason` / `remarks` / `withdrawn_reason` / `inactive_reason`.
  - Whether HSN lookups are charged to the wallet or only count against the plan.

## HSN / SAC verification

When an item is saved with an HSN / SAC code (new, or changed), `lib/hsn-lookup.ts` looks the code up on Sandbox, only when Sandbox is the provider and its keys are in the environment. It never blocks the save: on a timeout (2.5 s), outage, 5xx or missing keys it uses the bundled CBIC list and reports `source: "bundled"` with `sandboxStatus` `unavailable` or `not_configured`. A code Sandbox does not list but the bundled list has returns the bundled answer with a warning (`sandboxStatus: "not_found"`). Codes the bundled list rejects are still refused as before; Sandbox adds information only (`hsnCheck` on `item.create` and `item.update`, plus extra fields on `hsn.validate`). Results are cached in memory (24 h found, 60 s not found or failed), concurrent lookups share one call, and a per-process guard caps calls at 60 a minute. Lookups are not billed to customers; they count against the plan through the client meter. Keys stay in the environment.

### Resolver layers

`resolveHsn` answers from three layers, in order:

1. **Live Sandbox** (`source: "sandbox"`): the lookup above.
2. **Refreshed table** (`source: "refreshed"`): the control-DB table `hsn_sandbox_codes`, filled by the daily refresh. Used only when Sandbox is down, timed out, rate-guarded or not configured, and only when the row is under 30 days old (`HSN_REFRESHED_MAX_AGE_MS`). A Sandbox "not found" never falls through to it. `sandboxStatus` still says why the live check did not answer (`unavailable` or `not_configured`).
3. **Bundled CBIC list** (`source: "bundled"`): always available; also the only list that decides whether a code is accepted on an item save.

The details card in the web item form shows the source (Sandbox description, rate and dates with a "Verified with Sandbox" label, or "From the official CBIC list" with a muted "Live check unavailable" line) and the advisory `warning` in amber. After a save, `hsnCheck.warning` is shown as a toast on web and an alert on mobile. Nothing here blocks a save.

### Daily refresh

Sandbox is assumed to have no bulk HSN list endpoint, so `lib/hsn-refresh.ts` (`refreshHsnCodes`, started from `server.ts`, checked hourly, runs when the last run is 23 h old) re-verifies the codes items actually use:

- Collects the distinct codes on items across active tenants, takes up to `HSN_REFRESH_BATCH` of them (never checked first, then oldest check first; a code checked in the last 20 h is skipped), looks each up live through the same resolver and adapter (`liveOnly`, so the refreshed layer is not consulted) paced at about 45 a minute inside the resolver's 60 a minute guard, and upserts the answer into `hsn_sandbox_codes` (code, kind, description, rate, active, inactive_reason, effective_from/to, status `ok` or `not_found`, source, checked_at).
- Stops early after 3 failures in a row. Never throws out of the job; idempotent; logs counts only (never codes, keys or answers).
- Skipped silently when Sandbox is not the provider or has no keys, `HSN_SANDBOX_LOOKUP=off`, or `HSN_REFRESH=off`.
- When a code Sandbox calls withdrawn or inactive is still on items, one platform notice is written as a `billing_events` row of type `sandbox.hsn_withdrawn_in_use` (only when the set of codes changes), and the counts and first codes are kept in `system_config` key `hsn_refresh`, returned as `hsnRefresh` by `platform.sandboxQuota` (platform admins). Customers' items are never edited; they see the advisory warning when they save.

Knobs: `HSN_SANDBOX_LOOKUP` (on|off), `HSN_LOOKUP_TIMEOUT_MS`, `HSN_REFRESH` (on|off, default on, effective only with Sandbox configured), `HSN_REFRESH_BATCH` (default 200, max 1000). The migration is `0055_hsn_sandbox_codes` (unified) and `0018_hsn_sandbox_codes` (control).

The VERIFY list above is unchanged: the refresh reuses the same unverified endpoint and field names, so it must be re-checked together with them.

## TDS filing and certificates (not built)

Only PAN/TAN verification is implemented. The app prepares 26Q/27EQ data and generates Form 16A/27D from the books (not TRACES-issued). Before e-filing or TRACES certificate download can be built, confirm with Sandbox:

- Whether 24Q, 26Q, 27Q and **27EQ (TCS)** are supported, and the file/JSON the API expects for each.
- The CSI download and FVU + Form 27A generation flow (job-based: submit, then poll) and the expected input (our challan and deductee data).
- How the deductor authenticates (TAN login, DSC or EVC) and whether a taxpayer session or OTP is needed, as for GST.
- Correction returns, filing status and token number tracking, late-fee computation.
- Form 16/16A/27D download from TRACES: credentials needed and whether it is available at all.
- Pricing per return and per certificate, and how it is metered.
- Income-tax Act 2025 form and section changes from 1 April 2026.

A "Verify PAN" result is advisory: it never blocks saving a party or deducting tax and never changes the s.206AA no-PAN rate (see `TDS-CA-VERIFICATION.md`).
