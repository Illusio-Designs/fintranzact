/**
 * key-rotation.ts — re-encrypts every column that holds ENCRYPTION_KEY ciphertext.
 * Driven by src/bin/rotate-encryption-key.ts; procedure in docs/security/key-rotation.md.
 *
 * Properties:
 *   - idempotent and resumable: a value already in the v3 envelope under the current key id is skipped
 *   - one transaction per batch, rows locked FOR UPDATE so a concurrent write is never overwritten
 *     with an older value (readers are unaffected: both keys decrypt during the rotation)
 *   - a value no configured key opens is reported (table, column, row id) and left unchanged
 *   - nothing here logs plaintext, ciphertext or keys
 *
 * ENCRYPTED_TARGETS is the single list of encrypted columns. Add a column here whenever a new
 * encrypted column is introduced (a test fails if the schema grows an *_encrypted column that is
 * not listed).
 */

import { sql, type SQL } from "drizzle-orm";
import {
  decryptFieldStrict,
  getCurrentKeyId,
  isEncrypted,
  isOnCurrentKey,
  reEncryptField,
} from "@fintranzact/db";

/** The slice of a drizzle postgres-js database the rotation needs. */
export interface RotationDb {
  execute(query: SQL): PromiseLike<unknown>;
  transaction<T>(fn: (tx: RotationDb) => Promise<T>): Promise<T>;
}

export interface EncryptedTarget {
  scope: "control" | "tenant";
  table: string;
  pk: string;
  /** text columns that each hold one ciphertext */
  columns: string[];
  /** jsonb column holding { <carrier>: { apiKey, apiSecret, accountId, ... } } */
  carrierJson?: string;
}

export const ENCRYPTED_TARGETS: EncryptedTarget[] = [
  { scope: "control", table: "tenants", pk: "id", columns: ["db_password"] },
  { scope: "control", table: "user_two_factor", pk: "user_id", columns: ["secret_enc"] },
  { scope: "control", table: "share_links", pk: "id", columns: ["token_encrypted"] },
  { scope: "tenant", table: "e_invoice_configs", pk: "id", columns: ["client_id", "client_secret", "username", "password", "auth_token"] },
  { scope: "tenant", table: "eway_bill_configs", pk: "id", columns: ["client_id", "client_secret", "username", "password", "auth_token"] },
  {
    scope: "tenant",
    table: "razorpay_connections",
    pk: "id",
    columns: ["key_id_encrypted", "key_secret_encrypted", "webhook_secret_encrypted", "webhook_token_encrypted"],
  },
  { scope: "tenant", table: "businesses", pk: "id", columns: [], carrierJson: "carrier_credentials" },
  // Also the way to encrypt Aadhaar numbers saved before they were encrypted: plain values are encrypted here.
  { scope: "tenant", table: "employees", pk: "id", columns: ["aadhaar"] },
];

const CARRIER_FIELDS = ["apiKey", "apiSecret", "accountId"] as const;

export interface RotationCounts {
  /** non-empty values looked at */
  scanned: number;
  /** already on the current key, left alone */
  skipped: number;
  /** re-encrypted (or, in a dry run, would be) from an older key or format */
  rotated: number;
  /** of `rotated`: stored as plaintext and now encrypted */
  fromPlaintext: number;
  /** could not be processed (not opened by any configured key) */
  failed: number;
}

export interface RotationFailure {
  table: string;
  column: string;
  rowId: string;
  reason: string;
}

export function emptyCounts(): RotationCounts {
  return { scanned: 0, skipped: 0, rotated: 0, fromPlaintext: 0, failed: 0 };
}

export function addCounts(a: RotationCounts, b: RotationCounts): RotationCounts {
  return {
    scanned: a.scanned + b.scanned,
    skipped: a.skipped + b.skipped,
    rotated: a.rotated + b.rotated,
    fromPlaintext: a.fromPlaintext + b.fromPlaintext,
    failed: a.failed + b.failed,
  };
}

export interface RotateOptions {
  dryRun: boolean;
  batchSize: number;
  /** progress lines (counts only) */
  log?: (line: string) => void;
}

export interface RotateResult {
  counts: RotationCounts;
  failures: RotationFailure[];
}

// nosemgrep: fintranzact-sql-raw-interpolation -- names come only from the constant ENCRYPTED_TARGETS list above, never from input
const ident = (name: string): SQL => sql.raw(`"${name.replace(/"/g, '""')}"`);

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

/** Decide what to store for one cell. Returns undefined to leave it alone. */
function nextValue(
  value: unknown,
  counts: RotationCounts,
  fail: (reason: string) => void,
): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  counts.scanned++;
  if (isOnCurrentKey(value)) {
    counts.skipped++;
    return undefined;
  }
  try {
    const out = reEncryptField(value);
    if (out === value) {
      counts.skipped++;
      return undefined;
    }
    counts.rotated++;
    if (!isEncrypted(value)) counts.fromPlaintext++;
    return out;
  } catch (err) {
    counts.failed++;
    fail(err instanceof Error ? err.message : "re-encryption failed");
    return undefined;
  }
}

async function rotateTarget(db: RotationDb, t: EncryptedTarget, opts: RotateOptions): Promise<RotateResult> {
  const counts = emptyCounts();
  const failures: RotationFailure[] = [];
  const cols = [...t.columns, ...(t.carrierJson ? [t.carrierJson] : [])];
  const selectCols = sql.join([t.pk, ...cols].map((c) => sql`${ident(c)}`), sql`, `);
  let after: string | null = null;

  for (;;) {
    const cursor: SQL = after === null ? sql`` : sql`WHERE ${ident(t.pk)} > ${after}`;
    const lockClause: SQL = opts.dryRun ? sql`` : sql`FOR UPDATE`;
    const batchCounts = emptyCounts();

    const lastId = await (opts.dryRun ? runBatch(db) : db.transaction((tx) => runBatch(tx)));

    async function runBatch(conn: RotationDb): Promise<string | null> {
      const rows = rowsOf(
        await conn.execute(
          sql`SELECT ${selectCols} FROM ${ident(t.table)} ${cursor} ORDER BY ${ident(t.pk)} LIMIT ${opts.batchSize} ${lockClause}`,
        ),
      );
      for (const row of rows) {
        const rowId = String(row[t.pk]);
        const fail = (column: string) => (reason: string) => failures.push({ table: t.table, column, rowId, reason });
        const sets: SQL[] = [];

        for (const c of t.columns) {
          const next = nextValue(row[c], batchCounts, fail(c));
          if (next !== undefined) sets.push(sql`${ident(c)} = ${next}`);
        }

        if (t.carrierJson) {
          const raw = row[t.carrierJson];
          const creds = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, Record<string, unknown>> | null;
          if (creds && typeof creds === "object") {
            let changed = false;
            const updated: Record<string, Record<string, unknown>> = {};
            for (const [carrier, entry] of Object.entries(creds)) {
              const copy = { ...entry };
              for (const f of CARRIER_FIELDS) {
                const next = nextValue(entry?.[f], batchCounts, fail(`${t.carrierJson}.${carrier}.${f}`));
                if (next !== undefined) {
                  copy[f] = next;
                  changed = true;
                }
              }
              updated[carrier] = copy;
            }
            if (changed) sets.push(sql`${ident(t.carrierJson)} = ${JSON.stringify(updated)}::jsonb`);
          }
        }

        if (sets.length > 0 && !opts.dryRun) {
          await conn.execute(sql`UPDATE ${ident(t.table)} SET ${sql.join(sets, sql`, `)} WHERE ${ident(t.pk)} = ${rowId}`);
        }
      }
      return rows.length === opts.batchSize ? String(rows[rows.length - 1]![t.pk]) : null;
    }

    Object.assign(counts, addCounts(counts, batchCounts));
    if (lastId === null) break;
    after = lastId;
  }

  opts.log?.(
    `  ${t.table}: scanned ${counts.scanned}, ${opts.dryRun ? "to rotate" : "rotated"} ${counts.rotated}` +
      ` (from plaintext ${counts.fromPlaintext}), already current ${counts.skipped}, failed ${counts.failed}`,
  );
  return { counts, failures };
}

/** Rotate every target of one scope on one database. */
export async function rotateScope(
  db: RotationDb,
  scope: "control" | "tenant",
  opts: RotateOptions,
): Promise<RotateResult> {
  let counts = emptyCounts();
  const failures: RotationFailure[] = [];
  for (const t of ENCRYPTED_TARGETS.filter((x) => x.scope === scope)) {
    const r = await rotateTarget(db, t, opts);
    counts = addCounts(counts, r.counts);
    failures.push(...r.failures);
  }
  return { counts, failures };
}

/**
 * Verification pass: every non-empty encrypted cell must be a v3 value under the current key id
 * that decrypts with ONLY the current key (previous keys are ignored).
 */
export async function verifyScope(
  db: RotationDb,
  scope: "control" | "tenant",
  opts: { batchSize: number; log?: (line: string) => void },
): Promise<{ checked: number; failures: RotationFailure[] }> {
  let checked = 0;
  const failures: RotationFailure[] = [];

  const check = (t: EncryptedTarget, column: string, rowId: string, value: unknown) => {
    if (typeof value !== "string" || value === "") return;
    checked++;
    if (!isOnCurrentKey(value)) {
      failures.push({ table: t.table, column, rowId, reason: "not stored under the current key id" });
      return;
    }
    try {
      decryptFieldStrict(value, { currentKeyOnly: true });
    } catch {
      failures.push({ table: t.table, column, rowId, reason: "does not decrypt with the current key alone" });
    }
  };

  for (const t of ENCRYPTED_TARGETS.filter((x) => x.scope === scope)) {
    const cols = [...t.columns, ...(t.carrierJson ? [t.carrierJson] : [])];
    const selectCols = sql.join([t.pk, ...cols].map((c) => sql`${ident(c)}`), sql`, `);
    let after: string | null = null;
    for (;;) {
      const cursor: SQL = after === null ? sql`` : sql`WHERE ${ident(t.pk)} > ${after}`;
      const rows = rowsOf(
        await db.execute(
          sql`SELECT ${selectCols} FROM ${ident(t.table)} ${cursor} ORDER BY ${ident(t.pk)} LIMIT ${opts.batchSize}`,
        ),
      );
      for (const row of rows) {
        const rowId = String(row[t.pk]);
        for (const c of t.columns) check(t, c, rowId, row[c]);
        if (t.carrierJson) {
          const raw = row[t.carrierJson];
          const creds = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, Record<string, unknown>> | null;
          for (const [carrier, entry] of Object.entries(creds ?? {})) {
            for (const f of CARRIER_FIELDS) check(t, `${t.carrierJson}.${carrier}.${f}`, rowId, entry?.[f]);
          }
        }
      }
      if (rows.length < opts.batchSize) break;
      after = String(rows[rows.length - 1]![t.pk]);
    }
  }
  opts.log?.(`  verified ${checked} ${scope} values; problems ${failures.length}`);
  return { checked, failures };
}

/** Current key id for progress output (a fingerprint or label, never the key). */
export function currentKeyIdForLog(): string {
  return getCurrentKeyId() ?? "(none)";
}
