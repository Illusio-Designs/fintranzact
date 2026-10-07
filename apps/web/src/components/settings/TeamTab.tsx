import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { SlideOver } from "@/components/ui/SlideOver";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";
import { cn, formatDate } from "@/lib/utils";
import { memberRoleOptions, canEditMemberRole, isCaManager, STAFF_ROLE_OPTIONS, type InvitableRole } from "@/lib/team-roles";
import { caRoleDescription, isCaRole, lastOpenedText, relativeTime } from "@fintranzact/shared";
import { RoleBadge } from "./RoleBadge";
import { CaPartnerBadge } from "./CaPartnerBadge";
import { InviteLinkBox } from "./InviteLinkBox";
import { InviteCaDialog } from "./InviteCaDialog";
import { TwoFactorPolicyCard } from "./TwoFactorPolicyCard";
import { AiAssistantSettingsCard } from "./AiAssistantSettingsCard";
import { AccessLogCard } from "./AccessLogCard";

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
  const [showInviteCa, setShowInviteCa] = useState(false);

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
  const canInviteCa = isCaManager(callerMember?.role);
  // Owners and admins see who has set up two-factor (the API omits it for everyone else).
  const showTwoFactor = canManage && !!members?.some((m) => m.twoFactorEnabled !== undefined);

  if (!session?.tenantId) return null;

  return (
    <>
      <TwoFactorPolicyCard role={callerMember?.role} members={members} />
      <AiAssistantSettingsCard role={callerMember?.role} />
      <div className="card overflow-visible mt-4">
        <div className="px-6 py-4 flex items-center justify-between border-b border-border-light">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Team Members</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Manage who has access to this organization
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setShowInvite(true)}>
                + Invite member
              </button>
              {canInviteCa && (
                <button className="btn-primary btn-sm" onClick={() => setShowInviteCa(true)}>
                  Invite my CA
                </button>
              )}
            </div>
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
                      <RoleBadge role={inv.role} />
                      {caRoleDescription(inv.role) && (
                        <p data-testid="pending-access" className="mt-1 max-w-xs text-xs text-text-tertiary">
                          {caRoleDescription(inv.role)}
                        </p>
                      )}
                      {canManage && <div><CaPartnerBadge partner={inv.caPartner} /></div>}
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
                    <RoleBadge role={m.role} />
                    {canManage && isCaRole(m.role) && (
                      <p data-testid="last-opened" className="mt-1 text-xs text-text-tertiary">
                        {lastOpenedText(m.lastOpenedAt, (d) => relativeTime(d.toISOString()))}
                      </p>
                    )}
                    {canManage && isCaRole(m.role) && <div><CaPartnerBadge partner={m.caPartner} /></div>}
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
                          {canEditMemberRole(callerMember?.role, m.role) && (
                            <div className="w-28">
                              <Listbox
                                value={m.role}
                                onChange={(role) =>
                                  updateRole.mutate({ userId: m.userId, role: role as InvitableRole })
                                }
                                options={memberRoleOptions(callerMember?.role)}
                              />
                            </div>
                          )}
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

      {canManage && <AccessLogCard viewerId={me?.user?.id} />}

      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} />
      <InviteCaDialog open={showInviteCa} onClose={() => setShowInviteCa(false)} />
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
    inviteMutation.mutate({ email, role: role as InvitableRole });
  }

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title="Invite Team Member"
      description="For your staff. To give your accountant access, use Invite my CA."
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
          <InviteLinkBox link={`${window.location.origin}${inviteResult.inviteLink}`} />
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
              options={STAFF_ROLE_OPTIONS}
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
