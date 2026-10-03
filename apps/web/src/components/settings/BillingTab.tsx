/**
 * Settings → Billing (owner only): the organisation's plan and add-on
 * subscriptions, usage, billing details for GST invoices, and payment history
 * with invoice downloads. Changing or buying runs through billing.* — demo
 * checkout until Razorpay keys are configured, the Razorpay popup after.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { apiUrl } from "@/lib/api-url";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { DemoCheckout } from "@/components/billing/DemoCheckout";
import { GovUsageSection } from "@/components/settings/GovUsageSection";
import { BillingDetailsForm } from "@/components/settings/BillingDetailsForm";
import { Icon } from "@/components/ui/Icon";
import { Alert02Icon, CheckmarkCircle02Icon, Download04Icon } from "@hugeicons/core-free-icons";
import type { BillingCycle, PlanId } from "@fintranzact/shared";

const rupees = (paise: number) => formatCurrency(paise / 100);

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  past_due: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  halted: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-surface-2 text-text-tertiary",
};

export function BillingTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.billing.overview.useQuery();
  const { data: config } = trpc.billing.config.useQuery();
  const { data: access } = trpc.billing.status.useQuery();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [checkoutPlan, setCheckoutPlan] = useState<{ id: PlanId; name: string; monthlyPriceInr: number; features?: string[] } | null>(null);

  const refresh = () => {
    void utils.billing.status.invalidate();
    return utils.billing.overview.invalidate();
  };

  const changePlan = trpc.billing.changePlan.useMutation({
    onSuccess: async (res) => {
      if (res.checkout && config?.razorpayKeyId) {
        await openRazorpayCheckout({
          keyId: config.razorpayKeyId,
          providerSubscriptionId: res.checkout.providerSubscriptionId,
          onSuccess: (resp) =>
            verifyCheckout.mutate({
              subscriptionId: res.checkout!.subscriptionId,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            }),
        });
        return;
      }
      toast.success(res.applied === "now" ? "Plan changed" : "Change scheduled", res.applied === "now"
        ? "Your new plan is active. Unused time on the old plan was credited."
        : "You keep the current plan until the period ends, then move to the new one.");
      refresh();
    },
    onError: (e) => toast.error("Could not change the plan", e.message),
  });

  const subscribePlan = trpc.billing.subscribePlan.useMutation({
    onSuccess: async (res) => {
      if (res.status === "active") {
        toast.success("Plan active", "Welcome aboard — your plan is live.");
        refresh();
        return;
      }
      await openRazorpayCheckout({
        keyId: res.razorpayKeyId,
        providerSubscriptionId: res.providerSubscriptionId,
        onSuccess: (resp) =>
          verifyCheckout.mutate({
            subscriptionId: res.subscriptionId,
            razorpayPaymentId: resp.razorpay_payment_id,
            razorpaySignature: resp.razorpay_signature,
          }),
      });
    },
    onError: (e) => toast.error("Could not start the purchase", e.message),
  });

  const subscribeAddon = trpc.billing.subscribeAddon.useMutation({
    onSuccess: async (res) => {
      if (res.status === "active") {
        toast.success("Add-on active", "It is live on your account from now.");
        refresh();
        return;
      }
      await openRazorpayCheckout({
        keyId: res.razorpayKeyId,
        providerSubscriptionId: res.providerSubscriptionId,
        onSuccess: (resp) =>
          verifyCheckout.mutate({
            subscriptionId: res.subscriptionId,
            razorpayPaymentId: resp.razorpay_payment_id,
            razorpaySignature: resp.razorpay_signature,
          }),
      });
    },
    onError: (e) => toast.error("Could not start the purchase", e.message),
  });

  const verifyCheckout = trpc.billing.verifyCheckout.useMutation({
    onSuccess: () => {
      toast.success("Payment received", "Your subscription is active.");
      refresh();
    },
    onError: (e) => toast.error("Payment could not be verified", e.message),
  });

  const cancelSub = trpc.billing.cancelSubscription.useMutation({
    onSuccess: () => {
      toast.success("Cancelled", "It stays active until the end of what you have paid for.");
      refresh();
    },
    onError: (e) => toast.error("Could not cancel", e.message),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-40 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  const planSub = data.planSubscription;
  // A halted subscription is dead: the owner buys a plan again (subscribePlan),
  // they do not "switch" it. The same goes for any lapsed state without a live plan.
  const onPaidPlan = !!planSub && planSub.status !== "halted";
  const addonOf = (id: string) => data.addonSubscriptions.find((s) => s.addon === id);

  return (
    <div className="space-y-6">
      {/* ── Read-only / grace warnings ── */}
      {data.readOnly ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <Icon icon={Alert02Icon} size={18} />
          <p>
            <span className="font-semibold">Subscription on hold.</span> The last renewal could not be collected and the
            grace period is over. You can still view, search, download and export, but not create or edit. Choose a plan
            below to continue — your data is safe and nothing is deleted.
          </p>
        </div>
      ) : access?.state === "trialing" && access.trialDaysLeft !== null ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-600/[0.04] p-4 text-sm text-text-primary">
          <Icon icon={Alert02Icon} size={18} />
          <p>
            <span className="font-semibold">Free trial.</span>{" "}
            {access.trialDaysLeft <= 0 ? "Your trial ends today." : `${access.trialDaysLeft} day${access.trialDaysLeft === 1 ? "" : "s"} left.`}{" "}
            Choose a plan below to keep creating and editing after it ends.
          </p>
        </div>
      ) : planSub?.status === "past_due" ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <Icon icon={Alert02Icon} size={18} />
          <p>
            <span className="font-semibold">Renewal payment failed.</span> We will keep retrying until{" "}
            {formatDate(planSub.graceUntil)}; after that the account goes read-only. Check the card or UPI mandate with
            your bank.
          </p>
        </div>
      ) : null}

      {/* ── Current plan ── */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Current plan</h3>
            <p className="mt-2 font-display text-2xl font-extrabold text-text-primary">{data.plan.name}</p>
            {planSub ? (
              <p className="mt-1 text-sm text-text-tertiary">
                {rupees(planSub.basePaise)} / {planSub.cycle === "yearly" ? "year" : "month"} + GST
                {planSub.cancelAtPeriodEnd
                  ? ` · ends ${formatDate(planSub.currentPeriodEnd)}`
                  : planSub.scheduledPlan
                    ? ` · moves to ${planSub.scheduledPlan} on ${formatDate(planSub.currentPeriodEnd)}`
                    : ` · renews ${formatDate(planSub.currentPeriodEnd)}`}
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-tertiary">
                {data.plan.monthlyPriceInr === 0 || data.plan.monthlyPriceInr === null
                  ? "No paid subscription — pick a plan below to subscribe."
                  : "Set up by the Fintranzact team."}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {planSub ? (
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLES[planSub.status] ?? "bg-surface-2 text-text-secondary")}>
                {planSub.statusLabel}
              </span>
            ) : null}
            {planSub && !planSub.cancelAtPeriodEnd ? (
              <button
                type="button"
                className="btn-ghost text-sm text-red-600"
                disabled={cancelSub.isPending}
                onClick={() => {
                  if (window.confirm("Cancel the plan subscription? It stays active until the end of the paid period, and your data is never deleted.")) {
                    cancelSub.mutate({ subscriptionId: planSub.id });
                  }
                }}
              >
                Cancel plan
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Change plan ── */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-text-primary">{onPaidPlan ? "Change plan" : "Choose a plan"}</h3>
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
            {(["monthly", "yearly"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                className={cn("rounded-md px-3 py-1.5 transition-colors", cycle === c ? "bg-surface-0 text-text-primary shadow-sm" : "text-text-tertiary")}
              >
                {c === "monthly" ? "Monthly" : "Yearly · 2 months free"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.plans.map((p) => {
            const isCurrent = planSub ? onPaidPlan && planSub.plan === p.id && planSub.cycle === cycle : data.plan.id === p.id;
            const amount = cycle === "yearly" ? p.yearly : p.monthly;
            return (
              <div key={p.id} className={cn("flex flex-col rounded-xl border p-4", isCurrent ? "border-brand-400 bg-brand-600/[0.04]" : "border-border-light")}>
                <p className="font-semibold text-text-primary">{p.name}</p>
                <p className="text-xs text-text-tertiary">{p.tagline}</p>
                <p className="mt-2 font-display text-xl font-extrabold text-text-primary">
                  {rupees(amount.basePaise)}
                  <span className="text-xs font-normal text-text-tertiary">/{cycle === "yearly" ? "yr" : "mo"} + GST</span>
                </p>
                <div className="mt-3 flex-1" />
                {isCurrent ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                    <Icon icon={CheckmarkCircle02Icon} size={16} /> Current plan
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={changePlan.isPending || subscribePlan.isPending || subscribeAddon.isPending}
                    onClick={() => {
                      if (!onPaidPlan) {
                        // First purchase: our own checkout UI in demo mode,
                        // the Razorpay popup once keys are configured.
                        if (config?.provider === "demo") {
                          setCheckoutPlan({ id: p.id as PlanId, name: p.name, monthlyPriceInr: p.monthlyPriceInr, features: p.features });
                        } else {
                          subscribePlan.mutate({ plan: p.id as PlanId, cycle });
                        }
                        return;
                      }
                      changePlan.mutate({ plan: p.id as PlanId, cycle });
                    }}
                  >
                    {onPaidPlan ? "Switch to " + p.name : "Subscribe"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {onPaidPlan ? (
          <p className="mt-3 text-xs text-text-tertiary">
            Upgrades apply immediately — unused time on the old plan is credited. Downgrades apply at the end of the paid period.
          </p>
        ) : null}
      </section>

      {/* ── Add-ons ── */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold text-text-primary">Add-ons</h3>
        <p className="mt-1 text-xs text-text-tertiary">Work with any paid plan and are billed with it.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.addons.map((a) => {
            const sub = addonOf(a.id);
            const amount = cycle === "yearly" ? a.yearly : a.monthly;
            return (
              <div key={a.id} className="flex flex-col rounded-xl border border-border-light p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-text-primary">{a.name}</p>
                    <p className="text-xs text-text-tertiary">{a.tagline}</p>
                  </div>
                  {sub ? (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLES[sub.status] ?? "bg-surface-2 text-text-secondary")}>
                      {sub.statusLabel}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-text-primary">
                  {rupees(amount.basePaise)}
                  <span className="text-xs font-normal text-text-tertiary">/{cycle === "yearly" ? "yr" : "mo"} + GST</span>
                </p>
                <div className="mt-3 flex-1" />
                {sub ? (
                  <div className="flex items-center justify-between text-xs text-text-tertiary">
                    <span>{sub.cancelAtPeriodEnd ? `Ends ${formatDate(sub.currentPeriodEnd)}` : `Renews ${formatDate(sub.currentPeriodEnd)}`}</span>
                    {!sub.cancelAtPeriodEnd ? (
                      <button
                        type="button"
                        className="font-semibold text-red-600 hover:underline"
                        disabled={cancelSub.isPending}
                        onClick={() => {
                          if (window.confirm(`Cancel ${a.name}? It stays active until the end of the paid period.`)) {
                            cancelSub.mutate({ subscriptionId: sub.id });
                          }
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={subscribeAddon.isPending || !onPaidPlan}
                    title={onPaidPlan ? undefined : "Subscribe to a plan first"}
                    onClick={() => subscribeAddon.mutate({ addon: a.id, cycle })}
                  >
                    Add {a.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Usage ── */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold text-text-primary">Usage this month</h3>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label: "Invoices", value: String(data.usage.invoicesThisMonth) },
            { label: "AI questions", value: data.usage.aiQuestions === null ? "—" : String(data.usage.aiQuestions) },
            { label: "Payroll employees", value: data.usage.payrollEmployees === null ? "—" : String(data.usage.payrollEmployees) },
          ].map((u) => (
            <div key={u.label} className="rounded-xl bg-surface-1 p-3">
              <p className="text-xs text-text-tertiary">{u.label}</p>
              <p className="mt-1 font-display text-xl font-extrabold tabular-nums text-text-primary">{u.value}</p>
            </div>
          ))}
        </div>
      </section>

      <BillingDetailsForm
        initial={data.billingDetails}
        onSaved={refresh}
      />

      <GovUsageSection />

      {/* ── Payment history ── */}
      <section className="card overflow-hidden p-0">
        <h3 className="border-b border-border-light px-5 py-4 text-sm font-semibold text-text-primary">Invoices & payments</h3>
        {data.payments.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-tertiary">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-5 py-2.5">Invoice</th>
                  <th className="px-5 py-2.5">Description</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-text-secondary">{formatDate(p.createdAt)}</td>
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-text-primary">{p.invoiceNumber ?? "—"}</td>
                    <td className="px-5 py-3 text-text-secondary">
                      {p.description}
                      {p.status === "failed" ? (
                        <p className="text-xs text-red-600">{p.failureReason ?? "Payment failed"}</p>
                      ) : null}
                      {p.status === "due" ? (
                        <p className="text-xs font-medium text-amber-600">Payment due</p>
                      ) : null}
                    </td>
                    <td className={cn("whitespace-nowrap px-5 py-3 text-right tabular-nums", p.status === "failed" ? "text-text-tertiary line-through" : p.totalPaise < 0 ? "text-emerald-600" : "text-text-primary")}>
                      {p.totalPaise < 0 ? "−" : ""}{rupees(Math.abs(p.totalPaise))}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {p.invoiceNumber ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
                          onClick={() => downloadInvoice(p.id, p.invoiceNumber!)}
                        >
                          <Icon icon={Download04Icon} size={15} /> PDF
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Demo checkout for the first plan purchase without a gateway. */}
      {checkoutPlan ? (
        <DemoCheckout
          open
          plan={checkoutPlan}
          cycle={cycle}
          onClose={() => setCheckoutPlan(null)}
          onContinue={() => {
            setCheckoutPlan(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

async function downloadInvoice(paymentId: string, invoiceNumber: string) {
  try {
    const res = await fetch(apiUrl(`/api/billing/invoices/${paymentId}/pdf`), { credentials: "include" });
    if (!res.ok) throw new Error("Failed to download the invoice");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNumber}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.error("Could not download the invoice", "Try again in a moment.");
  }
}
