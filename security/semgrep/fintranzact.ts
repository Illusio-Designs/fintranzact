// Fixtures for fintranzact.yml (semgrep --test). Lines flagged by the annotations below must match.
// Test data only; never imported or compiled.
import { sql } from "drizzle-orm";
import { createHash, createCipheriv } from "node:crypto";
// ruleid: fintranzact-child-process
import { execSync } from "node:child_process";

declare const db: any;
declare const name: string;
declare const jwt: any;
declare const searchParams: URLSearchParams;
declare const secret: string;

// ruleid: fintranzact-sql-raw-interpolation
const a = sql.raw(`SELECT * FROM ${name}`);
// ruleid: fintranzact-sql-raw-interpolation
const b = sql.raw("SELECT * FROM " + name);
// ok: fintranzact-sql-raw-interpolation
const c = sql.raw("SELECT 1");
// ok: fintranzact-sql-raw-interpolation
const d = sql`SELECT * FROM t WHERE id = ${name}`;

// ruleid: fintranzact-db-execute-string-building
db.execute(`SELECT * FROM t WHERE x = '${name}'`);
// ok: fintranzact-db-execute-string-building
db.execute(sql`SELECT * FROM t WHERE x = ${name}`);

// ruleid: fintranzact-eval
eval(name);
// ruleid: fintranzact-eval
const f = new Function(name);

// ruleid: fintranzact-shell-exec-dynamic
execSync(`git log ${name}`);
// ok: fintranzact-shell-exec-dynamic
execSync("git rev-parse HEAD");

// ruleid: fintranzact-insecure-random-for-secret, fintranzact-math-random-used
const sessionToken = Math.random().toString(36);
// ruleid: fintranzact-math-random-used
const confettiDelay = Math.random() * 2;

// ruleid: fintranzact-jwt-none-algorithm
jwt.verify(name, secret, { algorithms: ["none"] });
// ok: fintranzact-jwt-none-algorithm
jwt.verify(name, secret, { algorithms: ["HS256"] });

// ruleid: fintranzact-tls-verification-disabled
const agentOpts = { rejectUnauthorized: false };

// ruleid: fintranzact-weak-crypto
createHash("md5");
// ok: fintranzact-weak-crypto
createHash("sha256");

// ruleid: fintranzact-ecb-mode
createCipheriv("aes-256-ecb", secret, null);
// ok: fintranzact-ecb-mode
createCipheriv("aes-256-gcm", secret, name);

export function redirects() {
  // ruleid: fintranzact-open-redirect
  window.location.href = searchParams.get("next")!;
  // ok: fintranzact-open-redirect
  window.location.href = "/login";
}
