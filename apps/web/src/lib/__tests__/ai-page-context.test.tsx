import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { getAiPageContext, resetAiPageEntity, setAiPageEntity, useAiPageEntity } from "../ai-page-context";

const ID = "3f0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a11";

beforeEach(() => resetAiPageEntity());

describe("getAiPageContext", () => {
  it("reads the invoice, quotation and report from allowlisted routes", () => {
    expect(getAiPageContext({ pathname: "/invoices", search: `?id=${ID}` })).toEqual({ kind: "invoice", id: ID });
    expect(getAiPageContext({ pathname: "/quotations", search: `?id=${ID}` })).toEqual({ kind: "quotation", id: ID });
    expect(getAiPageContext({ pathname: "/reports", search: "?report=outstanding" })).toEqual({ kind: "report", report: "outstanding" });
    expect(getAiPageContext({ pathname: "/reports", search: "?report=pnl&from=2026-04-01&to=2026-10-09" })).toEqual({ kind: "report", report: "pnl", from: "2026-04-01", to: "2026-10-09" });
    expect(getAiPageContext({ pathname: "/", search: "" })).toEqual({ kind: "page", page: "dashboard" });
  });

  it("sends nothing for an unknown route, a bad id or an id on the wrong page", () => {
    expect(getAiPageContext({ pathname: "/payroll", search: `?id=${ID}` })).toBeNull();
    expect(getAiPageContext({ pathname: "/settings", search: "" })).toBeNull();
    expect(getAiPageContext({ pathname: "/platform", search: "" })).toBeNull();
    expect(getAiPageContext({ pathname: "/invoices", search: "?id=123" })).toEqual({ kind: "page", page: "invoices" });
    expect(getAiPageContext({ pathname: "/invoices", search: `?id=${ID}&id=other` })).toEqual({ kind: "invoice", id: ID });
    expect(getAiPageContext({ pathname: "/reports", search: "?report=../../etc/passwd" })).toEqual({ kind: "page", page: "reports" });
  });

  it("uses the record a page published (party, item) only on that page", () => {
    setAiPageEntity({ kind: "party", id: ID });
    expect(getAiPageContext({ pathname: "/parties", search: "" })).toEqual({ kind: "party", id: ID });
    expect(getAiPageContext({ pathname: "/items", search: "" })).toEqual({ kind: "page", page: "items" });
    expect(getAiPageContext({ pathname: "/invoices", search: "" })).toEqual({ kind: "page", page: "invoices" });
  });

  it("never throws on a malformed location", () => {
    expect(getAiPageContext({ pathname: "/invoices", search: "%E0%A4%A" })).not.toBeUndefined();
  });
});

describe("useAiPageEntity", () => {
  it("publishes the open record while the page shows it and forgets it when it closes", () => {
    const { rerender, unmount } = renderHook(({ id }: { id: string | null }) => useAiPageEntity("party", id), { initialProps: { id: ID as string | null } });
    expect(getAiPageContext({ pathname: "/parties", search: "" })).toEqual({ kind: "party", id: ID });
    rerender({ id: null });
    expect(getAiPageContext({ pathname: "/parties", search: "" })).toEqual({ kind: "page", page: "parties" });
    rerender({ id: ID });
    expect(getAiPageContext({ pathname: "/parties", search: "" })).toEqual({ kind: "party", id: ID });
    unmount();
    expect(getAiPageContext({ pathname: "/parties", search: "" })).toEqual({ kind: "page", page: "parties" });
  });
});
