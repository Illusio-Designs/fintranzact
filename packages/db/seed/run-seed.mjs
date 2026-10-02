// Runs one SQL file from this folder against the database in DATABASE_URL (no psql needed).
//   node seed/run-seed.mjs plans.sql
//   pnpm --filter @fintranzact/db db:seed:plans
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error("Usage: node seed/run-seed.mjs <file.sql>");
  process.exit(1);
}
const path = join(here, basename(file));
if (!existsSync(path)) {
  console.error(`No such seed file: ${basename(file)}`);
  process.exit(1);
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(here, "..", "..", "..", ".env");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const url = databaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set (and none was found in the repo's .env).");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const [{ ready }] = await sql`select to_regclass('public.plan_settings') is not null as ready`;
  if (!ready) {
    console.error("The database has no tables yet. Run `pnpm db:push` first, then try again.");
    process.exit(1);
  }
  await sql.unsafe(readFileSync(path, "utf8"));
  console.log(`Loaded ${basename(path)}.`);
} catch (error) {
  console.error(`Could not load ${basename(path)}:`, error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
