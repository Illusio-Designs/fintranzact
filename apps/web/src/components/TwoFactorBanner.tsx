import { useEffect } from "react";
import dayjs from "dayjs";
import { Link, useNavigate } from "@tanstack/react-router";
import { twoFactorBannerText } from "@fintranzact/shared";
import { useTwoFactorRequirement } from "@/hooks/useTwoFactorRequirement";
import { registerTwoFactorNavigator } from "@/lib/two-factor-handler";
import { setupSearch } from "@/lib/two-factor-enforcement";

/**
 * One persistent notice when the organisation requires two-factor
 * authentication and the user has not set it up: an amber reminder with the
 * deadline during the grace period, a red alert once blocked. Renders nothing
 * for everyone else.
 */
export function TwoFactorBanner() {
  const navigate = useNavigate();
  const { requirement } = useTwoFactorRequirement();

  useEffect(() => {
    registerTwoFactorNavigator((path) => void navigate({ to: "/settings", search: setupSearch(path) }));
    return () => registerTwoFactorNavigator(null);
  }, [navigate]);

  const banner = twoFactorBannerText(requirement, (d) => dayjs(d).format("D MMM YYYY"));
  if (!banner) return null;

  const search = setupSearch(requirement.setupPath);
  const blocked = banner.kind === "blocked";
  return (
    <div
      role={blocked ? "alert" : "status"}
      data-testid="two-factor-banner"
      className={
        blocked
          ? "px-4 py-2 text-center text-sm font-medium bg-red-600 text-white"
          : "px-4 py-2 text-center text-sm bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100 border-b border-amber-200 dark:border-amber-900"
      }
    >
      {banner.text}
      <Link to="/settings" search={search} className="ml-2 inline-block font-semibold underline underline-offset-2 whitespace-nowrap">
        Set up now
      </Link>
    </div>
  );
}
