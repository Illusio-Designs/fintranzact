import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BusinessForm } from "@/components/settings/BusinessTab";
import { Logo } from "@/components/ui/Logo";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();

  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();

  const { data: businesses, isLoading: businessesLoading } =
    trpc.business.list.useQuery();

  const { data: canCreate } = trpc.business.canCreate.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });

  const canManageBusinesses =
    ["owner", "admin", "superadmin"].includes(session?.role ?? "") &&
    (canCreate ?? true);

  if (sessionLoading || businessesLoading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-1">
        <div className="flex flex-col items-center gap-3">
          <Logo className="w-10 h-10" />
          <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!canManageBusinesses) {
    return (
      <div className="min-h-screen bg-surface-1 px-4 py-10">
        <div className="mx-auto max-w-2xl">
          <StandaloneHeader />

          <div className="card p-8 text-center">
            <h1 className="text-lg font-semibold text-text-primary">
              Business setup is restricted
            </h1>

            <p className="mt-2 text-sm text-text-tertiary">
              Only organization owners and admins can create the first business.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const hasBusiness = (businesses?.length ?? 0) > 0;

  // Onboarding is only for the first business.
  // If a business already exists, use /business/create instead.
  if (hasBusiness) {
    return (
      <div className="min-h-screen bg-surface-1 px-4 py-10">
        <div className="mx-auto max-w-2xl">
          <StandaloneHeader />

          <div className="card p-8 text-center">
            <h1 className="text-lg font-semibold text-text-primary">
              Business already exists
            </h1>

            <p className="mt-2 text-sm text-text-tertiary">
              Your organization already has a business. Use the business
              creation flow to add another one.
            </p>

            <button
              type="button"
              className="btn-primary mt-5"
              onClick={() => navigate({ to: "/business/create" })}
            >
              Add another business
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-1 px-4 py-8 md:px-6">
      <div className="mx-auto max-w-5xl">
        <StandaloneHeader />

        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
            Organization setup
          </p>

          <h1 className="mt-2 text-2xl font-semibold text-text-primary">
            Set up your business
          </h1>

          <p className="mt-1 text-sm text-text-tertiary">
            Complete your business details before entering the Hisaabo
            dashboard.
          </p>
        </div>

        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => navigate({ to: "/" })}
          >
            ← Cancel
          </button>
        </div>

        <BusinessForm
          onboardingMode
          onDone={() => {
            navigate({ to: "/auth/plan-selection" });
          }}
        />
      </div>
    </div>
  );
}

function StandaloneHeader() {
  return (
    <div className="mb-8 flex items-center gap-3">
      <Logo className="w-9 h-9" />

      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
          Hisaabo
        </p>

        <p className="text-sm font-medium text-text-primary">
          Organization setup
        </p>
      </div>
    </div>
  );
}
