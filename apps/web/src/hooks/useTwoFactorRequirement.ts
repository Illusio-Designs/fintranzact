import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { TWO_FACTOR_SETUP_PATH, type TwoFactorRequirementView } from "@fintranzact/shared";

const NONE: TwoFactorRequirementView = { required: false, blocked: false, graceEndsAt: null, policy: "off", setupPath: TWO_FACTOR_SETUP_PATH };

/**
 * The caller's two-factor requirement in the selected organisation, from
 * `tenant.current` (one of the few calls a blocked member can still make). A
 * mirror for banners and redirects only; the server is the enforcement. Once
 * the user turns 2FA on (`auth.me`) the requirement is treated as met at once
 * and the queries a block had refused are refetched.
 */
export function useTwoFactorRequirement() {
  const utils = trpc.useUtils();
  const { data: me } = trpc.auth.me.useQuery();
  const { data: tenant, isLoading } = trpc.tenant.current.useQuery(undefined, {
    enabled: !!me?.tenantId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const hasTwoFactor = me?.twoFactor?.enabled === true;
  const server = (tenant?.twoFactorRequirement as TwoFactorRequirementView | undefined) ?? NONE;
  const stale = hasTwoFactor && server.required;

  useEffect(() => {
    if (!stale) return;
    void utils.tenant.current.invalidate();
    void utils.business.list.invalidate();
  }, [stale]); // eslint-disable-line react-hooks/exhaustive-deps

  const requirement = hasTwoFactor ? { ...server, required: false, blocked: false } : server;
  return {
    requirement,
    policy: (tenant?.twoFactorPolicy as TwoFactorRequirementView["policy"] | undefined) ?? "off",
    graceDays: tenant?.twoFactorGraceDays ?? 7,
    isLoading,
  };
}
