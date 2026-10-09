/**
 * sweep-procs.ts — enumerates every procedure of the appRouter at runtime and
 * works out which kind of record each id-like input field refers to.
 *
 * Enumeration reads `appRouter._def.procedures`, so a procedure added to any
 * router is picked up by the sweeps without touching them.
 */

import type { ZodTypeAny } from "zod";
import { genProcedureInput } from "./sweep-input.js";
import { appRouter } from "../../router.js";
import {
  authorizedProcedure,
  businessProcedure,
  tenantProcedure,
  protectedProcedure,
  publicProcedure,
} from "../../trpc.js";

export type Base = "authorized" | "business" | "tenant" | "protected" | "public";

export interface ProcInfo {
  path: string;
  router: string;
  name: string;
  type: "query" | "mutation" | "subscription";
  base: Base;
  inputs: ZodTypeAny[];
}

interface ProcDef {
  _def: { type: ProcInfo["type"]; middlewares: unknown[]; inputs: ZodTypeAny[] };
}

const BASES: Array<[Base, { _def: { middlewares: unknown[] } }]> = [
  ["authorized", authorizedProcedure as never],
  ["business", businessProcedure as never],
  ["tenant", tenantProcedure as never],
  ["protected", protectedProcedure as never],
  ["public", publicProcedure as never],
];

/** Which base procedure (middleware chain) a procedure was built from. */
function baseOf(p: ProcDef): Base {
  for (const [name, b] of BASES) {
    const bm = b._def.middlewares;
    if (bm.every((m, i) => p._def.middlewares[i] === m)) return name;
  }
  throw new Error("Procedure built from an unknown base procedure");
}

export function listProcedures(): ProcInfo[] {
  const procs = (appRouter as unknown as { _def: { procedures: Record<string, ProcDef> } })._def.procedures;
  return Object.entries(procs).map(([path, p]) => {
    const [router, ...rest] = path.split(".");
    return {
      path,
      router: router!,
      name: rest.join("."),
      type: p._def.type,
      base: baseOf(p),
      inputs: p._def.inputs,
    };
  });
}

/** The kind of record a procedure acts on: its `id`, else its first id field. */
export function primaryKind(proc: ProcInfo): string | undefined {
  const seen: string[] = [];
  genProcedureInput(proc.inputs, {
    resolveId: (key, keyPath) => {
      const k = kindFor(proc, key, keyPath);
      if (k) seen.push(key === "id" || key === "ids" ? `!${k}` : k);
      return undefined;
    },
  });
  const byId = seen.find((k) => k.startsWith("!"));
  return byId ? byId.slice(1) : seen[0];
}

/** Every id field of the procedure's input (optional ones included) and its kind. */
export function idFields(proc: ProcInfo): Array<{ key: string; kind: string; primary: boolean }> {
  const out: Array<{ key: string; kind: string; primary: boolean }> = [];
  genProcedureInput(proc.inputs, {
    includeOptionalIds: true,
    resolveId: (key, keyPath) => {
      const kind = kindFor(proc, key, keyPath);
      if (kind) out.push({ key, kind, primary: (key === "id" || key === "ids") });
      return undefined;
    },
  });
  return out;
}

// ── Id field → record kind ────────────────────────────────────────────────────

const DOC_ROUTERS = new Set([
  "invoice", "quotation", "creditNote", "debitNote", "deliveryChallan", "proforma",
  "salesReturn", "purchaseReturn", "purchaseOrder", "salesOrder", "goodsReceiptNote",
]);

/** Kind of the record a bare `id` field refers to, per procedure. */
function idKind(router: string, name: string): string | undefined {
  const exact: Record<string, string> = {
    "item.updateVariant": "variant",
    "item.deleteVariant": "variant",
    "manufacturing.journal": "mfgJournal",
    "manufacturing.cancel": "mfgJournal",
    "journal.templateDelete": "journalTemplate",
    "bankRecon.importDetail": "bankImport",
    "bankRecon.lines": "bankImport",
    "apiKey.revoke": "apiKey",
    "gstr2b.ignoreRecord": "gstr2bRecord",
    "gstr2b.linkInvoice": "gstr2bRecord",
    "auth.revokeSession": "session",
    "tenant.revokeInvitation": "invitation",
    "tenant.acceptById": "invitation",
  };
  const key = `${router}.${name}`;
  if (exact[key]) return exact[key];
  if (DOC_ROUTERS.has(router)) return router;
  if (router === "manufacturing" && name.startsWith("bom")) return "bom";
  if (router === "bankRecon" && name.startsWith("template")) return "bankTemplate";
  if (router === "bankRecon" && name.startsWith("rule")) return "bankRule";
  if (router === "journal" && name.startsWith("template")) return "journalTemplate";
  if (router === "warehouse" && name.startsWith("premise")) return "premise";
  if (router === "warehouse" && name.startsWith("location")) return "location";
  if (router === "warehouse" && name.startsWith("warehouse")) return "warehouse";
  if (router === "stock" && name.startsWith("count")) return "physicalCount";
  if (router === "store" && /Order/.test(name)) return "storeOrder";
  if (router === "orders") return "salesOrder";
  if (router === "itc") return "itcEntry";
  if (router === "ewayBill") return "ewayBill";
  if (router === "platform") return undefined;
  if (router === "payrollEmployee") {
    if (name.startsWith("department")) return "payrollDepartment";
    if (name.startsWith("designation")) return "payrollDesignation";
    if (name.startsWith("shift")) return "payrollShift";
    return "employee";
  }
  if (router === "payrollSalary") return name.startsWith("component") ? "salaryComponent" : "salaryTemplate";
  if (router === "payrollAttendance") return name.startsWith("holiday") ? "payrollHoliday" : undefined;
  if (router === "payrollLeave") return name.startsWith("type") ? "leaveType" : "leaveApplication";
  if (router === "payrollRun") return "payrollRun";
  if (router === "payrollSelf") return name === "loanStatement" ? "employeeLoan" : "leaveApplication";
  if (router === "payrollPunch") return name.startsWith("location") ? "workLocation" : "deviceKey";
  // Payroll Phase 4
  if (router === "payrollBonus") return "bonusRun";
  if (router === "payrollFnf") return "fnfSettlement";
  if (router === "payrollLoan") return "employeeLoan";
  const byRouter: Record<string, string> = {
    account: "account", bankAccount: "bankAccount", batch: "batch", business: "business", expense: "expense",
    item: "item", journal: "journal", party: "party", payment: "payment", priceLevel: "priceLevel",
    recurringInvoice: "recurringInvoice", shipment: "shipment", stockGroup: "stockGroup", target: "target",
  };
  return byRouter[router];
}

const FIELD_KIND: Record<string, string> = {
  partyId: "party",
  itemId: "item",
  itemIds: "item",
  variantId: "variant",
  invoiceId: "invoice",
  invoiceIds: "invoice",
  excludeInvoiceIds: "invoice",
  documentId: "invoice",
  referenceDocumentId: "invoice",
  sourceDocumentId: "quotation",
  bankAccountId: "bankAccount",
  settlementAccountId: "bankAccount2",
  priceLevelId: "priceLevel",
  lineId: "bankLine",
  businessId: "business",
  businessIds: "business",
  userId: "user",
  importId: "bankImport",
  accountId: "account",
  stockGroupId: "stockGroup",
  premiseId: "premise",
  ewayBillId: "ewayBill",
  uploadId: "gstr2bUpload",
  targetId: "target",
  recordId: "gstr2bRecord",
  invitationId: "invitation",
  bomId: "bom",
  tenantId: "tenant",
  sessionId: "session",
  paymentId: "payment",
  paymentIds: "payment",
  expenseId: "expense",
  bankTransactionId: "bankTransaction",
  batchId: "batch",
  businessMemberId: "businessMember",
  shipmentId: "shipment",
  destinationWarehouseId: "warehouse2",
  // Payroll
  employeeId: "employee",
  employeeIds: "employee",
  managerId: "employee",
  departmentId: "payrollDepartment",
  designationId: "payrollDesignation",
  shiftId: "payrollShift",
  leaveTypeId: "leaveType",
  componentId: "salaryComponent",
  runId: "payrollRun",
  adjustmentId: "payrollAdjustment",
  punchId: "employeePunch",
};

/**
 * The record kind an id-like field of `proc` refers to, or undefined when the
 * field is not a reference the sweeps can fill (e.g. a partner id).
 */
export function kindFor(proc: Pick<ProcInfo, "router" | "name">, key: string, path: string[] = []): string | undefined {
  const { router, name } = proc;
  // A bare id names the procedure's own record only at the top level; an
  // `id` inside a nested object (e.g. a shipping-method list) is not a record.
  if (key === "id" || key === "ids") return path.length === 0 || path[0] === key ? idKind(router, name) : undefined;
  // Payroll Phase 3: an import batch (not an item batch).
  if (router === "payrollImport" && key === "batchId") return "importBatch";
  // Payroll Phase 4: a bonus run (not a payroll run).
  if (router === "payrollBonus" && key === "runId") return "bonusRun";
  if (key === "parentId") return router === "account" ? "account" : "stockGroup";
  if (key === "templateId") return router === "journal" ? "journalTemplate" : router === "payrollSalary" ? "salaryTemplate" : "bankTemplate";
  if (key === "orderId") return router === "store" ? "storeOrder" : "salesOrder";
  if (key === "sourceId" || key === "targetId") {
    if (router === "party" || router === "item") return router;
    return key === "targetId" ? "target" : undefined;
  }
  if (router === "bankAccount" && /GatewayConfig/.test(name)) {
    if (key === "bankAccountId") return "gatewayAccount";
    if (key === "settlementAccountId") return "bankAccount";
  }
  if (key === "fromAccountId") return "bankAccount";
  if (key === "toAccountId") return "bankAccount2";
  if (key.endsWith("WarehouseId") && key !== "destinationWarehouseId") return "warehouse";
  if (key === "warehouseId") return "warehouse";
  return FIELD_KIND[key];
}
