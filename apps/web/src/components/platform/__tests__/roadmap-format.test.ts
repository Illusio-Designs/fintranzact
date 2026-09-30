import { describe, it, expect } from "vitest";
import { descriptionSummary, formatTargetMonth, parseDescription, splitBold } from "../roadmap-format";

describe("parseDescription", () => {
  it("splits headings, paragraphs, bullets and numbered steps", () => {
    const text = `Core of payroll.
Built with billing.

### Employee master
- Name, DOB
- PAN, UAN

1. Lock attendance
2. Calculate net pay`;
    expect(parseDescription(text)).toEqual([
      { kind: "p", text: "Core of payroll. Built with billing." },
      { kind: "h", text: "Employee master" },
      { kind: "ul", items: ["Name, DOB", "PAN, UAN"] },
      { kind: "ol", items: ["Lock attendance", "Calculate net pay"] },
    ]);
  });

  it("returns nothing for an empty description", () => {
    expect(parseDescription("  \n\n ")).toEqual([]);
  });

  it("keeps HTML as plain text", () => {
    expect(parseDescription("<script>alert(1)</script>")).toEqual([{ kind: "p", text: "<script>alert(1)</script>" }]);
  });
});

describe("splitBold", () => {
  it("marks **bold** parts", () => {
    expect(splitBold("**PF:** 12% of wages")).toEqual([
      { bold: true, text: "PF:" },
      { bold: false, text: " 12% of wages" },
    ]);
  });
});

describe("descriptionSummary", () => {
  it("uses the first paragraph without bold markers", () => {
    expect(descriptionSummary("### Heading\n**Get paid** faster.\n\n- a bullet")).toBe("Get paid faster.");
  });
});

describe("formatTargetMonth", () => {
  it("shows a month and year", () => {
    expect(formatTargetMonth("2026-12")).toBe("Dec 2026");
    expect(formatTargetMonth(null)).toBeNull();
  });
});
