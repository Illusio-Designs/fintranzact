import { cn } from "@/lib/utils";

/**
 * A small plan name next to a nav item or a section title ("Growth"): the
 * feature is not on the organisation's plan. Text, not colour alone, with a
 * full-sentence label for screen readers.
 */
export function PlanBadge({ plan, feature, className }: { plan: string; feature?: string; className?: string }) {
  return (
    <span
      data-testid="plan-badge"
      aria-label={feature ? `${feature} is available on the ${plan} plan` : `Available on the ${plan} plan`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-current px-1.5 py-px text-2xs font-semibold uppercase leading-4 tracking-wide opacity-80",
        className,
      )}
    >
      {plan}
    </span>
  );
}
