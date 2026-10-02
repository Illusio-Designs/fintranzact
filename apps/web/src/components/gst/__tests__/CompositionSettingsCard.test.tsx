/**
 * CompositionSettingsCard — effective value, default vs overridden, reset and save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutate = vi.fn();
const settings = {
  financialYear: "2026-27", category: "manufacturer_trader", rateOverride: null, configured: true, rate: "1",
  categories: [
    { code: "manufacturer_trader", label: "Manufacturer or trader (goods)", rate: "1", note: "Central 0.5% + State 0.5% of turnover" },
    { code: "restaurant", label: "Restaurant (not serving alcohol)", rate: "5", note: "Central 2.5% + State 2.5% of turnover" },
  ],
  effective: {
    rate: "1", cmp08DueDay: 18, gstr4DueDate: "2027-07-31", interestRatePercent: "18",
    lateFeePerDay: "50", lateFeeCap: "2000", lateFeeNilPerDay: "20", lateFeeNilCap: "500",
  },
  defaults: {
    rate: "1", cmp08DueDay: 18, gstr4DueDate: "2027-06-30", interestRatePercent: "18",
    lateFeePerDay: "50", lateFeeCap: "2000", lateFeeNilPerDay: "20", lateFeeNilCap: "500",
  },
  sources: {},
  meta: { sourceNotes: ["busy.in guide-to-gstr-4"], lastReviewed: "2026-10-02", verifyWithCA: true, effectiveFromFy: "2024-25" },
};
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ gst: new Proxy({}, { get: () => ({ invalidate: vi.fn() }) }) }),
    gst: {
      compositionSettings: { useQuery: () => ({ data: settings, isLoading: false }) },
      updateCompositionSettings: { useMutation: () => ({ mutate, isPending: false }) },
    },
  },
}));
vi.mock("@/lib/permissions", () => ({ useCan: () => true }));

import { CompositionSettingsCard } from "../CompositionSettingsCard";

describe("CompositionSettingsCard", () => {
  beforeEach(() => mutate.mockClear());

  it("shows each value's source, the default beside an override, last reviewed and the CA note", () => {
    render(<CompositionSettingsCard financialYear="2026-27" />);
    const due = screen.getByTestId("composition-field-gstr4DueDate");
    expect(within(due).getByText("Overridden")).toBeInTheDocument();
    expect(within(due).getByText("default 2027-06-30")).toBeInTheDocument();
    expect(within(screen.getByTestId("composition-field-lateFeeCap")).getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("2026-10-02")).toBeInTheDocument();
    expect(screen.getByText(/Confirm every value with your CA/)).toBeInTheDocument();
  });

  it("resets an overridden value to the default and saves it as no override", async () => {
    render(<CompositionSettingsCard financialYear="2026-27" />);
    await userEvent.click(within(screen.getByTestId("composition-field-gstr4DueDate")).getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("GSTR-4 due date")).toHaveValue("2027-06-30");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      financialYear: "2026-27", category: "manufacturer_trader", rate: null, gstr4DueDate: null, lateFeeCap: null, cmp08DueDay: null,
    }));
  });

  it("saves an edited value and blocks an invalid one", async () => {
    render(<CompositionSettingsCard financialYear="2026-27" />);
    const perDay = screen.getByLabelText("GSTR-4 late fee per day");
    await userEvent.clear(perDay);
    await userEvent.type(perDay, "100");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ lateFeePerDay: "100", gstr4DueDate: "2027-07-31" }));

    mutate.mockClear();
    const day = screen.getByLabelText("CMP-08 due day");
    await userEvent.clear(day);
    await userEvent.type(day, "40");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
