# Entitlements: plans, trial and billing enforcement (server side)

What an organisation (tenant) may do right now is decided on the server, in one place, and enforced on every API surface. The web and mobile clients only mirror it (banners, disabled buttons); they are never the enforcement.

## States

`deriveAccess` (`packages/shared/src/entitlements.ts`) is a pure function of: tenant status, `tenants.trial_ends_at` (plus `trial_started_at`, `trial_source` and the trial caps, for the `trial` block), the plan subscription row, whether the tenant ever had one, and add-on subscriptions. Rules, in order:

| State | When | Writable |
|---|---|---|
| `suspended` | tenant status is not `active` (admin action) | blocked entirely (`tenant_suspended`) |
| `active` | live plan subscription | yes |
| `past_due_grace` | renewal failed, inside the grace period | yes |
| `halted` | halted subscription, or past_due past grace | read-only (`read_only_halted`) |
| `trialing` | no live subscription and `trial_ends_at` in the future | yes |
| `ended` | no live subscription but one existed before | read-only (`read_only_subscription_ended`) |
| `trial_expired` | no live subscription, trial over | read-only (`read_only_trial_expired`) |
| `grandfathered` | `tenants.access_grandfathered` (the former Forever Free organisations, migrated to Business) | yes, always: no trial, no payment, never read-only (suspended is still blocked) |
| `free` | no billing state at all: never subscribed and no trial (admin-created organisations, test fixtures) | yes |

A grandfathered organisation (`accessGrandfathered`) is checked right after the suspended test and beats everything below it, a halted subscription included; the flag is read fresh with the organisation row, like the plan. It is never set for a new organisation and never offered. A live subscription always beats an expired trial. Read-only means reads, search, PDF downloads and exports still work; creating and editing is refused with the "Choose a plan" message. Add-ons are all off while read-only or suspended; AI Plus also grants AI Assistant.

`getEntitlements(tenantId)` (`lib/entitlements.ts`) loads the snapshot (cached, `invalidateEntitlements` on every billing change, lazy past-due to halted transition) and adds the plan limits. `assertWritable(tenantId)` throws the entitlement error for read-only/suspended; `requireAddon(tenantId, addon)` for add-on features.

## The Full Access Trial (P2)

Operations note: [`TRIAL.md`](TRIAL.md). In short:

- Every new organisation (`auth.register`, `tenant.create`) starts a trial: `trial_started_at`, `trial_ends_at`, `trial_source` (`signup`, `partner`, `admin`, `none`) are written in the same transaction as the tenant (`lib/trial.ts` `decideNewOrgTrial` / `finishNewOrgTrial`). Length: `trial.days` (default 14), `trial.partnerDays` (default 30, for an approved partner code), both 1-90 in `system_config`.
- While `state` is `trialing`, `getEntitlements` returns **the Business plan's limits** whatever plan the organisation picked (`effectivePlan: "business"`), and `addons` has `ai_assistant`, `payroll` and `store_pro` on (AI Plus is the bigger tier of AI Assistant, so the trial grants Assistant). The caps ride in the payload: `trial.caps = { aiQuestions, payrollEmployees, storePro: true }` (from `trial.caps` in `system_config`, default 50 and 10).
- The payload is additive: `trial = { active, ended, startedAt, endsAt, daysLeft, source, caps, totalDays }`. `trialEndsAt` and `trialDaysLeft` are unchanged. `billing.status` adds `trial`, `effectivePlan` and `trialMessage`.
- After `trial_ends_at` with no live plan subscription the organisation is `trial_expired` (read-only): "Your trial has ended. Choose a plan to continue. You can still view, search, download PDFs and export your data." A read-only organisation keeps **data export on every plan** (`limits.dataExport` is forced on while read-only; a Starter organisation could otherwise not export what the banner promises). Buying any plan makes a live subscription, which beats an expired trial; every billing change calls `invalidateEntitlements`, and the organisation row (trial dates and source included) is read fresh on every call, so the unlock is immediate.
- `source = "none"`: no trial was granted (a trial was already used for this email, phone or GSTIN). Stored as started and ended at the same instant, so it derives `trial_expired`; `billing.status.trialMessage` carries the clear message.
- A grandfathered organisation never has a trial (`trial.active` false).
- Caps are **enforced where a hook exists, otherwise exposed only**: no AI, payroll or Store Pro feature exists yet (see `ADDON_FEATURES[...].implemented`), so nothing consumes `trial.caps` today. The future features must read `getEntitlements(tenantId).trial.caps` (AI question counter against `aiQuestions`, employee creation against `payrollEmployees`) while `trial.active`, and `requireAddon` already passes during a trial because the add-ons are on. Plan limits during the trial are enforced (they all read `getEntitlements().limits`).
- **Count limits follow the effective plan.** `limits` is the effective plan's (Business during a trial), so during a trial a Starter organisation (`maxApiKeys` 0) can create and use API keys, add more businesses and team members, and its audit window is unlimited. Every count limit goes through `getEntitlements`: `maxApiKeys` (`enforceApiKeyLimit`, `apiKeyUsable`), `maxBusinesses` (`enforceBusinessLimit` and `business.canCreate`), `maxTeamMembers`, `maxConcurrentSessions` and `auditRetentionDays`. `maxOwnedOrgs` is per user, across organisations: `ownedOrgLimit` (`enforceOrgCreationLimit`, `tenant.canCreateOrg`) takes the best EFFECTIVE plan over the organisations the user owns (a trialing organisation counts as Business). `business.canCreate` and `tenant.canCreateOrg` used to read the organisation's own plan and disagreed with the enforcing code during a trial; they now use the same source. When the trial ends (no subscription) the plan's own limits apply again with no special case: a Starter organisation's keys stop authenticating (`apiKeyUsable` is false for `maxApiKeys` 0, as for any plan without API access; the key rows are kept and work again on a plan with API access), new keys are refused (read-only), and a plan that has API access (Growth: 3) keeps authenticating existing keys, with the read-only gate refusing their writes. Covered by `integration/trial-count-limits.test.ts`.

## Error shape

tRPC: `FORBIDDEN` with `error.data.entitlement = { reason, upgradePath, addon? }` (built by `lib/entitlement-error.ts`, copied by the errorFormatter in `trpc.ts`). `reason` is an `EntitlementReason` (`read_only_halted`, `read_only_trial_expired`, `read_only_subscription_ended`, `tenant_suspended`, `plan_limit`, `addon_required`); `upgradePath` is `/settings?tab=billing`. Limit errors keep their own wording ("Your plan allows up to 3 ...").

REST: HTTP 403 with the same data as JSON: `{ "error": "<message>", "entitlement": { "reason", "upgradePath" } }`, built by `entitlementRefusalBody` in `packages/api/src/http/entitlement-guard.ts`. Clients branch on `entitlement.reason`, not the message.

## The tRPC gate

`entitlementGate` is appended to `tenantProcedure`, `businessProcedure` and `authorizedProcedure` (`trpc.ts`). Decision logic is the pure `gateDecision` in `lib/entitlement-exempt.ts`:

- queries and subscriptions always pass, except for a suspended organisation, which may only call `SUSPENDED_ALLOWED` (`tenant.current`, `billing.status`);
- mutations are refused while read-only or suspended unless the path is in `READ_ONLY_EXEMPT` (auth, billing recovery, exports, reducing access). Mutations are gated by default: a new mutation is refused in read-only mode until someone allowlists it deliberately;
- procedures on `publicProcedure` / `protectedProcedure` have no gate; the ones that write business data call `assertWritable` inline and are listed in `INLINE_WRITE_GUARDED`.

Review process: `src/__tests__/integration/__snapshots__/mutation-gate.md` is the committed gated/exempt split of every mutation, generated by `entitlement-exempt.test.ts`. A new mutation appears in the diff as `gated`. If it must stay open in read-only mode (rare: the way out of read-only, or reducing access) add it to `READ_ONLY_EXEMPT` with a comment and review the snapshot diff.

API keys: only the tRPC context accepts them (`context.ts`); `apiKeyUsable` refuses keys of suspended or expired-read-only tenants, and the gate then applies like any session.

## REST endpoints outside tRPC

Every route in `server.ts` and `http/*.ts` has an explicit decision in `REST_ENTITLEMENT_POLICY` (`http/rest-entitlement-policy.ts`, re-exported from `http/entitlement-guard.ts`). `src/__tests__/rest-entitlement-policy.test.ts` scans the route registrations and fails when a route has no row (or a row has no route); the generated table is committed as `integration/__snapshots__/rest-entitlement-policy.md`.

| Policy | Meaning |
|---|---|
| `read` | signed-in GET (PDFs, images, preview). Allowed read-only; suspended refused (`authorizePdfRequest` or the same inline check) |
| `exempt-download` | document download from a POST/owner route. Allowed read-only; suspended refused for tenant-scoped ones |
| `write-gated` | creates/edits data: `refuseIfReadOnly(c, tenantId)`, 403 + entitlement body. None exists today besides the signed-token import |
| `signed-token` | export (allowed read-only, needs the plan's `dataExport`) and import (a write: `refuseIfReadOnly`) |
| `public-neutral` | store and share links: halted/suspended/unknown all answer the same neutral 404, never billing wording |
| `exempt-webhook` | Razorpay (platform billing): ALWAYS processed (it is how payment recovers a tenant). A business's own Razorpay payment-link webhook: recorded for read-only (the customer already paid), refused for suspended. Shipping: accepted for read-only (dropping carrier updates loses data), refused for suspended (only active tenants are looked up, so 404) |
| `exempt-auth` | sign-in style routes (none: auth is tRPC) |
| `public-static` | no tenant data (health, plan list, UPI redirect) |
| `trpc-gated` | the tRPC mount, see above |

Notes: `POST /api/items/labels` generates a label PDF, so it is a download and stays allowed. `GET /api/billing/invoices/:paymentId/pdf` is owner-gated and stays available so a halted owner can fetch Finvera invoices.

## Plan features (the flags)

Every boolean flag on a plan (`PLAN_FLAG_KEYS`) is registered in **`FEATURE_GATES`** (`packages/shared/src/feature-gates.ts`), the single source of truth for what a flag protects. Enforcement is driven by the plan's STORED flag values (the Plans editor edits them) through `getEntitlements(...).features`; no code names a plan. Which plan a message asks for ("the Growth plan and above") is the cheapest plan whose stored flag is on, so an admin editing a plan changes both who is allowed and what the message says.

`getEntitlements` returns `features` (and the same flag values inside `limits`): the plan's flags, **all on for a grandfathered organisation**, and the **top plan's flags during an active trial** (`lib/plan-features.ts`). `pdfBranding` is a display flag, not a capability, so trial and grandfathered organisations keep their own plan's value for it.

### Kinds of flag

| Kind | Flags | What it means |
|---|---|---|
| gated | `eInvoicing`, `eWayBills`, `gstReports`, `recurringInvoices`, `pos`, `multiWarehouse`, `batchesExpiry`, `bankReconciliation`, `manufacturing` | The API refuses the flag's writes (table below) with `feature_not_in_plan` |
| enforced elsewhere | `dataExport`, `onlineStore`, `pdfBranding`, plus API access (`maxApiKeys`, `auditRetentionDays`, which are limits) | Own code paths in `lib/plan-limits.ts`, the store routes and PDF code; refusals use the same error shape |
| operational | `prioritySupport`, `onboardingHelp` | Nothing to gate in code. `contact.submit` from a signed-in customer adds a "Plan support" line and a `[Priority]` subject; platform admin organisation lists and detail show "Priority support" / "Onboarding help included" badges (`lib/support-badges.ts`) |
| not built | `approvals` | There is no approval workflow in the code yet. The flag is stored and shown on the plan and gates nothing; the Plans editor says so. Do not invent a gate: when the feature is built, add its procedures to `FEATURE_GATES.approvals` and flip `kind` to `gated` |

### Flag to procedures

Reads of existing data stay open everywhere: a customer who downgrades, or whose trial ends, never loses sight of their data (read-only mode is the separate gate above).

| Flag | Gated writes and entry points |
|---|---|
| `eInvoicing` | every `eInvoice.*` mutation (generate, cancel, retryFailed, bulkRetry, configure, testConnection); the background IRN submission after `invoice.create` (skipped via `hasFeature`) |
| `eWayBills` | every `ewayBill.*` mutation (generate, cancel, extend, updateVehicle) |
| `gstReports` | every `gstReturns.*`, `gstr2b.*` and `itc.*` mutation (filing, 2B upload and matching, ITC decisions); the GST report queries stay readable. `gst.updateCompositionSettings` is exempt (it changes invoice calculation) |
| `recurringInvoices` | every `recurringInvoice.*` mutation except `pause` and `delete` (stopping is never refused); the scheduler generates nothing for a plan without it (due templates are moved on, like read-only) |
| `pos` | `pos.catalog` (entry point query) and `invoice.create` with `source: "pos"` |
| `multiWarehouse` | `stock.transfer`, `warehouse.locationCreate`, `warehouse.warehousePermissionCreate`, `warehouse.accessSet`, `warehouse.inventorySettingsUpdate`, and creating a second warehouse (`warehouse.warehouseCreate`) or premise (`warehouse.premiseCreate`) when the business already has one. Basic inventory stays: items, `stock.adjust`, counts, the ledger, the default warehouse (renaming it included) |
| `batchesExpiry` | every `batch.*` mutation; `item.create` / `item.update` switching `trackBatches` / `trackExpiry` on (or an opening batch); batch or expiry fields in the input of `invoice.create`, `invoice.update`, `document.convert`, `item.adjustStock`, `stock.adjust`. Without batch fields the server still allocates earliest-expiry-first, so selling a batch-tracked item keeps working |
| `bankReconciliation` | every `bankRecon.*` mutation (uploads, matching, rules, templates) |
| `manufacturing` | every `manufacturing.*` mutation (BOM create/update/delete, manufacture, cancel) |

`integration/__snapshots__/feature-gate.md` is the committed procedure-to-flag matrix, generated by `feature-gate-registry.test.ts`. The same test **fails when a mutation under a checked router (`FEATURE_GATE_CHECKED_ROUTERS`) is neither gated nor listed in `FEATURE_GATE_EXEMPT` with a reason**, and when a gated procedure is not on a tenant-scoped base (the middleware would never run).

### How the gate runs

The check lives inside the existing `entitlementGate` middleware (`trpc.ts`), not in a second middleware, so the middleware prefix the role-sweep helpers match on is unchanged. Order for a request on a tenant base: CSRF, authentication, tenant access, two-factor gate, (business access, CASL permissions and the CA role backstop), then `entitlementGate`: first the read-only / suspended decision (`gateDecision`), then `enforceFeatureGates` (`lib/feature-gate.ts`). So an expired trial gets "choose a plan", never "upgrade to Growth", and the 2FA gate and CA backstop keep their order and meaning. Conditional entries (second warehouse, batch fields, POS sale, item batch flags) read the raw input and, for the warehouse and item cases, one count or lookup in the tenant database.

### Error shape

`FORBIDDEN` with `error.data.entitlement`:

```json
{
  "reason": "feature_not_in_plan",
  "code": "feature_not_in_plan",
  "upgradePath": "/settings?tab=billing",
  "feature": "eInvoicing",
  "featureName": "E-invoicing",
  "requiredPlan": "Growth",
  "currentPlan": "Starter"
}
```

with the message `E-invoicing is available on the Growth plan and above.` (`...on the Business plan.` when the top plan is the first with it; `... is not available on your plan.` and `requiredPlan: null` when no plan has it). Data export and online store refusals use the same shape; REST (`GET /api/export/:tenantId`) answers 403 with `{ error, entitlement }`. API access is a count limit, so its refusal stays `plan_limit` with the message `API access is available on the Growth plan and above. ...`.

### REST routes, API keys, jobs

- **API keys, the CLI and the MCP server** all go through tRPC, so the same gate applies to them.
- **REST routes** (`REST_ENTITLEMENT_POLICY`): none creates feature data except the signed-token backup import (`POST /api/selfImport/:tenantId`, a whole-business restore: deliberately not feature-gated, a restore must be able to bring back what the business had), the public store order (`onlineStore`, enforced), and the shipping webhook (carrier updates only). The data export route re-checks `dataExport`.
- **Jobs**: the recurring scheduler checks `recurringInvoices`; the payment reminder job (`lib/payment-reminders.ts`, hourly, `PAYMENT_REMINDERS=off` disables it) is a basic feature on every plan, so it checks no plan flag, but it lists only `active` tenants and skips a read-only organisation (`tickTenant`: no reminder is sent and no history row is written, unlike the TDS reminder digest, which still goes to read-only organisations). A reminder that is sent carries the business's Razorpay payment link for the current balance when Razorpay is connected (`lib/razorpay/reminder-link.ts`: reuses the active link for an unchanged balance, otherwise `ensureInvoicePaymentLink`; a read-only organisation makes no new link; previews and listings only read, never create; any failure means no link and never blocks the reminder); the background IRN submission checks `eInvoicing`. There is no scheduled e-invoice retry job (retries are the `retryFailed` / `bulkRetry` mutations).

### Online payments (a business's own Razorpay account)

Not a plan flag: every plan has it. Each business pastes ITS OWN Razorpay keys (encrypted, never returned) and customers pay invoices through Razorpay payment links; the platform's own `RAZORPAY_KEY_ID` (subscription billing) is never used for it. The decisions:

| Surface | Policy |
|---|---|
| `onlinePayments.getSettings`, `invoiceLink` (queries) | always readable (not for a suspended organisation); `getSettings` needs `manage:Business` (owner and admin only) |
| `onlinePayments.connect` | gated: refused while read-only or suspended (saving keys is a write) |
| `onlinePayments.createInvoiceLink` | gated: **read-only blocks creating links** (it writes a link row and calls Razorpay) |
| `onlinePayments.testConnection` | exempt (`READ_ONLY_EXEMPT`): only reads Razorpay |
| `onlinePayments.disconnect` | exempt: revoking credentials is never refused |
| `POST /api/share/:token/pay` | `public-neutral`: a read-only or suspended organisation answers the same neutral 404 and makes no new link; the share page does not offer Pay now (`onlinePayment.available` is false) |
| `POST /webhooks/razorpay/business/:token` | `exempt-webhook`: a payment the customer has **already made** is recorded even while read-only (otherwise real money would go unbooked); a suspended organisation's token does not resolve (generic 401). Signature-verified with that business's own webhook secret, never open |

### Clients

`billing.status` carries `plan`, `features`, `featureRequiredPlans` and `topPlanName`; the shared `featureAccess(status, flag)` turns them into `{ allowed, featureName, requiredPlan, badge, message }` (allowed while the status loads, so nothing flashes locked). Web: nav items for gated pages show a small plan badge (text, with an `aria-label`) instead of hiding; gated pages show `FeatureNotice` ("Not on your plan", "See plans") above the list so existing data stays visible, and their create buttons are disabled with a `title` reason (`useFeature(flag).lockedProps`); batch fields on documents and stock explain why they are off. Mobile has the same notice and a disabled add button on the recurring invoices screens. Both shared error handlers turn a server `feature_not_in_plan` into the same prompt with "See plans" (owners go to Billing, everyone else to the public pricing page). The desktop app is the web app.

### Legacy organisations

Organisations that were on the old `free` plan and were migrated to **Starter** (rather than grandfathered, see above; `plan-migration.test.ts`) keep their data but get Starter's features. If they used features Starter lacks (batches, extra warehouses, bank reconciliation, BOMs...), that data stays readable, searchable and printable, but it cannot be changed: new writes in those areas are refused with the feature message until they pick a plan that includes them. Stopping or removing is never refused (pause or delete recurring invoices, delete warehouses, switch batch tracking off). Former Forever Free organisations that were grandfathered have everything.

## The "Powered by Fintranzact" PDF line

The plan's `pdfBranding` limit decides (`pdfBrandingHidden` in `lib/plan-limits.ts`): `true`, the default on all three plans, prints a small "Powered by Fintranzact" line on the last page of invoices and the other invoice-template documents, thermal receipts and e-way bill prints; the public share page shows a matching "Made with Fintranzact" link. An admin can switch it off per plan (Plans console), and an edited value survives the plan migration.

Where the line links is decided by `lib/pdf-branding.ts`: an organisation referred by an **approved** partner (`tenants.partner_id`) links to `<APP_URL>/register?ref=<their referral code>`, the same parameter the partner portal's link uses; everyone else links to the plain `APP_URL`. A partner who is pending or rejected, or has no code, gives the plain link. The URL carries the referral code only (no organisation, user, document or tracking data), and no partner name or contact is printed. With no `APP_URL` and no request origin the line is plain text. The link is passed into the PDF data as `brandingUrl` next to `isPaidPlan` (true = line hidden).

## Add-on availability

An add-on is sold only when its feature is built. The single source of truth is `ADDON_FEATURES[id].implemented` in `packages/shared/src/entitlements.ts`, read through `isAddonAvailable(id)` and `availableAddonIds()`. Everything else follows from it, with no other change when a flag flips to `true`:

- `billing.config` returns `addonAvailability` (a boolean per add-on id) and `billing.overview` returns `available` on every entry of `addons` (additive fields).
- `billing.subscribeAddon` refuses an unavailable add-on with `BAD_REQUEST` and `ADDON_COMING_SOON_MESSAGE` ("This add-on is coming soon and cannot be purchased yet."). The check runs before any checkout, so no subscription row or invoice is created.
- The pricing page renders the Add-ons section and FAQ entry only for available add-ons (nothing when none are). The Billing tab hides subscribe controls for unavailable add-ons.
- An organisation that already holds an unavailable add-on (admin grant or an earlier subscription) still sees it on the Billing tab, active, with a "Coming soon" note and no purchase controls. Entitlement flags (`addons` in `billing.status`), webhooks, renewals, cancellation and the platform admin add-on on/off keep working; only new purchases are refused.
- The Full Access Trial still reports add-on caps; the add-ons themselves arrive in the trial when they exist.

## How to add things

- New tRPC mutation: nothing to do; it is gated. Run `pnpm --filter @fintranzact/api test entitlement-exempt` (with `-u` for snapshot files) and review `mutation-gate.md`. Allowlist only if it must work read-only.
- New REST route: add it to `REST_ENTITLEMENT_POLICY`. If it writes, call `refuseIfReadOnly(c, tenantId)` right after authenticating and before any work, and add an integration case to `integration/rest-entitlement.test.ts`. Tenant-scoped reads should use `authorizePdfRequest` so suspended tenants are refused.
- New add-on feature: add the id to `ADDON_IDS` and `ADDON_FEATURES` (shared), call `requireAddon(tenantId, id)` at the router entry, and mark `implemented: true`. Flipping `ADDON_FEATURES[id].implemented` is the only switch that puts the add-on on sale again (see "Add-on availability" below).
- New gated feature (a plan flag): add the key to `PlanLimits`, `PLAN_FLAG_KEYS`, `planSettingsSchema` and the defaults in `plans.ts`, then its entry in `FEATURE_GATES` (name, kind, `routers` for a router whose every mutation is gated, `procedures`, `conditional` for partial uses, `elsewhere` for REST routes and jobs). Add the router to `FEATURE_GATE_CHECKED_ROUTERS` and list deliberate gaps in `FEATURE_GATE_EXEMPT` with a reason. Regenerate `feature-gate.md` (`pnpm --filter @fintranzact/api test feature-gate-registry -- -u`), add a nav `feature:` key, a `FeatureNotice` and `useFeature(flag).lockedProps` on the page (web) and the mobile equivalent, and give REST routes and jobs a `requireFeature` / `hasFeature` check.
- New mutation in an already gated router: nothing to do, it is gated by the router. Mutation in a checked router that must stay open: `FEATURE_GATE_EXEMPT` with a reason (the registry test fails until you decide).
- New plan limit: add the field to `PlanLimits` and the defaults, enforce with an `enforce*` function in `lib/plan-limits.ts` that throws `limitError`, and call it from the creating procedure. Always count server-side.
- New scheduler or background job: skip read-only/suspended tenants (see `recurring-invoice-scheduler.ts` and `payment-reminders.ts`, which call `getEntitlements` and skip; `tds-reminder-scheduler.ts` skips suspended tenants only, on purpose).

## Not built yet

- Enforcement of the trial caps (AI questions, payroll employees): exposed in `trial.caps`, consumed by nothing until those features exist.
- WhatsApp trial reminders (email and in-app only for now).
- Approvals (the `approvals` plan flag): no approval workflow exists in the code; the flag gates nothing (see Plan features).
- AI assistant, payroll and Store Pro features: the features do not exist, so the add-ons are not on sale (`ADDON_FEATURES[...].implemented` is false; see "Add-on availability"). Admin grants and the flags for already-held add-ons keep working.

## Tests

Pure: `entitlements.test.ts`, `entitlement-exempt.test.ts`, `entitlement-gate.test.ts`, `rest-entitlement-policy.test.ts`, `feature-gate-registry.test.ts` (and `packages/shared/src/__tests__/feature-gates.test.ts`). Integration (need the test Postgres): `read-only-gate.test.ts`, `plan-enforcement.test.ts`, `rest-entitlement.test.ts`, `feature-gates.test.ts`.
