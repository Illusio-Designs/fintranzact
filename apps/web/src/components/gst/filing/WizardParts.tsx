import { ReactNode, useEffect, useRef } from "react";
import { formatElapsed, groupPortalErrors, wizardSteps, type WizardStep } from "@fintranzact/shared";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Spinner";

/** Where "Fix in your books" leads for each kind of portal message. */
const FIX_HREF = { invoices: "/invoices", "credit-notes": "/credit-notes", items: "/items" } as const;

export function Stepper({ nil, current }: { nil: boolean; current: WizardStep }) {
  const steps = wizardSteps(nil);
  const at = Math.max(0, steps.findIndex((s) => s.step === current));
  return (
    <nav aria-label="Filing steps" className="mb-4">
      <p className="text-xs text-text-tertiary sm:hidden" data-testid="stepper-compact">
        Step {at + 1} of {steps.length}: <span className="font-medium text-text-primary">{steps[at]?.label}</span>
      </p>
      <ol className="mt-1 flex items-center gap-1 sm:mt-0">
        {steps.map((s, i) => {
          const state = i < at ? "done" : i === at ? "current" : "todo";
          return (
            <li
              key={s.step}
              aria-current={state === "current" ? "step" : undefined}
              className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-xs", state === "todo" ? "text-text-tertiary" : "text-text-primary")}
              data-state={state}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                  state === "current" && "border-brand-600 bg-brand-600 text-white",
                  state === "done" && "border-emerald-600 bg-emerald-600 text-white",
                  state === "todo" && "border-border",
                )}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={cn("truncate", state !== "current" && "hidden sm:inline", state === "current" && "font-medium")}>
                {s.label}
                {state === "done" && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The step's heading. Focus moves here when the step changes, so keyboard and screen reader users land at the top of the new step. */
export function StepHeading({ children, focus = true }: { children: ReactNode; focus?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focus) return;
    // An OTP field on the step takes the focus instead.
    const input = document.querySelector<HTMLElement>("[data-step-autofocus]");
    (input ?? ref.current)?.focus();
  }, [focus]);
  return (
    <h3 ref={ref} tabIndex={-1} data-autofocus={focus ? "" : undefined} className="text-base font-semibold text-text-primary outline-none">
      {children}
    </h3>
  );
}

/** Primary action(s) pinned to the bottom of the panel, full width on a phone. */
export function Actions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-6 -mb-4 mt-6 flex flex-col-reverse gap-2 border-t border-border-light bg-surface-0 px-6 py-3 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
      {children}
    </div>
  );
}

const TONE = {
  info: "border-border bg-surface-1 text-text-secondary",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
  error: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200",
} as const;

export function Notice({ tone = "info", children, alert }: { tone?: keyof typeof TONE; children: ReactNode; alert?: boolean }) {
  return (
    <div role={alert || tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", TONE[tone])}>
      {children}
    </div>
  );
}

/** "Checking with the GST portal..." with elapsed time; a retry button when it stops. */
export function PollPanel({
  title,
  elapsedMs,
  timedOut,
  error,
  onRetry,
}: {
  title: string;
  elapsedMs: number;
  timedOut: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (timedOut || error) {
    return (
      <div className="space-y-3">
        <Notice tone="warning" alert>
          {error ?? "The GST portal is taking longer than usual. Nothing is lost: your progress is saved."}
        </Notice>
        <button type="button" className="btn-primary" onClick={onRetry}>Check again</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Spinner size="sm" />
        {title}
      </p>
      <p className="text-xs text-text-tertiary">
        Waiting {formatElapsed(elapsedMs)}. This usually takes 1-2 minutes; we check every 12 seconds. You can close this window and come back: your place is saved.
      </p>
    </div>
  );
}

/** The portal's validation messages, grouped by section, with a way to fix the books. */
export function PortalErrors({ messages }: { messages: string[] }) {
  const groups = groupPortalErrors(messages);
  return (
    <div className="space-y-3" data-testid="portal-errors">
      {groups.map((g) => (
        <section key={g.section} aria-label={g.label} className="rounded-lg border border-red-300 px-3 py-2 dark:border-red-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-red-800 dark:text-red-300">{g.label}</h4>
            {g.fix && (
              <a
                href={FIX_HREF[g.fix]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Fix in your books<span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-text-secondary">
            {g.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
