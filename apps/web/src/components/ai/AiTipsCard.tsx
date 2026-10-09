import { useCallback, useState } from "react";
import type { AiTip } from "@fintranzact/shared";
import { AI_TIPS_CACHE_MS } from "@fintranzact/shared";
import { trpc, getBusinessId } from "@/lib/trpc";
import { canAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { openAiPanel } from "@/lib/ai-panel";
import { Icon } from "@/components/ui/Icon";
import { ArrowDown01Icon, ArrowUp01Icon, BulbIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { AiLink } from "./AiCards";
import { useAiAccess } from "./AiGate";

/**
 * "Tips from your assistant" on the dashboard: a few worked-out facts (overdue
 * invoices, low stock, expiring batches, GST due dates) with a link to the
 * report and an "Ask AI about this" button that fills the question box.
 *
 * The tips come from the server (ai.tips): no model is called and no question is
 * used. The card is not drawn at all when the AI add-on is not available, the
 * owner switched the assistant off, the person switched tips off, or there is
 * nothing to say. A tip can be dismissed for the day and the card collapsed;
 * both are remembered in this browser only (a per-viewer convenience).
 */

interface Remembered {
  day: string;
  dismissed: string[];
  collapsed: boolean;
}

const storageKey = (businessId: string) => `fintranzact.aiTips.${businessId}`;

function readRemembered(businessId: string, day: string): Remembered {
  try {
    const raw = window.localStorage.getItem(storageKey(businessId));
    if (raw) {
      const v = JSON.parse(raw) as Partial<Remembered>;
      return {
        day,
        collapsed: v.collapsed === true,
        // Dismissals are for one day only.
        dismissed: v.day === day && Array.isArray(v.dismissed) ? v.dismissed.filter((x): x is string => typeof x === "string").slice(0, 20) : [],
      };
    }
  } catch {
    /* storage blocked: the card still works, it just forgets */
  }
  return { day, dismissed: [], collapsed: false };
}

function writeRemembered(businessId: string, value: Remembered): void {
  try {
    window.localStorage.setItem(storageKey(businessId), JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const SEVERITY_STYLE: Record<AiTip["severity"], string> = {
  critical: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30",
  warning: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
  info: "border-border-light bg-surface-0",
};
const SEVERITY_LABEL: Record<AiTip["severity"], string> = { critical: "Needs attention", warning: "Worth a look", info: "Coming up" };

export function AiTipsCard({ role }: { role: string | null | undefined }) {
  const allowed = canAccess(role, "Ai", "read");
  const access = useAiAccess();
  const utils = trpc.useUtils();
  const tips = trpc.ai.tips.useQuery(undefined, {
    enabled: allowed && access.active,
    staleTime: AI_TIPS_CACHE_MS,
    refetchOnWindowFocus: false,
    retry: 0,
  });
  const setPrefs = trpc.ai.updatePreferences.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.ai.tips.invalidate(), utils.ai.preferences.invalidate()]);
    },
  });

  const businessId = getBusinessId() ?? "default";
  const day = tips.data?.day ?? "";
  // What this browser remembers for today (read once per day; changes are written back straight away).
  const [stored, setStored] = useState<Remembered | null>(null);
  const remembered: Remembered = stored && stored.day === day ? stored : day ? readRemembered(businessId, day) : { day: "", dismissed: [], collapsed: false };

  const update = useCallback(
    (next: Remembered) => {
      setStored(next);
      writeRemembered(businessId, next);
    },
    [businessId],
  );

  if (!allowed || !access.active || !tips.data || !tips.data.available) return null;
  const visible = tips.data.tips.filter((t) => !remembered.dismissed.includes(t.id));
  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="ai-tips-title" data-testid="ai-tips-card" className="rounded-xl border border-border-light bg-surface-0 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300" aria-hidden="true">
          <Icon icon={BulbIcon} size={15} />
        </span>
        <h2 id="ai-tips-title" className="flex-1 text-sm font-semibold text-text-primary">Tips from your assistant</h2>
        <button
          type="button"
          onClick={() => update({ ...remembered, day, collapsed: !remembered.collapsed })}
          aria-expanded={!remembered.collapsed}
          aria-controls="ai-tips-list"
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-text-secondary hover:bg-surface-1"
          data-testid="ai-tips-toggle"
        >
          {remembered.collapsed ? `Show ${visible.length}` : "Hide"}
          <Icon icon={remembered.collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
        </button>
      </div>

      <ul id="ai-tips-list" hidden={remembered.collapsed} className="mt-2 space-y-2">
        {visible.map((tip) => (
          <li key={tip.id} data-testid="ai-tip" data-tip-kind={tip.kind} className={cn("rounded-lg border px-3 py-2.5", SEVERITY_STYLE[tip.severity])}>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm text-text-primary">
                <span className="sr-only">{SEVERITY_LABEL[tip.severity]}: </span>
                {tip.text}
              </p>
              <button
                type="button"
                onClick={() => update({ ...remembered, day, dismissed: [...remembered.dismissed, tip.id] })}
                aria-label={`Dismiss for today: ${tip.text}`}
                title="Dismiss for today"
                className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
              >
                <Icon icon={Cancel01Icon} size={14} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AiLink card={{ type: "link", label: tip.link.label, target: tip.link.target }} />
              {tip.ask && (
                <button
                  type="button"
                  onClick={() => openAiPanel(tip.ask)}
                  className="inline-flex items-center gap-1 rounded-lg border border-brand-600/30 bg-brand-600/[0.06] px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-600/10 dark:text-brand-300"
                >
                  Ask AI about this
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!remembered.collapsed && (
        <p className="mt-2 text-2xs text-text-tertiary">
          Worked out from your books; no question is used.{" "}
          <button
            type="button"
            onClick={() => setPrefs.mutate({ tipsEnabled: false })}
            disabled={setPrefs.isPending}
            className="underline hover:text-text-primary"
            data-testid="ai-tips-off"
          >
            Turn tips off
          </button>
          {setPrefs.error && <span role="alert" className="ml-2 text-red-600">{setPrefs.error.message}</span>}
        </p>
      )}
    </section>
  );
}
