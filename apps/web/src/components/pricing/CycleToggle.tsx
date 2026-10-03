import { YEARLY_SAVING_MONTHS, type BillingCycle } from "@fintranzact/shared";
import { cn } from "@/lib/utils";

/** Monthly / yearly switch for plan prices. Yearly is labelled with the saving (2 months free). */
export function CycleToggle({
  value,
  onChange,
  className,
}: {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  className?: string;
}) {
  const option = (cycle: BillingCycle, label: string, extra?: string) => (
    <button
      type="button"
      aria-pressed={value === cycle}
      onClick={() => onChange(cycle)}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-semibold transition",
        value === cycle ? "bg-brand-600 text-white shadow-sm" : "text-text-secondary hover:text-text-primary",
      )}
    >
      {label}
      {extra ? <span className={cn("ml-1.5 text-xs font-bold", value === cycle ? "text-white/90" : "text-emerald-600")}>{extra}</span> : null}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Billing period"
      className={cn("inline-flex items-center gap-1 rounded-full border border-border-light bg-surface-0 p-1", className)}
    >
      {option("monthly", "Monthly")}
      {option("yearly", "Yearly", `${YEARLY_SAVING_MONTHS} months free`)}
    </div>
  );
}
