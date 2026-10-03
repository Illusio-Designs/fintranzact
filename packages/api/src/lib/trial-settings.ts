/**
 * Full Access Trial settings, editable by platform admins and kept in
 * system_config: `trial.days`, `trial.partnerDays` and `trial.caps`. Missing or
 * out-of-bounds stored values fall back to the defaults (normaliseTrialSettings),
 * so a hand-edited row can never break sign-up.
 *
 * Read on every sign-up and by the reminder job, cached for a short time; the
 * save procedure drops the cache on this server.
 */

import { inArray } from "drizzle-orm";
import { controlDb, systemConfig } from "@fintranzact/db";
import { normaliseTrialSettings, type TrialSettings } from "@fintranzact/shared";

export const TRIAL_SETTING_KEYS = {
  days: "trial.days",
  partnerDays: "trial.partnerDays",
  caps: "trial.caps",
} as const;

const CACHE_MS = 30_000;
let cache: { at: number; value: TrialSettings } | null = null;

export function invalidateTrialSettings(): void {
  cache = null;
}

/** Stored values as written by saveTrialSettings: { value: <number|object> }. */
function unwrap(raw: unknown): unknown {
  return raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>) ? (raw as { value: unknown }).value : raw;
}

export async function getTrialSettings(): Promise<TrialSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await controlDb
    .select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(inArray(systemConfig.key, Object.values(TRIAL_SETTING_KEYS)));
  const byKey = new Map(rows.map((r) => [r.key, unwrap(r.value)]));
  const value = normaliseTrialSettings({
    days: byKey.get(TRIAL_SETTING_KEYS.days),
    partnerDays: byKey.get(TRIAL_SETTING_KEYS.partnerDays),
    caps: byKey.get(TRIAL_SETTING_KEYS.caps),
  });
  cache = { at: Date.now(), value };
  return value;
}

/** Store validated settings (the caller has already run trialSettingsSchema). */
export async function saveTrialSettings(settings: TrialSettings): Promise<void> {
  const now = new Date();
  const entries: Array<[string, unknown]> = [
    [TRIAL_SETTING_KEYS.days, { value: settings.days }],
    [TRIAL_SETTING_KEYS.partnerDays, { value: settings.partnerDays }],
    [TRIAL_SETTING_KEYS.caps, settings.caps],
  ];
  await controlDb.transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx
        .insert(systemConfig)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: systemConfig.key, set: { value, updatedAt: now } });
    }
  });
  invalidateTrialSettings();
}
