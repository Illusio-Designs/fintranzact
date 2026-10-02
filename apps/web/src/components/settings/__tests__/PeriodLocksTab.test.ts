import { describe, it, expect } from "vitest";
import { finishedYears, lockDateLabel, returnMonthLabel } from "../PeriodLocksTab";

describe("period lock labels", () => {
  it("formats lock dates and return months", () => {
    expect(lockDateLabel("2026-03-31")).toBe("31 Mar 2026");
    expect(returnMonthLabel("2026-08")).toBe("Aug 2026");
  });

  it("offers only years that have ended, newest first", () => {
    expect(finishedYears("2026-10-02", 3)).toEqual(["2025-26", "2024-25", "2023-24"]);
    // Before April the current year started last calendar year.
    expect(finishedYears("2026-02-10", 2)).toEqual(["2024-25", "2023-24"]);
  });
});
