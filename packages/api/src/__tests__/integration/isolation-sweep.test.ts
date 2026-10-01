/**
 * isolation-sweep.test.ts — tenant and business isolation over EVERY tRPC
 * procedure (enumerated at runtime from appRouter._def.procedures).
 *
 * World (helpers/sweep-world.ts): org A with businesses A1 (whole team) and
 * A2 (owner only), org B with business B1. Each business is seeded with one
 * record of every kind. The test DB runs in self-hosted mode, so all three
 * businesses share ONE database — a missing business_id filter anywhere is
 * visible here.
 *
 * Scenarios, for every procedure:
 *   cross-org       owner of A, business A1 selected, every id in the input
 *                   (including optional id filters) points at org B's records.
 *   cross-business  admin and seller of A (members of A1 only), business A1
 *                   selected, every id points at A2's records.
 *   foreign header  business-scoped procedures called with x-business-id set
 *                   to a business the caller can't use (B1 for A's owner, A2
 *                   for A's seller) must be FORBIDDEN by the middleware.
 *
 * A call passes when:
 *   - it doesn't change any row of the other business/org (fingerprinted from
 *     the live schema: every table with business_id, their child tables, and
 *     for org B its tenant/member/invitation/api-key/user/session rows), and
 *   - its result contains no marker of the other business (canary string in
 *     every seeded name/note, and the other side's record ids), and
 *   - a mutation that got foreign ids fails (FORBIDDEN / NOT_FOUND /
 *     BAD_REQUEST / …) instead of succeeding, unless listed in
 *     FOREIGN_ID_NOOP with the reason it is a harmless no-op.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  buildSweepWorld,
  seedBusiness,
  callerAs,
  callPath,
  deepMerge,
  fingerprint,
  changedTables,
  INPUT_OVERRIDES,
  CANARY,
  idsForCall,
  type SweepBusiness,
  type SweepWorld,
  type FingerprintScope,
} from "../helpers/sweep-world.js";
import { listProcedures, kindFor, idFields, type ProcInfo } from "../helpers/sweep-procs.js";
import { genProcedureInput } from "../helpers/sweep-input.js";
import type { TestUser } from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: SweepWorld;

/** Kinds that belong to the organisation, not to one business. */
const ORG_LEVEL = new Set(["tenant", "user", "invitation", "apiKey", "session", "memberUser"]);

/**
 * Mutations that answer "OK" to a foreign id without touching anything
 * (checked by the fingerprint), e.g. an idempotent delete that treats an
 * unknown id as already gone. Anything else succeeding is a failure.
 */
const FOREIGN_ID_NOOP: Record<string, string> = {
  "invoice.delete": "delete scoped to the caller's business; an unknown id is treated as already gone",
  "payment.delete": "delete scoped to the caller's business; an unknown id answers success: false",
  "expense.delete": "delete scoped to the caller's business; an unknown id is treated as already gone",
  "shipment.delete": "delete scoped to the caller's business; nothing matches a foreign id",
  "recurringInvoice.delete": "delete scoped to the caller's business; nothing matches a foreign id",
  "store.bulkToggleItems": "update scoped to the caller's business; foreign item ids match nothing",
  "import.reconcileDirectPayments": "excludeInvoiceIds is an exclusion list; foreign ids exclude nothing",
  "tenant.revokeInvitation": "delete scoped to the caller's organisation; nothing matches a foreign invitation",
  "tenant.removeMember": "delete scoped to the caller's organisation; a non-member matches nothing",
  "tenant.updateMemberRole": "update scoped to the caller's organisation; a non-member matches nothing",
};

/**
 * `procedure#kind`: a mutation acting on the caller's own record may succeed
 * while one reference of this kind points at another org, because the
 * reference is ignored (and the fingerprint proves nothing of B changed).
 */
const FOREIGN_REF_IGNORED: Record<string, string> = {
  "bankRecon.createExpense#bankAccount": "the expense's account is always the statement's own account; the input one is overwritten",
  "payment.assignAccount#payment": "payments outside the caller's business are skipped",
  "invoice.update#shipment": "charges naming a shipment are dropped from the input; only the invoice's own shipment charges are kept",
  // Documents that don't move stock store no warehouse at all.
  "quotation.create#warehouse": "no stock effect: warehouseId is stored as null",
  "proforma.create#warehouse": "no stock effect: warehouseId is stored as null",
  "creditNote.create#warehouse": "no stock effect: warehouseId is stored as null",
  "debitNote.create#warehouse": "no stock effect: warehouseId is stored as null",
  "purchaseOrder.create#warehouse": "no stock effect: warehouseId is stored as null",
  "salesOrder.create#warehouse": "no stock effect: warehouseId is stored as null",
};

/**
 * Queries skipped by the final read-back, with the reason: they echo ids the
 * caller itself sent earlier in the sweep, which is not a leak.
 */
const READBACK_ECHO: Record<string, string> = {
  "business.auditTrail": "the caller's own audit rows record the ids it sent, including foreign ids refused or ignored by no-op deletes",
};

/** Error codes that count as a refusal. */
const REFUSED = new Set(["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "PRECONDITION_FAILED", "CONFLICT", "UNAUTHORIZED", "UNPROCESSABLE_CONTENT", "TOO_MANY_REQUESTS"]);

/** Procedures not swept, with the reason. */
const SKIP: Record<string, string> = {};

interface Scenario {
  name: string;
  caller: TestUser;
  tenantId: string;
  headerBusinessId: string;
  /** The other side: its ids are the foreign ones. */
  target: SweepBusiness;
  /** Ids used for kinds that are not foreign (the caller's own records). */
  ownIds?: Record<string, string>;
  /** Kinds taken from `target`; "all" = every id field is foreign. */
  foreign: "all" | Set<string>;
  /** Rows that must not change. */
  scope: FingerprintScope;
  /** Strings that must not appear in any response. */
  markers: string[];
}

function uuidsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    if (/^[0-9a-f-]{36}$/i.test(v)) out.add(v);
  } else if (Array.isArray(v)) v.forEach((x) => uuidsIn(x, out));
  else if (v && typeof v === "object" && !(v instanceof Date)) Object.values(v).forEach((x) => uuidsIn(x, out));
  return out;
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? "[bytes]" : x)) ?? "";
  } catch {
    return String(v);
  }
}

interface Outcome {
  code: string;
  message: string;
  violations: string[];
}

async function call(s: Scenario, path: string, input: unknown): Promise<{ result: unknown; code: string; message: string }> {
  try {
    const result = await Promise.race([
      callPath(callerAs(s.caller, s.tenantId, s.headerBusinessId), path, input),
      new Promise((_, rej) => setTimeout(() => rej(new TRPCError({ code: "TIMEOUT", message: "sweep timeout" })), 10_000)),
    ]);
    return { result, code: "OK", message: "" };
  } catch (e) {
    return { result: undefined, code: (e as { code?: string }).code ?? "THROWN", message: (e as Error).message };
  }
}

function leaks(s: Scenario, result: unknown, inputIds: Set<string>): string[] {
  const body = stringify(result);
  return s.markers.filter((m) => !inputIds.has(m) && body.includes(m));
}

async function run(proc: ProcInfo, s: Scenario): Promise<Outcome> {
  const isForeign = (kind: string) => s.foreign === "all" || s.foreign.has(kind);
  const foreignIds = new Set(Object.entries(s.target.ids).filter(([k]) => isForeign(k)).map(([, id]) => id));
  const pick = (kind: string) => (isForeign(kind) ? s.target.ids[kind] : s.ownIds?.[kind]);
  const base = genProcedureInput(proc.inputs, {
    includeOptionalIds: true,
    resolveId: (key, keyPath) => {
      const kind = kindFor(proc, key, keyPath);
      return kind ? pick(kind) : undefined;
    },
  });
  const overrideIds = s.foreign === "all" ? s.target.ids : { ...s.ownIds, ...Object.fromEntries([...s.foreign].map((k) => [k, s.target.ids[k]])) };
  const input = deepMerge(base, INPUT_OVERRIDES[proc.path]?.(overrideIds as Record<string, string>));
  const inputIds = uuidsIn(input);
  const usedForeign = [...inputIds].some((id) => foreignIds.has(id));

  const before = await fingerprint(s.scope);
  const { result, code, message } = await call(s, proc.path, input);
  const after = await fingerprint(s.scope);

  const violations: string[] = [];
  const changed = changedTables(before, after);
  if (changed.length) violations.push(`modified ${s.target.tag} rows in: ${changed.join(", ")}`);
  if (code === "OK") {
    const leaked = leaks(s, result, inputIds);
    if (leaked.length) violations.push(`response leaks ${leaked.length} marker(s) of ${s.target.tag}: ${leaked.slice(0, 3).join(", ")}`);
    const allowed = s.foreign === "all"
      ? proc.path in FOREIGN_ID_NOOP
      : [...s.foreign].every((k) => `${proc.path}#${k}` in FOREIGN_REF_IGNORED);
    if (proc.type === "mutation" && usedForeign && !allowed) {
      violations.push(`mutation succeeded with ${s.target.tag} ids`);
    }
  } else if (!REFUSED.has(code)) {
    violations.push(`unexpected ${code}: ${message.slice(0, 120)}`);
  }
  return { code, message, violations };
}

/** Markers of business `b`: its canary tag and every seeded record id. */
function markersOf(b: SweepBusiness, extra: string[] = []): string[] {
  const ids = Object.entries(b.ids)
    .filter(([kind]) => b.tag === CANARY || !ORG_LEVEL.has(kind))
    .map(([, id]) => id);
  return [...new Set([b.tag, b.id, ...ids, ...extra])];
}

const PROCS = listProcedures()
  .filter((p) => !(p.path in SKIP))
  // Queries first, so a failing mutation can't hide a later query's leak.
  .sort((a, b) => (a.type === b.type ? 0 : a.type === "query" ? -1 : 1));

beforeAll(async () => {
  world = await buildSweepWorld();
  await seedBusiness(world.a1);
  await seedBusiness(world.a2);
  await seedBusiness(world.b1);
}, 180_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("isolation sweep over every tRPC procedure", () => {
  it("enumerates the whole appRouter", () => {
    expect(PROCS.length).toBeGreaterThan(400);
  });

  for (const proc of PROCS) {
    it(`${proc.path}`, async () => {
      const { usersA, ownerB, a1, a2, b1, tenantA, tenantB } = world;
      const crossOrg: Scenario = {
        name: "cross-org (A owner, B ids)",
        caller: usersA.owner,
        tenantId: tenantA.id,
        headerBusinessId: a1.id,
        target: b1,
        foreign: "all",
        scope: { businessIds: [b1.id], tenantId: tenantB.id },
        markers: markersOf(b1, [tenantB.id, ownerB.id, ownerB.email]),
      };
      const crossBiz = (who: "admin" | "seller"): Scenario => ({
        name: `cross-business (A ${who}, A2 ids)`,
        caller: usersA[who],
        tenantId: tenantA.id,
        headerBusinessId: a1.id,
        target: a2,
        foreign: "all",
        scope: { businessIds: [a2.id] },
        markers: markersOf(a2),
      });
      const scenarios: Scenario[] = [crossOrg, crossBiz("admin"), crossBiz("seller")];
      if (proc.base === "authorized" || proc.base === "business") {
        scenarios.push(
          { ...crossOrg, name: "foreign header (A owner, x-business-id B1)", headerBusinessId: b1.id },
          { ...crossBiz("seller"), name: "foreign header (A seller, x-business-id A2)", headerBusinessId: a2.id },
        );
      }
      // One foreign reference at a time, everything else the caller's own:
      // catches a procedure that checks its main record but trusts a
      // secondary id (e.g. an update that re-points bankAccountId).
      const fields = idFields(proc);
      const refKinds = [...new Set(fields.filter((f) => !f.primary).map((f) => f.kind))];
      if (fields.length > 1) {
        const ownIds = await idsForCall(a1, proc);
        for (const kind of refKinds) {
          scenarios.push({ ...crossOrg, name: `foreign ${kind} reference (A owner, own ids + B ${kind})`, ownIds, foreign: new Set([kind]) });
        }
      }

      const problems: string[] = [];
      for (const s of scenarios) {
        const out = await run(proc, s);
        if (s.name.startsWith("foreign header") && out.code !== "FORBIDDEN") {
          out.violations.push(`expected FORBIDDEN from the business middleware, got ${out.code}`);
        }
        problems.push(...out.violations.map((v) => `${s.name}: ${v}`));
      }
      expect(problems, `${proc.path}:\n${problems.join("\n")}`).toEqual([]);
    }, 120_000);
  }

  it("no query shows another org's or business's data after the sweep", async () => {
    // Mutations above may have stored a foreign reference that only shows up
    // when the caller's own records are read back (a list joining a foreign
    // party, say). Re-read everything with the caller's own ids.
    const { usersA, ownerB, a1, a2, b1, tenantA, tenantB } = world;
    const problems: string[] = [];
    for (const proc of PROCS.filter((p) => p.type === "query" && p.router !== "platform" && !(p.path in READBACK_ECHO))) {
      for (const who of ["owner", "seller"] as const) {
        const s: Scenario = {
          name: `A ${who} reads own data`,
          caller: usersA[who],
          tenantId: tenantA.id,
          headerBusinessId: a1.id,
          target: b1,
          ownIds: a1.ids,
          foreign: new Set(),
          scope: { businessIds: [b1.id], tenantId: tenantB.id },
          // The owner is a member of A2, so only the seller must not see it.
          markers: [...markersOf(b1, [tenantB.id, ownerB.id, ownerB.email]), ...(who === "seller" ? markersOf(a2) : [])],
        };
        const input = deepMerge(
          genProcedureInput(proc.inputs, {
            resolveId: (key, keyPath) => {
              const kind = kindFor(proc, key, keyPath);
              return kind ? a1.ids[kind] : undefined;
            },
          }),
          INPUT_OVERRIDES[proc.path]?.(a1.ids),
        );
        const { result, code } = await call(s, proc.path, input);
        if (code !== "OK") continue;
        const leaked = leaks(s, result, uuidsIn(input));
        if (leaked.length) problems.push(`${proc.path} as ${who}: shows ${leaked.slice(0, 3).join(", ")}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  }, 300_000);
});
