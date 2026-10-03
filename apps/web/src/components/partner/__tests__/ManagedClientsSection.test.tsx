import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ManagedClientsSection } from "../ManagedClientsSection";

const client = (over: object = {}) => ({
  tenantId: "t1", name: "Sharma Traders", roleLabel: "Accountant (read-only)",
  since: "2026-03-01T00:00:00.000Z", lastOpenedAt: null as string | null, planName: "Pro", ...over,
});

describe("ManagedClientsSection", () => {
  it("lists organisation, access, since, last opened and plan", () => {
    render(<ManagedClientsSection clients={[client(), client({ tenantId: "t2", name: "Gupta & Sons", roleLabel: "Accountant (filing)", lastOpenedAt: new Date().toISOString(), planName: "Free" })]} />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    const first = within(rows[1]!);
    expect(first.getByText("Sharma Traders")).toBeInTheDocument();
    expect(first.getByText("Accountant (read-only)")).toBeInTheDocument();
    expect(first.getByText("Never")).toBeInTheDocument();
    expect(first.getByText("Pro")).toBeInTheDocument();
    expect(within(rows[2]!).queryByText("Never")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Last opened" })).toBeInTheDocument();
  });

  it("explains how clients arrive when there are none", () => {
    render(<ManagedClientsSection clients={[]} />);
    expect(screen.getByTestId("managed-clients-empty")).toHaveTextContent(/invites you as its CA/);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when only the latest are shown", () => {
    render(<ManagedClientsSection clients={[client()]} more />);
    expect(screen.getByText(/Showing your latest 1 clients/)).toBeInTheDocument();
  });
});
