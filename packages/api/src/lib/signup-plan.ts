/**
 * What a new organisation starts with. There is no free plan: a new
 * organisation is on the plan its owner chose (Growth when none was chosen)
 * and has a Full Access Trial running (tenants.trial_ends_at), so deriveAccess
 * grants full access until it ends and then makes the organisation read-only
 * until a plan is bought.
 *
 * This is the minimal start of the trial. The rest of P2 (Business-level
 * access and add-on caps during the trial, countdown banner, reminders,
 * one-trial-per-business checks, admin-editable length) is not built.
 */

import { TRPCError } from "@trpc/server";
import {
  DEFAULT_SIGNUP_PLAN,
  TRIAL_DAYS,
  isPlanId,
  isRemovedPlanId,
  removedPlanMessage,
  type PlanId,
} from "@fintranzact/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The plan a sign-up gets. A current plan id is kept; a removed one (the
 * old free, pro and enterprise ids and the unlimited test plan) is refused with a clear message;
 * nothing, or anything unrecognised, becomes the default (Growth).
 */
export function resolveSignupPlan(requested: string | null | undefined): PlanId {
  const value = requested?.trim();
  if (value && isRemovedPlanId(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: removedPlanMessage(value) });
  }
  return isPlanId(value) ? value : DEFAULT_SIGNUP_PLAN;
}

/** The end of a trial that starts now. */
export function trialEndsAtFrom(now: Date = new Date(), days: number = TRIAL_DAYS): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/**
 * The plan, plan-chosen marker and trial end for a brand-new organisation.
 * planSelectedAt is set only when the owner named a plan at sign-up; without
 * one it stays null so the app still asks them to confirm a plan.
 */
export function newOrganisationPlanFields(
  requested: string | null | undefined,
  now: Date = new Date(),
): { plan: PlanId; planSelectedAt: Date | null; trialEndsAt: Date } {
  const plan = resolveSignupPlan(requested);
  const chose = !!requested?.trim() && isPlanId(requested.trim());
  return { plan, planSelectedAt: chose ? now : null, trialEndsAt: trialEndsAtFrom(now) };
}
