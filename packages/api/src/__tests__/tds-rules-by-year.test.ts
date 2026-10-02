import { describe, it, expect } from "vitest";
import { computeTcs, computeTds, tdsFinancialYear } from "@fintranzact/shared";
import { loadSectionRules } from "../lib/tds-service.js";
import { loadTcsSectionRules, tcsForLines } from "../lib/tcs-service.js";

/** A db whose select().from().where() resolves to the given override rows. */
const fakeDb = (rowsByFy: Record<string, unknown[]> = {}) => ({
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(Object.values(rowsByFy).flat()),
    }),
  }),
});

// The services pick the year from the transaction date, never from today.
const fyOf = (iso: string) => tdsFinancialYear(new Date(iso));

describe("TCS on scrap follows the year of the sale", () => {
  const line = [{ tcsSection: "206C_SCRAP", taxable: "100000" }];

  it("collects 1% on a sale dated 31 March 2026 and 2% on 1 April 2026", async () => {
    const before = fyOf("2026-03-31T06:30:00Z");
    const after = fyOf("2026-04-01T06:30:00Z");
    expect([before, after]).toEqual(["2025-26", "2026-27"]);

    const old = tcsForLines(await loadTcsSectionRules(fakeDb(), "b1", before), line, true);
    const next = tcsForLines(await loadTcsSectionRules(fakeDb(), "b1", after), line, true);
    expect(old).toMatchObject({ amount: "1000.00", sections: [{ rate: "1" }] });
    expect(next).toMatchObject({ amount: "2000.00", sections: [{ rate: "2" }] });
  });

  it("a business override wins over the built-in default of that year only", async () => {
    const db = fakeDb({ x: [{ sectionCode: "206C_SCRAP", rate: "1.500", rateWithoutPan: null, singleThreshold: null, isActive: true }] });
    const rules = await loadTcsSectionRules(db, "b1", "2026-27");
    const scrap = rules.find((r) => r.code === "206C_SCRAP")!;
    expect(scrap.rate).toBe("1.5");
    expect(scrap.rateWithoutPan).toBe("5"); // not overridden: default of that year
    expect(computeTcs({ section: scrap, hasPan: true, taxable: "100000" }).tcs).toBe("1500.00");
    // another year of the same business is unaffected: the fake db is per call, so an empty one stands for it
    const other = (await loadTcsSectionRules(fakeDb(), "b1", "2025-26")).find((r) => r.code === "206C_SCRAP")!;
    expect(other.rate).toBe("1");
  });

  it("a switched-off section stays off", async () => {
    const db = fakeDb({ x: [{ sectionCode: "206C_SCRAP", isActive: false }] });
    expect((await loadTcsSectionRules(db, "b1", "2026-27")).some((r) => r.code === "206C_SCRAP")).toBe(false);
  });
});

describe("TDS 194C is unchanged across the Act change", () => {
  it("deducts the same on either side of 1 April 2026", async () => {
    const run = async (iso: string) => {
      const rules = await loadSectionRules(fakeDb(), "b1", fyOf(iso));
      const section = rules.find((r) => r.code === "194C")!;
      return computeTds({ section, hasPan: true, amount: "50000", ytdBase: "0", ytdTaxedBase: "0" });
    };
    const a = await run("2026-03-31T06:30:00Z");
    const b = await run("2026-04-01T06:30:00Z");
    expect(a).toEqual(b);
    expect(b).toMatchObject({ rate: "2", tds: "1000.00" });
  });

  it("an override for one year wins over that year's default", async () => {
    const db = fakeDb({ x: [{ sectionCode: "194C", rate: "3.000", individualRate: null, rateWithoutPan: null, singleThreshold: null, aggregateThreshold: "200000", isActive: true }] });
    const c = (await loadSectionRules(db, "b1", "2026-27")).find((r) => r.code === "194C")!;
    expect(c).toMatchObject({ rate: "3", aggregateThreshold: "200000", singleThreshold: "30000", individualRate: "1", paymentCode: "1023/1024" });
  });
});
