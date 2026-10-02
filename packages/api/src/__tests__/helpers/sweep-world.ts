/**
 * sweep-world.ts — fixtures shared by the role sweep and the isolation sweep.
 *
 * Layout:
 *   Org A (tenant A)
 *     owner, admin, seller_manager, seller, viewer (legacy → accountant),
 *     accountant (native role)
 *     Business A1 — every org-A user is a member (owner/admin as business admins)
 *     Business A2 — only the owner (business admin); nobody else is assigned
 *   Org B (tenant B)
 *     ownerB
 *     Business B1
 *
 * Every business can be given one record of each kind the API works with
 * (party, item, invoice, each document type, payment, expense, account,
 * journal, warehouse, …) by `seedBusiness`, created through the API as the
 * business owner wherever the API allows it and inserted directly where the
 * record only comes from an outside system (GSTR-2B files, bank statements,
 * store orders, e-way bills). Records seeded with a `tag` carry it in their
 * name/description so the isolation sweep can spot them in any response.
 */

import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { businessMembers } from "@fintranzact/db";
import { createUser, createTenant, addMember, createSession, type TestUser, type TestTenant } from "./fixtures.js";
import { createTestCaller } from "./create-test-caller.js";
import { getTenantTestDb, getTestClient } from "./test-db.js";
import { listProcedures, kindFor, primaryKind, type ProcInfo } from "./sweep-procs.js";
import { genProcedureInput } from "./sweep-input.js";

export const CANARY = "ZZCANARYB";

export const SWEEP_ROLES = ["owner", "admin", "seller_manager", "seller", "accountant"] as const;
export type SweepRole = (typeof SWEEP_ROLES)[number];

export type Caller = ReturnType<typeof createTestCaller>;

export function callerAs(user: TestUser, tenantId: string, businessId: string | null): Caller {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId, businessId: businessId ?? "" });
}

/** Calls `caller.<path>(input)` for a dotted procedure path. */
export function callPath(caller: Caller, path: string, input: unknown): Promise<unknown> {
  const fn = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], caller) as (i: unknown) => Promise<unknown>;
  return fn(input);
}

const BUSINESS_INPUT = (name: string) => ({
  name,
  phone: "9876543210",
  address: "12 MG Road",
  city: "Mumbai",
  state: "Maharashtra",
  stateCode: "27",
  pincode: "400001",
  pan: "AABCU9603R",
  gstRegistrationType: "regular" as const,
  gstin: "27AABCU9603R1ZM",
});

export async function createSweepBusiness(owner: TestUser, tenantId: string, name: string): Promise<string> {
  // business.create is tenant-level: no x-business-id header needed.
  const biz = await callerAs(owner, tenantId, null).business.create(BUSINESS_INPUT(name) as never);
  return (biz as { id: string }).id;
}

export interface SweepBusiness {
  id: string;
  tenantId: string;
  owner: TestUser;
  /** kind → id of a record of that kind in this business */
  ids: Record<string, string>;
  tag: string;
}

export interface SweepWorld {
  tenantA: TestTenant;
  tenantB: TestTenant;
  usersA: Record<SweepRole | "viewer", TestUser>;
  ownerB: TestUser;
  a1: SweepBusiness;
  a2: SweepBusiness;
  b1: SweepBusiness;
}

export async function buildSweepWorld(): Promise<SweepWorld> {
  const stamp = randomUUID().slice(0, 8);
  const tenantA = await createTenant({ name: "Org A Traders", slug: `org-a-${stamp}` });
  const tenantB = await createTenant({ name: `Org B ${CANARY}`, slug: `org-b-${stamp}` });

  const mk = async (role: string, email: string) => {
    const u = await createUser({ email, name: `Sweep ${role}` });
    await addMember(tenantA.id, u.id, role as never);
    return u;
  };
  const usersA = {
    owner: await mk("owner", `owner.a.${stamp}@sweep.in`),
    admin: await mk("admin", `admin.a.${stamp}@sweep.in`),
    seller_manager: await mk("seller_manager", `manager.a.${stamp}@sweep.in`),
    seller: await mk("seller", `seller.a.${stamp}@sweep.in`),
    viewer: await mk("viewer", `viewer.a.${stamp}@sweep.in`),
    accountant: await mk("accountant", `accountant.a.${stamp}@sweep.in`),
  };
  const ownerB = await createUser({ email: `owner.b.${stamp}@sweep.in`, name: `Owner ${CANARY}` });
  await addMember(tenantB.id, ownerB.id, "owner");

  const a1Id = await createSweepBusiness(usersA.owner, tenantA.id, "Business A1");
  const a2Id = await createSweepBusiness(usersA.owner, tenantA.id, "Business A2");
  const b1Id = await createSweepBusiness(ownerB, tenantB.id, `Business ${CANARY}`);

  // A1: everyone. A2: only its creator. business.create also opens a new
  // business to the org's admins, so take A's admin off A2 to keep a member
  // of A1 who has no access to A2.
  const db = getTenantTestDb();
  for (const [role, u] of Object.entries(usersA)) {
    if (role === "owner") continue;
    await db.insert(businessMembers).values({
      businessId: a1Id,
      userId: u.id,
      role: role === "admin" ? "admin" : "member",
    }).onConflictDoNothing();
  }
  await db.delete(businessMembers).where(and(
    eq(businessMembers.businessId, a2Id),
    ne(businessMembers.userId, usersA.owner.id),
  ));
  const a2Members = await db.select().from(businessMembers).where(eq(businessMembers.businessId, a2Id));
  if (a2Members.length !== 1) throw new Error("A2 must only have its creator as a member");

  return {
    tenantA,
    tenantB,
    usersA,
    ownerB,
    a1: { id: a1Id, tenantId: tenantA.id, owner: usersA.owner, ids: {}, tag: "A1" },
    a2: { id: a2Id, tenantId: tenantA.id, owner: usersA.owner, ids: {}, tag: "ZZCANARYA2" },
    b1: { id: b1Id, tenantId: tenantB.id, owner: ownerB, ids: {}, tag: CANARY },
  };
}

// ── Inputs ──────────────────────────────────────────────────────────────────

const PROCS = new Map<string, ProcInfo>(listProcedures().map((p) => [p.path, p]));

export function procInfo(path: string): ProcInfo {
  const p = PROCS.get(path);
  if (!p) throw new Error(`Unknown procedure ${path}`);
  return p;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

export function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete out[k];
      else out[k] = deepMerge(base[k], v);
    }
    return out;
  }
  return over;
}

/**
 * A generated minimal input for `path`, with id fields resolved from `ids`
 * (kind → id), then `override` deep-merged on top.
 */
export function genInput(
  path: string,
  ids: Record<string, string | undefined>,
  override?: unknown,
  opts: { includeOptionalIds?: boolean } = {},
): unknown {
  const p = procInfo(path);
  const input = genProcedureInput(p.inputs, {
    resolveId: (key, keyPath) => {
      const k = kindFor(p, key, keyPath);
      return k ? ids[k] : undefined;
    },
    includeOptionalIds: opts.includeOptionalIds,
  });
  return deepMerge(input, override);
}

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Hand-written input parts for procedures whose generated input can't get
 * past validation. Merged over the generated input; `ids` are the ids the
 * sweep is using for this call.
 */
export const INPUT_OVERRIDES: Record<string, (ids: Record<string, string>) => unknown> = {
  "business.uploadLogo": () => ({ data: { dataUrl: PNG_1PX } }),
  "business.uploadSignature": () => ({ data: { dataUrl: PNG_1PX } }),
  // Exactly one of paymentId / expenseId / bankTransactionId.
  "bankRecon.manualMatch": (ids) => ({ paymentId: ids.payment, expenseId: undefined, bankTransactionId: undefined }),
  // Generated periods are a single day; the end must come after the start.
  "target.create": () => ({ periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString() }),
  // A lock far in the past (and a long-closed year) so the sweep never locks the periods the rest of its data lives in.
  "period.lockBooks": () => ({ through: "2001-03-31" }),
  "period.closeYear": () => ({ financialYear: "2000-01", force: true }),
  // Plausible challan details; the entry ids come from the generated input.
  "tds.createChallan": () => ({
    financialYear: "2026-27",
    quarter: 3,
    challanNumber: "00041",
    bsrCode: "0510308",
    depositedOn: new Date().toISOString(),
    amount: "100.00",
    interest: "0",
  }),
  "auth.register": () => ({
    username: "sweeper",
    email: `sweep.${randomUUID().slice(0, 8)}@example.in`,
    password: "Sweep@Passw0rd!2026",
    confirmPassword: "Sweep@Passw0rd!2026",
  }),
};

// ── Seeding ───────────────────────────────────────────────────────────────────

/** Finds the first record id in a procedure result (row, array, or paged list). */
export function firstId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  if (typeof r.id === "string") return r.id;
  if (Array.isArray(result)) return firstId(result[0]);
  for (const v of Object.values(r)) {
    if (Array.isArray(v) && v.length > 0) {
      const id = firstId(v[0]);
      if (id) return id;
    }
  }
  return undefined;
}

const today = () => new Date().toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const uniq = () => randomUUID().slice(0, 8);

// Account codes must be unique per business. Codes made from the digits of
// a random id repeat often (few digits survive, the rest is padding), so
// count instead: 7 digits, clear of the 4-digit default chart.
let accountSeq = 0;
const accountCode = (prefix: "8" | "9") => `${prefix}${String(++accountSeq).padStart(6, "0")}`;

type Seeder = (b: SweepBusiness, c: Caller) => Promise<string | undefined>;

/** Seeder that calls `path` with a generated input plus `override`. */
const gen = (path: string, override: (b: SweepBusiness) => unknown = () => ({})): Seeder =>
  async (b, c) => firstId(await callPath(c, path, genInput(path, b.ids, override(b))));

const lineItem = (b: SweepBusiness) => ({
  itemId: b.ids.item,
  itemName: `Line ${b.tag}`,
  quantity: "1",
  unitPrice: "100.00",
  taxPercent: "5.00",
});

const doc = (router: string, type: "sale" | "purchase"): Seeder => async (b, c) =>
  firstId(await callPath(c, `${router}.create`, {
    partyId: type === "sale" ? b.ids.party : b.ids.supplier,
    type,
    invoiceDate: today(),
    lineItems: [lineItem(b)],
    notes: `Seeded ${b.tag}`,
  }));

async function sqlId(query: Promise<Array<{ id: string }>>): Promise<string> {
  const rows = await query;
  return rows[0]!.id;
}

/**
 * Ordered: later kinds may depend on earlier ones. Each seeder creates ONE
 * new record, so the role sweep also uses them to make throwaway records for
 * destructive calls.
 */
export const SEEDERS: Array<[string, Seeder]> = [
  ["business", async (b) => b.id],
  ["user", async (b) => b.owner.id],
  ["tenant", async (b) => b.tenantId],
  ["businessMember", async (b) => {
    const sql = getTestClient();
    return sqlId(sql`SELECT id FROM business_members WHERE business_id = ${b.id} AND user_id = ${b.owner.id}`);
  }],
  ["party", async (b, c) => firstId(await c.party.create({ type: "customer", name: `Customer ${b.tag} ${uniq()}`, phone: "9876543210" } as never))],
  ["supplier", async (b, c) => firstId(await c.party.create({ type: "supplier", name: `Supplier ${b.tag} ${uniq()}` } as never))],
  ["item", async (b, c) => firstId(await c.item.create({ name: `Item ${b.tag} ${uniq()}`, stockQuantity: "50", salePrice: "100", purchasePrice: "80" } as never))],
  ["item2", async (b, c) => firstId(await c.item.create({ name: `Finished ${b.tag} ${uniq()}`, stockQuantity: "0", salePrice: "300", purchasePrice: "200" } as never))],
  ["variantItem", async (b, c) => firstId(await c.item.create({
    name: `Tee ${b.tag} ${uniq()}`,
    itemMode: "variants",
    variantAttributes: ["size"],
    variants: [{ attributeValues: { size: "S" }, stockQuantity: "5" }],
  } as never))],
  ["variant", async (b, c) => firstId(await c.item.createVariant({
    itemId: b.ids.variantItem!,
    variant: { attributeValues: { size: `M${uniq()}` }, stockQuantity: "5" },
  } as never))],
  ["premise", async (_b, c) => firstId(await c.warehouse.premiseList())],
  ["warehouse", async (_b, c) => firstId(await c.warehouse.warehouseList())],
  ["warehouse2", gen("warehouse.warehouseCreate", (b) => ({ name: `Godown ${b.tag} ${uniq()}`, code: `G${uniq()}`, warehouseType: "godown" }))],
  ["location", gen("warehouse.locationCreate", (b) => ({ name: `Rack ${b.tag} ${uniq()}`, code: `R${uniq()}` }))],
  ["invoice", doc("invoice", "sale")],
  ["purchaseInvoice", doc("invoice", "purchase")],
  ["quotation", doc("quotation", "sale")],
  ["creditNote", doc("creditNote", "sale")],
  ["debitNote", doc("debitNote", "purchase")],
  ["deliveryChallan", doc("deliveryChallan", "sale")],
  ["proforma", doc("proforma", "sale")],
  ["salesReturn", doc("salesReturn", "sale")],
  ["purchaseReturn", doc("purchaseReturn", "purchase")],
  ["purchaseOrder", doc("purchaseOrder", "purchase")],
  ["salesOrder", doc("salesOrder", "sale")],
  ["goodsReceiptNote", doc("goodsReceiptNote", "purchase")],
  ["bankAccount", async (b, c) => firstId(await c.bankAccount.create({ accountName: `Bank ${b.tag} ${uniq()}`, accountType: "current" } as never))],
  ["bankAccount2", async (b, c) => firstId(await c.bankAccount.create({ accountName: `Bank2 ${b.tag} ${uniq()}`, accountType: "current" } as never))],
  ["bankTransaction", async (b, c) => firstId(await c.bankAccount.addTransaction({
    bankAccountId: b.ids.bankAccount!, type: "deposit", amount: "10.00", description: `Deposit ${b.tag}`,
  } as never))],
  ["payment", async (b, c) => firstId(await c.payment.create({
    partyId: b.ids.party!, amount: "10.00", mode: "cash", notes: `Payment ${b.tag}`,
  } as never))],
  ["expense", async (b, c) => firstId(await c.expense.create({
    category: `Rent ${b.tag}`, description: `Expense ${b.tag}`, amount: "10.00", mode: "cash",
  } as never))],
  ["account", async (b, c) => firstId(await c.account.create({ code: accountCode("9"), name: `Account ${b.tag} ${uniq()}`, accountType: "asset" } as never))],
  ["account2", async (b, c) => firstId(await c.account.create({ code: accountCode("8"), name: `Account2 ${b.tag} ${uniq()}`, accountType: "liability" } as never))],
  ["journal", async (b, c) => firstId(await c.journal.create({
    entryDate: today(),
    narration: `Journal ${b.tag}`,
    lines: [
      { accountId: b.ids.account!, debit: "10.00", credit: "0" },
      { accountId: b.ids.account2!, debit: "0", credit: "10.00" },
    ],
  } as never))],
  ["journalTemplate", async (b, c) => {
    const acct = async (id: string) => {
      const sql = getTestClient();
      const [row] = await sql<Array<{ code: string; name: string }>>`SELECT code, name FROM chart_of_accounts WHERE id = ${id}`;
      return { accountId: id, accountCode: row!.code, accountName: row!.name };
    };
    return firstId(await c.journal.templateCreate({
      name: `Template ${b.tag} ${uniq()}`,
      lines: [
        { ...(await acct(b.ids.account!)), debit: "10.00", credit: "0" },
        { ...(await acct(b.ids.account2!)), debit: "0", credit: "10.00" },
      ],
    } as never));
  }],
  ["stockGroup", async (b, c) => firstId(await c.stockGroup.create({ name: `Group ${b.tag} ${uniq()}` } as never))],
  ["priceLevel", async (b, c) => firstId(await c.priceLevel.create({ name: `Wholesale ${b.tag} ${uniq()}` } as never))],
  ["target", async (b, c) => firstId(await c.target.create({
    userId: b.owner.id, targetType: "order_count", targetValue: "10", periodType: "monthly",
    periodStart: today(), periodEnd: inDays(30),
  } as never))],
  ["recurringInvoice", async (b, c) => firstId(await c.recurringInvoice.create({
    partyId: b.ids.party!, name: `Monthly ${b.tag} ${uniq()}`, type: "sale", frequency: "monthly",
    lineItems: [{ itemId: b.ids.item, itemName: `Line ${b.tag}`, quantity: "1", unitPrice: "100.00" }],
    startDate: inDays(1),
  } as never))],
  ["shipment", async (b, c) => firstId(await c.shipment.create({ invoiceId: b.ids.invoice, notes: `Ship ${b.tag}` } as never))],
  ["bom", async (b, c) => firstId(await c.manufacturing.bomCreate({
    itemId: b.ids.item2!, name: `BOM ${b.tag} ${uniq()}`, outputQuantity: "1",
    components: [{ itemId: b.ids.item!, quantity: "1" }],
  } as never))],
  ["mfgJournal", async (b, c) => firstId(await c.manufacturing.manufacture({
    bomId: b.ids.bom!, quantity: "1", sourceWarehouseId: b.ids.warehouse!, destinationWarehouseId: b.ids.warehouse!,
  } as never))],
  ["bankTemplate", async (b, c) => firstId(await c.bankRecon.templateCreate({
    bankDisplayName: `Bank fmt ${b.tag} ${uniq()}`, columnMapping: { date: 0, narration: 1, debit: 2, credit: 3 },
  } as never))],
  ["bankRule", async (b, c) => firstId(await c.bankRecon.ruleCreate({
    matchField: "narration", matchType: "contains", matchValue: `RULE${b.tag}`, action: "create_expense",
  } as never))],
  ["gatewayAccount", async (b, c) => firstId(await c.bankAccount.create({ accountName: `Razorpay ${b.tag} ${uniq()}`, accountType: "payment_gateway" } as never))],
  ["gatewayConfig", async (b, c) => {
    await c.bankAccount.upsertGatewayConfig(genInput("bankAccount.upsertGatewayConfig", b.ids, {
      bankAccountId: b.ids.gatewayAccount!, settlementAccountId: b.ids.bankAccount!,
    }) as never);
    return b.ids.gatewayAccount;
  }],
  ["shareLink", async (b, c) => {
    await c.share.create({ documentId: b.ids.invoice! } as never);
    const sql = getTestClient();
    return sqlId(sql`SELECT id FROM share_links WHERE document_id = ${b.ids.invoice!} LIMIT 1`);
  }],
  ["batch", gen("batch.create", (b) => ({ itemId: b.ids.item, variantId: undefined, batchNumber: `B-${b.tag}-${uniq()}` }))],
  ["stockAdjustment", async (b, c) => firstId(await c.item.adjustStock({ itemId: b.ids.item!, quantity: "1", reason: `Adj ${b.tag}` } as never))],
  // Records that only come from outside systems: inserted directly.
  ["bankImport", async (b) => {
    const sql = getTestClient();
    return sqlId(sql`INSERT INTO bank_statement_imports (business_id, bank_account_id, file_name) VALUES (${b.id}, ${b.ids.bankAccount!}, ${`stmt-${b.tag}.csv`}) RETURNING id`);
  }],
  ["bankLine", async (b) => {
    const sql = getTestClient();
    return sqlId(sql`INSERT INTO bank_statement_lines (import_id, business_id, line_number, transaction_date, narration, debit, credit)
      VALUES (${b.ids.bankImport!}, ${b.id}, 1, now(), ${`NEFT ${b.tag}`}, '10.00', '0') RETURNING id`);
  }],
  ["storeOrder", async (b) => {
    const sql = getTestClient();
    return sqlId(sql`INSERT INTO store_orders (business_id, order_number, customer_name, customer_phone, total_amount, item_count)
      VALUES (${b.id}, ${`ORD-${uniq()}`}, ${`Buyer ${b.tag}`}, '9876543210', '100.00', 1) RETURNING id`);
  }],
  ["ewayBill", async (b) => {
    const sql = getTestClient();
    return sqlId(sql`INSERT INTO eway_bills (business_id, invoice_id, ewb_number, status, transporter_name, valid_upto)
      VALUES (${b.id}, ${b.ids.invoice!}, ${`1${Date.now().toString().slice(-11)}`}, 'active', ${`Transport ${b.tag}`}, now() + interval '2 days') RETURNING id`);
  }],
  ["gstr2bUpload", async (b) => {
    const sql = getTestClient();
    const period = `${String(new Date().getMonth() + 1).padStart(2, "0")}${new Date().getFullYear()}`;
    return sqlId(sql`INSERT INTO gstr2b_uploads (business_id, return_period, file_name) VALUES (${b.id}, ${period}, ${`2b-${b.tag}.json`}) RETURNING id`);
  }],
  ["gstr2bRecord", async (b) => {
    const sql = getTestClient();
    return sqlId(sql`INSERT INTO gstr2b_records (upload_id, business_id, supplier_gstin, supplier_name, invoice_number, invoice_value, taxable_value)
      VALUES (${b.ids.gstr2bUpload!}, ${b.id}, '27AABCU9603R1ZM', ${`Supplier ${b.tag}`}, ${`SUP-${uniq()}`}, '105.00', '100.00') RETURNING id`);
  }],
  ["itcEntry", async (b) => {
    const sql = getTestClient();
    const period = `${String(new Date().getMonth() + 1).padStart(2, "0")}${new Date().getFullYear()}`;
    return sqlId(sql`INSERT INTO itc_ledger_entries (business_id, invoice_id, return_period, status, cgst, sgst, igst, cess, notes)
      VALUES (${b.id}, ${b.ids.purchaseInvoice!}, ${period}, 'available', '2.50', '2.50', '0', '0', ${`ITC ${b.tag}`}) RETURNING id`);
  }],
  ["physicalCount", async (b) => {
    const sql = getTestClient();
    return sqlId(sql`INSERT INTO physical_stock_counts (business_id, warehouse_id, started_at, ended_at, lines, unknown_codes, not_counted, note)
      VALUES (${b.id}, ${b.ids.warehouse!}, now(), now(), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ${`Count ${b.tag}`}) RETURNING id`);
  }],
  // Org-level records.
  ["apiKey", async (b, c) => firstId(await c.apiKey.create({ name: `Key ${b.tag} ${uniq()}` } as never))],
  ["invitation", async (b, c) => {
    const email = `invitee.${randomUUID()}@sweep.in`;
    await c.tenant.inviteMember({ email, role: "seller" } as never);
    const sql = getTestClient();
    return sqlId(sql`SELECT id FROM invitations WHERE tenant_id = ${b.tenantId} AND email = ${email}`);
  }],
  ["session", async (b) => (await createSession(b.owner.id, b.tenantId)).id],
  // A throwaway org member who belongs to this business: the target of
  // member-management calls, so the sweep never removes or re-roles a real user.
  ["memberUser", async (b) => {
    const u = await createUser({ email: `member.${randomUUID()}@sweep.in`, name: `Member ${b.tag}` });
    await addMember(b.tenantId, u.id, "seller");
    await getTenantTestDb().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: "member" });
    return u.id;
  }],
  ["memberBusinessMember", async (b) => {
    const u = await createUser({ email: `member.${randomUUID()}@sweep.in`, name: `Member ${b.tag}` });
    await addMember(b.tenantId, u.id, "seller");
    const [row] = await getTenantTestDb().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: "member" }).returning();
    return row!.id;
  }],
  ["premise2", gen("warehouse.premiseCreate", (b) => ({ name: `Site ${b.tag} ${uniq()}`, code: `P${uniq()}` }))],
];

/** Kinds that must not be seeded up front (only created on demand). */
const ON_DEMAND = new Set(["memberUser", "memberBusinessMember", "premise2"]);

/** Creates one fresh record of `kind` in business `b` (dependencies from b.ids). */
export async function seedOne(b: SweepBusiness, kind: string): Promise<string> {
  const entry = SEEDERS.find(([k]) => k === kind);
  if (!entry) throw new Error(`No seeder for kind "${kind}"`);
  const id = await entry[1](b, callerAs(b.owner, b.tenantId, b.id));
  if (!id) throw new Error(`Seeder for "${kind}" returned no id`);
  return id;
}

/** Mutations act on throwaway records of these kinds instead of shared ones. */
const FRESH_ALIAS: Record<string, string> = {
  user: "memberUser",
  businessMember: "memberBusinessMember",
  warehouse: "warehouse2",
  premise: "premise2",
};
/** Kinds that are never replaced by a throwaway record. */
const NEVER_FRESH = new Set(["business", "tenant"]);

/**
 * The ids of business `b` to call `proc` with. For a mutation, the record it
 * acts on (and any user / business member it targets) is a fresh throwaway
 * one, so a delete or a role change never breaks the fixtures other calls use.
 */
export async function idsForCall(b: SweepBusiness, proc: ProcInfo): Promise<Record<string, string>> {
  const ids: Record<string, string> = { ...b.ids };
  if (proc.type === "mutation") {
    const primary = primaryKind(proc);
    const fresh = new Set<string>(["user", "businessMember"]);
    if (primary && !NEVER_FRESH.has(primary)) fresh.add(primary);
    for (const kind of fresh) ids[kind] = await seedOne(b, FRESH_ALIAS[kind] ?? kind);
  }
  return ids;
}

/** Seeds one record of every kind into `b.ids`, in dependency order. */
export async function seedBusiness(b: SweepBusiness): Promise<void> {
  for (const [kind] of SEEDERS) {
    if (ON_DEMAND.has(kind)) continue;
    try {
      b.ids[kind] = await seedOne(b, kind);
    } catch (e) {
      throw new Error(`Seeding ${kind} in ${b.tag} failed: ${(e as Error).message}`);
    }
  }
}

// ── Fingerprints ──────────────────────────────────────────────────────────────

interface FingerprintPlan {
  /** Tables with a business_id column. */
  direct: string[];
  /** Tables without business_id: FK columns pointing at a direct table. */
  children: Array<{ table: string; fks: Array<{ column: string; parent: string }> }>;
}

let plan: FingerprintPlan | null = null;

/**
 * Discovers, from the live schema, every table that holds a business's data:
 * tables with a business_id column, plus tables that reference one of them.
 * New tables are covered without touching the sweep.
 */
async function fingerprintPlan(): Promise<FingerprintPlan> {
  if (plan) return plan;
  const sql = getTestClient();
  const direct = (await sql<Array<{ table_name: string }>>`
    SELECT DISTINCT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'business_id'
    ORDER BY 1`).map((r) => r.table_name);
  const fkRows = await sql<Array<{ table_name: string; column_name: string; parent: string }>>`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const directSet = new Set(direct);
  const children = new Map<string, Array<{ column: string; parent: string }>>();
  for (const r of fkRows) {
    if (directSet.has(r.table_name) || !directSet.has(r.parent)) continue;
    children.set(r.table_name, [...(children.get(r.table_name) ?? []), { column: r.column_name, parent: r.parent }]);
  }
  plan = { direct, children: [...children].map(([table, fks]) => ({ table, fks })) };
  return plan;
}

export interface FingerprintScope {
  businessIds: string[];
  /** Also fingerprint this organisation's control-plane rows. */
  tenantId?: string;
}

/** table → md5 of every row belonging to the scope. */
export async function fingerprint(scope: FingerprintScope): Promise<Record<string, string>> {
  const p = await fingerprintPlan();
  const sql = getTestClient();
  // Only uuids created by the sweep are interpolated below.
  const idList = scope.businessIds.map((id) => `'${id}'`).join(",");
  const agg = (from: string, where: string) =>
    `SELECT '${from}' AS t, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${from} x WHERE ${where}`;
  const parts: string[] = [agg("businesses", `x.id IN (${idList})`)];
  for (const t of p.direct) parts.push(agg(t, `x.business_id IN (${idList})`));
  for (const c of p.children) {
    parts.push(agg(c.table, c.fks.map((f) => `x.${f.column} IN (SELECT id FROM ${f.parent} WHERE business_id IN (${idList}))`).join(" OR ")));
  }
  if (scope.tenantId) {
    const t = `'${scope.tenantId}'`;
    const members = `(SELECT user_id FROM tenant_members WHERE tenant_id = ${t})`;
    parts.push(agg("tenants", `x.id = ${t}`));
    parts.push(agg("tenant_members", `x.tenant_id = ${t}`));
    parts.push(agg("invitations", `x.tenant_id = ${t}`));
    parts.push(agg("api_keys", `x.tenant_id = ${t}`));
    parts.push(agg("users", `x.id IN ${members}`));
    parts.push(agg("sessions", `x.user_id IN ${members}`));
  }
  const rows = await sql.unsafe<Array<{ t: string; h: string }>>(parts.join(" UNION ALL "));
  return Object.fromEntries(rows.map((r) => [r.t, r.h]));
}

/** Tables whose fingerprint differs between two snapshots. */
export function changedTables(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]);
}
