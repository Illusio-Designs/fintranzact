#!/usr/bin/env node
/**
 * API reference coverage check.
 *
 * Reads the tRPC app router (packages/api/src/router.ts) and every router it
 * mounts, lists each procedure, and reports the ones that have no matching
 * `path: "<router>.<procedure>"` entry in apps/api-docs/src/content/*.ts.
 *
 * Routers built by createDocumentRouter (quotation, creditNote, ... ) share one
 * set of procedures; a procedure counts as documented for all of them when any
 * one of those routers documents it (the Documents group uses one router as
 * the example and lists the per-type differences).
 *
 * Usage:
 *   node scripts/check-coverage.mjs            # report gaps, exit 1 if any
 *   node scripts/check-coverage.mjs --list     # also print every procedure
 *   node scripts/check-coverage.mjs --perms    # also list procedures whose body
 *                                              # never calls requireCan()
 *
 * No TypeScript compiler or database is needed — the router sources are read
 * as text with a small bracket-aware scanner.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, "..");
const apiSrc = resolve(docsRoot, "../../packages/api/src");
const contentDir = join(docsRoot, "src/content");

/** Routers deliberately left out of the public reference. */
const EXCLUDED_ROUTERS = new Set(["platform"]);

const args = new Set(process.argv.slice(2));

// ── Source scanning helpers ──────────────────────────────────────────────

/** Blank out comments and string/template contents so brackets inside them don't count. */
function stripCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && d === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += q; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += q; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

/**
 * Given source and the index just after `router(`, return the top-level
 * properties of the object literal: [{ key, body }]. `body` is the raw text of
 * the property value (used for the requireCan heuristic).
 */
function readRouterObject(src, clean, start) {
  let i = clean.indexOf("{", start);
  const props = [];
  let depth = 0;
  let expectKey = true;
  let current = null;
  for (; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      if (depth === 1) { expectKey = true; continue; }
    } else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) {
        if (current) { current.body = src.slice(current.start, i); props.push(current); }
        break;
      }
    } else if (depth === 1 && c === ",") {
      if (current) { current.body = src.slice(current.start, i); props.push(current); current = null; }
      expectKey = true;
      continue;
    }
    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(clean.slice(i));
      const key = m[0];
      current = { key, start: i };
      expectKey = false;
      i += key.length - 1;
    }
  }
  return props;
}

function routerPropsIn(file, exportName) {
  const src = readFileSync(file, "utf8");
  const clean = stripCode(src);
  const re = new RegExp(`export const ${exportName}\\s*=\\s*router\\(`);
  const m = re.exec(clean);
  if (!m) return null;
  return readRouterObject(src, clean, m.index + m[0].length);
}

function resolveImport(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const cand of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(cand)) return cand;
  throw new Error(`Cannot resolve ${spec} from ${fromFile}`);
}

// ── Collect procedures ───────────────────────────────────────────────────

const routerFile = join(apiSrc, "router.ts");
const routerSrc = readFileSync(routerFile, "utf8");

/** import name -> file */
const importMap = new Map();
for (const m of routerSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
  for (const name of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
    importMap.set(name, resolveImport(routerFile, m[2]));
  }
}

const appRouterProps = routerPropsIn(routerFile, "appRouter");
if (!appRouterProps) throw new Error("appRouter not found in router.ts");

// Procedures of the shared document router factory.
const factoryFile = join(apiSrc, "lib/document-router-factory.ts");
const factoryProps = (() => {
  const src = readFileSync(factoryFile, "utf8");
  const clean = stripCode(src);
  const m = /return\s+router\(/.exec(clean);
  return readRouterObject(src, clean, m.index + m[0].length);
})();

/** @type {{ router: string, proc: string, body: string, factory: boolean }[]} */
const procedures = [];
const factoryRouters = new Set();

for (const { key, body } of appRouterProps) {
  if (EXCLUDED_ROUTERS.has(key)) continue;
  const exportName = body.split(":").pop().trim() || key;
  const file = importMap.get(exportName);
  if (!file) throw new Error(`No import found for ${exportName} (router key ${key})`);
  const fileSrc = readFileSync(file, "utf8");
  if (new RegExp(`export const ${exportName}\\s*=\\s*createDocumentRouter\\(`).test(fileSrc)) {
    factoryRouters.add(key);
    for (const p of factoryProps) procedures.push({ router: key, proc: p.key, body: p.body, factory: true });
    continue;
  }
  const props = routerPropsIn(file, exportName);
  if (!props) throw new Error(`Could not read router ${exportName} in ${file}`);
  for (const p of props) {
    let body = p.body;
    // Shorthand property (imported procedure): pull the procedure's own source.
    if (body.trim() === p.key) {
      const m = new RegExp(`import\\s*\\{[^}]*\\b${p.key}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`).exec(fileSrc);
      if (m) {
        const procFile = resolveImport(file, m[1]);
        const procSrc = readFileSync(procFile, "utf8");
        const start = procSrc.search(new RegExp(`export const ${p.key}\\b`));
        body = start >= 0 ? procSrc.slice(start) : procSrc;
      }
    }
    procedures.push({ router: key, proc: p.key, body, factory: false });
  }
}

// ── Collect documented paths ─────────────────────────────────────────────

const documented = new Set();
/** endpoint id -> files defining it */
const endpointIds = new Map();
/** [file, id] pairs referenced from relatedEndpoints */
const related = [];
for (const f of readdirSync(contentDir)) {
  if (!f.endsWith(".ts")) continue;
  const src = readFileSync(join(contentDir, f), "utf8");
  for (const m of src.matchAll(/\bpath:\s*"([^"]+)"/g)) documented.add(m[1]);
  for (const m of src.matchAll(/\bid:\s*"([^"]+)",\s*\n\s*method:/g)) {
    endpointIds.set(m[1], [...(endpointIds.get(m[1]) ?? []), f]);
  }
  for (const m of src.matchAll(/relatedEndpoints:\s*\[([^\]]*)\]/g)) {
    for (const r of m[1].matchAll(/"([^"]+)"/g)) related.push([f, r[1]]);
  }
}
const duplicateIds = [...endpointIds].filter(([, files]) => files.length > 1);
const danglingRelated = related.filter(([, id]) => !endpointIds.has(id));

const isDocumented = ({ router, proc, factory }) => {
  if (documented.has(`${router}.${proc}`)) return true;
  if (factory) for (const r of factoryRouters) if (documented.has(`${r}.${proc}`)) return true;
  return false;
};

// ── Report ───────────────────────────────────────────────────────────────

const gaps = procedures.filter((p) => !isDocumented(p));

if (args.has("--list")) {
  for (const p of procedures) console.log(`${isDocumented(p) ? "  ok " : "  -- "}${p.router}.${p.proc}`);
  console.log("");
}

if (args.has("--perms")) {
  const publicish = /\b(publicProcedure|protectedProcedure|tenantProcedure|businessProcedure)\b/;
  const noCheck = procedures.filter((p) => !/requireCan\(/.test(p.body));
  const seen = new Set();
  console.log("Procedures whose own body has no requireCan() call (check helpers before trusting this):");
  for (const p of noCheck) {
    const id = p.factory ? `<document>.${p.proc}` : `${p.router}.${p.proc}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const kind = (publicish.exec(p.body) || ["authorizedProcedure"])[0];
    console.log(`  ${id}  [${kind}]`);
  }
  console.log("");
}

const routerCount = new Set(procedures.map((p) => p.router)).size;
console.log(
  `API reference coverage: ${procedures.length - gaps.length}/${procedures.length} procedures across ${routerCount} routers` +
    ` (excluded: ${[...EXCLUDED_ROUTERS].join(", ")}; document routers share ${factoryProps.length} procedures).`,
);
let failed = false;
if (gaps.length) {
  failed = true;
  console.log(`\n${gaps.length} undocumented procedure(s):`);
  const byRouter = new Map();
  for (const g of gaps) {
    const key = g.factory ? `document types (${[...factoryRouters].join(", ")})` : g.router;
    if (!byRouter.has(key)) byRouter.set(key, new Set());
    byRouter.get(key).add(g.proc);
  }
  for (const [r, ps] of byRouter) console.log(`  ${r}: ${[...ps].join(", ")}`);
}
if (duplicateIds.length) {
  failed = true;
  console.log(`\n${duplicateIds.length} duplicate endpoint id(s):`);
  for (const [id, files] of duplicateIds) console.log(`  ${id} (${files.join(", ")})`);
}
if (danglingRelated.length) {
  failed = true;
  console.log(`\n${danglingRelated.length} relatedEndpoints reference(s) to unknown endpoint ids:`);
  for (const [f, id] of danglingRelated) console.log(`  ${f}: ${id}`);
}
if (failed) process.exit(1);
console.log("No gaps.");
