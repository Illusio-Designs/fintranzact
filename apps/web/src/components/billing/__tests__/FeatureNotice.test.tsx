import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, renderHook } from "@testing-library/react";

const { statusData } = vi.hoisted(() => ({ statusData: { current: undefined as any } }));

vi.mock("@/lib/trpc", () => ({
  trpc: { billing: { status: { useQuery: () => ({ data: statusData.current, isLoading: false }) } } },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, search, ...rest }: any) => <a href={search?.tab ? `${to}?tab=${search.tab}` : to} {...rest}>{children}</a>,
}));

import { FeatureNotice } from "../FeatureNotice";
import { PlanBadge } from "../PlanBadge";
import { useFeature } from "@/hooks/useFeature";

const starter = {
  state: "active", readOnly: false, reason: null, canManageBilling: true, plan: "starter", topPlanName: "Business",
  features: { eInvoicing: false, multiWarehouse: false, manufacturing: false, pos: true },
  featureRequiredPlans: { eInvoicing: "Growth", multiWarehouse: "Growth", manufacturing: "Business", pos: "Starter" },
};

describe("FeatureNotice", () => {
  beforeEach(() => {
    statusData.current = undefined;
  });

  it("renders nothing while the status loads or when the plan has the feature", () => {
    const { container, rerender } = render(<FeatureNotice flag="eInvoicing" />);
    expect(container).toBeEmptyDOMElement();
    statusData.current = starter;
    rerender(<FeatureNotice flag="pos" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the feature and the plan, says existing data stays, and sends an owner to Billing", () => {
    statusData.current = starter;
    render(<FeatureNotice flag="eInvoicing" />);
    const notice = screen.getByTestId("feature-notice");
    expect(notice).toHaveTextContent("E-invoicing: not on your plan");
    expect(notice).toHaveTextContent("E-invoicing is available on the Growth plan and above.");
    expect(notice).toHaveTextContent("stays visible");
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("sends a non-owner to the public pricing page", () => {
    statusData.current = { ...starter, canManageBilling: false };
    render(<FeatureNotice flag="manufacturing" />);
    expect(screen.getByTestId("feature-notice")).toHaveTextContent("Manufacturing and bill of materials is available on the Business plan.");
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
  });
});

describe("useFeature", () => {
  it("disables (never hides) with a reason a screen reader can read", () => {
    statusData.current = starter;
    const { result } = renderHook(() => useFeature("multiWarehouse"));
    expect(result.current.allowed).toBe(false);
    expect(result.current.badge).toBe("Growth");
    expect(result.current.lockedProps).toEqual({
      disabled: true,
      title: "Multiple warehouses are available on the Growth plan and above.",
      "aria-disabled": true,
    });
  });

  it("gives no props when allowed, and does not flash locked before the status arrives", () => {
    statusData.current = starter;
    expect(renderHook(() => useFeature("pos")).result.current.lockedProps).toEqual({});
    statusData.current = undefined;
    expect(renderHook(() => useFeature("eInvoicing")).result.current.allowed).toBe(true);
  });
});

describe("PlanBadge", () => {
  it("shows the plan name as text with a full-sentence label", () => {
    render(<PlanBadge plan="Growth" feature="Bank reconciliation" />);
    const badge = screen.getByTestId("plan-badge");
    expect(badge).toHaveTextContent("Growth");
    expect(badge).toHaveAttribute("aria-label", "Bank reconciliation is available on the Growth plan");
  });
});
