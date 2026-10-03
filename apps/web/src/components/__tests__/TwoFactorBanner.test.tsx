import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { req } = vi.hoisted(() => ({ req: { current: undefined as any } }));

vi.mock("@/hooks/useTwoFactorRequirement", () => ({
  useTwoFactorRequirement: () => ({ requirement: req.current, policy: "all", graceDays: 7, isLoading: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, search, ...rest }: any) => <a href={`${to}?tab=${search?.tab}&pane=${search?.pane}`} {...rest}>{children}</a>,
}));

import { TwoFactorBanner } from "../TwoFactorBanner";

const base = { required: true, blocked: false, graceEndsAt: new Date("2026-07-01T00:00:00Z"), policy: "all", setupPath: "/settings?tab=account&pane=security" };

describe("TwoFactorBanner", () => {
  beforeEach(() => { req.current = undefined; });

  it("renders nothing when not required", () => {
    req.current = { ...base, required: false, graceEndsAt: null };
    const { container } = render(<TwoFactorBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("during grace: a reminder with the deadline and a Set up now link to the Security tab", () => {
    req.current = base;
    render(<TwoFactorBanner />);
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("Your organisation requires two-factor authentication. Set it up by 1 Jul 2026.");
    expect(screen.getByRole("link", { name: "Set up now" })).toHaveAttribute("href", "/settings?tab=account&pane=security");
  });

  it("blocked: a full-width alert", () => {
    req.current = { ...base, blocked: true };
    render(<TwoFactorBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent("Set it up now to keep using Fintranzact");
    expect(screen.getByRole("link", { name: "Set up now" })).toBeInTheDocument();
  });
});
