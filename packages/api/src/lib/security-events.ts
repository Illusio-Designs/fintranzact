import { controlDb, securityEvents } from "@fintranzact/db";
import type { SecurityEventType } from "@fintranzact/shared";

export { SECURITY_EVENT_TYPES } from "@fintranzact/shared";
export type { SecurityEventType } from "@fintranzact/shared";

export interface SecurityEventInput {
  /** The account the event is about. */
  userId?: string | null;
  /** The admin who acted, when it was not the subject (e.g. a platform reset). */
  actorUserId?: string | null;
  tenantId?: string | null;
  type: SecurityEventType;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append to the security trail. Never throws: a logging failure must not break sign-in. */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await controlDb.insert(securityEvents).values({
      userId: input.userId ?? null,
      actorUserId: input.actorUserId ?? null,
      tenantId: input.tenantId ?? null,
      type: input.type,
      ip: input.ip ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 500) : null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    console.error("[security-events] Failed to record security event:", err);
  }
}
