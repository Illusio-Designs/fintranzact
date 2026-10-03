/**
 * HsnSacInput — the details card for each answer source (Sandbox, refreshed,
 * bundled), the advisory warning, the muted status lines, and the debounce /
 * stale-answer behaviour. trpc is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within, fireEvent } from "@testing-library/react";
import { useState } from "react";

type ValidateData = Record<string, unknown>;
const answers = new Map<string, ValidateData>();
const validateCalls: Array<{ hsn: string; enabled: boolean }> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    hsn: {
      search: { useQuery: () => ({ data: [], isLoading: false, isError: false, isSuccess: true }) },
      validate: {
        useQuery: (input: { hsn: string }, opts: { enabled: boolean }) => {
          validateCalls.push({ hsn: input.hsn, enabled: opts.enabled });
          const data = opts.enabled ? answers.get(input.hsn) : undefined;
          return { data, isLoading: opts.enabled && !data };
        },
      },
    },
  },
}));

import { HsnSacInput } from "../HsnSacInput";

const details = (code = "30041010", over: Record<string, unknown> = {}) => ({
  code, description: "Medicaments of penicillins (CBIC)", type: "goods", match: "exact", subCodes: 0, ...over,
});
const sandbox = (over: Record<string, unknown> = {}) => ({
  description: "Sandbox penicillin medicaments", rate: 12, effectiveFrom: "2017-07-01", effectiveTo: null, active: true, inactiveReason: null, ...over,
});

function Harness({ initial = "", itemType }: { initial?: string; itemType?: string }) {
  const [v, setV] = useState(initial);
  return <HsnSacInput value={v} onChange={setV} itemType={itemType} />;
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}

beforeEach(() => {
  vi.useFakeTimers();
  answers.clear();
  validateCalls.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("HsnSacInput details card", () => {
  it("shows Sandbox's description, rate and dates with a 'Verified with Sandbox' badge", async () => {
    answers.set("30041010", { valid: true, details: details(), source: "sandbox", sandboxStatus: "ok", checkedAt: null, sandbox: sandbox() });
    render(<Harness initial="30041010" />);
    await settle();
    const card = screen.getByTestId("hsn-details");
    expect(within(card).getByText("Verified with Sandbox")).toBeInTheDocument();
    expect(within(card).getByText("Sandbox penicillin medicaments")).toBeInTheDocument();
    expect(within(card).getByText(/GST 12%/)).toBeInTheDocument();
    expect(within(card).getByText(/effective 1 Jul 2017/)).toBeInTheDocument();
    expect(within(card).queryByText(/official CBIC list/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/Live check unavailable/)).not.toBeInTheDocument();
  });

  it("bundled only: says it is from the official CBIC list, nothing extra when Sandbox is not configured", async () => {
    answers.set("30041010", { valid: true, details: details(), source: "bundled", sandboxStatus: "not_configured", checkedAt: null, sandbox: null });
    render(<Harness initial="30041010" />);
    await settle();
    const card = screen.getByTestId("hsn-details");
    expect(within(card).getByText("From the official CBIC list")).toBeInTheDocument();
    expect(within(card).getByText("Medicaments of penicillins (CBIC)")).toBeInTheDocument();
    expect(within(card).queryByText("Verified with Sandbox")).not.toBeInTheDocument();
    expect(within(card).queryByText(/Live check unavailable/)).not.toBeInTheDocument();
  });

  it("bundled fallback while Sandbox is unavailable adds a muted status line", async () => {
    answers.set("30041010", { valid: true, details: details(), source: "bundled", sandboxStatus: "unavailable", checkedAt: null, sandbox: null });
    render(<Harness initial="30041010" />);
    await settle();
    const card = screen.getByTestId("hsn-details");
    expect(within(card).getByText("From the official CBIC list")).toBeInTheDocument();
    expect(within(card).getByText("Live check unavailable, showing the bundled list")).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-live", "polite");
  });

  it("a refreshed answer is labelled as Sandbox's, with the date it was checked", async () => {
    answers.set("30041010", {
      valid: true, details: details(), source: "refreshed", sandboxStatus: "unavailable",
      checkedAt: "2026-09-30T04:00:00.000Z", sandbox: sandbox({ description: "Refreshed description" }),
    });
    render(<Harness initial="30041010" />);
    await settle();
    const card = screen.getByTestId("hsn-details");
    expect(within(card).getByText("Verified with Sandbox")).toBeInTheDocument();
    expect(within(card).getByText("Refreshed description")).toBeInTheDocument();
    expect(within(card).getByText(/Live check unavailable, showing Sandbox's answer from 30 Sept 2026|Live check unavailable, showing Sandbox's answer from 30 Sep 2026/)).toBeInTheDocument();
  });

  it("shows the server's warning as an amber note and never as an error", async () => {
    answers.set("30041010", {
      valid: true, details: details(), source: "sandbox", sandboxStatus: "ok", checkedAt: null,
      sandbox: sandbox({ active: false, inactiveReason: "Replaced" }), warning: "30041010 is no longer active on Sandbox: Replaced.",
    });
    render(<Harness initial="30041010" />);
    await settle();
    const card = screen.getByTestId("hsn-details");
    expect(within(card).getByText(/no longer active on Sandbox: Replaced/)).toBeInTheDocument();
    expect(within(card).getByText(/^Note:/)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-invalid");
  });

  it("not found on Sandbox but in the bundled list: bundled card plus the warning", async () => {
    answers.set("30041010", {
      valid: true, details: details(), source: "bundled", sandboxStatus: "not_found", checkedAt: null, sandbox: null,
      warning: "Sandbox does not list 30041010; showing the bundled CBIC description.",
    });
    render(<Harness initial="30041010" />);
    await settle();
    const card = screen.getByTestId("hsn-details");
    expect(within(card).getByText("From the official CBIC list")).toBeInTheDocument();
    expect(within(card).getByText(/Sandbox does not list 30041010/)).toBeInTheDocument();
  });

  it("a code not in the list is still the same blocking-style error as before", async () => {
    answers.set("99999999", { valid: false, source: "bundled", sandboxStatus: "not_configured", checkedAt: null, sandbox: null });
    render(<Harness initial="99999999" />);
    await settle();
    expect(screen.getByText("99999999 is not in the GST HSN / SAC list")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the product / service mismatch hint", async () => {
    answers.set("998713", { valid: true, details: details("998713", { type: "services", description: "IT support" }), source: "bundled", sandboxStatus: "not_configured", checkedAt: null, sandbox: null });
    render(<Harness initial="998713" itemType="product" />);
    await settle();
    expect(screen.getByText(/products use HSN codes, not SAC/)).toBeInTheDocument();
  });
});

describe("HsnSacInput request behaviour", () => {
  it("does not check until typing settles (debounce), and reserves space meanwhile", async () => {
    answers.set("30041010", { valid: true, details: details(), source: "sandbox", sandboxStatus: "ok", checkedAt: null, sandbox: sandbox() });
    render(<Harness />);
    act(() => { fireEvent.change(screen.getByRole("combobox"), { target: { value: "30041010" } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(validateCalls.some((c) => c.enabled)).toBe(false);
    expect(screen.getByTestId("hsn-details").className).toContain("min-h-");
    expect(screen.getByText("Checking the code…")).toBeInTheDocument();
    await settle();
    expect(validateCalls.some((c) => c.enabled && c.hsn === "30041010")).toBe(true);
    expect(screen.queryByText("Checking the code…")).not.toBeInTheDocument();
    expect(screen.getByText("Sandbox penicillin medicaments")).toBeInTheDocument();
  });

  it("never shows the previous code's card for a newer code (stale answers are dropped)", async () => {
    answers.set("30041010", { valid: true, details: details(), source: "sandbox", sandboxStatus: "ok", checkedAt: null, sandbox: sandbox() });
    render(<Harness initial="30041010" />);
    await settle();
    expect(screen.getByText("Sandbox penicillin medicaments")).toBeInTheDocument();
    const input = screen.getByRole("combobox");
    act(() => { fireEvent.change(input, { target: { value: "300410" } }); });
    // New code typed, its answer not here yet: the old card is gone, status says checking.
    expect(screen.queryByText("Sandbox penicillin medicaments")).not.toBeInTheDocument();
    expect(screen.getByText("Checking the code…")).toBeInTheDocument();
    // An answer for a code that is no longer in the field is never shown.
    answers.set("300410", { valid: true, details: details("300410", { description: "Heading text" }), source: "bundled", sandboxStatus: "not_configured", checkedAt: null, sandbox: null });
    act(() => { fireEvent.change(input, { target: { value: "3004" } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByText("Heading text")).not.toBeInTheDocument();
  });

  it("does not call for codes that are not 4, 6 or 8 digits", async () => {
    render(<Harness initial="300" />);
    await settle();
    expect(validateCalls.some((c) => c.enabled)).toBe(false);
  });
});
