# Backup and recovery

Owner: [engineering lead]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** The repo has backup tooling: `scripts/backup.sh` (run by the `backup` service in `docker-compose.prod.yml` on `BACKUP_CRON`, default 02:00) makes a `pg_basebackup` and a plain SQL dump per database, test-restores each dump into a scratch database, optionally encrypts with `age` (`BACKUP_ENCRYPTION_KEY`), uploads to R2/S3 with `rclone`, and keeps `BACKUP_RETENTION_DAYS` (default 30). `scripts/restore-db.sh` restores one database; `scripts/test-backup-restore.sh` exercises it. **Not confirmed for the live deployment:** whether production runs on this stack or on managed Railway/AWS Postgres backups, whether backups are encrypted and copied to another region, and nobody has scheduled a restore test. Fill the targets and the "current setup" lines in before you rely on this page.

## Targets (decide and write down)

| | Target | Today |
|---|---|---|
| RPO (data you can lose) | [e.g. 24 h with daily dumps; 5 min with WAL archiving/point-in-time recovery] | [daily dump; WAL archiving is described in `SECURITY.md` for self-hosting, not confirmed live] |
| RTO (time to be back) | [e.g. 4 h] | not measured |
| Retention | 30 days daily, [12 months monthly] | 30 days by default |
| Copies | primary + encrypted copy in another region/provider | [R2/S3 if configured] |

## Rules

1. Backups are **encrypted** before they leave the database host (`age` with `BACKUP_ENCRYPTION_KEY`, or provider KMS). The backup key is stored separately from the backups, in two places, never only in the environment of the server it protects.
2. A copy lives in **another region or provider** and under another account login that the production credentials cannot delete (object lock/versioning if available).
3. **Quarterly restore test**: restore the latest backup into a scratch environment, start the API against it, sign in, open a recent invoice and one e-invoice setting, run `pnpm data:audit`, and note how long it took (that is your measured RTO). Keep the note as evidence ([calendar.md](calendar.md)).
4. **`ENCRYPTION_KEY` dependency.** Credentials in a restored database (Razorpay keys, e-invoice logins, 2FA secrets, tenant DB passwords) can only be read with the key that wrote them. Keep every key that any retained backup used in `ENCRYPTION_KEYS_PREVIOUS` or in the secrets manager ([key-rotation.md](key-rotation.md)). A backup without its key restores the books but loses the credentials, and every user's 2FA would fail.
5. Erasures done since the backup was taken must be re-applied after a restore ([retention-and-deletion.md](retention-and-deletion.md)).

## Layout of the data to restore

- **Single-database / "unified" mode** (`MULTI_TENANT=false`): one PostgreSQL database holds both the control tables (users, tenants, sessions, 2FA, share links, billing) and the tenant tables (businesses, invoices, payroll...). One dump restores everything.
- **Multi-tenant mode** (`MULTI_TENANT=true`): one **control** database plus one **tenant** database per organisation, named in `tenants.db_name`, with its password encrypted in `tenants.db_password`. Restore the control database first; the tenant password inside it needs the encryption key to connect. Then restore each tenant database. `restore-db.sh <database>` restores a single one (a single organisation can be restored without touching the others).

## Restore procedure (this app)

1. Declare the incident, put the site in maintenance mode (`pnpm --filter @fintranzact/api maintenance`), stop the API so nothing writes.
2. Take a snapshot of the current (broken) database first; you may need it.
3. Fetch the chosen backup from the offsite copy. If encrypted: `echo "$BACKUP_ENCRYPTION_KEY" | age -d -o dump.sql.gz dump.sql.gz.age`.
4. Restore. Control or unified database: `scripts/restore-db.sh fintranzact [dump file]`. A tenant: `scripts/restore-db.sh tenant_acme [dump file]`. (The script drops and recreates the target database; read it and `docs/ROLLBACK.md` section 1a first.)
5. Set the environment: `ENCRYPTION_KEY` (the current key) and `ENCRYPTION_KEYS_PREVIOUS` with every older key a restored value may use.
6. Start the API (migrations run at start; a restored older schema is brought forward by the migration runner, see `docs/ROLLBACK.md` "Which migrations run where").
7. Verify: `pnpm data:audit`; sign in as a test user; open an invoice; check a Razorpay connection shows "connected" and an e-invoice config decrypts (the settings page loads without an error); if an old key was needed, run the rotation tool afterwards.
8. Revoke all sessions if the incident involved account compromise; tell customers what period of data was lost (RPO) in plain words.
9. Leave maintenance mode, watch for 24 hours, write the review.

## Gaps

No scheduled restore test; unknown offsite/encryption state on the live service; no point-in-time recovery confirmed; RTO never measured; backup key custody not documented.
