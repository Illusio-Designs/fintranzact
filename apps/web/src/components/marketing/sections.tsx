import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Add01Icon, CheckmarkCircle02Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { PLAN_OPTIONS } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * Building blocks shared by the public marketing pages (home, pricing, …),
 * so each design element exists in one place.
 */

const NAVY = "bg-[#0f1b3d]";

/** Section eyebrow + heading styles used across the marketing pages. */
export const EYEBROW = "text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300";
export const HEADING = "font-display font-extrabold tracking-[-0.025em] text-[#0f1b3d] dark:text-white";

/** The three plan cards; the highlighted plan is shown as a navy card. */
export function PricingCards({ className }: { className?: string }) {
  return (
    <div className={cn("grid items-stretch gap-6 md:grid-cols-3", className)}>
      {PLAN_OPTIONS.map((plan) =>
        plan.highlight ? (
          <div
            key={plan.id}
            className={cn(
              NAVY,
              "relative flex flex-col rounded-[22px] p-8 text-white shadow-[0_30px_60px_-30px_rgba(15,27,61,.6)] ring-1 ring-transparent dark:bg-[#16213f] dark:ring-[#2a3a63]",
            )}
          >
            <span className="absolute -top-3 left-8 rounded-full bg-brand-600 px-3 py-1 text-xs font-extrabold text-white">
              Most popular
            </span>
            <p className="text-lg font-bold">{plan.name}</p>
            <p className="mt-1 text-sm text-[#9fb0d6]">{plan.tagline}</p>
            <p className="mt-6">
              <span className="font-display text-5xl font-extrabold">{plan.price}</span>
              <span className="text-[15px] text-[#9fb0d6]"> / forever</span>
            </p>
            <ul className="mt-6 flex-1 space-y-3 text-[15px] text-[#dbe4f5]">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Icon icon={CheckmarkCircle02Icon} size={20} className="text-[#a9bde6]" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              to="/login"
              search={{ mode: "register" }}
              className="mt-7 flex h-[52px] items-center justify-center rounded-xl bg-white text-base font-bold text-brand-900 transition hover:bg-brand-50"
            >
              Start free
            </Link>
          </div>
        ) : (
          <div key={plan.id} className="flex flex-col rounded-[22px] border border-border-light bg-surface-0 p-8">
            <p className="text-lg font-bold text-text-primary">{plan.name}</p>
            <p className="mt-1 text-sm text-text-tertiary">{plan.tagline}</p>
            <p className="mt-6 font-display text-[40px] font-extrabold text-[#0f1b3d] dark:text-white">{plan.price}</p>
            <p className="mt-1 text-[13px] text-text-tertiary">Priced to your team size</p>
            <ul className="mt-5 flex-1 space-y-3 text-[15px] text-text-secondary">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Icon icon={CheckmarkCircle02Icon} size={20} className="text-brand-600 dark:text-brand-300" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              to="/contact"
              className="mt-7 flex h-[52px] items-center justify-center rounded-xl border border-[#cfd8ea] text-base font-bold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:text-white"
            >
              Talk to us
            </Link>
          </div>
        ),
      )}
    </div>
  );
}

/** Accordion list of questions; the first one starts open. */
export function FaqAccordion({ items, idPrefix = "faq" }: { items: Array<{ q: string; a: string }>; idPrefix?: string }) {
  const [open, setOpen] = useState(0);
  return (
    <div>
      {items.map((f, i) => {
        const isOpen = open === i;
        const id = `${idPrefix}-${i}`;
        return (
          <div key={f.q} className="border-b border-border-light">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={id}
              onClick={() => setOpen(isOpen ? -1 : i)}
              className="flex w-full items-center justify-between gap-4 py-5 text-left text-[17px] font-bold text-text-primary"
            >
              {f.q}
              <span
                className={cn(
                  "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full transition",
                  isOpen ? "bg-brand-600 text-white" : "bg-surface-2 text-text-primary",
                )}
              >
                <Icon icon={isOpen ? MinusSignIcon : Add01Icon} size={16} strokeWidth={2} />
              </span>
            </button>
            {isOpen && (
              <p id={id} className="pb-5 pr-14 text-[15px] leading-relaxed text-text-secondary">
                {f.a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
