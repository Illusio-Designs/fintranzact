/**
 * key-rotation.test.ts — the encryption-key rotation tool against a real Postgres: every encrypted
 * column, dry run, idempotence, fail-closed on a missing previous key, verification with the
 * current key alone, reads during rotation, and the exit codes of the bin script.
 * Design: docs/security/key-rotation.md.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import {
  businesses,
  decryptField,
  eInvoiceConfigs,
  employees,
  ewayBillConfigs,
  razorpayConnections,
  shareLinks,
  tenants,
  userTwoFactor,
} from "@fintranzact/db";
import { createBusiness, createTenant, createUser } from "../helpers/fixtures.js";
import { closeTestDb, getControlDb, getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import {
  ENCRYPTED_TARGETS,
  rotateScope,
  verifyScope,
  type RotateOptions,
  type RotationDb,
} from "../../lib/key-rotation.js";

const KEY_OLD = "0a".repeat(32);
const KEY_NEW = "9f".repeat(32);
const VARS = ["ENCRYPTION_KEY", "DB_ENCRYPTION_KEY", "ENCRYPTION_KEY_ID", "ENCRYPTION_KEY_PREVIOUS", "ENCRYPTION_KEYS_PREVIOUS"];

function setEnv(env: Record<string, string>) {
  for (const v of VARS) delete process.env[v];
  Object.assign(process.env, env);
}

/** Value in the pre-key-id format (v2) under a given key. */
function v2(plain: string, keyHex = KEY_OLD): string {
  const iv = randomBytes(16);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v2:${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

const control = () => getControlDb() as unknown as RotationDb;
const tenantDb = () => getTenantTestDb() as unknown as RotationDb;
const run = (dryRun: boolean): RotateOptions => ({ dryRun, batchSize: 2 });

const PLAIN = {
  dbPassword: "tenant-db-password",
  totp: "JBSWY3DPEHPK3PXP",
  shareToken: "share-token-abc",
  eInvUser: "irp-user",
  eInvPass: "irp-pass",
  eInvClientSecret: "irp-client-secret",
  ewbUser: "ewb-user",
  ewbPass: "ewb-pass",
  rzpKeyId: "rzp_test_ABCDEF",
  rzpKeySecret: "rzp-key-secret",
  rzpWebhook: "rzp-webhook-secret",
  rzpToken: "rzp-webhook-token",
  carrierKey: "carrier-api-key",
  carrierSecret: "carrier-api-secret",
};

let tenantId: string;
let businessId: string;
let userId: string;
let extraTenantIds: string[] = [];

async function seed() {
  setEnv({ ENCRYPTION_KEY: KEY_OLD }); // not used to write; values are built by hand below in the old formats
  const user = await createUser();
  userId = user.id;
  const tenant = await createTenant({ dbPassword: v2(PLAIN.dbPassword) });
  tenantId = tenant.id;
  // more tenants than the batch size so keyset paging is exercised
  extraTenantIds = [];
  for (let i = 0; i < 4; i++) {
    const t = await createTenant({ dbPassword: v2(`pw-${i}`) });
    extraTenantIds.push(t.id);
  }
  const biz = await createBusiness(getTenantTestDb(), userId, {
    carrierCredentials: {
      shiprocket: { apiKey: v2(PLAIN.carrierKey), apiSecret: v2(PLAIN.carrierSecret), enabled: true },
      delhivery: { apiKey: v2("delhivery-key"), enabled: false },
    },
  });
  businessId = biz.id;

  const c = getControlDb();
  await c.insert(userTwoFactor).values({ userId, secretEnc: v2(PLAIN.totp), confirmedAt: new Date() });
  await c.insert(shareLinks).values({
    tokenHash: "h".repeat(64),
    tokenEncrypted: v2(PLAIN.shareToken),
    tenantId,
    businessId,
    documentId: randomUUID(),
  });
  const t = getTenantTestDb();
  await t.insert(eInvoiceConfigs).values({
    businessId,
    gstin: "27AABCU9603R1ZM",
    clientId: null,
    clientSecret: v2(PLAIN.eInvClientSecret),
    username: v2(PLAIN.eInvUser),
    password: v2(PLAIN.eInvPass),
    authToken: null,
  });
  await t.insert(ewayBillConfigs).values({
    businessId,
    gstin: "27AABCU9603R1ZM",
    username: v2(PLAIN.ewbUser),
    password: v2(PLAIN.ewbPass),
  });
  await t.insert(razorpayConnections).values({
    businessId,
    keyIdEncrypted: v2(PLAIN.rzpKeyId),
    keySecretEncrypted: v2(PLAIN.rzpKeySecret),
    webhookSecretEncrypted: v2(PLAIN.rzpWebhook),
    keyIdMasked: "rzp_test_••••CDEF",
    mode: "test",
    webhookTokenHash: "t".repeat(64),
    webhookTokenEncrypted: v2(PLAIN.rzpToken),
  });
}

async function readAllPlain() {
  const c = getControlDb();
  const t = getTenantTestDb();
  const [ten] = await c.select().from(tenants).where(eq(tenants.id, tenantId));
  const [tf] = await c.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId));
  const [sl] = await c.select().from(shareLinks).where(eq(shareLinks.tenantId, tenantId));
  const [ei] = await t.select().from(eInvoiceConfigs).where(eq(eInvoiceConfigs.businessId, businessId));
  const [ew] = await t.select().from(ewayBillConfigs).where(eq(ewayBillConfigs.businessId, businessId));
  const [rz] = await t.select().from(razorpayConnections).where(eq(razorpayConnections.businessId, businessId));
  const [biz] = await t.select().from(businesses).where(eq(businesses.id, businessId));
  const carriers = biz!.carrierCredentials!;
  return {
    dbPassword: decryptField(ten!.dbPassword!),
    totp: decryptField(tf!.secretEnc),
    shareToken: decryptField(sl!.tokenEncrypted),
    eInvUser: decryptField(ei!.username),
    eInvPass: decryptField(ei!.password),
    eInvClientSecret: decryptField(ei!.clientSecret!),
    ewbUser: decryptField(ew!.username),
    ewbPass: decryptField(ew!.password),
    rzpKeyId: decryptField(rz!.keyIdEncrypted),
    rzpKeySecret: decryptField(rz!.keySecretEncrypted),
    rzpWebhook: decryptField(rz!.webhookSecretEncrypted!),
    rzpToken: decryptField(rz!.webhookTokenEncrypted),
    carrierKey: decryptField(carriers.shiprocket!.apiKey!),
    carrierSecret: decryptField(carriers.shiprocket!.apiSecret!),
  };
}

async function snapshotRaw(): Promise<string> {
  const c = getControlDb();
  const t = getTenantTestDb();
  const parts = [
    await c.select().from(tenants),
    await c.select().from(userTwoFactor),
    await c.select().from(shareLinks),
    await t.select().from(eInvoiceConfigs),
    await t.select().from(ewayBillConfigs),
    await t.select().from(razorpayConnections),
    await t.select({ id: businesses.id, c: businesses.carrierCredentials }).from(businesses),
  ];
  return JSON.stringify(parts);
}

const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const v of VARS) savedEnv[v] = process.env[v];
});
afterAll(async () => {
  for (const v of VARS) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
  await truncateAllTables();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
  await seed();
});
afterEach(() => setEnv({}));

describe("encrypted column inventory", () => {
  it("lists every column in the schema that looks like ciphertext", async () => {
    const rows = (await getControlDb().execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_name LIKE '%\\_encrypted' OR column_name LIKE '%\\_enc')`)) as unknown as Array<{
      table_name: string;
      column_name: string;
    }>;
    const listed = new Set(ENCRYPTED_TARGETS.flatMap((t) => t.columns.map((c) => `${t.table}.${c}`)));
    const missing = rows.map((r) => `${r.table_name}.${r.column_name}`).filter((k) => !listed.has(k));
    expect(missing).toEqual([]);
  });
});

describe("rotation", () => {
  it("rotates every encrypted column, keeps every plaintext, and verifies with the new key alone", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    expect(await readAllPlain()).toEqual(PLAIN);

    const c = await rotateScope(control(), "control", run(false));
    const t = await rotateScope(tenantDb(), "tenant", run(false));
    expect(c.failures).toEqual([]);
    expect(t.failures).toEqual([]);
    // 5 tenants + 1 totp + 1 share link; 3 + 2 + 4 + 3 carrier fields... counted per non-empty value
    expect(c.counts).toMatchObject({ rotated: 7, skipped: 0, failed: 0 });
    expect(t.counts).toMatchObject({ rotated: 3 + 2 + 4 + 3, skipped: 0, failed: 0 });

    expect(await readAllPlain()).toEqual(PLAIN);

    // The old key is no longer needed.
    setEnv({ ENCRYPTION_KEY: KEY_NEW });
    expect(await readAllPlain()).toEqual(PLAIN);
    const vc = await verifyScope(control(), "control", { batchSize: 2 });
    const vt = await verifyScope(tenantDb(), "tenant", { batchSize: 2 });
    expect(vc.failures).toEqual([]);
    expect(vt.failures).toEqual([]);
    expect(vc.checked + vt.checked).toBe(7 + 12);
  });

  it("a dry run reports counts and changes nothing", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    const before = await snapshotRaw();
    const c = await rotateScope(control(), "control", run(true));
    const t = await rotateScope(tenantDb(), "tenant", run(true));
    expect(c.counts.rotated).toBe(7);
    expect(t.counts.rotated).toBe(12);
    expect(await snapshotRaw()).toBe(before);
  });

  it("is idempotent: a second run rotates nothing and rewrites nothing", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    await rotateScope(control(), "control", run(false));
    await rotateScope(tenantDb(), "tenant", run(false));
    const after1 = await snapshotRaw();
    const c = await rotateScope(control(), "control", run(false));
    const t = await rotateScope(tenantDb(), "tenant", run(false));
    expect(c.counts.rotated + t.counts.rotated).toBe(0);
    expect(c.counts.skipped + t.counts.skipped).toBe(19);
    expect(await snapshotRaw()).toBe(after1);
  });

  it("resumes after a partial run (some values already rotated)", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    // a first run limited to the control database stands in for an interrupted run
    await rotateScope(control(), "control", run(false));
    const t = await rotateScope(tenantDb(), "tenant", run(false));
    expect(t.counts.rotated).toBe(12);
    expect(await readAllPlain()).toEqual(PLAIN);
  });

  it("encrypts plaintext it finds and counts it separately", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    await getTenantTestDb()
      .update(ewayBillConfigs)
      .set({ password: "legacy-plaintext-password" })
      .where(eq(ewayBillConfigs.businessId, businessId));
    const t = await rotateScope(tenantDb(), "tenant", run(false));
    expect(t.counts.fromPlaintext).toBe(1);
    const [ew] = await getTenantTestDb().select().from(ewayBillConfigs).where(eq(ewayBillConfigs.businessId, businessId));
    expect(ew!.password).toMatch(/^v3:/);
    expect(decryptField(ew!.password)).toBe("legacy-plaintext-password");
  });

  it("fails closed when a needed previous key is missing: reports the row, writes nothing for it, leaks nothing", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW }); // KEY_OLD not supplied
    const before = await snapshotRaw();
    const c = await rotateScope(control(), "control", run(false));
    const t = await rotateScope(tenantDb(), "tenant", run(false));
    expect(c.counts.failed).toBe(7);
    expect(t.counts.failed).toBe(12);
    expect(c.counts.rotated + t.counts.rotated).toBe(0);
    expect(await snapshotRaw()).toBe(before);
    const text = JSON.stringify([c.failures, t.failures]);
    for (const secret of [KEY_OLD, KEY_NEW, ...Object.values(PLAIN)]) expect(text).not.toContain(secret);
    // verification also refuses
    const v = await verifyScope(control(), "control", { batchSize: 2 });
    expect(v.failures.length).toBe(7);
  });

  it("one bad value does not stop the rest of the batch", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    await getTenantTestDb()
      .update(eInvoiceConfigs)
      .set({ password: v2("orphan", "77".repeat(32)) })
      .where(eq(eInvoiceConfigs.businessId, businessId));
    const t = await rotateScope(tenantDb(), "tenant", run(false));
    expect(t.counts.failed).toBe(1);
    expect(t.counts.rotated).toBe(11);
    expect(t.failures[0]).toMatchObject({ table: "e_invoice_configs", column: "password" });
  });

  it("detects a tampered stored value in verification", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    await rotateScope(tenantDb(), "tenant", run(false));
    const [rz] = await getTenantTestDb().select().from(razorpayConnections).where(eq(razorpayConnections.businessId, businessId));
    const parts = rz!.keySecretEncrypted.split(":");
    parts[4] = (parts[4]![0] === "0" ? "1" : "0") + parts[4]!.slice(1);
    await getTenantTestDb()
      .update(razorpayConnections)
      .set({ keySecretEncrypted: parts.join(":") })
      .where(eq(razorpayConnections.businessId, businessId));
    const v = await verifyScope(tenantDb(), "tenant", { batchSize: 2 });
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toMatchObject({ table: "razorpay_connections", column: "key_secret_encrypted" });
  });

  it("readers keep getting the right plaintext while a rotation runs", async () => {
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    let reading = true;
    const reads: Array<Awaited<ReturnType<typeof readAllPlain>>> = [];
    const reader = (async () => {
      while (reading) {
        reads.push(await readAllPlain());
      }
    })();
    await rotateScope(control(), "control", run(false));
    await rotateScope(tenantDb(), "tenant", run(false));
    reading = false;
    await reader;
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r).toEqual(PLAIN);
  });
});

describe("rotate-encryption-key bin", () => {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://test:test@localhost:5433/fintranzact_test";

  function bin(args: string[], env: Record<string, string>) {
    const clean: NodeJS.ProcessEnv = { ...process.env };
    for (const v of VARS) delete clean[v];
    return spawnSync(path.join(apiDir, "../../node_modules/.bin/tsx"), ["src/bin/rotate-encryption-key.ts", ...args], {
      cwd: apiDir,
      env: { ...clean, DATABASE_URL: url, CONTROL_DATABASE_URL: url, MULTI_TENANT: "false", ...env },
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  it("dry run exits 0 and writes nothing; a missing previous key exits 1; the real run exits 0 and verifies", async () => {
    const before = await snapshotRaw();
    const dry = bin(["--dry-run"], { ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("Would rotate: 19");
    expect(await snapshotRaw()).toBe(before);

    const missing = bin([], { ENCRYPTION_KEY: KEY_NEW });
    expect(missing.status).toBe(1);
    expect(await snapshotRaw()).toBe(before);

    const real = bin(["--batch-size", "2"], { ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    expect(real.status).toBe(0);
    expect(real.stdout).toContain("Verified under the current key alone: 19; problems: 0");
    const output = real.stdout + real.stderr + missing.stdout + missing.stderr;
    for (const secret of [KEY_OLD, KEY_NEW, ...Object.values(PLAIN)]) expect(output).not.toContain(secret);

    const verify = bin(["--verify-only"], { ENCRYPTION_KEY: KEY_NEW });
    expect(verify.status).toBe(0);

    const noKey = bin([], {});
    expect(noKey.status).toBe(3);
  }, 120_000);
});

describe("employee Aadhaar numbers", () => {
  const AADHAAR_A = "234567890123";
  const AADHAAR_B = "345678901234";
  const AADHAAR_C = "456789012345";

  async function addEmployees() {
    const t = getTenantTestDb();
    const base = { businessId, dateOfJoining: "2026-04-01" };
    await t.insert(employees).values([
      { ...base, employeeCode: "R1", name: "Plain Digits", aadhaar: AADHAAR_A },
      { ...base, employeeCode: "R2", name: "Old Key", aadhaar: v2(AADHAAR_B) },
      { ...base, employeeCode: "R3", name: "No Aadhaar", aadhaar: null },
    ]);
    const rows = await t.select({ code: employees.employeeCode, aadhaar: employees.aadhaar }).from(employees);
    return Object.fromEntries(rows.map((r) => [r.code, r.aadhaar]));
  }

  it("encrypts numbers saved as plain digits and re-encrypts the ones on an old key", async () => {
    await addEmployees();
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    const t = await rotateScope(tenantDb(), "tenant", run(false));
    expect(t.failures).toEqual([]);
    // 12 from the seed, plus the plain-digit number and the old-key one; the empty one is not counted
    expect(t.counts).toMatchObject({ rotated: 12 + 2, fromPlaintext: 1, failed: 0 });

    setEnv({ ENCRYPTION_KEY: KEY_NEW });
    const after = await getTenantTestDb().select({ code: employees.employeeCode, aadhaar: employees.aadhaar }).from(employees);
    const byCode = Object.fromEntries(after.map((r) => [r.code, r.aadhaar]));
    expect(byCode.R3).toBeNull();
    expect(byCode.R1).not.toContain(AADHAAR_A);
    expect(byCode.R2).not.toContain(AADHAAR_B);
    expect(decryptField(byCode.R1!)).toBe(AADHAAR_A);
    expect(decryptField(byCode.R2!)).toBe(AADHAAR_B);

    const vt = await verifyScope(tenantDb(), "tenant", { batchSize: 2 });
    expect(vt.failures).toEqual([]);
    expect(vt.checked).toBe(12 + 2);
  });

  it("a dry run changes nothing, and a second run rotates nothing", async () => {
    const before = await addEmployees();
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    const dry = await rotateScope(tenantDb(), "tenant", run(true));
    expect(dry.counts.fromPlaintext).toBe(1);
    const unchanged = await getTenantTestDb().select({ code: employees.employeeCode, aadhaar: employees.aadhaar }).from(employees);
    expect(Object.fromEntries(unchanged.map((r) => [r.code, r.aadhaar]))).toEqual(before);

    await rotateScope(tenantDb(), "tenant", run(false));
    const again = await rotateScope(tenantDb(), "tenant", run(false));
    expect(again.counts.rotated).toBe(0);
  });

  it("reports a number no configured key opens, and leaves it unchanged", async () => {
    const t = getTenantTestDb();
    await t.insert(employees).values({ businessId, employeeCode: "R4", name: "Lost Key", dateOfJoining: "2026-04-01", aadhaar: v2(AADHAAR_C, "5c".repeat(32)) });
    setEnv({ ENCRYPTION_KEY: KEY_NEW, ENCRYPTION_KEYS_PREVIOUS: KEY_OLD });
    const res = await rotateScope(tenantDb(), "tenant", run(false));
    expect(res.failures).toEqual([expect.objectContaining({ table: "employees", column: "aadhaar" })]);
    expect(JSON.stringify(res.failures)).not.toContain(AADHAAR_C);
  });
});
