/**
 * Escape inside a panel: an open dropdown closes on its own, the panel it
 * sits in stays open. (The J4 sales journey closed a batch picker on a new
 * invoice with Escape and got "Discard unsaved changes?" for the whole
 * invoice.) With the dropdown closed, Escape closes the panel as before.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlideOver } from "../SlideOver";
import { Listbox } from "../Listbox";
import { Combobox } from "../Combobox";

const OPTIONS = [
  { value: "late", label: "LATE" },
  { value: "soon", label: "SOON" },
];

describe("Escape in a dropdown inside a SlideOver", () => {
  it("Listbox: closes the list, not the panel; a second Escape closes the panel", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver open onClose={onClose} title="New Invoice">
        <Listbox label="Batch" value="" onChange={() => {}} options={OPTIONS} />
      </SlideOver>,
    );
    await user.click(screen.getByRole("combobox", { name: "Batch" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Combobox: closes the list, not the panel; a second Escape closes the panel", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver open onClose={onClose} title="New Invoice">
        <Combobox label="Customer" value="" onChange={() => {}} options={OPTIONS} />
      </SlideOver>,
    );
    await user.click(screen.getByRole("combobox", { name: "Customer" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
