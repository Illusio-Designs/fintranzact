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

When an item is saved with an HSN / SAC code (new, or changed), `lib/hsn-lookup.ts` looks the code up on Sandbox, only when Sandbox is the provider and its keys are in the environment. It never blocks the save: on a timeout (2.5 s), outage, 5xx or missing keys it uses the bundled CBIC list and reports `source: "bundled"` with `sandboxStatus` `unavailable` or `not_configured`. A code Sandbox does not list but the bundled list has returns the bundled answer with a warning (`sandboxStatus: "not_found"`). Codes the bundled list rejects are still refused as before; Sandbox adds information only (`hsnCheck` on `item.create` and `item.update`, plus extra fields on `hsn.validate`). Results are cached in memory (24 h found, 60 s not found or failed), concurrent lookups share one call, and a per-process guard caps calls at 60 a minute. Lookups are not billed to customers; they count against the plan through the client meter. `HSN_SANDBOX_LOOKUP=off` and `HSN_LOOKUP_TIMEOUT_MS` are the only knobs; keys stay in the environment.

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
