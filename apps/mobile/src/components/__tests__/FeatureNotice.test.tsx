import React from "react";
import { render, screen } from "@testing-library/react-native";

const mockStatus: { current: unknown } = { current: undefined };
jest.mock("../../lib/trpc", () => ({
  trpc: { billing: { status: { useQuery: () => ({ data: mockStatus.current }) } } },
}));

import { FeatureNotice } from "../FeatureNotice";
import { ThemeProvider } from "../../contexts/ThemeContext";

const starter = {
  canManageBilling: true,
  topPlanName: "Business",
  features: { recurringInvoices: false, pos: true },
  featureRequiredPlans: { recurringInvoices: "Starter", pos: "Starter" },
};

function renderNotice(flag: "recurringInvoices" | "pos") {
  return render(
    <ThemeProvider>
      <FeatureNotice flag={flag} />
    </ThemeProvider>,
  );
}

describe("FeatureNotice (mobile)", () => {
  it("renders nothing while the status loads and when the plan has the feature", () => {
    mockStatus.current = undefined;
    renderNotice("recurringInvoices");
    expect(screen.queryByTestId("feature-notice")).toBeNull();
    mockStatus.current = starter;
    renderNotice("pos");
    expect(screen.queryByTestId("feature-notice")).toBeNull();
  });

  it("says which feature, which plan, and offers See plans as text", () => {
    mockStatus.current = starter;
    renderNotice("recurringInvoices");
    expect(screen.getByTestId("feature-notice")).toBeTruthy();
    expect(screen.getByText("Recurring invoices: not on your plan")).toBeTruthy();
    expect(screen.getByText(/Recurring invoices are available on the Starter plan and above\./)).toBeTruthy();
    expect(screen.getByLabelText("See plans")).toBeTruthy();
  });
});
