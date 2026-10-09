/**
 * "Tips from your assistant" on the dashboard: hidden unless the add-on is available and the
 * server says tips are on; dismissible for the day, collapsible, accessible; "Ask AI about this"
 * only fills the question box.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  entitlements: { current: undefined as unknown },
  tips: { current: undefined as { data?: unknown; isLoading: boolean; isError?: boolean } | undefined },
  updatePrefs: vi.fn(),
  tipsEnabledArgs: vi.fn(),
  invalidate: vi.fn(),
  business: { current: "biz-1" as string | null },
}));

vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => h.entitlements.current }));
vi.mock("@/lib/trpc", () => ({
  getBusinessId: () => h.business.current,
  trpc: {
    useUtils: () => ({ ai: { tips: { invalidate: h.invalidate }, preferences: { invalidate: h.invalidate } } }),
    ai: {
      tips: { useQuery: (_i: unknown, opts: { enabled?: boolean }) => { h.tipsEnabledArgs(opts.enabled); return h.tips.current ?? { data: undefined, isLoading: true }; } },
      updatePreferences: { useMutation: () => ({ mutate: (v: unknown) => h.updatePrefs(v), isPending: false, error: null }) },
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, ...rest }: { children: React.ReactNode; to: string; search?: Record<string, string> }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>{children}</a>
  ),
}));

import { AiTipsCard } from "../AiTipsCard";
import { resetAiPanel, useAiPanel } from "@/lib/ai-panel";
import { axe } from "vitest-axe";

const ent = (addons: Partial<Record<string, boolean>> = { ai_assistant: true }) => ({
  status: { addons: { ai_assistant: false, ai_plus: false, ...addons }, trial: { active: false, caps: null }, readOnly: false },
  isLoading: false,
  canManageBilling: true,
});

const tip = (over: Record<string, unknown> = {}) => ({
  id: "overdue_invoices", kind: "overdue_invoices", severity: "warning",
  text: "3 invoices are overdue (₹1,20,000.00 to collect). The oldest was due on 2 Aug 2026.",
  ask: "Which customers have overdue invoices, and how much does each owe?",
  link: { label: "Open the Outstanding report", target: { kind: "report", report: "outstanding" } },
  ...over,
});
const lowStock = () => tip({ id: "low_stock", kind: "low_stock", text: "Stock of 5 items is below their reorder level.", ask: "Which items are low?", link: { label: "Open the Reorder status report", target: { kind: "report", report: "reorder-status" } } });

const ok = (tips: unknown[], day = "2026-10-09") => ({ data: { available: true, reason: "ok", tips, day }, isLoading: false });

function PanelState() {
  const { open, draft } = useAiPanel();
  return <span data-testid="panel">{open ? `open:${draft}` : "closed"}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetAiPanel();
  h.entitlements.current = ent();
  h.tips.current = ok([tip(), lowStock()]);
  h.business.current = "biz-1";
});

describe("when the card is shown", () => {
  it("lists the tips with their report links, severity for screen readers, and the explanation that no question is used", () => {
    render(<AiTipsCard role="owner" />);
    const card = screen.getByTestId("ai-tips-card");
    expect(within(card).getByRole("heading", { name: "Tips from your assistant" })).toBeInTheDocument();
    const items = within(card).getAllByTestId("ai-tip");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("3 invoices are overdue (₹1,20,000.00 to collect)");
    expect(items[0]).toHaveTextContent("Worth a look:");
    expect(within(items[0]!).getByRole("link", { name: /Open the Outstanding report/ })).toHaveAttribute("href", "/reports?report=outstanding");
    expect(within(items[1]!).getByRole("link", { name: /Reorder status/ })).toHaveAttribute("href", "/reports?report=reorder-status");
    expect(card).toHaveTextContent("no question is used");
  });

  it("asks the server only when the person may use the assistant and the add-on is on", () => {
    render(<AiTipsCard role="owner" />);
    expect(h.tipsEnabledArgs).toHaveBeenLastCalledWith(true);
  });
});

describe("when the card is hidden entirely", () => {
  it("the AI add-on is not available", () => {
    h.entitlements.current = ent({});
    const { container } = render(<AiTipsCard role="owner" />);
    expect(container).toBeEmptyDOMElement();
    expect(h.tipsEnabledArgs).toHaveBeenLastCalledWith(false);
  });

  it("the role has no assistant (auditor, filing CA, HR)", () => {
    for (const role of ["auditor", "ca_filing", "hr", "employee"]) {
      const { container, unmount } = render(<AiTipsCard role={role} />);
      expect(container, role).toBeEmptyDOMElement();
      expect(h.tipsEnabledArgs).toHaveBeenLastCalledWith(false);
      unmount();
    }
  });

  it.each(["tips_off", "org_disabled", "role_disabled", "read_only", "suspended", "addon_required"])("the server says tips are unavailable (%s)", (reason) => {
    h.tips.current = { data: { available: false, reason, tips: [], day: "2026-10-09" }, isLoading: false };
    const { container } = render(<AiTipsCard role="owner" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("there is nothing to say, while loading, and on an error: no flash of an empty card and no error toast", () => {
    h.tips.current = ok([]);
    const { container, rerender } = render(<AiTipsCard role="owner" />);
    expect(container).toBeEmptyDOMElement();
    h.tips.current = { data: undefined, isLoading: true };
    rerender(<AiTipsCard role="owner" />);
    expect(container).toBeEmptyDOMElement();
    h.tips.current = { data: undefined, isLoading: false, isError: true };
    rerender(<AiTipsCard role="owner" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Ask AI about this", () => {
  it("opens the assistant with the question filled in and sends nothing", async () => {
    const user = userEvent.setup();
    render(<><AiTipsCard role="owner" /><PanelState /></>);
    expect(screen.getByTestId("panel")).toHaveTextContent("closed");
    await user.click(within(screen.getAllByTestId("ai-tip")[1]!).getByRole("button", { name: "Ask AI about this" }));
    expect(screen.getByTestId("panel")).toHaveTextContent("open:Which items are low?");
  });
});

describe("dismissing and collapsing", () => {
  it("dismisses one tip for the day and remembers it in this browser", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AiTipsCard role="owner" />);
    await user.click(screen.getAllByRole("button", { name: /^Dismiss for today:/ })[0]!);
    expect(screen.getAllByTestId("ai-tip")).toHaveLength(1);
    expect(screen.getByTestId("ai-tip")).toHaveAttribute("data-tip-kind", "low_stock");
    unmount();
    // A reload the same day: still dismissed.
    render(<AiTipsCard role="owner" />);
    expect(screen.getAllByTestId("ai-tip")).toHaveLength(1);
  });

  it("dismissals are for one day only", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AiTipsCard role="owner" />);
    await user.click(screen.getAllByRole("button", { name: /^Dismiss for today:/ })[0]!);
    unmount();
    h.tips.current = ok([tip(), lowStock()], "2026-10-10");
    render(<AiTipsCard role="owner" />);
    expect(screen.getAllByTestId("ai-tip")).toHaveLength(2);
  });

  it("dismissals are per business", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AiTipsCard role="owner" />);
    await user.click(screen.getAllByRole("button", { name: /^Dismiss for today:/ })[0]!);
    unmount();
    h.business.current = "biz-2";
    render(<AiTipsCard role="owner" />);
    expect(screen.getAllByTestId("ai-tip")).toHaveLength(2);
  });

  it("hides the whole card once every tip is dismissed", async () => {
    const user = userEvent.setup();
    const { container } = render(<AiTipsCard role="owner" />);
    await user.click(screen.getAllByRole("button", { name: /^Dismiss for today:/ })[0]!);
    await user.click(screen.getAllByRole("button", { name: /^Dismiss for today:/ })[0]!);
    expect(container).toBeEmptyDOMElement();
  });

  it("collapses and expands, announcing the state, and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AiTipsCard role="owner" />);
    const toggle = screen.getByTestId("ai-tips-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show 2");
    expect(document.getElementById("ai-tips-list")).not.toBeVisible();
    unmount();
    render(<AiTipsCard role="owner" />);
    expect(screen.getByTestId("ai-tips-toggle")).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByTestId("ai-tips-toggle"));
    expect(document.getElementById("ai-tips-list")).toBeVisible();
  });

  it("works when browser storage is blocked", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<AiTipsCard role="owner" />);
    await user.click(screen.getAllByRole("button", { name: /^Dismiss for today:/ })[0]!);
    expect(screen.getAllByTestId("ai-tip")).toHaveLength(1);
    spy.mockRestore();
    set.mockRestore();
  });
});

describe("switching tips off from the card", () => {
  it("'Turn tips off' sends only the tips switch", async () => {
    const user = userEvent.setup();
    render(<AiTipsCard role="owner" />);
    await user.click(screen.getByTestId("ai-tips-off"));
    expect(h.updatePrefs).toHaveBeenCalledWith({ tipsEnabled: false });
  });
});

describe("accessibility", () => {
  it("has no violations, expanded or collapsed", async () => {
    const user = userEvent.setup();
    const { container } = render(<AiTipsCard role="owner" />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByTestId("ai-tips-toggle"));
    expect(await axe(container)).toHaveNoViolations();
  }, 30_000);
});
