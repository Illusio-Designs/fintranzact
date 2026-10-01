/**
 * Audit log and sales targets.
 *
 * Whether a mutation left an audit entry is checked on the entity's own table
 * (<table>.audit-trail rules): the violating row is the entity with no trail.
 * Every writer that changes business data logs through lib/audit.ts —
 * logAudit, or audited/withAudit around a mutation.
 */

import type { TableCoverage } from "../types.js";
import { rule } from "../sql-fragments.js";

export const miscTables: TableCoverage[] = [
  {
    table: "audit_log",
    rules: [
      rule("audit_log", "entry-shape", "error",
        "An entry's action is '<entity>.<verb>', an entity-level action names its entity id, and metadata (when present) is JSON.",
        ["logAudit (lib/audit.ts) — every router that calls it"],
        `SELECT a.business_id, a.id::text, a.action || ' on ' || a.entity_type || ' ' || COALESCE(a.entity_id::text, 'NULL')
         FROM audit_log a
         WHERE a.action !~ '^[a-zA-Z_]+\\.[a-zA-Z]+$'
            OR (a.action ~ '\\.(create|update|delete|updateStatus)$' AND a.entity_id IS NULL)
            OR (a.metadata IS NOT NULL AND NOT pg_input_is_valid(a.metadata, 'jsonb'))`),
    ],
  },
  {
    table: "sales_targets",
    rules: [
      rule("sales_targets", "valid", "error",
        "A target has a known type and period, a positive value, a period that ends after it starts, and (optionally) an item of its business.",
        ["target.create / update (Targets)"],
        `SELECT t.business_id, t.id::text, t.target_type || '/' || t.period_type || ' ' || t.target_value || ' from ' || t.period_start::date || ' to ' || t.period_end::date
         FROM sales_targets t LEFT JOIN items i ON i.id = t.item_id
         WHERE t.target_type NOT IN ('order_count', 'order_value', 'item_quantity')
            OR t.period_type NOT IN ('daily', 'weekly', 'monthly', 'quarterly', 'custom')
            OR t.target_value::numeric <= 0 OR t.period_end < t.period_start
            OR i.business_id <> t.business_id
            OR (t.target_type = 'item_quantity' AND t.item_id IS NULL)`),
    ],
  },
];
