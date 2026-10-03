import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CycleToggle } from "../CycleToggle";

describe("CycleToggle", () => {
  it("marks the chosen period and labels yearly with the saving", () => {
    render(<CycleToggle value="monthly" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    const yearly = screen.getByRole("button", { name: /Yearly/ });
    expect(yearly).toHaveAttribute("aria-pressed", "false");
    expect(yearly).toHaveTextContent("2 months free");
  });

  it("reports the period picked", async () => {
    const onChange = vi.fn();
    render(<CycleToggle value="monthly" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Yearly/ }));
    expect(onChange).toHaveBeenCalledWith("yearly");
  });
});
