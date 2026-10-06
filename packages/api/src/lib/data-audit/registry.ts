/**
 * The complete rule set: one coverage entry per tenant table, in schema order
 * of concern. `registry.test.ts` fails when a table is added to
 * packages/db/src/tenant-schema.ts without an entry here — every table either
 * has rules or says explicitly why it has no requirements beyond its
 * NOT NULL / FK / unique constraints.
 */

import type { AuditRule, TableCoverage } from "./types.js";
import { masterTables } from "./rules/masters.js";
import { documentTables } from "./rules/documents.js";
import { moneyTables } from "./rules/money.js";
import { inventoryTables } from "./rules/inventory.js";
import { miscTables } from "./rules/misc.js";
import { payrollTables } from "./rules/payroll.js";

export const TABLE_COVERAGE: TableCoverage[] = [
  ...masterTables,
  ...documentTables,
  ...moneyTables,
  ...inventoryTables,
  ...miscTables,
  ...payrollTables,
];

export const ALL_RULES: AuditRule[] = TABLE_COVERAGE.flatMap((t) => t.rules);
