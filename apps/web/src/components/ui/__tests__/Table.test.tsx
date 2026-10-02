/**
 * SortableTh and SortMenu — sorting a table by its column headers or by the
 * "Sort ▾" menu, which share one state.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortableTh, SortMenu, type SortState } from "../Table";

type K = "date" | "amount";

function header(sort: SortState<K>, onSort = vi.fn(), firstDir?: "asc" | "desc") {
  render(
    <table>
      <thead>
        <tr>
          <SortableTh sortKey="amount" sort={sort} onSort={onSort} firstDir={firstDir}>Amount</SortableTh>
        </tr>
      </thead>
    </table>,
  );
  return onSort;
}

describe("SortableTh", () => {
  it("tells screen readers how the column is sorted", () => {
    header({ key: "amount", dir: "desc" });
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
  });

  it("starts with the column's first direction when another column is sorted", async () => {
    const onSort = header({ key: "date", dir: "desc" }, vi.fn(), "desc");
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
    await userEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(onSort).toHaveBeenCalledWith({ key: "amount", dir: "desc" });
  });

  it("flips the direction when the sorted column is clicked again", async () => {
    const onSort = header({ key: "amount", dir: "desc" });
    await userEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(onSort).toHaveBeenCalledWith({ key: "amount", dir: "asc" });
  });
});

describe("SortMenu", () => {
  const options = [
    { key: "date" as const, dir: "desc" as const, label: "Newest first" },
    { key: "amount" as const, dir: "desc" as const, label: "Amount: high to low" },
  ];

  it("shows the current sort on the button and changes it from the menu", async () => {
    const onSort = vi.fn();
    render(<SortMenu options={options} sort={{ key: "date", dir: "desc" }} onSort={onSort} />);
    await userEvent.click(screen.getByRole("button", { name: "Sort by: Newest first" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Amount: high to low" }));
    expect(onSort).toHaveBeenCalledWith({ key: "amount", dir: "desc" });
  });

  it("agrees with a header sort the menu has no entry for", () => {
    render(<SortMenu options={options} sort={{ key: "amount", dir: "asc" }} onSort={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sort by: custom" })).toBeInTheDocument();
  });
});
