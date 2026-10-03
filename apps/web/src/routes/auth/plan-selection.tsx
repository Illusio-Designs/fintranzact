import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePlans, type PlanId } from "@/lib/plans";
import { planSelectionMode } from "@/lib/plan-selection";
import { DemoCheckout } from "@/components/billing/DemoCheckout";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { toast } from "@/hooks/useToast";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
export const Route = createFileRoute("/auth/plan-selection")({
  component: PlanSelectionPage,
});

function PlanSelectionPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("growth");
  const { plans } = usePlans();

  const selectedLabel = useMemo(
    () =>
      plans.find((plan) => plan.id === selectedPlan)?.name ??
      "Forever Free",
    [plans, selectedPlan],
  );

  // DB is the source of truth: refresh tenant data so __root.tsx sees the
  // saved plan. A new owner has no company yet, so the next page is where they
  // create it; an organisation that already has one goes to its dashboard.
  async function goOn() {
    await utils.auth.me.refetch();
    await utils.tenant.list.refetch();
    const businesses = await utils.business.list.fetch();
    navigate({ to: businesses.length === 0 ? "/onboarding" : "/" });
  }

  const updatePlanMutation = trpc.tenant.updatePlan.useMutation({ onSuccess: goOn });

  // Owners choose a free plan themselves. A paid plan with a listed price is
  // paid for online — through Razorpay once its keys are configured, or the
  // demo checkout before that; otherwise paid plans are set up by the
  // Fintranzact team and the owner starts free.
  const selectedOption = plans.find((plan) => plan.id === selectedPlan);
  const selectedIsFree = false; // no free plan exists
  const { data: billingConfig } = trpc.billing.config.useQuery(undefined, { staleTime: 5 * 60_000 });
  const selectedPrice = selectedOption?.monthlyPriceInr ?? null;
  const paymentsOn = !!billingConfig?.demoPayments || billingConfig?.provider === "razorpay";
  const canPayOnline = !selectedIsFree && paymentsOn && selectedPrice !== null && selectedPrice > 0;
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Razorpay flow: create the subscription, open the Razorpay popup, then
  // verify the signature server-side; only then is the plan active.
  const verifyCheckout = trpc.billing.verifyCheckout.useMutation({
    onSuccess: goOn,
    onError: (e) => toast.error("Payment could not be verified", e.message),
  });
  const subscribePlan = trpc.billing.subscribePlan.useMutation({
    onSuccess: async (res) => {
      if (res.status === "active") {
        await goOn();
        return;
      }
      await openRazorpayCheckout({
        keyId: res.razorpayKeyId,
        providerSubscriptionId: res.providerSubscriptionId,
        name: selectedOption?.name,
        email: session?.user?.email ?? undefined,
        onSuccess: (resp) =>
          verifyCheckout.mutate({
            subscriptionId: res.subscriptionId,
            razorpayPaymentId: resp.razorpay_payment_id,
            razorpaySignature: resp.razorpay_signature,
          }),
      });
    },
    onError: (e) => toast.error("Could not start the payment", e.message),
  });

  // Only the owner changes the plan, and an organisation already on a paid
  // plan keeps it — picking here must never reset it to Forever Free.
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();
  const { data: tenantList, isLoading: tenantListLoading } = trpc.tenant.list.useQuery();
  const currentTenant = tenantList?.find((tenant) => tenant.tenantId === session?.tenantId);
  const mode = planSelectionMode(currentTenant);
  const keepsCurrentPlan = mode !== "choose";
  const currentPlanLabel = currentTenant
    ? (plans.find((plan) => plan.id === currentTenant.tenantPlan)?.name ?? currentTenant.tenantPlan)
    : null;

  function handleContinue() {
    if (keepsCurrentPlan) {
      navigate({ to: "/" });
      return;
    }
    if (canPayOnline) {
      if (billingConfig?.provider === "razorpay") {
        // Plans carry a monthly price only, so there is no yearly choice yet.
        subscribePlan.mutate({ plan: selectedPlan, cycle: "monthly" });
      } else {
        setCheckoutOpen(true);
      }
      return;
    }
    updatePlanMutation.mutate({ plan: selectedPlan });
  }

  const paying = subscribePlan.isPending || verifyCheckout.isPending;

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
            Start with the unlimited forever-free plan, or choose a paid tier
            when you need more advanced controls.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlan(plan.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedPlan === plan.id
                    ? "border-brand-500 bg-brand-50 shadow-sm ring-2 ring-brand-100"
                    : "border-border-light bg-surface-0 hover:border-border-medium"
                }`}
              >
                {plan.highlight && (
                  <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-2xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                    Recommended
                  </span>
                )}
                <div className="mt-3 text-xl font-semibold text-text-primary">
                  {plan.name}
                </div>
                <div className="text-sm text-text-tertiary">{plan.tagline}</div>
                <div className="mt-4 text-3xl font-bold tracking-tight text-text-primary">
                  {plan.price}
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
            ))}
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
                {(plans.find((plan) => plan.id === selectedPlan)?.features ?? []).map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
            </div>

            {keepsCurrentPlan ? (
              <p className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
                {mode === "managed"
                  ? `Your organization is on ${currentPlanLabel}, set up by the Fintranzact team. Contact us to change it.`
                  : `Your organization is on ${currentPlanLabel}. Only the organization owner can change the plan.`}
              </p>
            ) : canPayOnline ? (
              <p className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
                {selectedOption!.price} a month + GST, paid now. Then you'll create your company.
              </p>
            ) : !selectedIsFree && (
              <p className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
                {selectedLabel} is set up by the Fintranzact team. You'll start on Forever Free, and we'll switch you
                to {selectedLabel} once it's arranged.
              </p>
            )}

            <button
              type="button"
              onClick={handleContinue}
              disabled={updatePlanMutation.isPending || paying || sessionLoading || tenantListLoading}
              className="btn-primary mt-6 w-full py-3"
            >
              {updatePlanMutation.isPending
                ? "Saving plan…"
                : paying
                  ? "Opening payment…"
                  : keepsCurrentPlan
                    ? "Continue"
                    : selectedIsFree
                      ? "Create your company"
                      : canPayOnline
                        ? "Continue to payment"
                        : "Start free and create your company"}
            </button>
          </div>
        </div>
      </div>

      {canPayOnline && selectedOption && (
        <DemoCheckout
          open={checkoutOpen}
          plan={{ id: selectedOption.id, name: selectedOption.name, monthlyPriceInr: selectedPrice!, features: selectedOption.features }}
          // Plans carry a monthly price only, so there is no yearly choice yet.
          cycle="monthly"
          onClose={() => setCheckoutOpen(false)}
          onContinue={goOn}
        />
      )}
    </div>
  );
}
