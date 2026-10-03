/**
 * GstinSearch: fills only empty fields, the diff / confirm panel, status badge,
 * warnings, the unavailable and not-configured paths, debounce and stale answers.
 * trpc is mocked; the lookup answer is controlled per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { GstinFormValues } from "@fintranzact/shared";

type Answer = Record<string, unknown>;
const calls: string[] = [];
let handler: (gstin: string) => Promise<Answer>;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    party: {
      lookupGstin: {
        useMutation: () => ({
          mutate: (input: { gstin: string }, cbs: { onSuccess?: (d: Answer) => void; onError?: (e: unknown) => void }) => {
            calls.push(input.gstin);
            handler(input.gstin).then(
              (d) => cbs.onSuccess?.(d),
              (e) => cbs.onError?.(e),
            );
          },
        }),
      },
    },
  },
}));

import { GstinSearch, GSTIN_AUTO_SEARCH_DELAY_MS, type ShippingEntry } from "../GstinSearch";

const G1 = "29AFSPB9500E1ZY";
const G2 = "27AAPFU0939F1ZV";

const details = (over: Record<string, unknown> = {}) => ({
  gstin: G1, legalName: "SHREE PACKAGING BHANDARI", tradeName: "SHREE PACKAGING", billingAddress: "3rd Floor, No 12, Prestige Tower, MG Road",
  city: "Bengaluru", state: "Karnataka", stateCode: "29", pincode: "560001", pan: "AFSPB9500E", constitution: "partnership",
  gstRegistrationType: "regular", gstinStatus: "active", blocked: false, registeredOn: "2017-07-01", cancelledOn: null, ...over,
});
const addr = (over: Record<string, unknown> = {}) => ({ line1: "7, Annex", line2: "", city: "Chennai", district: "Chennai", state: "Tamil Nadu", stateCode: "33", pincode: "600001", ...over });
const found = (over: Record<string, unknown> = {}, profile: Record<string, unknown> = {}, warnings: string[] = []): Answer => ({
  available: true, valid: true, source: "sandbox", sandboxStatus: "ok", warnings, checkedAt: "2026-10-03T00:00:00.000Z",
  verifiedAt: "2026-10-03T00:00:00.000Z",
  details: details(over),
  profile: { gstin: G1, status: "active", statusRaw: "Active", taxpayerType: "Regular", eInvoiceEnabled: true, additionalAddresses: [], ...profile },
});
const empty: GstinFormValues = { name: "", legalName: "", tradeName: "", billingAddress: "", city: "", state: "", stateCode: "", pincode: "", gstType: "", constitution: "" };

const fills: Array<Partial<GstinFormValues>> = [];
const metas: unknown[] = [];
const shipping: ShippingEntry[] = [];

function Harness({ initialValues = empty, initialGstin = "", auto, startGstin = "" }: { initialValues?: GstinFormValues; initialGstin?: string; auto?: Partial<GstinFormValues>; startGstin?: string }) {
  const [gstin, setGstin] = useState(startGstin);
  const [values, setValues] = useState(initialValues);
  const [blur, setBlur] = useState(0);
  return (
    <GstinSearch
      gstin={gstin}
      values={values}
      auto={auto}
      blurSignal={blur}
      initialGstin={initialGstin}
      onFill={(p) => { fills.push(p); setValues((v) => ({ ...v, ...p })); }}
      onMeta={(m) => metas.push(m)}
      onUseAsShipping={(e) => shipping.push(e)}
      input={<input aria-label="GSTIN" value={gstin} onChange={(e) => setGstin(e.target.value)} onBlur={() => setBlur((n) => n + 1)} />}
    />
  );
}

const type = (v: string) => fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: v } });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0; fills.length = 0; metas.length = 0; shipping.length = 0;
  handler = async () => found();
});
afterEach(() => vi.useRealTimers());

describe("GstinSearch: filling", () => {
  it("fills every empty field, shows the Active badge and the facts", async () => {
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      name: "SHREE PACKAGING", legalName: "SHREE PACKAGING BHANDARI", tradeName: "SHREE PACKAGING", city: "Bengaluru",
      state: "Karnataka", stateCode: "29", pincode: "560001", gstType: "regular", constitution: "partnership",
      billingAddress: "3rd Floor, No 12, Prestige Tower, MG Road",
    });
    expect(metas).toEqual([{ gstinStatus: "active", verifiedAt: "2026-10-03T00:00:00.000Z" }]);
    expect(screen.queryByTestId("gstin-diff")).not.toBeInTheDocument();
    const badge = screen.getByTestId("gstin-status-badge");
    expect(badge).toHaveTextContent("Active");
    expect(badge).toHaveAttribute("data-status", "active");
    const card = screen.getByTestId("gstin-card");
    expect(within(card).getByText(/Registered:/).parentElement).toHaveTextContent(/1 Jul 2017/);
    expect(within(card).getByText(/E-invoicing:/).parentElement).toHaveTextContent("Enabled");
    expect(screen.getByRole("status")).toHaveTextContent(/GST record found: SHREE PACKAGING BHANDARI/);
  });

  it("never overwrites typed values: differing fields go to the diff panel, empty ones are filled", async () => {
    const typed = { ...empty, name: "Shree", legalName: "Shree Pkg", city: "Mysuru", state: "Karnataka", stateCode: "29", gstType: "composition" as const };
    render(<Harness initialValues={typed} startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    // Only empty fields were filled straight away.
    expect(fills[0]).toEqual({
      tradeName: "SHREE PACKAGING", billingAddress: "3rd Floor, No 12, Prestige Tower, MG Road", pincode: "560001", constitution: "partnership",
    });
    const diff = screen.getByTestId("gstin-diff");
    expect(within(diff).getByText("Legal name")).toBeInTheDocument();
    expect(within(diff).getByText("Shree Pkg")).toBeInTheDocument();
    expect(within(diff).getByText("SHREE PACKAGING BHANDARI")).toBeInTheDocument();
    expect(within(diff).getByText("City")).toBeInTheDocument();
    expect(within(diff).getByText("GST type")).toBeInTheDocument();
    expect(within(diff).getByText("Composition scheme")).toBeInTheDocument();
    // The state matched, the name is never a conflict.
    expect(within(diff).queryByText("State")).not.toBeInTheDocument();
    expect(within(diff).queryByText("Party name")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/3 fields differ/);
  });

  it("applies only the ticked rows when 'Use these details' is pressed", async () => {
    const typed = { ...empty, name: "Shree", legalName: "Shree Pkg", city: "Mysuru" };
    render(<Harness initialValues={typed} startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    fills.length = 0;
    const diff = screen.getByTestId("gstin-diff");
    fireEvent.click(within(diff).getByRole("checkbox", { name: /City/ }));
    fireEvent.click(within(diff).getByRole("button", { name: "Use these details" }));
    expect(fills).toEqual([{ legalName: "SHREE PACKAGING BHANDARI" }]);
    expect(screen.queryByTestId("gstin-diff")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search GST" })).toHaveFocus();
  });

  it("'Keep mine' dismisses the panel and changes nothing", async () => {
    render(<Harness initialValues={{ ...empty, name: "Shree", legalName: "Mine" }} startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    fills.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(fills).toHaveLength(0);
    expect(screen.queryByTestId("gstin-diff")).not.toBeInTheDocument();
  });

  it("values the form derived itself (default GST type, PAN-based business type) count as empty", async () => {
    const derived = { ...empty, name: "Shree", gstType: "regular" as const, constitution: "proprietorship" as const };
    handler = async () => found({ gstRegistrationType: "composition", constitution: "partnership" });
    render(<Harness initialValues={derived} auto={{ gstType: "regular", constitution: "proprietorship" }} startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(fills[0]).toMatchObject({ gstType: "composition", constitution: "partnership" });
    expect(screen.queryByTestId("gstin-diff")).not.toBeInTheDocument();
  });
});

describe("GstinSearch: status and warnings", () => {
  it("shows a red Cancelled badge, the cancellation date and the warning", async () => {
    handler = async () => found(
      { gstinStatus: "cancelled", cancelledOn: "2023-12-31" },
      { status: "cancelled", statusRaw: "Cancelled" },
      ["This GSTIN is cancelled (since 31/12/2023). Input tax credit and e-invoicing are not available against it."],
    );
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    const badge = screen.getByTestId("gstin-status-badge");
    expect(badge).toHaveTextContent("Cancelled");
    expect(badge).toHaveAttribute("data-status", "cancelled");
    expect(badge.className).toMatch(/red/);
    expect(screen.getByTestId("gstin-warnings")).toHaveTextContent(/cancelled \(since 31\/12\/2023\)/);
    expect(within(screen.getByTestId("gstin-card")).getByText(/Cancelled:/).parentElement).toHaveTextContent(/31 Dec 2023/);
    expect(metas).toEqual([{ gstinStatus: "cancelled", verifiedAt: "2026-10-03T00:00:00.000Z" }]);
  });

  it("any other status is amber, and provisional is not shown as green", async () => {
    handler = async () => found({ gstinStatus: "suspended" }, { status: "suspended", statusRaw: "Suspended" });
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    const badge = screen.getByTestId("gstin-status-badge");
    expect(badge).toHaveTextContent("Suspended");
    expect(badge.className).toMatch(/amber/);
  });

  it("lists additional places of business and adds one as a shipping address", async () => {
    handler = async () => found({}, { additionalAddresses: [addr(), addr({ line1: "9 Depot", city: "Hosur", state: "Tamil Nadu", pincode: "635109" })] });
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(screen.getByText("Additional places of business (2)")).toBeInTheDocument();
    const btns = screen.getAllByRole("button", { name: /Use as shipping address/ });
    expect(btns).toHaveLength(2);
    fireEvent.click(btns[0]);
    expect(shipping).toEqual([{ label: "Place of business 1", address: "7, Annex", city: "Chennai", stateCode: "33", pincode: "600001" }]);
    expect(btns[0]).toBeDisabled();
    expect(btns[0]).toHaveTextContent("Added");
  });

  it("shows the first five of many addresses and a 'Show all' control", async () => {
    handler = async () => found({}, { additionalAddresses: Array.from({ length: 17 }, (_, i) => addr({ line1: `Depot ${i}` })) });
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(screen.getAllByRole("button", { name: /Use as shipping address/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 17" }));
    expect(screen.getAllByRole("button", { name: /Use as shipping address/ })).toHaveLength(17);
  });
});

describe("GstinSearch: failures", () => {
  it("says the portal could not be reached and that saving still works", async () => {
    handler = async () => ({ available: false, valid: true, source: "local", sandboxStatus: "unavailable", warnings: [], profile: null, reason: "x", derived: {} });
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Could not reach the GST portal; you can still save.");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(fills).toHaveLength(0);
  });

  it("a thrown request reads the same way", async () => {
    handler = async () => { throw new Error("network"); };
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Could not reach the GST portal; you can still save.");
    expect(screen.getByRole("button", { name: "Search GST" })).toBeEnabled();
  });

  it("not found and invalid are warnings, not blockers", async () => {
    handler = async () => ({ available: false, valid: false, source: "sandbox", sandboxStatus: "not_found", warnings: [], profile: null, reason: "r", derived: {} });
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(/No GST record was found for this GSTIN/);
  });

  it("not configured: a click explains calmly, the automatic search says nothing", async () => {
    handler = async () => ({ available: false, valid: true, source: "local", sandboxStatus: "not_configured", warnings: [], profile: null, reason: "Set up e-invoicing", derived: {} });
    render(<Harness />);
    type(G1);
    await flush(GSTIN_AUTO_SEARCH_DELAY_MS + 10);
    expect(calls).toEqual([G1]);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByText(/not set up/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(/GST search is not set up here/);
    expect(screen.getByRole("status").className).not.toMatch(/amber/);
  });

  it("the button is disabled until the GSTIN is valid and while searching", async () => {
    let release!: (a: Answer) => void;
    handler = () => new Promise((r) => { release = r; });
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Search GST" })).toBeDisabled();
    type(G1);
    expect(screen.getByRole("button", { name: "Search GST" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    expect(screen.getByRole("button", { name: /Searching/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Searching the GST portal…");
    await act(async () => { release(found()); });
    expect(screen.getByRole("button", { name: "Search GST" })).toBeEnabled();
  });
});

describe("GstinSearch: automatic search, debounce and stale answers", () => {
  it("searches once, after the pause, when a valid GSTIN is entered; typing on restarts the pause", async () => {
    render(<Harness />);
    type("29AFSPB9500E1Z");
    await flush(GSTIN_AUTO_SEARCH_DELAY_MS + 10);
    expect(calls).toHaveLength(0);
    type(G1);
    await flush(GSTIN_AUTO_SEARCH_DELAY_MS - 100);
    expect(calls).toHaveLength(0);
    type(G2);
    await flush(GSTIN_AUTO_SEARCH_DELAY_MS - 100);
    expect(calls).toHaveLength(0);
    await flush(200);
    expect(calls).toEqual([G2]);
    // The same GSTIN is not searched again by itself.
    await flush(5000);
    expect(calls).toEqual([G2]);
  });

  it("searches at once when the field loses focus", async () => {
    render(<Harness startGstin={G1} />);
    // The pause is already running for the pre-filled GSTIN; blur does not wait for it.
    fireEvent.blur(screen.getByLabelText("GSTIN"));
    await flush(0);
    expect(calls).toEqual([G1]);
    await flush(GSTIN_AUTO_SEARCH_DELAY_MS + 10);
    expect(calls).toEqual([G1]);
  });

  it("does not search the GSTIN already saved on the party when the form opens", async () => {
    render(<Harness startGstin={G1} initialGstin={G1} />);
    fireEvent.blur(screen.getByLabelText("GSTIN"));
    await flush(GSTIN_AUTO_SEARCH_DELAY_MS + 10);
    expect(calls).toHaveLength(0);
    // ...but the button still searches on request.
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(calls).toEqual([G1]);
  });

  it("ignores an answer for an earlier GSTIN that arrives after the field changed", async () => {
    const pending: Record<string, (a: Answer) => void> = {};
    handler = (g) => new Promise((r) => { pending[g] = r; });
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    type(G2);
    await act(async () => { pending[G1](found()); });
    expect(fills).toHaveLength(0);
    expect(metas).toHaveLength(0);
    expect(screen.queryByTestId("gstin-card")).not.toBeInTheDocument();
    // The answer for the current GSTIN is used.
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await act(async () => { pending[G2](found({ gstin: G2, legalName: "UDAY TRADERS" })); });
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ legalName: "UDAY TRADERS" });
  });

  it("clears the card when the GSTIN is edited", async () => {
    render(<Harness startGstin={G1} />);
    fireEvent.click(screen.getByRole("button", { name: "Search GST" }));
    await flush();
    expect(screen.getByTestId("gstin-card")).toBeInTheDocument();
    type(G1.slice(0, 14));
    expect(screen.queryByTestId("gstin-card")).not.toBeInTheDocument();
  });
});
