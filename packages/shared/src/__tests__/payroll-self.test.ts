import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_CONSENT_VERSION,
  DEFAULT_ROLLUP_POLICY,
  EMPLOYEE_ALLOWED_PROCEDURES,
  buildImportPunches,
  clockSkewTooLarge,
  consentIsCurrent,
  employeeMayCall,
  evaluateGeofence,
  guessImportMapping,
  haversineMeters,
  istDateOf,
  istInstant,
  istTimeOf,
  parseDelimitedText,
  parseDeviceTimestamp,
  parseDirection,
  rollupDay,
  selfieExpired,
  sequencePunches,
  punchInputSchema,
  type ImportMapping,
  type PunchLike,
  type ShiftLike,
  type WorkLocationLike,
} from "../index.js";

const at = (date: string, time: string) => istInstant(date, time);
const day: ShiftLike = { startTime: "09:00", endTime: "18:00", standardHours: 8 };
const night: ShiftLike = { startTime: "22:00", endTime: "06:00", standardHours: 8 };

describe("haversine and geofence", () => {
  const office: WorkLocationLike = { id: "loc1", name: "Head office", lat: 19.076, lng: 72.8777, radiusM: 100 };
  // 0.001 degrees of latitude is about 111.2 m everywhere.
  const north = (metres: number) => ({ lat: office.lat + metres / 111_195, lng: office.lng });

  it("measures known distances", () => {
    expect(haversineMeters(office, office)).toBe(0);
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -2);
    // Mumbai to Delhi is about 1,150 km.
    const d = haversineMeters({ lat: 19.076, lng: 72.8777 }, { lat: 28.6139, lng: 77.209 });
    expect(d).toBeGreaterThan(1_140_000);
    expect(d).toBeLessThan(1_160_000);
  });

  it("is inside at the centre, inside on the radius, outside just beyond it", () => {
    const base = { policy: "record" as const, locations: [office] };
    expect(evaluateGeofence({ ...base, point: { ...office, accuracyM: 10 } }).result).toBe("inside");
    expect(evaluateGeofence({ ...base, point: { ...north(99), accuracyM: 10 } }).result).toBe("inside");
    expect(evaluateGeofence({ ...base, point: { ...north(101), accuracyM: 10 } }).result).toBe("outside");
    // The boundary itself counts as inside.
    const exact = { lat: office.lat, lng: office.lng + 0.0009 };
    const edge = { ...office, radiusM: Math.ceil(haversineMeters(office, exact)) };
    expect(evaluateGeofence({ policy: "record", locations: [edge], point: { ...exact, accuracyM: 5 } }).result).toBe("inside");
    expect(evaluateGeofence({ policy: "record", locations: [{ ...edge, radiusM: edge.radiusM - 1 }], point: { ...exact, accuracyM: 5 } }).result).toBe("outside");
  });

  it("picks the nearest of several locations", () => {
    const branch = { ...office, id: "loc2", name: "Branch", lat: 12.9716, lng: 77.5946 };
    const r = evaluateGeofence({ policy: "record", locations: [office, branch], point: { ...branch, accuracyM: 8 } });
    expect(r.result).toBe("inside");
    expect(r.nearestLocationId).toBe("loc2");
  });

  it("treats a poor accuracy as unprovable, at the threshold as fine", () => {
    const p = { ...office };
    expect(evaluateGeofence({ policy: "warn", locations: [office], point: { ...p, accuracyM: 101 }, accuracyThresholdM: 100 }).result).toBe("low_accuracy");
    expect(evaluateGeofence({ policy: "warn", locations: [office], point: { ...p, accuracyM: 100 }, accuracyThresholdM: 100 }).result).toBe("inside");
    expect(evaluateGeofence({ policy: "warn", locations: [office], point: { ...p, accuracyM: 500 }, accuracyThresholdM: 800 }).result).toBe("inside");
  });

  it("applies the policy: off and record never block, warn warns, block refuses", () => {
    const far = { lat: 28.6, lng: 77.2, accuracyM: 10 };
    const run = (policy: "off" | "record" | "warn" | "block", point = far) => evaluateGeofence({ policy, locations: [office], point });
    expect(run("off")).toMatchObject({ result: "not_checked", allowed: true, needsReview: false, warn: false });
    expect(run("record")).toMatchObject({ result: "outside", allowed: true, needsReview: true, warn: false });
    expect(run("warn")).toMatchObject({ result: "outside", allowed: true, needsReview: true, warn: true });
    expect(run("block")).toMatchObject({ result: "outside", allowed: false, needsReview: true, warn: true });
    expect(run("block", { ...office, accuracyM: 5 })).toMatchObject({ result: "inside", allowed: true, needsReview: false });
  });

  it("handles a missing position and no configured location", () => {
    expect(evaluateGeofence({ policy: "block", locations: [office], point: null })).toMatchObject({ result: "no_location", allowed: false });
    expect(evaluateGeofence({ policy: "record", locations: [office], point: null })).toMatchObject({ result: "no_location", allowed: true, needsReview: true });
    // With nothing to compare against there is nothing to check, even under "block".
    expect(evaluateGeofence({ policy: "block", locations: [], point: { lat: 1, lng: 1 } })).toMatchObject({ result: "not_checked", allowed: true });
  });
});

describe("IST helpers", () => {
  it("converts between instants and IST dates", () => {
    const t = at("2026-10-05", "09:03:12");
    expect(istDateOf(t)).toBe("2026-10-05");
    expect(istTimeOf(t)).toBe("09:03");
    // 23:30 IST is still the same Indian day although it is 18:00 UTC.
    expect(istDateOf(at("2026-10-05", "23:30"))).toBe("2026-10-05");
    expect(istDateOf(at("2026-10-06", "00:10"))).toBe("2026-10-06");
  });
});

describe("clock skew", () => {
  it("refuses a client clock more than ten minutes off, either way", () => {
    const now = at("2026-10-05", "10:00");
    expect(clockSkewTooLarge(now + 599_000, now)).toBe(false);
    expect(clockSkewTooLarge(now + 601_000, now)).toBe(true);
    expect(clockSkewTooLarge(now - 601_000, now)).toBe(true);
    expect(clockSkewTooLarge(now - 60_000, now)).toBe(false);
  });
});

describe("sequencePunches", () => {
  const p = (kind: PunchLike["kind"], date: string, time: string, rejected = false): PunchLike => ({ kind, at: at(date, time), rejected });

  it("pairs in and out on the day of the check-in", () => {
    const r = sequencePunches([p("in", "2026-10-05", "09:00"), p("out", "2026-10-05", "18:00")]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ workDate: "2026-10-05", flags: [] });
    expect(r.resolved.map((x) => x.kind)).toEqual(["in", "out"]);
  });

  it("keeps an overnight shift on the day it started", () => {
    const r = sequencePunches([p("in", "2026-10-05", "22:00"), p("out", "2026-10-06", "06:05")]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.workDate).toBe("2026-10-05");
    expect(r.resolved[1]).toMatchObject({ kind: "out", workDate: "2026-10-05" });
  });

  it("alternates auto directions", () => {
    const r = sequencePunches([p("auto", "2026-10-05", "09:00"), p("auto", "2026-10-05", "13:00"), p("auto", "2026-10-05", "14:00"), p("auto", "2026-10-05", "18:00")]);
    expect(r.resolved.map((x) => x.kind)).toEqual(["in", "out", "in", "out"]);
    expect(r.pairs).toHaveLength(2);
  });

  it("drops a double tap within two minutes", () => {
    const r = sequencePunches([p("in", "2026-10-05", "09:00:00"), p("in", "2026-10-05", "09:01:00"), p("out", "2026-10-05", "18:00")]);
    expect(r.resolved.map((x) => x.kind)).toEqual(["in", "duplicate", "out"]);
    expect(r.pairs).toHaveLength(1);
  });

  it("flags a forgotten check-out and an orphan check-out", () => {
    const missed = sequencePunches([p("in", "2026-10-05", "09:00"), p("in", "2026-10-06", "09:00"), p("out", "2026-10-06", "18:00")]);
    expect(missed.pairs[0]!.flags).toContain("missed_out");
    expect(missed.pairs[1]!.flags).toEqual([]);
    const orphan = sequencePunches([p("out", "2026-10-05", "18:00")]);
    expect(orphan.pairs[0]).toMatchObject({ inAt: null, flags: ["orphan_out"], workDate: "2026-10-05" });
    // An open check-in more than 18 hours old is closed as missed when the next punch arrives.
    const stale = sequencePunches([p("in", "2026-10-05", "09:00"), p("out", "2026-10-06", "09:00")]);
    expect(stale.pairs[0]!.flags).toContain("missed_out");
    expect(stale.pairs[1]!.flags).toContain("orphan_out");
  });

  it("ignores rejected punches and sorts by time", () => {
    const r = sequencePunches([p("out", "2026-10-05", "18:00"), p("in", "2026-10-05", "09:00"), p("in", "2026-10-05", "09:10", true)]);
    expect(r.pairs).toHaveLength(1);
    expect(r.resolved.map((x) => x.kind)).toEqual(["out", "in", "rejected"]);
  });

  it("marks a lone check-in open", () => {
    expect(sequencePunches([p("in", "2026-10-05", "09:00")]).pairs[0]!.flags).toEqual(["open"]);
  });
});

describe("rollupDay", () => {
  const pairsOf = (...list: Array<[string, string]>) =>
    sequencePunches(list.flatMap(([a, b]) => [{ kind: "in" as const, at: at("2026-10-05", a) }, { kind: "out" as const, at: at("2026-10-05", b) }])).pairs;

  it("is present for a full day and records the times", () => {
    const r = rollupDay(pairsOf(["09:02", "18:05"]), day, DEFAULT_ROLLUP_POLICY);
    expect(r).toMatchObject({ status: "present", checkIn: "09:02", checkOut: "18:05", lateMinutes: 0, overtimeHours: 0 });
  });

  it("uses 75% and 50% of the shift hours by default (the boundary counts)", () => {
    expect(rollupDay(pairsOf(["09:00", "15:00"]), day, DEFAULT_ROLLUP_POLICY).status).toBe("present"); // 6h
    expect(rollupDay(pairsOf(["09:00", "14:59"]), day, DEFAULT_ROLLUP_POLICY).status).toBe("half_day"); // 5h59
    expect(rollupDay(pairsOf(["09:00", "13:00"]), day, DEFAULT_ROLLUP_POLICY).status).toBe("half_day"); // 4h
    const short = rollupDay(pairsOf(["09:00", "12:59"]), day, DEFAULT_ROLLUP_POLICY);
    expect(short).toMatchObject({ status: null, reason: "short_day" });
  });

  it("honours the business hours and sums several pairs", () => {
    const r = rollupDay(pairsOf(["09:00", "13:00"], ["14:00", "17:00"]), day, { ...DEFAULT_ROLLUP_POLICY, fullDayMinHours: 7, halfDayMinHours: 3 });
    expect(r).toMatchObject({ status: "present", workedMinutes: 420, checkIn: "09:00", checkOut: "17:00" });
  });

  it("reports lateness only past the grace period, counted from the shift start", () => {
    expect(rollupDay(pairsOf(["09:15", "18:00"]), day, DEFAULT_ROLLUP_POLICY).lateMinutes).toBe(0);
    const late = rollupDay(pairsOf(["09:16", "18:00"]), day, DEFAULT_ROLLUP_POLICY);
    expect(late.lateMinutes).toBe(16);
    expect(late.flags).toContain("late");
  });

  it("counts overtime only when the business asks, in half hours", () => {
    expect(rollupDay(pairsOf(["09:00", "20:00"]), day, DEFAULT_ROLLUP_POLICY).overtimeHours).toBe(0);
    expect(rollupDay(pairsOf(["09:00", "20:00"]), day, { ...DEFAULT_ROLLUP_POLICY, overtimeFromPunches: true }).overtimeHours).toBe(3); // 11h worked, 8h standard
    expect(rollupDay(pairsOf(["09:00", "17:20"]), day, { ...DEFAULT_ROLLUP_POLICY, overtimeFromPunches: true }).overtimeHours).toBe(0); // under 30 minutes extra
    expect(rollupDay(pairsOf(["09:00", "18:50"]), day, { ...DEFAULT_ROLLUP_POLICY, overtimeFromPunches: true }).overtimeHours).toBe(1.5); // 1h50 extra, half-hour steps down
  });

  it("handles an overnight shift: the day is the check-in day, no lateness after midnight", () => {
    const pairs = sequencePunches([{ kind: "in", at: at("2026-10-05", "22:05") }, { kind: "out", at: at("2026-10-06", "06:10") }]).pairs;
    const r = rollupDay(pairs, night, DEFAULT_ROLLUP_POLICY);
    expect(r).toMatchObject({ status: "present", checkIn: "22:05", checkOut: "06:10", lateMinutes: 0 });
    expect(pairs[0]!.workDate).toBe("2026-10-05");
    // Checking in at 01:00 on a night shift (late arrival after midnight) is not reported as late by 3 hours.
    const after = sequencePunches([{ kind: "in", at: at("2026-10-06", "01:00") }, { kind: "out", at: at("2026-10-06", "06:00") }]).pairs;
    expect(rollupDay(after, night, DEFAULT_ROLLUP_POLICY).lateMinutes).toBe(0);
  });

  it("cannot decide a day with no complete pair", () => {
    const pairs = sequencePunches([{ kind: "in", at: at("2026-10-05", "09:00") }]).pairs;
    expect(rollupDay(pairs, day, DEFAULT_ROLLUP_POLICY)).toMatchObject({ status: null, reason: "incomplete" });
  });

  it("works without a shift", () => {
    expect(rollupDay(pairsOf(["10:00", "18:00"]), null, DEFAULT_ROLLUP_POLICY)).toMatchObject({ status: "present", lateMinutes: 0 });
  });
});

describe("consent and retention", () => {
  it("is current only for the present wording", () => {
    expect(consentIsCurrent([])).toBe(false);
    expect(consentIsCurrent([{ version: "old" }])).toBe(false);
    expect(consentIsCurrent([{ version: "old" }, { version: ATTENDANCE_CONSENT_VERSION }])).toBe(true);
  });

  it("expires a selfie exactly at the retention period", () => {
    const captured = at("2026-01-01", "10:00");
    const after90 = captured + 90 * 86_400_000;
    expect(selfieExpired(after90 - 1, captured, 90)).toBe(false);
    expect(selfieExpired(after90, captured, 90)).toBe(true);
  });
});

describe("punch input", () => {
  const base = { kind: "in" as const, clientTime: 1_800_000_000_000, deviceId: "dev-1", consentVersion: ATTENDANCE_CONSENT_VERSION };
  it("needs both latitude and longitude or neither", () => {
    expect(punchInputSchema.safeParse(base).success).toBe(true);
    expect(punchInputSchema.safeParse({ ...base, lat: 19, lng: 72 }).success).toBe(true);
    expect(punchInputSchema.safeParse({ ...base, lat: 19 }).success).toBe(false);
    expect(punchInputSchema.safeParse({ ...base, lat: 91, lng: 72 }).success).toBe(false);
  });
});

describe("the employee allowlist", () => {
  it("lists only self-service procedures and the organisation banner", () => {
    for (const path of EMPLOYEE_ALLOWED_PROCEDURES) expect(path.startsWith("payrollSelf.") || path === "tenant.current").toBe(true);
    expect(employeeMayCall("payrollSelf.punch")).toBe(true);
    // The own-loan view (read only) is allowed; every procedure that manages loans is not.
    expect(employeeMayCall("payrollSelf.loans")).toBe(true);
    expect(employeeMayCall("payrollSelf.loanStatement")).toBe(true);
    for (const p of ["payrollLoan.list", "payrollLoan.get", "payrollLoan.create", "payrollLoan.approve", "payrollLoan.statementCsv", "payrollFnf.get", "payrollFnf.list"]) expect(employeeMayCall(p), p).toBe(false);
    expect(employeeMayCall("payrollEmployee.list")).toBe(false);
    expect(employeeMayCall("business.list")).toBe(false);
    expect(employeeMayCall("ai.begin")).toBe(false);
  });
});

describe("biometric import parsing", () => {
  it("reads device timestamps as IST in common layouts", () => {
    const want = at("2026-10-05", "09:03:12");
    expect(parseDeviceTimestamp("2026-10-05 09:03:12")).toBe(want);
    expect(parseDeviceTimestamp("2026-10-05T09:03:12")).toBe(want);
    expect(parseDeviceTimestamp("05/10/2026 09:03:12")).toBe(want);
    expect(parseDeviceTimestamp("05-10-2026 09:03:12")).toBe(want);
    expect(parseDeviceTimestamp("05.10.2026 9:03:12")).toBe(want);
    expect(parseDeviceTimestamp("05/10/2026 09:03:12 AM")).toBe(want);
    expect(parseDeviceTimestamp("05/10/2026 09:03:12 PM")).toBe(at("2026-10-05", "21:03:12"));
    expect(parseDeviceTimestamp("05/10/2026 12:00 AM")).toBe(at("2026-10-05", "00:00"));
    expect(parseDeviceTimestamp("10/05/2026 09:03:12", "mdy")).toBe(want);
    // With an offset the instant is exact: 03:33:12 UTC is 09:03:12 IST.
    expect(parseDeviceTimestamp("2026-10-05T03:33:12Z")).toBe(want);
    expect(parseDeviceTimestamp("2026-10-05T09:03:12+05:30")).toBe(want);
  });

  it("rejects what is not a date", () => {
    for (const bad of ["", "abc", "2026-13-05 09:00", "31/02/2026 09:00", "05/10/2026 25:00"]) expect(Number.isNaN(parseDeviceTimestamp(bad))).toBe(true);
  });

  it("reads directions, unknown means auto", () => {
    expect(parseDirection("IN")).toBe("in");
    expect(parseDirection("C/In")).toBe("in");
    expect(parseDirection("0")).toBe("in");
    expect(parseDirection("Check Out")).toBe("out");
    expect(parseDirection("1")).toBe("out");
    expect(parseDirection("")).toBe("auto");
    expect(parseDirection("break")).toBe("auto");
  });

  it("splits comma, tab, pipe and wide-space files, quotes and a BOM", () => {
    expect(parseDelimitedText("﻿Code,Time\n1,\"2026-10-05, 09:00\"\n")).toEqual([["Code", "Time"], ["1", "2026-10-05, 09:00"]]);
    expect(parseDelimitedText("Code\tTime\n7\t2026-10-05 09:00:00\n")).toEqual([["Code", "Time"], ["7", "2026-10-05 09:00:00"]]);
    expect(parseDelimitedText("7|2026-10-05 09:00:00|IN")).toEqual([["7", "2026-10-05 09:00:00", "IN"]]);
    expect(parseDelimitedText("7    2026-10-05 09:00:00    1")).toEqual([["7", "2026-10-05 09:00:00", "1"]]);
    expect(parseDelimitedText("")).toEqual([]);
  });

  it("guesses a mapping from a header and builds punches with row errors", () => {
    const rows = [
      ["Employee Code", "Date", "Time", "In/Out", "Device"],
      ["E001", "05/10/2026", "09:01:10", "IN", "gate-1"],
      ["E001", "05/10/2026", "18:02:00", "OUT", "gate-1"],
      ["", "05/10/2026", "09:00:00", "IN", "gate-1"],
      ["E002", "garbage", "09:00:00", "IN", "gate-1"],
      ["", "", "", "", ""],
    ];
    const mapping = guessImportMapping(rows) as ImportMapping;
    expect(mapping).toMatchObject({ employeeCode: 0, date: 1, time: 2, direction: 3, deviceId: 4, hasHeader: true, dateOrder: "dmy" });
    const out = buildImportPunches(rows, mapping);
    expect(out.total).toBe(5);
    expect(out.punches).toHaveLength(2);
    expect(out.punches[0]).toMatchObject({ row: 2, employeeCode: "E001", direction: "in", deviceId: "gate-1", at: at("2026-10-05", "09:01:10") });
    expect(out.errors.map((e) => e.row)).toEqual([4, 5]);
  });

  it("does not guess when the header lacks a code or a time", () => {
    expect(guessImportMapping([["Name", "Salary"]])).toBeNull();
    expect(guessImportMapping([])).toBeNull();
  });

  it("uses the default device and a combined column, and caps the rows", () => {
    const mapping: ImportMapping = { employeeCode: 0, timestamp: 1, hasHeader: false, dateOrder: "dmy", defaultDeviceId: "csv-upload" };
    const out = buildImportPunches([["1", "2026-10-05 09:00:00"], ["2", "2026-10-05 09:00:01"], ["3", "2026-10-05 09:00:02"]], mapping, { maxRows: 2 });
    expect(out.punches).toHaveLength(2);
    expect(out.punches[0]!.deviceId).toBe("csv-upload");
    expect(out.errors[0]!.reason).toMatch(/Only the first 2/);
  });
});
