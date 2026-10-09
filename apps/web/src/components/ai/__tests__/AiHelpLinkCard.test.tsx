import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, ...rest }: { children: React.ReactNode; to: string; search?: Record<string, string> }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>{children}</a>
  ),
}));

import { AiCards } from "../AiCards";
import { HELP_SLUGS, helpPath } from "@/lib/help-paths";
import { HELP_INDEX, isAiHelpPath, parseAiCards } from "@fintranzact/shared";

const helpCard = (path: string, label = "Create an Invoice") => ({ type: "link", label, target: { kind: "help", path } });

describe("help link card", () => {
  it("opens a real help article in a new tab, marked for screen readers", () => {
    const { cards } = parseAiCards([helpCard("/help/invoicing/create-invoice")]);
    render(<AiCards cards={cards} />);
    const link = screen.getByTestId("ai-card-link");
    expect(link).toHaveAttribute("href", "/help/invoicing/create-invoice");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-link-kind", "help");
    expect(link).toHaveAccessibleName(/Create an Invoice \(help article, opens in a new tab\)/);
  });

  it("does not draw a forged help link: an unknown article, an outside URL, a path with a query", () => {
    const { cards, dropped } = parseAiCards([
      helpCard("/help/not-an-article"),
      helpCard("https://evil.example/help/invoicing/create-invoice"),
      helpCard("/help/invoicing/create-invoice?redirect=https://evil.example"),
      helpCard("javascript:alert(1)"),
    ]);
    expect(cards).toEqual([]);
    expect(dropped).toBe(4);
    render(<AiCards cards={cards} />);
    expect(screen.queryByTestId("ai-card-link")).not.toBeInTheDocument();
  });

  it("other link cards still open in the app, not in a new tab", () => {
    const { cards } = parseAiCards([{ type: "link", label: "Outstanding report", target: { kind: "report", report: "outstanding" } }]);
    render(<AiCards cards={cards} />);
    const link = screen.getByTestId("ai-card-link");
    expect(link).not.toHaveAttribute("target");
    expect(link).toHaveAttribute("href", "/reports?report=outstanding");
  });

  it("every article the assistant may link to exists in the help centre's own table of contents", () => {
    expect(HELP_INDEX.map((e) => e.slug).sort()).toEqual([...HELP_SLUGS].sort());
    for (const slug of HELP_SLUGS) {
      expect(isAiHelpPath(helpPath(slug)), slug).toBe(true);
    }
  });

  it("has no accessibility violations", async () => {
    const { cards } = parseAiCards([helpCard("/help/invoicing/create-invoice")]);
    const { container } = render(<AiCards cards={cards} />);
    expect(await axe(container)).toHaveNoViolations();
  }, 30_000);
});
