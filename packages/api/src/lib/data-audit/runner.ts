/**
 * Runs the data completeness rules against a tenant database and formats the
 * result. Read-only: every rule runs inside one REPEATABLE READ, READ ONLY
 * transaction, so the report is one consistent snapshot and cannot write.
 */

import type postgres from "postgres";
import { ALL_RULES, TABLE_COVERAGE } from "./registry.js";
import type { AuditReport, AuditRule, RuleResult, Severity } from "./types.js";

export interface RunAuditOptions {
  /** Only rows of these businesses. Null/empty = the whole database. */
  businessIds?: string[] | null;
  /** Sample rows kept per rule (default 5). */
  samples?: number;
  /** Only rules whose id starts with one of these prefixes (e.g. "invoices", "payments.bank"). */
  only?: string[];
  /** Rule list to run (defaults to the full registry). */
  rules?: AuditRule[];
}

export async function runAudit(sql: postgres.Sql, opts: RunAuditOptions = {}): Promise<AuditReport> {
  const startedAt = new Date();
  const businessIds = opts.businessIds && opts.businessIds.length > 0 ? opts.businessIds : null;
  const sampleCount = opts.samples ?? 5;
  const rules = (opts.rules ?? ALL_RULES).filter(
    (r) => !opts.only || opts.only.length === 0 || opts.only.some((p) => r.id.startsWith(p)),
  );
  const idsLiteral = businessIds ? `{${businessIds.join(",")}}` : null;

  const results: RuleResult[] = [];
  const failures: AuditReport["failures"] = [];

  await sql.begin("isolation level repeatable read read only", async (tx) => {
    for (const rule of rules) {
      try {
        // A savepoint per rule: one broken query is reported, the rest still run.
        const rows = await tx.savepoint((sp) => sp.unsafe(
          `SELECT COUNT(*) OVER ()::int AS total, r.business_id::text AS business_id, r.row_id::text AS row_id, r.detail::text AS detail
           FROM (${rule.sql}) AS r(business_id, row_id, detail)
           WHERE $1::uuid[] IS NULL OR r.business_id = ANY($1::uuid[])
           ORDER BY r.row_id
           LIMIT $2`,
          [idsLiteral, Math.max(sampleCount, 1)],
        ));
        if (rows.length > 0) {
          results.push({
            rule,
            count: Number(rows[0]!.total),
            samples: rows.slice(0, sampleCount).map((r) => ({
              businessId: String(r.business_id),
              rowId: String(r.row_id),
              detail: String(r.detail ?? ""),
            })),
          });
        }
      } catch (err) {
        failures.push({ rule, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  return { startedAt, finishedAt: new Date(), businessIds, rulesRun: rules.length, results, failures };
}

/** Violating rows of a given severity. */
export function countBySeverity(report: AuditReport, severity: Severity) {
  const hits = report.results.filter((r) => r.rule.severity === severity);
  return { rules: hits.length, rows: hits.reduce((s, r) => s + r.count, 0) };
}

/** Process exit code for a report: 0 clean, 1 violations, 2 rule queries failed. */
export function exitCodeFor(report: AuditReport, opts: { strict?: boolean } = {}) {
  if (report.failures.length > 0) return 2;
  const errors = countBySeverity(report, "error").rows;
  const warnings = countBySeverity(report, "warning").rows;
  return errors > 0 || (opts.strict && warnings > 0) ? 1 : 0;
}

/** Plain-text report grouped by table, then rule, with sample row ids and where to look. */
export function formatReport(report: AuditReport): string {
  const lines: string[] = [];
  const tablesCovered = TABLE_COVERAGE.length;
  const errors = countBySeverity(report, "error");
  const warnings = countBySeverity(report, "warning");
  lines.push(
    `Data audit — ${report.rulesRun} rules over ${tablesCovered} tenant tables` +
      (report.businessIds ? ` (businesses: ${report.businessIds.join(", ")})` : " (all businesses)"),
  );

  const byTable = new Map<string, RuleResult[]>();
  for (const r of report.results) {
    const list = byTable.get(r.rule.table) ?? [];
    list.push(r);
    byTable.set(r.rule.table, list);
  }
  for (const [table, results] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = results.reduce((s, r) => s + r.count, 0);
    lines.push("", `${table} — ${results.length} rule(s) violated, ${rows} row(s)`);
    for (const r of results.sort((a, b) => (a.rule.severity === b.rule.severity ? a.rule.id.localeCompare(b.rule.id) : a.rule.severity === "error" ? -1 : 1))) {
      lines.push(`  [${r.rule.severity === "error" ? "ERROR" : "WARN "}] ${r.rule.id} — ${r.count} row(s)`);
      lines.push(`      rule: ${r.rule.description}`);
      lines.push(`      written by: ${r.rule.writers.join("; ")}`);
      for (const s of r.samples) lines.push(`      - ${s.rowId}  ${s.detail}  (business ${s.businessId})`);
      if (r.count > r.samples.length) lines.push(`      … ${r.count - r.samples.length} more`);
    }
  }
  for (const f of report.failures) {
    lines.push("", `  [FAILED] ${f.rule.id}: ${f.error}`);
  }
  lines.push(
    "",
    `Result: ${errors.rows} error row(s) in ${errors.rules} rule(s), ${warnings.rows} warning row(s) in ${warnings.rules} rule(s)` +
      (report.failures.length ? `, ${report.failures.length} rule(s) failed to run` : "") +
      ` — ${report.finishedAt.getTime() - report.startedAt.getTime()} ms`,
  );
  return lines.join("\n");
}
