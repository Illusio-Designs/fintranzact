# Sandbox.co.in integration

E-invoice, e-way bill, GSTIN lookup, TDS/TCS and GST returns go through Sandbox.co.in. Customers are charged per successfully filed document.

## Architecture

- `packages/api/src/lib/sandbox/` holds the gateway client (`client.ts`) and the adapters `e-invoice.ts`, `e-way-bill.ts` and `gst-returns.ts`, plus `tds.ts` (PAN and TAN lookups only) and `hsn.ts` (HSN / SAC lookup).
- `lib/gov-provider.ts` is the provider switch. With `SANDBOX_API_KEY` / `SANDBOX_API_SECRET` set, `createIRPClient` and `createEWBClient` return Sandbox-backed clients that match the direct NIC client interface (`IRPClientLike`, `EWBClientLike`), so routers do not care which is active. Without keys the direct NIC client is used. `GOV_API_PROVIDER=direct` forces direct (rollback), `sandbox` forces Sandbox. Under `NODE_ENV=test` keys alone never select Sandbox; tests set `GOV_API_PROVIDER=sandbox`.
- Each business still stores its own portal API login (username, password, GSTIN), encrypted. GST returns use a per-GSTIN session obtained with an OTP from the GST portal, cached in memory only.

## Metering and billing flow

1. Every successful document writes one `gov_api_usage` row per tenant (e-invoice, e-way bill, GSTR-1 filed, GSTR-3B filed). Failed calls are never recorded. A unique (tenant, kind, reference) index makes retries charge once.
2. Prices come from `GOV_RATE_*_PAISE` (defaults: e-invoice 200, e-way bill 200, GSTR-1 0, GSTR-3B 0 paise, before GST). GST is added on the total.
3. After the month ends, a statement is raised per tenant for unbilled usage (billing payment with provider `usage`), stamping the usage rows. No advance is taken.
4. Owners see this month, past months and statements in Settings, Billing, under Government filing usage (`govUsage.summary`, `govUsage.statements`).

## Quota alerts

`sandbox_call_counters` counts every successful (2xx) gateway call across the deployment per IST month. With `SANDBOX_MONTHLY_QUOTA` set, an alert is logged and stored as a billing event (`sandbox.quota`) at 80% and 100%. If Sandbox rejects a call for wallet or quota reasons (HTTP 402 or matching message), `sandbox.wallet_or_quota_blocked` is raised at most hourly. Metering never blocks filing.

CA checklist for TDS/TCS rules: [`TDS-CA-VERIFICATION.md`](TDS-CA-VERIFICATION.md).

## Verify with Sandbox before go-live

- Which APIs are charged to the wallet (outside the plan) and the per-call price.
- Behaviour past the monthly plan quota: blocked, throttled, or overage-billed.
- Whether GST is charged on the plan price (for input credit and pricing).
- TCS 27EQ filing support.
- ASP / partner plan: whether reselling to our customers needs one.
- GST returns endpoint paths in `packages/api/src/lib/sandbox/gst-returns.ts` are from memory. Verify paths and request/response shapes on the test environment (`test-api.sandbox.co.in`) before use.
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
