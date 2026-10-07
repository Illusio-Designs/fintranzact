/**
 * Settings → Billing → AI Assistant (owner only): the AI tier in force, the questions used this
 * month, the extra questions left and when the month resets, subscribe / switch / cancel, and
 * a quantity stepper to buy extra packs.
 *
 * Purchase controls show ONLY while an AI add-on is on sale (isAddonAvailable, the shared release
 * flag); until then the section appears only for an organisation that already holds the add-on
 * (an admin grant), with a "coming soon" note and no buy buttons. The server refuses every
 * purchase while the add-on is not on sale, whatever this screen shows.
 */
import { useState } from "react";
import type { RouterOutputs } from "@fintranzact/api";
import { AI_PACK_MAX_PER_ORDER, AI_PACK_QUESTIONS, aiPackAmount, isAddonAvailable, type BillingCycle } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { aiCanBuy } from "@/components/ai/AiGate";

type Overview = RouterOutputs["billing"]["overview"];
type Config = RouterOutputs["billing"]["config"] | undefined;

const rupees = (paise: number) => formatCurrency(paise / 100);

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  past_due: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  halted: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const TIER_LABEL: Record<string, string> = { assistant: "AI Assistant", plus: "AI Plus", trial: "Full Access Trial" };

export function AiBillingSection({
  data,
  config,
  cycle,
  onPaidPlan,
  refresh,
}: {
  data: Overview;
  config: Config;
  cycle: BillingCycle;
  /** Add-ons are bought with a paid plan (the Billing tab's existing rule). */
  onPaidPlan: boolean;
  refresh: () => void | Promise<unknown>;
}) {
  const aiAddons = data.addons.filter((a) => a.group === "ai");
  const subOf = (id: string) => data.addonSubscriptions.find((s) => s.addon === id);
  const held = subOf("ai_plus") ?? subOf("ai_assistant") ?? null;
  const onSale = aiCanBuy();
  const [packs, setPacks] = useState(1);

  const verifyCheckout = trpc.billing.verifyCheckout.useMutation({
    onSuccess: () => {
      toast.success("Payment received", "Your AI plan is active.");
      void refresh();
    },
    onError: (e) => toast.error("Payment could not be verified", e.message),
  });
  const verifyPack = trpc.billing.verifyAiPackPayment.useMutation({
    onSuccess: (r) => {
      toast.success("Payment received", `${r.credits} extra questions were added.`);
      void refresh();
    },
    onError: (e) => toast.error("Payment could not be verified", e.message),
  });

  type SubCheckout = { subscriptionId: string; providerSubscriptionId: string };
  const openSubscriptionCheckout = async (c: SubCheckout) => {
    if (!config?.razorpayKeyId) return;
    await openRazorpayCheckout({
      keyId: config.razorpayKeyId,
      providerSubscriptionId: c.providerSubscriptionId,
      onSuccess: (resp) =>
        verifyCheckout.mutate({ subscriptionId: c.subscriptionId, razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature }),
    });
  };

  const subscribe = trpc.billing.subscribeAddon.useMutation({
    onSuccess: async (res) => {
      if (res.status === "active") {
        toast.success("AI plan active", "It is live on your account from now.");
        void refresh();
        return;
      }
      await openSubscriptionCheckout(res);
    },
    onError: (e) => toast.error("Could not start the purchase", e.message),
  });
  const change = trpc.billing.changeAddon.useMutation({
    onSuccess: async (res) => {
      if (res.checkout) {
        await openSubscriptionCheckout(res.checkout);
        return;
      }
      toast.success(
        res.applied === "now" ? "AI plan changed" : "Change scheduled",
        res.applied === "now" ? "Your new AI plan is active. Unused time on the old one was credited." : "You keep the current AI plan until the period ends, then move to the new one.",
      );
      void refresh();
    },
    onError: (e) => toast.error("Could not change the AI plan", e.message),
  });
  const cancel = trpc.billing.cancelSubscription.useMutation({
    onSuccess: () => {
      toast.success("Cancelled", "It stays active until the end of what you have paid for.");
      void refresh();
    },
    onError: (e) => toast.error("Could not cancel", e.message),
  });
  const buyPack = trpc.billing.buyAiPack.useMutation({
    onSuccess: async (res) => {
      if (res.status === "paid") {
        toast.success("Questions added", `${res.credits} extra questions are ready to use.`);
        void refresh();
        return;
      }
      if (!res.razorpayKeyId) return;
      await openRazorpayCheckout({
        keyId: res.razorpayKeyId,
        orderId: res.providerOrderId,
        onSuccess: (resp) =>
          verifyPack.mutate({ orderId: res.orderId, razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature }),
      });
    },
    onError: (e) => toast.error("Could not start the purchase", e.message),
  });

  // Hidden until the add-on is on sale, unless the organisation already holds it.
  if (!onSale && !held) return null;

  const busy = subscribe.isPending || change.isPending || cancel.isPending || buyPack.isPending || verifyPack.isPending || verifyCheckout.isPending;
  const allowance = data.ai.allowance;
  const packAmount = aiPackAmount(Math.min(Math.max(packs, 1), AI_PACK_MAX_PER_ORDER), data.ai.pack.priceInr);
  const clampPacks = (n: number) => setPacks(Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), AI_PACK_MAX_PER_ORDER) : 1);
  const grantedByUs = held?.provider === "admin";

  return (
    <section className="card p-5" data-testid="ai-billing-section" aria-labelledby="ai-billing-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ai-billing-title" className="text-sm font-semibold text-text-primary">AI Assistant</h3>
          <p className="mt-1 text-xs text-text-tertiary">Ask Fintranzact AI about your business. Billed with your plan; prices exclude GST.</p>
        </div>
        {held ? (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLES[held.status] ?? "bg-surface-2 text-text-secondary")} data-testid="ai-sub-status">
            {held.statusLabel}
          </span>
        ) : null}
      </div>

      {/* Where the allowance stands */}
      <div className="mt-4 rounded-xl bg-surface-1 p-4" data-testid="ai-allowance">
        {allowance ? (
          <>
            <p className="font-display text-lg font-extrabold text-text-primary">{TIER_LABEL[allowance.tier] ?? allowance.tier}</p>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-tertiary">{allowance.scope === "trial" ? "Questions used in your trial" : "Questions used this month"}</dt>
                <dd className="font-semibold tabular-nums text-text-primary" data-testid="ai-used">{allowance.used} of {allowance.limit}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">Extra questions left</dt>
                <dd className="font-semibold tabular-nums text-text-primary" data-testid="ai-credits">{allowance.creditsRemaining}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-tertiary">{allowance.resetsAt ? "Next reset" : "Trial allowance"}</dt>
                <dd className="font-semibold text-text-primary" data-testid="ai-reset">{allowance.resetsAt ? formatDate(allowance.resetsAt) : "Does not reset"}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="text-sm text-text-secondary">
            {held
              ? held.status === "halted"
                ? "Your AI plan is on hold because the last payment could not be collected. Your chats are safe and your extra questions are kept; the assistant is paused until the AI plan is paid again."
                : "Your AI plan is not active right now."
              : "You do not have an AI plan yet."}
            {data.ai.creditsRemaining > 0 ? ` You have ${data.ai.creditsRemaining} extra questions waiting.` : ""}
          </p>
        )}
        {held ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
            <span>
              {grantedByUs
                ? "Provided by the Fintranzact team."
                : held.cancelAtPeriodEnd
                  ? `Ends ${formatDate(held.currentPeriodEnd)}`
                  : held.scheduledAddon
                    ? `Moves to ${aiAddons.find((a) => a.id === held.scheduledAddon)?.name ?? "another tier"} on ${formatDate(held.currentPeriodEnd)}`
                    : `Renews ${formatDate(held.currentPeriodEnd)}`}
            </span>
            {!grantedByUs && !held.cancelAtPeriodEnd ? (
              <button
                type="button"
                className="font-semibold text-red-600 hover:underline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Cancel your AI plan? It stays active until the end of the paid period, and your chats are never deleted.")) {
                    cancel.mutate({ subscriptionId: held.id });
                  }
                }}
              >
                Cancel AI plan
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* Tiers: buy or switch. Only while an AI add-on is on sale. */}
      {onSale ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="ai-tiers">
          {aiAddons.filter((a) => isAddonAvailable(a.id)).map((a) => {
            const amount = cycle === "yearly" ? a.yearly : a.monthly;
            const isCurrent = held?.addon === a.id && held.cycle === cycle;
            const isHeld = held?.addon === a.id;
            return (
              <div key={a.id} className={cn("flex flex-col rounded-xl border p-4", isHeld ? "border-brand-400 bg-brand-600/[0.04]" : "border-border-light")}>
                <p className="font-semibold text-text-primary">{a.name}</p>
                <p className="text-xs text-text-tertiary">{a.tagline}</p>
                <p className="mt-2 text-sm font-semibold text-text-primary">
                  {rupees(amount.basePaise)}
                  <span className="text-xs font-normal text-text-tertiary">/{cycle === "yearly" ? "yr" : "mo"} + GST</span>
                </p>
                <div className="mt-3 flex-1" />
                {isCurrent ? (
                  <span className="text-sm font-semibold text-brand-600">Your AI plan</span>
                ) : held ? (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={busy || grantedByUs || held.status === "halted" || held.cancelAtPeriodEnd}
                    onClick={() => change.mutate({ addon: a.id, cycle })}
                  >
                    {isHeld ? `Switch to ${cycle === "yearly" ? "yearly" : "monthly"} billing` : a.id === "ai_plus" ? `Upgrade to ${a.name}` : `Switch to ${a.name}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={busy || !onPaidPlan}
                    title={onPaidPlan ? undefined : "Subscribe to a plan first"}
                    onClick={() => subscribe.mutate({ addon: a.id, cycle })}
                  >
                    Add {a.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-xs text-text-tertiary" data-testid="ai-coming-soon">AI plans and extra questions are coming soon and cannot be bought yet.</p>
      )}
      {onSale && held && !grantedByUs ? (
        <p className="mt-2 text-xs text-text-tertiary">Upgrading applies now, with the unused time on your old AI plan credited. Switching down applies at the end of the paid period. You are never billed for both.</p>
      ) : null}

      {/* Extra packs: a one-time purchase */}
      {onSale ? (
        <div className="mt-5 border-t border-border-light pt-4" data-testid="ai-packs">
          <h4 className="text-sm font-semibold text-text-primary">Extra questions</h4>
          <p className="mt-1 text-xs text-text-tertiary">
            {rupees(data.ai.pack.priceInr * 100)} + GST per pack of {AI_PACK_QUESTIONS} questions. One-time payment; they do not expire and are used after your monthly questions.
          </p>
          {allowance ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center rounded-lg border border-border-light" role="group" aria-label="Number of packs">
                <button type="button" className="px-3 py-1.5 text-lg leading-none text-text-secondary disabled:opacity-40" aria-label="Fewer packs" disabled={packs <= 1 || busy} onClick={() => clampPacks(packs - 1)}>−</button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={AI_PACK_MAX_PER_ORDER}
                  value={packs}
                  aria-label="Packs"
                  onChange={(e) => clampPacks(Number(e.target.value))}
                  className="w-14 border-x border-border-light bg-transparent py-1.5 text-center text-sm tabular-nums text-text-primary outline-none"
                />
                <button type="button" className="px-3 py-1.5 text-lg leading-none text-text-secondary disabled:opacity-40" aria-label="More packs" disabled={packs >= AI_PACK_MAX_PER_ORDER || busy} onClick={() => clampPacks(packs + 1)}>+</button>
              </div>
              <p className="text-sm text-text-secondary" data-testid="ai-pack-total">
                {packAmount.credits} questions · {rupees(packAmount.basePaise)} + {rupees(packAmount.gstPaise)} GST = <span className="font-semibold text-text-primary">{rupees(packAmount.totalPaise)}</span>
              </p>
              <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => buyPack.mutate({ packs: packAmount.packs })}>
                Buy {packAmount.packs} pack{packAmount.packs === 1 ? "" : "s"}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-text-tertiary" data-testid="ai-packs-need-plan">Add an AI plan above to buy extra questions.</p>
          )}
        </div>
      ) : null}

      {data.ai.purchases.length > 0 ? (
        <div className="mt-5 border-t border-border-light pt-4" data-testid="ai-purchases">
          <h4 className="text-sm font-semibold text-text-primary">Extra question purchases</h4>
          <ul className="mt-2 divide-y divide-border-light text-sm">
            {data.ai.purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-text-secondary">
                  {formatDate(p.createdAt)} · {p.packs} pack{p.packs === 1 ? "" : "s"} ({p.credits} questions)
                </span>
                <span className="text-text-tertiary">
                  {p.status === "paid" ? `${rupees(p.totalPaise)} · ${p.invoiceNumber ?? ""}` : p.status === "refunded" ? "Refunded" : p.status === "failed" ? "Payment failed" : "Awaiting payment"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
