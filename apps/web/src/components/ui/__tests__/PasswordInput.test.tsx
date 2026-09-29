import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordInput } from "../PasswordInput";
import { InputField } from "../FormField";

describe("PasswordInput — show/hide eye button", () => {
  it("hides the password by default and reveals it with the eye button", async () => {
    render(<PasswordInput aria-label="Password" defaultValue="secret123" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("InputField type=password gets the eye button automatically", () => {
    render(<InputField label="Client secret" type="password" defaultValue="x" />);
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
  });
});
