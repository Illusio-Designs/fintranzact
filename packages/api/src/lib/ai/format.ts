/** Small formatting and size helpers for what the assistant's tools return. */

import { stripControlChars } from "@fintranzact/shared";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹ with Indian (lakh / crore) grouping: 1234567.5 -> "₹12,34,567.50". */
export function formatInr(value: number): string {
  return Number.isFinite(value) ? INR.format(value) : "₹0.00";
}

/** A decimal string or number as a finite number (NaN and junk become 0). */
export function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals (money) without float noise. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Plain text for the model: control characters and newlines flattened, length capped. Names and notes in the books are untrusted. */
export function clip(value: unknown, max = 80): string {
  const s = value === null || value === undefined ? "" : String(value);
  const flat = stripControlChars(s).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** An amount as `{ key: number, keyFmt: "₹…" }` so the model can both reason on it and quote it correctly. */
export function money<K extends string>(key: K, value: unknown): Record<K | `${K}Fmt`, number | string> {
  const n = round2(toNum(value));
  return { [key]: n, [`${key}Fmt`]: formatInr(n) } as Record<K | `${K}Fmt`, number | string>;
}

/** An ISO timestamp or date as YYYY-MM-DD in Indian time. */
export function istDay(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Keep a JSON-able result under `maxChars` once serialised by halving the
 * longest array until it fits, and say so (`truncated`). Never throws.
 */
export function fitToBudget<T extends Record<string, unknown>>(result: T, maxChars: number): T & { truncated?: true } {
  let current: Record<string, unknown> = { ...result };
  let cut = false;
  for (let i = 0; i < 12; i++) {
    if (JSON.stringify(current).length <= maxChars) break;
    let longest: string | null = null;
    for (const [k, v] of Object.entries(current)) {
      if (Array.isArray(v) && v.length > 1 && (longest === null || v.length > (current[longest] as unknown[]).length)) longest = k;
    }
    if (!longest) break;
    const arr = current[longest] as unknown[];
    current = { ...current, [longest]: arr.slice(0, Math.max(1, Math.floor(arr.length / 2))) };
    cut = true;
  }
  return (cut ? { ...current, truncated: true } : current) as T & { truncated?: true };
}
