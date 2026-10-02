# Two-factor authentication

Status: **enrolment API (part 2) and sign-in challenge with trusted devices (part 3) built.** Organisation enforcement at login, platform-admin reset and the web/mobile/desktop screens follow in later parts. Until the web and mobile screens exist, those apps show "Two-factor sign-in is not available in this version yet" for a two-factor account; the CLI already prompts for a code.

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

## CLI

`fintranzact login` calls `auth.verifyTwoFactor` when the account has two-factor on. The code comes from `--code <code>`, the `FINTRANZACT_2FA_CODE` environment variable, or an interactive prompt (up to three tries); with none of those and no terminal it exits with a hint. The CLI sends `client: "cli"` and never remembers a device. API keys and MCP are unaffected. (This also fixed an older mismatch: the CLI read `sessionId` from the login response, which the API has always called `sessionToken`.)

## Key handling

- TOTP secrets are encrypted with `ENCRYPTION_KEY`. It is **required for 2FA**: without it (outside `NODE_ENV=test`) setup and verification fail closed rather than storing a secret in plaintext.
- Rotating the key with `packages/api/src/bin/rotate-key.ts` re-encrypts `user_two_factor.secret_enc` along with the other encrypted columns.
- Backup-code hashes are `sha256("fintranzact:2fa-backup:v1:<userId>:<NORMALISED CODE>")`. They do **not** depend on `ENCRYPTION_KEY`, so rotating (or losing) the key never invalidates backup codes. The codes carry about 59 bits and are single use, so a salted fast hash is adequate; the user id keeps the table from being reusable across accounts.

## Tests

`src/__tests__/two-factor.test.ts` (faked data layer), `two-factor-login.test.ts` (challenge, attempts, lockout, trusted devices, cookie rules; faked data layer), `two-factor-router.test.ts` (API-key rejection), `two-factor-codes.test.ts`, `totp.test.ts`, and `integration/two-factor-enrolment.test.ts` / `integration/two-factor-login.test.ts` (real Postgres). The CLI has `packages/cli/src/__tests__/two-factor-login.test.ts`.
