# Rollback Procedures

How to roll back a bad release of Fintranzact, including its database migrations. Drizzle does not generate down migrations, so this document gives the general approach first, then reverse SQL or a restore note for every migration.

**Last updated**: 2026-10-01
**Applies to**:
- Unified set `packages/db/drizzle/` — 0000 through 0036 (37 migrations in `meta/_journal.json`)
- Control set `packages/db/drizzle-control/` — 0000 through 0008 (9 journal entries, 8 SQL files; see [Known issues](#7-known-issues-in-the-migration-sets))
- Tenant set `packages/db/drizzle-tenant/` — 0000 through 0025 (26 migrations)

---

## Which migrations run where

The runner is `packages/db/src/migrate.ts`. The API container runs it on start (`docker-entrypoint.sh` calls `node /app/packages/db/dist/migrate.mjs`).

| Mode | When | Migration set | Target | Tracking table |
|---|---|---|---|---|
| Single database (self-hosted) | `MULTI_TENANT` is not `"true"` | `drizzle/` (unified) | `DATABASE_URL` | `drizzle.__drizzle_migrations` |
| Multi-tenant | `MULTI_TENANT=true` | 1. `drizzle-control/` | `CONTROL_DATABASE_URL` (falls back to `DATABASE_URL`) | `drizzle.__drizzle_control_migrations` |
| | | 2. `drizzle-tenant/`, for every tenant with `status = 'active'`, 5 at a time | each tenant database, connected as the admin user from the control URL | `drizzle.__drizzle_tenant_migrations` (in each tenant DB) |

Other facts from `migrate.ts` that matter for rollback:

- A Postgres advisory lock (`pg_advisory_lock(72919283)`) stops two runners migrating the same database at once.
- If the control migrations fail, the runner stops and exits 1. A failing tenant is logged and skipped; the other tenants still migrate.
- New tenants are migrated when they are created (`migrateSingleTenantDb`, called from `provision-tenant.ts`).
- A database that has tables but an empty tracking table (set up with `db:push`) is migrated in "lenient" mode: each statement runs on its own and "already exists" errors are skipped.
- Drizzle applies every migration whose journal `when` value is newer than the newest `created_at` in the tracking table, all in one transaction. The `created_at` it stores is the journal `when` value (when the migration was generated), **not** the time it was applied.

---

## 1. General Approach

Work through these in order. Most incidents end at step 1 or 2.

### Step 1: Roll the app back to the previous image or commit

Every migration added since 0010 is additive (new tables, new nullable or defaulted columns, new enum values, new indexes). Older app code ignores tables and columns it does not know about, so the previous release normally runs fine on the newer schema. Roll back the code first and leave the schema alone.

- **Docker Compose (production)**: the API image is tagged with both `latest` and the commit SHA (see [`DEPLOYMENT.md`](DEPLOYMENT.md)). Pin the previous SHA and restart:
  ```bash
  # in .env.prod
  FINTRANZACT_API_IMAGE=ghcr.io/<owner>/fintranzact-api:<previous-sha>

  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api
  ```
- **Built from source**: check out the previous commit and redeploy.

The older code has fewer migration files, so its runner has nothing to apply and leaves the newer schema in place.

Exceptions — rolling back the code alone is not enough when the bad release:
- ran a **data change** (see the "Reverse" column in [section 4](#4-migrations-0010-and-later-unified-control-tenant)), or
- wrote bad data through the app.

For those, go to step 3.

### Step 2: Prefer a forward "fix" migration

If the schema itself is wrong, fix it with a **new** migration rather than hand-reversing the old one:

1. Change the schema in `packages/db/src/control-schema.ts` / `tenant-schema.ts`.
2. Generate the migration for all three sets: `pnpm --filter @fintranzact/db db:generate` (runs drizzle-kit with `drizzle.config.ts`, `drizzle-control.config.ts` and `drizzle-tenant.config.ts`).
3. Release it like any other change.

A forward migration is tracked, reviewed and tested like normal code, and it keeps every environment's tracking table consistent. Hand-run reverse SQL does not.

### Step 3: Restore from backup for data problems

Use a backup when data was lost or corrupted, or when a migration's data change must be undone. Backups come from:

- `scripts/backup.sh` — run by the `backup` service in `docker-compose.prod.yml` (image built from `Dockerfile.backup`) on `BACKUP_CRON` (default `0 2 * * *`). It writes a `pg_basebackup` (`base_<timestamp>.tar.gz`) and a plain SQL dump per database (`dump_<db>_<timestamp>.sql.gz`) to `/var/backups/fintranzact`, test-restores each dump into a scratch database, optionally encrypts with `age` (`BACKUP_ENCRYPTION_KEY`), uploads to R2/S3 with `rclone` when `R2_*` is set, and keeps `BACKUP_RETENTION_DAYS` days (default 30).
- `scripts/restore-db.sh <database> [dump-file]` — restores one database (latest dump if no file is given). It is installed in the backup image.
- The ONCE image (`Dockerfile.once`) — `/hooks/pre-backup` and `/hooks/post-restore`.
- `scripts/test-backup-restore.sh` — integration test for per-database backup and restore.

Detailed commands are in [Strategy 1](#strategy-1-restore-from-backup-safest) below. In multi-tenant mode you can restore a single tenant database without touching the others.

### Step 4: Reverse SQL (last resort)

Only when steps 1–3 do not fit, for example to remove one small change on one database. See [Strategy 3](#strategy-3-manual-reverse-sql-last-resort), [section 3](#3-migrations-0000-0009-unified-set) and [section 4](#4-migrations-0010-and-later-unified-control-tenant).

---

## 1a. Recovery Strategies in Detail

Note: the Docker Compose commands below are written as `docker compose ...`. In production add `--env-file .env.prod -f docker-compose.prod.yml`; the `backup` service only exists in that file.

### Strategy 1: Restore from Backup (Safest)

Full database restore from a known-good backup taken before the migration ran. This is the only option for migrations 0000-0002 and the recommended approach for 0006.

#### ONCE Container

The pre-backup hook (`/hooks/pre-backup`) creates `pg_dump --format=custom` dumps in `/storage/backups/` before ONCE snapshots the `/storage` volume. The post-restore hook (`/hooks/post-restore`) restores from those dumps.

```bash
# 1. Stop the container (or let ONCE handle it during a restore operation)
docker stop fintranzact

# 2. If restoring manually (outside ONCE's restore flow):
#    Exec into the container and restore the specific database
docker exec -it fintranzact sh

# 3. Wait for PostgreSQL to be ready
SOCKETDIR="/storage/run"
pg_isready -h "$SOCKETDIR" -U postgres

# 4. List available backups
ls -lh /storage/backups/

# 5. If backups are encrypted, decrypt first
echo "$BACKUP_ENCRYPTION_KEY" | age -d -o /storage/backups/fintranzact.dump /storage/backups/fintranzact.dump.age

# 6. Restore (WARNING: this drops and recreates the database)
dropdb -h "$SOCKETDIR" -U postgres --if-exists fintranzact
createdb -h "$SOCKETDIR" -U postgres fintranzact
pg_restore -h "$SOCKETDIR" -U postgres -d fintranzact --no-owner --no-privileges /storage/backups/fintranzact.dump

# 7. Verify
psql -h "$SOCKETDIR" -U postgres -d fintranzact -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
```

If you are using the ONCE platform's built-in restore flow, it will unpack `/storage` from the snapshot and then execute `/hooks/post-restore` automatically. No manual intervention is needed.

#### Docker Compose (backup sidecar)

The backup sidecar runs `scripts/backup.sh` on cron. It creates per-database SQL dumps at `/var/backups/fintranzact/dump_<dbname>_<timestamp>.sql.gz` and full base backups at `/var/backups/fintranzact/base_<timestamp>.tar.gz`.

```bash
# 1. Stop the API to prevent writes during restore
docker compose stop api

# 2. List available backups (exec into backup sidecar or the postgres container)
docker compose exec backup ls -lh /var/backups/fintranzact/

# 3. If encrypted, decrypt first
docker compose exec backup sh -c \
  'echo "$BACKUP_ENCRYPTION_KEY" | age -d -o /var/backups/fintranzact/decrypted.sql.gz /var/backups/fintranzact/dump_fintranzact_20260414_030000.sql.gz.age'

# 4. Restore from SQL dump
docker compose exec -T postgres sh -c \
  'gunzip -c /var/backups/fintranzact/dump_fintranzact_20260414_030000.sql.gz | psql -U fintranzact -d fintranzact'

# If you need a clean restore (drop + recreate):
docker compose exec postgres dropdb -U fintranzact --if-exists fintranzact
docker compose exec postgres createdb -U fintranzact fintranzact
docker compose exec -T postgres sh -c \
  'gunzip -c /var/backups/fintranzact/dump_fintranzact_20260414_030000.sql.gz | psql -U fintranzact -d fintranzact'

# 5. Verify
docker compose exec postgres psql -U fintranzact -d fintranzact -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"

# 6. Restart API
docker compose start api
```

### Single-Tenant Restore (Multi-Tenant Deployments)

In multi-tenant mode, each tenant has its own database (`tenant_<slug>`). Backups produce separate dump files per database, so you can restore a single tenant without affecting others.

**This is the preferred approach when a single tenant's data is corrupted or needs rollback while all other tenants remain operational.**

#### ONCE Container

Set the `RESTORE_DB` environment variable to target a single database:

```bash
# Restore only tenant_acme (other tenant databases are untouched)
docker exec -e RESTORE_DB=tenant_acme fintranzact /hooks/post-restore

# Or restore manually:
SOCKETDIR="/storage/run"
dropdb -h "$SOCKETDIR" -U postgres --if-exists tenant_acme
createdb -h "$SOCKETDIR" -U postgres tenant_acme
pg_restore -h "$SOCKETDIR" -U postgres -d tenant_acme --no-owner --no-privileges /storage/backups/tenant_acme.dump
```

#### Docker Compose (backup sidecar)

Use the `restore-db.sh` script included in the backup sidecar:

```bash
# Restore tenant_acme from the most recent backup
docker compose exec backup restore-db.sh tenant_acme

# Restore from a specific backup file
docker compose exec backup restore-db.sh tenant_acme dump_tenant_acme_20260414_030000.sql.gz

# List available backups for a tenant
docker compose exec backup ls -lht /var/backups/fintranzact/dump_tenant_acme_*
```

#### Verification

After restoring a single tenant, verify the other tenants were not affected:

```bash
# Check tenant_acme is restored
docker compose exec postgres psql -U fintranzact -d tenant_acme -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"

# Verify another tenant is untouched (spot-check a known row count)
docker compose exec postgres psql -U fintranzact -d tenant_beta -c \
  "SELECT COUNT(*) FROM invoices"
```

#### Integration Test

Run `scripts/test-backup-restore.sh` to verify per-tenant backup/restore isolation. This test creates multiple databases, backs them up, corrupts one, restores it, and verifies the others remain untouched. **Run this test after any changes to backup/restore scripts.**

```bash
PGHOST=localhost PGUSER=postgres scripts/test-backup-restore.sh
```

---

### Strategy 2: Point-in-Time Recovery (PITR)

Requires WAL archiving. The ONCE image enables it with `scripts/postgresql-wal.conf` (archives to `/storage/wal_archive/`). `docker-compose.prod.yml` does not; configure it yourself if you want PITR there.

Use PITR when you need the database as it was at a specific moment -- for example, "just before the 14:32 UTC deploy".

```bash
# 1. Find when the migration ran.
#    The tracking table's created_at is the migration's journal "when" value
#    (when it was generated), NOT when it was applied. Use the deploy time or
#    the API container log instead: the runner logs a JSON line with "ts" and
#    "<set>: migrations applied successfully".
docker compose logs api | grep "migrations applied successfully"

# 2. Stop PostgreSQL
#    ONCE: stop the container or kill the postgres process
#    docker-compose: docker compose stop postgres

# 3. Create recovery.signal and set recovery target
#    In the PostgreSQL data directory:
touch /storage/pgdata/recovery.signal

# 4. Add recovery settings to postgresql.auto.conf
cat >> /storage/pgdata/postgresql.auto.conf <<EOF
restore_command = 'cp /storage/wal_archive/%f %p'
recovery_target_time = '2026-04-14 14:30:00+00'
recovery_target_action = 'pause'
EOF
#    Format: 'YYYY-MM-DD HH:MI:SS+TZ'
#    Set the time to BEFORE the migration ran.

# 5. Start PostgreSQL
#    It will replay WAL files up to the target time and pause.

# 6. Verify the state is correct
psql -U postgres -d fintranzact -c \
  "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5"

# 7. If satisfied, resume normal operation
psql -U postgres -d fintranzact -c "SELECT pg_wal_replay_resume()"

# 8. Remove the recovery settings you added
#    Edit postgresql.auto.conf and remove the restore_command, recovery_target_time,
#    and recovery_target_action lines. Then restart PostgreSQL.
```

**Important**: After PITR, the WAL timeline changes. You cannot replay forward past the recovery point. Take a fresh backup immediately after completing PITR. PITR restores the whole cluster, so in multi-tenant mode it rolls back every tenant database on that server.

### Strategy 3: Manual Reverse SQL (Last Resort)

Use when backup restore is impractical and you only need to undo a small change (such as a column add) on a known database.

**Rules**:
1. ALWAYS take a backup before running manual rollback SQL.
2. Run the SQL in a transaction (`BEGIN; ... COMMIT;`). On PostgreSQL 16 every step used here, including the ENUM type-swap, is transactional, so a failure rolls back cleanly.
3. Roll back newest first. A migration cannot be reversed while a later migration still depends on it (for example 0014's `warehouses` table is referenced by 0016–0018, 0030 and 0033).
4. After rollback, delete the tracking row (see [below](#after-manual-rollback-clean-up-migration-tracking)).
5. Deploy app code that does not need the removed schema **before** or together with the rollback.
6. In multi-tenant mode, repeat for each affected tenant database, using the tenant set's SQL and `drizzle.__drizzle_tenant_migrations`.
7. Test the rollback SQL on a copy of the database first if you have time.

---

## 2. PostgreSQL Caveats for Rollbacks

### ENUM values cannot be removed

PostgreSQL has no `ALTER TYPE ... DROP VALUE` statement. To remove a value from an ENUM, you must perform a type-swap:

```sql
-- 1. Verify no rows use the value you want to remove
SELECT COUNT(*) FROM <table> WHERE <column> = '<value_to_remove>';
-- Must return 0. If not, you must update/delete those rows first.

-- 2. Create a replacement type without the unwanted value
CREATE TYPE <type_name>_new AS ENUM('val1', 'val2', ...);
-- List all values EXCEPT the one(s) you want to remove.

-- 3. Update every column that uses the old type
ALTER TABLE <table> ALTER COLUMN <column> TYPE <type_name>_new USING <column>::text::<type_name>_new;
-- Repeat for every table/column that references this type.

-- 4. Drop the old type and rename the new one
DROP TYPE <type_name>;
ALTER TYPE <type_name>_new RENAME TO <type_name>;
```

Run the type-swap inside `BEGIN; ... COMMIT;`. `CREATE TYPE`, `ALTER COLUMN ... TYPE`, `DROP TYPE` and `ALTER TYPE ... RENAME` are all transactional, so a failure leaves the old type in place. The cast in step 3 fails if any row still uses the removed value, which is why you verify zero usage first.

### Foreign key ordering

When dropping tables, you must drop child tables (or their FK constraints) before parent tables. Using `DROP TABLE ... CASCADE` handles FK constraints on the dropped table, but does not drop other tables that depend on it.

### Partial indexes must be dropped explicitly

`DROP TABLE ... CASCADE` removes FK constraints pointing to a table, but indexes on other tables that reference the dropped table's data are a separate concern. If a migration added indexes to existing tables, those indexes must be dropped individually in the rollback.


### After manual rollback, clean up migration tracking

Each set has its own tracking table in the `drizzle` schema: `__drizzle_migrations` (unified), `__drizzle_control_migrations` (control DB), `__drizzle_tenant_migrations` (each tenant DB). Each row has `hash` (SHA-256 of the SQL file) and `created_at` (the migration's `when` value from `meta/_journal.json`).

Drizzle only applies migrations whose `when` is newer than the newest `created_at` in the table. So after a manual rollback you must delete the rows for every migration you reversed. If you leave them, a later deploy of code that contains those migrations will skip them and the schema will be missing the changes.

The safest key is `created_at`, because it equals the journal `when`:

```bash
# Look up the "when" value for a migration
jq '.entries[] | select(.tag == "0035_item_batches") | .when' packages/db/drizzle/meta/_journal.json
```

```sql
-- View tracked migrations (newest first)
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC;

-- Delete the row for the migration you reversed
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <when_from_journal>;
```

Use the matching table name for the control and tenant sets.

---

## 3. Migrations 0000-0009 (Unified Set)

These sections were written when 0009 was the newest migration. Two things have changed since:

- Later migrations depend on these tables (for example 0033 adds foreign keys to `items`, `parties` and `invoices`). Reverse the later migrations first ([section 4](#4-migrations-0010-and-later-unified-control-tenant)).
- Comments below that say ENUM steps must run outside a transaction are overly cautious; see [ENUM values cannot be removed](#enum-values-cannot-be-removed).
- The tracking-row deletes below use `ORDER BY created_at DESC OFFSET n`, which assumed 0009 was the newest row. With 37 migrations that picks the wrong row. Delete by `created_at` instead, using these journal values:

| Migration | `created_at` (journal `when`) |
|---|---|
| 0003_classy_zzzax | 1775051673281 |
| 0004_complex_daimon_hellstrom | 1775299908310 |
| 0005_amusing_the_professor | 1775308627951 |
| 0006_medical_zemo | 1775751260771 |
| 0007_strong_mantis | 1775917396432 |
| 0008_absurd_baron_zemo | 1775934971629 |
| 0009_illegal_moira_mactaggert | 1776015499229 |

### Quick reference (0000-0009)

| Migration | Name | Risk | Data Loss | Recommended Strategy |
|-----------|------|------|-----------|---------------------|
| 0009 | ENUM: `adjusted` status | Low | None (if no rows use the value) | Manual reverse SQL |
| 0008 | Soft-delete columns on items | Low | Soft-deleted items become visible | Manual reverse SQL |
| 0007 | Split invoice_items description | Medium | None (reversible data transform) | Manual reverse SQL |
| 0006 | Accounting/GST/e-invoice tables | High | All data in 14 new tables lost | Backup restore preferred |
| 0005 | Payment gateway configs | Medium | Gateway configs + ENUM type-swaps | Manual reverse SQL |
| 0004 | Session tracking + index | Low | None | Manual reverse SQL |
| 0003 | Recurring invoices | Medium | All recurring templates/runs lost | Manual reverse SQL |
| 0002 | Feature expansion + ENUMs | **Critical** | Too large for manual rollback | Backup restore only |
| 0001 | Alt-unit columns | Low | Unit conversion data lost | Backup restore only |
| 0000 | Initial schema | **Critical** | Everything | Backup restore only |

### Migrations 0000-0002: Backup Restore Only

Migrations 0000 (`0000_familiar_boom_boom`), 0001 (`0001_outgoing_marvel_apes`), and 0002 (`0002_pink_talos`) together form the foundational schema: all core ENUM types, all core tables (tenants, users, sessions, businesses, parties, items, invoices, payments, expenses, bank accounts, etc.), and dozens of ENUM value additions.

`drizzle/0002_performance_indexes.sql` (trigram and other search indexes) is **not** listed in `meta/_journal.json`, so the migration runner never applies it. If you ran it by hand, undo it with `DROP INDEX CONCURRENTLY IF EXISTS` on each index it creates.

Manual rollback of these migrations is not practical. The SQL would effectively `DROP` every table and type in the database, destroying all data. **Use backup restore (Strategy 1) to roll back to a state before these migrations.**

---

### Migration 0003: Recurring Invoices

**File**: `0003_classy_zzzax.sql`
**Description**: Creates 3 ENUM types (`recurring_frequency`, `recurring_run_status`, `recurring_template_status`), 2 tables (`recurring_invoice_templates`, `recurring_invoice_runs`), FK constraints, and 7 indexes.

**WARNING**: All recurring invoice templates and execution history will be permanently lost.

#### Pre-flight checks

```sql
-- Count data that will be lost
SELECT 'templates' AS entity, COUNT(*) AS count FROM recurring_invoice_templates
UNION ALL
SELECT 'runs', COUNT(*) FROM recurring_invoice_runs;
```

#### Rollback SQL

```sql
BEGIN;

-- Drop tables (CASCADE removes FK constraints and dependent indexes)
DROP TABLE IF EXISTS "recurring_invoice_runs" CASCADE;
DROP TABLE IF EXISTS "recurring_invoice_templates" CASCADE;

COMMIT;

-- ENUM drops must be outside the transaction
DROP TYPE IF EXISTS "public"."recurring_template_status";
DROP TYPE IF EXISTS "public"."recurring_run_status";
DROP TYPE IF EXISTS "public"."recurring_frequency";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 6 LIMIT 1
);
-- Or use the exact hash from: SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

#### Post-flight checks

```sql
-- Verify tables are gone
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('recurring_invoice_templates', 'recurring_invoice_runs');
-- Should return 0 rows

-- Verify types are gone
SELECT typname FROM pg_type
WHERE typname IN ('recurring_frequency', 'recurring_run_status', 'recurring_template_status');
-- Should return 0 rows
```

---

### Migration 0004: Session Tracking + Store Order Index

**File**: `0004_complex_daimon_hellstrom.sql`
**Description**: Adds `last_used_at` column to `sessions` table. Creates an index on `store_orders(invoice_id)`.

**Data loss**: The `last_used_at` timestamps will be lost. No business-critical data is affected.

#### Pre-flight checks

```sql
-- Verify the column and index exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'last_used_at';

SELECT indexname FROM pg_indexes
WHERE indexname = 'store_orders_invoice_idx';
```

#### Rollback SQL

```sql
BEGIN;

DROP INDEX IF EXISTS "store_orders_invoice_idx";
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_used_at";

COMMIT;

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 5 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify column is gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'last_used_at';
-- Should return 0 rows

-- Verify index is gone
SELECT indexname FROM pg_indexes WHERE indexname = 'store_orders_invoice_idx';
-- Should return 0 rows
```

---

### Migration 0005: Payment Gateway Configs

**File**: `0005_amusing_the_professor.sql`
**Description**: Adds ENUM values (`payment_gateway` to `bank_account_type`; `credit_card`, `debit_card`, `net_banking`, `wallet` to `payment_mode`). Creates `payment_gateway_configs` table. Adds `payment_id` to `bank_transactions` and `bank_account_id` to `expenses`.

**WARNING**: Payment gateway configuration data will be lost. ENUM type-swaps required.

#### Pre-flight checks

```sql
-- Check for data that will be lost
SELECT COUNT(*) AS gateway_configs FROM payment_gateway_configs;

-- Check for rows using new ENUM values (must be 0 for type-swap)
SELECT COUNT(*) AS gateway_accounts FROM bank_accounts WHERE account_type = 'payment_gateway';
SELECT COUNT(*) AS cc_payments FROM payments WHERE mode = 'credit_card';
SELECT COUNT(*) AS dc_payments FROM payments WHERE mode = 'debit_card';
SELECT COUNT(*) AS nb_payments FROM payments WHERE mode = 'net_banking';
SELECT COUNT(*) AS wallet_payments FROM payments WHERE mode = 'wallet';
SELECT COUNT(*) AS cc_expenses FROM expenses WHERE mode = 'credit_card';
SELECT COUNT(*) AS dc_expenses FROM expenses WHERE mode = 'debit_card';
SELECT COUNT(*) AS nb_expenses FROM expenses WHERE mode = 'net_banking';
SELECT COUNT(*) AS wallet_expenses FROM expenses WHERE mode = 'wallet';
-- ALL counts must be 0 before proceeding with type-swap.
-- If any are non-zero, update those rows to a valid value first.
```

#### Rollback SQL

```sql
BEGIN;

-- Drop indexes on existing tables
DROP INDEX IF EXISTS "bank_txn_payment_idx";
DROP INDEX IF EXISTS "pg_config_account_idx";
DROP INDEX IF EXISTS "pg_config_business_idx";

-- Drop FK constraint on expenses before dropping column
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_bank_account_id_bank_accounts_id_fk";

-- Drop added columns on existing tables
ALTER TABLE "bank_transactions" DROP COLUMN IF EXISTS "payment_id";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "bank_account_id";

-- Drop table (CASCADE handles its FK constraints)
DROP TABLE IF EXISTS "payment_gateway_configs" CASCADE;

COMMIT;

-- ENUM type-swaps (must be outside transaction)

-- Type-swap: bank_account_type (remove 'payment_gateway')
CREATE TYPE "public"."bank_account_type_new" AS ENUM('savings', 'current', 'cash', 'upi', 'credit_card');
ALTER TABLE "bank_accounts" ALTER COLUMN "account_type"
  TYPE "public"."bank_account_type_new" USING "account_type"::text::"public"."bank_account_type_new";
DROP TYPE "public"."bank_account_type";
ALTER TYPE "public"."bank_account_type_new" RENAME TO "bank_account_type";

-- Type-swap: payment_mode (remove 'credit_card', 'debit_card', 'net_banking', 'wallet')
CREATE TYPE "public"."payment_mode_new" AS ENUM('cash', 'bank', 'upi', 'cheque', 'other');
ALTER TABLE "payments" ALTER COLUMN "mode"
  TYPE "public"."payment_mode_new" USING "mode"::text::"public"."payment_mode_new";
ALTER TABLE "expenses" ALTER COLUMN "mode"
  TYPE "public"."payment_mode_new" USING "mode"::text::"public"."payment_mode_new";
DROP TYPE "public"."payment_mode";
ALTER TYPE "public"."payment_mode_new" RENAME TO "payment_mode";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 4 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify table is gone
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'payment_gateway_configs';
-- Should return 0 rows

-- Verify ENUM values
SELECT unnest(enum_range(NULL::bank_account_type));
-- Should show: savings, current, cash, upi, credit_card (no payment_gateway)

SELECT unnest(enum_range(NULL::payment_mode));
-- Should show: cash, bank, upi, cheque, other (no credit_card/debit_card/net_banking/wallet)

-- Verify columns are gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'bank_transactions' AND column_name = 'payment_id';
SELECT column_name FROM information_schema.columns
WHERE table_name = 'expenses' AND column_name = 'bank_account_id';
-- Both should return 0 rows
```

---

### Migration 0006: Accounting, GST, E-Invoice, and Bank Statement Tables

**File**: `0006_medical_zemo.sql`
**Description**: Creates 5 ENUM types, 14 new tables, adds 7 columns to `businesses`, adds 10 columns to `invoices`, and creates approximately 31 indexes (including 3 partial indexes on existing tables: `expenses`, `invoices`, `payments`).

**WARNING**: This is the largest migration. All data in 14 new tables will be permanently lost. Backup restore (Strategy 1) is strongly recommended over manual rollback.

If you must use manual reverse SQL, proceed with extreme caution.

#### Pre-flight checks

```sql
-- Count data across all new tables
SELECT 'bank_categorization_rules' AS tbl, COUNT(*) AS cnt FROM bank_categorization_rules
UNION ALL SELECT 'bank_statement_imports', COUNT(*) FROM bank_statement_imports
UNION ALL SELECT 'bank_statement_lines', COUNT(*) FROM bank_statement_lines
UNION ALL SELECT 'bank_statement_templates', COUNT(*) FROM bank_statement_templates
UNION ALL SELECT 'chart_of_accounts', COUNT(*) FROM chart_of_accounts
UNION ALL SELECT 'e_invoice_configs', COUNT(*) FROM e_invoice_configs
UNION ALL SELECT 'eway_bill_vehicle_updates', COUNT(*) FROM eway_bill_vehicle_updates
UNION ALL SELECT 'eway_bills', COUNT(*) FROM eway_bills
UNION ALL SELECT 'gstr2b_records', COUNT(*) FROM gstr2b_records
UNION ALL SELECT 'gstr2b_uploads', COUNT(*) FROM gstr2b_uploads
UNION ALL SELECT 'itc_ledger_entries', COUNT(*) FROM itc_ledger_entries
UNION ALL SELECT 'itc_utilizations', COUNT(*) FROM itc_utilizations
UNION ALL SELECT 'journal_entries', COUNT(*) FROM journal_entries
UNION ALL SELECT 'journal_entry_lines', COUNT(*) FROM journal_entry_lines
UNION ALL SELECT 'journal_entry_templates', COUNT(*) FROM journal_entry_templates;
-- Review these counts carefully. If any table has significant data, use backup restore instead.
```

#### Rollback SQL

```sql
BEGIN;

-- 1. Drop partial indexes on EXISTING tables first
DROP INDEX IF EXISTS "payments_active_idx";
DROP INDEX IF EXISTS "invoices_active_type_idx";
DROP INDEX IF EXISTS "invoices_active_idx";
DROP INDEX IF EXISTS "invoices_einvoice_status_idx";
DROP INDEX IF EXISTS "expenses_active_idx";

-- 2. Drop columns added to existing tables

-- invoices: 10 columns
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_cancel_reason";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_retry_count";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_error";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_status";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "signed_invoice";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "signed_qr_code";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "irn_ack_date";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "irn_ack_number";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "irn";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "is_reverse_charge";

-- businesses: 7 columns
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "annual_turnover";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "next_purchase_return_number";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "purchase_return_prefix";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "next_sales_return_number";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "sales_return_prefix";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "next_debit_note_number";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "debit_note_prefix";

-- 3. Drop new tables (order matters: children before parents)
--    journal_entry_lines depends on journal_entries and chart_of_accounts
--    eway_bill_vehicle_updates depends on eway_bills
--    bank_statement_lines depends on bank_statement_imports
--    gstr2b_records depends on gstr2b_uploads
DROP TABLE IF EXISTS "journal_entry_lines" CASCADE;
DROP TABLE IF EXISTS "journal_entry_templates" CASCADE;
DROP TABLE IF EXISTS "journal_entries" CASCADE;
DROP TABLE IF EXISTS "itc_utilizations" CASCADE;
DROP TABLE IF EXISTS "itc_ledger_entries" CASCADE;
DROP TABLE IF EXISTS "gstr2b_records" CASCADE;
DROP TABLE IF EXISTS "gstr2b_uploads" CASCADE;
DROP TABLE IF EXISTS "eway_bill_vehicle_updates" CASCADE;
DROP TABLE IF EXISTS "eway_bills" CASCADE;
DROP TABLE IF EXISTS "e_invoice_configs" CASCADE;
DROP TABLE IF EXISTS "chart_of_accounts" CASCADE;
DROP TABLE IF EXISTS "bank_statement_lines" CASCADE;
DROP TABLE IF EXISTS "bank_statement_imports" CASCADE;
DROP TABLE IF EXISTS "bank_statement_templates" CASCADE;
DROP TABLE IF EXISTS "bank_categorization_rules" CASCADE;

COMMIT;

-- 4. Drop ENUM types (must be outside transaction)
DROP TYPE IF EXISTS "public"."itc_status";
DROP TYPE IF EXISTS "public"."eway_bill_status";
DROP TYPE IF EXISTS "public"."bank_statement_match_status";
DROP TYPE IF EXISTS "public"."bank_statement_import_status";
DROP TYPE IF EXISTS "public"."account_type";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 3 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify all 14 new tables are gone
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'bank_categorization_rules', 'bank_statement_imports', 'bank_statement_lines',
    'bank_statement_templates', 'chart_of_accounts', 'e_invoice_configs',
    'eway_bill_vehicle_updates', 'eway_bills', 'gstr2b_records', 'gstr2b_uploads',
    'itc_ledger_entries', 'itc_utilizations', 'journal_entries',
    'journal_entry_lines', 'journal_entry_templates'
  );
-- Should return 0 rows

-- Verify ENUM types are gone
SELECT typname FROM pg_type
WHERE typname IN ('account_type', 'bank_statement_import_status', 'bank_statement_match_status', 'eway_bill_status', 'itc_status');
-- Should return 0 rows

-- Verify columns removed from invoices
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoices' AND column_name IN ('irn', 'irn_ack_number', 'irn_ack_date', 'signed_qr_code', 'signed_invoice', 'e_invoice_status', 'e_invoice_error', 'e_invoice_retry_count', 'e_invoice_cancel_reason', 'is_reverse_charge');
-- Should return 0 rows

-- Verify columns removed from businesses
SELECT column_name FROM information_schema.columns
WHERE table_name = 'businesses' AND column_name IN ('debit_note_prefix', 'next_debit_note_number', 'sales_return_prefix', 'next_sales_return_number', 'purchase_return_prefix', 'next_purchase_return_number', 'annual_turnover');
-- Should return 0 rows

-- Verify partial indexes on existing tables are gone
SELECT indexname FROM pg_indexes
WHERE indexname IN ('expenses_active_idx', 'invoices_einvoice_status_idx', 'invoices_active_idx', 'invoices_active_type_idx', 'payments_active_idx');
-- Should return 0 rows
```

---

### Migration 0007: Split invoice_items.description into item_name + description

**File**: `0007_strong_mantis.sql`
**Description**: Renames `invoice_items.description` to `item_name`, adds a new `description` column, and migrates `recurring_invoice_templates.line_items` JSONB to rename the `description` key to `itemName`.

**Data loss**: None if reversed correctly. The column rename is reversed, and the JSONB data is transformed back.

#### Pre-flight checks

```sql
-- Verify current column state
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoice_items' AND column_name IN ('item_name', 'description')
ORDER BY column_name;
-- Should show both 'description' and 'item_name'

-- Check if any invoice_items have data in the new description column
SELECT COUNT(*) FROM invoice_items WHERE description IS NOT NULL;
-- If non-zero, that data will be lost in rollback.

-- Check recurring templates JSONB state
SELECT id, line_items->0 AS sample_item FROM recurring_invoice_templates LIMIT 3;
-- Elements should have 'itemName' key (from the forward migration)
```

#### Rollback SQL

```sql
BEGIN;

-- 1. Reverse the JSONB migration: rename 'itemName' back to 'description', remove the 'description' null key
UPDATE "recurring_invoice_templates"
SET "line_items" = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem ? 'itemName' THEN
          (elem - 'itemName' - 'description')
          || jsonb_build_object('description', elem->'itemName')
        ELSE elem
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements("line_items") WITH ORDINALITY AS t(elem, ord)
  ),
  "line_items"
)
WHERE "line_items" IS NOT NULL
  AND jsonb_typeof("line_items") = 'array';

-- 2. Drop the new description column
ALTER TABLE "invoice_items" DROP COLUMN IF EXISTS "description";

-- 3. Rename item_name back to description
ALTER TABLE "invoice_items" RENAME COLUMN "item_name" TO "description";

COMMIT;

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 2 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify column state
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoice_items' AND column_name IN ('item_name', 'description');
-- Should show only 'description' (no 'item_name')

-- Verify JSONB state
SELECT id, line_items->0 AS sample_item FROM recurring_invoice_templates LIMIT 3;
-- Elements should have 'description' key (no 'itemName')
```

---

### Migration 0008: Soft-Delete for Items

**File**: `0008_absurd_baron_zemo.sql`
**Description**: Adds `deleted_at` column to `items` and `item_variants` tables. Creates partial indexes (`items_active_idx`, `item_variants_active_idx`) for efficient active-row queries.

**WARNING**: Any items or variants with `deleted_at IS NOT NULL` (soft-deleted) will become visible again after rollback. They were soft-deleted for a reason -- review them before proceeding.

#### Pre-flight checks

```sql
-- Check for soft-deleted items that will become visible again
SELECT COUNT(*) AS soft_deleted_items FROM items WHERE deleted_at IS NOT NULL;
SELECT COUNT(*) AS soft_deleted_variants FROM item_variants WHERE deleted_at IS NOT NULL;
-- If non-zero, these items will reappear in active queries after rollback.
-- Consider whether this is acceptable.
```

#### Rollback SQL

```sql
BEGIN;

-- Drop partial indexes first
DROP INDEX IF EXISTS "items_active_idx";
DROP INDEX IF EXISTS "item_variants_active_idx";

-- Drop columns
ALTER TABLE "items" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "item_variants" DROP COLUMN IF EXISTS "deleted_at";

COMMIT;

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 1 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify columns are gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'items' AND column_name = 'deleted_at';
SELECT column_name FROM information_schema.columns
WHERE table_name = 'item_variants' AND column_name = 'deleted_at';
-- Both should return 0 rows

-- Verify indexes are gone
SELECT indexname FROM pg_indexes
WHERE indexname IN ('items_active_idx', 'item_variants_active_idx');
-- Should return 0 rows
```

---

### Migration 0009: ENUM Value 'adjusted' for invoice_status

**File**: `0009_illegal_moira_mactaggert.sql`
**Description**: Adds `'adjusted'` to the `invoice_status` ENUM type.

**Data loss**: None, provided no invoices have `status = 'adjusted'`.

#### Pre-flight checks

```sql
-- CRITICAL: Verify no rows use the value
SELECT COUNT(*) FROM invoices WHERE status = 'adjusted';
-- Must be 0. If non-zero, you must update those rows to a different status first.
-- Example: UPDATE invoices SET status = 'cancelled' WHERE status = 'adjusted';
```

#### Rollback SQL

ENUM type-swap is required. This cannot run inside a transaction.

```sql
-- Type-swap: remove 'adjusted' from invoice_status
-- Full value list after 0002 (unfulfilled added) minus adjusted:
-- draft, unfulfilled, sent, paid, partial, overdue, cancelled
CREATE TYPE "public"."invoice_status_new" AS ENUM(
  'draft', 'unfulfilled', 'sent', 'paid', 'partial', 'overdue', 'cancelled'
);

ALTER TABLE "invoices" ALTER COLUMN "status"
  TYPE "public"."invoice_status_new" USING "status"::text::"public"."invoice_status_new";

DROP TYPE "public"."invoice_status";
ALTER TYPE "public"."invoice_status_new" RENAME TO "invoice_status";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify ENUM values
SELECT unnest(enum_range(NULL::invoice_status));
-- Should show: draft, unfulfilled, sent, paid, partial, overdue, cancelled
-- Should NOT include 'adjusted'

-- Verify migration tracking
SELECT hash, to_timestamp(created_at / 1000) AS applied_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 3;
-- The 0009 entry should be gone
```

---

## 4. Migrations 0010 and Later (Unified, Control, Tenant)

How to read the tables:

- **Reverse** is the SQL to undo the migration on one database. Run newest first and delete the tracking row afterwards ([section 2](#after-manual-rollback-clean-up-migration-tracking)).
- `DROP TABLE` loses every row in that table. `DROP COLUMN` loses that column's values. Take a backup first.
- **Enum value** means a value was added to a Postgres enum. It cannot be dropped directly; use the type-swap in [section 2](#enum-values-cannot-be-removed), and only after no row uses the value. Leaving the extra value in place is harmless to older code.
- **Data change — restore from backup** means the migration rewrote existing rows. Dropping the new objects does not bring the old values back.
- Indexes and foreign keys on a dropped column or table go with it, so they are not listed separately.

### 4.1 Unified set (`packages/db/drizzle/`, single-database mode)

| File | What it changes | Reverse |
|---|---|---|
| `0010_empty_unus.sql` | New table `system_config` (key/value JSON; holds the `maintenance` setting). | `DROP TABLE system_config;` |
| `0011_wet_prodigy.sql` | `businesses`: `logo_data`, `logo_mime_type`, `logo_width`, `logo_height`, `logo_updated_at`. | `ALTER TABLE businesses DROP COLUMN logo_data, DROP COLUMN logo_mime_type, DROP COLUMN logo_width, DROP COLUMN logo_height, DROP COLUMN logo_updated_at;` (logos lost) |
| `0012_aromatic_phalanx.sql` | `businesses.pos_enabled`. | `ALTER TABLE businesses DROP COLUMN pos_enabled;` |
| `0013_empty_thaddeus_ross.sql` | `businesses.default_round_off`, `businesses.default_terms_and_conditions`. | `ALTER TABLE businesses DROP COLUMN default_round_off, DROP COLUMN default_terms_and_conditions;` |
| `0014_typical_rachel_grey.sql` | Enum type `business_member_role`; tables `business_members`, `premises`, `warehouses`, `warehouse_locations`. | Reverse 0016–0018, 0030 and 0033 first. Then `DROP TABLE warehouse_locations, warehouses, premises, business_members; DROP TYPE business_member_role;` |
| `0015_exotic_virginia_dare.sql` | Makes `premises_business_code_idx`, `warehouse_locations_code_idx`, `warehouses_business_code_idx` unique. | Drop the three indexes and recreate them non-unique: `CREATE INDEX premises_business_code_idx ON premises (business_id, code);` `CREATE INDEX warehouse_locations_code_idx ON warehouse_locations (warehouse_id, code);` `CREATE INDEX warehouses_business_code_idx ON warehouses (business_id, code);` |
| `0016_last_vance_astro.sql` | New table `stock_balances`. | `DROP TABLE stock_balances;` |
| `0017_lazy_carmella_unuscione.sql` | New table `stock_movements` (stock history). | `DROP TABLE stock_movements;` — loses all stock history; restore from backup preferred. |
| `0018_silly_quicksilver.sql` | New tables `inventory_settings`, `warehouse_permissions`. | `DROP TABLE warehouse_permissions, inventory_settings;` |
| `0019_empty_jane_foster.sql` | Replaces `stock_balances_unique_idx` with four partial unique indexes (`stock_balances_base_unique_idx`, `_location_unique_idx`, `_variant_unique_idx`, `_location_variant_unique_idx`). | Drop the four indexes, then `CREATE UNIQUE INDEX stock_balances_unique_idx ON stock_balances (business_id, warehouse_id, location_id, item_id, variant_id);` |
| `0020_add_user_referral_code.sql` | `users.referral_code` (`IF EXISTS` / `IF NOT EXISTS`). See [known issues](#7-known-issues-in-the-migration-sets). | `ALTER TABLE users DROP COLUMN IF EXISTS referral_code;` |
| `0021_stiff_shooting_star.sql` | Adds an early plan id to enum `tenant_plan` (the type is rebuilt by 0056); `tenants.referral_code`; `businesses`: `business_type`, `tan`, `cin`, `llpin`, `udyam_number`, `iec_code`, `lut_arn`, `e_invoice_enabled`, `e_way_bill_enabled`, `address_line_1`, `address_line_2`, `landmark`, `country_of_operations`, `financial_year_start_date`. | `DROP COLUMN` each new column. The enum value cannot be dropped; see 0056. |
| `0022_add_session_auth_fields.sql` | Enum type `session_auth_method`; `sessions.auth_method`, `sessions.max_expires_at`. | `ALTER TABLE sessions DROP COLUMN auth_method, DROP COLUMN max_expires_at; DROP TYPE session_auth_method;` |
| `0023_loose_miracleman.sql` | `businesses`: `assessee_of_other_territory`, `gst_return_periodicity`, `e_way_bill_threshold`. | `DROP COLUMN` each. |
| `0024_omniscient_ultron.sql` | `businesses`: `deductor_type`, `responsible_person_name`, `responsible_person_pan`, `responsible_person_designation`. | `DROP COLUMN` each. |
| `0025_keen_retro_girl.sql` | New table `eway_bill_configs`; `e_invoice_configs.client_id` and `client_secret` become nullable. | `DROP TABLE eway_bill_configs;` To restore `NOT NULL`, first fill or delete rows where those columns are null, then `ALTER TABLE e_invoice_configs ALTER COLUMN client_id SET NOT NULL, ALTER COLUMN client_secret SET NOT NULL;` |
| `0026_foamy_demogoblin.sql` | `businesses`: `signature_data`, `signature_mime_type`, `signature_width`, `signature_height`, `signature_updated_at`. | `DROP COLUMN` each (signatures lost). |
| `0027_soft_harpoon.sql` | `items.barcode`, `item_variants.barcode` and their indexes. | `ALTER TABLE items DROP COLUMN barcode; ALTER TABLE item_variants DROP COLUMN barcode;` |
| `0028_opposite_baron_strucker.sql` | `businesses.next_barcode_number`, `businesses.auto_generate_barcodes`. | `DROP COLUMN` each. |
| `0029_marvelous_peter_parker.sql` | `parties`: `additional_shipping_addresses`, `legal_name`, `trade_name`, `gst_registration_type`, `constitution`, `gstin_status`, `gstin_verified_at`, `is_msme`, `udyam_number`, `msme_category`, `tds_section`. | `DROP COLUMN` each. |
| `0030_barcode_setup.sql` | New tables `item_barcodes`, `physical_stock_counts`; `businesses`: `barcodes_enabled`, `barcode_type`, `barcode_mode`, `barcode_setup_locked_at`, `barcode_setup_locked_by`; `invoices.warehouse_id` (FK to `warehouses`). | `ALTER TABLE invoices DROP COLUMN warehouse_id; DROP TABLE physical_stock_counts, item_barcodes;` then `DROP COLUMN` the five `businesses` columns. |
| `0031_share_links.sql` | New table `share_links`. | `DROP TABLE share_links;` (existing share links stop working) |
| `0032_plans_and_partners.sql` | New tables `partners`, `partner_payouts`, `plan_settings`; `magic_link_tokens.referral_code`; `tenants.partner_id` (FK to `partners`). | `ALTER TABLE tenants DROP COLUMN partner_id; ALTER TABLE magic_link_tokens DROP COLUMN referral_code; DROP TABLE partner_payouts, partners, plan_settings;` |
| `0033_inventory.sql` | Enum values `document_type` + `purchase_order`, `sales_order`, `goods_receipt_note`. New tables `stock_groups`, `price_levels`, `price_list_entries`, `boms`, `bom_components`, `bom_by_products`, `manufacturing_journals`, `manufacturing_journal_lines`. New columns: `businesses` PO/SO/GRN prefix and next-number (6 columns), `inventory_settings.negative_stock_policy`, `inventory_settings.valuation_method`, `invoices.stock_mode`, `invoices.closed_at`, `items.mrp`, `item_variants.mrp`, `items.stock_group_id`, `parties.price_level_id`. **Data changes**: backfills `invoices.stock_mode`; creates a stock group for each distinct item category and rewrites `items.category` to the trimmed group name. | **Data change — restore from backup.** Schema-only reverse: drop `items.stock_group_id` and `parties.price_level_id`, drop the eight tables (lines and components before their parents), then `DROP COLUMN` the other new columns. Enum values: type-swap only if no PO, SO or GRN documents exist. Original untrimmed category text cannot be recovered without a backup. |
| `0034_free_qty_rejections.sql` | `invoice_items`: `free_quantity`, `rejected_quantity`, `rejection_reason`. | `DROP COLUMN` each. |
| `0035_item_batches.sql` | New table `item_batches`; `invoice_items.batch_id`; `items.track_batches`, `items.track_expiry`; FK `stock_movements_batch_id_item_batches_id_fk`. **Data change**: sets every existing `stock_movements.batch_id` to `NULL`. | `ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_batch_id_item_batches_id_fk; ALTER TABLE invoice_items DROP COLUMN batch_id; ALTER TABLE items DROP COLUMN track_batches, DROP COLUMN track_expiry; DROP TABLE item_batches;` Old `batch_id` values: restore from backup. |
| `0036_roadmap_items.sql` | New table `roadmap_items`. | `DROP TABLE roadmap_items;` |
| `0056_plans_three_paid.sql` | Rebuilds enum `tenant_plan` as `starter`, `growth`, `business`; converts `tenants.plan`, `plan_settings.plan`, `billing_subscriptions.plan` / `scheduled_plan`; adds `tenants.access_grandfathered` and `plan_settings.yearly_price_inr`. Lossy: see [Rolling back the plan model](#rolling-back-the-plan-model-0056--0019). | [Reverse SQL below](#rolling-back-the-plan-model-0056--0019), or restore a backup taken before the deploy. |

### 4.2 Control set (`packages/db/drizzle-control/`, multi-tenant mode, control DB)

| File | What it changes | Reverse |
|---|---|---|
| `0000_typical_gorgon.sql` | Initial control schema: enum types `member_role`, `tenant_plan`, `tenant_status`; tables `users`, `tenants`, `tenant_members`, `sessions`, `api_keys`, `invitations`, `magic_link_tokens`. | Restore from backup only. |
| `0001_giant_stepford_cuckoos.sql` | New table `system_config`. | `DROP TABLE system_config;` |
| `0002_exotic_owl.sql` | Enum type `session_auth_method`; `sessions.auth_method`, `sessions.max_expires_at`. | `ALTER TABLE sessions DROP COLUMN auth_method, DROP COLUMN max_expires_at; DROP TYPE session_auth_method;` |
| `0003_woozy_psylocke.sql` | New table `access_tokens` (short-lived `at_` tokens, FK to `sessions`). | `DROP TABLE access_tokens;` (signs out clients using access tokens) |
| `0000_add_tenant_referral_code` (journal entry 4) | **No SQL file exists.** See [known issues](#7-known-issues-in-the-migration-sets). | Nothing to reverse. |
| `0005_useful_darkhawk.sql` | Adds an early plan id to enum `tenant_plan` (the type is rebuilt by 0019); `tenants.referral_code`; `users.referral_code`. | `ALTER TABLE tenants DROP COLUMN referral_code; ALTER TABLE users DROP COLUMN referral_code;` The enum value cannot be dropped; see 0019. |
| `0006_share_links.sql` | New table `share_links`. | `DROP TABLE share_links;` |
| `0007_plans_and_partners.sql` | New tables `partners`, `partner_payouts`, `plan_settings`; `magic_link_tokens.referral_code`; `tenants.partner_id`. | Same as unified 0032. |
| `0008_roadmap_items.sql` | New table `roadmap_items`. | `DROP TABLE roadmap_items;` |
| `0019_plans_three_paid.sql` | Same SQL as unified `0056_plans_three_paid.sql` (plan model: Starter / Growth / Business). | Same as unified 0056: [Rolling back the plan model](#rolling-back-the-plan-model-0056--0019). |

### 4.3 Tenant set (`packages/db/drizzle-tenant/`, multi-tenant mode, every tenant DB)

Run the reverse SQL in each tenant database you are rolling back, or restore just that tenant ([Single-Tenant Restore](#single-tenant-restore-multi-tenant-deployments)).

| File | What it changes | Reverse |
|---|---|---|
| `0000_lame_molecule_man.sql` | Initial tenant schema: all business enum types and tables (businesses, parties, items, invoices, payments, expenses, bank, GST, e-invoice, e-way bill, journals, ITC, recurring invoices, shipments, store orders, sales targets, audit log, etc.). | Restore from backup only. |
| `0001_parallel_korg.sql` | `businesses` logo columns (same five as unified 0011). | Same as unified 0011. |
| `0002_perfect_sugar_man.sql` | `businesses.pos_enabled`. | Same as unified 0012. |
| `0003_needy_siren.sql` | `businesses.default_round_off`, `default_terms_and_conditions`. | Same as unified 0013. |
| `0004_cultured_trish_tilby.sql` | Enum type `business_member_role`; table `business_members`. | Reverse 0009 first. `DROP TABLE business_members; DROP TYPE business_member_role;` |
| `0005_easy_drax.sql` | Tables `premises`, `warehouses`, `warehouse_locations`. | Reverse 0007–0009, 0017 and 0022 first. `DROP TABLE warehouse_locations, warehouses, premises;` |
| `0006_icy_tusk.sql` | Makes the three warehouse/premise code indexes unique. | Same as unified 0015. |
| `0007_shallow_plazm.sql` | Table `stock_balances`. | `DROP TABLE stock_balances;` |
| `0008_solid_senator_kelly.sql` | Table `stock_movements`. | `DROP TABLE stock_movements;` (stock history lost; backup preferred) |
| `0009_gifted_justin_hammer.sql` | Tables `inventory_settings`, `warehouse_permissions`. | `DROP TABLE warehouse_permissions, inventory_settings;` |
| `0010_living_lifeguard.sql` | Replaces `stock_balances_unique_idx` with four partial unique indexes. | Same as unified 0019. |
| `0011_supreme_dark_beast.sql` | `businesses`: `address_line_1`, `address_line_2`, `landmark`, `country_of_operations`, `financial_year_start_date`. | `DROP COLUMN` each. |
| `0012_amusing_madame_hydra.sql` | `businesses`: `business_type`, `tan`, `cin`, `llpin`, `udyam_number`, `iec_code`, `lut_arn`, `e_invoice_enabled`, `e_way_bill_enabled`. | `DROP COLUMN` each. |
| `0013_gst_step_two_settings.sql` | `businesses`: `assessee_of_other_territory`, `gst_return_periodicity`, `e_way_bill_threshold`. | `DROP COLUMN` each. |
| `0014_superb_firebird.sql` | Same three columns with `IF NOT EXISTS` (no-op when 0013 ran). | Nothing extra; reversing 0013 removes them. |
| `0015_slow_guardian.sql` | `businesses`: `deductor_type`, `responsible_person_name`, `responsible_person_pan`, `responsible_person_designation`. | `DROP COLUMN` each. |
| `0016_wet_tomorrow_man.sql` | Catch-up, written with `IF NOT EXISTS`: table `eway_bill_configs`; `e_invoice_configs.client_id`/`client_secret` nullable; `businesses` signature columns (5), `next_barcode_number`, `auto_generate_barcodes`; `items.barcode`, `item_variants.barcode` and indexes; `parties` GST/MSME/TDS columns (11, as unified 0029). | Same SQL as unified 0025–0029 combined. Because it is idempotent, some of these objects may have existed before it ran; check against a backup before dropping. |
| `0017_barcode_setup.sql` | Same as unified 0030. | Same as unified 0030. |
| `0018_inventory_stock_controls.sql` | `inventory_settings.negative_stock_policy`; `invoices.stock_mode`. **Data change**: backfills `stock_mode`. | `DROP COLUMN` both. The backfill only fills the new column, so dropping it loses nothing else. |
| `0019_stock_valuation_method.sql` | `inventory_settings.valuation_method`. | `DROP COLUMN`. |
| `0020_orders_and_grn.sql` | Enum values `document_type` + `purchase_order`, `sales_order`, `goods_receipt_note`; `businesses` PO/SO/GRN prefix and next-number (6 columns); `invoices.closed_at`. | `DROP COLUMN` each. Enum values: type-swap only if no such documents exist. |
| `0021_stock_groups.sql` | Table `stock_groups`; `items.stock_group_id`. **Data change**: creates groups from item categories and rewrites `items.category` to the trimmed group name. | **Data change — restore from backup.** Schema only: `ALTER TABLE items DROP COLUMN stock_group_id; DROP TABLE stock_groups;` |
| `0022_bom_manufacturing.sql` | Tables `boms`, `bom_components`, `bom_by_products`, `manufacturing_journals`, `manufacturing_journal_lines`. | `DROP TABLE manufacturing_journal_lines, manufacturing_journals, bom_by_products, bom_components, boms;` |
| `0023_price_levels.sql` | Tables `price_levels`, `price_list_entries`; `items.mrp`, `item_variants.mrp`, `parties.price_level_id`. | `ALTER TABLE parties DROP COLUMN price_level_id; DROP TABLE price_list_entries, price_levels;` then `DROP COLUMN mrp` on `items` and `item_variants`. |
| `0024_free_qty_rejections.sql` | Same as unified 0034. | Same as unified 0034. |
| `0025_item_batches.sql` | Same as unified 0035, including clearing `stock_movements.batch_id`. | Same as unified 0035. |

### Rolling back the plan model (0056 / 0019)

What the migration did (one transaction, skipped when `tenant_plan` is already `starter`/`growth`/`business`):

| Before | After | Notes |
|---|---|---|
| `forever_free` | `business` + `tenants.access_grandfathered = true` | permanent full access; the plan was for testing and is removed |
| `free` | `starter` | |
| `pro` | `growth` | |
| `business` | `business` | |
| `enterprise` | `business` | indistinguishable from `business` afterwards |

The same mapping applies to `billing_subscriptions.plan` and `scheduled_plan`. `plan_settings` rows are converted (free to starter, pro to growth, business to business; the forever_free and enterprise rows are dropped); an admin's edited name, tagline, price, visibility and limits are kept, anything still equal to the old built-in value becomes the new built-in value, features text is reset unless an admin rewrote it. `plan_settings.yearly_price_inr` is added (null = ten times the monthly price). Past `billing_payments.description` text ("Pro plan — monthly") is history and is not rewritten.

Preferred rollback: restore the backup taken before the deploy. The app of the previous release can also run against the converted data only if you reverse the migration first, because it reads `tenant_plan` values that no longer exist.

Reverse SQL (run in the control database in multi-tenant mode, the single database otherwise; tested against a migrated copy). Not recoverable: which `business` organisations were `enterprise`, and anything an admin changed in `plan_settings` after the deploy. Then delete the `0056` row (unified) or `0019` row (control) from the tracking table, or the runner will not re-apply it later:

```sql
BEGIN;
ALTER TABLE tenants ALTER COLUMN plan DROP DEFAULT;
ALTER TABLE tenants ALTER COLUMN plan SET DATA TYPE text;
ALTER TABLE plan_settings ALTER COLUMN plan SET DATA TYPE text;
UPDATE tenants SET plan = CASE
  WHEN access_grandfathered THEN 'forever_free'
  WHEN plan = 'starter' THEN 'free'
  WHEN plan = 'growth' THEN 'pro'
  ELSE plan END;
UPDATE billing_subscriptions SET
  plan = CASE plan WHEN 'starter' THEN 'free' WHEN 'growth' THEN 'pro' ELSE plan END,
  scheduled_plan = CASE scheduled_plan WHEN 'starter' THEN 'free' WHEN 'growth' THEN 'pro' ELSE scheduled_plan END;
UPDATE plan_settings SET plan = CASE plan WHEN 'starter' THEN 'free' WHEN 'growth' THEN 'pro' ELSE plan END;
ALTER TYPE tenant_plan RENAME TO tenant_plan_new;
CREATE TYPE tenant_plan AS ENUM ('forever_free', 'free', 'pro', 'business', 'enterprise');
ALTER TABLE plan_settings ALTER COLUMN plan SET DATA TYPE tenant_plan USING plan::tenant_plan;
ALTER TABLE tenants ALTER COLUMN plan SET DATA TYPE tenant_plan USING plan::tenant_plan;
ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'free';
DROP TYPE tenant_plan_new;
ALTER TABLE plan_settings DROP COLUMN yearly_price_inr;
ALTER TABLE tenants DROP COLUMN access_grandfathered;
COMMIT;
```

The mapping is mirrored by `oldPlanToNew` in `packages/shared/src/plan-migration.ts`, covered by a unit test and by the integration test `plan-migration.test.ts`.

---

## 5. Rolling Back Multiple Migrations

Run the reverse SQL newest first. For example, to go from 0036 back to 0033 on a single-database install: reverse 0036, then 0035, then 0034, deleting each tracking row as you go.

Then check the tracking table holds only the migrations you kept:

```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

Deploy app code whose journal ends at the last migration you kept. On start the runner (under `pg_advisory_lock(72919283)`) applies any journal entry whose `when` is newer than the newest `created_at` in the table. If the deployed code still contains the migrations you reversed, they will be applied again.

---

## 6. After Any Rollback

1. **Take a fresh backup immediately**. The pre-rollback state is gone (or at least, WAL timelines may have changed if you used PITR).
2. **Deploy matching application code**. The API and web app expect the schema to match. If you rolled back a migration, you must also deploy the code version that does not depend on that migration's schema changes.
3. **Run `ANALYZE`** on affected tables so the query planner has accurate statistics:
   ```sql
   ANALYZE;
   ```
4. **Verify the application works end-to-end**. Create an invoice, record a payment, check the dashboard -- exercise the core flows to confirm nothing is broken.

---

## 7. Known Issues in the Migration Sets

Found while writing this document. They affect rollback and fresh installs, so check them before relying on the runner.

- **Control journal pointed at a missing file (fixed).** `drizzle-control/meta/_journal.json` entry 4 has tag `0000_add_tenant_referral_code`, whose SQL file was missing, so drizzle refused to run any control migration (`No file ... found`). A no-op `drizzle-control/0000_add_tenant_referral_code.sql` now fills the slot; `0005_useful_darkhawk.sql` makes the real change (`tenants.referral_code`, `users.referral_code`).
- **Unified 0020 has an old timestamp.** `0020_add_user_referral_code` has `when` = 1700000000000 (2023-11-14), older than 0019. A database that was already past 0019 when 0020 was added skips it, so `users.referral_code` may be missing there. Fresh databases get it.
- **`drizzle/0002_performance_indexes.sql` is not in the journal**, so it never runs.
- **`access_tokens` has no unified migration.** The table is in `control-schema.ts` and in the unified snapshots, and `drizzle-control/0003` creates it, but no file in `drizzle/` does.
