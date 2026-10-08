/**
 * Punches (Payroll Phase 3): settings, allowed locations, the rollup of punches into the daily
 * attendance the payroll run already reads, biometric import, and selfie retention.
 *
 * The rules are pure functions in packages/shared (payroll-self.ts); this file loads data, applies
 * them and writes. docs/architecture/payroll-self-service.md.
 *
 * The rollup never fights HR: it only writes or removes rows whose `source` is "punch". A day HR marked
 * (source "manual"), a leave day ("leave") and a day filled at lock time ("lock") are never touched, and
 * a month locked by a payroll run (status past "draft") is never changed.
 */

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  attendanceImportBatches,
  attendanceRecords,
  attendanceSettings,
  employeePunches,
  employeePunchSelfies,
  employeeWorkLocations,
  employees,
  payrollShifts,
  workLocations,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  PUSH_MAX_PUNCHES,
  addDays,
  istDateOf,
  monthOf,
  rollupDay,
  sequencePunches,
  istInstant,
  type AttendanceSettingsInput,
  type GeofencePolicy,
  type ImportDirection,
  type ParsedImportPunch,
  type RollupPolicy,
  type ShiftLike,
  type WorkLocationLike,
} from "@fintranzact/shared";
import { loadPayrollSettings, lockedRunForMonth } from "./data.js";

type Db = Pick<TenantDatabase, "select" | "selectDistinct" | "insert" | "update" | "delete">;

/** The clock punches are stamped with: always the server's. Tests replace `now`. */
export const punchClock = { now: (): Date => new Date() };

// ── Settings and locations ───────────────────────────────────────────────────

export async function loadAttendanceSettings(db: Db, businessId: string): Promise<AttendanceSettingsInput & { saved: boolean }> {
  const [row] = await db.select().from(attendanceSettings).where(eq(attendanceSettings.businessId, businessId)).limit(1);
  if (!row) return { ...DEFAULT_ATTENDANCE_SETTINGS, saved: false };
  return {
    punchEnabled: row.punchEnabled,
    geofencePolicy: row.geofencePolicy as GeofencePolicy,
    accuracyThresholdM: row.accuracyThresholdM,
    selfieRequired: row.selfieRequired,
    selfieRetentionDays: row.selfieRetentionDays,
    lateGraceMinutes: row.lateGraceMinutes,
    fullDayMinHours: row.fullDayMinHours === null ? null : Number(row.fullDayMinHours),
    halfDayMinHours: row.halfDayMinHours === null ? null : Number(row.halfDayMinHours),
    overtimeFromPunches: row.overtimeFromPunches,
    saved: true,
  };
}

export function rollupPolicyOf(s: AttendanceSettingsInput): RollupPolicy {
  return { lateGraceMinutes: s.lateGraceMinutes, fullDayMinHours: s.fullDayMinHours, halfDayMinHours: s.halfDayMinHours, overtimeFromPunches: s.overtimeFromPunches };
}

/** The active work locations an employee may punch at: the ones assigned to them, else every active location. */
export async function allowedLocations(db: Db, businessId: string, employeeId: string): Promise<WorkLocationLike[]> {
  const assigned = await db
    .select({ locationId: employeeWorkLocations.locationId })
    .from(employeeWorkLocations)
    .where(and(eq(employeeWorkLocations.businessId, businessId), eq(employeeWorkLocations.employeeId, employeeId)));
  const rows = await db
    .select()
    .from(workLocations)
    .where(and(
      eq(workLocations.businessId, businessId),
      eq(workLocations.isActive, true),
      ...(assigned.length ? [inArray(workLocations.id, assigned.map((a) => a.locationId))] : []),
    ));
  return rows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, radiusM: r.radiusM }));
}

// ── Rollup ───────────────────────────────────────────────────────────────────

export interface RollupResult {
  written: number;
  removed: number;
  skippedLocked: string[];
  skippedHr: number;
}

/**
 * Recompute the derived attendance of an employee's work dates from their punches. Idempotent.
 * `dates` are IST days ("YYYY-MM-DD"); pairs that straddle midnight belong to the check-in day.
 */
export async function rollupEmployeeDays(db: Db, businessId: string, employeeId: string, dates: readonly string[]): Promise<RollupResult> {
  const result: RollupResult = { written: 0, removed: 0, skippedLocked: [], skippedHr: 0 };
  const days = [...new Set(dates)].sort();
  if (days.length === 0) return result;

  const [emp] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId))).limit(1);
  if (!emp) return result;
  const settings = await loadAttendanceSettings(db, businessId);
  const base = await loadPayrollSettings(db, businessId);
  let shift: ShiftLike | null = null;
  if (emp.shiftId) {
    const [s] = await db.select().from(payrollShifts).where(eq(payrollShifts.id, emp.shiftId)).limit(1);
    if (s) shift = { startTime: s.startTime, endTime: s.endTime, standardHours: Number(s.standardHours) };
  }

  const from = new Date(istInstant(addDays(days[0]!, -2)));
  const to = new Date(istInstant(addDays(days[days.length - 1]!, 3)));
  const punches = await db
    .select({ kind: employeePunches.kind, at: employeePunches.punchedAt, review: employeePunches.reviewStatus })
    .from(employeePunches)
    .where(and(eq(employeePunches.employeeId, employeeId), gte(employeePunches.punchedAt, from), lt(employeePunches.punchedAt, to)))
    .orderBy(asc(employeePunches.punchedAt));
  const seq = sequencePunches(punches.map((p) => ({ kind: p.kind as "in" | "out", at: p.at.getTime(), rejected: p.review === "rejected" })));

  const existing = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, employeeId), inArray(attendanceRecords.date, days)));
  const byDate = new Map(existing.map((r) => [r.date, r]));
  const lockedMonths = new Map<string, boolean>();

  for (const date of days) {
    if (date < emp.dateOfJoining || (emp.lastWorkingDay && date > emp.lastWorkingDay)) continue;
    const month = monthOf(date);
    if (!lockedMonths.has(month)) lockedMonths.set(month, !!(await lockedRunForMonth(db, businessId, month)));
    if (lockedMonths.get(month)) {
      result.skippedLocked.push(date);
      continue;
    }
    const current = byDate.get(date);
    if (current && current.source !== "punch") {
      result.skippedHr++;
      continue;
    }
    const roll = rollupDay(seq.pairs.filter((p) => p.workDate === date), shift, rollupPolicyOf(settings), base.standardHoursPerDay);
    if (!roll.status) {
      if (current) {
        await db.delete(attendanceRecords).where(eq(attendanceRecords.id, current.id));
        result.removed++;
      }
      continue;
    }
    const values = {
      businessId,
      employeeId,
      date,
      status: roll.status,
      leaveTypeId: null,
      checkIn: roll.checkIn,
      checkOut: roll.checkOut,
      overtimeHours: String(roll.overtimeHours),
      note: roll.lateMinutes > 0 ? `Late by ${roll.lateMinutes} min (from punches)` : "From punches",
      source: "punch",
      markedByUserId: null,
      updatedAt: new Date(),
    };
    await db
      .insert(attendanceRecords)
      .values(values)
      .onConflictDoUpdate({ target: [attendanceRecords.employeeId, attendanceRecords.date], set: values, setWhere: sql`${attendanceRecords.source} = 'punch'` });
    result.written++;
  }
  return result;
}

// ── Biometric import ─────────────────────────────────────────────────────────

export interface ImportSummary {
  rows: number;
  imported: number;
  duplicates: number;
  unknownEmployees: number;
  invalid: number;
  futureDated: number;
  /** Days whose attendance could not be updated because their payroll run locked the month. */
  lockedDays: number;
  rolledUp: number;
}

export interface UnknownCode {
  code: string;
  rows: number[];
}

export interface ImportOutcome {
  summary: ImportSummary;
  unknown: UnknownCode[];
  fromDate: string | null;
  toDate: string | null;
  batchId: string | null;
  lockedDates: string[];
}

export interface ImportArgs {
  businessId: string;
  source: "file" | "device";
  punches: readonly ParsedImportPunch[];
  /** Rows that could not be read at all (counted as invalid). */
  invalidRows?: number;
  fileName?: string | null;
  actorUserId?: string | null;
  deviceKeyId?: string | null;
  dryRun?: boolean;
  now: Date;
}

const FUTURE_SLACK_MS = 24 * 3_600_000;
const CHUNK = 400;

const dupKey = (employeeId: string, at: number, deviceId: string) => `${employeeId}|${at}|${deviceId}`;

/**
 * Import device punches for a business: map codes to employees, resolve "auto" directions against the
 * punches already stored, skip what is already there (employee + time + device), store the rest and roll
 * the affected days up. With `dryRun` nothing is written and the summary says what would happen.
 */
export async function importPunches(db: Db & { transaction: TenantDatabase["transaction"] }, args: ImportArgs): Promise<ImportOutcome> {
  const summary: ImportSummary = { rows: args.punches.length + (args.invalidRows ?? 0), imported: 0, duplicates: 0, unknownEmployees: 0, invalid: args.invalidRows ?? 0, futureDated: 0, lockedDays: 0, rolledUp: 0 };
  const codes = [...new Set(args.punches.map((p) => p.employeeCode))];
  const emps = codes.length
    ? await db.select({ id: employees.id, code: employees.employeeCode }).from(employees).where(and(eq(employees.businessId, args.businessId), inArray(employees.employeeCode, codes)))
    : [];
  const idOf = new Map(emps.map((e) => [e.code, e.id]));

  const unknown = new Map<string, number[]>();
  const known: Array<ParsedImportPunch & { employeeId: string }> = [];
  for (const p of args.punches) {
    const id = idOf.get(p.employeeCode);
    if (!id) {
      unknown.set(p.employeeCode, [...(unknown.get(p.employeeCode) ?? []), p.row]);
      summary.unknownEmployees++;
      continue;
    }
    if (p.at > args.now.getTime() + FUTURE_SLACK_MS) {
      summary.futureDated++;
      summary.invalid++;
      continue;
    }
    known.push({ ...p, employeeId: id });
  }

  // Per employee: resolve directions against what is already stored, then drop what is a stored duplicate.
  const toInsert: Array<typeof employeePunches.$inferInsert> = [];
  const affected = new Map<string, Set<string>>();
  const seenInFile = new Set<string>();
  const byEmployee = new Map<string, typeof known>();
  for (const k of known) byEmployee.set(k.employeeId, [...(byEmployee.get(k.employeeId) ?? []), k]);

  for (const [employeeId, list] of byEmployee) {
    const times = list.map((p) => p.at);
    const from = new Date(Math.min(...times) - 2 * 86_400_000);
    const to = new Date(Math.max(...times) + 2 * 86_400_000);
    const stored = await db
      .select({ kind: employeePunches.kind, at: employeePunches.punchedAt, device: employeePunches.deviceId, source: employeePunches.source, review: employeePunches.reviewStatus })
      .from(employeePunches)
      .where(and(eq(employeePunches.employeeId, employeeId), gte(employeePunches.punchedAt, from), lt(employeePunches.punchedAt, to)));
    const storedKeys = new Set(stored.filter((s) => s.source === "biometric").map((s) => dupKey(employeeId, s.at.getTime(), s.device)));

    const fresh = list.filter((p) => {
      const key = dupKey(employeeId, p.at, p.deviceId);
      if (storedKeys.has(key) || seenInFile.has(key)) {
        summary.duplicates++;
        return false;
      }
      seenInFile.add(key);
      return true;
    });
    if (fresh.length === 0) continue;
    const combined = [
      ...stored.map((s) => ({ kind: s.kind as ImportDirection, at: s.at.getTime(), rejected: s.review === "rejected" })),
      ...fresh.map((p) => ({ kind: p.direction, at: p.at })),
    ];
    const seq = sequencePunches(combined);
    fresh.forEach((p, i) => {
      const r = seq.resolved[stored.length + i]!;
      const kind = r.kind === "in" || r.kind === "out" ? r.kind : p.direction === "out" ? "out" : "in";
      const workDate = r.workDate;
      toInsert.push({
        businessId: args.businessId,
        employeeId,
        kind,
        punchedAt: new Date(p.at),
        workDate,
        source: "biometric",
        deviceId: p.deviceId,
        geofenceResult: "not_checked",
        flags: r.kind === "duplicate" ? ["duplicate"] : [],
        createdByUserId: args.actorUserId ?? null,
      });
      const set = affected.get(employeeId) ?? new Set<string>();
      set.add(workDate);
      // A check-out after midnight pairs with the previous day's check-in: roll both days up.
      set.add(istDateOf(p.at));
      affected.set(employeeId, set);
    });
  }

  const allDates = [...affected.values()].flatMap((s) => [...s]).sort();
  const fromDate = allDates[0] ?? null;
  const toDate = allDates[allDates.length - 1] ?? null;
  summary.imported = toInsert.length;
  if (args.dryRun) return { summary, unknown: toUnknown(unknown), fromDate, toDate, batchId: null, lockedDates: [] };

  const lockedDates = new Set<string>();
  let batchId: string | null = null;
  await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(attendanceImportBatches)
      .values({ businessId: args.businessId, source: args.source, fileName: args.fileName ?? null, deviceKeyId: args.deviceKeyId ?? null, totals: { ...summary }, fromDate, toDate, createdByUserId: args.actorUserId ?? null })
      .returning({ id: attendanceImportBatches.id });
    batchId = batch!.id;
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const rows = await tx
        .insert(employeePunches)
        .values(toInsert.slice(i, i + CHUNK).map((r) => ({ ...r, importBatchId: batch!.id })))
        .onConflictDoNothing()
        .returning({ id: employeePunches.id });
      inserted += rows.length;
    }
    // A row that lost a race with another import counts as a duplicate.
    summary.duplicates += toInsert.length - inserted;
    summary.imported = inserted;
    for (const [employeeId, dates] of affected) {
      const r = await rollupEmployeeDays(tx, args.businessId, employeeId, [...dates]);
      summary.rolledUp += r.written;
      for (const d of r.skippedLocked) lockedDates.add(d);
    }
    summary.lockedDays = lockedDates.size;
    await tx.update(attendanceImportBatches).set({ totals: { ...summary } }).where(eq(attendanceImportBatches.id, batch!.id));
  });
  return { summary, unknown: toUnknown(unknown), fromDate, toDate, batchId, lockedDates: [...lockedDates].sort() };
}

function toUnknown(m: Map<string, number[]>): UnknownCode[] {
  return [...m.entries()].slice(0, 50).map(([code, rows]) => ({ code, rows: rows.slice(0, 20) }));
}

export { PUSH_MAX_PUNCHES };

// ── Selfie retention ─────────────────────────────────────────────────────────

/**
 * Delete selfies older than each business's retention period. The punch itself (time, place result,
 * review) is kept. Returns how many photos were deleted.
 */
export async function purgeExpiredSelfies(db: Db, now: Date, businessId?: string): Promise<number> {
  const settings = await db.select({ businessId: attendanceSettings.businessId, days: attendanceSettings.selfieRetentionDays }).from(attendanceSettings);
  const days = new Map(settings.map((s) => [s.businessId, s.days]));
  const businessesWithSelfies = await db
    .selectDistinct({ businessId: employeePunchSelfies.businessId })
    .from(employeePunchSelfies)
    .where(businessId ? eq(employeePunchSelfies.businessId, businessId) : undefined);
  let deleted = 0;
  for (const { businessId: b } of businessesWithSelfies) {
    const retention = days.get(b) ?? DEFAULT_ATTENDANCE_SETTINGS.selfieRetentionDays;
    const cutoff = new Date(now.getTime() - retention * 86_400_000);
    const rows = await db
      .delete(employeePunchSelfies)
      .where(and(eq(employeePunchSelfies.businessId, b), lt(employeePunchSelfies.capturedAt, cutoff)))
      .returning({ id: employeePunchSelfies.punchId });
    deleted += rows.length;
  }
  return deleted;
}
