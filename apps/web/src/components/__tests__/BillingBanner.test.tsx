import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { statusData } = vi.hoisted(() => ({ statusData: { current: undefined as any } }));

vi.mock("@/lib/trpc", () => ({
  trpc: { billing: { status: { useQuery: () => ({ data: statusData.current, isLoading: false }) } } },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, search, ...rest }: any) => <a href={`${to}?tab=${search?.tab}`} {...rest}>{children}</a>,
}));

import { BillingBanner } from "../BillingBanner";

const base = {
  state: "active", readOnly: false, reason: null, message: null, trialEndsAt: null,
  trialDaysLeft: null, graceUntil: null, addons: [], upgradePath: "/settings?tab=billing", canManageBilling: true,
};
const set = (o: object) => { statusData.current = { ...base, ...o }; };

describe("BillingBanner", () => {
  beforeEach(() => {
    statusData.current = undefined;
    try { localStorage.clear(); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  it.each(["free", "active"])("renders nothing for %s", (state) => {
    set({ state });
    const { container } = render(<BillingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing before the status loads", () => {
    const { container } = render(<BillingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("read-only: explains what still works and offers Choose a plan to owners", () => {
    set({ state: "trial_expired", readOnly: true, reason: "read_only_trial_expired" });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Your trial has ended.");
    expect(screen.getByRole("status")).toHaveTextContent("view, search, download and export, but not create or edit");
    expect(screen.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("read-only halted: payment failed wording; non-owner is told to ask the owner", () => {
    set({ state: "halted", readOnly: true, reason: "read_only_halted", canManageBilling: false });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Your last payment did not go through.");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Ask your organisation owner to choose a plan.");
  });

  it("past due in grace: warning with days left and Update payment", () => {
    set({ state: "past_due_grace", graceUntil: new Date(Date.now() + 3 * 86400_000) });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("read-only in 3 days");
    expect(screen.getByRole("link", { name: "Update payment" })).toBeInTheDocument();
  });

  it("trialing: shows days left only in the last 7 days", () => {
    set({ state: "trialing", trialDaysLeft: 12 });
    const { container, unmount } = render(<BillingBanner />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    set({ state: "trialing", trialDaysLeft: 5 });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("5 days left in your trial.");
  });

  it("trial banner can be dismissed for the day and stays dismissed", () => {
    set({ state: "trialing", trialDaysLeft: 2 });
    const { unmount } = render(<BillingBanner />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    const { container } = render(<BillingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dismissal tolerates storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    set({ state: "trialing", trialDaysLeft: 2 });
    render(<BillingBanner />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("suspended: blocking alert", () => {
    set({ state: "suspended", readOnly: true, reason: "tenant_suspended", message: "Organisation suspended." });
    render(<BillingBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent("Organisation suspended.");
  });
});
