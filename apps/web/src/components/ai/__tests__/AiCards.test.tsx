import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, ...rest }: { children: React.ReactNode; to: string; search?: Record<string, string> }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>{children}</a>
  ),
}));

import { AiCards } from "../AiCards";
import { parseAiCards } from "@fintranzact/shared";

const INVOICE = "3f0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a11";

describe("AiCards", () => {
  it("draws a table as a real, labelled table", () => {
    const { cards } = parseAiCards([{ type: "table", title: "Top customers", columns: ["Customer", "Sales"], rows: [["Asha Traders", "₹1,20,000.00"], ["Bhavna Stores", "₹80,000.00"]] }]);
    render(<AiCards cards={cards} />);
    const table = screen.getByRole("table", { name: "Top customers" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Customer", "Sales"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: "₹1,20,000.00" })).toBeInTheDocument();
  });

  it("draws a bar chart as an SVG with a text alternative and the same numbers in a table", () => {
    const { cards } = parseAiCards([{ type: "bar_chart", title: "Monthly sales", unit: "₹", bars: [{ label: "Sep", value: 120000 }, { label: "Oct", value: 140500 }] }]);
    const { container } = render(<AiCards cards={cards} />);
    const svg = screen.getByRole("img", { name: /Monthly sales: Sep ₹1,20,000, Oct ₹1,40,500/ });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelectorAll("svg rect")).toHaveLength(2);
    expect(screen.getByRole("table", { name: "Monthly sales" })).toBeInTheDocument();
  });

  it("opens only in-app routes from a link card", () => {
    const { cards } = parseAiCards([
      { type: "link", label: "Open invoice INV-1", target: { kind: "invoice", id: INVOICE } },
      { type: "link", label: "GSTR-3B", target: { kind: "report", report: "gstr3b" } },
      { type: "link", label: "Parties", target: { kind: "page", page: "parties" } },
    ]);
    render(<AiCards cards={cards} />);
    expect(screen.getByRole("link", { name: /Open invoice INV-1/ })).toHaveAttribute("href", `/invoices?id=${INVOICE}`);
    expect(screen.getByRole("link", { name: /GSTR-3B/ })).toHaveAttribute("href", "/reports?report=gstr3b");
    expect(screen.getByRole("link", { name: /Parties/ })).toHaveAttribute("href", "/parties");
  });

  it("never renders anything outside the three card types, and never as HTML", () => {
    const hostile = [
      { type: "html", html: "<script>window.hacked = 1</script>" },
      { type: "link", label: "evil", target: { kind: "url", href: "javascript:alert(1)" } },
      { type: "link", label: "evil", href: "https://evil.example" },
      { type: "table", title: "<img src=x onerror=window.hacked=2>", columns: ["<b>x</b>"], rows: [["<script>1</script>"]] },
    ];
    const { cards } = parseAiCards(hostile);
    const { container } = render(<AiCards cards={cards} />);
    expect(container.querySelector("script, img, iframe, b")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("renders nothing for no cards", () => {
    const { container } = render(<AiCards cards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no accessibility violations", async () => {
    const { cards } = parseAiCards([
      { type: "table", title: "T", columns: ["A", "B"], rows: [["1", "2"]] },
      { type: "bar_chart", title: "C", bars: [{ label: "x", value: 1 }] },
      { type: "link", label: "Home", target: { kind: "page", page: "dashboard" } },
    ]);
    const { container } = render(<AiCards cards={cards} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
