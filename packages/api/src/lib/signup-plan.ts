/**
 * What a new organisation starts with. There is no free plan: a new
 * organisation is on the plan its owner chose (Growth when none was chosen)
 * and has a Full Access Trial running (tenants.trial_started_at / trial_ends_at
 * / trial_source), so deriveAccess grants Business-level access plus the
 * add-ons until it ends and then makes the organisation read-only until a plan
 * is bought. The trial's length, source and the one-trial-per-business check
 * come from lib/trial.ts (decideNewOrgTrial); this file only shapes the row.
 */

import { TRPCError } from "@trpc/server";
import {
  DEFAULT_SIGNUP_PLAN,
  TRIAL_DAYS,
  isPlanId,
  isRemovedPlanId,
  removedPlanMessage,
  type PlanId,
  type TrialSource,
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

export interface TrialFields {
  trialStartedAt: Date;
  trialEndsAt: Date;
  trialSource: TrialSource;
}

/**
 * The plan, plan-chosen marker and trial for a brand-new organisation.
 * planSelectedAt is set only when the owner named a plan at sign-up; without
 * one it stays null so the app still asks them to confirm a plan. `trial` is
 * what decideNewOrgTrial returned; without it the organisation gets the
 * default-length sign-up trial (used by fixtures and tests).
 */
export function newOrganisationPlanFields(
  requested: string | null | undefined,
  now: Date = new Date(),
  trial?: TrialFields,
): { plan: PlanId; planSelectedAt: Date | null } & TrialFields {
  const plan = resolveSignupPlan(requested);
  const chose = !!requested?.trim() && isPlanId(requested.trim());
  return {
    plan,
    planSelectedAt: chose ? now : null,
    trialStartedAt: trial?.trialStartedAt ?? now,
    trialEndsAt: trial?.trialEndsAt ?? trialEndsAtFrom(now),
    trialSource: trial?.trialSource ?? "signup",
  };
}
