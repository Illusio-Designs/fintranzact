# Two-factor authentication

Status: **all seven parts built:** enrolment API, sign-in challenge with trusted devices, web and desktop screens, mobile screens, organisation enforcement, and (part 7) platform-admin reset with the audit views. The CLI prompts for a code. Integration tests and on-device checks have not been run yet.

## Model

TOTP (RFC 6238, 6 digits, 30 s, SHA-1) plus ten single-use backup codes. No SMS.

| Table | Purpose |
|---|---|
| `users.two_factor_enabled` | Cheap flag (`auth.me` reads it). |
| `user_two_factor` | One row per user: `secret_enc` (TOTP secret, AES-256-GCM), `confirmed_at` (null = setup pending), `last_used_step` (replay guard), `failed_count`, `locked_until`, `lockout_count`. |
| `two_factor_backup_codes` | `code_hash` (sha256) and `used_at`; plaintext is shown once and never stored. |
| `two_factor_challenges` | Short-lived step between a correct password and a session: `token_hash` (sha256), `expires_at` (5 minutes), `attempts`, `consumed_at`, client kind, ip, user agent. |
| `trusted_devices` | Remembered devices: `token_hash`, `label`, `ip`, `expires_at` (fixed 30 days), `last_used_at`, `revoked_at`. |
| `security_events` | Append-only trail (`2fa.setup_started`, `2fa.enabled`, `2fa.disabled`, `2fa.verified`, `2fa.failed`, `2fa.locked`, `2fa.backup_used`, `2fa.backup_regenerated`, ...). Recording never throws. |
| `tenants.two_factor_policy / two_factor_enforced_at / two_factor_grace_days` | Per-organisation enforcement (`off` / `admins` / `all`). |

Code: `packages/api/src/lib/two-factor.ts` (enrolment logic, injected data layer), `lib/two-factor-login.ts` (challenge, trusted devices, cookie rules; injected `TwoFactorLoginStore`), `lib/two-factor-store.ts` (Postgres for both), `lib/totp.ts`, `lib/two-factor-codes.ts`, `routers/auth.ts` (procedures), `packages/shared/src/two-factor.ts` (constants and pure rules).

## Procedures

All are `protectedProcedure` and require a **real session** (cookie, session Bearer or access token). An API key is refused with `BAD_REQUEST` ("...not with an API key"). The mutations are in `READ_ONLY_EXEMPT`: account security works while an organisation is read-only or suspended.

| Procedure | Input | Result |
|---|---|---|
| `auth.twoFactorStatus` (query) | none | `{enabled, pendingSetup, backupCodesRemaining, lockedUntil, trustedDeviceCount, createdAt}` |
| `auth.twoFactorBeginSetup` | none | `{otpauthUri, qrDataUrl (PNG), manualKey (groups of 4), accountName, issuer}`. Replaces any earlier pending secret. 10 per hour per user. |
| `auth.twoFactorConfirmSetup` | `{code}` | `{backupCodes: string[]}` (shown once). Enables 2FA and revokes the user's *other* sessions. |
| `auth.twoFactorDisable` | `{password, code}` | `{success}`. `code` is a TOTP or an unused backup code. Revokes trusted devices and other sessions. |
| `auth.regenerateBackupCodes` | `{password, code}` | `{backupCodes}`. TOTP only (a backup code is refused so a stolen one cannot mint a new set). Replaces all codes atomically; trusted devices and sessions are left alone. |
| `auth.me` | | now also returns `twoFactor: {enabled}` |

`code` is auto-detected: six digits is a TOTP, anything else is a backup code (case, spaces and dashes ignored).

## Error codes

| Code | When |
|---|---|
| `BAD_REQUEST` | Wrong code ("That code is not right..."), wrong password or code on disable/regenerate (one generic message for both), 2FA already on / not on, no pending setup, API-key auth. **Never `UNAUTHORIZED`**: web clients redirect to sign-in on it. |
| `TOO_MANY_REQUESTS` | Verification locked (message carries the minutes left and the ISO unlock time), the per-email failed-login limiter is full, or more than 10 setup starts in an hour. |
| `FORBIDDEN` | Disable refused: "Your organisation requires two-factor authentication". Applies when any organisation the user belongs to has a policy covering their role (grace period ignored). An owner can relax the policy first. |

## Lockout

Five consecutive wrong codes lock verification: 15 minutes, then 1 hour, then 24 hours (`lockoutDuration`). While locked even a correct code is refused and adds no failure. Any success resets the counters. Counting is one atomic `UPDATE`. Accounts with no password skip the password check and need only the code.

### Limiter separation

Wrong passwords typed into disable / regenerate are counted per **user** under the key `2fa-password:<userId>` (5 per 15 minutes), **separate** from the per-email sign-in limiter. Part 2 shared the two, which let someone holding a session but not the password lock the real user out of sign-in for 15 minutes; they no longer interact. The sign-in limiter still guards `auth.login` only.

## Replay and single use

- TOTP: `UPDATE ... SET last_used_step = $step WHERE last_used_step IS NULL OR last_used_step < $step`; only the caller that wins is accepted. The code used to confirm setup counts as used, so a fresh code (next 30 s step) is needed straight after.
- Backup codes: `UPDATE ... SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`.

`verifySecondFactor(deps, userId, code, {allowBackup})` in `lib/two-factor.ts` implements all of this and is what the sign-in challenge reuses.

## Sign-in flow

1. `auth.login` checks the password exactly as before (same generic "Invalid email or password" for unknown email, no password set and wrong password, and the same per-email limiter). Two-factor is never mentioned before the password is correct.
2. The result is a union on `twoFactorRequired`:
   - `{ twoFactorRequired: false, user, sessionToken }`: no 2FA, or a valid trusted device. Same fields as before plus the flag; the session cookie is set for web clients.
   - `{ twoFactorRequired: true, challengeToken, expiresAt, methods: ["totp", "backup_code"] }`: **no session and no `Set-Cookie`**.
3. `auth.verifyTwoFactor({ challengeToken, code, rememberDevice?, client? })` (public: there is no session yet) checks, in order: per-IP limiter (30 per 15 min), the challenge (exists, unexpired, unconsumed, else `BAD_REQUEST` "This sign-in has expired. Enter your password again."), per-challenge limiter (10 per 5 min), then `verifySecondFactor` (user lockout, TOTP replay guard, single-use backup codes, failure counting, events). A wrong code also bumps the challenge's `attempts`; the 5th kills it (consumed), so the user must re-enter the password. On success the challenge is consumed atomically (`UPDATE ... WHERE consumed_at IS NULL AND expires_at > now RETURNING`), so a challenge works once.
4. The session is minted by the **same helper as login** (`createSessionForUser`): bearer-vs-cookie decision, plan-limit session eviction, previous-session cleanup, session cookie. Result: `{ user, sessionToken, trustedDeviceToken? }`.

Errors are `BAD_REQUEST`, `TOO_MANY_REQUESTS` (lockout message carries the unlock time) or `FORBIDDEN`, never `UNAUTHORIZED`. Expired challenges are deleted opportunistically at the next challenge creation.

Events: `2fa.verified` (metadata `method`: `totp` or `trusted_device`), `2fa.backup_used`, `2fa.failed`, `2fa.locked`, `2fa.device_trusted`, `2fa.device_revoked`.

## Trusted devices

- Opt in with `rememberDevice: true` on `auth.verifyTwoFactor`. A random 32-byte token (`newOpaqueToken`) is created; only its sha256 is stored, with a label parsed from the user agent ("Chrome 126 on macOS"; "Fintranzact desktop app" / "mobile app" for those clients), the ip and the user agent.
- Expiry is **fixed 30 days** from issue (`TRUSTED_DEVICE_DAYS`); using the device never extends it.
- At login a device skips only the **second step**: the password is always required. It must be found by hash, belong to this user, not be revoked and not be expired. A hit updates `last_used_at` and records `2fa.verified` with method `trusted_device`.
- **Delivery depends on the client**, resolved from the `X-Fintranzact-Client` header first, then the `client` input, else `web`. This only decides where the token goes (and whether remembering is allowed); it never changes session semantics.

| Client | Token delivered as | Presented at login as |
|---|---|---|
| `web` | `Set-Cookie: ftz_td=<token>; Path=/; HttpOnly; SameSite=Lax; [Secure on https]; Max-Age=2592000` | the `ftz_td` cookie |
| `desktop`, `mobile` | `trustedDeviceToken` in the response body | `trustedDeviceToken` input of `auth.login` |
| `cli` | never remembered | never |

The cookie is added with `Headers.append`, so the session cookie (written with `.set`) is kept: web responses carry two `Set-Cookie` values. The mobile app does not send `X-Fintranzact-Client` today, so it must pass `client: "mobile"` in the input.

- `auth.listTrustedDevices` (query): `{id, label, ip, createdAt, lastUsedAt, expiresAt, current}`; `current` marks the device whose cookie (or optional `trustedDeviceToken` input) matches.
- `auth.revokeTrustedDevice({id})`: own devices only (`NOT_FOUND` otherwise). `auth.revokeAllTrustedDevices` also clears the `ftz_td` cookie. Both are in `READ_ONLY_EXEMPT`, as is `auth.verifyTwoFactor`.
- **All of a user's devices are revoked** when: two-factor is disabled, a new secret is confirmed, and `auth.logoutAll` ("sign out everywhere", which also clears `ftz_td`). Regenerating backup codes leaves devices alone.
- Trusted devices **never** satisfy a sensitive action: disable and regenerate need the password and a fresh authenticator code, and nothing in `lib/two-factor.ts` looks at a device (a test guards this).

## Web and desktop clients

**Sign-in second step** (`components/auth/AuthScreen.tsx`, `TwoFactorStep.tsx`): when `auth.login` returns `twoFactorRequired`, the form is swapped for a code screen. Six digits auto-submit (paste friendly); "Use a backup code instead" switches to a `XXXXXX-XXXXXX` field (formatter in `lib/two-factor.ts`); "Trust this device for 30 days" is off by default and sent as `rememberDevice`. Wrong code: inline message, field cleared, challenge kept (up to 5 attempts). Expired or used-up challenge: back to the password step with the server's message. Locked (`TOO_MANY_REQUESTS`): "Too many attempts. Try again at <time>", with the time read from the `(after <ISO>)` part of the server message. Success runs the same post-login code as a password login. None of the errors is `UNAUTHORIZED`, so the global redirect-to-login handler and the entitlement toasts ignore them.

**Security settings** (Settings, Account, Security; `components/settings/SecurityTab.tsx` and `security/`): status card, enable dialog (QR + grouped manual key, confirm code, backup codes), disable and regenerate dialogs (password + code; an organisation-enforced refusal is shown inline), trusted devices with revoke and revoke all. Backup codes are shown once; the dialog cannot be closed until "I have saved these codes" is ticked. Download builds a client-side `fintranzact-backup-codes.txt` (account email, date, warning); Print opens a print window. The Account profile card shows a "Two-factor on" badge from `auth.me`.

**Desktop**: the trusted-device token returned in the verify response body is stored in the OS keychain (service `in.fintranzact.app`, account `trusted_device_token`, never a plaintext fallback) through `save_trusted_device_token`, `get_trusted_device_token` and `clear_trusted_device_token` in `src-tauri/src/session.rs` (allow-listed under `src-tauri/permissions/` and `capabilities/default.json`). JS wrappers `saveTrustedDeviceToken`, `getTrustedDeviceToken`, `clearTrustedDeviceToken` live in `lib/desktop-session.ts` and are no-ops outside the desktop app. The token is sent as `trustedDeviceToken` on every `auth.login`. It survives sign-out (trust belongs to the device) and is cleared when the server answers a login that carried it with a challenge anyway (expired or revoked), when the user revokes this device, on "Revoke all", and when 2FA is turned off. The web uses the HttpOnly `ftz_td` cookie and needs no code.

User-facing help: `apps/web/src/content/help/settings/two-factor-authentication.mdx`.

## Mobile

**Sign-in second step** (`apps/mobile/app/(auth)/login.tsx`, `src/components/auth/TwoFactorStep.tsx`): when `auth.login` returns `twoFactorRequired` the form is swapped for the code step. Six digits auto-submit (`keyboardType` number-pad, `textContentType` oneTimeCode, `autoComplete` sms-otp on Android and one-time-code on iOS); "Use a backup code instead" switches to a `XXXXXX-XXXXXX` field; "Trust this device for 30 days" is a switch, off by default. Errors map through the pure `mapVerifyError` (`src/lib/two-factor-login.ts`): wrong code stays on the step and clears the field, an expired challenge returns to the password step with the server message, a lockout disables the form and shows "Too many attempts. Try again at <time>". Success is the same as a password login (`useAuthStore.login`, `router.replace`).

**Shared helpers**: the pure formatters (`formatTotpInput`, `formatBackupCodeInput`, `isCompleteBackupCode`, `parseUnlockTime`, `lockedMessage`, `backupCodesFileContent`, `groupKey`) live in `packages/shared/src/two-factor-format.ts` and are used by web (re-exported from `apps/web/src/lib/two-factor.ts`) and mobile.

**Client kind**: mobile does not send `X-Fintranzact-Client`, so `buildLoginInput` and `buildVerifyInput` (`src/lib/trusted-device.ts`) always set `client: "mobile"`; the server then returns the trusted-device token in the response body.

**Trusted-device token**: stored in expo-secure-store under `fintranzact_trusted_device_token` (all access wrapped in try/catch; a failure just means a code is asked for). Sent as `trustedDeviceToken` on every `auth.login`. It survives sign-out. It is cleared when a login that carried it still returns a challenge (expired or revoked), when 2FA is turned off, when the user revokes this device, and on "Revoke all".

**Security screen** (Settings, Security, Two-factor authentication; `app/(app)/(more)/settings/security.tsx`, row shows On/Off from `auth.me`): status card; enable sheet (QR from the PNG data URL, grouped manual key with copy via expo-clipboard, authenticator-app hints, confirm code, then backup codes shown once with Copy and Save / Share through the React Native Share API; Done stays disabled until "I saved these codes" is switched on); disable (password + code, server refusals such as the organisation-enforced message shown inline); new backup codes (password + authenticator code only); trusted devices with a "This device" badge (the stored token is passed to `auth.listTrustedDevices` so `current` works), Revoke and Revoke all. No native dependency was added, so no dev-client rebuild is needed. Not yet exercised on a physical device.

## CLI

`fintranzact login` calls `auth.verifyTwoFactor` when the account has two-factor on. The code comes from `--code <code>`, the `FINTRANZACT_2FA_CODE` environment variable, or an interactive prompt (up to three tries); with none of those and no terminal it exits with a hint. The CLI sends `client: "cli"` and never remembers a device. API keys and MCP are unaffected. (This also fixed an older mismatch: the CLI read `sessionId` from the login response, which the API has always called `sessionToken`.)

## Organisation enforcement

An organisation owner can require 2FA. The policy is three columns on control `tenants`: `two_factor_policy`, `two_factor_enforced_at`, `two_factor_grace_days`.

| Policy | Covers |
|---|---|
| `off` (default) | nobody |
| `admins` | roles `owner`, `superadmin`, `admin` |
| `all` | every member |

**Grace period.** A covered member without 2FA has `max(enforced_at, member's joined date) + grace_days` to set it up (`twoFactorRequiredForMember`, `packages/shared/src/two-factor.ts`). Until then nothing is refused and the countdown is exposed; from the deadline on they are **blocked**. `grace_days = 0` blocks at once. A new member's clock starts when they join.

**Who can change it.** `tenant.setSecurityPolicy({ policy, graceDays? })` (`tenantProcedure`, owner and superadmin only, like billing; `graceDays` 0 to 30, omitted = keep). Rules (`lib/two-factor-policy.ts`, unit tested with a faked store):

- The caller must have 2FA on to set anything but `off` ("Turn on two-factor authentication for your own account first."). This also covers the "only owner with no 2FA, grace 0" lock-out.
- `enforced_at` becomes now when the policy is **tightened** (`off` to `admins`/`all`, `admins` to `all`) or `graceDays` changes while a policy is on (everyone's grace restarts). Relaxing keeps it. `off` clears it (nothing is blocked).
- No change = no write and no event. A real change records `2fa.policy_changed` (actor, tenant, `from`/`to` policy and grace days, `enforcedAt`) and invalidates the gate cache for the organisation.
- It is in `READ_ONLY_EXEMPT` (works while read-only) and in the role sweep as owner-only.

**The gate.** `twoFactorGate` in `trpc.ts` sits after `hasTenantAccess` and before `entitlementGate` on `tenantProcedure`, `businessProcedure` and `authorizedProcedure`. The decision is the pure `twoFactorGateDecision` (`lib/two-factor-gate.ts`): skip API keys (`ctx.authTokenKind === null`), users with 2FA, policy off or not covering the role, and users with no membership (platform admins); otherwise block from the deadline on, except for the allowlist. Data: ONE control query per request (membership + policy + `users.two_factor_enabled`) cached 30 s per (organisation, user) (`lib/two-factor-gate-cache.ts`, same style as the entitlements cache). Invalidated when a policy changes (tenant), 2FA is enabled or disabled (user, inside the 2FA store), or a member is removed or changes role. The cache is per process, so a change on another instance is seen within 30 s, except that a cached "blocked" verdict is re-read once before it refuses, so someone who has just turned 2FA on is never kept out. A missing membership is never cached.

**Error shape.** `FORBIDDEN`, message `Your organisation requires two-factor authentication. Set it up in Settings → Account → Security to continue.`, and `error.data.twoFactor = { required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" }` (added by the errorFormatter, like `data.entitlement`). Clients read it with `twoFactorFromError` (`@fintranzact/shared`).

**What a blocked user can still do.** Everything on `protectedProcedure`/`publicProcedure` never reaches the gate: `auth.*` (sign in/out, `auth.me`, enrolment: `twoFactorBeginSetup`, `twoFactorConfirmSetup`, backup codes), `tenant.list`, `tenant.select`, `billing.overview` and friends. On the organisation-scoped bases only the allowlist `TWO_FACTOR_GATE_ALLOWED_PATHS` passes: `tenant.current` and `billing.status` (the client needs them to render the setup prompt). Everything else, reads included, is refused. They are unblocked the moment enrolment is confirmed.

**Status for clients.** `tenant.current` returns `twoFactorPolicy`, `twoFactorGraceDays` and `twoFactorRequirement: { required, blocked, graceEndsAt, policy, setupPath }` for the caller (always `required: false` for API keys). `tenant.members` returns `twoFactorEnabled` per member to owner, superadmin and admin callers only. `platform.tenant` includes the policy and grace days.

**API keys are exempt by design** (they never do 2FA). A CLI/MCP session signed in with a password is gated: the clients map `data.twoFactor.required` to a distinct `two_factor_required` error ("...Turn it on in the web or mobile app (Settings → Account → Security) or use an API key."); the CLI exits with `EXIT.TWO_FACTOR_REQUIRED` (11). REST routes outside tRPC (store, webhooks) are not behind this gate.

**Clients.**
- Web: Settings → Team has the policy card (owner edits with a confirmation that explains the effect; admins read-only), a Two-factor column (On / Not set up) and "N of M members still need to set up". `TwoFactorBanner` (mounted beside `BillingBanner`) shows the deadline during grace and a red alert when blocked; the root effect (priority 2b, after complete-profile) redirects a blocked user to Settings → Account → Security from any page except settings, auth, pricing, invite, help and public pages. Settings accepts `?tab=account&pane=security`. A blocked user's Settings page shows only the Account tab. `handleTwoFactorError` (central query/mutation handler) toasts with a "Set up two-factor" action (deduped). The Security tab disables "Turn off" with an explanation when the policy covers the user.
- Mobile: `TwoFactorBanner` in `(app)/_layout.tsx`, `twoFactorBannerFor` (pure), `handleTwoFactorError` (Alert, deduped, opens the Security screen). A blocked member skips the business-list wait and is sent to the Security screen once.

**Lockout recovery.** A blocked user signs in normally and sets 2FA up (a backup code works at sign-in for someone who lost their phone). If they have neither, a platform admin resets their 2FA (see below) or an owner relaxes the policy (an owner who is themselves blocked cannot call `tenant.setSecurityPolicy`: another owner, or a platform admin, does it).

## Platform-admin reset

A user who has lost the phone **and** the backup codes cannot sign in. A platform admin (env-driven, `PLATFORM_ADMIN_EMAIL(S)`) resets their 2FA after checking identity. Web: Platform, Organisations, open the organisation, Members, **Reset 2FA** (shown only when the member has 2FA on and is not you).

`platform.resetTwoFactor({ userId, tenantId?, confirmEmail, verification: { method, checks, reference?, reason } })` (`platformAdminProcedure`, in `READ_ONLY_EXEMPT` like the other `platform.*` mutations; logic in `lib/two-factor-reset.ts` with an injected store, unit tested):

- **Never your own.** An admin cannot reset their own 2FA (`BAD_REQUEST`); ask another admin.
- **Typed confirmation.** `confirmEmail` must equal the target's email (case-insensitive).
- **Identity-check policy.** `method` is one of `video_call`, `government_id_matched`, `callback_registered_phone`, `owner_attestation`, `support_ticket`. `checks` must contain **at least two** distinct items of: `name_matches_account`, `email_ownership_confirmed`, `recent_invoice_or_gstin_detail_confirmed`, `last_login_detail_confirmed`, `organisation_owner_vouched`. `reason` is at least 20 characters; `reference` (ticket id) is optional. The lists, labels and the validator (`validateResetVerification`) live in `packages/shared/src/two-factor.ts` and are used by the API and the web form.
- **Effect.** One transaction deletes `user_two_factor` and all `two_factor_backup_codes`, revokes every trusted device, deletes pending `two_factor_challenges` and sets `users.two_factor_enabled = false`. Then the gate cache is invalidated and **every** session of the user is revoked (`rotateSessionsOnPrivilegeEvent(userId)` with no kept session). The user signs in with the password alone.
- **Who is told.** The user is emailed ("Two-factor authentication was reset on your Fintranzact account": platform support did it, when, that they were signed out, to set it up again, and to contact support if they did not ask for it). An email failure is logged and returned as `emailSent: false`; it does not undo the reset.
- **Audit.** `2fa.reset_by_admin` in `security_events`: `actor_user_id` = the admin, `user_id` = the target, `tenant_id` when given, metadata `{method, checks, reference, reason, ip}`.
- **Result.** `{ reset: true, emailSent, message }`. A user without 2FA gives `{ reset: false, message }` and nothing is changed or recorded.
- **No grace needed afterwards.** If the user's organisation enforces 2FA, enforcement is computed from `enforced_at` / member start, so a past deadline still applies. That is fine: a blocked user can always reach `auth.*` (sign in, enrolment) and `tenant.current`, so they sign in with the password and set 2FA up again from Settings, Account, Security with no extra state.

### Runbook: user lost their phone and backup codes

1. Do not reset on a chat or email request alone. Pick a verification method and run it (video call; ID matched to the account; call back on the registered number; the organisation owner vouching from a known address; or a support ticket that went through one of these).
2. Confirm at least two checks: name, ownership of the account email, a recent invoice or GSTIN detail, a recent sign-in detail, owner vouching.
3. Open the organisation in the platform console, find the member, **Reset 2FA**. Choose the method, tick the checks, add the ticket reference, write the reason (what was checked), type the email, submit. If the user is you, ask another admin.
4. Tell the user to sign in with their password and set up 2FA again. If the organisation requires 2FA they will be asked to do this straight away.
5. Check the **Security activity** list in the organisation panel: the reset is highlighted with method, reference and reason.
6. If the user says they never asked: treat the account as compromised (password reset, review sessions) and look at `2fa.*` events around the reset.

## Audit trail

`security_events` (control DB) holds user-level events; the tenant `audit_log` is business-scoped and does not fit them. Event types: `2fa.setup_started`, `2fa.enabled`, `2fa.disabled`, `2fa.verified` (metadata `method`: `totp` or `trusted_device`), `2fa.failed`, `2fa.locked`, `2fa.backup_used`, `2fa.backup_regenerated`, `2fa.device_trusted`, `2fa.device_revoked`, `2fa.reset_by_admin`, `2fa.policy_changed`, `access.removed` (a member was removed from an organisation; metadata `role`, `email`, `apiKeysRevoked`, `businessesRevoked`, `removedBy`; see ACCOUNTANT-ACCESS.md). Labels are `SECURITY_EVENT_LABELS` in `@fintranzact/shared`.

| Procedure | Who | Returns |
|---|---|---|
| `auth.securityActivity({ limit? })` (query, `protectedProcedure`) | the caller | Their **own** events only, newest first, limit 1 to 100 (default 20): `{id, type, label, createdAt, ip, device, method}`. Never codes, secrets, raw metadata or the raw user agent. Shown in Settings, Account, Security ("Recent security activity") and on the mobile Security screen. |
| `platform.securityEvents({ userId?, tenantId?, type?, limit?, cursor? })` (query, `platformAdminProcedure`) | platform admins | `{ items, nextCursor }`, newest first, default 50, max 100. Items include `user`, `actor`, `tenantId`, `ip`, `userAgent` and full `metadata`. With `tenantId` it returns events recorded for that organisation **and** events about its members. Shown in the organisation panel ("Security activity", resets highlighted). `cursor` is the previous `nextCursor` (a timestamp). |

`platform.tenant` members now include `twoFactorEnabled` (the 2FA on/off badge).

## Key handling

- TOTP secrets are encrypted with `ENCRYPTION_KEY`. It is **required for 2FA**: without it (outside `NODE_ENV=test`) setup and verification fail closed rather than storing a secret in plaintext.
- Rotating the key with `packages/api/src/bin/rotate-key.ts` re-encrypts `user_two_factor.secret_enc` along with the other encrypted columns.
- Backup-code hashes are `sha256("fintranzact:2fa-backup:v1:<userId>:<NORMALISED CODE>")`. They do **not** depend on `ENCRYPTION_KEY`, so rotating (or losing) the key never invalidates backup codes. The codes carry about 59 bits and are single use, so a salted fast hash is adequate; the user id keeps the table from being reusable across accounts.

## Tests

`src/__tests__/two-factor.test.ts` (faked data layer), `two-factor-login.test.ts` (challenge, attempts, lockout, trusted devices, cookie rules; faked data layer), `two-factor-router.test.ts` (API-key rejection), `two-factor-codes.test.ts`, `totp.test.ts`, `two-factor-gate.test.ts` (pure gate decision, allowlist, error shape, cache invalidation), `two-factor-policy.test.ts` (setSecurityPolicy rules), `two-factor-reset.test.ts` (platform reset rules and email; faked store), `security-activity.test.ts` (own-events view, safe fields, limit clamp), `integration/two-factor-admin-reset.test.ts` (real Postgres), and `integration/two-factor-enforcement.test.ts` (policy, blocked/unblocked, API key, members flag; real Postgres), and `integration/two-factor-enrolment.test.ts` / `integration/two-factor-login.test.ts` (real Postgres). The CLI has `packages/cli/src/__tests__/two-factor-login.test.ts`.
