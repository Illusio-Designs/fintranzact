/**
 * Per-person AI preferences (Phase 3): the reply language and the dashboard
 * tips switch. Stored in the tenant database (ai_user_prefs), one row per
 * business and person, private to that person.
 *
 * The language that reaches the system prompt is ALWAYS re-validated against
 * the fixed list here, so a bad stored value can never inject text into the
 * prompt.
 */

import { and, eq } from "drizzle-orm";
import { aiUserPrefs, type TenantDatabase } from "@fintranzact/db";
import { AI_DEFAULT_USER_PREFS, normaliseAiLanguage, type AiUserPrefs, type AiUserPrefsUpdate } from "@fintranzact/shared";

export async function getAiUserPrefs(db: TenantDatabase, businessId: string, userId: string): Promise<AiUserPrefs> {
  const [row] = await db
    .select({ language: aiUserPrefs.language, tipsEnabled: aiUserPrefs.tipsEnabled })
    .from(aiUserPrefs)
    .where(and(eq(aiUserPrefs.businessId, businessId), eq(aiUserPrefs.userId, userId)))
    .limit(1);
  if (!row) return { ...AI_DEFAULT_USER_PREFS };
  return { language: normaliseAiLanguage(row.language), tipsEnabled: row.tipsEnabled };
}

/** Saves what is given; a field left out keeps what is stored. Returns the result. */
export async function saveAiUserPrefs(db: TenantDatabase, businessId: string, userId: string, update: AiUserPrefsUpdate): Promise<AiUserPrefs> {
  const current = await getAiUserPrefs(db, businessId, userId);
  const next: AiUserPrefs = {
    language: update.language ?? current.language,
    tipsEnabled: update.tipsEnabled ?? current.tipsEnabled,
  };
  await db
    .insert(aiUserPrefs)
    .values({ businessId, userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [aiUserPrefs.businessId, aiUserPrefs.userId], set: { ...next, updatedAt: new Date() } });
  return next;
}
