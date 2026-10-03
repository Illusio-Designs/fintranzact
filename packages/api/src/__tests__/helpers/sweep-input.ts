/**
 * sweep-input.ts — builds a minimal valid input for any tRPC procedure from
 * its zod input schema, so the role and isolation sweeps can call every
 * procedure in the appRouter without a hand-written input for each one.
 *
 * Strings are filled by trying candidates (chosen from the field name first,
 * then a generic list) until the leaf schema accepts one. Fields that carry an
 * id are resolved through `resolveId`, which the sweeps point at their seeded
 * fixtures (the caller's own records for the role sweep, another business's
 * or organisation's records for the isolation sweep).
 */

import { randomUUID } from "node:crypto";
import type { ZodTypeAny } from "zod";

export interface GenOptions {
  /** Returns the id to use for an id-like field, or undefined to fall back. */
  resolveId: (key: string, path: string[]) => string | undefined;
  /**
   * Also fill optional fields whose name looks like an id (partyId, itemIds…),
   * so a filter such as `reports.x({ partyId })` is exercised with a real id.
   */
  includeOptionalIds?: boolean;
}

/** Field names treated as record references. */
export function isIdKey(key: string): boolean {
  return /(^id$|Id$|^ids$|Ids$)/.test(key);
}

type Def = { typeName: string } & Record<string, unknown>;
const defOf = (s: ZodTypeAny) => s._def as unknown as Def;

/** Unwraps optional/nullable/default/effects wrappers down to the base schema. */
export function unwrap(s: ZodTypeAny): ZodTypeAny {
  let cur = s;
  for (let i = 0; i < 20; i++) {
    const d = defOf(cur);
    switch (d.typeName) {
      case "ZodOptional":
      case "ZodNullable":
      case "ZodDefault":
      case "ZodCatch":
      case "ZodReadonly":
      case "ZodBranded":
        cur = d.innerType as ZodTypeAny ?? (d.type as ZodTypeAny);
        break;
      case "ZodEffects":
        cur = d.schema as ZodTypeAny;
        break;
      case "ZodPipeline":
        cur = d.in as ZodTypeAny;
        break;
      case "ZodLazy":
        cur = (d.getter as () => ZodTypeAny)();
        break;
      default:
        return cur;
    }
  }
  return cur;
}

function isOptional(s: ZodTypeAny): boolean {
  return s.safeParse(undefined).success;
}

/** True when the schema (or anything inside it) has an id-like field. */
export function containsId(s: ZodTypeAny, depth = 0): boolean {
  if (depth > 6) return false;
  const base = unwrap(s);
  const d = defOf(base);
  if (d.typeName === "ZodObject") {
    const shape = (d.shape as () => Record<string, ZodTypeAny>)();
    return Object.entries(shape).some(([k, v]) => isIdKey(k) || containsId(v, depth + 1));
  }
  if (d.typeName === "ZodArray") return containsId(d.type as ZodTypeAny, depth + 1);
  if (d.typeName === "ZodUnion" || d.typeName === "ZodDiscriminatedUnion") {
    const opts = (d.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>);
    const list = Array.isArray(opts) ? opts : [...opts.values()];
    return list.some((o) => containsId(o, depth + 1));
  }
  if (d.typeName === "ZodIntersection") return containsId(d.left as ZodTypeAny, depth + 1) || containsId(d.right as ZodTypeAny, depth + 1);
  return false;
}

const today = new Date();
const isoDay = today.toISOString().slice(0, 10);
const monthStart = `${isoDay.slice(0, 7)}-01`;
const mm = isoDay.slice(5, 7);
const yyyy = isoDay.slice(0, 4);

function stringCandidates(key: string): string[] {
  const k = key.toLowerCase();
  const out: string[] = [];
  if (k.includes("email")) out.push("sweep.user@example.in");
  if (k.includes("phone") || k.includes("mobile") || k.includes("whatsapp")) out.push("9876543210");
  if (k.includes("gstin") || k === "gstn") out.push("27AABCU9603R1ZM");
  if (k === "pan") out.push("AABCU9603R");
  if (k.includes("pincode") || k === "pin") out.push("400001");
  if (k.includes("statecode") || k === "state_code") out.push("27");
  if (k.includes("hsn") || k.includes("sac")) out.push("52081100", "5208");
  if (k.includes("ifsc")) out.push("HDFC0001234");
  if (k.includes("url") || k.includes("website")) out.push("https://example.in");
  if (k.includes("color") || k.includes("colour")) out.push("#1f6feb");
  if (k.includes("slug")) out.push(`sweep-${randomUUID().slice(0, 8)}`);
  if (k.includes("password")) out.push("Sweep@Passw0rd!2026");
  if (k.includes("period") || k.includes("month")) out.push(`${mm}${yyyy}`, `${yyyy}-${mm}`, monthStart);
  if (k.includes("financialyear") || k === "fy") out.push(`${yyyy}-${String(Number(yyyy.slice(2)) + 1).padStart(2, "0")}`, yyyy);
  if (k.includes("date") || k === "from" || k === "to" || k.endsWith("from") || k.endsWith("to") || k.includes("start") || k.includes("end") || k === "asof" || k === "asat")
    out.push(k.includes("end") || k === "to" || k.endsWith("to") ? isoDay : monthStart, `${isoDay}T00:00:00.000Z`);
  if (/(amount|price|rate|qty|quantity|balance|percent|value|total|discount|cost|charge|limit|threshold|factor|stock)/.test(k)) out.push("1", "100", "1.00");
  if (k.includes("barcode")) out.push(`SWP${Date.now().toString().slice(-9)}`);
  if (k.includes("otp") || k.includes("code")) out.push("123456", "SWEEP1");
  return out;
}

const GENERIC_STRINGS = [
  "Sweep test",
  "1",
  isoDay,
  `${isoDay}T00:00:00.000Z`,
  `${mm}${yyyy}`,
  `${yyyy}-${mm}`,
  "sweep",
  "SWEEP",
  "A",
  "27AABCU9603R1ZM",
  "9876543210",
  "sweep.user@example.in",
  "https://example.in",
  "400001",
  "27",
  "5208",
  randomUUID(),
];

function genString(schema: ZodTypeAny, key: string, path: string[], opts: GenOptions): unknown {
  const checks = (defOf(schema).checks as Array<{ kind: string; value?: number }> | undefined) ?? [];
  if (isIdKey(key) || checks.some((c) => c.kind === "uuid")) {
    const id = isIdKey(key) || path.length > 0 ? opts.resolveId(key, path) : undefined;
    if (id !== undefined) return id;
    if (checks.some((c) => c.kind === "uuid")) return randomUUID();
  }
  for (const c of [...stringCandidates(key), ...GENERIC_STRINGS]) {
    if (schema.safeParse(c).success) return c;
  }
  const min = checks.find((c) => c.kind === "min")?.value ?? 1;
  const len = checks.find((c) => c.kind === "length")?.value;
  const s = "a".repeat(len ?? Math.max(min, 1));
  return s;
}

function genNumber(schema: ZodTypeAny): number {
  const checks = (defOf(schema).checks as Array<{ kind: string; value?: number; inclusive?: boolean }> | undefined) ?? [];
  const min = checks.find((c) => c.kind === "min");
  const max = checks.find((c) => c.kind === "max");
  let n = 1;
  if (min && (min.value! > n || (min.value === n && min.inclusive === false))) n = min.inclusive === false ? min.value! + 1 : min.value!;
  if (max && (max.value! < n)) n = max.value!;
  return n;
}

/**
 * Generates a value for `schema`. Optional fields are left out unless they are
 * id-like and `includeOptionalIds` is set.
 */
export function gen(schema: ZodTypeAny, opts: GenOptions, key = "", path: string[] = [], depth = 0): unknown {
  if (depth > 12) return undefined;
  const d = defOf(schema);
  switch (d.typeName) {
    case "ZodOptional":
    case "ZodNullable":
      return gen(d.innerType as ZodTypeAny, opts, key, path, depth + 1);
    case "ZodDefault": {
      const dv = (d.defaultValue as () => unknown)();
      if (isIdKey(key)) {
        const id = gen(d.innerType as ZodTypeAny, opts, key, path, depth + 1);
        if (id !== undefined) return id;
      }
      return dv;
    }
    case "ZodCatch":
    case "ZodReadonly":
    case "ZodBranded":
      return gen((d.innerType ?? d.type) as ZodTypeAny, opts, key, path, depth + 1);
    case "ZodEffects":
      return gen(d.schema as ZodTypeAny, opts, key, path, depth + 1);
    case "ZodPipeline":
      return gen(d.in as ZodTypeAny, opts, key, path, depth + 1);
    case "ZodLazy":
      return gen((d.getter as () => ZodTypeAny)(), opts, key, path, depth + 1);
    case "ZodString":
      return genString(schema, key, path, opts);
    case "ZodNumber":
      return genNumber(schema);
    case "ZodBigInt":
      return 1n;
    case "ZodBoolean":
      return false;
    case "ZodDate":
      return new Date(`${isoDay}T00:00:00.000Z`);
    case "ZodLiteral":
      return d.value;
    case "ZodEnum": {
      const values = d.values as string[];
      // A plan id: the sweep world's own plan (Business), so choosing it is a no-op
      // and never moves the world to a plan with tighter limits (Starter is first).
      if (key === "plan" && values.includes("business")) return "business";
      return values[0];
    }
    case "ZodNativeEnum":
      return Object.values(d.values as Record<string, unknown>)[0];
    case "ZodNull":
      return null;
    case "ZodUndefined":
    case "ZodVoid":
      return undefined;
    case "ZodAny":
    case "ZodUnknown":
      return {};
    case "ZodRecord":
    case "ZodMap":
      return {};
    case "ZodSet":
      return new Set();
    case "ZodTuple":
      return (d.items as ZodTypeAny[]).map((it, i) => gen(it, opts, key, [...path, String(i)], depth + 1));
    case "ZodArray": {
      const el = d.type as ZodTypeAny;
      const minLen = (d.minLength as { value: number } | null)?.value ?? 0;
      const exact = (d.exactLength as { value: number } | null)?.value;
      const wantOne = exact === undefined && minLen === 0 && (isIdKey(key) || containsId(el)) && opts.includeOptionalIds;
      const n = exact ?? Math.max(minLen, wantOne ? 1 : 0);
      return Array.from({ length: n }, (_, i) => gen(el, opts, key, [...path, String(i)], depth + 1));
    }
    case "ZodObject": {
      const shape = (d.shape as () => Record<string, ZodTypeAny>)();
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) {
        const optional = isOptional(v);
        const wantOptional = optional && opts.includeOptionalIds && (isIdKey(k) || containsId(v));
        if (optional && !wantOptional) continue;
        const val = gen(v, opts, k, [...path, k], depth + 1);
        if (val !== undefined) out[k] = val;
      }
      return out;
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const raw = d.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
      const list = Array.isArray(raw) ? raw : [...raw.values()];
      let first: unknown;
      for (const o of list) {
        const v = gen(o, opts, key, path, depth + 1);
        if (first === undefined) first = v;
        if (o.safeParse(v).success) return v;
      }
      return first;
    }
    case "ZodIntersection": {
      const l = gen(d.left as ZodTypeAny, opts, key, path, depth + 1);
      const r = gen(d.right as ZodTypeAny, opts, key, path, depth + 1);
      return typeof l === "object" && typeof r === "object" ? { ...(l as object), ...(r as object) } : l;
    }
    default:
      return undefined;
  }
}

/** Generates the merged input for a procedure's `.input()` chain. */
export function genProcedureInput(inputs: ZodTypeAny[], opts: GenOptions): unknown {
  if (inputs.length === 0) return undefined;
  if (inputs.length === 1) {
    const s = inputs[0]!;
    // Callers may omit an entirely optional input.
    const v = gen(s, opts);
    return v;
  }
  return Object.assign({}, ...inputs.map((s) => gen(s, opts) as object));
}
