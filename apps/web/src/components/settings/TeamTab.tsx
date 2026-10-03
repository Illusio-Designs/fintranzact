import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { SlideOver } from "@/components/ui/SlideOver";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";
import { cn, formatDate } from "@/lib/utils";
import { formatRole } from "@/lib/roles";
import { TwoFactorPolicyCard } from "./TwoFactorPolicyCard";

const roleOptions = [
  { value: "admin", label: formatRole("admin") },
  { value: "seller_manager", label: formatRole("seller_manager") },
  { value: "seller", label: formatRole("seller") },
  { value: "accountant", label: formatRole("accountant") },
];

function TeamSection() {
  const { data: session } = trpc.auth.me.useQuery();
  const { data: members, isLoading } = trpc.tenant.members.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });
  const { data: pendingInvitations } = trpc.tenant.pendingInvitations.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });
  const utils = trpc.useUtils();
  const [showInvite, setShowInvite] = useState(false);

  const removeMember = trpc.tenant.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      utils.tenant.members.invalidate();
    },
    onError: (err) => toast.error("Failed to remove member", err.message),
  });

  const updateRole = trpc.tenant.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      utils.tenant.members.invalidate();
    },
    onError: (err) => toast.error("Failed to update role", err.message),
  });

  const revokeInvitation = trpc.tenant.revokeInvitation.useMutation({
    onSuccess: () => {
      toast.success("Invitation revoked");
      utils.tenant.pendingInvitations.invalidate();
    },
    onError: (err) => toast.error("Failed to revoke invitation", err.message),
  });

  const { data: me } = trpc.auth.me.useQuery();
  const callerMember = members?.find((m) => m.userEmail === me?.user?.email);
  const canManage = callerMember?.role === "owner" || callerMember?.role === "superadmin" || callerMember?.role === "admin";
  // Owners and admins see who has set up two-factor (the API omits it for everyone else).
  const showTwoFactor = canManage && !!members?.some((m) => m.twoFactorEnabled !== undefined);

  if (!session?.tenantId) return null;

  return (
    <>
      <TwoFactorPolicyCard role={callerMember?.role} members={members} />
      <div className="card overflow-visible mt-4">
        <div className="px-6 py-4 flex items-center justify-between border-b border-border-light">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Team Members</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Manage who has access to this organization
            </p>
          </div>
          {canManage && (
            <button className="btn-primary btn-sm" onClick={() => setShowInvite(true)}>
              + Invite
            </button>
          )}
        </div>

        {pendingInvitations && pendingInvitations.length > 0 && (
          <div className="border-b border-border-light">
            <div className="px-6 py-2">
              <span className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">
                Pending Invitations
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th className="hidden sm:table-cell">Sent</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {pendingInvitations.map((inv) => (
                  <tr key={inv.id}>
                    <td className="text-text-secondary break-all">{inv.email}</td>
                    <td>
                      <span className={cn(
                        "px-2 py-0.5 rounded text-2xs font-medium",
                        inv.role === "admin"
                          ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                          : "bg-surface-2 text-text-secondary",
                      )}>
                        {formatRole(inv.role)}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell text-text-secondary text-xs">
                      {formatDate(inv.createdAt)}
                    </td>
                    {canManage && (
                      <td className="text-right">
                        <button
                          onClick={() => revokeInvitation.mutate({ invitationId: inv.id })}
                          disabled={revokeInvitation.isPending}
                          className="btn-ghost text-red-600 hover:text-red-700 text-xs px-2 py-1"
                        >
                          Revoke
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isLoading ? (
          <div className="px-6 py-8 space-y-3">
            <div className="skeleton h-5 rounded" />
            <div className="skeleton h-5 rounded" />
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hidden sm:table-cell">Email</th>
                <th>Role</th>
                <th className="hidden sm:table-cell">Joined</th>
                {showTwoFactor && <th>Two-factor</th>}
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.id}>
                  {/* A long name may wrap anywhere, so it can't push the table
                      (and the page, on a phone) wider than the screen. */}
                  <td className="font-medium [overflow-wrap:anywhere]">
                    {m.userName}
                    {/* Phones have no Email column: show it under the name. */}
                    <span className="block sm:hidden text-xs font-normal text-text-secondary break-all">
                      {m.userEmail}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell text-text-secondary">{m.userEmail}</td>
                  <td>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-2xs font-medium",
                        m.role === "owner" || m.role === "superadmin"
                          ? "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400"
                          : m.role === "admin"
                            ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                            : "bg-surface-2 text-text-secondary",
                      )}
                    >
                      {formatRole(m.role)}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell text-text-secondary text-xs">
                    {m.acceptedAt ? formatDate(m.acceptedAt) : "Pending"}
                  </td>
                  {showTwoFactor && (
                    <td>
                      <span
                        data-testid="two-factor-badge"
                        className={cn(
                          "px-2 py-0.5 rounded text-2xs font-medium",
                          m.twoFactorEnabled
                            ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {m.twoFactorEnabled ? "On" : "Not set up"}
                      </span>
                    </td>
                  )}
                  {canManage && (
                    <td className="text-right">
                      {m.role !== "owner" && m.role !== "superadmin" && m.userEmail !== me?.user?.email && (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <div className="w-28">
                            <Listbox
                              value={m.role}
                              onChange={(role) =>
                                updateRole.mutate({ userId: m.userId, role: role as "admin" | "seller_manager" | "seller" | "accountant" })
                              }
                              options={roleOptions}
                            />
                          </div>
                          <button
                            onClick={() => removeMember.mutate({ userId: m.userId })}
                            disabled={removeMember.isPending}
                            className="btn-ghost text-red-600 hover:text-red-700 text-xs px-2 py-1"
                            title="Remove member"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} />
    </>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("seller");
  const [inviteResult, setInviteResult] = useState<{ token: string; inviteLink: string } | null>(null);
  const utils = trpc.useUtils();

  const inviteMutation = trpc.tenant.inviteMember.useMutation({
    onSuccess: (data) => {
      const inviteLink = `/invite/${data.token}`;
      setInviteResult({ token: data.token, inviteLink });
      toast.success("Invitation created");
      utils.tenant.members.invalidate();
      utils.tenant.pendingInvitations.invalidate();
    },
    onError: (err) => toast.error("Failed to send invite", err.message),
  });

  function handleClose() {
    setEmail("");
    setRole("seller");
    setInviteResult(null);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    inviteMutation.mutate({ email, role: role as "admin" | "seller_manager" | "seller" | "accountant" });
  }

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title="Invite Team Member"
      footer={
        inviteResult ? (
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-primary" onClick={handleClose}>
              Done
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              form="invite-member-form"
              disabled={inviteMutation.isPending}
              className="btn-primary"
            >
              {inviteMutation.isPending ? "Sending…" : "Send Invite"}
            </button>
          </div>
        )
      }
    >
      {inviteResult ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-600/[0.08] border border-emerald-200 dark:border-emerald-800 px-4 py-3">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Invitation created!</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              We've sent an invitation email to {email}. You can also share the link below.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="invite-link">Invite Link</label>
            <div className="flex gap-2">
              <input
                id="invite-link"
                readOnly
                value={`${window.location.origin}${inviteResult.inviteLink}`}
                className="input flex-1 font-mono text-xs"
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}${inviteResult.inviteLink}`,
                  );
                  toast.success("Copied to clipboard");
                }}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form id="invite-member-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="invite-email">Email address</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              placeholder="colleague@example.com"
              autoFocus
            />
          </div>
          <div>
            <Listbox
              label="Role"
              value={role}
              onChange={setRole}
              options={roleOptions}
            />
          </div>
        </form>
      )}
    </SlideOver>
  );
}

export function TeamTab() {
  return <TeamSection />;
}
