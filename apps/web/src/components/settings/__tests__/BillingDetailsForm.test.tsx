import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: { billing: { updateBillingDetails: { useMutation: () => ({ mutate, isPending: false }) } } },
}));
vi.mock("@/hooks/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BillingDetailsForm, effectiveBillingState } from "../BillingDetailsForm";

const initial = { name: "Mehta Traders", gstin: null, address: null, email: null, state: null };

beforeEach(() => mutate.mockClear());

describe("effectiveBillingState", () => {
  it("takes the state from a valid GSTIN and locks it", () => {
    expect(effectiveBillingState("24AAKFS4821M1Z3", null)).toEqual({ code: "24", locked: true, mismatch: false });
  });
  it("flags a saved state that differs from the GSTIN's", () => {
    expect(effectiveBillingState("29AABCT1332L1ZZ", "24")).toEqual({ code: "29", locked: true, mismatch: true });
  });
  it("uses the chosen state without a GSTIN, and treats a partial GSTIN as none", () => {
    expect(effectiveBillingState("", "27")).toEqual({ code: "27", locked: false, mismatch: false });
    expect(effectiveBillingState("24AAKF", "27")).toEqual({ code: "27", locked: false, mismatch: false });
    expect(effectiveBillingState("", null)).toEqual({ code: "", locked: false, mismatch: false });
  });
});

describe("BillingDetailsForm — State / UT (for GST)", () => {
  it("has a labelled, searchable State / UT field with the help text", () => {
    render(<BillingDetailsForm initial={initial} onSaved={() => {}} />);
    expect(screen.getByRole("combobox", { name: /State \/ UT \(for GST\)/ })).toBeTruthy();
    expect(screen.getByText(/Needed to charge CGST \+ SGST \(Gujarat\) or IGST \(other states\)/)).toBeTruthy();
  });

  it("saves the chosen state code", async () => {
    render(<BillingDetailsForm initial={initial} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("combobox", { name: /State \/ UT \(for GST\)/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Gujarat \(24\)/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(mutate).toHaveBeenCalledWith({ name: "Mehta Traders", gstin: null, address: null, email: null, state: "24" });
  });

  it("fills the state from a GSTIN, locks it and says so", async () => {
    render(<BillingDetailsForm initial={initial} onSaved={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText("22AAAAA0000A1Z5"), "29AABCT1332L1ZZ");
    const field = screen.getByLabelText("State / UT (for GST)") as HTMLInputElement;
    expect(field.value).toBe("Karnataka (29)");
    expect(field.readOnly).toBe(true);
    expect(screen.getByText(/From your GSTIN/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ gstin: "29AABCT1332L1ZZ", state: "29" }));
  });

  it("shows a gentle note when a saved state differs from the GSTIN's", () => {
    render(<BillingDetailsForm initial={{ ...initial, gstin: "29AABCT1332L1ZZ", state: "24" }} onSaved={() => {}} />);
    expect(screen.getByRole("status").textContent).toMatch(/differs from your GSTIN's state.*Karnataka/);
  });

  it("keeps the saved state when other details change", async () => {
    render(<BillingDetailsForm initial={{ ...initial, state: "24" }} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Address/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ state: "24", address: "x" }));
  });
});
