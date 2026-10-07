import { useEffect, useState } from "react";
import { AI_ROLE_LABELS, type AiSwitchableRole } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { useAiAccess } from "@/components/ai/AiGate";

/**
 * Team tab: the owner's switches for the AI assistant. One for the whole
 * organisation and one per role. The server enforces both (a switched-off role
 * is refused whatever the screen shows); the owner is never locked out, so the
 * assistant can always be switched back on.
 */
export function AiAssistantSettingsCard({ role }: { role: string | undefined }) {
  const utils = trpc.useUtils();
  const isOwner = role === "owner" || role === "superadmin";
  const access = useAiAccess();
  const { data } = trpc.ai.settings.useQuery(undefined, { enabled: isOwner, retry: 0 });
  const [enabled, setEnabled] = useState(true);
  const [off, setOff] = useState<AiSwitchableRole[]>([]);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setOff(data.disabledRoles);
  }, [data]);

  const save = trpc.ai.updateSettings.useMutation({
    onSuccess: async () => {
      toast.success("AI assistant settings saved");
      await Promise.all([utils.ai.settings.invalidate(), utils.ai.status.invalidate()]);
    },
    onError: (err) => toast.error("Could not save", err.message),
  });

  if (!isOwner) return null;

  const dirty = !!data && (enabled !== data.enabled || off.slice().sort().join() !== data.disabledRoles.slice().sort().join());
  const toggleRole = (r: AiSwitchableRole) => setOff((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  return (
    <div className="card mt-4 px-6 py-5" data-testid="ai-settings-card">
      <h3 className="text-sm font-semibold text-text-primary">AI assistant</h3>
      <p className="mt-0.5 text-xs text-text-tertiary">
        Ask Fintranzact AI answers questions from your live data, with each person&apos;s own permissions.
        {!access.active && " Your organisation does not have the add-on yet; these switches apply once it does."}
      </p>

      <label className="mt-4 flex items-start gap-3 text-sm">
        <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-medium text-text-primary">Allow the AI assistant in this organisation</span>
          <span className="block text-xs text-text-tertiary">Switching it off stops everyone except you from using it.</span>
        </span>
      </label>

      <fieldset className="mt-4" disabled={!enabled}>
        <legend className="text-xs font-medium text-text-secondary">Roles that can use it</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(Object.keys(AI_ROLE_LABELS) as AiSwitchableRole[]).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={!off.includes(r)} onChange={() => toggleRole(r)} />
              {AI_ROLE_LABELS[r]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-text-tertiary">Owners always keep it. Accountant access roles (auditor, filing CA) do not have the assistant.</p>
      </fieldset>

      <div className="mt-4">
        <button type="button" className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate({ enabled, disabledRoles: off })}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
