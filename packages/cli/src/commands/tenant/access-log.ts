import { FintranzactClient, FintranzactApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT } from "../../output.js";
import type { ColumnDef } from "../../output.js";

// Mirrors the Team tab filters (packages/shared access-log.ts); the CLI does not depend on the shared package.
export const FILTERS: Record<string, string[] | null> = {
  all: null,
  invites: ["access.invited", "access.invite_revoked", "access.accepted"],
  roles: ["access.role_changed"],
  removals: ["access.removed", "access.left"],
  opened: ["access.org_opened"],
  downloads: ["access.export"],
};

interface Person { name: string | null; email: string | null }
interface AccessEvent {
  createdAt: string;
  label: string;
  actor: Person | null;
  subject: Person | null;
  metadata: { role?: string; from?: string; to?: string; email?: string; procedure?: string };
}

const who = (p: Person | null | undefined, fallback = "") => (p ? p.name || p.email || fallback : fallback);

/** "Invited ca@firm.in (auditor), by Rohit": the API's label plus the people and the safe details. */
export function summary(e: AccessEvent): string {
  const m = e.metadata;
  const subject = who(e.subject, m.email ?? "");
  const detail = [m.role, m.from && m.to ? `${m.from} -> ${m.to}` : "", m.procedure].filter(Boolean).join(", ");
  return [e.label, subject && `(${subject}${detail ? `, ${detail}` : ""})`, !subject && detail && `(${detail})`, e.actor && `by ${who(e.actor)}`]
    .filter(Boolean)
    .join(" ");
}

interface AccessLogOpts {
  json?: boolean;
  limit?: string;
  filter?: string;
  cursor?: string;
}

/** `fintranzact tenant access-log`: who was invited, accepted, changed, removed, opened the books or downloaded. Owners and admins only. */
export async function accessLogCommand(opts: AccessLogOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new FintranzactClient(cfg);

  try {
    if (opts.filter && !(opts.filter in FILTERS)) fatalError(`Unknown filter "${opts.filter}". Use: ${Object.keys(FILTERS).join(", ")}`, EXIT.USAGE);
    const types = opts.filter ? FILTERS[opts.filter] : null;
    const limit = opts.limit ? Number(opts.limit) : undefined;
    const result = await client.tenant.accessLog({
      limit,
      cursor: opts.cursor,
      ...(types ? { type: types } : {}),
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const items = (result?.items ?? []) as AccessEvent[];
    if (items.length === 0) {
      console.log("No access events.");
      return;
    }

    const rows = items.map((e) => ({ when: new Date(e.createdAt).toLocaleString(), what: summary(e) }));
    const columns: ColumnDef<typeof rows[number]>[] = [
      { key: "when", header: "When", align: "left" },
      { key: "what", header: "Event", align: "left" },
    ];
    process.stdout.write("\n");
    outputTable(rows, columns);
    process.stdout.write("\n");
    if (result?.nextCursor) console.log(`More events: fintranzact tenant access-log --cursor ${result.nextCursor}`);
  } catch (e) {
    if (e instanceof FintranzactApiError) {
      const err = e.fintranzactError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: fintranzact login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
