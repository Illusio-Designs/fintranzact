import { describe, it, expect } from "vitest";
import {
  addDays, carryForward, countLeaveDays, dateRange, datesOfMonth, daysInMonth, formatPayrollMonth, isIsoDate, isPayrollMonth,
  leaveYearOf, leaveYearStart, monthEnd, monthsOfLeaveYear, splitLeaveAgainstBalance, summarizeAttendance, weekdayOf, type DayRecord,
} from "../payroll-calendar.js";

const SUNDAY = [0];

function summary(over: Partial<Parameters<typeof summarizeAttendance>[0]> & { records?: Record<string, DayRecord> } = {}) {
  return summarizeAttendance({
    month: "2026-10",
    joiningDate: "2020-01-01",
    weeklyOffDays: SUNDAY,
    holidays: [],
    records: {},
    unmarkedAs: "present",
    ...over,
  });
}

describe("calendar helpers", () => {
  it("knows the days in every kind of month, leap years included", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2100-02")).toBe(28); // 2100 is not a leap year
    expect(daysInMonth("2000-02")).toBe(29);
    expect(daysInMonth("2026-04")).toBe(30);
    expect(daysInMonth("2026-10")).toBe(31);
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(datesOfMonth("2026-04")).toHaveLength(30);
  });
  it("validates dates and months", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate(20260101)).toBe(false);
    expect(isPayrollMonth("2026-10")).toBe(true);
    expect(isPayrollMonth("2026-13")).toBe(false);
    expect(isPayrollMonth("2026-1")).toBe(false);
  });
  it("finds weekdays and adds days across month and year ends", () => {
    expect(weekdayOf("2026-10-04")).toBe(0); // a Sunday
    expect(weekdayOf("2026-10-05")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(dateRange("2026-10-05", "2026-10-04")).toEqual([]);
  });
  it("formats a month", () => {
    expect(formatPayrollMonth("2026-10")).toBe("October 2026");
  });
});

describe("summarizeAttendance", () => {
  it("a full month, everyone present: paid days = days in month", () => {
    const s = summary();
    expect(s.daysInMonth).toBe(31);
    expect(s.employedDays).toBe(31);
    expect(s.paidDays).toBe(31);
    expect(s.lopDays).toBe(0);
    expect(s.weekOffDays).toBe(4); // Oct 2026 has 4 Sundays
  });

  it("absent days are loss of pay", () => {
    const s = summary({ records: { "2026-10-06": { status: "absent" }, "2026-10-07": { status: "absent" } } });
    expect(s.lopDays).toBe(2);
    expect(s.paidDays).toBe(29);
  });

  it("half days: half paid and half LOP; paid half-day leave makes the whole day paid", () => {
    expect(summary({ records: { "2026-10-06": { status: "half_day" } } }).paidDays).toBe(30.5);
    expect(summary({ records: { "2026-10-06": { status: "half_day" } } }).lopDays).toBe(0.5);
    const paidLeave = summary({ records: { "2026-10-06": { status: "half_day", leavePaid: true } } });
    expect(paidLeave.lopDays).toBe(0);
    expect(paidLeave.paidLeaveDays).toBe(0.5);
  });

  it("paid leave is paid, unpaid leave is LOP", () => {
    expect(summary({ records: { "2026-10-06": { status: "leave", leavePaid: true } } }).lopDays).toBe(0);
    const unpaid = summary({ records: { "2026-10-06": { status: "leave", leavePaid: false } } });
    expect(unpaid.lopDays).toBe(1);
    expect(unpaid.unpaidLeaveDays).toBe(1);
  });

  it("weekly offs and holidays are paid, with or without a record", () => {
    const s = summary({ holidays: ["2026-10-02", "2026-10-20"], records: { "2026-10-20": { status: "holiday" } } });
    expect(s.holidayDays).toBe(2);
    expect(s.lopDays).toBe(0);
  });

  it("a worked holiday with a present record is paid (and carries overtime)", () => {
    const s = summary({ holidays: ["2026-10-02"], records: { "2026-10-02": { status: "present", overtimeHours: 3.5 } } });
    expect(s.presentDays).toBe(31 - 4 - 0);
    expect(s.overtimeHours).toBe(3.5);
    expect(s.lopDays).toBe(0);
  });

  it("joining mid-month: only the employed days count; none of the earlier days are LOP", () => {
    const s = summary({ joiningDate: "2026-10-16" });
    expect(s.employedDays).toBe(16);
    expect(s.lopDays).toBe(0);
    expect(s.paidDays).toBe(16);
  });

  it("exit mid-month: days after the last working day are not part of the month", () => {
    const s = summary({ lastWorkingDay: "2026-10-10" });
    expect(s.employedDays).toBe(10);
    expect(s.paidDays).toBe(10);
  });

  it("joined and left in the same month, and joined after the month", () => {
    expect(summary({ joiningDate: "2026-10-10", lastWorkingDay: "2026-10-12" }).employedDays).toBe(3);
    const later = summary({ joiningDate: "2026-11-01" });
    expect(later.employedDays).toBe(0);
    expect(later.paidDays).toBe(0);
  });

  it("works for 28, 29 and 30 day months", () => {
    const feb = summarizeAttendance({ month: "2026-02", joiningDate: "2020-01-01", weeklyOffDays: [0], holidays: [], records: {}, unmarkedAs: "present" });
    expect(feb.employedDays).toBe(28);
    expect(feb.paidDays).toBe(28);
    const leap = summarizeAttendance({ month: "2028-02", joiningDate: "2020-01-01", weeklyOffDays: [0], holidays: [], records: { "2028-02-29": { status: "absent" } }, unmarkedAs: "present" });
    expect(leap.employedDays).toBe(29);
    expect(leap.paidDays).toBe(28);
    const apr = summarizeAttendance({ month: "2026-04", joiningDate: "2020-01-01", weeklyOffDays: [0], holidays: [], records: {}, unmarkedAs: "present" });
    expect(apr.paidDays).toBe(30);
  });

  it("everyone absent for the whole month: zero paid days", () => {
    const records: Record<string, DayRecord> = {};
    for (const d of datesOfMonth("2026-10")) records[d] = { status: "absent" };
    const s = summary({ records });
    expect(s.lopDays).toBe(31);
    expect(s.paidDays).toBe(0);
  });

  it("unmarked working days are reported and count as absent by default", () => {
    const s = summarizeAttendance({ month: "2026-10", joiningDate: "2020-01-01", weeklyOffDays: [0], holidays: [], records: {} });
    expect(s.unmarkedDates).toHaveLength(27);
    expect(s.lopDays).toBe(27);
    expect(s.paidDays).toBe(4);
  });

  it("accepts a Map of records and a Set of holidays", () => {
    const s = summarizeAttendance({
      month: "2026-10", joiningDate: "2020-01-01", weeklyOffDays: [0], holidays: new Set(["2026-10-02"]),
      records: new Map<string, DayRecord>([["2026-10-06", { status: "absent" }]]), unmarkedAs: "present",
    });
    expect(s.lopDays).toBe(1);
    expect(s.holidayDays).toBe(1);
  });
});

describe("leave rules", () => {
  it("leave years run April to March by default", () => {
    expect(leaveYearStart("2026-03-31")).toBe("2025-04-01");
    expect(leaveYearStart("2026-04-01")).toBe("2026-04-01");
    expect(leaveYearOf("2026-12-25")).toBe(2026);
    expect(leaveYearOf("2027-01-05")).toBe(2026);
    expect(leaveYearOf("2027-01-05", 1)).toBe(2027);
    expect(monthsOfLeaveYear(2026)[0]).toBe("2026-04");
    expect(monthsOfLeaveYear(2026)[11]).toBe("2027-03");
    expect(monthsOfLeaveYear(2026, 1)[11]).toBe("2026-12");
  });

  it("counts leave days without weekly offs and holidays, with half days at the ends", () => {
    // Fri 2 Oct (holiday) to Tue 6 Oct: Fri holiday, Sat, Sun off, Mon, Tue.
    const r = countLeaveDays({ from: "2026-10-02", to: "2026-10-06", weeklyOffDays: [0], holidays: ["2026-10-02"] });
    expect(r.dates.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-05", "2026-10-06"]);
    expect(r.days).toBe(3);
    const half = countLeaveDays({ from: "2026-10-05", to: "2026-10-06", weeklyOffDays: [0], holidays: [], halfDayStart: true, halfDayEnd: true });
    expect(half.days).toBe(1);
    expect(countLeaveDays({ from: "2026-10-05", to: "2026-10-05", weeklyOffDays: [0], holidays: [], halfDayStart: true }).days).toBe(0.5);
    expect(countLeaveDays({ from: "2026-10-04", to: "2026-10-04", weeklyOffDays: [0], holidays: [] }).days).toBe(0);
  });

  it("uses the balance first, then the rest is loss of pay", () => {
    expect(splitLeaveAgainstBalance(3, 5)).toEqual({ paid: 3, lop: 0 });
    expect(splitLeaveAgainstBalance(3, 1.5)).toEqual({ paid: 1.5, lop: 1.5 });
    expect(splitLeaveAgainstBalance(2, 0)).toEqual({ paid: 0, lop: 2 });
    expect(splitLeaveAgainstBalance(2, -4)).toEqual({ paid: 0, lop: 2 });
  });

  it("carry-forward keeps up to the maximum and lapses the rest", () => {
    expect(carryForward(40, { carryForward: true, carryForwardMax: 30 })).toEqual({ carried: 30, lapsed: 10 });
    expect(carryForward(12.5, { carryForward: true, carryForwardMax: 30 })).toEqual({ carried: 12.5, lapsed: 0 });
    expect(carryForward(5, { carryForward: false, carryForwardMax: 30 })).toEqual({ carried: 0, lapsed: 5 });
    expect(carryForward(-2, { carryForward: true, carryForwardMax: 30 })).toEqual({ carried: 0, lapsed: 0 });
  });
});
