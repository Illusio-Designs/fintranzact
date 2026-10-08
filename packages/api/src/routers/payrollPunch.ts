/**
 * Payroll Phase 3, HR side of attendance punches: the attendance settings (geofence policy, selfie
 * rules, rollup rules), work locations and who may punch where, the punch list and the review of
 * flagged punches, selfie viewing, and device keys for biometric middleware.
 *
 * Punch details (location, selfie) are personal data. The settings and locations need Payroll "update"
 * like other payroll setup; the punch list, reviews and selfies are limited to the HR role, owners and
 * admins (canViewAttendanceProof). Nothing here is logged beyond ids and decisions.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  attendanceDeviceKeys,
  attendanceSettings,
  employeePunches,
  employeePunchSelfies,
  employeeWorkLocations,
  employees,
  workLocations,
} from "@fintranzact/db";
import {
  GEOFENCE_RESULT_LABELS,
  attendanceSettingsSchema,
  istTimeOf,
  isIsoDate,
  punchReviewSchema,
  workLocationSchema,
  type GeofenceResult,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { logAudit, withAudit } from "../lib/audit.js";
import { assertInBusiness } from "../lib/business-scope.js";
import { assertPayroll, badRequest, notFound } from "../lib/payroll/access.js";
import { loadAttendanceSettings, purgeExpiredSelfies, punchClock, rollupEmployeeDays } from "../lib/payroll/punches.js";

const idInput = z.object({ id: z.string().uuid() });

/** The role that reviews flagged punches and sees selfies: HR, owners and admins. Accountants do not. */
export const ATTENDANCE_PROOF_ROLES = ["hr", "admin", "superadmin"] as const;

export function canViewAttendanceProof(role: string): boolean {
  return (ATTENDANCE_PROOF_ROLES as readonly string[]).includes(role);
}

function requireProofRole(role: string): void {
  if (!canViewAttendanceProof(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only HR, owners and admins can see attendance photos and locations." });
  }
}

/** The prefix of every device key, then the organisation and a secret: `fdk_<tenantId>_<48 hex>`. */
export const DEVICE_KEY_PREFIX = "fdk";

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export const payrollPunchRouter = router({
  // ── Settings ────────────────────────────────────────────────────────────────

  settings: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const { saved, ...values } = await loadAttendanceSettings(ctx.db, ctx.businessId);
    void saved;
    return values;
  }),

  updateSettings: memberProcedure.input(attendanceSettingsSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      if (input.halfDayMinHours !== null && input.fullDayMinHours !== null && input.halfDayMinHours >= input.fullDayMinHours) {
        throw badRequest("The half-day hours must be fewer than the full-day hours.");
      }
      const values = {
        businessId: ctx.businessId,
        punchEnabled: input.punchEnabled,
        geofencePolicy: input.geofencePolicy,
        accuracyThresholdM: input.accuracyThresholdM,
        selfieRequired: input.selfieRequired,
        selfieRetentionDays: input.selfieRetentionDays,
        lateGraceMinutes: input.lateGraceMinutes,
        fullDayMinHours: input.fullDayMinHours === null ? null : String(input.fullDayMinHours),
        halfDayMinHours: input.halfDayMinHours === null ? null : String(input.halfDayMinHours),
        overtimeFromPunches: input.overtimeFromPunches,
        updatedAt: new Date(),
      };
      await ctx.db.insert(attendanceSettings).values(values).onConflictDoUpdate({ target: attendanceSettings.businessId, set: values });
      // A shorter retention takes effect straight away.
      const purged = await purgeExpiredSelfies(ctx.db, punchClock.now(), ctx.businessId);
      return { geofencePolicy: input.geofencePolicy, selfieRetentionDays: input.selfieRetentionDays, purged };
    }, (r) => ({ action: "payroll.attendanceSettings.update", entityType: "attendanceSettings", entityId: null, metadata: { geofencePolicy: r.geofencePolicy, selfieRetentionDays: r.selfieRetentionDays, selfiesPurged: r.purged } })),
  ),

  // ── Work locations ──────────────────────────────────────────────────────────

  locationList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const [locs, assigned] = await Promise.all([
      ctx.db.select().from(workLocations).where(eq(workLocations.businessId, ctx.businessId)).orderBy(asc(workLocations.name)),
      ctx.db.select({ locationId: employeeWorkLocations.locationId, n: sql<number>`count(*)::int` }).from(employeeWorkLocations).where(eq(employeeWorkLocations.businessId, ctx.businessId)).groupBy(employeeWorkLocations.locationId),
    ]);
    const count = new Map(assigned.map((a) => [a.locationId, a.n]));
    return locs.map((l) => ({ ...l, assignedEmployees: count.get(l.id) ?? 0 }));
  }),

  locationCreate: memberProcedure.input(workLocationSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [row] = await ctx.db.insert(workLocations).values({ businessId: ctx.businessId, name: input.name, lat: input.lat, lng: input.lng, radiusM: input.radiusM }).returning();
      return row!;
    }, (r) => ({ action: "payroll.workLocation.create", entityType: "workLocation", entityId: r.id, metadata: { name: r.name, radiusM: r.radiusM } })),
  ),

  locationUpdate: memberProcedure.input(workLocationSchema.partial().extend({ id: z.string().uuid(), isActive: z.boolean().optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const { id, ...rest } = input;
      const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length === 0) throw badRequest("Nothing to change.");
      const [row] = await ctx.db.update(workLocations).set(set).where(and(eq(workLocations.id, id), eq(workLocations.businessId, ctx.businessId))).returning();
      if (!row) throw notFound("Work location");
      return { row, fields: Object.keys(set) };
    }, (r) => ({ action: "payroll.workLocation.update", entityType: "workLocation", entityId: r.row.id, metadata: { fields: r.fields } })),
  ),

  locationDelete: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [row] = await ctx.db.delete(workLocations).where(and(eq(workLocations.id, input.id), eq(workLocations.businessId, ctx.businessId))).returning({ id: workLocations.id, name: workLocations.name });
      if (!row) throw notFound("Work location");
      return row;
    }, (r) => ({ action: "payroll.workLocation.delete", entityType: "workLocation", entityId: r.id, metadata: { name: r.name } })),
  ),

  /** Which locations an employee may punch at. An employee with none may punch at any active location. */
  employeeLocations: viewerProcedure.input(z.object({ employeeId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    await assertInBusiness(ctx.db, employees, input.employeeId, ctx.businessId, "Employee");
    const rows = await ctx.db.select({ locationId: employeeWorkLocations.locationId }).from(employeeWorkLocations).where(and(eq(employeeWorkLocations.businessId, ctx.businessId), eq(employeeWorkLocations.employeeId, input.employeeId)));
    return rows.map((r) => r.locationId);
  }),

  locationAssign: memberProcedure.input(z.object({ employeeId: z.string().uuid(), locationIds: z.array(z.string().uuid()).max(50) })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await assertInBusiness(ctx.db, employees, input.employeeId, ctx.businessId, "Employee");
      const ids = [...new Set(input.locationIds)];
      if (ids.length) await assertInBusiness(ctx.db, workLocations, ids, ctx.businessId, "Work location");
      await ctx.db.transaction(async (tx) => {
        await tx.delete(employeeWorkLocations).where(and(eq(employeeWorkLocations.businessId, ctx.businessId), eq(employeeWorkLocations.employeeId, input.employeeId)));
        if (ids.length) await tx.insert(employeeWorkLocations).values(ids.map((locationId) => ({ businessId: ctx.businessId, employeeId: input.employeeId, locationId })));
      });
      return { employeeId: input.employeeId, count: ids.length };
    }, (r) => ({ action: "payroll.workLocation.assign", entityType: "employee", entityId: r.employeeId, metadata: { count: r.count } })),
  ),

  // ── Punches and review (HR, owners, admins) ─────────────────────────────────

  /**
   * Punches for a day or a range, newest first. `review`: "pending" = flagged punches waiting for a decision,
   * "flagged" = every flagged punch, anything else = all.
   */
  punches: viewerProcedure
    .input(z.object({
      from: z.string().refine(isIsoDate).optional(),
      to: z.string().refine(isIsoDate).optional(),
      employeeId: z.string().uuid().optional(),
      review: z.enum(["pending", "flagged", "all"]).default("all"),
      limit: z.number().int().min(1).max(500).default(200),
    }).optional())
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "read");
      requireProofRole(ctx.role);
      const conds = [eq(employeePunches.businessId, ctx.businessId)];
      if (input?.from) conds.push(gte(employeePunches.workDate, input.from));
      if (input?.to) conds.push(lte(employeePunches.workDate, input.to));
      if (input?.employeeId) conds.push(eq(employeePunches.employeeId, input.employeeId));
      if (input?.review === "pending") conds.push(eq(employeePunches.reviewStatus, "pending"));
      if (input?.review === "flagged") conds.push(isNotNull(employeePunches.reviewStatus));
      const rows = await ctx.db
        .select({
          p: employeePunches,
          name: employees.name,
          code: employees.employeeCode,
          hasSelfie: sql<boolean>`EXISTS (SELECT 1 FROM employee_punch_selfies s WHERE s.punch_id = ${employeePunches.id})`,
          locationName: sql<string | null>`(SELECT w.name FROM work_locations w WHERE w.id = ${employeePunches.locationId})`,
        })
        .from(employeePunches)
        .innerJoin(employees, eq(employees.id, employeePunches.employeeId))
        .where(and(...conds))
        .orderBy(desc(employeePunches.punchedAt))
        .limit(input?.limit ?? 200);
      return rows.map(({ p, name, code, hasSelfie, locationName }) => ({
        id: p.id,
        employeeId: p.employeeId,
        employeeName: name,
        employeeCode: code,
        kind: p.kind as "in" | "out",
        punchedAt: p.punchedAt,
        time: istTimeOf(p.punchedAt.getTime()),
        workDate: p.workDate,
        source: p.source,
        deviceId: p.deviceId,
        geofenceResult: p.geofenceResult as GeofenceResult,
        geofenceLabel: GEOFENCE_RESULT_LABELS[p.geofenceResult as GeofenceResult] ?? p.geofenceResult,
        distanceM: p.distanceM,
        accuracyM: p.accuracyM,
        lat: p.lat,
        lng: p.lng,
        locationName,
        flags: p.flags,
        reviewStatus: p.reviewStatus,
        reviewNote: p.reviewNote,
        reviewedAt: p.reviewedAt,
        hasSelfie,
      }));
    }),

  /** Approve (the punch counts) or reject (it does not count) a flagged punch. The day's attendance is recomputed. */
  review: memberProcedure.input(punchReviewSchema).mutation(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    requireProofRole(ctx.role);
    const [punch] = await ctx.db.select().from(employeePunches).where(and(eq(employeePunches.id, input.punchId), eq(employeePunches.businessId, ctx.businessId))).limit(1);
    if (!punch) throw notFound("Punch");
    if (punch.reviewStatus === null) throw badRequest("This punch was not flagged, so there is nothing to review.");
    const status = input.decision === "approve" ? "approved" : "rejected";
    const [row] = await ctx.db
      .update(employeePunches)
      .set({ reviewStatus: status, reviewedByUserId: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note || null })
      .where(eq(employeePunches.id, punch.id))
      .returning();
    const rolled = await rollupEmployeeDays(ctx.db, ctx.businessId, punch.employeeId, [punch.workDate]);
    await logAudit(ctx.db, { businessId: ctx.businessId, userId: ctx.user.id, action: `payroll.punch.${input.decision}`, entityType: "employeePunch", entityId: punch.id, metadata: { result: punch.geofenceResult, lockedDays: rolled.skippedLocked.length }, ipAddress: ctx.ipAddress, role: ctx.role });
    return { id: row!.id, reviewStatus: row!.reviewStatus, attendanceLocked: rolled.skippedLocked.length > 0 };
  }),

  /** The selfie of a punch (a data URL), for HR, owners and admins only. Never public, never in a list. */
  selfie: viewerProcedure.input(z.object({ punchId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    requireProofRole(ctx.role);
    const [row] = await ctx.db
      .select({ data: employeePunchSelfies.data, mime: employeePunchSelfies.mimeType, capturedAt: employeePunchSelfies.capturedAt })
      .from(employeePunchSelfies)
      .where(and(eq(employeePunchSelfies.punchId, input.punchId), eq(employeePunchSelfies.businessId, ctx.businessId)))
      .limit(1);
    if (!row) throw notFound("Photo (it may have been deleted after the retention period)");
    return { dataUrl: `data:${row.mime};base64,${Buffer.from(row.data).toString("base64")}`, capturedAt: row.capturedAt };
  }),

  // ── Device keys (biometric middleware) ──────────────────────────────────────

  deviceKeyList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db
      .select({ id: attendanceDeviceKeys.id, name: attendanceDeviceKeys.name, keyPrefix: attendanceDeviceKeys.keyPrefix, lastUsedAt: attendanceDeviceKeys.lastUsedAt, revokedAt: attendanceDeviceKeys.revokedAt, createdAt: attendanceDeviceKeys.createdAt })
      .from(attendanceDeviceKeys)
      .where(eq(attendanceDeviceKeys.businessId, ctx.businessId))
      .orderBy(desc(attendanceDeviceKeys.createdAt));
  }),

  /** Make a key for a device or middleware to push punches (POST /api/attendance/push). The key is shown once. */
  deviceKeyCreate: memberProcedure.input(z.object({ name: z.string().trim().min(1).max(60) })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [active] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(attendanceDeviceKeys).where(and(eq(attendanceDeviceKeys.businessId, ctx.businessId), sql`${attendanceDeviceKeys.revokedAt} IS NULL`));
      if ((active?.n ?? 0) >= 10) throw badRequest("A business can have up to 10 active device keys. Revoke one first.");
      const key = `${DEVICE_KEY_PREFIX}_${ctx.tenantId}_${randomBytes(24).toString("hex")}`;
      const [row] = await ctx.db
        .insert(attendanceDeviceKeys)
        .values({ businessId: ctx.businessId, name: input.name, keyHash: hashDeviceKey(key), keyPrefix: key.slice(0, DEVICE_KEY_PREFIX.length + 1 + 8), createdByUserId: ctx.user.id })
        .returning({ id: attendanceDeviceKeys.id, name: attendanceDeviceKeys.name });
      return { id: row!.id, name: row!.name, key };
    }, (r) => ({ action: "payroll.deviceKey.create", entityType: "deviceKey", entityId: r.id, metadata: { name: r.name } })),
  ),

  deviceKeyRevoke: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [row] = await ctx.db
        .update(attendanceDeviceKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(attendanceDeviceKeys.id, input.id), eq(attendanceDeviceKeys.businessId, ctx.businessId), sql`${attendanceDeviceKeys.revokedAt} IS NULL`))
        .returning({ id: attendanceDeviceKeys.id, name: attendanceDeviceKeys.name });
      if (!row) throw notFound("Device key");
      return row;
    }, (r) => ({ action: "payroll.deviceKey.revoke", entityType: "deviceKey", entityId: r.id, metadata: { name: r.name } })),
  ),
});
