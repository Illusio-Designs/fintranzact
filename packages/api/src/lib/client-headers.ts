/**
 * client-headers.ts — first-party client header names and values.
 *
 * First-party clients send:
 *
 *   X-Requested-With:     fintranzact
 *   X-Fintranzact-Client: mobile | desktop
 *
 * This module has no side effects so it can be imported from
 * csrf-middleware.ts, trpc.ts, context.ts and the auth router alike.
 */

/** Value first-party clients send in `X-Requested-With`. */
export const REQUESTED_WITH_VALUE = "fintranzact";

/** Header first-party clients use to declare their kind (mobile/desktop). */
export const CLIENT_KIND_HEADER = "X-Fintranzact-Client";

/** True when `X-Requested-With` carries a first-party marker. */
export function isFirstPartyRequestedWith(value: string | null | undefined): boolean {
  return value === REQUESTED_WITH_VALUE;
}

/**
 * The declared client kind ("mobile", "desktop", …). Returns null when the
 * header is absent.
 */
export function getClientKind(headers: Headers): string | null {
  return headers.get(CLIENT_KIND_HEADER);
}
