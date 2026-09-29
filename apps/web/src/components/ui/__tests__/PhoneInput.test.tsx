import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { PhoneInput, parsePhone } from "../PhoneInput";

function Controlled({ initial = "", onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <PhoneInput
      label="Phone"
      value={v}
      onChange={(next) => {
        setV(next);
        onValue?.(next);
      }}
    />
  );
}

describe("parsePhone", () => {
  it("reads country and digits from a stored +<dial> value", () => {
    expect(parsePhone("+919876543210")).toMatchObject({ digits: "9876543210", country: { code: "IN" } });
    expect(parsePhone("+971501234567")).toMatchObject({ digits: "501234567", country: { code: "AE" } });
  });
  it("treats older values without a plus as Indian numbers", () => {
    expect(parsePhone("98765 43210")).toMatchObject({ digits: "9876543210", country: { code: "IN" } });
  });
});

describe("PhoneInput — country dropdown + number", () => {
  it("defaults to India and stores +91 with the digits", async () => {
    const onValue = vi.fn();
    render(<Controlled onValue={onValue} />);
    expect(screen.getByRole("button", { name: /Country code: India \+91/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Phone"), "98765a43210");
    expect(onValue).toHaveBeenLastCalledWith("+919876543210");
  });

  it("limits Indian numbers to 10 digits and hints when too short", async () => {
    render(<Controlled />);
    await userEvent.type(screen.getByLabelText("Phone"), "98765");
    expect(screen.getByText("Enter a 10-digit number for India")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Phone"), "432109999");
    expect(screen.getByLabelText("Phone")).toHaveValue("9876543210");
  });

  it("switches country from the searchable list and keeps the number", async () => {
    const onValue = vi.fn();
    render(<Controlled initial="+91501234567" onValue={onValue} />);
    await userEvent.click(screen.getByRole("button", { name: /Country code/ }));
    await userEvent.type(screen.getByLabelText("Search countries"), "emir");
    await userEvent.click(screen.getByRole("option", { name: /United Arab Emirates/ }));
    expect(onValue).toHaveBeenLastCalledWith("+971501234567");
    expect(screen.getByRole("button", { name: /Country code: United Arab Emirates \+971/ })).toBeInTheDocument();
  });

  it("stores an empty string when the number is cleared", async () => {
    const onValue = vi.fn();
    render(<Controlled initial="+919876543210" onValue={onValue} />);
    await userEvent.clear(screen.getByLabelText("Phone"));
    expect(onValue).toHaveBeenLastCalledWith("");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Controlled initial="+919876543210" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
