/**
 * AI assistant settings.
 *  - Per organisation (control ai_settings): the owner's on/off switch and the
 *    roles it is off for. No row means on for everyone.
 *  - Per platform (system_config `ai.prices`): the price table the admin console
 *    edits and the cost estimate reads. A missing or invalid value falls back to
 *    the defaults.
 */

import { eq } from "drizzle-orm";
import { aiSettings, controlDb, systemConfig } from "@fintranzact/db";
import { AI_DEFAULT_PRICES, AI_SWITCHABLE_ROLES, normaliseAiPrices, type AiPriceTable, type AiSettings } from "@fintranzact/shared";

export const AI_PRICES_KEY = "ai.prices";

export async function getAiSettings(tenantId: string): Promise<AiSettings> {
  const [row] = await controlDb.select().from(aiSettings).where(eq(aiSettings.tenantId, tenantId)).limit(1);
  if (!row) return { enabled: true, disabledRoles: [] };
  return {
    enabled: row.enabled,
    disabledRoles: (row.disabledRoles ?? []).filter((r): r is (typeof AI_SWITCHABLE_ROLES)[number] => (AI_SWITCHABLE_ROLES as readonly string[]).includes(r)),
  };
}

export async function saveAiSettings(tenantId: string, settings: AiSettings, userId: string): Promise<void> {
  const now = new Date();
  await controlDb
    .insert(aiSettings)
    .values({ tenantId, enabled: settings.enabled, disabledRoles: settings.disabledRoles, updatedByUserId: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: aiSettings.tenantId,
      set: { enabled: settings.enabled, disabledRoles: settings.disabledRoles, updatedByUserId: userId, updatedAt: now },
    });
}

/** Why the assistant is off for this person, or null when it is on. `role` is the permission role (superadmin = the owner). */
export function aiDisabledReason(settings: AiSettings, role: string): "org_disabled" | "role_disabled" | null {
  if (role === "superadmin") return null; // the owner always keeps it, so they can switch it back on
  if (!settings.enabled) return "org_disabled";
  if ((settings.disabledRoles as string[]).includes(role)) return "role_disabled";
  return null;
}

// ── Price table ──────────────────────────────────────────────────────────────

const CACHE_MS = 30_000;
let priceCache: { at: number; value: AiPriceTable } | null = null;

export function invalidateAiPrices(): void {
  priceCache = null;
}

export async function getAiPrices(): Promise<AiPriceTable> {
  if (priceCache && Date.now() - priceCache.at < CACHE_MS) return priceCache.value;
  const [row] = await controlDb.select({ value: systemConfig.value }).from(systemConfig).where(eq(systemConfig.key, AI_PRICES_KEY)).limit(1);
  const value = row ? normaliseAiPrices(row.value) : AI_DEFAULT_PRICES;
  priceCache = { at: Date.now(), value };
  return value;
}

export async function saveAiPrices(prices: AiPriceTable): Promise<void> {
  const now = new Date();
  await controlDb
    .insert(systemConfig)
    .values({ key: AI_PRICES_KEY, value: prices, updatedAt: now })
    .onConflictDoUpdate({ target: systemConfig.key, set: { value: prices, updatedAt: now } });
  invalidateAiPrices();
}
