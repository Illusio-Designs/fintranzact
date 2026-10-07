import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { defaultStatutoryRates, ratesGaps } from "@fintranzact/shared";

const h = vi.hoisted(() => ({
  saveFlags: vi.fn(),
  saveRates: vi.fn(),
  invalidate: vi.fn(),
  settings: { data: undefined as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollStatutory: { settings: { invalidate: h.invalidate } } }),
    payrollStatutory: {
      settings: { useQuery: () => ({ data: h.settings.data, isLoading: !h.settings.data }) },
      updateBusinessSettings: { useMutation: () => ({ mutate: h.saveFlags, isPending: false }) },
      saveRates: { useMutation: () => ({ mutate: h.saveRates, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: vi.fn() }));
vi.mock("../payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-ui")>();
  return { ...actual, currentMonth: () => "2026-10" };
});

import { StatutoryTab } from "../StatutoryTab";

const FLAGS = { pfRegistered: true, pfEstablishmentCode: "MHBAN0012345000", esiRegistered: true, esiCode: "31000123450001001", ptStates: ["27", "29"], lwfState: "27", tdsEnabled: true };

function settings(over: Record<string, unknown> = {}) {
  const rates = defaultStatutoryRates();
  const flags = (over.flags as typeof FLAGS | undefined) ?? FLAGS;
  return {
    financialYear: 2026, financialYearLabel: "2026-27", verifyLabel: "Verify with your CA", flags, hasTan: true, rates, ratesSource: "default", ratesSavedForFinancialYear: null,
    verifiedNote: null, verifiedOn: null, gaps: ratesGaps(rates, { ptStates: flags.ptStates, lwfState: flags.lwfState }), canEdit: true, ...over,
  };
}

describe("StatutoryTab", () => {
  beforeEach(() => {
    h.saveFlags.mockReset();
    h.saveRates.mockReset();
    h.settings.data = settings();
  });

  it("always carries the 'Verify with your CA' label", () => {
    render(<StatutoryTab />);
    expect(screen.getByTestId("verify-with-ca")).toHaveTextContent("Verify with your CA");
  });

  it("names what is not configured: PT slabs for a state, LWF amounts and the income-tax slabs", () => {
    render(<StatutoryTab />);
    const gaps = screen.getByRole("status", { name: "Not configured" });
    expect(gaps).toHaveTextContent("not configured for state 29");
    expect(gaps).toHaveTextContent("New-regime income-tax slabs are not configured");
    // The state editor says so too, and Maharashtra's seeded slabs are shown.
    expect(screen.getByText("Professional tax: Karnataka")).toBeInTheDocument();
    expect(screen.getAllByText(/Slabs not configured: add your state's slabs/).length).toBe(1);
    expect(screen.getByText(/Amounts not configured: add them below/)).toBeInTheDocument();
    expect(screen.getAllByText(/Income-tax slabs not configured: add them/).length).toBe(2);
    expect(screen.getByRole("table", { name: "Maharashtra professional tax slabs" })).toBeInTheDocument();
  });

  it("shows only the sections of schemes the business is registered for", () => {
    h.settings.data = settings({ flags: { ...FLAGS, pfRegistered: false, esiRegistered: false, tdsEnabled: false, ptStates: [], lwfState: null } });
    render(<StatutoryTab />);
    expect(screen.queryByText("Provident fund (PF, EPS)")).not.toBeInTheDocument();
    expect(screen.queryByText("ESI")).not.toBeInTheDocument();
    expect(screen.queryByText(/Professional tax:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Income tax on salary/)).not.toBeInTheDocument();
    expect(screen.queryByText("Due dates")).not.toBeInTheDocument();
    // The registrations themselves are always there to turn on.
    expect(screen.getByLabelText(/^Registered for provident fund/)).not.toBeChecked();
  });

  it("saves the registrations", () => {
    render(<StatutoryTab />);
    fireEvent.click(screen.getByLabelText(/^Registered for provident fund/));
    fireEvent.click(screen.getByRole("button", { name: "Save registrations" }));
    expect(h.saveFlags).toHaveBeenCalledWith(expect.objectContaining({ pfRegistered: false, esiRegistered: true, ptStates: ["27", "29"], lwfState: "27", tdsEnabled: true }));
  });

  it("edits a rate and a PT slab and saves the figures for the financial year with the verified note", () => {
    render(<StatutoryTab />);
    fireEvent.change(screen.getByLabelText(/Wage ceiling/), { target: { value: "22000" } });
    const karnataka = screen.getByRole("table", { name: "Karnataka professional tax slabs" });
    expect(within(karnataka).queryAllByRole("row")).toHaveLength(1); // header only
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add slab" })[1]!);
    expect(within(screen.getByRole("table", { name: "Karnataka professional tax slabs" })).getAllByRole("row")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Karnataka professional tax slabs row 1 above"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("Karnataka slab monthly 25000"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Last verified note"), { target: { value: "Checked with CA Shah" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for 2026-27" }));
    expect(h.saveRates).toHaveBeenCalledTimes(1);
    const sent = h.saveRates.mock.calls[0]![0];
    expect(sent).toMatchObject({ financialYear: 2026, verifiedNote: "Checked with CA Shah" });
    expect(sent.rates.esi.wageCeilingRupees).toBe(22000);
    expect(sent.rates.pt["29"].slabs).toEqual([{ fromRupees: 25000, toRupees: null, monthlyRupees: 200, februaryRupees: null, gender: "any" }]);
    expect(sent.rates.pt["27"].slabs).toHaveLength(5); // the seeded Maharashtra slabs are untouched
}, 30000);

  it("income-tax slabs can be added for a regime", () => {
    render(<StatutoryTab />);
    const regime = screen.getAllByRole("button", { name: "+ Add slab" });
    fireEvent.click(regime[regime.length - 2]!); // new regime
    fireEvent.change(screen.getByLabelText("New regime income-tax slabs row 1 above"), { target: { value: "400000" } });
    fireEvent.change(screen.getByLabelText("New regime slab rate 400000"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save for/ }));
    expect(h.saveRates.mock.calls[0]![0].rates.tds.newRegime.slabs).toEqual([{ fromRupees: 400000, toRupees: null, ratePercent: 5 }]);
  });

  it("a role that cannot edit sees the figures but no save buttons", () => {
    h.settings.data = settings({ canEdit: false });
    render(<StatutoryTab />);
    expect(screen.queryByRole("button", { name: "Save registrations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save for/ })).not.toBeInTheDocument();
    expect(screen.getByText("Only an owner or admin can change these.")).toBeInTheDocument();
    expect(screen.getByLabelText("PF wage ceiling (₹ a month)")).toBeDisabled();
  });

  it("says where saved figures come from", () => {
    h.settings.data = settings({ ratesSource: "saved", ratesSavedForFinancialYear: 2025, verifiedNote: "Checked", verifiedOn: "2025-04-02" });
    render(<StatutoryTab />);
    expect(screen.getByText(/carried forward/)).toBeInTheDocument();
  });
});
