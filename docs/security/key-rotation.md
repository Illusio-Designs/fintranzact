# Encryption key rotation

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** Implemented and tested: the `v3` envelope with a key id, `ENCRYPTION_KEYS_PREVIOUS`, the rotation tool with dry run, resume and verification, and a test that fails when a new encrypted column is not in the tool. **Not done:** a rotation has never been run on production data (do a rehearsal on a restored backup first, see the runbook), and keys still live in environment variables, not a secrets manager (see [secrets-management.md](secrets-management.md)).

## What `ENCRYPTION_KEY` protects

One AES-256-GCM key encrypts these columns (single list in code: `ENCRYPTED_TARGETS` in `packages/api/src/lib/key-rotation.ts`). A test (`integration/key-rotation.test.ts`) fails if the database gets another `*_encrypted` / `*_enc` column that is not in that list.

| Database | Table.column | What it holds |
|---|---|---|
| control | `tenants.db_password` | Password of a tenant's own database (multi-tenant mode) |
| control | `user_two_factor.secret_enc` | A user's authenticator (TOTP) secret |
| control | `share_links.token_encrypted` | The token of a public document link (so the owner can copy the link again) |
| tenant | `e_invoice_configs.client_id, client_secret, username, password, auth_token` | E-invoice (IRP/GSP) credentials of a business |
| tenant | `eway_bill_configs.client_id, client_secret, username, password, auth_token` | E-way bill (NIC) credentials of a business |
| tenant | `razorpay_connections.key_id_encrypted, key_secret_encrypted, webhook_secret_encrypted, webhook_token_encrypted` | A business's own Razorpay keys and webhook secret and token |
| tenant | `businesses.carrier_credentials` (JSON: `apiKey`, `apiSecret`, `accountId` per carrier) | Courier API credentials |
| tenant | `employees.aadhaar` | An employee's Aadhaar number (payroll). Numbers saved before encryption was added are plain digits until the tool runs; it encrypts them and counts them as "from plaintext" |

"Tenant" tables live in the same database as the control tables in single-database mode (`MULTI_TENANT=false`) and in one database per organisation in multi-tenant mode. The tool handles both.

**Not encrypted but arguably should be** (not changed here): employee PAN, UAN, ESIC number and bank account number, and the bank account numbers on businesses and parties, are plain text columns (masked on read, never logged). See [data-classification-and-handling.md](data-classification-and-handling.md). If they are encrypted later, add them to `ENCRYPTED_TARGETS` so rotation covers them. The employee Aadhaar number is already encrypted (see the table above): a production server with no `ENCRYPTION_KEY` refuses to save one, and a value that no configured key opens is shown as empty, never as ciphertext.

Also derived from the key, but **not stored**:

- Export download tokens (`lib/exportToken.ts`) are HMAC-signed with `ENCRYPTION_KEY`. They live minutes, so a rotation just invalidates tokens in flight.
- The trial-claim hash salt falls back to `DB_ENCRYPTION_KEY` when `TRIAL_CLAIM_SALT` is not set. Set `TRIAL_CLAIM_SALT` once and never change it; otherwise a key change would break trial-abuse matching (`docs/TRIAL.md`).
- Backup-code hashes for 2FA do **not** use the key (by design).

Observed while writing this, not changed here: invitation tokens (`invitations.token`) and session ids (`sessions.id`, `access_tokens.id`) are stored in clear (they are random, short-lived or revocable, but a database read would expose live sessions). Hashing them is a reasonable follow-up.

## Format

```
v3:<keyId>:<iv hex>:<auth tag hex>:<ciphertext hex>      written today
v2:<iv>:<tag>:<ciphertext>                                written before key ids; still readable
<iv>:<tag>:<ciphertext>                                   older still ("v1"); still readable
anything else                                             plaintext (development without a key)
```

The cipher is unchanged (AES-256-GCM, random 16-byte IV, no additional data), so every value written before this change keeps decrypting with the same key. `keyId` is the label in `ENCRYPTION_KEY_ID` or, by default, the first 4 bytes of a SHA-256 of the key (8 hex characters; one-way, not the key).

Configuration:

| Variable | Meaning |
|---|---|
| `ENCRYPTION_KEY` | Current key (64 hex). Used for every new encryption. |
| `ENCRYPTION_KEY_ID` | Optional label, letters/digits/`-`/`_`, up to 32 characters. |
| `ENCRYPTION_KEYS_PREVIOUS` | Old keys, decrypt only. Comma separated or a JSON array; each is `<64 hex>` or `<label>=<64 hex>`. `ENCRYPTION_KEY_PREVIOUS` (one key) is still read. |

Decrypting: try the keys whose id equals the value's id first, then the rest (v1/v2 values carry no id, so all keys are tried; GCM authentication makes a wrong key fail cleanly). `decryptFieldStrict` (used by the rotation tool and verification) **fails closed** with `EncryptionError`, whose message names the format and key id only, never a key or a value. The older `decryptField` keeps its lenient behaviour for existing callers (returns the input when nothing opens it); moving the request paths to the strict version is a follow-up because it changes what users see when a key is wrong.

**Deploy caveat.** After this release writes `v3`, an older build cannot read `v3` values. Rolling the app back past this release needs the older code to be able to read what was written since; do not roll back across it without checking `docs/ROLLBACK.md` and this note. The rotation tool leaves `v2` values readable by both until you run it.

## The tool

```
pnpm --filter @fintranzact/api exec tsx src/bin/rotate-encryption-key.ts --dry-run   # counts only, writes nothing
pnpm --filter @fintranzact/api exec tsx src/bin/rotate-encryption-key.ts             # rotate, then verify
pnpm --filter @fintranzact/api exec tsx src/bin/rotate-encryption-key.ts --verify-only
```

- Walks the control database, then every tenant database (`MULTI_TENANT=true`) or the one shared database.
- Batches of 200 rows (`--batch-size`), one transaction per batch, rows locked `FOR UPDATE` so a user saving a credential during the run is never overwritten by an older value.
- Idempotent and resumable: a value already `v3` under the current key id is skipped. Stop it any time and run it again.
- A value no configured key opens is reported (table, column, row id) and left untouched; the run continues and exits `1`.
- Final pass: every encrypted value must be `v3` under the current key id **and** decrypt with the current key alone (previous keys ignored). Exit `0` only when that holds.
- Output is counts and row ids. It never prints a value, a ciphertext or a key.
- Exit codes: `0` done and verified, `1` a value failed or verification found a problem, `3` bad usage or no `ENCRYPTION_KEY`.
- Readers keep working during the run, because both keys decrypt (tested with concurrent reads).

## Runbook: rotate yearly, or at once after a suspected leak

Rehearse once on a restored copy of a backup first (see [backup-and-recovery.md](backup-and-recovery.md)).

1. Back up the database and **store the old key safely** (secrets manager or a sealed envelope held by two people). An old backup needs the key it was written under.
2. Generate the new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Give it a label if you like: `ENCRYPTION_KEY_ID=2027-main`.
3. Set `ENCRYPTION_KEYS_PREVIOUS=<old key>` (append to the list if there already are older keys) and `ENCRYPTION_KEY=<new key>`. Deploy the API. New writes now use the new key; old values still read.
4. Run the tool with `--dry-run`, read the counts, then run it for real from a shell that has the same environment as the API (Railway shell or a one-off job).
5. Confirm exit code `0` and the line "Verified under the current key alone: N; problems: 0".
6. Keep the old key in `ENCRYPTION_KEYS_PREVIOUS` until every backup you may still restore has aged out (30 days by default), then remove it and redeploy. After that the old key can be destroyed.
7. Record the date, who did it and the verification line in the calendar evidence ([calendar.md](calendar.md)).

If the key leaked: rotate as above **and** consider the credentials themselves exposed. Ask businesses to rotate their Razorpay keys and e-invoice passwords, and follow [incident-response-plan.md](incident-response-plan.md).

If the tool reports a value no key opens: you are missing an old key. Find it (older backups of the environment, the secrets manager history) and add it to `ENCRYPTION_KEYS_PREVIOUS`; if it is truly lost, that business must re-enter that credential.

## What the tests cover

`crypto-key-rotation.test.ts` (unit): round trip, key id in the value and not the key, label validation, v1/v2 values decrypt, previous keys in each accepted format, rotation of a value, no-key and wrong-key errors leak nothing, tampering in any part of the envelope is detected. `integration/key-rotation.test.ts` (real Postgres): every column above rotates and decrypts, dry run changes nothing, second run changes nothing, resume, plaintext gets encrypted, a missing previous key fails closed without writing or leaking, one bad value does not stop the rest, tampering is caught by verification, reads during a rotation, and the script's exit codes.
