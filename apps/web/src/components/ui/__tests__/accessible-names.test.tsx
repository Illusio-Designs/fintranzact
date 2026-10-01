/**
 * Names the J7 inventory journey finds controls by: a confirmation dialog by
 * its question, the current pill of a PillTabs bar, and each row's picker in
 * a list of stock lines.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfirmDialog } from "../ConfirmDialog";
import { PillTabs } from "../Tabs";
import { Combobox } from "../Combobox";

describe("ConfirmDialog accessible name", () => {
  it("is named by its question and described by its description (it used to be an unnamed dialog)", () => {
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Post this count?"
        description="1 item will be set to what was scanned."
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Post this count?" });
    expect(dialog).toHaveAccessibleDescription("1 item will be set to what was scanned.");
  });
});

describe("PillTabs current tab", () => {
  it("marks the selected pill as pressed", () => {
    const tabs = [
      { value: "remove", label: "Remove stock" },
      { value: "add", label: "Add stock" },
    ];
    render(<PillTabs tabs={tabs} value="add" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add stock" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove stock" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Combobox ariaLabel", () => {
  const options = [{ value: "a", label: "Paracetamol" }];

  it("names a picker without a visible label (a row in a list of lines)", () => {
    render(<Combobox value="" onChange={vi.fn()} options={options} ariaLabel="Item, line 2" />);
    expect(screen.getByRole("combobox", { name: "Item, line 2" })).toBeInTheDocument();
  });

  it("takes precedence over the visible label, so each row's picker has its own name", () => {
    render(<Combobox value="" onChange={vi.fn()} options={options} label="Item" ariaLabel="Item, line 1" />);
    expect(screen.getByRole("combobox", { name: "Item, line 1" })).toBeInTheDocument();
  });
});
