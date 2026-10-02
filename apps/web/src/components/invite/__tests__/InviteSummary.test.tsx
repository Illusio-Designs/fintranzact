import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InviteSummary } from "../InviteSummary";

describe("InviteSummary", () => {
  it("shows the inviter, organisation and access for a CA invite", () => {
    render(<InviteSummary info={{
      tenantName: "Sharma Traders", role: "ca_filing", roleLabel: "Accountant (filing)", invitedByName: "Rohit Sharma",
      accessDescription: "Can view everything, prepare and file GST returns, and download reports.",
    }} />);
    const box = screen.getByTestId("invite-summary");
    expect(box).toHaveTextContent("Rohit Sharma invited you to Sharma Traders as their accountant.");
    expect(box).toHaveTextContent("Registered as accountant");
    expect(box).toHaveTextContent("Accountant (filing)");
    expect(box).toHaveTextContent("prepare and file GST returns");
    expect(box).toHaveTextContent("can remove your access at any time");
  });

  it("keeps a normal invite plain", () => {
    render(<InviteSummary info={{ tenantName: "Sharma Traders", role: "seller", roleLabel: "Seller", invitedByName: null, accessDescription: null }} />);
    const box = screen.getByTestId("invite-summary");
    expect(box).toHaveTextContent("Someone invited you to Sharma Traders as Seller.");
    expect(box).not.toHaveTextContent("Registered as accountant");
  });
});
