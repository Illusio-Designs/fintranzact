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

  const trial = (daysLeft: number, over: object = {}) => ({
    active: true, ended: false, daysLeft, source: "signup", totalDays: 14, startedAt: null, endsAt: null, caps: null, ...over,
  });

  it("trialing: a calm countdown with a Choose a plan button from the first day", () => {
    set({ state: "trialing", trialDaysLeft: 9, trial: trial(9) });
    render(<BillingBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("9 days left in your Full Access Trial");
    expect(banner).toHaveTextContent("Choose a plan");
    expect(banner).toHaveAttribute("data-tone", "calm");
    expect(screen.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("trialing: amber and not dismissible at 3 days or fewer", () => {
    set({ state: "trialing", trialDaysLeft: 3, trial: trial(3) });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByRole("status")).toHaveTextContent("3 days left");
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("a partner referral sees 'Your 30-day partner trial'", () => {
    set({ state: "trialing", trialDaysLeft: 30, trial: trial(30, { source: "partner", totalDays: 30 }) });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Your 30-day partner trial: 30 days left");
  });

  it("a non-owner is told to ask the owner and gets no button", () => {
    set({ state: "trialing", trialDaysLeft: 9, trial: trial(9), canManageBilling: false });
    render(<BillingBanner />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Ask your organisation owner to choose a plan.");
  });

  it("ended: red, says Trial ended: read-only, and keeps the Choose a plan button", () => {
    set({ state: "trial_expired", readOnly: true, reason: "read_only_trial_expired", trial: trial(0, { active: false, ended: true }) });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByRole("status")).toHaveTextContent("Trial ended: read-only");
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("a trial that was never granted shows the already-used message", () => {
    set({
      state: "trial_expired", readOnly: true, reason: "read_only_trial_expired",
      trial: trial(0, { active: false, ended: true, source: "none" }),
      trialMessage: "A free trial was already used for this email, phone or GSTIN. Choose a plan to continue.",
    });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("A free trial was already used for this email, phone or GSTIN. Choose a plan to continue.");
  });

  it("paid and grandfathered organisations see no trial banner even if a trial block is present", () => {
    for (const state of ["active", "grandfathered"]) {
      set({ state, trial: trial(5, { active: false }) });
      const { container, unmount } = render(<BillingBanner />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("while more than 3 days are left the banner can be dismissed for the day and stays dismissed", () => {
    set({ state: "trialing", trialDaysLeft: 9, trial: trial(9) });
    const { unmount } = render(<BillingBanner />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    const { container } = render(<BillingBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a dismissal from an earlier day does not hide today's banner", () => {
    localStorage.setItem("fintranzact:trial-banner-dismissed", "2020-01-01");
    set({ state: "trialing", trialDaysLeft: 9, trial: trial(9) });
    render(<BillingBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("dismissal tolerates storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    set({ state: "trialing", trialDaysLeft: 9, trial: trial(9) });
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
