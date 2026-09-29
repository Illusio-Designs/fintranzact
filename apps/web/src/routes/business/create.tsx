import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BusinessForm } from "@/components/settings/BusinessTab";
import { Logo } from "@/components/ui/Logo";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/business/create")({
  component: CreateBusinessPage,
});

function CreateBusinessPage() {
  const navigate = useNavigate();
  const { data: session } = trpc.auth.me.useQuery();
  const { data: businesses, isLoading } = trpc.business.list.useQuery();
  const { data: canCreate } = trpc.business.canCreate.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });

  const canManageBusinesses =
    ["owner", "admin", "superadmin"].includes(session?.role ?? "") &&
    (canCreate ?? true);

  if (isLoading || !session) {
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
              Business creation is restricted
            </h1>
            <p className="mt-2 text-sm text-text-tertiary">
              Only organization owners and admins can create businesses.
            </p>
            <button
              className="btn-secondary mt-5"
              onClick={() => navigate({ to: "/" })}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isFirstBusiness = (businesses?.length ?? 0) === 0;

  return (
    <div className="min-h-screen bg-surface-1 px-4 py-8 md:px-6">
      <div className="mx-auto max-w-5xl">
        <StandaloneHeader />

        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
            {isFirstBusiness ? "Organization setup" : "Organization"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-text-primary">
            {isFirstBusiness ? "Set up your business" : "Create a new business"}
          </h1>
          <p className="mt-1 text-sm text-text-tertiary">
            This setup belongs to your organization, so it runs outside the
            business dashboard.
          </p>
        </div>

        <BusinessForm
          onboardingMode
          onDone={async () => {
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
