/**
 * ListFilters — the "+ Filter" button and the chips for filters in use.
 */
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const parties = [
  { id: "p1", name: "Laxmi Jewellers" },
  { id: "p2", name: "Gupta Hardware" },
];
vi.mock("@/lib/trpc", () => ({
  trpc: { party: { list: { useQuery: () => ({ data: { data: parties }, isFetching: false }) } } },
}));

import { FilterButton, FilterChips, filterParams, type DocFilters } from "../ListFilters";

function Harness({ start = {} }: { start?: DocFilters }) {
  const [f, setF] = useState<DocFilters>(start);
  return (
    <>
      <FilterButton value={f} onChange={setF} />
      <FilterChips value={f} onChange={setF} />
      <output data-testid="params">{JSON.stringify(filterParams(f))}</output>
    </>
  );
}
const params = () => JSON.parse(screen.getByTestId("params").textContent || "{}");

describe("ListFilters", () => {
  it("filters by several parties and shows one chip for them", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(screen.getByRole("button", { name: /^Party/ }));
    await userEvent.click(screen.getByLabelText("Laxmi Jewellers"));
    await userEvent.click(screen.getByLabelText("Gupta Hardware"));
    expect(params().partyIds).toEqual(["p1", "p2"]);
    expect(screen.getByLabelText("Filters in use")).toHaveTextContent("Party:Laxmi Jewellers +1");
    expect(screen.getByRole("button", { name: "Filter 1" })).toBeInTheDocument();
  });

  it("keeps an amount range the right way round", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(screen.getByRole("button", { name: /^Amount/ }));
    await userEvent.type(screen.getByLabelText("From ₹"), "20000");
    await userEvent.type(screen.getByLabelText("To ₹"), "5000");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(params()).toMatchObject({ minAmount: 5000, maxAmount: 20000 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes one filter with its ×, and all with Clear filters", async () => {
    render(<Harness start={{ due: "next7", parties: [parties[0]], minAmount: 100 }} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove due date filter" }));
    expect(params().due).toBeUndefined();
    expect(params().partyIds).toEqual(["p1"]);
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(params()).toEqual({});
    expect(screen.queryByLabelText("Filters in use")).not.toBeInTheDocument();
  });

  it("steps back with Esc, then closes and returns to the button", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(screen.getByRole("button", { name: /^Source/ }));
    expect(screen.getByRole("dialog", { name: "Filter by source" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add a filter" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toHaveFocus();
  });
});
