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
| `exempt-webhook` | Razorpay: ALWAYS processed (it is how payment recovers a tenant). Shipping: accepted for read-only (dropping carrier updates loses data), refused for suspended (only active tenants are looked up, so 404) |
| `exempt-auth` | sign-in style routes (none: auth is tRPC) |
| `public-static` | no tenant data (health, plan list, UPI redirect) |
| `trpc-gated` | the tRPC mount, see above |

Notes: `POST /api/items/labels` generates a label PDF, so it is a download and stays allowed. `GET /api/billing/invoices/:paymentId/pdf` is owner-gated and stays available so a halted owner can fetch Finvera invoices.

## The "Powered by Fintranzact" PDF line

The plan's `pdfBranding` limit decides (`pdfBrandingHidden` in `lib/plan-limits.ts`): `true`, the default on all three plans, prints a small "Powered by Fintranzact" line on the last page of invoices and the other invoice-template documents, thermal receipts and e-way bill prints; the public share page shows a matching "Made with Fintranzact" link. An admin can switch it off per plan (Plans console), and an edited value survives the plan migration.

Where the line links is decided by `lib/pdf-branding.ts`: an organisation referred by an **approved** partner (`tenants.partner_id`) links to `<APP_URL>/register?ref=<their referral code>`, the same parameter the partner portal's link uses; everyone else links to the plain `APP_URL`. A partner who is pending or rejected, or has no code, gives the plain link. The URL carries the referral code only (no organisation, user, document or tracking data), and no partner name or contact is printed. With no `APP_URL` and no request origin the line is plain text. The link is passed into the PDF data as `brandingUrl` next to `isPaidPlan` (true = line hidden).

## How to add things

- New tRPC mutation: nothing to do; it is gated. Run `pnpm --filter @fintranzact/api test entitlement-exempt` (with `-u` for snapshot files) and review `mutation-gate.md`. Allowlist only if it must work read-only.
- New REST route: add it to `REST_ENTITLEMENT_POLICY`. If it writes, call `refuseIfReadOnly(c, tenantId)` right after authenticating and before any work, and add an integration case to `integration/rest-entitlement.test.ts`. Tenant-scoped reads should use `authorizePdfRequest` so suspended tenants are refused.
- New add-on feature: add the id to `ADDON_IDS` and `ADDON_FEATURES` (shared), call `requireAddon(tenantId, id)` at the router entry, and mark `implemented: true`.
- New plan limit: add the field to `PlanLimits` and the defaults, enforce with an `enforce*` function in `lib/plan-limits.ts` that throws `limitError`, and call it from the creating procedure. Always count server-side.
- New scheduler or background job: skip read-only/suspended tenants (see `recurring-invoice-scheduler.ts` and `tds-reminder-scheduler.ts`, which call `getEntitlements` and skip).

## Not built yet

- Enforcement of the trial caps (AI questions, payroll employees): exposed in `trial.caps`, consumed by nothing until those features exist.
- WhatsApp trial reminders (email and in-app only for now).
- AI assistant, payroll and Store Pro features: the add-ons can be bought and are enforced as flags (`ADDON_FEATURES[...].implemented` is false), but the features behind them do not exist.

## Tests

Pure: `entitlements.test.ts`, `entitlement-exempt.test.ts`, `entitlement-gate.test.ts`, `rest-entitlement-policy.test.ts`. Integration (need the test Postgres): `read-only-gate.test.ts`, `plan-enforcement.test.ts`, `rest-entitlement.test.ts`.
