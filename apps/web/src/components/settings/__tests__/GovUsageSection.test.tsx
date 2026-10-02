import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { summaryReturn, statementsReturn } = vi.hoisted(() => ({
  summaryReturn: { current: null as any },
  statementsReturn: { current: null as any },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    govUsage: {
      summary: { useQuery: () => summaryReturn.current },
      statements: { useQuery: () => statementsReturn.current },
    },
  },
}));

import { GovUsageSection, formatPeriod } from "../GovUsageSection";

const summary = (lines: any[]) => ({
  data: {
    summary: { period: "2026-10", lines, documents: 3, basePaise: 600, gstPaise: 108, totalPaise: 708, closed: false },
    rateCard: [],
    periods: ["2026-09"],
  },
  isLoading: false,
});

describe("GovUsageSection", () => {
  it("formats periods", () => {
    expect(formatPeriod("2026-09")).toBe("September 2026");
  });

  it("shows lines, totals and the billing note", () => {
    summaryReturn.current = summary([{ kind: "e_invoice", label: "E-invoice (IRN)", count: 3, ratePaise: 200, amountPaise: 600 }]);
    statementsReturn.current = { data: [] };
    render(<GovUsageSection />);
    expect(screen.getByText("E-invoice (IRN)")).toBeTruthy();
    expect(screen.getByText(/Billed after month end, no advance/)).toBeTruthy();
    expect(screen.getByText(/Total so far/)).toBeTruthy();
    expect(screen.getByText("No statements yet.")).toBeTruthy();
  });

  it("shows empty states and past statements", () => {
    summaryReturn.current = summary([]);
    statementsReturn.current = {
      data: [{ period: "2026-09", documents: 5, totalPaise: 1180, closed: true, billed: true, invoiceNumber: "FT-INV-7", paymentStatus: "due" }],
    };
    render(<GovUsageSection />);
    expect(screen.getByText(/No documents filed in October 2026/)).toBeTruthy();
    expect(screen.getByText("FT-INV-7")).toBeTruthy();
    expect(screen.getByText("Payment due")).toBeTruthy();
  });
});
