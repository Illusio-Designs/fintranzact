import { BootSplash } from "@/components/ui/BootSplash";
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
    return <BootSplash className="bg-surface-1" />;
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
            Create your company
          </h1>

          <p className="mt-1 text-sm text-text-tertiary">
            Complete your business details before entering the Fintranzact
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
            // Plan is chosen right after signup. Go to the dashboard; the
            // plan gate in __root.tsx still redirects to /auth/plan-selection
            // if this tenant has no plan yet, so it is never shown twice.
            navigate({ to: "/" });
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
          Fintranzact
        </p>

        <p className="text-sm font-medium text-text-primary">
          Organization setup
        </p>
      </div>
    </div>
  );
}
