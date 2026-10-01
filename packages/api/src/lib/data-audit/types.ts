/**
 * Data completeness audit ("Layer 4") — shared types.
 *
 * A rule is one SQL query that returns the rows breaking one business-logic
 * requirement. The requirement is something the database itself does not
 * enforce (a nullable column the code always fills, a total that must equal
 * the sum of its parts, a ledger that must reconcile with its postings…).
 *
 * Every rule query MUST return exactly these columns:
 *   business_id  uuid   — the owning business (used to scope a run)
 *   row_id       text   — primary key of the offending row (or a composite key)
 *   detail       text   — a short human-readable explanation with the values
 */

export type Severity =
  /** A broken invariant: the writer produced data the rest of the app will misread. */
  | "error"
  /** Data the app deliberately accepts (it only warns on entry) but that
   *  produces a wrong or incomplete statutory output (GSTR-1, e-invoice…)
   *  until someone fixes it. */
  | "warning";

export interface AuditRule {
  /** Stable id, `<table>.<short-name>`. */
  id: string;
  /** Tenant table the offending rows live in. */
  table: string;
  severity: Severity;
  /** What must hold, in business terms. */
  description: string;
  /** Screens / tRPC procedures that write the rows this rule checks — where to look first. */
  writers: string[];
  /** The query returning (business_id, row_id, detail) for every violating row. */
  sql: string;
}

/** Coverage entry for one tenant table. */
export type TableCoverage =
  | { table: string; rules: AuditRule[]; noExtraRequirements?: undefined }
  | { table: string; rules: []; noExtraRequirements: string };

export interface RuleSample {
  businessId: string;
  rowId: string;
  detail: string;
}

export interface RuleResult {
  rule: AuditRule;
  count: number;
  samples: RuleSample[];
}

export interface AuditReport {
  startedAt: Date;
  finishedAt: Date;
  businessIds: string[] | null;
  rulesRun: number;
  /** Only rules with at least one violating row. */
  results: RuleResult[];
  /** Rules whose query failed (e.g. a table missing in an older database). */
  failures: Array<{ rule: AuditRule; error: string }>;
}
