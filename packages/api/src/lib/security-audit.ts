/**
 * security-audit.ts — policy for the "Dependency audit" CI job (scripts: src/bin/audit-check.ts).
 *
 * Policy (docs/security/vulnerability-management.md):
 *   - critical and high advisories on production dependencies fail the job
 *   - moderate and low are reported only
 *   - a reviewed exception lives in security/audit-allowlist.json with advisory id, package, reason,
 *     owner, the date it was added and an expiry at most 90 days after that; an expired entry fails
 *     the job, and so does an incomplete or over-long one
 *   - an entry that no longer matches any finding is reported as stale (remove it)
 */

export type Severity = "critical" | "high" | "moderate" | "low" | "info";

export interface Advisory {
  /** GHSA id parsed from the advisory url, else the numeric id as text */
  id: string;
  url: string;
  title: string;
  severity: Severity;
  vulnerableVersions: string;
}

export interface Finding extends Advisory {
  package: string;
  version: string;
}

export interface AllowlistEntry {
  advisory: string;
  package: string;
  reason: string;
  owner: string;
  added: string;
  expires: string;
}

export const MAX_ALLOWLIST_DAYS = 90;
const DAY_MS = 86_400_000;

// ── Version ranges (the subset npm advisories use) ───────────────────────────

type Parsed = { nums: [number, number, number]; pre: string[] };

function parseVersion(v: string): Parsed | null {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ? m[4].split(".") : [] };
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a release is newer than its prereleases
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Cannot compare versions "${a}" and "${b}"`);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i]! !== pb.nums[i]!) return pa.nums[i]! < pb.nums[i]! ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

function satisfiesComparator(version: string, comp: string): boolean {
  const m = comp.match(/^(<=|>=|<|>|=)?\s*(.+)$/);
  if (!m) throw new Error(`Bad version comparator "${comp}"`);
  const op = m[1] ?? "=";
  const c = compareVersions(version, m[2]!);
  switch (op) {
    case "<": return c < 0;
    case "<=": return c <= 0;
    case ">": return c > 0;
    case ">=": return c >= 0;
    default: return c === 0;
  }
}

/** True when `version` is inside an advisory range such as ">=1.0.0 <1.2.3 || >=2.0.0 <2.0.5". */
export function inVulnerableRange(version: string, range: string): boolean {
  const r = range.trim();
  if (r === "" || r === "*") return true;
  return r.split("||").some((alt) => {
    const comps = alt.trim().split(/\s+/).filter(Boolean);
    // "<=" and the version may be separated by a space in some ranges: ">= 1.0.0"
    const merged: string[] = [];
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i]!;
      if (/^(<=|>=|<|>|=)$/.test(c) && comps[i + 1]) merged.push(c + comps[++i]!);
      else merged.push(c);
    }
    return merged.every((c) => satisfiesComparator(version, c));
  });
}

// ── Registry response → findings ─────────────────────────────────────────────

interface RawAdvisory {
  id?: number | string;
  url?: string;
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
}

function advisoryId(raw: RawAdvisory): string {
  const ghsa = raw.url?.match(/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})/i)?.[1];
  return (ghsa ?? String(raw.id ?? raw.url ?? "unknown")).toUpperCase().replace(/^GHSA-/, "GHSA-");
}

/** `response` is the body of POST /-/npm/v1/security/advisories/bulk; `installed` maps package to versions. */
export function findingsFrom(response: Record<string, RawAdvisory[]>, installed: Map<string, Set<string>>): Finding[] {
  const out: Finding[] = [];
  for (const [pkg, advisories] of Object.entries(response)) {
    const versions = installed.get(pkg);
    if (!versions) continue;
    for (const raw of advisories) {
      const range = raw.vulnerable_versions ?? "*";
      for (const version of versions) {
        let hit = false;
        try {
          hit = inVulnerableRange(version, range);
        } catch {
          hit = true; // an unparseable range is treated as affected: fail safe, review by hand
        }
        if (!hit) continue;
        const sev = (raw.severity ?? "moderate").toLowerCase();
        out.push({
          id: advisoryId(raw),
          url: raw.url ?? "",
          title: raw.title ?? "",
          severity: (["critical", "high", "moderate", "low", "info"].includes(sev) ? sev : "moderate") as Severity,
          vulnerableVersions: range,
          package: pkg,
          version,
        });
      }
    }
  }
  return out;
}

// ── Allowlist ────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function validateAllowlist(entries: unknown, today: string): { errors: string[]; entries: AllowlistEntry[] } {
  const errors: string[] = [];
  const list: AllowlistEntry[] = [];
  if (!Array.isArray(entries)) return { errors: ["security/audit-allowlist.json: \"entries\" must be an array"], entries: [] };
  entries.forEach((raw, i) => {
    const e = raw as Partial<AllowlistEntry>;
    const where = `allowlist entry ${i + 1} (${e?.advisory ?? "?"} ${e?.package ?? "?"})`;
    for (const key of ["advisory", "package", "reason", "owner", "added", "expires"] as const) {
      if (typeof e?.[key] !== "string" || !e[key]!.trim()) errors.push(`${where}: "${key}" is required`);
    }
    if (errors.some((x) => x.startsWith(where))) return;
    if (!ISO_DATE.test(e.added!) || !ISO_DATE.test(e.expires!)) {
      errors.push(`${where}: "added" and "expires" must be YYYY-MM-DD`);
      return;
    }
    const span = dayNumber(e.expires!) - dayNumber(e.added!);
    if (span > MAX_ALLOWLIST_DAYS) errors.push(`${where}: expires ${span} days after it was added; the maximum is ${MAX_ALLOWLIST_DAYS}`);
    if (span < 0) errors.push(`${where}: expires before it was added`);
    if (dayNumber(e.expires!) < dayNumber(today)) errors.push(`${where}: EXPIRED on ${e.expires}. Fix the dependency or re-review and renew (new "added" date)`);
    list.push(e as AllowlistEntry);
  });
  return { errors, entries: list };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface AuditEvaluation {
  failures: Finding[];
  allowed: Array<Finding & { entry: AllowlistEntry }>;
  reported: Finding[];
  stale: AllowlistEntry[];
  allowlistErrors: string[];
  ok: boolean;
}

export function evaluate(findings: Finding[], allowlistEntries: unknown, today: string): AuditEvaluation {
  const { errors, entries } = validateAllowlist(allowlistEntries, today);
  const failures: Finding[] = [];
  const allowed: Array<Finding & { entry: AllowlistEntry }> = [];
  const reported: Finding[] = [];
  const used = new Set<AllowlistEntry>();
  const unexpired = entries.filter((e) => dayNumber(e.expires) >= dayNumber(today));

  for (const f of findings) {
    if (f.severity !== "critical" && f.severity !== "high") {
      reported.push(f);
      continue;
    }
    const entry = unexpired.find((e) => e.advisory.toUpperCase() === f.id && e.package === f.package);
    if (entry) {
      used.add(entry);
      allowed.push({ ...f, entry });
    } else {
      failures.push(f);
    }
  }
  const stale = entries.filter((e) => !used.has(e));
  return { failures, allowed, reported, stale, allowlistErrors: errors, ok: failures.length === 0 && errors.length === 0 };
}
