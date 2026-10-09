import { useId } from "react";
import { AI_LANGUAGES, AI_LANGUAGE_LABELS, AI_LANGUAGE_SHORT, aiLanguageSchema, type AiLanguage, type AiUserPrefs } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";

/**
 * The person's own assistant preferences: the language it replies (and listens)
 * in, and whether the dashboard shows its tips. Saved per person on the server
 * (ai.updatePreferences); nobody else sees or changes them.
 */
export function AiPreferences({ prefs, canEdit }: { prefs: AiUserPrefs; canEdit: boolean }) {
  const id = useId();
  const utils = trpc.useUtils();
  const update = trpc.ai.updatePreferences.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.ai.preferences.invalidate(), utils.ai.tips.invalidate()]);
    },
  });

  return (
    <div className="space-y-4 text-sm" data-testid="ai-preferences">
      <div>
        <label htmlFor={`${id}-lang`} className="block text-xs font-medium text-text-secondary">Reply language</label>
        <select
          id={`${id}-lang`}
          className="input mt-1 w-full text-sm"
          value={prefs.language}
          disabled={!canEdit || update.isPending}
          onChange={(e) => {
            const parsed = aiLanguageSchema.safeParse(e.target.value);
            if (parsed.success) update.mutate({ language: parsed.data });
          }}
        >
          {AI_LANGUAGES.map((l: AiLanguage) => (
            <option key={l} value={l}>{AI_LANGUAGE_LABELS[l]}</option>
          ))}
        </select>
        <p className="mt-1 text-2xs text-text-tertiary">
          The assistant answers in {prefs.language === "auto" ? "the language you ask in" : AI_LANGUAGE_SHORT[prefs.language]}. The microphone listens for the same language. Amounts, names and dates are copied from your books and are never translated.
        </p>
      </div>

      <div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border-light"
            checked={prefs.tipsEnabled}
            disabled={!canEdit || update.isPending}
            onChange={(e) => update.mutate({ tipsEnabled: e.target.checked })}
          />
          <span>
            <span className="block text-sm text-text-primary">Show tips on my dashboard</span>
            <span className="block text-2xs text-text-tertiary">Things like overdue invoices, low stock, expiring batches and GST due dates. Tips are worked out from your books and never use up your questions. This only affects you.</span>
          </span>
        </label>
      </div>

      {update.error && <p role="alert" className="text-xs text-red-600">{update.error.message}</p>}
    </div>
  );
}
