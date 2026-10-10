/**
 * POST /api/attendance/push: biometric devices or their middleware push punches.
 *
 * Authentication is a per-business DEVICE KEY (made in Payroll, Attendance, Devices; shown once),
 * sent as `Authorization: Bearer fdk_<organisationId>_<secret>`. The key is not a user's API key and
 * is not accepted anywhere else: it can do exactly one thing, add punches to its own business. Only the
 * SHA-256 of the key is stored; a revoked key stops working at once.
 *
 * Entitlement policy (rest-entitlement-policy.ts): "write-gated". It needs the Payroll add-on and is
 * refused while the organisation is read-only or suspended, with the standard 403 { error, entitlement }
 * body.
 *
 * Request  { punches: [{ employeeCode, timestamp, direction?: "in" | "out" | "auto", deviceId? }] }, at most 500 punches
 *          and 256 KB. `timestamp` is ISO 8601 with an offset, or "YYYY-MM-DD HH:MM:SS" in IST.
 * Response { batchId, summary: { rows, imported, duplicates, unknownEmployees, invalid, ... }, unknown: [...], rejected: [{ index, reason }] }
 * Idempotent: a punch with the same employee, time and device is stored once however often it is sent.
 * Rate limited: 60 requests a minute per key and 120 per address.
 */

import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, isNull } from "drizzle-orm";
import { attendanceDeviceKeys, getTenantDb } from "@fintranzact/db";
import { devicePushSchema, parseDeviceTimestamp, type ParsedImportPunch } from "@fintranzact/shared";
import { entitlementRefusalBody, refuseIfReadOnly } from "./entitlement-guard.js";
import { getEntitlements } from "../lib/entitlements.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { logAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { tenantBusinessIds } from "../lib/business-membership.js";
import { clientIpFromHeaders } from "../lib/client-ip.js";
import { importPunches, punchClock } from "../lib/payroll/punches.js";
import { DEVICE_KEY_PREFIX, hashDeviceKey } from "../routers/payrollPunch.js";

const perKey = createFixedWindowLimiter({ limit: 60, windowMs: 60_000 });
const perIp = createFixedWindowLimiter({ limit: 120, windowMs: 60_000 });

/** The per-key limiter, exported so a test can fill it without sending a minute's worth of requests. */
export const attendancePushKeyLimiter = perKey;

/** Tests clear the limiters. */
export function resetAttendancePushLimits(): void {
  perKey.clear();
  perIp.clear();
}

const KEY_RE = new RegExp(`^${DEVICE_KEY_PREFIX}_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[0-9a-f]{48}$`);
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const rateLimitDisabled = () => process.env.DISABLE_RATE_LIMIT === "1" && process.env.NODE_ENV !== "production";

export function registerAttendancePushRoute(app: Hono): void {
  app.post("/api/attendance/push", bodyLimit({ maxSize: 256 * 1024 }), async (c: Context) => {
    const ip = clientIpFromHeaders((name) => c.req.header(name)) ?? "unknown";
    if (!rateLimitDisabled() && !perIp.hit(ip)) return c.json({ error: "Too many requests", code: "rate_limited" }, 429);

    const auth = c.req.header("authorization") ?? "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const m = KEY_RE.exec(key);
    if (!m) return c.json({ error: "Missing or invalid device key", code: "unauthorized" }, 401);
    const tenantId = m[1]!;

    let db: Awaited<ReturnType<typeof getTenantDb>>;
    try {
      db = await getTenantDb(tenantId);
    } catch {
      return c.json({ error: "Missing or invalid device key", code: "unauthorized" }, 401);
    }
    const [row] = await db
      .select()
      .from(attendanceDeviceKeys)
      .where(and(eq(attendanceDeviceKeys.keyHash, hashDeviceKey(key)), isNull(attendanceDeviceKeys.revokedAt)))
      .limit(1);
    // The key must belong to a business of the organisation named in it (a shared database holds many organisations).
    if (!row || !(await tenantBusinessIds(db, tenantId)).includes(row.businessId)) {
      return c.json({ error: "Missing or invalid device key", code: "unauthorized" }, 401);
    }
    if (!rateLimitDisabled() && !perKey.hit(row.id)) return c.json({ error: "Too many requests for this key", code: "rate_limited" }, 429);

    const ent = await getEntitlements(tenantId);
    if (ent.reason === "tenant_suspended") return c.json(entitlementRefusalBody(ent.reason), 403);
    const refused = await refuseIfReadOnly(c, tenantId);
    if (refused) return refused;
    if (!ent.addons.payroll) {
      const refusal = entitlementRefusalBody("addon_required");
      return c.json({ ...refusal, entitlement: { ...refusal.entitlement, addon: "payroll" } }, 403);
    }

    let body: ReturnType<typeof devicePushSchema.parse>;
    try {
      body = devicePushSchema.parse(await c.req.json());
    } catch {
      return c.json({ error: "Send { punches: [{ employeeCode, timestamp, direction?, deviceId? }] } with 1 to 500 punches.", code: "bad_request" }, 400);
    }

    const punches: ParsedImportPunch[] = [];
    const rejected: Array<{ index: number; reason: string }> = [];
    body.punches.forEach((p, i) => {
      const at = parseDeviceTimestamp(p.timestamp);
      if (Number.isNaN(at)) {
        rejected.push({ index: i, reason: "timestamp could not be read" });
        return;
      }
      punches.push({ row: i + 1, employeeCode: p.employeeCode, at, direction: p.direction, deviceId: (p.deviceId || row.name).slice(0, 60) });
    });

    try {
      const out = await importPunches(db, { businessId: row.businessId, source: "device", punches, invalidRows: rejected.length, deviceKeyId: row.id, actorUserId: row.createdByUserId, now: punchClock.now() });
      await db.update(attendanceDeviceKeys).set({ lastUsedAt: new Date() }).where(eq(attendanceDeviceKeys.id, row.id));
      await logAudit(db, { businessId: row.businessId, userId: row.createdByUserId ?? NIL_UUID, action: "payroll.attendance.devicePush", entityType: "attendanceImport", entityId: out.batchId, metadata: { key: row.keyPrefix, ...out.summary }, ipAddress: ip === "unknown" ? null : ip });
      return c.json({ batchId: out.batchId, summary: out.summary, unknown: out.unknown, rejected }, 200);
    } catch (err) {
      logger.error({ err }, "[attendance-push] failed");
      return c.json({ error: "Something went wrong. Please try again.", code: "internal" }, 500);
    }
  });
}
