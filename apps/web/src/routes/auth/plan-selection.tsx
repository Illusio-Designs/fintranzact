import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { TRIAL_DAYS, isPlanId, type BillingCycle } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { planPriceDisplay, usePlans, type PlanId } from "@/lib/plans";
import { planSelectionMode } from "@/lib/plan-selection";
import { CycleToggle } from "@/components/pricing/CycleToggle";
import { toast } from "@/hooks/useToast";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
export const Route = createFileRoute("/auth/plan-selection")({
  component: PlanSelectionPage,
});

/** The plan picked on the pricing page / sign-up form, remembered for this visit. */
function rememberedPlan(): PlanId | null {
  try {
    const stored = sessionStorage.getItem("signupPlan");
    return isPlanId(stored) ? stored : null;
  } catch {
    return null;
  }
}

function PlanSelectionPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { plans } = usePlans();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(() => rememberedPlan() ?? "growth");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  const selectedOption = plans.find((plan) => plan.id === selectedPlan);
  const selectedLabel = useMemo(() => selectedOption?.name ?? "Growth", [selectedOption]);

  // DB is the source of truth: refresh tenant data so __root.tsx sees the
  // saved plan. A new owner has no company yet, so the next page is where they
  // create it; an organisation that already has one goes to its dashboard.
  async function goOn() {
    await utils.auth.me.refetch();
    await utils.tenant.list.refetch();
    const businesses = await utils.business.list.fetch();
    navigate({ to: businesses.length === 0 ? "/onboarding" : "/" });
  }

  // No payment here: every new organisation starts a free trial on the plan it
  // picks. Plans are bought later from Settings → Billing.
  const updatePlanMutation = trpc.tenant.updatePlan.useMutation({
    onSuccess: goOn,
    onError: (e) => toast.error("Could not save your plan", e.message),
  });

  // Only the owner changes the plan.
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();
  const { data: tenantList, isLoading: tenantListLoading } = trpc.tenant.list.useQuery();
  const currentTenant = tenantList?.find((tenant) => tenant.tenantId === session?.tenantId);
  const mode = planSelectionMode(currentTenant);
  const keepsCurrentPlan = mode !== "choose";
  const currentPlanLabel = currentTenant
    ? (plans.find((plan) => plan.id === currentTenant.tenantPlan)?.name ?? currentTenant.tenantPlan)
    : null;

  // The organisation's own plan (the one chosen at sign-up) is preselected once known.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (synced || !currentTenant) return;
    setSynced(true);
    if (isPlanId(currentTenant.tenantPlan) && (rememberedPlan() === null || rememberedPlan() === currentTenant.tenantPlan)) {
      setSelectedPlan(currentTenant.tenantPlan);
    }
  }, [currentTenant, synced]);

  function handleContinue() {
    if (keepsCurrentPlan) {
      navigate({ to: "/" });
      return;
    }
    updatePlanMutation.mutate({ plan: selectedPlan });
  }

  const selectedPrice = selectedOption ? planPriceDisplay(selectedOption, cycle) : null;

  return (
    <div className="min-h-screen bg-surface-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-600">
            Choose your plan
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
            Select the plan that fits your business
          </h1>
          <p className="mt-3 text-sm text-text-tertiary">
            Start your {TRIAL_DAYS}-day free trial with everything switched on. No card needed. Prices are before 18% GST.
          </p>
          <CycleToggle value={cycle} onChange={setCycle} className="mt-5" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => {
              const price = planPriceDisplay(plan, cycle);
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  aria-pressed={selectedPlan === plan.id}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selectedPlan === plan.id
                      ? "border-brand-500 bg-brand-50 shadow-sm ring-2 ring-brand-100"
                      : "border-border-light bg-surface-0 hover:border-border-medium"
                  }`}
                >
                  {plan.highlight && (
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-2xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      Most popular
                    </span>
                  )}
                  <div className="mt-3 text-xl font-semibold text-text-primary">
                    {plan.name}
                  </div>
                  <div className="text-sm text-text-tertiary">{plan.tagline}</div>
                  <div className="mt-4 text-3xl font-bold tracking-tight text-text-primary">
                    {price.amount}
                    {price.unit ? <span className="text-sm font-semibold text-text-tertiary"> {price.unit}</span> : null}
                  </div>
                  <div className="text-xs text-text-tertiary">
                    {price.gst}
                    {price.saving ? <span className="ml-1 font-semibold text-emerald-600">· {price.saving}</span> : null}
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-text-secondary">
                    {plan.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-2">
                        <Icon icon={CheckmarkCircle02Icon} size={16} className="mt-0.5 text-brand-600" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border-light bg-surface-0 p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary mb-3">
              Selected
            </div>
            <div className="text-2xl font-bold text-text-primary">
              {selectedLabel}
            </div>
            <div className="mt-4 rounded-xl border border-border-light bg-surface-1 p-4 text-sm text-text-secondary">
              <div className="font-semibold text-text-primary mb-1">
                {selectedLabel} includes:
              </div>
              <ul className="space-y-2">
                {(selectedOption?.features ?? []).map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
            </div>

            {keepsCurrentPlan ? (
              <p className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
                Your organization is on {currentPlanLabel}. Only the organization owner can change the plan.
              </p>
            ) : (
              <p className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
                {TRIAL_DAYS}-day free trial, then {selectedPrice?.amount}
                {selectedPrice?.unit} {selectedPrice?.gst}
                {selectedPrice?.saving ? ` (${selectedPrice.saving})` : ""}. You can change plan any time.
              </p>
            )}

            <button
              type="button"
              onClick={handleContinue}
              disabled={updatePlanMutation.isPending || sessionLoading || tenantListLoading}
              className="btn-primary mt-6 w-full py-3"
            >
              {updatePlanMutation.isPending
                ? "Saving plan…"
                : keepsCurrentPlan
                  ? "Continue"
                  : `Start ${TRIAL_DAYS}-day free trial`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
