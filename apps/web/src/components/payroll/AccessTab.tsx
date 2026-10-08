import { useState } from "react";
import { EMPLOYEE_INVITE_NOTE, employeeInviteSchema } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Panel, TABLE, onError } from "./payroll-ui";

const STATE_LABEL = { none: "No login", invited: "Invited", active: "Signed up" } as const;
const STATE_COLOR = {
  none: "bg-surface-2 text-text-secondary",
  invited: "bg-amber-600/[0.1] text-amber-700 dark:text-amber-400",
  active: "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400",
} as const;

/** The employee app: who has a login, inviting and removing, and releasing Form 16 to employees. */
export function AccessTab() {
  return (
    <div className="space-y-5">
      <Logins />
      <Form16Releases />
    </div>
  );
}

function Logins() {
  const utils = trpc.useUtils();
  const list = trpc.payrollAccess.loginList.useQuery();
  const [inviting, setInviting] = useState<{ employeeId: string; name: string; email: string } | null>(null);
  const [removing, setRemoving] = useState<{ employeeId: string; name: string } | null>(null);
  const refresh = () => void utils.payrollAccess.loginList.invalidate();
  const revoke = trpc.payrollAccess.revokeLogin.useMutation({
    onSuccess: () => {
      toast({ title: "Login removed", variant: "success" });
      setRemoving(null);
      refresh();
    },
    onError: onError("Could not remove the login"),
  });
  const rows = list.data ?? [];
  return (
    <Panel title="Employee logins" actions={<span className="text-xs text-text-tertiary">{EMPLOYEE_INVITE_NOTE}</span>}>
      {rows.length === 0 ? (
        <EmptyState title="No employees yet" description="Add employees first, then invite them to check in, see payslips and apply for leave from their phone." />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th>Employee</th><th>Login</th><th>Email</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.employeeId}>
                  <td className="font-medium text-text-primary">{e.name} <span className="text-xs font-normal text-text-tertiary">{e.code}</span></td>
                  <td>
                    <Badge color={STATE_COLOR[e.state]}>{STATE_LABEL[e.state]}</Badge>
                    {e.state === "invited" && e.invitationExpiresAt && <span className="ml-2 text-xs text-text-tertiary">until {formatDate(e.invitationExpiresAt)}</span>}
                  </td>
                  <td className="text-text-secondary">{e.loginEmail ?? e.email ?? ""}</td>
                  <td className="whitespace-nowrap text-right">
                    {e.state !== "active" && (
                      <button className="btn-secondary btn-sm mr-2" onClick={() => setInviting({ employeeId: e.employeeId, name: e.name, email: e.loginEmail ?? e.email ?? "" })}>
                        {e.state === "invited" ? "Resend" : "Invite"}
                      </button>
                    )}
                    {e.state !== "none" && <button className="btn-secondary btn-sm" onClick={() => setRemoving({ employeeId: e.employeeId, name: e.name })}>Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inviting && <InviteDialog target={inviting} onClose={() => setInviting(null)} onDone={refresh} />}
      <ConfirmDialog
        open={!!removing}
        title="Remove this login?"
        description={removing ? `${removing.name} will no longer be able to sign in to the employee app. Their payroll records stay as they are.` : ""}
        confirmLabel="Remove login"
        variant="danger"
        onConfirm={() => removing && revoke.mutate({ employeeId: removing.employeeId })}
        onCancel={() => setRemoving(null)}
      />
    </Panel>
  );
}

function InviteDialog({ target, onClose, onDone }: { target: { employeeId: string; name: string; email: string }; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(target.email);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const invite = trpc.payrollAccess.invite.useMutation({
    onSuccess: (r) => {
      setLink(r.inviteUrl);
      toast({ title: "Invitation sent", description: `${target.name} will get an email. The link works once and expires in 7 days.`, variant: "success" });
      onDone();
    },
    onError: (e) => setError((e as { message?: string }).message ?? "Could not send the invitation."),
  });
  function send() {
    const parsed = employeeInviteSchema.safeParse({ employeeId: target.employeeId, email });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose an employee." : parsed.error.issues[0]!.message);
    setError(null);
    invite.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title={`Invite ${target.name}`} className="max-w-md">
      <div className="space-y-3">
        {link ? (
          <>
            <p className="text-sm text-text-secondary">The invitation was emailed. You can also share this link yourself:</p>
            <input readOnly className="input w-full" value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
          </>
        ) : (
          <>
            <InputField label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="text-xs text-text-tertiary">The employee signs up (or signs in) with this address. It cannot be the address of a team member. {EMPLOYEE_INVITE_NOTE}</p>
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>{link ? "Done" : "Cancel"}</button>
          {!link && <button className="btn-primary" onClick={send} disabled={invite.isPending}>Send invitation</button>}
        </div>
      </div>
    </Modal>
  );
}

function Form16Releases() {
  const utils = trpc.useUtils();
  const years = trpc.payrollAccess.form16List.useQuery();
  const refresh = () => void utils.payrollAccess.form16List.invalidate();
  const release = trpc.payrollAccess.form16Release.useMutation({ onSuccess: refresh, onError: onError("Could not release Form 16") });
  const unrelease = trpc.payrollAccess.form16Unrelease.useMutation({ onSuccess: refresh, onError: onError("Could not withdraw Form 16") });
  const rows = years.data ?? [];
  return (
    <Panel title="Form 16 for employees" actions={<span className="text-xs text-text-tertiary">Employees see only their own, and only a year you release. It stays a working copy for CA review.</span>}>
      {rows.length === 0 ? (
        <EmptyState title="No payroll to release yet" description="A year appears here once it has an approved payroll run." />
      ) : (
        <ul className="divide-y divide-border-light">
          {rows.map((y) => (
            <li key={y.financialYear} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text-primary">Financial year {y.label}</p>
                <p className="text-xs text-text-tertiary">{y.released ? `Released ${y.releasedAt ? formatDate(y.releasedAt) : ""}` : "Not released"}</p>
              </div>
              {y.released ? (
                <button className="btn-secondary btn-sm" onClick={() => unrelease.mutate({ financialYear: y.financialYear })} disabled={unrelease.isPending}>Withdraw</button>
              ) : (
                <button className="btn-primary btn-sm" onClick={() => release.mutate({ financialYear: y.financialYear })} disabled={release.isPending}>Release to employees</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
