import { auditLog } from "@fintranzact/db";
import type { TenantDatabase } from "../trpc.js";

export async function logAudit(
  db: TenantDatabase,
  params: {
    businessId: string;
    userId: string;
    action: string;       // e.g., "invoice.create", "payment.delete"
    entityType: string;   // e.g., "invoice", "payment"
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  }
) {
  try {
    await db.insert(auditLog).values({
      businessId: params.businessId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ipAddress: params.ipAddress || null,
    });
  } catch (err) {
    // Never let audit logging break the main operation
    console.error("[audit] Failed to write audit log:", err);
  }
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

type AuditCtx = {
  db: TenantDatabase;
  businessId: string;
  user: { id: string } | null;
  ipAddress?: string | null;
};

/**
 * Run a mutation and, once it has succeeded, write its audit entries (one per
 * entity it created or changed). Nothing is logged when the mutation throws.
 */
export async function audited<T>(
  ctx: AuditCtx,
  run: () => Promise<T>,
  describe: (result: T) => AuditEntry | AuditEntry[] | null | undefined,
): Promise<T> {
  const result = await run();
  const entries = describe(result);
  const list = !entries ? [] : Array.isArray(entries) ? entries : [entries];
  for (const e of list) {
    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user!.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      metadata: e.metadata,
      ipAddress: ctx.ipAddress ?? null,
    });
  }
  return result;
}

/**
 * Wrap a tRPC mutation resolver so a successful call writes its audit
 * entries: `.mutation(withAudit(async ({ input, ctx }) => …, (result, input) => entry))`.
 */
export function withAudit<Opts extends { ctx: AuditCtx; input: unknown }, R>(
  resolver: (opts: Opts) => Promise<R>,
  describe: (result: R, input: Opts["input"]) => AuditEntry | AuditEntry[] | null | undefined,
): (opts: Opts) => Promise<R> {
  return (opts) => audited(opts.ctx, () => resolver(opts), (r) => describe(r, opts.input));
}
