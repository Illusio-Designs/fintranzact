import { describe, it, expect } from "vitest";
import { indiaTimeTheme } from "../useTheme";

// IST = UTC + 5:30. Light from 06:00 to 18:59 IST, dark otherwise.
const at = (utcIso: string) => indiaTimeTheme(new Date(utcIso));

describe("indiaTimeTheme — public pages follow the time of day in India", () => {
  it("is light at 06:00 IST (00:30 UTC)", () => {
    expect(at("2026-09-29T00:30:00Z")).toBe("light");
  });
  it("is dark at 05:59 IST (00:29 UTC)", () => {
    expect(at("2026-09-29T00:29:00Z")).toBe("dark");
  });
  it("is light at noon IST (06:30 UTC)", () => {
    expect(at("2026-09-29T06:30:00Z")).toBe("light");
  });
  it("is light at 18:59 IST and dark from 19:00 IST", () => {
    expect(at("2026-09-29T13:29:00Z")).toBe("light");
    expect(at("2026-09-29T13:30:00Z")).toBe("dark");
  });
  it("is dark around midnight IST (18:30 UTC the day before)", () => {
    expect(at("2026-09-28T18:30:00Z")).toBe("dark");
  });
});
