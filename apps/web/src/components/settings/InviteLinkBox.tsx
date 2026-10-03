import { toast } from "@/hooks/useToast";

/** Read-only invite link with a copy button, shown after an invitation is created. */
export function InviteLinkBox({ link }: { link: string }) {
  return (
    <div>
      <label className="label" htmlFor="invite-link">Invite Link</label>
      <div className="flex gap-2">
        <input id="invite-link" readOnly value={link} className="input flex-1 font-mono text-xs" />
        <button
          type="button"
          className="btn-secondary shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(link);
            toast.success("Copied to clipboard");
          }}
        >
          Copy
        </button>
      </div>
    </div>
  );
}
