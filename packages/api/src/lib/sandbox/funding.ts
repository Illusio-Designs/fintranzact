/**
 * sandbox/funding.ts — pure helpers for "our Sandbox wallet is empty / quota is spent".
 *
 * Sandbox is prepaid. When OUR balance or plan quota runs out, calls are
 * rejected (HTTP 402 or a matching message). That is our problem, not the
 * customer's, so customers must never see Sandbox's raw wording; they get
 * FUNDING_CUSTOMER_MESSAGE while the raw message and status stay in `cause`
 * and the logs. No imports here: it must stay safe to load without a database.
 */

export const FUNDING_CUSTOMER_MESSAGE =
  "The government filing service is temporarily unavailable. Please try again in a little while. Our team has been notified.";

/** True when a gateway error means our wallet is empty or the plan quota is spent. */
export function isWalletOrQuotaError(httpStatus: number | undefined, message: string): boolean {
  if (httpStatus === 402) return true;
  return /wallet|insufficient (balance|credit)|quota (exceeded|exhausted)|limit exceeded/i.test(message);
}

/** Errors that adapters re-wrapped from a funding failure (IRPError, EWBApiError, ...). */
const markedFunding = new WeakSet<object>();

/** Flag an adapter-level error as originating from a funding failure. Returns it for chaining. */
export function markFundingError<E extends Error>(err: E): E {
  markedFunding.add(err);
  return err;
}

/** Mark an adapter error as a funding failure and keep the original (raw) error as its `cause`. */
export function fundingFrom<E extends Error>(wrapped: E, original: unknown): E {
  wrapped.cause = original;
  return markFundingError(wrapped);
}

/** True for a funding failure, however it was re-wrapped (walks `cause`). */
export function isFundingFailure(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    if (markedFunding.has(cur)) return true;
    if ((cur as { isFunding?: unknown }).isFunding === true) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
