/**
 * Add-on prices the admin console edits, like plan prices.
 *
 * Stored in system_config under `billing.addon_prices`:
 *   { "ai_assistant": { monthlyPriceInr, yearlyPriceInr|null }, "ai_plus": {...}, "payroll": {...},
 *     "store_pro": {...}, "ai_pack": { priceInr } }
 * An entry that is missing or invalid falls back to the built-in price (ADDONS in
 * @fintranzact/shared; AI_PACK_PRICE_INR), so a bad edit never breaks checkout. A price is frozen
 * into the subscription row (base_paise) or the pack order when it is bought, so an edit only
 * affects new purchases; running Razorpay subscriptions keep their own plan object
 * (the gateway mints a new one per amount, see gateway.ts).
 */

import { eq } from "drizzle-orm";
import { controlDb, systemConfig } from "@fintranzact/db";
import {
  AI_PACK_PRICE_INR,
  NO_ADDON_PRICE_OVERRIDES,
  normaliseAddonPrices,
  type AddonId,
  type AddonPriceOverrides,
} from "@fintranzact/shared";

export const ADDON_PRICES_KEY = "billing.addon_prices";

const CACHE_MS = 30_000;
let cache: { at: number; value: AddonPriceOverrides } | null = null;

export function invalidateAddonPrices(): void {
  cache = null;
}

export async function getAddonPrices(): Promise<AddonPriceOverrides> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const [row] = await controlDb.select({ value: systemConfig.value }).from(systemConfig).where(eq(systemConfig.key, ADDON_PRICES_KEY)).limit(1);
  const value = row ? normaliseAddonPrices(row.value) : NO_ADDON_PRICE_OVERRIDES;
  cache = { at: Date.now(), value };
  return value;
}

/** The price of one extra AI pack in rupees, ex-GST, as in force now. */
export async function getAiPackPriceInr(): Promise<number> {
  return (await getAddonPrices()).aiPackPriceInr ?? AI_PACK_PRICE_INR;
}

/** The stored shape of the overrides. */
export function toStoredAddonPrices(o: AddonPriceOverrides): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(o.addons) as Array<[AddonId, { monthlyPriceInr: number; yearlyPriceInr: number | null }]>) {
    out[id] = { monthlyPriceInr: p.monthlyPriceInr, yearlyPriceInr: p.yearlyPriceInr };
  }
  if (o.aiPackPriceInr !== null) out.ai_pack = { priceInr: o.aiPackPriceInr };
  return out;
}

export async function saveAddonPrices(o: AddonPriceOverrides): Promise<void> {
  const value = toStoredAddonPrices(o);
  await controlDb
    .insert(systemConfig)
    .values({ key: ADDON_PRICES_KEY, value })
    .onConflictDoUpdate({ target: systemConfig.key, set: { value, updatedAt: new Date() } });
  invalidateAddonPrices();
}
