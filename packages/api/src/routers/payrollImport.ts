/**
 * Payroll Phase 3: biometric device attendance import from files (CSV, tab or pipe separated text, or Excel
 * rows the browser has already read) with a column mapping, a preview, duplicate detection and history with
 * undo. The same engine (lib/payroll/punches.ts importPunches) serves the device push endpoint
 * (POST /api/attendance/push, http/attendancePush.ts). No vendor SDKs: generic exports only.
 *
 * Needs Payroll "update" and the Payroll add-on. Attendance of a month locked by its payroll run is never
 * changed: punches are still saved and the summary says which days could not be updated.
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { attendanceImportBatches, employeePunches } from "@fintranzact/db";
import { buildImportPunches, istDateOf, monthOf, importRowsSchema } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { logAudit } from "../lib/audit.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { assertPayroll, badRequest, notFound } from "../lib/payroll/access.js";
import { lockedRunForMonth } from "../lib/payroll/data.js";
import { importPunches, punchClock, rollupEmployeeDays } from "../lib/payroll/punches.js";
import { TRPCError } from "@trpc/server";

/** An import is heavy: a few per minute per person is plenty. */
export const importLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 60_000 });

export const payrollImportRouter = router({
  /** Check a file against a mapping and say what an import would do. Nothing is written. */
  preview: memberProcedure.input(importRowsSchema).mutation(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    if (!importLimiter.hit(ctx.user.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many imports. Wait a minute." });
    const parsed = buildImportPunches(input.rows, input.mapping);
    const out = await importPunches(ctx.db, { businessId: ctx.businessId, source: "file", punches: parsed.punches, invalidRows: parsed.errors.length, dryRun: true, now: punchClock.now() });
    return {
      ...out,
      totalRows: parsed.total,
      errors: parsed.errors.slice(0, 50),
      sample: parsed.punches.slice(0, 8).map((p) => ({ row: p.row, employeeCode: p.employeeCode, at: new Date(p.at), direction: p.direction, deviceId: p.deviceId })),
    };
  }),

  /** Import the file. Safe to run again: punches already stored (same employee, time and device) are skipped. */
  commit: memberProcedure.input(importRowsSchema).mutation(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    if (!importLimiter.hit(ctx.user.id)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many imports. Wait a minute." });
    const parsed = buildImportPunches(input.rows, input.mapping);
    if (parsed.punches.length === 0) throw badRequest("There is nothing to import: no row could be read. Check the column mapping.");
    const out = await importPunches(ctx.db, {
      businessId: ctx.businessId,
      source: "file",
      punches: parsed.punches,
      invalidRows: parsed.errors.length,
      fileName: input.fileName ?? null,
      actorUserId: ctx.user.id,
      now: punchClock.now(),
    });
    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "payroll.attendance.import",
      entityType: "attendanceImport",
      entityId: out.batchId,
      metadata: { source: "file", ...out.summary },
      ipAddress: ctx.ipAddress,
      role: ctx.role,
    });
    return { ...out, errors: parsed.errors.slice(0, 50) };
  }),

  /** Past imports and device pushes, newest first. */
  history: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db
      .select()
      .from(attendanceImportBatches)
      .where(eq(attendanceImportBatches.businessId, ctx.businessId))
      .orderBy(desc(attendanceImportBatches.createdAt))
      .limit(50);
  }),

  /**
   * Undo an import: its punches are deleted and the days they touched are recomputed from the punches that are
   * left (a day HR marked by hand is not touched). Refused when a touched day is in a month locked by a
   * payroll run. To replace a file, undo it and import the corrected one.
   */
  undo: memberProcedure.input(z.object({ batchId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    const [batch] = await ctx.db.select().from(attendanceImportBatches).where(and(eq(attendanceImportBatches.id, input.batchId), eq(attendanceImportBatches.businessId, ctx.businessId))).limit(1);
    if (!batch) throw notFound("Import");
    if (batch.status !== "applied") throw badRequest("This import was already undone.");
    const rows = await ctx.db
      .select({ employeeId: employeePunches.employeeId, workDate: employeePunches.workDate, at: employeePunches.punchedAt })
      .from(employeePunches)
      .where(eq(employeePunches.importBatchId, batch.id));
    const perEmployee = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = perEmployee.get(r.employeeId) ?? new Set<string>();
      set.add(r.workDate);
      set.add(istDateOf(r.at.getTime()));
      perEmployee.set(r.employeeId, set);
    }
    const months = new Set([...perEmployee.values()].flatMap((s) => [...s].map(monthOf)));
    for (const m of months) {
      if (await lockedRunForMonth(ctx.db, ctx.businessId, m)) {
        throw badRequest(`Attendance for ${m} is locked by its payroll run. Reopen the run before undoing this import.`);
      }
    }
    const removed = await ctx.db.transaction(async (tx) => {
      const deleted = await tx.delete(employeePunches).where(eq(employeePunches.importBatchId, batch.id)).returning({ id: employeePunches.id });
      for (const [employeeId, dates] of perEmployee) await rollupEmployeeDays(tx, ctx.businessId, employeeId, [...dates]);
      await tx.update(attendanceImportBatches).set({ status: "undone", undoneAt: new Date(), undoneByUserId: ctx.user.id }).where(eq(attendanceImportBatches.id, batch.id));
      return deleted.length;
    });
    await logAudit(ctx.db, { businessId: ctx.businessId, userId: ctx.user.id, action: "payroll.attendance.importUndo", entityType: "attendanceImport", entityId: batch.id, metadata: { punches: removed }, ipAddress: ctx.ipAddress, role: ctx.role });
    return { batchId: batch.id, removed };
  }),
});
