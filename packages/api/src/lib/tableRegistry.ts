import type { PgTable } from "drizzle-orm/pg-core";
import {
  businesses,
  chartOfAccounts,
  parties,
  bankAccounts,
  bankStatementTemplates,
  paymentGatewayConfigs,
  eInvoiceConfigs,
  items,
  itemVariants,
  itemBatches,
  taxChallans,
  periodLocks,
  financialYearCloses,
  taxDeductions,
  tds26asEntries,
  tdsSectionSettings,
  compositionSettings,
  stockGroups,
  salesTargets,
  invoices,
  invoiceItems,
  payments,
  paymentAllocations,
  bankTransactions,
  expenses,
  stockAdjustments,
  journalEntryTemplates,
  journalEntries,
  journalEntryLines,
  itcLedgerEntries,
  itcUtilizations,
  recurringInvoiceTemplates,
  recurringInvoiceRuns,
  bankStatementImports,
  bankStatementLines,
  bankCategorizationRules,
  shipments,
  shipmentEvents,
  storeOrders,
  storeOrderRefunds,
  ewayBills,
  ewayBillVehicleUpdates,
  auditLog,
  gstr2bUploads,
  gstr2bRecords,
  payrollSettings,
  payrollDepartments,
  payrollDesignations,
  payrollShifts,
  employees,
  salaryComponents,
  salaryTemplates,
  salaryTemplateLines,
  employeeSalaryAssignments,
  attendanceRecords,
  payrollHolidays,
  leaveTypes,
  leaveLedger,
  leaveApplications,
  leaveEncashments,
  payrollRuns,
  payrollRunLines,
  payrollRunAdjustments,
  payslips,
  payrollStatutorySettings,
  employeeTaxDeclarations,
  payrollStatutoryPayments,
} from "@fintranzact/db";

/**
 * Describes how a table is scoped to a set of business IDs during export.
 *
 * - `{ type: "direct" }` — the table has a `business_id` column; rows are
 *   selected with `WHERE business_id IN (<ids>)`.
 *
 * - `{ type: "businesses" }` — the table IS the businesses table; no WHERE
 *   filter is applied (all rows are exported for the tenant).
 *
 * - `{ type: "child", parentTable: string, parentFk: string }` — the table
 *   has no direct `business_id` column. Rows are scoped via a subquery:
 *   `WHERE <parentFk> IN (SELECT id FROM <parentTable> WHERE business_id IN (<ids>))`.
 */
export type ScopeDescriptor =
  | { type: "businesses" }
  | { type: "direct" }
  | { type: "child"; parentTable: string; parentFk: string };

export interface TableRegistryEntry {
  /** Postgres table name (snake_case) — also the NDJSON file basename. */
  tableName: string;
  /** Drizzle table object for schema introspection and query building. */
  drizzleTable: PgTable;
  /** camelCase column names whose values must be set to null on export. */
  redactedFields: string[];
  /** Whether the importer should insert rows from this table. */
  importable: boolean;
  /**
   * camelCase columns that reference the same table (self-FK).
   * These require a two-pass insert: first with the FK column nulled,
   * then a second UPDATE pass to fill in the references.
   */
  selfFkFields: string[];
  /**
   * Row count per savepoint chunk during import.
   * 0 = insert everything in one transaction (small tables with at most
   * a handful of rows per business).
   */
  chunkSize: number;
  /**
   * camelCase column names whose stored value is derived / denormalised.
   * The importer should recompute these from first principles and emit a
   * warning when the recomputed value differs from the exported value by
   * more than 0.01.
   */
  recomputeOnImport: string[];
  /**
   * How this table is scoped to business IDs during export.
   * Tables with a direct `business_id` column use `{ type: "direct" }`.
   * Child tables without a direct FK use `{ type: "child", ... }`.
   * The businesses table itself uses `{ type: "businesses" }`.
   */
  scope: ScopeDescriptor;
}

/**
 * Ordered list of all tenant tables, in topological (FK-safe) insert order.
 * This is the single source of truth for the self-export / self-import
 * pipeline — export walks it top-to-bottom, import walks it top-to-bottom.
 */
export const TABLE_REGISTRY: TableRegistryEntry[] = [
  // 1. Businesses — root of every FK tree in the tenant schema.
  {
    tableName: "businesses",
    drizzleTable: businesses,
    // carrierCredentials is AES-256-GCM encrypted JSONB (carrier API keys).
    redactedFields: ["carrierCredentials"],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "businesses" },
  },

  // 2. Chart of Accounts — self-FK on parentId, so importer needs two passes.
  {
    tableName: "chart_of_accounts",
    drizzleTable: chartOfAccounts,
    redactedFields: [],
    importable: true,
    selfFkFields: ["parentId"],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 3. Parties — no self-FK, depends only on businesses.
  {
    tableName: "parties",
    drizzleTable: parties,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 4. Bank Accounts — depends on businesses.
  //    currentBalance is recomputed from transactions on import.
  {
    tableName: "bank_accounts",
    drizzleTable: bankAccounts,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: ["currentBalance"],
    scope: { type: "direct" },
  },

  // 5. Bank Statement Templates — depends on businesses.
  {
    tableName: "bank_statement_templates",
    drizzleTable: bankStatementTemplates,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 6. Payment Gateway Configs — depends on businesses + bankAccounts.
  //    chargeConfig holds charge rate percentages/amounts (not API keys),
  //    so it is NOT redacted. No encrypted fields exist on this table.
  {
    tableName: "payment_gateway_configs",
    drizzleTable: paymentGatewayConfigs,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 7. E-Invoice Configs — clientSecret, password, and authToken are
  //    plaintext credential columns stored with field-level encryption
  //    via crypto.ts (AES-256-GCM). Redact all three on export.
  //    importable=false: clientSecret and password are NOT NULL in the DB,
  //    so inserting the redacted (null) values would violate the constraint.
  //    Users must re-enter their GSP credentials after migrating.
  {
    tableName: "e_invoice_configs",
    drizzleTable: eInvoiceConfigs,
    redactedFields: ["clientSecret", "password", "authToken"],
    importable: false,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 7b. Stock Groups — depends on businesses; self-FK on parentId (nesting).
  //     Must precede items, which reference it.
  {
    tableName: "stock_groups",
    drizzleTable: stockGroups,
    redactedFields: [],
    importable: true,
    selfFkFields: ["parentId"],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 8. Items — stockQuantity is recomputed from stock adjustments + invoice
  //    items on import; the exported value is a convenience snapshot.
  {
    tableName: "items",
    drizzleTable: items,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: ["stockQuantity"],
    scope: { type: "direct" },
  },

  // 9. Item Variants — depends on items (no direct business_id).
  {
    tableName: "item_variants",
    drizzleTable: itemVariants,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: ["stockQuantity"],
    scope: { type: "child", parentTable: "items", parentFk: "item_id" },
  },

  // 9b. Item Batches — batch / lot master; depends on items and item_variants.
  //     Invoice lines point at it, so it comes before invoices.
  {
    tableName: "item_batches",
    drizzleTable: itemBatches,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 10. Sales Targets — depends on businesses + items (nullable FK).
  {
    tableName: "sales_targets",
    drizzleTable: salesTargets,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 11. Invoices — self-FK on referenceDocumentId (credit notes, returns etc.).
  //    amountPaid is a denormalised aggregate recomputed from paymentAllocations.
  {
    tableName: "invoices",
    drizzleTable: invoices,
    redactedFields: [],
    importable: true,
    selfFkFields: ["referenceDocumentId"],
    chunkSize: 5000,
    recomputeOnImport: ["amountPaid"],
    scope: { type: "direct" },
  },

  // 12. Invoice Items — depends on invoices (no direct business_id).
  {
    tableName: "invoice_items",
    drizzleTable: invoiceItems,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "child", parentTable: "invoices", parentFk: "invoice_id" },
  },

  // 13. Payments — depends on businesses, invoices (nullable), parties.
  {
    tableName: "payments",
    drizzleTable: payments,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 14. Payment Allocations — depends on payments (no direct business_id).
  {
    tableName: "payment_allocations",
    drizzleTable: paymentAllocations,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "child", parentTable: "payments", parentFk: "payment_id" },
  },

  // 14b. TDS / TCS — rates per year a business edited, the challans it deposited
  //      tax with (the deductions themselves follow expenses, see 16b).
  {
    tableName: "tds_section_settings",
    drizzleTable: tdsSectionSettings,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },
  {
    tableName: "composition_settings",
    drizzleTable: compositionSettings,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },
  {
    tableName: "tax_challans",
    drizzleTable: taxChallans,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 14c. Period locks and closed financial years — standalone per-business rows.
  {
    tableName: "period_locks",
    drizzleTable: periodLocks,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },
  {
    tableName: "financial_year_closes",
    drizzleTable: financialYearCloses,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 15. Bank Transactions — depends on businesses + bankAccounts.
  {
    tableName: "bank_transactions",
    drizzleTable: bankTransactions,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 16. Expenses — depends on businesses + bankAccounts (nullable).
  {
    tableName: "expenses",
    drizzleTable: expenses,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 16b. TDS / TCS deductions — point at their payment, bill, expense, party and
  //      challan, so they come after all of those.
  {
    tableName: "tax_deductions",
    drizzleTable: taxDeductions,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 16c. Form 26AS / AIS TDS rows — point at a party (nullable), so after parties.
  {
    tableName: "tds_26as_entries",
    drizzleTable: tds26asEntries,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 17. Stock Adjustments — depends on businesses, items, itemVariants (nullable).
  {
    tableName: "stock_adjustments",
    drizzleTable: stockAdjustments,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 18. Journal Entry Templates — depends on businesses.
  {
    tableName: "journal_entry_templates",
    drizzleTable: journalEntryTemplates,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 19. Journal Entries — self-FKs: voidedByEntryId and reversesEntryId both
  //    point within the same table. Two-pass insert required.
  {
    tableName: "journal_entries",
    drizzleTable: journalEntries,
    redactedFields: [],
    importable: true,
    selfFkFields: ["voidedByEntryId", "reversesEntryId"],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 20. Journal Entry Lines — depends on journalEntries (no direct business_id).
  {
    tableName: "journal_entry_lines",
    drizzleTable: journalEntryLines,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "child", parentTable: "journal_entries", parentFk: "journal_entry_id" },
  },

  // 21. ITC Ledger Entries — depends on businesses + invoices (nullable).
  {
    tableName: "itc_ledger_entries",
    drizzleTable: itcLedgerEntries,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 22. ITC Utilizations — depends on businesses.
  {
    tableName: "itc_utilizations",
    drizzleTable: itcUtilizations,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 23. Recurring Invoice Templates — depends on businesses + parties.
  {
    tableName: "recurring_invoice_templates",
    drizzleTable: recurringInvoiceTemplates,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 24. Recurring Invoice Runs — depends on recurringInvoiceTemplates,
  //    businesses, invoices (nullable).
  {
    tableName: "recurring_invoice_runs",
    drizzleTable: recurringInvoiceRuns,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 25. Bank Statement Imports — depends on businesses, bankAccounts,
  //    bankStatementTemplates (nullable).
  {
    tableName: "bank_statement_imports",
    drizzleTable: bankStatementImports,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 26. Bank Statement Lines — depends on bankStatementImports + businesses.
  {
    tableName: "bank_statement_lines",
    drizzleTable: bankStatementLines,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 27. Bank Categorization Rules — depends on businesses + bankAccounts (nullable).
  {
    tableName: "bank_categorization_rules",
    drizzleTable: bankCategorizationRules,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 28. Shipments — depends on businesses, invoices (nullable), parties (nullable).
  {
    tableName: "shipments",
    drizzleTable: shipments,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 29. Shipment Events — depends on shipments (no direct business_id).
  {
    tableName: "shipment_events",
    drizzleTable: shipmentEvents,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "child", parentTable: "shipments", parentFk: "shipment_id" },
  },

  // 30. Store Orders — depends on businesses + invoices (nullable).
  {
    tableName: "store_orders",
    drizzleTable: storeOrders,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 30b. Refunds of paid store orders — depends on store orders and invoices (the credit note that books it).
  {
    tableName: "store_order_refunds",
    drizzleTable: storeOrderRefunds,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 31. E-Way Bills — depends on businesses + invoices (nullable).
  {
    tableName: "eway_bills",
    drizzleTable: ewayBills,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 32. E-Way Bill Vehicle Updates — depends on ewayBills (no direct business_id).
  {
    tableName: "eway_bill_vehicle_updates",
    drizzleTable: ewayBillVehicleUpdates,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "child", parentTable: "eway_bills", parentFk: "eway_bill_id" },
  },

  // 33. Audit Log — export-only; importer skips this table.
  {
    tableName: "audit_log",
    drizzleTable: auditLog,
    redactedFields: [],
    importable: false,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 34. GSTR-2B Uploads — depends on businesses.
  {
    tableName: "gstr2b_uploads",
    drizzleTable: gstr2bUploads,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 0,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 35. GSTR-2B Records — depends on gstr2bUploads + businesses.
  {
    tableName: "gstr2b_records",
    drizzleTable: gstr2bRecords,
    redactedFields: [],
    importable: true,
    selfFkFields: [],
    chunkSize: 5000,
    recomputeOnImport: [],
    scope: { type: "direct" },
  },

  // 36+. Payroll (add-on), in foreign-key order. Identity and bank numbers are
  // exported in full (only the owner can export a business) and are optional
  // columns in the row schemas, so a file without them still imports.
  { tableName: "payroll_settings", drizzleTable: payrollSettings, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_statutory_settings", drizzleTable: payrollStatutorySettings, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_departments", drizzleTable: payrollDepartments, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_designations", drizzleTable: payrollDesignations, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_shifts", drizzleTable: payrollShifts, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  // An employee's manager is another employee: two-pass insert.
  { tableName: "employees", drizzleTable: employees, redactedFields: [], importable: true, selfFkFields: ["managerId"], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "employee_tax_declarations", drizzleTable: employeeTaxDeclarations, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "salary_components", drizzleTable: salaryComponents, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "salary_templates", drizzleTable: salaryTemplates, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "salary_template_lines", drizzleTable: salaryTemplateLines, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "child", parentTable: "salary_templates", parentFk: "template_id" } },
  { tableName: "employee_salary_assignments", drizzleTable: employeeSalaryAssignments, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "leave_types", drizzleTable: leaveTypes, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 0, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "attendance_records", drizzleTable: attendanceRecords, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 5000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_holidays", drizzleTable: payrollHolidays, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "leave_ledger", drizzleTable: leaveLedger, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 5000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "leave_applications", drizzleTable: leaveApplications, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "leave_encashments", drizzleTable: leaveEncashments, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_runs", drizzleTable: payrollRuns, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_run_lines", drizzleTable: payrollRunLines, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_statutory_payments", drizzleTable: payrollStatutoryPayments, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payroll_run_adjustments", drizzleTable: payrollRunAdjustments, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
  { tableName: "payslips", drizzleTable: payslips, redactedFields: [], importable: true, selfFkFields: [], chunkSize: 1000, recomputeOnImport: [], scope: { type: "direct" } },
];
