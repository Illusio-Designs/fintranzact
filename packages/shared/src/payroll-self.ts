/**
 * Payroll, Phase 3: roles (HR, employee), mobile punches, geofence, the punch
 * to daily attendance rollup, consent, and biometric device import.
 *
 * Pure: no database, no clock (callers pass instants). Every time here is an
 * epoch millisecond; the working day is the Indian calendar day (IST, UTC+5:30,
 * no daylight saving), like the rest of payroll. docs/architecture/payroll-self-service.md.
 */

import { z } from "zod";
import { isIsoDate, isPayrollMonth, type AttendanceStatus } from "./payroll-calendar.js";
import { isoDateSchema } from "./payroll.js";

// ── Roles ────────────────────────────────────────────────────────────────────

export const HR_ROLE = "hr";
export const EMPLOYEE_ROLE = "employee";

export function isEmployeeRole(role: string | null | undefined): boolean {
  return role === EMPLOYEE_ROLE;
}

export const HR_ROLE_LABEL = "HR / Payroll manager";
export const EMPLOYEE_ROLE_LABEL = "Employee (self-service)";

export const HR_ROLE_DESCRIPTION =
  "Runs payroll day to day: employees, attendance, leave, payroll runs (prepare and review), payslips and statutory files. Cannot approve a payroll run, post to the books, or change business settings, billing or the team.";
export const EMPLOYEE_ROLE_DESCRIPTION =
  "Self-service only: check in and out, see own attendance, apply for leave, download own payslips and Form 16. Sees no accounting data and no other employee's records.";

/**
 * Procedures a signed-in employee may call (tRPC paths). Everything else in the
 * organisation is refused by the backstop in the API (trpc.ts hasTenantAccess),
 * whatever its own permission check says. The account-level procedures (auth.*,
 * tenant.list/select/leave...) are not organisation procedures and are not
 * listed here.
 */
export const EMPLOYEE_ALLOWED_PROCEDURES: readonly string[] = [
  "payrollSelf.workplaces",
  "payrollSelf.me",
  "payrollSelf.acceptConsent",
  "payrollSelf.punch",
  "payrollSelf.attendance",
  "payrollSelf.payslips",
  "payrollSelf.payslipPdf",
  "payrollSelf.leaveOverview",
  "payrollSelf.leaveApply",
  "payrollSelf.leaveCancel",
  "payrollSelf.form16Years",
  "payrollSelf.form16Pdf",
  // The organisation banner the app shows (read-only status, no organisation data beyond two-factor state).
  "tenant.current",
];

/**
 * Account-level procedures (about the signed-in PERSON, not an organisation's books) that an employee
 * session may also call: signing in and out, their sessions and two-factor, switching or leaving
 * organisations and answering invitations, the public plan and maintenance lookups. Anything else that
 * is not in the self-service list above is refused for the employee role.
 */
export const EMPLOYEE_ACCOUNT_PROCEDURES: readonly string[] = [
  "tenant.list",
  "tenant.select",
  "tenant.leave",
  "tenant.create",
  "tenant.canCreateOrg",
  "tenant.myInvitations",
  "tenant.acceptById",
  "tenant.acceptInvitation",
  "tenant.peekInvitation",
  "tenant.setPinned",
  "tenant.listClients",
  "billing.config",
  "plan.list",
  "system.maintenanceStatus",
  "partner.directory",
  "partner.me",
  "platform.me",
];
const EMPLOYEE_ACCOUNT_PREFIXES: readonly string[] = ["auth."];

export function employeeMayCall(path: string): boolean {
  return (
    EMPLOYEE_ALLOWED_PROCEDURES.includes(path) ||
    EMPLOYEE_ACCOUNT_PROCEDURES.includes(path) ||
    EMPLOYEE_ACCOUNT_PREFIXES.some((p) => path.startsWith(p))
  );
}

/** The employee logins HR can invite; they never count towards the plan's team-member limit. */
export const EMPLOYEE_INVITE_NOTE =
  "Employee logins are included in the Payroll add-on and do not use a team seat. They can only see their own records.";

// ── Time (IST) ───────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The IST calendar day of an instant, "YYYY-MM-DD". */
export function istDateOf(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The IST time of day of an instant, "HH:MM". */
export function istTimeOf(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Minutes after IST midnight. */
export function istMinutesOf(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The instant of an IST date ("YYYY-MM-DD") and time ("HH:MM[:SS]"). */
export function istInstant(date: string, time = "00:00:00"): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!d || !t) return Number.NaN;
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3] ?? 0)) - IST_OFFSET_MS;
}

/** "HH:MM" to minutes, or null. */
export function clockMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

// ── Clock skew ───────────────────────────────────────────────────────────────

/** The phone's clock may differ from the server's by this much before a punch is refused. */
export const MAX_CLIENT_CLOCK_SKEW_SECONDS = 600;

export function clockSkewSeconds(clientMs: number, serverMs: number): number {
  return Math.round((clientMs - serverMs) / 1000);
}

export function clockSkewTooLarge(clientMs: number, serverMs: number, maxSeconds = MAX_CLIENT_CLOCK_SKEW_SECONDS): boolean {
  return Math.abs(clockSkewSeconds(clientMs, serverMs)) > maxSeconds;
}

export const CLOCK_SKEW_MESSAGE =
  "Your phone's date or time looks wrong. Set it to automatic date and time, then try again.";

// ── Geofence ─────────────────────────────────────────────────────────────────

export const GEOFENCE_POLICIES = ["off", "record", "warn", "block"] as const;
export type GeofencePolicy = (typeof GEOFENCE_POLICIES)[number];

export const GEOFENCE_POLICY_LABELS: Record<GeofencePolicy, string> = {
  off: "Off: do not ask for location",
  record: "Record only: save the location, never stop a punch",
  warn: "Warn: tell the employee they are outside, flag the punch for review",
  block: "Block: refuse a punch from outside an allowed location",
};

export const GEOFENCE_RESULTS = ["inside", "outside", "no_location", "low_accuracy", "not_checked"] as const;
export type GeofenceResult = (typeof GEOFENCE_RESULTS)[number];

export const GEOFENCE_RESULT_LABELS: Record<GeofenceResult, string> = {
  inside: "At the work location",
  outside: "Outside the work location",
  no_location: "No location sent",
  low_accuracy: "Location too imprecise",
  not_checked: "Location not checked",
};

export const DEFAULT_ACCURACY_THRESHOLD_M = 100;
const EARTH_RADIUS_M = 6_371_008.8;

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface WorkLocationLike {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface GeofenceInput {
  policy: GeofencePolicy;
  point: (GeoPoint & { accuracyM?: number | null }) | null;
  locations: readonly WorkLocationLike[];
  accuracyThresholdM?: number;
}

export interface GeofenceDecision {
  result: GeofenceResult;
  /** The closest allowed location, when a position was usable. */
  nearestLocationId: string | null;
  distanceM: number | null;
  /** The punch may be saved (false only for "block" when the position is not at an allowed location). */
  allowed: boolean;
  /** The punch is saved but HR should look at it. */
  needsReview: boolean;
  /** Tell the employee (policy warn or block). */
  warn: boolean;
}

/**
 * Decide a punch's geofence result and what the policy does with it.
 * - policy off, or no allowed location configured: nothing is checked.
 * - no position: "no_location". An accuracy worse than the threshold: "low_accuracy"
 *   (the position cannot prove anything either way).
 * - otherwise the nearest allowed location decides: inside when the distance is at
 *   most its radius (the boundary counts as inside).
 * Mock-location apps cannot be detected on the server (see the architecture note).
 */
export function evaluateGeofence(input: GeofenceInput): GeofenceDecision {
  const checked: GeofenceDecision = { result: "not_checked", nearestLocationId: null, distanceM: null, allowed: true, needsReview: false, warn: false };
  if (input.policy === "off" || input.locations.length === 0) return checked;
  const threshold = input.accuracyThresholdM ?? DEFAULT_ACCURACY_THRESHOLD_M;
  const refuse = input.policy === "block";
  const bad = (result: GeofenceResult, nearest: string | null, distance: number | null): GeofenceDecision => ({
    result,
    nearestLocationId: nearest,
    distanceM: distance,
    allowed: !refuse,
    needsReview: true,
    warn: input.policy === "warn" || refuse,
  });

  if (!input.point) return bad("no_location", null, null);
  let best: { id: string; distance: number; radius: number } | null = null;
  for (const loc of input.locations) {
    const d = haversineMeters(input.point, loc);
    if (!best || d - loc.radiusM < best.distance - best.radius) best = { id: loc.id, distance: d, radius: loc.radiusM };
  }
  const distanceM = best ? Math.round(best.distance) : null;
  if (input.point.accuracyM != null && input.point.accuracyM > threshold) return bad("low_accuracy", best?.id ?? null, distanceM);
  if (best && best.distance <= best.radius) return { ...checked, result: "inside", nearestLocationId: best.id, distanceM };
  return bad("outside", best?.id ?? null, distanceM);
}

// ── Punches and the daily rollup ─────────────────────────────────────────────

export const PUNCH_KINDS = ["in", "out"] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];
export const PUNCH_SOURCES = ["mobile", "biometric", "manual"] as const;
export type PunchSource = (typeof PUNCH_SOURCES)[number];
export const PUNCH_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

/** An open check-in older than this is treated as a forgotten check-out. */
export const MAX_SHIFT_HOURS = 18;
/** A punch this soon after the previous counted punch is a double tap, not a new punch. */
export const DUPLICATE_PUNCH_SECONDS = 120;
/** A mobile employee cannot punch twice within this many seconds. */
export const MIN_PUNCH_GAP_SECONDS = 30;

export interface PunchLike {
  kind: PunchKind | "auto";
  at: number;
  /** A rejected punch (HR) never counts. */
  rejected?: boolean;
}

export interface PunchPair {
  /** Instants; null when the other half is missing. */
  inAt: number | null;
  outAt: number | null;
  /** Indexes into the (sorted) input. */
  inIndex: number | null;
  outIndex: number | null;
  /** The IST day this pair belongs to: the day of the check-in. */
  workDate: string;
  flags: string[];
}

export interface SequenceResult {
  pairs: PunchPair[];
  /** Per input punch (in input order): the kind it ended up as, or "duplicate" / "rejected". */
  resolved: Array<{ kind: PunchKind | "duplicate" | "rejected"; workDate: string }>;
}

/**
 * Turn raw punches (any order, "auto" directions allowed) into check-in/out pairs.
 * An "in" opens a day; the next "out" closes it. "auto" alternates. A forgotten
 * check-out (an open "in" followed by another "in", or more than MAX_SHIFT_HOURS
 * later) leaves the earlier pair open with the flag "missed_out". An "out" with no
 * open "in" is an "orphan_out". Punches within DUPLICATE_PUNCH_SECONDS of the last
 * counted one are duplicates. Overnight shifts work because a pair belongs to the
 * day of its check-in, however late the check-out is.
 */
export function sequencePunches(
  punches: readonly PunchLike[],
  opts: { duplicateSeconds?: number; maxShiftHours?: number } = {},
): SequenceResult {
  const dupMs = (opts.duplicateSeconds ?? DUPLICATE_PUNCH_SECONDS) * 1000;
  const maxMs = (opts.maxShiftHours ?? MAX_SHIFT_HOURS) * 3_600_000;
  const order = punches.map((p, i) => ({ p, i })).sort((a, b) => a.p.at - b.p.at || a.i - b.i);
  const resolved: SequenceResult["resolved"] = punches.map((p) => ({ kind: "duplicate", workDate: istDateOf(p.at) }));
  const pairs: PunchPair[] = [];
  let open: { pair: PunchPair; at: number } | null = null;
  let lastCounted: number | null = null;

  for (const { p, i } of order) {
    if (p.rejected) {
      resolved[i] = { kind: "rejected", workDate: istDateOf(p.at) };
      continue;
    }
    if (lastCounted !== null && p.at - lastCounted < dupMs) {
      resolved[i] = { kind: "duplicate", workDate: istDateOf(p.at) };
      continue;
    }
    if (open && p.at - open.at > maxMs) {
      open.pair.flags.push("missed_out");
      open = null;
    }
    const kind: PunchKind = p.kind === "auto" ? (open ? "out" : "in") : p.kind;
    let owner: PunchPair;
    if (kind === "in") {
      if (open) open.pair.flags.push("missed_out");
      owner = { inAt: p.at, outAt: null, inIndex: i, outIndex: null, workDate: istDateOf(p.at), flags: [] };
      pairs.push(owner);
      open = { pair: owner, at: p.at };
    } else if (open) {
      owner = open.pair;
      owner.outAt = p.at;
      owner.outIndex = i;
      open = null;
    } else {
      owner = { inAt: null, outAt: p.at, inIndex: null, outIndex: i, workDate: istDateOf(p.at), flags: ["orphan_out"] };
      pairs.push(owner);
    }
    resolved[i] = { kind, workDate: owner.workDate };
    lastCounted = p.at;
  }
  for (const pr of pairs) if (pr.inAt !== null && pr.outAt === null && !pr.flags.includes("missed_out")) pr.flags.push("open");
  return { pairs, resolved };
}

export interface ShiftLike {
  startTime: string;
  endTime: string;
  standardHours: number;
}

export interface RollupPolicy {
  lateGraceMinutes: number;
  /** Hours worked for a full day; null = 75% of the shift's standard hours. */
  fullDayMinHours: number | null;
  /** Hours worked for a half day; null = 50% of the shift's standard hours. */
  halfDayMinHours: number | null;
  /** Pay overtime for time beyond the standard hours (half-hour steps). Off by default. */
  overtimeFromPunches: boolean;
}

export const DEFAULT_ROLLUP_POLICY: RollupPolicy = {
  lateGraceMinutes: 15,
  fullDayMinHours: null,
  halfDayMinHours: null,
  overtimeFromPunches: false,
};

export interface DayRollup {
  /** Null when the punches cannot decide the day (no complete pair, or fewer hours than a half day). */
  status: Extract<AttendanceStatus, "present" | "half_day"> | null;
  reason: "incomplete" | "short_day" | null;
  workedMinutes: number;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
  overtimeHours: number;
  flags: string[];
}

/** Whether a shift crosses midnight (it ends at an earlier clock time than it starts). */
export function isOvernightShift(shift: Pick<ShiftLike, "startTime" | "endTime">): boolean {
  const s = clockMinutes(shift.startTime);
  const e = clockMinutes(shift.endTime);
  return s !== null && e !== null && e < s;
}

/**
 * The attendance a day's pairs add up to, by the shift's hours and the business
 * policy. Present at the full-day hours, half day at the half-day hours, otherwise
 * undecided (HR marks it). Late = the first check-in is more than the grace after
 * the shift start (reported from the start, not the grace). Overnight shifts do
 * not report lateness for a check-in after midnight.
 */
export function rollupDay(pairs: readonly PunchPair[], shift: ShiftLike | null, policy: RollupPolicy, fallbackStandardHours = 8): DayRollup {
  const complete = pairs.filter((p) => p.inAt !== null && p.outAt !== null && p.outAt > p.inAt).sort((a, b) => a.inAt! - b.inAt!);
  const flags = [...new Set(pairs.flatMap((p) => p.flags))];
  if (complete.length === 0) {
    return { status: null, reason: "incomplete", workedMinutes: 0, checkIn: null, checkOut: null, lateMinutes: 0, overtimeHours: 0, flags };
  }
  const workedMinutes = Math.floor(complete.reduce((s, p) => s + (p.outAt! - p.inAt!), 0) / 60_000);
  const std = shift?.standardHours ?? fallbackStandardHours;
  const full = (policy.fullDayMinHours ?? std * 0.75) * 60;
  const half = (policy.halfDayMinHours ?? std * 0.5) * 60;
  const first = complete[0]!;
  const last = complete[complete.length - 1]!;
  const checkIn = istTimeOf(first.inAt!);
  const checkOut = istTimeOf(last.outAt!);

  let lateMinutes = 0;
  const start = shift ? clockMinutes(shift.startTime) : null;
  if (shift && start !== null) {
    const inMin = istMinutesOf(first.inAt!);
    const afterMidnight = isOvernightShift(shift) && inMin < (clockMinutes(shift.endTime) ?? 0);
    if (!afterMidnight && inMin > start + policy.lateGraceMinutes) lateMinutes = inMin - start;
  }
  if (lateMinutes > 0) flags.push("late");

  let status: DayRollup["status"] = null;
  let reason: DayRollup["reason"] = null;
  if (workedMinutes >= full) status = "present";
  else if (workedMinutes >= half) status = "half_day";
  else reason = "short_day";

  const extra = workedMinutes - std * 60;
  const overtimeHours = status === "present" && policy.overtimeFromPunches && extra >= 30 ? Math.floor(extra / 30) / 2 : 0;
  return { status, reason, workedMinutes, checkIn, checkOut, lateMinutes, overtimeHours, flags };
}

/** "6h 05m" */
export function formatWorked(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`;
}

// ── Consent and selfie retention ─────────────────────────────────────────────

/** Bump when the wording below changes: employees are asked to agree again. */
export const ATTENDANCE_CONSENT_VERSION = "2026-10-v1";

export const ATTENDANCE_CONSENT_TITLE = "Before you check in";
export const ATTENDANCE_CONSENT_POINTS: readonly string[] = [
  "What we collect: when you tap Check in or Check out, the app takes a photo of your face (a selfie) and reads your phone's location once. It also records the time on our server and an id for your phone.",
  "Why: to record your attendance for payroll, and to confirm you were at an allowed work location when your employer has set one up.",
  "Only at that moment: the app never tracks you in the background and never reads your location at any other time.",
  "Who sees it: your employer's HR or payroll managers and the owner. Not other employees.",
  "How long: the selfie is deleted after the retention period your employer has set (90 days unless changed). The punch record (time and place result) is kept as an attendance record.",
  "You can ask your employer to correct or delete your data. Your employer decides what attendance proof it requires.",
];
export const ATTENDANCE_CONSENT_ACCEPT_LABEL = "I understand and agree";

export interface ConsentRecordLike {
  version: string;
}

/** True when the employee has agreed to the current wording. */
export function consentIsCurrent(records: readonly ConsentRecordLike[], version = ATTENDANCE_CONSENT_VERSION): boolean {
  return records.some((r) => r.version === version);
}

export const DEFAULT_SELFIE_RETENTION_DAYS = 90;
export const MIN_SELFIE_RETENTION_DAYS = 7;
export const MAX_SELFIE_RETENTION_DAYS = 365;
/** Largest selfie after decoding. The app resizes to about 640 px, which is far below this. */
export const MAX_SELFIE_BYTES = 300_000;

/** The instant after which a selfie captured at `capturedAtMs` is deleted. */
export function selfieExpiresAt(capturedAtMs: number, retentionDays: number): number {
  return capturedAtMs + retentionDays * DAY_MS;
}

export function selfieExpired(nowMs: number, capturedAtMs: number, retentionDays: number): boolean {
  return nowMs >= selfieExpiresAt(capturedAtMs, retentionDays);
}

// ── Biometric device import ──────────────────────────────────────────────────

export const IMPORT_MAX_ROWS = 20_000;
export const PUSH_MAX_PUNCHES = 500;

export const IMPORT_DIRECTIONS = ["in", "out", "auto"] as const;
export type ImportDirection = (typeof IMPORT_DIRECTIONS)[number];

/** Split delimited text (comma, tab, semicolon, pipe or runs of spaces) into rows of cells; handles quotes and a BOM. */
export function parseDelimitedText(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = src.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const sample = lines.slice(0, 10).join("\n");
  const counts: Array<[string, number]> = [",", "\t", ";", "|"].map((d) => [d, sample.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0]![1] > 0 ? counts[0]![0] : null; // null = whitespace separated (many devices export "1  2026-10-05 09:01:11  0")
  return lines.map((line) => (delimiter ? splitQuoted(line, delimiter) : line.trim().split(/\s{2,}|\t/).map((c) => c.trim()).filter((c, _i, arr) => (arr.length === 1 ? true : c !== ""))));
}

function splitQuoted(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export interface ImportMapping {
  /** Column numbers (0-based). */
  employeeCode: number;
  /** A column with date and time together, or a date column plus a time column. */
  timestamp?: number;
  date?: number;
  time?: number;
  direction?: number;
  deviceId?: number;
  /** The first row is a header and is skipped. */
  hasHeader: boolean;
  /** How a day/month/year date reads when it is ambiguous. Indian devices are day first. */
  dateOrder: "dmy" | "mdy" | "ymd";
  /** Used when the file has no device column. */
  defaultDeviceId?: string;
}

export const importMappingSchema = z.object({
  employeeCode: z.number().int().min(0).max(200),
  timestamp: z.number().int().min(0).max(200).optional(),
  date: z.number().int().min(0).max(200).optional(),
  time: z.number().int().min(0).max(200).optional(),
  direction: z.number().int().min(0).max(200).optional(),
  deviceId: z.number().int().min(0).max(200).optional(),
  hasHeader: z.boolean(),
  dateOrder: z.enum(["dmy", "mdy", "ymd"]).default("dmy"),
  defaultDeviceId: z.string().trim().max(60).optional(),
}).refine((m) => m.timestamp !== undefined || (m.date !== undefined && m.time !== undefined), "Choose the date and time column (or one column holding both).");

/** Guess the column mapping from a header row (null when it does not look like a header). */
export function guessImportMapping(rows: readonly string[][]): ImportMapping | null {
  const header = rows[0];
  if (!header) return null;
  const find = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h.trim())));
  const code = find(/^(emp(loyee)?\.?\s*(code|id|no|number)|user\s*id|person\s*id|badge|card\s*no|enroll(ment)?\s*(no|id)?|code|ecode)$/i);
  const ts = find(/^(date\s*[/&-]?\s*time|datetime|timestamp|punch\s*(time|date\s*time)|check\s*time|log\s*time)$/i);
  const date = find(/^(date|punch\s*date|log\s*date)$/i);
  const time = find(/^(time|punch\s*time|log\s*time)$/i);
  const dir = find(/^(direction|in\s*\/?\s*out|status|punch\s*(type|state)|check\s*type|state|event)$/i);
  const dev = find(/^(device(\s*(id|name|serial|sn))?|terminal|machine(\s*(no|id))?|reader|sn)$/i);
  if (code < 0 || (ts < 0 && (date < 0 || time < 0))) return null;
  return {
    employeeCode: code,
    ...(ts >= 0 ? { timestamp: ts } : { date, time }),
    ...(dir >= 0 ? { direction: dir } : {}),
    ...(dev >= 0 ? { deviceId: dev } : {}),
    hasHeader: true,
    dateOrder: "dmy",
  };
}

/**
 * Read a device timestamp. Zone-less values are IST. Accepts "2026-10-05 09:03:12",
 * "2026-10-05T09:03", "05/10/2026 09:03", "05-10-2026 9:03 AM", "05.10.2026 09:03",
 * and ISO values with Z or an offset. Returns NaN when it cannot be read.
 */
export function parseDeviceTimestamp(raw: string, dateOrder: ImportMapping["dateOrder"] = "dmy"): number {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(s)) return Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(AM|PM)?$/i.exec(s);
  if (!m) return Number.NaN;
  let y: number;
  let mo: number;
  let d: number;
  if (m[1]!.length === 4) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if (m[3]!.length === 4 || m[3]!.length === 2) {
    const yy = Number(m[3]);
    y = m[3]!.length === 2 ? 2000 + yy : yy;
    [mo, d] = dateOrder === "mdy" ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
  } else return Number.NaN;
  let h = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  const sec = m[6] ? Number(m[6]) : 0;
  const ap = m[7]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return Number.NaN;
  const date = `${y}-${pad2(mo)}-${pad2(d)}`;
  if (!isIsoDate(date)) return Number.NaN;
  return istInstant(date, `${pad2(h)}:${pad2(mi)}:${pad2(sec)}`);
}

/** Read a direction cell. Unknown or empty = "auto". */
export function parseDirection(raw: string | undefined): ImportDirection {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "auto";
  if (/^(in|i|0|c\/in|check[- ]?in|entry|enter|punch[- ]?in|checkin|d\/in|ot[- ]?in)$/.test(v)) return "in";
  if (/^(out|o|1|c\/out|check[- ]?out|exit|punch[- ]?out|checkout|d\/out|ot[- ]?out)$/.test(v)) return "out";
  return "auto";
}

export interface ParsedImportPunch {
  /** Row number in the file (1-based, counting the header). */
  row: number;
  employeeCode: string;
  at: number;
  direction: ImportDirection;
  deviceId: string;
}

export interface ImportRowError {
  row: number;
  reason: string;
}

/** Apply a mapping to file rows. Rows that cannot be read are returned with the reason; the rest are punches. */
export function buildImportPunches(rows: readonly string[][], mapping: ImportMapping, opts: { maxRows?: number } = {}): { punches: ParsedImportPunch[]; errors: ImportRowError[]; total: number } {
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const offset = mapping.hasHeader ? 2 : 1;
  const punches: ParsedImportPunch[] = [];
  const errors: ImportRowError[] = [];
  const max = opts.maxRows ?? IMPORT_MAX_ROWS;
  body.slice(0, max).forEach((cells, i) => {
    const row = i + offset;
    if (cells.every((c) => c.trim() === "")) return;
    const code = (cells[mapping.employeeCode] ?? "").trim();
    if (!code) {
      errors.push({ row, reason: "No employee code." });
      return;
    }
    const raw = mapping.timestamp !== undefined
      ? (cells[mapping.timestamp] ?? "")
      : `${(cells[mapping.date!] ?? "").trim()} ${(cells[mapping.time!] ?? "").trim()}`;
    const at = parseDeviceTimestamp(raw, mapping.dateOrder);
    if (Number.isNaN(at)) {
      errors.push({ row, reason: `Date and time "${raw.trim().slice(0, 40)}" could not be read.` });
      return;
    }
    punches.push({
      row,
      employeeCode: code,
      at,
      direction: mapping.direction !== undefined ? parseDirection(cells[mapping.direction]) : "auto",
      deviceId: ((mapping.deviceId !== undefined ? cells[mapping.deviceId] : undefined)?.trim() || mapping.defaultDeviceId || "file").slice(0, 60),
    });
  });
  if (body.length > max) errors.push({ row: max + offset, reason: `Only the first ${max.toLocaleString("en-IN")} rows are read. Split the file by date range.` });
  return { punches, errors, total: body.length };
}

// ── Input schemas ────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const punchInputSchema = z.object({
  kind: z.enum(PUNCH_KINDS),
  /** The phone's clock, for reference only. The server's time is the punch time. */
  clientTime: z.number().int().positive(),
  deviceId: z.string().trim().min(1).max(80),
  lat: latitude.optional(),
  lng: longitude.optional(),
  accuracyM: z.number().min(0).max(100_000).optional(),
  /**
   * The phone said its location is mocked (Android reports this). Only a hint the app volunteers, easily
   * left out by a modified app: the punch is then flagged for review. The server cannot detect a fake location itself.
   */
  mockLocation: z.boolean().optional(),
  /** A resized JPEG or PNG as a data URL. Required when the business asks for selfies. */
  selfie: z.string().max(450_000).optional(),
  consentVersion: z.string().max(40),
}).refine((v) => (v.lat === undefined) === (v.lng === undefined), "Send both latitude and longitude, or neither.");
export type PunchInput = z.infer<typeof punchInputSchema>;

export const monthInputSchema = z.object({ month: z.string().refine(isPayrollMonth, "Enter a month like 2026-10.") });

/** An employee's own leave application: the employee is the signed-in person, never an input. */
export const selfLeaveApplySchema = z
  .object({
    leaveTypeId: uuid,
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    halfDayStart: z.boolean().default(false),
    halfDayEnd: z.boolean().default(false),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, { path: ["toDate"], message: "The end date cannot be before the start date." });

export const workLocationSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  lat: latitude,
  lng: longitude,
  radiusM: z.number().int().min(20, "Use at least 20 metres.").max(5000),
});

export const attendanceSettingsSchema = z.object({
  punchEnabled: z.boolean(),
  geofencePolicy: z.enum(GEOFENCE_POLICIES),
  accuracyThresholdM: z.number().int().min(10).max(1000),
  selfieRequired: z.boolean(),
  selfieRetentionDays: z.number().int().min(MIN_SELFIE_RETENTION_DAYS).max(MAX_SELFIE_RETENTION_DAYS),
  lateGraceMinutes: z.number().int().min(0).max(240),
  fullDayMinHours: z.number().min(1).max(16).nullable(),
  halfDayMinHours: z.number().min(0.5).max(16).nullable(),
  overtimeFromPunches: z.boolean(),
});
export type AttendanceSettingsInput = z.infer<typeof attendanceSettingsSchema>;

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettingsInput = {
  punchEnabled: true,
  geofencePolicy: "record",
  accuracyThresholdM: DEFAULT_ACCURACY_THRESHOLD_M,
  selfieRequired: true,
  selfieRetentionDays: DEFAULT_SELFIE_RETENTION_DAYS,
  lateGraceMinutes: 15,
  fullDayMinHours: null,
  halfDayMinHours: null,
  overtimeFromPunches: false,
};

export const employeeInviteSchema = z.object({
  employeeId: uuid,
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255),
});

export const punchReviewSchema = z.object({
  punchId: uuid,
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(300).optional(),
});

export const importRowsSchema = z.object({
  rows: z.array(z.array(z.string().max(200)).max(60)).min(1).max(IMPORT_MAX_ROWS + 1),
  mapping: importMappingSchema,
  fileName: z.string().trim().max(200).optional(),
});

/** One punch pushed by a device or middleware. */
export const devicePunchSchema = z.object({
  employeeCode: z.string().trim().min(1).max(40),
  /** ISO 8601 with an offset, or "YYYY-MM-DD HH:MM:SS" in IST. */
  timestamp: z.string().trim().min(8).max(40),
  direction: z.enum(IMPORT_DIRECTIONS).default("auto"),
  deviceId: z.string().trim().max(60).optional(),
});
export const devicePushSchema = z.object({
  punches: z.array(devicePunchSchema).min(1).max(PUSH_MAX_PUNCHES),
});

export const SELF_ATTENDANCE_FLAG_LABELS: Record<string, string> = {
  late: "Late",
  outside_geofence: "Outside the work location",
  no_location: "No location sent",
  low_accuracy: "Location too imprecise",
  missed_out: "Missing check-out",
  open: "Not checked out yet",
  orphan_out: "Check-out without check-in",
  clock_skew: "Phone clock was off",
  mock_location: "Phone reported a mock location",
  duplicate: "Duplicate",
};
