/**
 * ReturnStatusPanel — Filed / Not filed as words, date, ARN, valid flag, mode,
 * unavailable and composition states, refresh, financial-year choice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const filed = (arn: string, filedOn: string, valid: boolean | null = true) => ({ arn, filedOn, mode: "GSP", valid, status: "Filed", rawType: "GSTR1" });
const month = (period: string, label: string, over: Record<string, unknown> = {}) => ({ period, label, gstr1: null, gstr3b: null, others: [], ...over });

let result: { data?: unknown; isLoading?: boolean; isFetching?: boolean; error?: { message: string } | null } = {};
const refetch = vi.fn();
const useQuery = vi.fn((_input: unknown, _opts?: unknown) => ({ refetch, isLoading: false, isFetching: false, error: null, ...result }));
let can = true;

vi.mock("@/lib/trpc", () => ({ trpc: { gstReturns: { filingStatus: { useQuery: (i: unknown, o: unknown) => useQuery(i, o) } } } }));
vi.mock("@/lib/permissions", () => ({ useCan: () => can }));

import { ReturnStatusPanel, currentFyStart } from "../ReturnStatusPanel";

const okData = {
  status: "ok", reason: null, financialYear: "FY 2026-27", composition: false, cached: true, fetchedAt: Date.UTC(2026, 8, 5, 6, 30),
  months: [
    month("042026", "Apr 2026", { gstr1: filed("AA1", "2026-05-11"), gstr3b: filed("AA2", "2026-05-20", false) }),
    month("052026", "May 2026", { gstr3b: filed("AA3", "2026-06-20"), others: [{ rawType: "GSTR9", arn: null, filedOn: null, mode: null, valid: null, status: "Filed" }] }),
    month("062026", "Jun 2026"),
  ],
};

describe("ReturnStatusPanel", () => {
  beforeEach(() => {
    can = true;
    refetch.mockClear();
    useQuery.mockClear();
    result = { data: okData };
  });

  it("is labelled as coming from the GST portal via Sandbox", () => {
    render(<ReturnStatusPanel />);
    expect(screen.getByText(/From the GST portal via Sandbox/)).toBeInTheDocument();
    expect(screen.getByText(/saved copy, use Refresh for the latest/)).toBeInTheDocument();
  });

  it("shows Filed and Not filed in words with date, ARN, mode and the valid flag", () => {
    render(<ReturnStatusPanel />);
    const apr = screen.getByTestId("status-row-042026");
    expect(within(apr).getAllByText(/^Filed/).length).toBe(2);
    expect(within(apr).getByText(/11 May 2026 · GSP · Valid/)).toBeInTheDocument();
    expect(within(apr).getByText(/20 May 2026 · GSP · Not valid/)).toBeInTheDocument();
    expect(within(apr).getByText("ARN AA1")).toBeInTheDocument();
    const may = screen.getByTestId("status-row-052026");
    expect(within(may).getByText(/^Not filed/)).toBeInTheDocument(); // GSTR-1
    expect(within(may).getByText("GSTR9")).toBeInTheDocument();
    const jun = screen.getByTestId("status-row-062026");
    expect(within(jun).getAllByText(/^Not filed/)).toHaveLength(2);
    // screen readers get the return and month with the status
    expect(within(apr).getByText("(GSTR-1 Apr 2026)", { exact: false })).toBeInTheDocument();
  });

  it("has a phone layout with one card per month", () => {
    render(<ReturnStatusPanel />);
    const card = screen.getByTestId("status-card-042026");
    expect(within(card).getByText("Apr 2026")).toBeInTheDocument();
    expect(within(card).getByText("ARN AA2")).toBeInTheDocument();
  });

  it("says plainly when the portal could not be checked", () => {
    result = { data: { status: "unavailable", reason: "Sandbox is not configured on this server.", months: [], composition: false, financialYear: "FY 2026-27" } };
    render(<ReturnStatusPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(/Could not check the GST portal: Sandbox is not configured/);
    expect(screen.queryByTestId("status-row-042026")).not.toBeInTheDocument();
  });

  it("notes composition dealers", () => {
    result = { data: { ...okData, composition: true } };
    render(<ReturnStatusPanel />);
    expect(screen.getByText(/Composition dealers file CMP-08 and GSTR-4/)).toBeInTheDocument();
  });

  it("shows a refresh error (for example too many refreshes) as an alert", () => {
    result = { data: undefined, error: { message: "Refreshing too often. Wait a minute and try again." } };
    render(<ReturnStatusPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("Refreshing too often");
  });

  it("Refresh asks for fresh data (first click switches to refresh, later clicks refetch)", async () => {
    render(<ReturnStatusPanel />);
    expect(useQuery).toHaveBeenLastCalledWith({ fyStartYear: currentFyStart(), refresh: false }, expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(useQuery).toHaveBeenLastCalledWith({ fyStartYear: currentFyStart(), refresh: true }, expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("choosing another financial year queries it without refresh", async () => {
    render(<ReturnStatusPanel />);
    const select = screen.getByRole("combobox", { name: "Return status financial year" });
    await userEvent.click(select);
    const prev = currentFyStart() - 1;
    await userEvent.click(await screen.findByRole("option", { name: `FY ${prev}-${String((prev + 1) % 100).padStart(2, "0")}` }));
    expect(useQuery).toHaveBeenLastCalledWith({ fyStartYear: currentFyStart() - 1, refresh: false }, expect.anything());
  });

  it("renders nothing for a role that cannot read GST returns", () => {
    can = false;
    const { container } = render(<ReturnStatusPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the financial year starts in April", () => {
    expect(currentFyStart(new Date(2026, 2, 31))).toBe(2025);
    expect(currentFyStart(new Date(2026, 3, 1))).toBe(2026);
  });
});
