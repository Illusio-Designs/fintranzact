import { relativeTime } from "@fintranzact/shared";
import { formatDate } from "@/lib/utils";

export interface ManagedClientView {
  tenantId: string;
  name: string;
  roleLabel: string;
  since: string;
  lastOpenedAt: string | null;
  planName: string;
}

/**
 * Partner portal: organisations where the partner's own login holds an accountant
 * (CA) role. Who, what access, since when, last opened, plan. No financial data.
 */
export function ManagedClientsSection({ clients, more }: { clients: ManagedClientView[]; more?: boolean }) {
  return (
    <section data-testid="managed-clients" className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
      <h3 className="border-b border-border-light px-5 py-3 text-[15px] font-bold text-text-primary">Clients you manage</h3>
      {clients.length === 0 ? (
        <p data-testid="managed-clients-empty" className="px-5 py-8 text-center text-sm text-text-tertiary">
          No clients yet. When a business invites you as its CA ("Invite my CA" in its Team settings) and you accept
          with this login, it appears here. You only see who and when, never their books.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Access</th>
                <th className="hidden sm:table-cell">Since</th>
                <th>Last opened</th>
                <th className="hidden sm:table-cell">Plan</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.tenantId}>
                  <td className="font-medium [overflow-wrap:anywhere]">{c.name}</td>
                  <td className="text-text-secondary">{c.roleLabel}</td>
                  <td className="hidden sm:table-cell text-xs text-text-secondary">{formatDate(c.since)}</td>
                  <td className="text-xs text-text-secondary">{c.lastOpenedAt ? relativeTime(c.lastOpenedAt) : "Never"}</td>
                  <td className="hidden sm:table-cell text-xs text-text-secondary">{c.planName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && <p className="px-5 py-3 text-xs text-text-tertiary">Showing your latest {clients.length} clients.</p>}
        </div>
      )}
    </section>
  );
}
