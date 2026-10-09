/**
 * Payroll self-service for employees (Payroll Phase 3): check in and out with a selfie and location,
 * own attendance, own payslips and Form 16, own leave, own loans and advances (read only).
 *
 * Every procedure here:
 *   - needs the CASL permission "PayrollSelf" (only the employee role has it; owners and admins are refused
 *     by resolveSelf even though "manage all" would pass the CASL check),
 *   - resolves the employee from the signed-in membership (employee_logins), NEVER from client input, so no
 *     input carries an employee id, and a guessed run, application or punch id of someone else finds nothing,
 *   - is gated by the Payroll add-on exactly like the rest of Payroll (assertSelfService).
 * The allowlist of procedures an employee session may reach at all is EMPLOYEE_ALLOWED_PROCEDURES (shared),
 * enforced in trpc.ts. Location and selfies are never written to logs or to the audit trail.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  attendanceConsents,
  attendanceRecords,
  businesses,
  employeeLogins,
  employeePunches,
  employeePunchSelfies,
  employees,
  form16Releases,
  leaveApplications,
  leaveLedger,
  leaveTypes,
  payrollRuns,
  payslips,
} from "@fintranzact/db";
import {
  ATTENDANCE_CONSENT_VERSION,
  CLOCK_SKEW_MESSAGE,
  GEOFENCE_RESULT_LABELS,
  MAX_SELFIE_BYTES,
  MAX_SHIFT_HOURS,
  MIN_PUNCH_GAP_SECONDS,
  clockSkewTooLarge,
  consentIsCurrent,
  datesOfMonth,
  evaluateGeofence,
  fyLabel,
  istDateOf,
  istTimeOf,
  selfLeaveApplySchema,
  leaveYearOf,
  monthEnd,
  monthInputSchema,
  monthStart,
  punchInputSchema,
  weekdayOf,
  type GeofenceResult,
} from "@fintranzact/shared";
import { router, memberProcedure, tenantProcedure, viewerProcedure } from "../trpc.js";
import { logAudit } from "../lib/audit.js";
import { validateLogoDataUrl } from "../lib/validate-logo.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { tenantBusinessIds } from "../lib/business-membership.js";
import { logger } from "../lib/logger.js";
import { assertPayrollAddon, assertSelfService, badRequest, notFound } from "../lib/payroll/access.js";
import { resolveSelf } from "../lib/payroll/employee-access.js";
import { holidayDatesFor, loadHolidays, loadPayrollSettings } from "../lib/payroll/data.js";
import { allowedLocations, loadAttendanceSettings, punchClock, rollupEmployeeDays } from "../lib/payroll/punches.js";
import { createLeaveApplication, employeeCalendar, notifyLeaveRequested } from "../lib/payroll/leave-requests.js";
import { generatePayslipPDF } from "../lib/payroll/payslip-pdf.js";
import { listOwnLoans, ownLoanStatement } from "../lib/payroll/loans-self.js";
import { generateForm16WorkingCopyPDF } from "../lib/payroll/form16-pdf.js";
import { buildForm16 } from "../lib/payroll/filings.js";
import type { PayslipSnapshot } from "../lib/payroll/run.js";

const idInput = z.object({ id: z.string().uuid() });

/** 40 punches an hour per employee: far above real use, a stop for a looping client. */
export const selfPunchLimiter = createFixedWindowLimiter({ limit: 40, windowMs: 60 * 60 * 1000 });

type Action = "create" | "read" | "update";

interface SelfRequestCtx {
  db: Parameters<typeof resolveSelf>[0]["db"];
  businessId: string;
  tenantId: string;
  user: { id: string };
  role: string;
  ability: Parameters<typeof assertSelfService>[0]["ability"];
  ipAddress?: string | null;
}

/** The permission and add-on checks, then the employee behind the signed-in login. */
async function me(ctx: SelfRequestCtx, action: Action) {
  await assertSelfService(ctx, action);
  return resolveSelf(ctx);
}

const FLAG_FOR_RESULT: Partial<Record<GeofenceResult, string>> = {
  outside: "outside_geofence",
  no_location: "no_location",
  low_accuracy: "low_accuracy",
};

function geofenceMessage(result: GeofenceResult, distanceM: number | null, locationName: string | null, blocked: boolean): string {
  const where = locationName ? ` ${locationName}` : "";
  if (result === "outside") {
    return blocked
      ? `You are about ${distanceM ?? "?"} m from${where || " your work location"}. Move to your work location and try again.`
      : `You are about ${distanceM ?? "?"} m from${where || " your work location"}, outside the allowed area. Your punch was saved and HR will review it.`;
  }
  if (result === "no_location") {
    return blocked ? "Your location could not be read. Turn on location for the app and try again." : "Your location could not be read. Your punch was saved and HR will review it.";
  }
  return blocked ? "Your location is not precise enough yet. Wait a few seconds outdoors and try again." : "Your location was not precise enough. Your punch was saved and HR will review it.";
}

export const payrollSelfRouter = router({
  /**
   * The businesses of this organisation the signed-in person is an employee of (an organisation can hold
   * several businesses). Identity only; the screens then send the chosen business like every other request.
   */
  workplaces: tenantProcedure.query(async ({ ctx }) => {
    await assertPayrollAddon(ctx, "read");
    const ids = await tenantBusinessIds(ctx.db, ctx.tenantId);
    if (ids.length === 0) return [];
    return ctx.db
      .select({ businessId: employeeLogins.businessId, businessName: businesses.name, employeeName: employees.name })
      .from(employeeLogins)
      .innerJoin(employees, eq(employees.id, employeeLogins.employeeId))
      .innerJoin(businesses, eq(businesses.id, employeeLogins.businessId))
      .where(and(eq(employeeLogins.userId, ctx.user.id), inArray(employeeLogins.businessId, ids), eq(employees.status, "active")))
      .orderBy(asc(businesses.name));
  }),

  /** Who I am here, today's punches, whether I can check in or out, and what the app must ask for. */
  me: viewerProcedure.query(async ({ ctx }) => {
    const emp = await me(ctx, "read");
    const settings = await loadAttendanceSettings(ctx.db, ctx.businessId);
    const locations = settings.geofencePolicy === "off" ? [] : await allowedLocations(ctx.db, ctx.businessId, emp.id);
    const consents = await ctx.db.select({ version: attendanceConsents.version }).from(attendanceConsents).where(eq(attendanceConsents.employeeId, emp.id));
    const now = punchClock.now();
    const [last] = await ctx.db.select().from(employeePunches).where(eq(employeePunches.employeeId, emp.id)).orderBy(desc(employeePunches.punchedAt)).limit(1);
    const open = last && last.kind === "in" && now.getTime() - last.punchedAt.getTime() <= MAX_SHIFT_HOURS * 3_600_000 ? last : null;
    const today = istDateOf(now.getTime());
    const dates = open && open.workDate !== today ? [today, open.workDate] : [today];
    const todays = await ctx.db
      .select({ id: employeePunches.id, kind: employeePunches.kind, at: employeePunches.punchedAt, result: employeePunches.geofenceResult, review: employeePunches.reviewStatus })
      .from(employeePunches)
      .where(and(eq(employeePunches.employeeId, emp.id), inArray(employeePunches.workDate, dates)))
      .orderBy(asc(employeePunches.punchedAt));
    const [biz] = await ctx.db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
    return {
      serverTime: now,
      businessName: biz?.name ?? "",
      employee: { name: emp.name, code: emp.employeeCode },
      canPunch: settings.punchEnabled,
      next: open ? ("out" as const) : ("in" as const),
      openSince: open?.punchedAt ?? null,
      settings: {
        selfieRequired: settings.selfieRequired,
        geofencePolicy: settings.geofencePolicy,
        locationNeeded: settings.geofencePolicy !== "off" && locations.length > 0,
        retentionDays: settings.selfieRetentionDays,
      },
      locationNames: locations.map((l) => l.name),
      consent: { version: ATTENDANCE_CONSENT_VERSION, accepted: consentIsCurrent(consents) },
      today: todays.map((p) => ({ id: p.id, kind: p.kind as "in" | "out", at: p.at, time: istTimeOf(p.at.getTime()), result: p.result as GeofenceResult, resultLabel: GEOFENCE_RESULT_LABELS[p.result as GeofenceResult] ?? p.result, review: p.review })),
    };
  }),

  /** Agree to the attendance-data wording (what is collected, why, for how long). Asked once per wording version. */
  acceptConsent: memberProcedure.input(z.object({ version: z.string().max(40) })).mutation(async ({ ctx, input }) => {
    const emp = await me(ctx, "create");
    if (input.version !== ATTENDANCE_CONSENT_VERSION) throw badRequest("This wording has changed. Please read it again.");
    const inserted = await ctx.db
      .insert(attendanceConsents)
      .values({ businessId: ctx.businessId, employeeId: emp.id, userId: ctx.user.id, version: input.version })
      .onConflictDoNothing()
      .returning({ id: attendanceConsents.id });
    if (inserted.length > 0) {
      await logAudit(ctx.db, { businessId: ctx.businessId, userId: ctx.user.id, action: "payroll.attendance.consent", entityType: "employee", entityId: emp.id, metadata: { version: input.version }, ipAddress: ctx.ipAddress, role: ctx.role });
    }
    return { version: input.version, accepted: true as const };
  }),

  /**
   * Check in or out. The time is the SERVER's clock; the phone's clock is stored for reference and a phone
   * more than ten minutes off is refused. One open punch at a time: a check-in while checked in, or a
   * check-out while not, is refused. The geofence policy of the business decides what an outside or missing
   * location does (nothing, a flag, a warning, a refusal). Then the day's attendance is recomputed.
   */
  punch: memberProcedure.input(punchInputSchema).mutation(async ({ ctx, input }) => {
    const emp = await me(ctx, "create");
    if (!selfPunchLimiter.hit(emp.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many check-ins in a short time. Try again later." });
    const now = punchClock.now();
    if (clockSkewTooLarge(input.clientTime, now.getTime())) throw badRequest(CLOCK_SKEW_MESSAGE);

    const settings = await loadAttendanceSettings(ctx.db, ctx.businessId);
    if (!settings.punchEnabled) throw badRequest("Check-in from the app is switched off for this business.");
    const consents = await ctx.db.select({ version: attendanceConsents.version }).from(attendanceConsents).where(eq(attendanceConsents.employeeId, emp.id));
    if (input.consentVersion !== ATTENDANCE_CONSENT_VERSION || !consentIsCurrent(consents)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Please read and accept how your attendance data is used before you check in." });
    }

    let selfie: { bytes: Buffer; mime: "image/png" | "image/jpeg" } | null = null;
    if (input.selfie) {
      const v = validateLogoDataUrl(input.selfie);
      if (v.bytes.length > MAX_SELFIE_BYTES) throw badRequest("The photo is too large. Try again.");
      selfie = v;
    } else if (settings.selfieRequired) {
      throw badRequest("A selfie is needed to check in or out.");
    }

    const locations = settings.geofencePolicy === "off" ? [] : await allowedLocations(ctx.db, ctx.businessId, emp.id);
    const point = settings.geofencePolicy !== "off" && input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM ?? null } : null;
    const decision = evaluateGeofence({ policy: settings.geofencePolicy, point, locations, accuracyThresholdM: settings.accuracyThresholdM });
    const nearest = locations.find((l) => l.id === decision.nearestLocationId)?.name ?? null;
    if (!decision.allowed) throw badRequest(geofenceMessage(decision.result, decision.distanceM, nearest, true));

    const row = await ctx.db.transaction(async (tx) => {
      // Serialise one employee's punches, so two taps cannot both open or both close.
      await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, emp.id)).for("update");
      const [last] = await tx.select().from(employeePunches).where(eq(employeePunches.employeeId, emp.id)).orderBy(desc(employeePunches.punchedAt)).limit(1);
      if (last && now.getTime() - last.punchedAt.getTime() < MIN_PUNCH_GAP_SECONDS * 1000) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "You just punched. Wait a few seconds before the next one." });
      }
      const open = last && last.kind === "in" && now.getTime() - last.punchedAt.getTime() <= MAX_SHIFT_HOURS * 3_600_000 ? last : null;
      if (input.kind === "in" && open) throw new TRPCError({ code: "CONFLICT", message: `You checked in at ${istTimeOf(open.punchedAt.getTime())} already. Check out first.` });
      if (input.kind === "out" && !open) throw badRequest("You are not checked in. Check in first.");
      const workDate = input.kind === "in" ? istDateOf(now.getTime()) : open!.workDate;
      const flag = FLAG_FOR_RESULT[decision.result];
      // A phone that volunteers "my location is mocked" (a hint, not proof) always goes to review.
      const flags = [...(decision.needsReview && flag ? [flag] : []), ...(input.mockLocation && point ? ["mock_location"] : [])];
      const [punch] = await tx
        .insert(employeePunches)
        .values({
          businessId: ctx.businessId,
          employeeId: emp.id,
          kind: input.kind,
          punchedAt: now,
          clientTime: new Date(input.clientTime),
          workDate,
          source: "mobile",
          deviceId: input.deviceId,
          lat: point ? point.lat : null,
          lng: point ? point.lng : null,
          accuracyM: point?.accuracyM ?? null,
          distanceM: decision.distanceM,
          locationId: decision.nearestLocationId,
          geofenceResult: decision.result,
          flags,
          reviewStatus: decision.needsReview || flags.length > 0 ? "pending" : null,
          createdByUserId: ctx.user.id,
        })
        .returning();
      if (selfie) {
        await tx.insert(employeePunchSelfies).values({ punchId: punch!.id, businessId: ctx.businessId, mimeType: selfie.mime, bytes: selfie.bytes.length, data: selfie.bytes, capturedAt: now });
      }
      return punch!;
    });

    // Audit: what happened, not where (no coordinates, no photo).
    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "payroll.punch.create",
      entityType: "employeePunch",
      entityId: row.id,
      metadata: { kind: row.kind, source: "mobile", geofence: row.geofenceResult, selfie: !!selfie },
      ipAddress: ctx.ipAddress,
      role: ctx.role,
    });
    try {
      await rollupEmployeeDays(ctx.db, ctx.businessId, emp.id, [row.workDate, istDateOf(row.punchedAt.getTime())]);
    } catch (err) {
      // The punch is saved; HR can re-run the day from the attendance screen. Never lose the punch over the rollup.
      logger.error({ err, punchId: row.id }, "Attendance rollup after a punch failed");
    }
    return {
      id: row.id,
      kind: row.kind as "in" | "out",
      punchedAt: row.punchedAt,
      workDate: row.workDate,
      geofenceResult: row.geofenceResult as GeofenceResult,
      warning: decision.warn ? geofenceMessage(decision.result, decision.distanceM, nearest, false) : null,
      next: row.kind === "in" ? ("out" as const) : ("in" as const),
    };
  }),

  /** My month: each day's status and times, my punches, my leave, week offs and holidays. */
  attendance: viewerProcedure.input(monthInputSchema).query(async ({ ctx, input }) => {
    const emp = await me(ctx, "read");
    const start = monthStart(input.month);
    const end = monthEnd(input.month);
    const [records, cal, holidayRows, punches, leaves] = await Promise.all([
      ctx.db.select().from(attendanceRecords).where(and(eq(attendanceRecords.employeeId, emp.id), gte(attendanceRecords.date, start), lte(attendanceRecords.date, end))),
      employeeCalendar(ctx.db, ctx.businessId, emp, start, end),
      loadHolidays(ctx.db, ctx.businessId, start, end),
      ctx.db
        .select({ id: employeePunches.id, kind: employeePunches.kind, at: employeePunches.punchedAt, workDate: employeePunches.workDate, result: employeePunches.geofenceResult, flags: employeePunches.flags, review: employeePunches.reviewStatus, source: employeePunches.source })
        .from(employeePunches)
        .where(and(eq(employeePunches.employeeId, emp.id), gte(employeePunches.workDate, start), lte(employeePunches.workDate, end)))
        .orderBy(asc(employeePunches.punchedAt)),
      ctx.db
        .select({ id: leaveApplications.id, fromDate: leaveApplications.fromDate, toDate: leaveApplications.toDate, status: leaveApplications.status, days: leaveApplications.days })
        .from(leaveApplications)
        .where(and(eq(leaveApplications.employeeId, emp.id), inArray(leaveApplications.status, ["pending", "approved"]), lte(leaveApplications.fromDate, end), gte(leaveApplications.toDate, start))),
    ]);
    const byDate = new Map(records.map((r) => [r.date, r]));
    const applicable = holidayDatesFor(holidayRows, emp);
    const holidayName = new Map(holidayRows.filter((h) => applicable.has(h.date)).map((h) => [h.date, h.name]));
    const offs = new Set(cal.weeklyOffDays);
    const days = datesOfMonth(input.month).map((date) => {
      const r = byDate.get(date);
      return {
        date,
        employed: date >= emp.dateOfJoining && (!emp.lastWorkingDay || date <= emp.lastWorkingDay),
        weekOff: offs.has(weekdayOf(date)),
        holiday: holidayName.get(date) ?? null,
        status: r?.status ?? null,
        checkIn: r?.checkIn ?? null,
        checkOut: r?.checkOut ?? null,
        overtimeHours: r ? Number(r.overtimeHours) : 0,
        source: r?.source ?? null,
        note: r?.note ?? null,
      };
    });
    const count = (s: string) => records.filter((r) => r.status === s).length;
    return {
      month: input.month,
      days,
      punches: punches.map((p) => ({ id: p.id, kind: p.kind as "in" | "out", date: p.workDate, time: istTimeOf(p.at.getTime()), source: p.source, geofenceResult: p.result, flags: p.flags, review: p.review })),
      leaves,
      summary: { present: count("present"), halfDay: count("half_day"), absent: count("absent"), leave: count("leave") },
    };
  }),

  // ── Payslips ──────────────────────────────────────────────────────────────────

  /** My payslips: only runs that have been approved (so a draft calculation is never shown). */
  payslips: viewerProcedure.query(async ({ ctx }) => {
    const emp = await me(ctx, "read");
    const rows = await ctx.db
      .select({ runId: payslips.runId, month: payslips.month, number: payslips.number, snapshot: payslips.snapshot, runStatus: payrollRuns.status })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .where(and(eq(payslips.employeeId, emp.id), eq(payslips.businessId, ctx.businessId), inArray(payrollRuns.status, ["approved", "posted", "paid"])))
      .orderBy(desc(payslips.month));
    return rows.map((r) => {
      const s = r.snapshot as unknown as PayslipSnapshot;
      return { runId: r.runId, month: r.month, monthLabel: s.monthLabel, number: r.number, netPay: s.netPay, grossEarnings: s.grossEarnings, paidDays: s.attendance.paidDays, lopDays: s.attendance.lopDays };
    });
  }),

  /** One of my payslips as a PDF (base64): the frozen payslip of an approved run. */
  payslipPdf: viewerProcedure.input(z.object({ runId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const emp = await me(ctx, "read");
    const [slip] = await ctx.db
      .select({ snapshot: payslips.snapshot })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .where(and(eq(payslips.runId, input.runId), eq(payslips.employeeId, emp.id), eq(payslips.businessId, ctx.businessId), inArray(payrollRuns.status, ["approved", "posted", "paid"])))
      .limit(1);
    if (!slip) throw notFound("Payslip");
    const snapshot = slip.snapshot as unknown as PayslipSnapshot;
    const [biz] = await ctx.db.select({ logo: businesses.logoData }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
    const pdf = await generatePayslipPDF(snapshot, { logo: biz?.logo ?? null });
    return { filename: `${snapshot.number}.pdf`, contentType: "application/pdf" as const, base64: pdf.toString("base64") };
  }),

  // ── Loans and advances (read only, my own) ───────────────────────────────────

  /**
   * My loans and advances that are approved, paid out or closed, with the status, principal, balance outstanding, EMI, the month
   * of the next instalment and the instalments still to come. No input: the employee is the signed-in login's, never a client id.
   */
  loans: viewerProcedure.query(async ({ ctx }) => {
    const emp = await me(ctx, "read");
    return listOwnLoans(ctx.db, ctx.businessId, emp.id);
  }),

  /**
   * One of my loans: the repayment schedule in force and the money events (paid out, instalments recovered, part-payments,
   * closure). A loan id that is not mine, is another business's or is not visible to employees (a draft, rejected or cancelled
   * request) is NOT_FOUND, exactly like an id that does not exist.
   */
  loanStatement: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    const emp = await me(ctx, "read");
    return ownLoanStatement(ctx.db, ctx.businessId, emp.id, input.id);
  }),

  // ── Leave ─────────────────────────────────────────────────────────────────────

  /** My leave balances for the current leave year and my applications. */
  leaveOverview: viewerProcedure.query(async ({ ctx }) => {
    const emp = await me(ctx, "read");
    const settings = await loadPayrollSettings(ctx.db, ctx.businessId);
    const today = istDateOf(punchClock.now().getTime());
    const leaveYear = leaveYearOf(today, settings.leaveYearStartMonth);
    const types = await ctx.db.select().from(leaveTypes).where(and(eq(leaveTypes.businessId, ctx.businessId), eq(leaveTypes.isActive, true))).orderBy(asc(leaveTypes.code));
    const sums = await ctx.db
      .select({ leaveTypeId: leaveLedger.leaveTypeId, n: sql<string>`SUM(${leaveLedger.days})::text` })
      .from(leaveLedger)
      .where(and(eq(leaveLedger.employeeId, emp.id), eq(leaveLedger.leaveYear, leaveYear)))
      .groupBy(leaveLedger.leaveTypeId);
    const balance = new Map(sums.map((s) => [s.leaveTypeId, Number(s.n)]));
    const applications = await ctx.db
      .select({
        id: leaveApplications.id,
        leaveTypeId: leaveApplications.leaveTypeId,
        leaveName: leaveTypes.name,
        fromDate: leaveApplications.fromDate,
        toDate: leaveApplications.toDate,
        halfDayStart: leaveApplications.halfDayStart,
        halfDayEnd: leaveApplications.halfDayEnd,
        days: leaveApplications.days,
        reason: leaveApplications.reason,
        status: leaveApplications.status,
        decisionNote: leaveApplications.decisionNote,
        decidedAt: leaveApplications.decidedAt,
        createdAt: leaveApplications.createdAt,
      })
      .from(leaveApplications)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveApplications.leaveTypeId))
      .where(eq(leaveApplications.employeeId, emp.id))
      .orderBy(desc(leaveApplications.fromDate), desc(leaveApplications.createdAt))
      .limit(60);
    return {
      leaveYear,
      types: types.filter((t) => t.code !== "LOP").map((t) => ({ id: t.id, code: t.code, name: t.name, isPaid: t.isPaid, balance: balance.get(t.id) ?? 0 })),
      applications,
    };
  }),

  /** Apply for leave. It waits for HR (or an owner or admin) to approve it; they are told by email. */
  leaveApply: memberProcedure.input(selfLeaveApplySchema).mutation(async ({ ctx, input }) => {
    const emp = await me(ctx, "create");
    const { application, leaveTypeName } = await createLeaveApplication(ctx.db, { businessId: ctx.businessId, input: { ...input, employeeId: emp.id }, createdByUserId: ctx.user.id });
    await logAudit(ctx.db, { businessId: ctx.businessId, userId: ctx.user.id, action: "payroll.leave.apply", entityType: "leaveApplication", entityId: application.id, metadata: { days: application.days, from: application.fromDate, to: application.toDate, via: "self" }, ipAddress: ctx.ipAddress, role: ctx.role });
    await notifyLeaveRequested(ctx.tenantId, { employeeName: emp.name, leaveTypeName, fromDate: application.fromDate, toDate: application.toDate, days: application.days });
    return application;
  }),

  /** Cancel my own application while it is still pending. An approved one is cancelled by HR. */
  leaveCancel: memberProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const emp = await me(ctx, "update");
    const [row] = await ctx.db
      .update(leaveApplications)
      .set({ status: "cancelled", decidedByUserId: ctx.user.id, decidedByName: emp.name, decidedAt: new Date() })
      .where(and(eq(leaveApplications.id, input.id), eq(leaveApplications.employeeId, emp.id), eq(leaveApplications.businessId, ctx.businessId), eq(leaveApplications.status, "pending")))
      .returning();
    if (!row) {
      const [own] = await ctx.db.select({ status: leaveApplications.status }).from(leaveApplications).where(and(eq(leaveApplications.id, input.id), eq(leaveApplications.employeeId, emp.id))).limit(1);
      if (!own) throw notFound("Leave application");
      throw badRequest(`This application is already ${own.status}. Ask HR to cancel an approved one.`);
    }
    await logAudit(ctx.db, { businessId: ctx.businessId, userId: ctx.user.id, action: "payroll.leave.cancel", entityType: "leaveApplication", entityId: row.id, metadata: { via: "self" }, ipAddress: ctx.ipAddress, role: ctx.role });
    return row;
  }),

  // ── Form 16 ───────────────────────────────────────────────────────────────────

  /** Financial years whose Form 16 working copy HR has released and for which I have approved payroll. */
  form16Years: viewerProcedure.query(async ({ ctx }) => {
    const emp = await me(ctx, "read");
    const released = await ctx.db.select().from(form16Releases).where(eq(form16Releases.businessId, ctx.businessId)).orderBy(desc(form16Releases.financialYear));
    const out: Array<{ financialYear: number; label: string; releasedAt: Date }> = [];
    for (const r of released) {
      try {
        await buildForm16(ctx.db, ctx.businessId, r.financialYear, emp.id);
        out.push({ financialYear: r.financialYear, label: fyLabel(r.financialYear), releasedAt: r.releasedAt });
      } catch {
        // No approved payroll for me in that year: not available to me.
      }
    }
    return out;
  }),

  /** My Form 16 working copy for a released year (PDF, base64). It is a working copy for CA review, not a TRACES certificate. */
  form16Pdf: viewerProcedure.input(z.object({ financialYear: z.number().int().min(2020).max(2100) })).query(async ({ ctx, input }) => {
    const emp = await me(ctx, "read");
    const [released] = await ctx.db.select({ id: form16Releases.id }).from(form16Releases).where(and(eq(form16Releases.businessId, ctx.businessId), eq(form16Releases.financialYear, input.financialYear))).limit(1);
    if (!released) throw notFound("Form 16");
    const f = await buildForm16(ctx.db, ctx.businessId, input.financialYear, emp.id).catch(() => {
      throw notFound("Form 16");
    });
    const pdf = await generateForm16WorkingCopyPDF(f.data, { name: f.businessName, tan: f.tan });
    return { filename: `form16-working-copy-${f.data.fyLabel}-${f.data.employee.code}.pdf`, contentType: "application/pdf" as const, base64: pdf.toString("base64"), label: f.data.label };
  }),
});
