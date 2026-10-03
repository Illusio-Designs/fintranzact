import { FintranzactClient, FintranzactApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT } from "../../output.js";
import type { ColumnDef } from "../../output.js";

const SCOPES = ["all", "mine", "clients"] as const;
type Scope = (typeof SCOPES)[number];

interface ClientsOpts {
  json?: boolean;
  search?: string;
  scope?: string;
  limit?: string;
  cursor?: string;
}

interface ClientRow {
  tenantId: string;
  name: string;
  roleLabel: string;
  isOwnFirm: boolean;
  pinned: boolean;
  lastOpenedAt: string | null;
}

/** One table row: a star for pinned, the role as the accountant sees it, when it was last opened. */
export function clientRow(c: ClientRow) {
  return {
    name: `${c.pinned ? "* " : ""}${c.name}`,
    role: c.roleLabel,
    kind: c.isOwnFirm ? "own firm" : "client",
    opened: c.lastOpenedAt ? new Date(c.lastOpenedAt).toLocaleString() : "never",
    id: c.tenantId,
  };
}

/** `fintranzact tenant clients`: your organisations, pinned and recent first. */
export async function clientsCommand(opts: ClientsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new FintranzactClient(cfg);
  try {
    if (opts.scope && !(SCOPES as readonly string[]).includes(opts.scope)) fatalError(`Unknown scope "${opts.scope}". Use: ${SCOPES.join(", ")}`, EXIT.USAGE);
    const result = await client.tenant.listClients({
      search: opts.search,
      scope: opts.scope as Scope | undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      cursor: opts.cursor,
    });
    if (opts.json) {
      outputJSON(result);
      return;
    }
    const items = (result?.items ?? []) as ClientRow[];
    if (items.length === 0) {
      console.log("No organisations found.");
      return;
    }
    const rows = items.map(clientRow);
    const columns: ColumnDef<typeof rows[number]>[] = [
      { key: "name", header: "Organisation", align: "left" },
      { key: "role", header: "Your access", align: "left" },
      { key: "kind", header: "", align: "left" },
      { key: "opened", header: "Last opened", align: "left" },
      { key: "id", header: "ID", align: "left" },
    ];
    process.stdout.write("\n");
    outputTable(rows, columns);
    process.stdout.write("\n");
    if (result?.nextCursor) console.log(`More: fintranzact tenant clients --cursor ${result.nextCursor}`);
  } catch (e) {
    if (e instanceof FintranzactApiError) {
      const err = e.fintranzactError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: fintranzact login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
