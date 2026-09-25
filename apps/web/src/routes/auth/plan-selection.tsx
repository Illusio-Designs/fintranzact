import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/auth/plan-selection")({
    component: PlanSelectionPage,
});

type PlanId = "forever_free" | "free" | "pro" | "business" | "enterprise";

const PLAN_OPTIONS: Array<{
    id: PlanId;
    name: string;
    tagline: string;
    price: string;
    features: string[];
    highlight?: boolean;
}> = [
        {
            id: "forever_free",
            name: "Forever Free",
            tagline: "Unlimited for life",
            price: "₹0",
            features: [
                "Unlimited invoices, parties, and payments",
                "Unlimited businesses and team members",
                "Unlimited API access",
                "No branding or paywall",
            ],
            highlight: true,
        },
        {
            id: "pro",
            name: "Pro",
            tagline: "Best for growing teams",
            price: "Custom",
            features: [
                "Advanced automation and workflows",
                "Priority support",
                "Expanded collaboration",
            ],
        },
        {
            id: "business",
            name: "Business",
            tagline: "Scale without limits",
            price: "Custom",
            features: [
                "Multi-tenant controls",
                "Premium reporting",
                "Dedicated onboarding",
            ],
        },
    ];

function PlanSelectionPage() {
    const navigate = useNavigate();
    const utils = trpc.useUtils();
    const [selectedPlan, setSelectedPlan] = useState<PlanId>("forever_free");

    const selectedLabel = useMemo(() =>
        PLAN_OPTIONS.find((plan) => plan.id === selectedPlan)?.name ?? "Forever Free",
        [selectedPlan],
    );

    const updatePlanMutation = trpc.tenant.updatePlan.useMutation({
        onSuccess: async () => {
            const tenantId = window.sessionStorage.getItem("selectedTenantId") ?? "";
            if (tenantId) {
                window.localStorage.setItem(`hisaabo_plan_done_${tenantId}`, "1");
            }
            window.sessionStorage.setItem("planSelectionDone", "1");
            await utils.auth.me.refetch();
            await utils.tenant.list.refetch();
            navigate({ to: "/" });
        },
    });

    function handleContinue() {
        updatePlanMutation.mutate({ plan: selectedPlan });
    }

    return (
        <div className="min-h-screen bg-surface-1 px-4 py-10 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl">
                <div className="mb-8 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-600">Choose your plan</p>
                    <h1 className="mt-3 text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
                        Select the plan that fits your business
                    </h1>
                    <p className="mt-3 text-sm text-text-tertiary">
                        Start with the unlimited forever-free plan, or choose a paid tier when you need more advanced controls.
                    </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                    <div className="grid gap-4 md:grid-cols-3">
                        {PLAN_OPTIONS.map((plan) => (
                            <button
                                key={plan.id}
                                type="button"
                                onClick={() => setSelectedPlan(plan.id)}
                                className={`rounded-2xl border p-4 text-left transition-all ${selectedPlan === plan.id
                                    ? "border-brand-500 bg-brand-50 shadow-sm ring-2 ring-brand-100"
                                    : "border-border-light bg-surface-0 hover:border-border-medium"
                                    }`}
                            >
                                {plan.highlight && (
                                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                                        Recommended
                                    </span>
                                )}
                                <div className="mt-3 text-xl font-semibold text-text-primary">{plan.name}</div>
                                <div className="text-sm text-text-tertiary">{plan.tagline}</div>
                                <div className="mt-4 text-3xl font-bold tracking-tight text-text-primary">{plan.price}</div>
                                <div className="mt-4 space-y-2 text-sm text-text-secondary">
                                    {plan.features.map((feature) => (
                                        <div key={feature} className="flex items-start gap-2">
                                            <span className="mt-1 text-brand-600">✓</span>
                                            <span>{feature}</span>
                                        </div>
                                    ))}
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="rounded-2xl border border-border-light bg-surface-0 p-5 shadow-sm">
                        <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary mb-3">Selected</div>
                        <div className="text-2xl font-bold text-text-primary">{selectedLabel}</div>
                        <div className="mt-4 rounded-xl border border-border-light bg-surface-1 p-4 text-sm text-text-secondary">
                            {selectedPlan === "forever_free" ? (
                                <>
                                    <div className="font-semibold text-text-primary mb-1">Forever Free includes:</div>
                                    <ul className="space-y-2">
                                        <li>• Unlimited businesses, teams, and invoices</li>
                                        <li>• Full invoice and accounting features</li>
                                        <li>• Unlimited API and integrations</li>
                                    </ul>
                                </>
                            ) : (
                                <>
                                    <div className="font-semibold text-text-primary mb-1">This plan is best for scaling teams.</div>
                                    <p>Upgrade later after your business grows and needs extra automation or premium controls.</p>
                                </>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={handleContinue}
                            disabled={updatePlanMutation.isPending}
                            className="btn-primary mt-6 w-full py-3"
                        >
                            {updatePlanMutation.isPending ? "Saving plan..." : "Continue to dashboard"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
