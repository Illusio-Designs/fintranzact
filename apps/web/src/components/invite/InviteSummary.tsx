import { isCaRole } from "@fintranzact/shared";

export interface InviteSummaryInfo {
  tenantName: string;
  role: string;
  roleLabel: string;
  invitedByName: string | null;
  accessDescription: string | null;
}

/** Who invited you, to which organisation and as what. Accountant (CA) invites also spell out the access. */
export function InviteSummary({ info }: { info: InviteSummaryInfo }) {
  const inviter = info.invitedByName ?? "Someone";
  const ca = isCaRole(info.role);
  return (
    <div data-testid="invite-summary" className="mb-5 rounded-xl border border-border-light bg-surface-1 p-4 text-left">
      <p className="text-sm text-text-primary">
        <span className="font-medium">{inviter}</span> invited you to{" "}
        <span className="font-medium">{info.tenantName}</span>
        {ca ? " as their accountant" : ` as ${info.roleLabel}`}.
      </p>
      {ca && (
        <>
          <p className="mt-2 inline-block rounded bg-violet-600/[0.08] px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-400">
            Registered as accountant
          </p>
          <p className="mt-2 text-xs font-medium text-text-secondary">{info.roleLabel}</p>
          {info.accessDescription && <p className="mt-0.5 text-xs text-text-secondary">{info.accessDescription}</p>}
          <p className="mt-2 text-xs text-text-tertiary">The business can remove your access at any time. Your activity is logged.</p>
        </>
      )}
    </div>
  );
}
