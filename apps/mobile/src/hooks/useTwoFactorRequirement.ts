import { useEffect } from "react";
import { trpc } from "../lib/trpc";
import { isTwoFactorBlocked, twoFactorBannerFor } from "../lib/two-factor-banner";

/**
 * The caller's two-factor requirement in the selected organisation, from
 * tenant.current (one of the few calls a blocked member can still make).
 * Once 2FA is on (auth.me) the requirement counts as met and the queries a
 * block had refused are refetched.
 */
export function useTwoFactorRequirement() {
  const utils = trpc.useUtils();
  const { data: me } = trpc.auth.me.useQuery();
  const { data: tenant } = trpc.tenant.current.useQuery(undefined, {
    enabled: !!me?.tenantId,
    staleTime: 60_000,
    retry: 1,
  });
  const hasTwoFactor = me?.twoFactor?.enabled === true;
  const requirement = tenant?.twoFactorRequirement ?? null;
  const stale = hasTwoFactor && !!requirement?.required;

  useEffect(() => {
    if (!stale) return;
    void utils.tenant.current.invalidate();
    void utils.business.list.invalidate();
  }, [stale]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    requirement,
    banner: twoFactorBannerFor(requirement, { hasTwoFactor }),
    blocked: isTwoFactorBlocked(requirement, { hasTwoFactor }),
  };
}
