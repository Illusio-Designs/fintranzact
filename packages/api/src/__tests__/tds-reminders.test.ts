import { describe, it, expect } from "vitest";
import { buildReminderItems, daysUntil, depositsDueFromMonths, reminderEmail, reminderOffset } from "../lib/tds-reminders.js";

// 02 Oct 2026, 10:00 India time.
const now = new Date("2026-10-02T04:30:00Z");

describe("depositsDueFromMonths", () => {
  it("drops months with nothing pending and flags overdue ones", () => {
    const r = depositsDueFromMonths("tds", [
      { month: "2026-08", pending: "500.00" },
      { month: "2026-09", pending: "0.00" },
      { month: "2026-10", pending: "900.00" },
    ], now.getTime());
    expect(r.map((x) => x.month)).toEqual(["2026-08", "2026-10"]);
    expect(r[0]!.overdue).toBe(true); // due 7 Sep
    expect(r[1]!.overdue).toBe(false); // due 7 Nov
  });

  it("uses 30 April for March deductions under TDS", () => {
    const [r] = depositsDueFromMonths("tds", [{ month: "2027-03", pending: "10.00" }], now.getTime());
    expect(r!.dueDate.toISOString()).toBe(new Date("2027-04-29T18:30:00Z").toISOString());
  });
});

describe("reminderOffset / daysUntil", () => {
  it("maps days to once-per-item buckets", () => {
    expect(reminderOffset(10)).toBeNull();
    expect(reminderOffset(7)).toBe(7);
    expect(reminderOffset(1)).toBe(7);
    expect(reminderOffset(0)).toBe(0);
    expect(reminderOffset(-3)).toBe(-1);
  });
  it("counts India calendar days", () => {
    expect(daysUntil(new Date("2026-10-06T18:30:00Z"), now)).toBe(5); // 7 Oct IST
    expect(daysUntil(new Date("2026-10-01T18:30:00Z"), now)).toBe(0); // 2 Oct IST
  });
});

describe("buildReminderItems", () => {
  const input = {
    kind: "tds" as const,
    financialYear: "2026-27",
    depositsDue: depositsDueFromMonths("tds", [
      { month: "2026-08", pending: "500.00" },
      { month: "2026-09", pending: "700.00" },
      { month: "2026-12", pending: "50.00" },
    ], now.getTime()),
    // Q1 return was due 31 Jul (63 days ago), Q2 is due 31 Oct (29 days away).
    quarters: [{ quarter: 1 as const, total: "100.00" }, { quarter: 2 as const, total: "5000.00" }],
  };

  it("lists overdue and near items soonest first, and skips far-off ones", () => {
    const items = buildReminderItems([input], now);
    expect(items.map((i) => i.key)).toEqual([
      "deposit:tds:2026-27:2026-08", // overdue since 7 Sep
      "deposit:tds:2026-27:2026-09", // due 7 Oct
    ]);
    expect(items[0]!.overdue).toBe(true);
    expect(items[1]!.daysUntil).toBe(5);
  });

  it("includes a return inside the horizon and a recently overdue one", () => {
    const wide = buildReminderItems([input], now, { horizonDays: 30, returnGraceDays: 90 });
    const keys = wide.map((i) => i.key);
    expect(keys).toContain("return:tds:2026-27:Q1");
    expect(keys).toContain("return:tds:2026-27:Q2");
    expect(wide.find((i) => i.key.endsWith("Q1"))!.overdue).toBe(true);
  });

  it("ignores quarters with no tax", () => {
    const items = buildReminderItems([{ ...input, quarters: [{ quarter: 2, total: "0.00" }] }], now, { horizonDays: 60 });
    expect(items.some((i) => i.type === "return")).toBe(false);
  });
});

describe("reminderEmail", () => {
  it("states the amounts and tells the reader to verify with a CA", () => {
    const items = buildReminderItems([{
      kind: "tds", financialYear: "2026-27",
      depositsDue: depositsDueFromMonths("tds", [{ month: "2026-08", pending: "500.00" }], now.getTime()),
      quarters: [],
    }], now);
    const { subject, text } = reminderEmail("Acme", items);
    expect(subject).toContain("overdue");
    expect(text).toContain("Rs 500.00 to deposit");
    expect(text).toContain("25 days overdue");
    expect(text.toLowerCase()).toContain("verify due dates with your ca");
  });
});
