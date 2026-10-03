/**
 * Migration 0055 (plans: Starter / Growth / Business) against a real
 * database. It builds scratch databases, so it never touches the shared test
 * database:
 *   1. a database migrated to 0054 and seeded with organisations on every
 *      old plan id, subscriptions and edited plan_settings, then migrated to
 *      the latest: plans mapped as oldPlanToNew says, Forever Free
 *      organisations grandfathered, stored plan settings converted with admin
 *      edits kept, enum rebuilt with no old value left;
 *   2. a fresh database migrated from nothing: the seeded plan rows become
 *      Growth and Business with the published prices;
 *   3. the migration SQL is safe to run again on a migrated database.
 * Needs a Postgres role that may CREATE DATABASE (the CI test user is one).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { LEGACY_PLAN_IDS, PLAN_DEFAULTS, PLAN_IDS, PLAN_PRICES, limitsToStored, oldPlanToNew } from "@fintranzact/shared";

const MIGRATION_TAG = "0055_plans_three_paid";
const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../db");
const baseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://test:test@localhost:5433/fintranzact_test";
const suffix = `${process.pid}_${Date.now()}`;

let admin: ReturnType<typeof postgres>;
let workDir: string;
const created: string[] = [];

function urlFor(db: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

async function scratchDb(label: string) {
  const name = `plan_mig_${label}_${suffix}`;
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  created.push(name);
  const sql = postgres(urlFor(name), { max: 1, onnotice: () => {} });
  return { name, sql };
}

async function runMigrations(sql: ReturnType<typeof postgres>, folder: string) {
  await migrate(drizzle(sql), { migrationsFolder: folder });
}

/** The unified migration folder without 0055 (and anything after it). */
function folderBefore(tag: string): string {
  const dst = join(workDir, "before");
  cpSync(join(DB_DIR, "drizzle"), dst, { recursive: true });
  const journalPath = join(dst, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  const at = journal.entries.findIndex((e) => e.tag === tag);
  expect(at).toBeGreaterThan(0);
  for (const e of journal.entries.slice(at)) rmSync(join(dst, `${e.tag}.sql`), { force: true });
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return dst;
}

beforeAll(async () => {
  admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  workDir = mkdtempSync(join(tmpdir(), "plan-migration-"));
});

afterAll(async () => {
  for (const name of created) {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
  }
  await admin.end();
  rmSync(workDir, { recursive: true, force: true });
});

const T = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("0055: a database with organisations on every old plan", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const db = await scratchDb("old");
    sql = db.sql;
    await runMigrations(sql, folderBefore(MIGRATION_TAG));

    // The old enum really has the old values.
    const labels = await sql<{ l: string }[]>`SELECT enumlabel AS l FROM pg_enum WHERE enumtypid = 'tenant_plan'::regtype`;
    expect(labels.map((r) => r.l).sort()).toEqual([...LEGACY_PLAN_IDS].sort());

    await sql`INSERT INTO tenants (id, name, slug, plan) VALUES
      (${T(1)}, 'FF org', 'ff', 'forever_free'),
      (${T(2)}, 'Free org', 'fr', 'free'),
      (${T(3)}, 'Pro org', 'pr', 'pro'),
      (${T(4)}, 'Biz org', 'bz', 'business'),
      (${T(5)}, 'Ent org', 'en', 'enterprise')`;
    await sql`INSERT INTO billing_subscriptions (tenant_id, kind, plan, scheduled_plan, cycle, status, base_paise) VALUES
      (${T(3)}, 'plan', 'pro', 'free', 'monthly', 'active', 69900),
      (${T(4)}, 'plan', 'business', NULL, 'yearly', 'active', 1499000)`;
    // The deploy seed (migration 0043) left pro and business rows. The admin
    // then edited Pro: own name, price 799, 7 businesses, own features.
    await sql`UPDATE plan_settings SET name = 'Pro Plus', monthly_price_inr = 799,
      limits = jsonb_set(limits, '{maxBusinesses}', '7'), features = '["Custom thing"]'::jsonb WHERE plan = 'pro'`;
    await sql`INSERT INTO plan_settings (plan, name, tagline, monthly_price_inr, features, highlight, visible, limits) VALUES
      ('free', 'Free (legacy)', 'Older organisations', 0, '["One business","Up to 3 team members"]', false, false,
       '{"maxOwnedOrgs":1,"maxBusinesses":1,"maxTeamMembers":4,"maxConcurrentSessions":3,"maxApiKeys":0,"recurringRunsPerMonth":5,"auditRetentionDays":30,"dataExport":false,"onlineStore":false,"pdfBranding":true}'),
      ('forever_free', 'Forever Free', 'Unlimited for life', 0, '["x"]', true, true, '{"maxBusinesses":null}'),
      ('enterprise', 'Enterprise', 'For large organisations', NULL, '["y"]', false, false, '{"maxBusinesses":null}')`;

    await runMigrations(sql, join(DB_DIR, "drizzle"));
  });

  afterAll(async () => {
    await sql.end();
  });

  it("maps every organisation's plan as oldPlanToNew says and grandfathers only Forever Free", async () => {
    const rows = await sql<{ id: string; plan: string; g: boolean }[]>`SELECT id, plan, access_grandfathered AS g FROM tenants ORDER BY slug`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const old = { [T(1)]: "forever_free", [T(2)]: "free", [T(3)]: "pro", [T(4)]: "business", [T(5)]: "enterprise" };
    for (const [id, was] of Object.entries(old)) {
      const want = oldPlanToNew(was)!;
      expect(byId.get(id), was).toMatchObject({ plan: want.plan, g: want.grandfathered });
    }
    expect(rows.filter((r) => r.g)).toHaveLength(1);
  });

  it("migrates subscriptions, including a scheduled downgrade", async () => {
    const rows = await sql<{ plan: string; scheduled_plan: string | null }[]>`SELECT plan, scheduled_plan FROM billing_subscriptions ORDER BY plan`;
    expect(rows).toEqual([
      { plan: "business", scheduled_plan: null },
      { plan: "growth", scheduled_plan: "starter" },
    ]);
  });

  it("leaves exactly starter, growth and business in the enum, and starter as the column default", async () => {
    const labels = await sql<{ l: string }[]>`SELECT enumlabel AS l FROM pg_enum WHERE enumtypid = 'tenant_plan'::regtype ORDER BY enumsortorder`;
    expect(labels.map((r) => r.l)).toEqual([...PLAN_IDS]);
    const [col] = await sql<{ d: string }[]>`SELECT column_default AS d FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'plan'`;
    expect(col!.d).toContain("starter");
    const left = await sql`SELECT 1 FROM pg_type WHERE typname = 'tenant_plan_old'`;
    expect(left).toHaveLength(0);
  });

  it("converts plan_settings: free to starter, pro to growth, business to business; the rest dropped", async () => {
    const rows = await sql<{ plan: string }[]>`SELECT plan FROM plan_settings ORDER BY plan`;
    expect(rows.map((r) => r.plan).sort()).toEqual(["business", "growth", "starter"]);
  });

  it("keeps what the admin edited (name, price, a limit, own features) and defaults the rest", async () => {
    const [growth] = await sql<Record<string, any>[]>`SELECT * FROM plan_settings WHERE plan = 'growth'`;
    expect(growth).toMatchObject({ name: "Pro Plus", monthly_price_inr: 799, yearly_price_inr: null, highlight: true, visible: true });
    expect(growth!.features).toEqual(["Custom thing"]);
    expect(growth!.tagline).toBe(PLAN_DEFAULTS.growth.tagline);
    const limits = growth!.limits as Record<string, unknown>;
    expect(limits.maxBusinesses).toBe(7); // edited, kept
    expect(limits.maxTeamMembers).toBe(PLAN_DEFAULTS.growth.limits.maxTeamMembers); // 15 was the old default: now 10
    expect(limits.eInvoicing).toBe(true); // new flag, plan default
  });

  it("gives the unedited rows the published names, prices and limits", async () => {
    const [starter] = await sql<Record<string, any>[]>`SELECT * FROM plan_settings WHERE plan = 'starter'`;
    expect(starter).toMatchObject({
      name: "Starter",
      monthly_price_inr: PLAN_PRICES.starter.monthlyInr,
      yearly_price_inr: PLAN_PRICES.starter.yearlyInr,
      visible: true,
      highlight: false,
    });
    expect(starter!.features).toEqual(PLAN_DEFAULTS.starter.features);
    expect(starter!.limits).toMatchObject({ ...limitsToStored(PLAN_DEFAULTS.starter.limits), maxTeamMembers: 4 }); // 4 was an admin edit of the old free row

    const [business] = await sql<Record<string, any>[]>`SELECT * FROM plan_settings WHERE plan = 'business'`;
    expect(business).toMatchObject({
      name: "Business",
      monthly_price_inr: PLAN_PRICES.business.monthlyInr,
      yearly_price_inr: PLAN_PRICES.business.yearlyInr,
    });
    expect(business!.limits).toEqual(limitsToStored(PLAN_DEFAULTS.business.limits));
  });

  it("can be run again on the migrated database without changing anything", async () => {
    const before = await sql`SELECT plan, name, monthly_price_inr, limits FROM plan_settings ORDER BY plan`;
    const file = readFileSync(join(DB_DIR, "drizzle", `${MIGRATION_TAG}.sql`), "utf8");
    await sql.unsafe(file);
    expect(await sql`SELECT plan, name, monthly_price_inr, limits FROM plan_settings ORDER BY plan`).toEqual(before);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tenants WHERE access_grandfathered`;
    expect(n).toBe(1);
  });
});

describe("0055: a fresh database", () => {
  it("ends with Growth and Business rows at the published prices, and tenants defaulting to starter", async () => {
    const { sql } = await scratchDb("fresh");
    try {
      await runMigrations(sql, join(DB_DIR, "drizzle"));
      const rows = await sql<Record<string, any>[]>`SELECT plan, name, monthly_price_inr, yearly_price_inr, highlight FROM plan_settings ORDER BY plan`;
      expect(rows).toEqual([
        { plan: "growth", name: "Growth", monthly_price_inr: 699, yearly_price_inr: 6999, highlight: true },
        { plan: "business", name: "Business", monthly_price_inr: 1499, yearly_price_inr: 14999, highlight: false },
      ]); // ORDER BY plan follows the enum order: starter, growth, business
      const [t] = await sql<{ plan: string; g: boolean }[]>`INSERT INTO tenants (name, slug) VALUES ('New', 'new') RETURNING plan, access_grandfathered AS g`;
      expect(t).toEqual({ plan: "starter", g: false });
      await expect(sql`INSERT INTO tenants (name, slug, plan) VALUES ('Old', 'old', 'free')`).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });
});
