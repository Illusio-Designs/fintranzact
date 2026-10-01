/**
 * DemoCheckout — pay for a plan in a Razorpay-style checkout, in test mode.
 *
 * The form checks UPI IDs, card numbers (Luhn), expiry and CVV the way a real
 * checkout does, then billing.demoCheckout switches the organisation to the
 * plan. No payment gateway is called and no money is taken; card and UPI
 * details never leave the browser. Real Razorpay replaces the API call later.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { planCheckoutAmount, PLAN_GST_RATE_PERCENT, type BillingCycle, type PlanId } from "@fintranzact/shared";
import { BankIcon, CheckmarkCircle02Icon, CreditCardIcon, QrCodeIcon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { cn, formatCurrency } from "@/lib/utils";
import {
  cvvValid,
  DEMO_TEST_CARD,
  expiryValid,
  formatCardNumber,
  formatExpiry,
  luhnValid,
  NETBANKING_BANKS,
  upiIdValid,
} from "@/lib/demo-payment";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";

export type DemoPaymentMethod = "upi" | "card" | "netbanking";

export interface DemoCheckoutPlan {
  id: PlanId;
  name: string;
  /** Monthly price in rupees (a paid plan with a listed price). */
  monthlyPriceInr: number;
}

interface DemoCheckoutProps {
  open: boolean;
  plan: DemoCheckoutPlan;
  cycle: BillingCycle;
  onClose: () => void;
  /** After a successful payment: "Continue to set up your business". */
  onContinue: () => void | Promise<void>;
  /** How long "Processing…" shows before the payment is made (tests pass 0). */
  processingDelayMs?: number;
}

const METHODS: Array<{ id: DemoPaymentMethod; label: string; icon: typeof BankIcon }> = [
  { id: "upi", label: "UPI", icon: QrCodeIcon },
  { id: "card", label: "Card", icon: CreditCardIcon },
  { id: "netbanking", label: "Netbanking", icon: BankIcon },
];

const rupees = (paise: number) => formatCurrency(paise / 100);

export function DemoCheckout({ open, plan, cycle, onClose, onContinue, processingDelayMs = 1200 }: DemoCheckoutProps) {
  const ids = useId();
  const amount = useMemo(() => planCheckoutAmount(plan.monthlyPriceInr, cycle), [plan.monthlyPriceInr, cycle]);

  const [method, setMethod] = useState<DemoPaymentMethod>("upi");
  const [upiId, setUpiId] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [bank, setBank] = useState<string>("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [stage, setStage] = useState<"form" | "processing" | "success">("form");
  const [error, setError] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const tabRefs = useRef<Record<DemoPaymentMethod, HTMLButtonElement | null>>({ upi: null, card: null, netbanking: null });

  const checkout = trpc.billing.demoCheckout.useMutation();

  const fieldErrors = {
    upiId: upiIdValid(upiId) ? null : "Enter a UPI ID like name@bank",
    cardNumber: luhnValid(cardNumber) ? null : "Enter a valid card number",
    expiry: expiryValid(expiry) ? null : "Enter a valid expiry date (MM/YY) that has not passed",
    cvv: cvvValid(cvv) ? null : "Enter the 3-digit CVV",
    cardName: cardName.trim() ? null : "Enter the name on the card",
    bank: bank ? null : "Choose your bank",
  };
  const valid =
    method === "upi"
      ? !fieldErrors.upiId
      : method === "card"
        ? !fieldErrors.cardNumber && !fieldErrors.expiry && !fieldErrors.cvv && !fieldErrors.cardName
        : !fieldErrors.bank;

  const showError = (field: keyof typeof fieldErrors) => (touched[field] ? fieldErrors[field] : null);
  const touch = (field: keyof typeof fieldErrors) => setTouched((t) => ({ ...t, [field]: true }));

  async function pay() {
    if (!valid || stage !== "form") return;
    setError(null);
    setStage("processing");
    await new Promise((resolve) => setTimeout(resolve, processingDelayMs));
    try {
      const result = await checkout.mutateAsync({ plan: plan.id, cycle, method });
      setPaymentId(result.paymentId);
      setStage("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment could not be completed. Please try again.");
      setStage("form");
    }
  }

  async function handleContinue() {
    setContinuing(true);
    try {
      await onContinue();
    } finally {
      setContinuing(false);
    }
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = METHODS[(index + (e.key === "ArrowRight" ? 1 : METHODS.length - 1)) % METHODS.length]!;
    setMethod(next.id);
    tabRefs.current[next.id]?.focus();
  }

  const cycleLabel = cycle === "yearly" ? "Yearly" : "Monthly";
  const fieldId = (name: string) => `${ids}-${name}`;

  return (
    <Modal
      open={open}
      // A payment in flight cannot be abandoned half-way.
      onClose={stage === "processing" ? () => {} : onClose}
      title={`Pay for ${plan.name}`}
      className="max-w-3xl"
    >
      <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Test mode — no money is taken
      </p>

      <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        {/* ── Order summary ─────────────────────────────────── */}
        <section aria-labelledby={fieldId("summary")} className="rounded-2xl border border-border-light bg-surface-1 p-4">
          <h3 id={fieldId("summary")} className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Order summary
          </h3>
          <p className="mt-2 text-lg font-semibold text-text-primary">{plan.name}</p>
          <p className="text-sm text-text-tertiary">{cycleLabel} billing</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-text-secondary">{plan.name} ({cycleLabel.toLowerCase()})</dt>
              <dd className="tabular-nums text-text-primary">{rupees(amount.basePaise)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-secondary">GST {PLAN_GST_RATE_PERCENT}%</dt>
              <dd className="tabular-nums text-text-primary">{rupees(amount.gstPaise)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-border-light pt-2 font-semibold">
              <dt className="text-text-primary">Total</dt>
              <dd className="tabular-nums text-text-primary" data-testid="checkout-total">{rupees(amount.totalPaise)}</dd>
            </div>
          </dl>
        </section>

        {/* ── Payment ───────────────────────────────────────── */}
        {stage === "success" ? (
          <section className="flex flex-col items-center justify-center rounded-2xl border border-border-light bg-surface-0 p-6 text-center" aria-live="polite">
            <Icon icon={CheckmarkCircle02Icon} size={40} className="text-emerald-600" />
            <h3 className="mt-3 text-lg font-semibold text-text-primary">Payment successful</h3>
            <p className="mt-1 text-sm text-text-secondary">
              {rupees(amount.totalPaise)} paid for {plan.name}. You're on {plan.name} now.
            </p>
            <p className="mt-3 break-all text-xs text-text-tertiary">
              Payment ID <span className="font-mono text-text-primary" data-testid="payment-id">{paymentId}</span>
            </p>
            <button type="button" className="btn-primary mt-5 w-full py-3" onClick={handleContinue} disabled={continuing}>
              {continuing ? "Loading…" : "Continue to set up your business"}
            </button>
          </section>
        ) : (
          <form
            className="min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              void pay();
            }}
            noValidate
          >
            <div role="tablist" aria-label="Payment method" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-1 p-1">
              {METHODS.map((m, index) => (
                <button
                  key={m.id}
                  ref={(el) => {
                    tabRefs.current[m.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={fieldId(`tab-${m.id}`)}
                  aria-selected={method === m.id}
                  aria-controls={fieldId(`panel-${m.id}`)}
                  tabIndex={method === m.id ? 0 : -1}
                  onClick={() => setMethod(m.id)}
                  onKeyDown={(e) => onTabKey(e, index)}
                  disabled={stage === "processing"}
                  className={cn(
                    "flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                    method === m.id
                      ? "bg-surface-0 text-brand-700 shadow-sm dark:text-brand-300"
                      : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  <Icon icon={m.icon} size={16} />
                  <span className="truncate">{m.label}</span>
                </button>
              ))}
            </div>

            <div
              role="tabpanel"
              id={fieldId(`panel-${method}`)}
              aria-labelledby={fieldId(`tab-${method}`)}
              className="mt-4 space-y-3"
            >
              {method === "upi" && (
                <>
                  <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-medium p-3">
                    <DemoQr />
                    <p className="text-xs text-text-tertiary">
                      Scan with any UPI app, or pay to your UPI ID below. This is a test QR code.
                    </p>
                  </div>
                  <Field id={fieldId("upi")} label="UPI ID" error={showError("upiId")}>
                    <input
                      id={fieldId("upi")}
                      className="input w-full"
                      placeholder="name@bank"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value.trim())}
                      onBlur={() => touch("upiId")}
                      aria-invalid={!!showError("upiId")}
                      aria-describedby={showError("upiId") ? `${fieldId("upi")}-error` : undefined}
                    />
                  </Field>
                </>
              )}

              {method === "card" && (
                <>
                  <Field id={fieldId("card")} label="Card number" error={showError("cardNumber")}>
                    <input
                      id={fieldId("card")}
                      className="input w-full font-mono"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      placeholder="1234 5678 9012 3456"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                      onBlur={() => touch("cardNumber")}
                      aria-invalid={!!showError("cardNumber")}
                      aria-describedby={`${fieldId("card")}-hint${showError("cardNumber") ? ` ${fieldId("card")}-error` : ""}`}
                    />
                  </Field>
                  <p id={`${fieldId("card")}-hint`} className="-mt-1 text-xs text-text-tertiary">
                    Use test card {DEMO_TEST_CARD}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id={fieldId("expiry")} label="Expiry (MM/YY)" error={showError("expiry")}>
                      <input
                        id={fieldId("expiry")}
                        className="input w-full font-mono"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        placeholder="MM/YY"
                        value={expiry}
                        onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                        onBlur={() => touch("expiry")}
                        aria-invalid={!!showError("expiry")}
                        aria-describedby={showError("expiry") ? `${fieldId("expiry")}-error` : undefined}
                      />
                    </Field>
                    <Field id={fieldId("cvv")} label="CVV" error={showError("cvv")}>
                      <input
                        id={fieldId("cvv")}
                        className="input w-full font-mono"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        type="password"
                        placeholder="123"
                        value={cvv}
                        onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 3))}
                        onBlur={() => touch("cvv")}
                        aria-invalid={!!showError("cvv")}
                        aria-describedby={showError("cvv") ? `${fieldId("cvv")}-error` : undefined}
                      />
                    </Field>
                  </div>
                  <Field id={fieldId("name")} label="Name on card" error={showError("cardName")}>
                    <input
                      id={fieldId("name")}
                      className="input w-full"
                      autoComplete="cc-name"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      onBlur={() => touch("cardName")}
                      aria-invalid={!!showError("cardName")}
                      aria-describedby={showError("cardName") ? `${fieldId("name")}-error` : undefined}
                    />
                  </Field>
                </>
              )}

              {method === "netbanking" && (
                <fieldset>
                  <legend className="label">Choose your bank</legend>
                  <div className="mt-1 space-y-2">
                    {NETBANKING_BANKS.map((b) => (
                      <label
                        key={b.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm text-text-primary",
                          bank === b.id ? "border-brand-500 bg-brand-50 dark:bg-brand-950" : "border-border-light bg-surface-0",
                        )}
                      >
                        <input
                          type="radio"
                          name={fieldId("bank")}
                          value={b.id}
                          checked={bank === b.id}
                          onChange={() => setBank(b.id)}
                          className="accent-brand-600"
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary mt-5 w-full py-3" disabled={!valid || stage === "processing"}>
              {stage === "processing" ? "Processing…" : `Pay ${rupees(amount.totalPaise)}`}
            </button>
            <p className="mt-2 text-center text-xs text-text-tertiary">
              Demo checkout. Your payment details are not sent anywhere.
            </p>
          </form>
        )}
      </div>
    </Modal>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

/** A decorative stand-in for a UPI QR code. */
function DemoQr() {
  // A fixed pattern so it looks like a code without encoding anything.
  const cells = useMemo(() => Array.from({ length: 81 }, (_, i) => ((i * 7 + (i % 9) * 3) % 5 < 2 ? 1 : 0)), []);
  return (
    <div aria-hidden="true" className="grid h-20 w-20 shrink-0 grid-cols-9 gap-px rounded-md border border-border-light bg-white p-1">
      {cells.map((on, i) => (
        <span key={i} className={on ? "bg-gray-900" : "bg-white"} />
      ))}
    </div>
  );
}
