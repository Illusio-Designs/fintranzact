import type { PaymentMethod } from "../types";

interface PaymentChoiceProps {
  /** What the store offers right now (from the catalog). */
  options: { online: boolean; cod: boolean };
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  accent: string;
}

/**
 * How to pay: online (UPI, cards and net banking on Razorpay's page) and/or
 * Cash on Delivery, each shown only when the store offers it. With a single
 * option there is nothing to choose, so it is stated rather than asked.
 */
export function PaymentChoice({ options, value, onChange, accent }: PaymentChoiceProps) {
  const choices: Array<{ method: PaymentMethod; title: string; hint: string }> = [];
  if (options.online) {
    choices.push({ method: "online", title: "Pay online", hint: "UPI, cards or net banking, on Razorpay's secure page" });
  }
  if (options.cod) {
    choices.push({ method: "cod", title: "Cash on Delivery", hint: "Pay in cash when your order arrives" });
  }
  if (choices.length === 0) return null;

  return (
    <fieldset className="space-y-2" data-testid="payment-choice">
      <legend className="block text-sm font-medium mb-1.5" style={{ color: "var(--store-text)" }}>
        How would you like to pay?
      </legend>
      {choices.map((c) => {
        const selected = choices.length === 1 || value === c.method;
        return (
          <label
            key={c.method}
            className="flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer"
            style={{
              borderColor: selected ? accent : "var(--store-border)",
              background: selected ? "var(--store-accent-light)" : "var(--store-bg)",
            }}
          >
            <input
              type="radio"
              name="payment-method"
              className="mt-1"
              checked={selected}
              onChange={() => onChange(c.method)}
              style={{ accentColor: accent }}
            />
            <span>
              <span className="block text-sm font-semibold" style={{ color: "var(--store-text)" }}>
                {c.title}
              </span>
              <span className="block text-xs mt-0.5" style={{ color: "var(--store-muted)" }}>
                {c.hint}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
