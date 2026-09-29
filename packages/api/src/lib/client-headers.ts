/**
 * client-headers.ts — first-party client header names and values.
 *
 * The CSRF marker (`X-Requested-With`) and the client-kind header were
 * renamed from the old product name to Fintranzact. Clients now send:
 *
 *   X-Requested-With:     fintranzact
 *   X-Fintranzact-Client: mobile | desktop
 *
 * The legacy values (`X-Requested-With: hisaabo`, `X-Hisaabo-Client`) are
 * still accepted so that already-installed mobile/desktop builds keep
 * working until they update. Remove the legacy entries once those builds
 * are no longer supported.
 *
 * This module has no side effects so it can be imported from
 * csrf-middleware.ts, trpc.ts, context.ts and the auth router alike.
 */

/** Value first-party clients send in `X-Requested-With`. */
export const REQUESTED_WITH_VALUE = "fintranzact";

/** Header first-party clients use to declare their kind (mobile/desktop). */
export const CLIENT_KIND_HEADER = "X-Fintranzact-Client";

/** @deprecated Accepted for older app builds only. */
const LEGACY_REQUESTED_WITH_VALUE = "hisaabo";
/** @deprecated Accepted for older app builds only. */
export const LEGACY_CLIENT_KIND_HEADER = "X-Hisaabo-Client";

/** True when `X-Requested-With` carries a first-party marker (new or legacy). */
export function isFirstPartyRequestedWith(value: string | null | undefined): boolean {
  return value === REQUESTED_WITH_VALUE || value === LEGACY_REQUESTED_WITH_VALUE;
}

/**
 * The declared client kind ("mobile", "desktop", …) from the new header,
 * falling back to the legacy header. Returns null when neither is present.
 */
export function getClientKind(headers: Headers): string | null {
  return headers.get(CLIENT_KIND_HEADER) ?? headers.get(LEGACY_CLIENT_KIND_HEADER);
}
