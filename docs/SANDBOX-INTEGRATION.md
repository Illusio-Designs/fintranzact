# Sandbox.co.in integration

E-invoice, e-way bill, GSTIN lookup, TDS/TCS and GST returns go through Sandbox.co.in. Customers are charged per successfully filed document.

## Architecture

- `packages/api/src/lib/sandbox/` holds the gateway client (`client.ts`) and the adapters `e-invoice.ts`, `e-way-bill.ts` and `gst-returns.ts`.
- `lib/gov-provider.ts` is the provider switch. With `SANDBOX_API_KEY` / `SANDBOX_API_SECRET` set, `createIRPClient` and `createEWBClient` return Sandbox-backed clients that match the direct NIC client interface (`IRPClientLike`, `EWBClientLike`), so routers do not care which is active. Without keys the direct NIC client is used. `GOV_API_PROVIDER=direct` forces direct (rollback), `sandbox` forces Sandbox. Under `NODE_ENV=test` keys alone never select Sandbox; tests set `GOV_API_PROVIDER=sandbox`.
- Each business still stores its own portal API login (username, password, GSTIN), encrypted. GST returns use a per-GSTIN session obtained with an OTP from the GST portal, cached in memory only.

## Metering and billing flow

1. Every successful document writes one `gov_api_usage` row per tenant (e-invoice, e-way bill, GSTR-1 filed, GSTR-3B filed). Failed calls are never recorded. A unique (tenant, kind, reference) index makes retries charge once.
2. Prices come from `GOV_RATE_*_PAISE` (defaults: e-invoice 200, e-way bill 200, GSTR-1 0, GSTR-3B 0 paise, before GST). GST is added on the total.
3. After the month ends, a statement is raised per tenant for unbilled usage (billing payment with provider `usage`), stamping the usage rows. No advance is taken.
4. Owners see this month, past months and statements in Settings, Billing, under Government filing usage (`govUsage.summary`, `govUsage.statements`).

## Quota alerts

`sandbox_call_counters` counts every successful (2xx) gateway call across the deployment per IST month. With `SANDBOX_MONTHLY_QUOTA` set, an alert is logged and stored as a billing event (`sandbox.quota`) at 80% and 100%. If Sandbox rejects a call for wallet or quota reasons (HTTP 402 or matching message), `sandbox.wallet_or_quota_blocked` is raised at most hourly. Metering never blocks filing.

## Verify with Sandbox before go-live

- Which APIs are charged to the wallet (outside the plan) and the per-call price.
- Behaviour past the monthly plan quota: blocked, throttled, or overage-billed.
- Whether GST is charged on the plan price (for input credit and pricing).
- TCS 27EQ filing support.
- ASP / partner plan: whether reselling to our customers needs one.
- GST returns endpoint paths in `packages/api/src/lib/sandbox/gst-returns.ts` are from memory. Verify paths and request/response shapes on the test environment (`test-api.sandbox.co.in`) before use.
