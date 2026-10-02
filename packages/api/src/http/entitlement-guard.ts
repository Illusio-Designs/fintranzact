/**
 * REST counterpart of the tRPC entitlement gate. A refused write answers
 * HTTP 403 with the same data the tRPC errorFormatter sends:
 *   { error: <message>, entitlement: { reason, upgradePath } }
 *
 * The route table lives in rest-entitlement-policy.ts and is re-exported here.
 */

import type { Context } from "hono";
import { BILLING_UPGRADE_PATH, entitlementMessage, type EntitlementErrorData, type EntitlementReason } from "@fintranzact/shared";
import { getEntitlements } from "../lib/entitlements.js";

export { REST_ENTITLEMENT_POLICY, type RestEntitlementPolicy } from "./rest-entitlement-policy.js";

export interface RestEntitlementBody {
  error: string;
  entitlement: EntitlementErrorData;
}

/** The 403 JSON body for a refusal reason. */
export function entitlementRefusalBody(reason: EntitlementReason): RestEntitlementBody {
  return {
    error: entitlementMessage(reason),
    entitlement: { reason, upgradePath: BILLING_UPGRADE_PATH },
  };
}

/**
 * Returns the 403 response when the organisation is read-only or suspended,
 * else null. Use on every route that creates or edits business data:
 *   const refused = await refuseIfReadOnly(c, tenantId); if (refused) return refused;
 */
export async function refuseIfReadOnly(c: Context, tenantId: string): Promise<Response | null> {
  const ent = await getEntitlements(tenantId);
  if (ent.readOnly && ent.reason) return c.json(entitlementRefusalBody(ent.reason), 403);
  return null;
}

/** Alias that reads better at call sites that must either proceed or return. */
export const requireWritableRest = refuseIfReadOnly;
