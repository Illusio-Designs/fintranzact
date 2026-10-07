import { Icon } from "@/components/ui/Icon";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { canAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { toggleAiPanel, useAiPanel } from "@/lib/ai-panel";

/**
 * The entry point to the assistant: in the header on every page and on the
 * dashboard. Roles without the assistant (the accountant access roles) do not
 * see it. A person whose organisation has no AI add-on still sees the button:
 * the panel then shows the "AI is an add-on" notice.
 */
export function AskAiButton({ role, variant = "header" }: { role: string | null | undefined; variant?: "header" | "dashboard" }) {
  const { open } = useAiPanel();
  if (!canAccess(role, "Ai", "read")) return null;
  return (
    <button
      type="button"
      onClick={toggleAiPanel}
      aria-pressed={open}
      aria-label="Ask AI"
      title="Ask Fintranzact AI"
      data-testid={variant === "header" ? "ask-ai-header" : "ask-ai-dashboard"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border text-sm font-medium transition-colors",
        variant === "header"
          ? "h-10 border-border-light px-3 text-text-secondary hover:bg-surface-1 hover:text-text-primary"
          : "h-10 border-brand-600/30 bg-brand-600/[0.06] px-4 text-brand-700 hover:bg-brand-600/10 dark:text-brand-300",
        open && "bg-surface-2 text-text-primary",
      )}
    >
      <Icon icon={SparklesIcon} size={16} />
      <span className={variant === "header" ? "hidden sm:inline" : undefined}>{variant === "header" ? "Ask AI" : "Ask AI about your business"}</span>
    </button>
  );
}
