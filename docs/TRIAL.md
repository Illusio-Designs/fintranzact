# Full Access Trial: operations note

Roadmap item **P2. Full Access Trial**. Every new organisation starts a trial instead of a free plan. How the access rules work is in [`ENTITLEMENTS.md`](ENTITLEMENTS.md); this note is for the people who run it.

## What a trial is

| | |
|---|---|
| Length | 14 days (`trial.days`), 30 days for a sign-up with an approved partner code (`trial.partnerDays`) |
| Access | Business plan limits and features, plus the add-ons AI Assistant, Payroll and Store Pro, with caps (add-ons are not on sale until `ADDON_FEATURES[id].implemented`; see ENTITLEMENTS.md) |
| Caps | AI 50 questions, Payroll 10 employees (`trial.caps`); Store Pro has no cap and includes domain connect |
| Card | Not needed |
| At the end | Read-only until any plan is bought: view, search, download and export still work, no new documents or edits. Nothing is deleted. Buying a plan unlocks at once |

The row lives on `tenants`: `trial_started_at`, `trial_ends_at`, `trial_source` (`signup`, `partner`, `admin`, `none`). The pure rules (window, days left, reminder schedule, claim normalisation, banner wording) are in `packages/shared/src/trial.ts`.

## Settings (platform admin: Organisations, "Free trial settings")

Stored in `system_config`, edited with `platform.saveTrialSettings` (audited as the billing event `platform.trial_settings_changed`, with the old and new values and the admin):

| Key | Default | Bounds |
|---|---|---|
| `trial.days` | `14` | 1 to 90 |
| `trial.partnerDays` | `30` | 1 to 90 |
| `trial.caps` | `{ aiQuestions: 50, payrollEmployees: 10 }` | whole numbers, 0 to 10000 and 0 to 1000 |

A change applies to organisations that sign up afterwards; running trials keep their dates (use Extend for those). A missing or hand-edited bad value falls back to the default for that field, so a bad row can never break sign-up. Settings are cached for 30 seconds per server.

## One trial per business

`trial_claims` holds `(kind, value_hash, tenant_id)` with `UNIQUE (kind, value_hash)`. Kinds: `email`, `phone`, `gstin`. The hash is `sha256(salt:kind:normalised value)`; the raw value is never stored or logged. The salt is `TRIAL_CLAIM_SALT`, else `DB_ENCRYPTION_KEY`, else a built-in constant. **Do not change the salt on a running system**: every existing claim would stop matching.

- **Email, at sign-up** (and at `tenant.create`): normalised (lowercase, `+tag` removed, Gmail dots ignored). If the claim exists, the new organisation is created with source `none`: started and ended at the same instant, so it is read-only until a plan is bought, and `billing.status.trialMessage` says "A free trial was already used for this email, phone or GSTIN. Choose a plan to continue." The claim is written in the sign-up transaction; if two sign-ups race, the unique index decides and the loser's trial is turned into `none` inside its own transaction. Sign-up itself never fails because of a claim.
- **Phone**: normalised to E.164 and supported by the same functions, but sign-up does not collect a phone number, so nothing records or checks one yet. Wire `{ kind: "phone", value }` into `decideNewOrgTrial` when a phone is collected at sign-up.
- **GSTIN, when a business first saves one** (`business.create`, `business.update`): `claimGstinForTenant`. Only an organisation with a self-serve trial (source `signup` or `partner`) takes part. Not claimed yet: it claims it. Already claimed by the same organisation: no-op. Claimed by another organisation: if this organisation's trial is still running it ends now (source `none`, billing event `tenant.trial_denied` with no reference to the other organisation). Only a well-formed GSTIN with a valid check digit counts; an organisation can hold at most 3 GSTIN claims and 10 saves an hour are processed (in memory, per server), so the check cannot be used to lock someone else's number. Never throws, never fails the business save.
- `TRIAL_CLAIMS=off` turns every check off (self-hosted installs, and the e2e server, whose journeys reuse one GSTIN across many organisations).
- A second organisation for the same owner (`tenant.create`) is claimed by the owner's email, so it starts read-only until a plan is bought. This follows "one trial per business".
- **Support**: a platform admin can still give such an organisation a custom trial (it ignores claims). To free a claim, delete the `trial_claims` row (compute the hash with `hashClaimValue` in `lib/trial-claims.ts`).

## Reminders job

`lib/trial-reminders.ts`, started from `server.ts` (`startTrialReminderScheduler`, checked hourly; `TRIAL_REMINDERS=off` disables it). For each organisation whose trial ends within the next 8 days or ended within the last 4 days (not grandfathered, active, source `signup`, `partner` or `admin`), and which is `trialing` or `trial_expired` (never paid), it decides with the pure `planTrialReminders`:

- three reminders at **7 days left, 2 days left, and the end** (the spec's "day 7, 12, 14" for a 14-day trial); other lengths use the same days-left values;
- a reminder whose moment is at or before the trial start does not exist (a 5-day trial has no "7 days left");
- a job that was down sends only the **latest** due reminder; earlier ones are recorded as `skipped`; the expiry reminder is skipped, not sent, more than 3 days after the end.

Idempotency: a row in `trial_reminders` `(tenant_id, kind)` (unique) is inserted before the email goes out; whoever inserts it sends. A failed send deletes the row so the next tick retries. Two instances, or a restart, cannot double-send. Extending, granting or ending a trial resets the log and records the reminders already past under the new dates as `skipped`.

Recipients: the organisation's owners. There is no email opt-out or bounce store in this codebase; these are account notices. The email goes through `emailService.sendNotice` (Resend in production, console otherwise). Logs carry counts only, never addresses.

The **in-app** side needs no store: the countdown banner and the header bell read `billing.status` (the bell shows an alert at 7 days, at 2 days and when it ends). WhatsApp reminders are not built.

## Admin actions (organisation panel, "Free trial")

All require a reason (3 to 500 characters), are recorded in `billing_events` with the acting admin, drop the entitlements cache and reset the reminder log.

| Action | Procedure | Billing event | Notes |
|---|---|---|---|
| Extend by N days | `platform.extendTrial` | `tenant.trial_extended` | From the current end if it is still running, else from now. 1 to 365 days. A `none` organisation becomes source `admin` |
| Custom trial of N days from now | `platform.grantTrial` | `tenant.trial_granted` | Source `admin`; allowed even when a claim exists |
| End now | `platform.endTrial` | `tenant.trial_ended` | Only a running trial |
| Raw set or clear | `platform.setTrial` | `tenant.trial_set` | The older control, kept |

Extend and custom are refused for grandfathered organisations and for ones that already pay. The organisation list shows each trial ("9 days left", "Ended", "No trial", "Grandfathered").

## Migrations

Unified tree `packages/db/drizzle/0058_p2_full_access_trial.sql` (from `drizzle-kit generate`, snapshot `0058_snapshot.json`); control tree `packages/db/drizzle-control/0021_p2_full_access_trial.sql` (hand-written, idempotent). Adds `tenants.trial_started_at`, `tenants.trial_source`, `trial_claims`, `trial_reminders`. Existing organisations get NULLs: their trial dates are unchanged and the reminder job treats a missing start as `ends_at` minus 14 days.

## Where to look

| Thing | File |
|---|---|
| Pure rules | `packages/shared/src/trial.ts` |
| Access and caps | `packages/shared/src/entitlements.ts` (`deriveAccess`), `packages/api/src/lib/entitlements.ts` |
| Start, extend, custom, end | `packages/api/src/lib/trial.ts` |
| Claims | `packages/api/src/lib/trial-claims.ts` |
| Settings | `packages/api/src/lib/trial-settings.ts` |
| Reminders | `packages/api/src/lib/trial-reminders.ts` |
| Banner | `apps/web/src/components/BillingBanner.tsx`, `apps/mobile/src/lib/billing-banner.ts` (both use `trialBannerFor`) |
| Admin UI | `apps/web/src/components/platform/TrialSection.tsx`, `TrialSettingsCard.tsx` |
| Tests | `packages/shared/src/__tests__/trial.test.ts`, `packages/api/src/__tests__/integration/trial.test.ts`, `trial-claims.test.ts` |
