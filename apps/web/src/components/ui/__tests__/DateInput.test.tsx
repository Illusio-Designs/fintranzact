import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { DateInput, formatDisplayDate, parseTypedDate } from "../DateInput";

describe("DateInput — custom calendar drop-in for <input type=date>", () => {
  it("formats ISO dates for display", () => {
    expect(formatDisplayDate("2026-09-29")).toBe("29 Sep 2026");
    expect(formatDisplayDate("")).toBe("");
  });

  it("shows the placeholder when empty and the formatted date when set", () => {
    const { rerender } = render(<DateInput aria-label="Invoice date" value="" placeholder="Pick a date" />);
    expect(screen.getByRole("button", { name: "Invoice date" })).toHaveTextContent("Pick a date");
    rerender(<DateInput aria-label="Invoice date" value="2024-04-01" />);
    expect(screen.getByRole("button", { name: "Invoice date" })).toHaveTextContent("1 Apr 2024");
  });

  it("picks a day from the calendar and emits an ISO value", async () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Invoice date" value="2024-04-01" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Invoice date" }));
    await userEvent.click(screen.getByRole("gridcell", { name: "20 Apr 2024" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "2024-04-20" }) }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables days outside min/max", async () => {
    render(<DateInput aria-label="Due date" value="2024-04-10" min="2024-04-05" max="2024-04-20" />);
    await userEvent.click(screen.getByRole("button", { name: "Due date" }));
    expect(screen.getByRole("gridcell", { name: "4 Apr 2024" })).toBeDisabled();
    expect(screen.getByRole("gridcell", { name: "21 Apr 2024" })).toBeDisabled();
    expect(screen.getByRole("gridcell", { name: "12 Apr 2024" })).toBeEnabled();
  });

  it("moves with arrow keys and picks with Enter", async () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Date" value="2024-04-10" onChange={onChange} />);
    screen.getByRole("button", { name: "Date" }).focus();
    await userEvent.keyboard("{Enter}{ArrowRight}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "2024-04-18" }) }));
  });

  it("clears with the Clear button when not required", async () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Due date" value="2024-04-10" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Due date" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "" }) }));
  });

  it("reads typed dates day first (DDMMYY and with separators)", () => {
    expect(parseTypedDate("120325")).toBe("2025-03-12");
    expect(parseTypedDate("12032025")).toBe("2025-03-12");
    expect(parseTypedDate("12/3/25")).toBe("2025-03-12");
    expect(parseTypedDate("1-4-2024")).toBe("2024-04-01");
    expect(parseTypedDate("0105", 2026)).toBe("2026-05-01");
    expect(parseTypedDate("15.8", 2026)).toBe("2026-08-15");
    expect(parseTypedDate("310225")).toBeNull(); // no 31 Feb
    expect(parseTypedDate("12/13/25")).toBeNull(); // month 13
    expect(parseTypedDate("abc")).toBeNull();
  });

  it("picks a typed DDMMYY date with Enter", async () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Date" value="2026-10-01" onChange={onChange} />);
    screen.getByRole("button", { name: "Date" }).focus();
    await userEvent.keyboard("120325{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "2025-03-12" }) }));
  });

  it("does not pick a typed date outside min/max", async () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Date" value="2026-10-01" min="2026-01-01" onChange={onChange} />);
    screen.getByRole("button", { name: "Date" }).focus();
    await userEvent.keyboard("120325{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("That date is outside the allowed range")).toBeInTheDocument();
  });

  it("jumps by year and month through the title", async () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Date" value="2026-10-01" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: /choose month and year/ }));
    await userEvent.click(screen.getByRole("button", { name: /choose year/ }));
    await userEvent.click(screen.getByRole("button", { name: "2024" }));
    await userEvent.click(screen.getByRole("button", { name: "April 2024" }));
    await userEvent.click(screen.getByRole("gridcell", { name: "1 Apr 2024" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: "2024-04-01" }) }));
  });

  it("moves a year with the year buttons and Shift+PageUp", async () => {
    render(<DateInput aria-label="Date" value="2026-10-01" />);
    await userEvent.click(screen.getByRole("button", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous year" }));
    expect(screen.getByRole("gridcell", { name: "1 Oct 2025" })).toBeInTheDocument();
    screen.getByRole("button", { name: "Date" }).focus();
    await userEvent.keyboard("{Shift>}{PageUp}{/Shift}");
    expect(screen.getByRole("gridcell", { name: "1 Oct 2025" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<DateInput aria-label="Invoice date" value="2024-04-01" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
