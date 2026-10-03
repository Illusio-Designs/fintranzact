/**
 * FEATURE_GATES: the single source of truth for which plan feature flag
 * protects which part of the product.
 *
 * Every flag in PLAN_FLAG_KEYS has exactly one entry with a kind:
 *   - gated:              the API refuses the flag's WRITES (and a few feature
 *                         entry points) when the organisation's plan has the
 *                         flag off. Reads of existing data stay open.
 *   - enforced_elsewhere: enforced by its own code path (data export, online
 *                         store, PDF branding); listed so the registry is
 *                         complete.
 *   - operational:        nothing to gate in code; the support team acts on it
 *                         (priority support, onboarding help). The platform
 *                         admin views and contact submissions show a badge.
 *   - not_built:          the feature does not exist yet (approvals). The flag
 *                         is stored and shown on the plan but gates nothing.
 *
 * Nothing here knows a plan NAME. Which plan a feature needs is derived from
 * the stored plan settings (requiredPlanFor), so an admin editing a flag in the
 * Plans editor changes both who is allowed and what the message says.
 *
 * The api applies this in the entitlementGate middleware (trpc.ts, via
 * lib/feature-gate.ts); web and mobile read the same result (featureAccess) to
 * show plan badges, disabled buttons and the "Not on your plan" state.
 */

import { PLAN_FLAG_KEYS, PLAN_ORDER, type PlanFlagKey, type PlanId } from "./plans.js";

export type FeatureKind = "gated" | "enforced_elsewhere" | "operational" | "not_built";

/**
 * Extra checks for a procedure that is only sometimes a use of the feature
 * (the check itself lives in packages/api/src/lib/feature-gate.ts):
 *   second_warehouse  creating a warehouse when the business already has one
 *   second_premise    creating a premise when the business already has one
 *   batch_fields      the input writes batch / expiry fields
 *   item_batch_flags  the input switches track batches / track expiry on for an item that does not track them yet
 *   pos_sale          the input is a POS sale (source = "pos")
 */
export type FeatureCondition = "second_warehouse" | "second_premise" | "batch_fields" | "item_batch_flags" | "pos_sale";

export interface FeatureGateDef {
  flag: PlanFlagKey;
  /** The feature as people read it ("E-invoicing"). */
  name: string;
  /** Plural names read "are available" instead of "is available". */
  plural?: boolean;
  kind: FeatureKind;
  /** One line for the admin editor and the docs: what the flag does. */
  summary: string;
  /** Routers whose every mutation (queries stay open) is gated, less FEATURE_GATE_EXEMPT. */
  routers: readonly string[];
  /** Procedures gated whatever their kind: mutations, or a feature entry point that is a query. */
  procedures: readonly string[];
  /** Procedures gated only when the condition holds. */
  conditional: Readonly<Record<string, FeatureCondition>>;
  /** Other enforcement points (REST routes, jobs) for the docs and the snapshot. */
  elsewhere: readonly string[];
}

const NONE: readonly string[] = [];

export const FEATURE_GATES: Readonly<Record<PlanFlagKey, FeatureGateDef>> = {
  eInvoicing: {
    flag: "eInvoicing",
    name: "E-invoicing",
    kind: "gated",
    summary: "Generating and cancelling IRNs, retrying failed ones, and the e-invoice connection settings.",
    routers: ["eInvoice"],
    procedures: NONE,
    conditional: {},
    elsewhere: ["invoice.create: the background IRN submission after an invoice is saved is skipped when the plan lacks it"],
  },
  eWayBills: {
    flag: "eWayBills",
    name: "E-way bills",
    plural: true,
    kind: "gated",
    summary: "Generating, extending and cancelling e-way bills and updating the vehicle.",
    routers: ["ewayBill"],
    procedures: NONE,
    conditional: {},
    elsewhere: NONE,
  },
  gstReports: {
    flag: "gstReports",
    name: "GST reports",
    plural: true,
    kind: "gated",
    summary: "GST filing and reconciliation writes: returns (GSTR-1, GSTR-3B), GSTR-2B uploads and matching, and ITC decisions. The reports themselves stay readable.",
    routers: ["gstReturns", "gstr2b", "itc"],
    procedures: NONE,
    conditional: {},
    elsewhere: NONE,
  },
  recurringInvoices: {
    flag: "recurringInvoices",
    name: "Recurring invoices",
    plural: true,
    kind: "gated",
    summary: "Creating, editing, resuming and running recurring invoice templates. Pausing and deleting a template always work.",
    routers: ["recurringInvoice"],
    procedures: NONE,
    conditional: {},
    elsewhere: ["recurring-invoice-scheduler: a plan without the flag generates nothing; its due templates are moved on, like a read-only organisation"],
  },
  pos: {
    flag: "pos",
    name: "POS",
    kind: "gated",
    summary: "The point-of-sale register and POS sales.",
    routers: NONE,
    procedures: ["pos.catalog"],
    conditional: { "invoice.create": "pos_sale" },
    elsewhere: NONE,
  },
  multiWarehouse: {
    flag: "multiWarehouse",
    name: "Multiple warehouses",
    plural: true,
    kind: "gated",
    summary:
      "A second warehouse or premise, stock transfers between warehouses, warehouse locations and permissions, and per-document default warehouses. Basic inventory (items, adjustments, the stock ledger on the default warehouse) stays on every plan.",
    routers: NONE,
    procedures: [
      "stock.transfer",
      "warehouse.locationCreate",
      "warehouse.warehousePermissionCreate",
      "warehouse.accessSet",
      "warehouse.inventorySettingsUpdate",
    ],
    conditional: { "warehouse.warehouseCreate": "second_warehouse", "warehouse.premiseCreate": "second_premise" },
    elsewhere: NONE,
  },
  batchesExpiry: {
    flag: "batchesExpiry",
    name: "Batches and expiry",
    plural: true,
    kind: "gated",
    summary:
      "Batch records, switching track batches / track expiry on for an item, and writing batch or expiry fields on documents and stock. Existing batch data stays readable.",
    routers: ["batch"],
    procedures: NONE,
    conditional: {
      "item.create": "item_batch_flags",
      "item.update": "item_batch_flags",
      "item.adjustStock": "batch_fields",
      "invoice.create": "batch_fields",
      "invoice.update": "batch_fields",
      "document.convert": "batch_fields",
      "stock.adjust": "batch_fields",
    },
    elsewhere: NONE,
  },
  bankReconciliation: {
    flag: "bankReconciliation",
    name: "Bank reconciliation",
    kind: "gated",
    summary: "Importing statements, matching, rules and templates. Statements already imported stay readable.",
    routers: ["bankRecon"],
    procedures: NONE,
    conditional: {},
    elsewhere: NONE,
  },
  manufacturing: {
    flag: "manufacturing",
    name: "Manufacturing and bill of materials",
    kind: "gated",
    summary: "Creating and changing bills of materials and manufacturing runs. Existing BOMs and runs stay readable.",
    routers: ["manufacturing"],
    procedures: NONE,
    conditional: {},
    elsewhere: NONE,
  },
  approvals: {
    flag: "approvals",
    name: "Approvals",
    plural: true,
    kind: "not_built",
    summary: "Approval workflows are not built yet: the flag describes the plan and gates nothing.",
    routers: NONE,
    procedures: NONE,
    conditional: {},
    elsewhere: NONE,
  },
  prioritySupport: {
    flag: "prioritySupport",
    name: "Priority support",
    kind: "operational",
    summary: "Operational: support submissions and the platform admin organisation views show a Priority support badge so the team can prioritise.",
    routers: NONE,
    procedures: NONE,
    conditional: {},
    elsewhere: ["contact.submit and the platform admin organisation views show the badge"],
  },
  onboardingHelp: {
    flag: "onboardingHelp",
    name: "Onboarding help",
    kind: "operational",
    summary: "Operational: support submissions and the platform admin organisation views show an Onboarding help included badge.",
    routers: NONE,
    procedures: NONE,
    conditional: {},
    elsewhere: ["contact.submit and the platform admin organisation views show the badge"],
  },
  dataExport: {
    flag: "dataExport",
    name: "Data export",
    kind: "enforced_elsewhere",
    summary: "Full-data export (the signed-token export stream and selfExport.request). Allowed in read-only mode, refused when the plan lacks it.",
    routers: NONE,
    procedures: NONE,
    conditional: {},
    elsewhere: ["selfExport.request", "GET /api/export/:tenantId (re-checked when the token is used)"],
  },
  onlineStore: {
    flag: "onlineStore",
    name: "Online store",
    kind: "enforced_elsewhere",
    summary: "The public store and its settings, enforced in lib/plan-limits.ts and the store routes.",
    routers: NONE,
    procedures: NONE,
    conditional: {},
    elsewhere: ["store.* settings", "GET /store/:slug/*, POST /store/:slug/order (a plan without the store answers the neutral 404)"],
  },
  pdfBranding: {
    flag: "pdfBranding",
    name: "Powered by Fintranzact on PDFs",
    kind: "enforced_elsewhere",
    summary: "Whether the small Powered by Fintranzact line prints on PDFs (lib/plan-limits.ts pdfBrandingHidden). A display flag, not a gate.",
    routers: NONE,
    procedures: NONE,
    conditional: {},
    elsewhere: ["invoice, e-way bill and receipt PDFs"],
  },
};

/**
 * Mutations in or near a gated router that are deliberately NOT gated, each
 * with the reason. The completeness test requires every mutation of
 * FEATURE_GATE_CHECKED_ROUTERS to be gated or listed here.
 */
export const FEATURE_GATE_EXEMPT: Readonly<Record<string, string>> = {
  // Never refuse stopping or removing something the plan no longer includes.
  "recurringInvoice.pause": "Stopping a template is never refused: a customer who loses the feature must be able to stop it.",
  "recurringInvoice.delete": "Removing a template is never refused.",
  "warehouse.warehouseUpdate": "Edits an existing warehouse (renaming the default one); adds no capability.",
  "warehouse.warehouseDelete": "Removing a warehouse reduces use of the feature.",
  "warehouse.premiseUpdate": "Edits an existing premise; adds no capability.",
  "warehouse.premiseDelete": "Removing a premise reduces use of the feature.",
  "warehouse.locationUpdate": "Edits an existing location; adds no capability.",
  "warehouse.locationDelete": "Removing a location reduces use of the feature.",
  // Basic inventory stays on every plan.
  "stock.setup": "Creates the default warehouse: part of basic inventory.",
  "stock.adjust": "Stock adjustments on the default warehouse are basic inventory (batch fields are checked separately).",
  "stock.verify": "Barcode stock verification is basic inventory.",
  "stock.updateSettings": "Negative-stock policy and valuation method are basic inventory settings.",
  "stock.countFinish": "Physical stock counts are basic inventory.",
  "stock.countPost": "Posting a physical stock count is basic inventory.",
  // GST business setting that changes how invoices are calculated, not a report.
  "gst.updateCompositionSettings": "Composition-scheme settings change how invoices are calculated; not part of the GST reports feature.",
};

/**
 * Routers whose mutations must each be gated or listed in FEATURE_GATE_EXEMPT.
 * (item, invoice and document appear only through `conditional` entries.)
 */
export const FEATURE_GATE_CHECKED_ROUTERS: readonly string[] = [
  "eInvoice",
  "ewayBill",
  "gst",
  "gstReturns",
  "gstr2b",
  "itc",
  "recurringInvoice",
  "pos",
  "warehouse",
  "stock",
  "batch",
  "bankRecon",
  "manufacturing",
];

/** Flags whose use is refused by the API or by its own code path (the admin editor shows these as enforced). */
export const PLAN_FLAGS_ENFORCED: readonly PlanFlagKey[] = PLAN_FLAG_KEYS.filter(
  (k) => FEATURE_GATES[k].kind === "gated" || FEATURE_GATES[k].kind === "enforced_elsewhere",
);

/** Flags that need no code: the support team acts on them. */
export const PLAN_FLAGS_OPERATIONAL: readonly PlanFlagKey[] = PLAN_FLAG_KEYS.filter((k) => FEATURE_GATES[k].kind === "operational");

/** Flags for features that do not exist yet. */
export const PLAN_FLAGS_NOT_BUILT: readonly PlanFlagKey[] = PLAN_FLAG_KEYS.filter((k) => FEATURE_GATES[k].kind === "not_built");

/** The note the admin Plans editor shows under a flag's checkbox; undefined for an enforced flag. */
export function planFlagNote(flag: PlanFlagKey): string | undefined {
  const kind = FEATURE_GATES[flag].kind;
  if (kind === "operational") return "Operational: the support team sees a badge; nothing in the app is locked";
  if (kind === "not_built") return "Not built yet: shown on the plan only";
  return undefined;
}

/** The procedures a flag gates, for a stable listing. */
export interface FeatureGateMatch {
  flag: PlanFlagKey;
  condition?: FeatureCondition;
}

const PROCEDURE_GATES = new Map<string, FeatureGateMatch[]>();
const ROUTER_GATES = new Map<string, PlanFlagKey>();
for (const flag of PLAN_FLAG_KEYS) {
  const def = FEATURE_GATES[flag];
  for (const r of def.routers) ROUTER_GATES.set(r, flag);
  for (const p of def.procedures) PROCEDURE_GATES.set(p, [...(PROCEDURE_GATES.get(p) ?? []), { flag }]);
  for (const [p, condition] of Object.entries(def.conditional)) {
    PROCEDURE_GATES.set(p, [...(PROCEDURE_GATES.get(p) ?? []), { flag, condition }]);
  }
}

/**
 * The feature checks that apply to a procedure: explicit entries, conditional
 * entries, and (for a mutation) the router it lives in. FEATURE_GATE_EXEMPT
 * switches off the router-wide gate for a path; entries that name the path
 * explicitly (a condition on stock.adjust) still apply.
 */
export function featureGatesFor(path: string, type: "query" | "mutation" | "subscription"): FeatureGateMatch[] {
  const out = [...(PROCEDURE_GATES.get(path) ?? [])];
  if (type === "mutation" && !FEATURE_GATE_EXEMPT[path]) {
    const routerFlag = ROUTER_GATES.get(path.split(".")[0]!);
    if (routerFlag && !out.some((m) => m.flag === routerFlag && !m.condition)) out.push({ flag: routerFlag });
  }
  return out;
}

/** Every procedure path the registry names explicitly (for the completeness and typo tests). */
export function namedGateProcedures(): string[] {
  return [...PROCEDURE_GATES.keys()];
}

// ── Plan feature values and the helpers clients and the server share ───────

export type PlanFeatures = Record<PlanFlagKey, boolean>;

/** Every flag, all true (grandfathered organisations). */
export function allFeatures(): PlanFeatures {
  return Object.fromEntries(PLAN_FLAG_KEYS.map((k) => [k, true])) as PlanFeatures;
}

/** The boolean flags of a limits object. */
export function featuresOf(limits: Partial<Record<PlanFlagKey, boolean>>): PlanFeatures {
  return Object.fromEntries(PLAN_FLAG_KEYS.map((k) => [k, limits[k] === true])) as PlanFeatures;
}

/**
 * The cheapest plan (in display order) whose STORED flag is on, so an admin
 * editing a plan changes the answer. Null when no plan has it.
 */
export function requiredPlanFor(
  flag: PlanFlagKey,
  plans: ReadonlyArray<{ id: PlanId; name: string; limits: Partial<Record<PlanFlagKey, boolean>> }>,
): { id: PlanId; name: string } | null {
  for (const id of PLAN_ORDER) {
    const plan = plans.find((p) => p.id === id);
    if (plan && plan.limits[flag] === true) return { id, name: plan.name };
  }
  return null;
}

/** "E-invoicing is available on the Growth plan and above." */
export function featureNotInPlanMessage(flag: PlanFlagKey, requiredPlanName: string | null, topPlanName?: string | null): string {
  const def = FEATURE_GATES[flag];
  const verb = def.plural ? "are" : "is";
  if (!requiredPlanName) return `${def.name} ${verb} not available on your plan.`;
  if (topPlanName && requiredPlanName === topPlanName) return `${def.name} ${verb} available on the ${requiredPlanName} plan.`;
  return `${def.name} ${verb} available on the ${requiredPlanName} plan and above.`;
}

/** What a client has from billing.status to judge a feature. */
export interface FeatureStatusLike {
  features?: Partial<PlanFeatures> | null;
  /** Plan name that unlocks each flag (from the stored plan settings), null when none does. */
  featureRequiredPlans?: Partial<Record<PlanFlagKey, string | null>> | null;
  /** Name of the highest plan, so a message can say "the Business plan" instead of "and above". */
  topPlanName?: string | null;
}

export interface FeatureAccess {
  allowed: boolean;
  feature: PlanFlagKey;
  featureName: string;
  /** Lowest plan with the feature, null when no plan has it. */
  requiredPlan: string | null;
  /** Short badge text for a nav item ("Growth"), null when allowed or no plan has it. */
  badge: string | null;
  /** The sentence to show when it is not allowed; empty when allowed. */
  message: string;
}

/**
 * Whether the organisation's plan includes a feature, for the UI. While the
 * status is still loading (or an older server sends no features) the answer is
 * "allowed", so nothing flashes locked; the server is the enforcement. Operational and
 * not-built flags are always allowed: they lock nothing.
 */
export function featureAccess(status: FeatureStatusLike | null | undefined, flag: PlanFlagKey): FeatureAccess {
  const def = FEATURE_GATES[flag];
  const requiredPlan = status?.featureRequiredPlans?.[flag] ?? null;
  const known = status?.features ? typeof status.features[flag] === "boolean" : false;
  const locked = def.kind === "gated" && known && status!.features![flag] === false;
  return {
    allowed: !locked,
    feature: flag,
    featureName: def.name,
    requiredPlan,
    badge: locked ? requiredPlan : null,
    message: locked ? featureNotInPlanMessage(flag, requiredPlan, status?.topPlanName ?? null) : "",
  };
}
