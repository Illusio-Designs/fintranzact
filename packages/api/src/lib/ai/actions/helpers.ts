/**
 * Helpers the action kinds share: resolving parties and items by id through
 * the person's own caller (never by name alone), candidate lists for the model
 * when a name is ambiguous, dates in Indian time, and the card builders.
 */

import { z } from "zod";
import { istDateParts, istStartOfDay } from "@fintranzact/shared";
import { AiToolInputError, AiActionEditError } from "../errors.js";
import { clip, formatInr, toNum } from "../format.js";
import type { AiActionCtx } from "./types.js";

// ── Dates (Indian calendar days) ─────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isRealYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** A YYYY-MM-DD day as the instant that Indian day starts (what the screens send). */
export function ymdToIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return istStartOfDay(y, m, d).toISOString();
}

export function isoToYmd(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const p = istDateParts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function todayYmd(now: Date = new Date()): string {
  return isoToYmd(now);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-10-09 -> "9 Oct 2026". */
export function prettyYmd(ymd: string): string {
  if (!isRealYmd(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ── Money and numbers as text ────────────────────────────────────────────────

export const inr = (v: unknown): string => formatInr(toNum(v));
export const trimNum = (v: unknown): string => {
  const n = toNum(v);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
};

const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const QTY = /^\d{1,10}(\.\d{1,3})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

/** Parse a person's typed value for an edit field; the message is shown to them. */
export function editAmount(value: string, label: string): string {
  const v = value.trim().replace(/,/g, "");
  if (!AMOUNT.test(v)) throw new AiActionEditError(`${label}: enter an amount like 1500 or 1500.50.`);
  return v;
}
export function editQuantity(value: string, label: string): string {
  const v = value.trim().replace(/,/g, "");
  if (!QTY.test(v) || !(parseFloat(v) > 0)) throw new AiActionEditError(`${label}: enter a quantity above 0.`);
  return v;
}
export function editPercent(value: string, label: string, max = 100): string {
  const v = value.trim();
  if (!PERCENT.test(v) || parseFloat(v) > max) throw new AiActionEditError(`${label}: enter a percentage between 0 and ${max}.`);
  return v;
}
export function editDate(value: string, label: string): string {
  const v = value.trim();
  if (!isRealYmd(v)) throw new AiActionEditError(`${label}: enter a real date.`);
  return v;
}

/** First problem of a zod parse as a short message. */
export function zodMessage(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return "invalid input";
  return `${i.path.join(".") || "input"} ${i.message}`;
}

/** Re-validate a stored payload with the real procedure's schema: a stored payload that no longer parses is refused clearly. */
export function parseReal<S extends z.ZodTypeAny>(schema: S, payload: unknown): z.output<S> {
  const r = schema.safeParse(payload);
  if (!r.success) throw new AiToolInputError(`This action's details are not valid: ${zodMessage(r.error)}`);
  return r.data;
}

// ── Parties and items, by id, through the person's caller ───────────────────

export interface PartyRow {
  id: string;
  name: string;
  type: "customer" | "supplier";
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  doNotRemind?: boolean | null;
}

type Row = Record<string, unknown>;

function describeParty(p: Row): string {
  const bits = [String(p.type ?? ""), clip(p.city, 30), clip(p.gstin, 15)].filter(Boolean);
  return `${clip(p.name, 60)} (${bits.join(", ")}) id=${String(p.id)}`;
}

/**
 * A party by id (the id comes from find_parties). With only a name, never
 * guess: list the candidates so the model asks the person which one.
 */
export async function resolveParty(ctx: AiActionCtx, ref: { partyId?: string; partyName?: string }): Promise<PartyRow> {
  if (ref.partyId) {
    const party = await ctx.caller.party.getById({ id: ref.partyId });
    if (!party) throw new AiToolInputError("No party with that id in this business. Look the party up with find_parties and use the id it returns.");
    return party as unknown as PartyRow;
  }
  const name = (ref.partyName ?? "").trim();
  const found = await ctx.caller.party.list({ search: name, filter: "all", sortBy: "name", sortDir: "asc", page: 1, limit: 5 });
  const rows = (found.data ?? []) as unknown as Row[];
  if (rows.length === 0) {
    throw new AiToolInputError(`No party matches "${clip(name, 60)}". Tell the person, and offer to add them (propose_create_party) if they want.`);
  }
  throw new AiToolInputError(
    `A name is not enough to choose a party. Parties matching "${clip(name, 60)}"${found.total > rows.length ? ` (first ${rows.length} of ${found.total})` : ""}: ${rows.map(describeParty).join("; ")}. ` +
      `${rows.length === 1 ? "If the person clearly means this one" : "Ask the person which one they mean, then"} call again with its partyId.`,
  );
}

export interface ItemRow {
  id: string;
  name: string;
  unit?: string | null;
  salePrice?: string | null;
  taxPercent?: string | null;
  itemType?: string | null;
  stockQuantity?: string | null;
  trackBatches?: boolean | null;
  tcsSection?: string | null;
  itemMode?: string | null;
}

function describeItem(i: Row): string {
  return `${clip(i.name, 60)} (${clip(i.unit, 12)}, sale price ${i.salePrice ?? "not set"}, GST ${i.taxPercent ?? "0"}%) id=${String(i.id)}`;
}

export async function loadItem(ctx: AiActionCtx, id: string): Promise<ItemRow | null> {
  const item = await ctx.caller.item.getById({ id });
  return (item as unknown as ItemRow | null) ?? null;
}

/** Items matching a name, for a line the model gave only a name for. */
export async function itemCandidates(ctx: AiActionCtx, name: string): Promise<{ rows: Row[]; total: number }> {
  const r = await ctx.caller.item.list({ search: name, page: 1, limit: 5 } as never);
  return { rows: (r.data ?? []) as unknown as Row[], total: r.total ?? 0 };
}

export function itemMatchesMessage(name: string, c: { rows: Row[]; total: number }): string {
  return (
    `A name is not enough to choose an item. Items matching "${clip(name, 60)}": ${c.rows.map(describeItem).join("; ")}. ` +
    `Ask the person which one they mean and call again with its itemId; or, if they want a one-off line that is not in the catalogue, call again with freeText true, the itemName and the unitPrice they gave.`
  );
}
