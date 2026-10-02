import { describe, it, expect } from "vitest";
import { createExpenseSchema } from "@fintranzact/shared";
import { assertExpenseTdsInput } from "../lib/tds-service.js";

describe("assertExpenseTdsInput", () => {
  it("stores no section or amount when there is no TDS", () => {
    expect(assertExpenseTdsInput("none", null, "194J_PROF", "500", "10000")).toEqual({ mode: "none", section: null, amount: "0" });
  });

  it("needs a payee for any TDS", () => {
    expect(() => assertExpenseTdsInput("auto", null, null, null, "10000")).toThrow(/who was paid/i);
    expect(() => assertExpenseTdsInput("manual", undefined, "194J_PROF", "500", "10000")).toThrow(/who was paid/i);
  });

  it("auto keeps the chosen section (or none) and leaves the amount to be worked out", () => {
    expect(assertExpenseTdsInput("auto", "p1", "194J_PROF", "999", "10000")).toEqual({ mode: "auto", section: "194J_PROF", amount: "0" });
    expect(assertExpenseTdsInput("auto", "p1", "", null, "10000")).toEqual({ mode: "auto", section: null, amount: "0" });
  });

  it("manual needs a section and an amount below the expense", () => {
    expect(assertExpenseTdsInput("manual", "p1", "194I_LB", "1000", "10000")).toEqual({ mode: "manual", section: "194I_LB", amount: "1000" });
    expect(() => assertExpenseTdsInput("manual", "p1", null, "1000", "10000")).toThrow(/section/i);
    expect(() => assertExpenseTdsInput("manual", "p1", "194I_LB", "10000", "10000")).toThrow(/less than/i);
    expect(assertExpenseTdsInput("manual", "p1", "194I_LB", "", "10000").amount).toBe("0");
  });
});

describe("createExpenseSchema TDS fields", () => {
  const base = { category: "Rent", amount: "10000", mode: "bank" as const };

  it("stays valid with no TDS fields", () => {
    expect(createExpenseSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a payee, mode, section and amount", () => {
    const r = createExpenseSchema.safeParse({
      ...base, partyId: "7b1f0f8a-6a52-4b71-9c64-0d5d1f3a9e11", tdsMode: "manual", tdsSection: "194I_LB", tdsAmount: "1000.50",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown mode, section or a malformed amount", () => {
    expect(createExpenseSchema.safeParse({ ...base, tdsMode: "maybe" }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, tdsSection: "999Z" }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, tdsAmount: "-5" }).success).toBe(false);
  });
});
