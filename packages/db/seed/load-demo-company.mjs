// Loads seed/demo-company.sql into the database in DATABASE_URL (no psql needed).
//   pnpm --filter @fintranzact/db db:seed:demo
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));

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
  const [{ ready }] = await sql`select to_regclass('public.businesses') is not null and to_regclass('public.users') is not null as ready`;
  if (!ready) {
    console.error("The database has no tables yet. Run `pnpm db:push` first, then try again.");
    process.exit(1);
  }
  await sql.unsafe(readFileSync(join(here, "demo-company.sql"), "utf8"));
  console.log("Demo company loaded.");
  console.log("  Login:    demo@fintranzact.test");
  console.log("  Password: Demo@12345");
} catch (error) {
  console.error("Could not load the demo company:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
