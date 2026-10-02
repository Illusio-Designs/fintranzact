/**
 * Menu and RowActions — the "Actions ▾" button on table rows and other
 * small dropdowns. Checks they open as a proper menu, can be driven by
 * keyboard, and never trigger the row's own click.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Menu, RowActions, tidyMenu } from "../Menu";

describe("Menu", () => {
  it("opens a menu, runs the chosen action and closes", async () => {
    const onEdit = vi.fn();
    render(<Menu items={[{ label: "Edit", onSelect: onEdit }, { label: "Copy", onSelect: vi.fn() }]}>More</Menu>);
    const button = screen.getByRole("button", { name: "More" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("moves with the arrow keys and closes on Escape, back on the button", async () => {
    render(<Menu items={[{ label: "One", onSelect: vi.fn() }, { label: "Two", onSelect: vi.fn() }]}>Open</Menu>);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menuitem", { name: "One" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Two" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "One" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("starts on the ticked choice in a pick-one menu", async () => {
    render(
      <Menu
        items={[
          { kind: "radio", label: "Newest first", checked: false, onSelect: vi.fn() },
          { kind: "radio", label: "Oldest first", checked: true, onSelect: vi.fn() },
        ]}
      >
        Sort
      </Menu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("menuitemradio", { name: "Oldest first" })).toHaveFocus();
    expect(screen.getByRole("menuitemradio", { name: "Oldest first" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("RowActions", () => {
  it("names the row it belongs to and does not open the row when clicked", async () => {
    const onRow = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={onRow}>
            <td>
              <RowActions label="INV-001" items={[{ label: "Open", onSelect: vi.fn() }]} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions for INV-001" }));
    expect(onRow).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("is hidden when a row has nothing to do", () => {
    const { container } = render(<RowActions label="INV-001" items={[{ kind: "label", label: "PDF" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("tidyMenu", () => {
  it("drops hidden entries and separators that would sit at an edge or double up", () => {
    const a = { label: "A", onSelect: vi.fn() };
    const out = tidyMenu([{ kind: "separator" }, a, false, { kind: "separator" }, { kind: "separator" }, null, { kind: "separator" }]);
    expect(out).toEqual([a]);
  });
});
