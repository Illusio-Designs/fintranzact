/**
 * The error every entitlement refusal throws: a FORBIDDEN TRPCError whose
 * `cause` carries the machine-readable reason. trpc.ts's errorFormatter copies
 * it to `error.data.entitlement`, so clients branch on the reason (open the
 * billing page, show a read-only banner) without parsing the message.
 *
 * Kept free of database imports so trpc.ts can use it.
 */

import { TRPCError } from "@trpc/server";
import {
  BILLING_UPGRADE_PATH,
  entitlementMessage,
  type AddonId,
  type EntitlementErrorData,
  type EntitlementReason,
  type PlanFlagKey,
} from "@fintranzact/shared";

export class EntitlementCause extends Error {
  readonly entitlement: EntitlementErrorData;
  constructor(message: string, entitlement: EntitlementErrorData) {
    super(message);
    this.name = "EntitlementCause";
    this.entitlement = entitlement;
  }
}

/** The entitlement data on a TRPCError, or null for any other error. */
export function entitlementDataOf(error: unknown): EntitlementErrorData | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof EntitlementCause ? cause.entitlement : null;
}

export function entitlementError(reason: EntitlementReason, opts: { message?: string; addon?: AddonId } = {}): TRPCError {
  const message = opts.message ?? entitlementMessage(reason, opts.addon);
  const data: EntitlementErrorData = {
    reason,
    upgradePath: BILLING_UPGRADE_PATH,
    ...(opts.addon ? { addon: opts.addon } : {}),
  };
  return new TRPCError({ code: "FORBIDDEN", message, cause: new EntitlementCause(message, data) });
}

/**
 * A feature the plan does not include. `message` is the sentence people read
 * ("E-invoicing is available on the Growth plan and above."); the data carries
 * the machine-readable parts so clients show a prompt instead of a generic error.
 */
export function featureNotInPlanError(info: {
  feature: PlanFlagKey;
  featureName: string;
  requiredPlan: string | null;
  currentPlan: string;
  message: string;
}): TRPCError {
  const data: EntitlementErrorData = {
    reason: "feature_not_in_plan",
    code: "feature_not_in_plan",
    upgradePath: BILLING_UPGRADE_PATH,
    feature: info.feature,
    featureName: info.featureName,
    requiredPlan: info.requiredPlan,
    currentPlan: info.currentPlan,
  };
  return new TRPCError({ code: "FORBIDDEN", message: info.message, cause: new EntitlementCause(info.message, data) });
}

/** A plan limit was reached; keeps the caller's own wording ("Your plan allows up to 3 …"). */
export function limitError(message: string): TRPCError {
  return entitlementError("plan_limit", { message });
}
