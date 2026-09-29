import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Select } from "../Select";

function renderSelect(onChange = vi.fn(), value = "regular") {
  return render(
    <Select aria-label="GST registration" value={value} onChange={onChange}>
      <option value="regular">Regular</option>
      <option value="composition">Composition</option>
      <option value="unregistered" disabled>
        Not registered
      </option>
    </Select>,
  );
}

describe("Select — custom drop-in for <select>", () => {
  it("shows the selected option's label on the trigger", () => {
    renderSelect();
    expect(screen.getByRole("combobox", { name: "GST registration" })).toHaveTextContent("Regular");
  });

  it("opens a listbox on click and reports the chosen value like a change event", async () => {
    const onChange = vi.fn();
    renderSelect(onChange);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "Composition" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "composition" }) }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("supports keyboard selection and skips disabled options", async () => {
    const onChange = vi.fn();
    renderSelect(onChange);
    screen.getByRole("combobox").focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "composition" }) }));
  });

  it("closes on Escape without changing the value", async () => {
    const onChange = vi.fn();
    renderSelect(onChange);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = renderSelect();
    expect(await axe(container)).toHaveNoViolations();
  });
});
