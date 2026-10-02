# Two-factor authentication

Status: **enrolment API built (part 2 of 7).** Sign-in challenge, organisation enforcement at login, trusted devices, platform-admin reset and the web/mobile/desktop screens follow in later parts. Sign-in behaves exactly as before until then.

## Model

TOTP (RFC 6238, 6 digits, 30 s, SHA-1) plus ten single-use backup codes. No SMS.

| Table | Purpose |
|---|---|
| `users.two_factor_enabled` | Cheap flag (`auth.me` reads it). |
| `user_two_factor` | One row per user: `secret_enc` (TOTP secret, AES-256-GCM), `confirmed_at` (null = setup pending), `last_used_step` (replay guard), `failed_count`, `locked_until`, `lockout_count`. |
| `two_factor_backup_codes` | `code_hash` (sha256) and `used_at`; plaintext is shown once and never stored. |
| `trusted_devices` | Remembered devices (Part 3). Disabling 2FA sets `revoked_at` on all of them. |
| `security_events` | Append-only trail (`2fa.setup_started`, `2fa.enabled`, `2fa.disabled`, `2fa.verified`, `2fa.failed`, `2fa.locked`, `2fa.backup_used`, `2fa.backup_regenerated`, ...). Recording never throws. |
| `tenants.two_factor_policy / two_factor_enforced_at / two_factor_grace_days` | Per-organisation enforcement (`off` / `admins` / `all`). |

Code: `packages/api/src/lib/two-factor.ts` (logic, injected data layer), `lib/two-factor-store.ts` (Postgres), `lib/totp.ts`, `lib/two-factor-codes.ts`, `routers/auth.ts` (procedures), `packages/shared/src/two-factor.ts` (constants and pure rules).

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

Five consecutive wrong codes lock verification: 15 minutes, then 1 hour, then 24 hours (`lockoutDuration`). While locked even a correct code is refused and adds no failure. Any success resets the counters. Counting is one atomic `UPDATE`. Disable and regenerate also feed the existing per-email failed-login limiter (5 per 15 minutes, shared with sign-in), so they cannot be used to brute-force the password. Accounts with no password skip the password check and need only the code.

## Replay and single use

- TOTP: `UPDATE ... SET last_used_step = $step WHERE last_used_step IS NULL OR last_used_step < $step`; only the caller that wins is accepted. The code used to confirm setup counts as used, so a fresh code (next 30 s step) is needed straight after.
- Backup codes: `UPDATE ... SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`.

`verifySecondFactor(deps, userId, code, {allowBackup})` in `lib/two-factor.ts` implements all of this and is what the sign-in challenge (Part 3) reuses.

## Key handling

- TOTP secrets are encrypted with `ENCRYPTION_KEY`. It is **required for 2FA**: without it (outside `NODE_ENV=test`) setup and verification fail closed rather than storing a secret in plaintext.
- Rotating the key with `packages/api/src/bin/rotate-key.ts` re-encrypts `user_two_factor.secret_enc` along with the other encrypted columns.
- Backup-code hashes are `sha256("fintranzact:2fa-backup:v1:<userId>:<NORMALISED CODE>")`. They do **not** depend on `ENCRYPTION_KEY`, so rotating (or losing) the key never invalidates backup codes. The codes carry about 59 bits and are single use, so a salted fast hash is adequate; the user id keeps the table from being reusable across accounts.

## Tests

`src/__tests__/two-factor.test.ts` (faked data layer), `two-factor-router.test.ts` (API-key rejection), `two-factor-codes.test.ts`, `totp.test.ts`, and `integration/two-factor-enrolment.test.ts` (real Postgres: enrol, status, rotation, disable, org enforcement).
