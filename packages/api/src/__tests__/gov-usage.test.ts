import { describe, it, expect } from "vitest";
import { govRatePaise, istPeriod, periodIsClosed, isWalletOrQuotaError } from "../lib/gov-usage.js";

describe("govRatePaise", () => {
  it("uses the default when no override", () => {
    expect(govRatePaise("e_invoice", {})).toBe(200);
    expect(govRatePaise("gstr1_filed", {})).toBe(0);
  });
  it("honours a valid env override, including 0", () => {
    expect(govRatePaise("e_way_bill", { GOV_RATE_E_WAY_BILL_PAISE: "350" })).toBe(350);
    expect(govRatePaise("e_invoice", { GOV_RATE_E_INVOICE_PAISE: "0" })).toBe(0);
  });
  it("ignores invalid overrides", () => {
    expect(govRatePaise("e_invoice", { GOV_RATE_E_INVOICE_PAISE: "abc" })).toBe(200);
    expect(govRatePaise("e_invoice", { GOV_RATE_E_INVOICE_PAISE: "-5" })).toBe(200);
    expect(govRatePaise("e_invoice", { GOV_RATE_E_INVOICE_PAISE: "1.5" })).toBe(200);
    expect(govRatePaise("e_invoice", { GOV_RATE_E_INVOICE_PAISE: "" })).toBe(200);
  });
});

describe("istPeriod", () => {
  it("rolls the month at IST midnight, not UTC", () => {
    // 2026-01-31 18:29:59 UTC = 23:59:59 IST on 31 Jan
    expect(istPeriod(new Date("2026-01-31T18:29:59Z"))).toBe("2026-01");
    // 18:30 UTC = 00:00 IST on 1 Feb
    expect(istPeriod(new Date("2026-01-31T18:30:00Z"))).toBe("2026-02");
  });
  it("rolls the year", () => {
    expect(istPeriod(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01");
  });
});

describe("periodIsClosed", () => {
  const now = new Date("2026-03-15T10:00:00Z");
  it("is closed only for earlier months", () => {
    expect(periodIsClosed("2026-02", now)).toBe(true);
    expect(periodIsClosed("2025-12", now)).toBe(true);
    expect(periodIsClosed("2026-03", now)).toBe(false);
    expect(periodIsClosed("2026-04", now)).toBe(false);
  });
  it("closes at the IST month boundary", () => {
    expect(periodIsClosed("2026-01", new Date("2026-01-31T18:29:59Z"))).toBe(false);
    expect(periodIsClosed("2026-01", new Date("2026-01-31T18:30:00Z"))).toBe(true);
  });
});

describe("isWalletOrQuotaError", () => {
  it("treats 402 as a funding failure", () => {
    expect(isWalletOrQuotaError(402, "")).toBe(true);
  });
  it("matches wallet and quota messages", () => {
    expect(isWalletOrQuotaError(400, "Insufficient balance in wallet")).toBe(true);
    expect(isWalletOrQuotaError(429, "Quota exceeded")).toBe(true);
    expect(isWalletOrQuotaError(undefined, "limit exceeded")).toBe(true);
  });
  it("ignores ordinary errors", () => {
    expect(isWalletOrQuotaError(400, "Invalid GSTIN")).toBe(false);
    expect(isWalletOrQuotaError(500, "Internal error")).toBe(false);
  });
});
