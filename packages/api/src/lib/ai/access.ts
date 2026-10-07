/**
 * Who may use the AI assistant, in the order the checks run:
 *  1. the CASL permission on the "Ai" subject (a role with no access is FORBIDDEN
 *     whatever the add-on says),
 *  2. the add-on entitlement: active when it is admin-granted, subscribed, or
 *     during a Full Access Trial (with its cap on questions). A read-only
 *     organisation keeps READING its saved chat history, like every other module,
 *     but cannot ask: add-ons are off while read-only,
 *  3. the owner's switches (organisation, then role), enforced here on the server.
 *
 * Throws the same friendly refusal shape other add-on code uses (data.entitlement).
 */

import { TRPCError } from "@trpc/server";
import { requireCan, type Action, type AppAbility } from "../permissions.js";
import { getEntitlements, requireAddon, type Entitlements } from "../entitlements.js";
import { entitlementError } from "../entitlement-error.js";
import { aiDisabledReason, getAiSettings } from "./settings.js";

interface AiAccessCtx {
  ability: AppAbility;
  tenantId: string;
  role?: string;
}

/** Permission and add-on check. `action` "read" is history; anything else is asking or deleting. */
export async function assertAi(ctx: AiAccessCtx, action: Action): Promise<Entitlements> {
  requireCan(ctx.ability, action, "Ai");
  if (action !== "read") return requireAddon(ctx.tenantId, "ai_assistant");
  const ent = await getEntitlements(ctx.tenantId);
  if (ent.addons.ai_assistant) return ent;
  if (ent.reason === "tenant_suspended") throw entitlementError(ent.reason);
  // Read-only organisation: the add-on is off, but the history it already has stays readable.
  if (ent.readOnly) return ent;
  throw entitlementError("addon_required", { addon: "ai_assistant" });
}

export const AI_ORG_OFF_MESSAGE = "The AI assistant is switched off for your organisation. The owner can switch it on in Settings.";
export const AI_ROLE_OFF_MESSAGE = "The AI assistant is switched off for your role. The owner can change this in Settings.";
export const AI_NOT_CONFIGURED_MESSAGE = "The AI assistant is not set up on this server yet. Please ask your administrator.";

/** The owner's switches. The owner themself is never locked out (they would not be able to switch it back on). */
export async function assertAiSwitchedOn(ctx: { tenantId: string; role: string }): Promise<void> {
  const reason = aiDisabledReason(await getAiSettings(ctx.tenantId), ctx.role);
  if (reason) throw new TRPCError({ code: "FORBIDDEN", message: reason === "org_disabled" ? AI_ORG_OFF_MESSAGE : AI_ROLE_OFF_MESSAGE });
}
