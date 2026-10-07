/**
 * Where a change came from, recorded on its audit entry as `metadata.source`.
 *
 * The AI assistant (Phase 2) runs the person's confirmed action by calling the
 * normal tRPC procedure in process. That procedure writes its own audit entry
 * (invoice.create, payment.create...) in many different ways, so instead of
 * threading a flag through every one of them the confirm step runs the call
 * inside `runWithAuditSource`; `logAudit` (the single writer under all of them)
 * reads it and adds `source` to the entry's metadata. The Activity Log shows
 * "via AI assistant" from that field, like the assistant's own entries.
 *
 * AsyncLocalStorage follows the call (and fire-and-forget audit writes started
 * inside it), and nothing outside the `run` callback ever sees the value.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const AUDIT_SOURCE_AI = "via AI assistant";

interface AuditSource {
  source: string;
  /** The pending action this change is the result of. */
  actionId?: string;
}

const storage = new AsyncLocalStorage<AuditSource>();

export function runWithAuditSource<T>(source: AuditSource, fn: () => Promise<T>): Promise<T> {
  return storage.run(source, fn);
}

/** `metadata` with the ambient source added (an explicit `source` already in it wins). */
export function withAuditSource(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const ambient = storage.getStore();
  if (!ambient) return metadata;
  if (metadata && "source" in metadata) return metadata;
  return { ...metadata, source: ambient.source, ...(ambient.actionId ? { aiActionId: ambient.actionId } : {}) };
}
