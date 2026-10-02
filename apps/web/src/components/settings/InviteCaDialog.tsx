import { useState } from "react";
import { CA_ACCESS_CHOICES, CA_ACCESS_NOTE, type CaRole } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { SlideOver } from "@/components/ui/SlideOver";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { InviteLinkBox } from "./InviteLinkBox";

/** "Invite your CA": owner-only invitation with one of two plain-language access levels. */
export function InviteCaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CaRole>("auditor");
  const [creditPartner, setCreditPartner] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const invite = trpc.tenant.inviteMember.useMutation({
    onSuccess: (data) => {
      setLink(`${window.location.origin}/invite/${data.token}`);
      toast.success("Invitation created");
      utils.tenant.members.invalidate();
      utils.tenant.pendingInvitations.invalidate();
    },
    onError: (err) => toast.error("Could not invite your CA", err.message),
  });

  function handleClose() {
    setEmail("");
    setRole("auditor");
    setCreditPartner(false);
    setLink(null);
    onClose();
  }

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title="Invite your CA"
      description="Give your accountant their own login to your books."
      footer={
        link ? (
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={handleClose}>Done</button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={handleClose}>Cancel</button>
            <button type="submit" form="invite-ca-form" disabled={invite.isPending} className="btn-primary">
              {invite.isPending ? "Sending…" : "Send invite"}
            </button>
          </div>
        )
      }
    >
      {link ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-600/[0.08] border border-emerald-200 dark:border-emerald-800 px-4 py-3">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Invitation created!</p>
            <p data-testid="ca-emailed" className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              We emailed them at {email.trim().toLowerCase()}. You can also share the link below.
            </p>
          </div>
          <InviteLinkBox link={link} />
          <p className="text-xs text-text-tertiary">{CA_ACCESS_NOTE}</p>
        </div>
      ) : (
        <form
          id="invite-ca-form"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate({ email, role, creditPartner });
          }}
          className="space-y-5"
        >
          <div>
            <label className="label" htmlFor="invite-ca-email">Your CA's email address</label>
            <input
              id="invite-ca-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              placeholder="ca@firm.in"
              autoFocus
            />
          </div>

          <fieldset>
            <legend className="label">What can they do?</legend>
            <div role="radiogroup" aria-label="Access level" className="space-y-2">
              {CA_ACCESS_CHOICES.map((choice) => (
                <label
                  key={choice.role}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    role === choice.role
                      ? "border-brand-500 bg-brand-600/[0.06]"
                      : "border-border-light hover:border-border-medium",
                  )}
                >
                  <input
                    type="radio"
                    name="ca-access"
                    value={choice.role}
                    checked={role === choice.role}
                    onChange={() => setRole(choice.role)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">{choice.title}</span>
                    <span className="block text-xs text-text-secondary mt-0.5">{choice.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={creditPartner}
                onChange={(e) => setCreditPartner(e.target.checked)}
                className="mt-1"
              />
              <span>
                This CA referred me to Fintranzact. Credit them as my partner.
                <span className="mt-0.5 block text-xs text-text-secondary">
                  Only for CAs who are registered Fintranzact partners. They then count this business as a referral.
                  Leave it off and nothing changes for anyone.
                </span>
              </span>
            </label>
          </div>

          <p className="text-xs text-text-tertiary">{CA_ACCESS_NOTE}</p>
        </form>
      )}
    </SlideOver>
  );
}
