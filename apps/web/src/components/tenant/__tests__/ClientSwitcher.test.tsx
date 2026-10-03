/** Client switcher: search, sections, keyboard, pin, leave, load more, empty state. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  inputs: [] as any[],
  pages: {} as Record<string, any>,
  setPinned: vi.fn(),
  leave: vi.fn(),
  invalidate: vi.fn(),
  leaveOpts: { current: null as any },
  pinOpts: { current: null as any },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      tenant: { listClients: { invalidate: h.invalidate }, list: { invalidate: h.invalidate } },
    }),
    tenant: {
      listClients: {
        useQuery: (input: any) => {
          h.inputs.push(input);
          const key = `${input.search ?? ""}|${input.scope}|${input.cursor ?? ""}`;
          const data = h.pages[key] ?? h.pages.default;
          return { data, isLoading: !data, isFetching: false, isError: false };
        },
      },
      setPinned: { useMutation: (o: any) => { h.pinOpts.current = o; return { mutate: h.setPinned, isPending: false }; } },
      leave: { useMutation: (o: any) => { h.leaveOpts.current = o; return { mutate: h.leave, isPending: false }; } },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { ClientSwitcher } from "../ClientSwitcher";

let n = 0;
const item = (name: string, over: object = {}) => ({
  tenantId: `t${++n}`, name, slug: name, role: "auditor", roleLabel: "Accountant (read-only)", isOwnFirm: false, isClient: true, isCa: true,
  plan: "pro", pinned: false, lastOpenedAt: null, ...over,
});
const firm = (name: string) => item(name, { role: "owner", roleLabel: "Owner", isOwnFirm: true, isClient: false, isCa: false });
const page = (items: any[], over: object = {}) => ({
  items, nextCursor: null, total: items.length,
  counts: { all: items.length, mine: items.filter((i) => i.isOwnFirm).length, clients: items.filter((i) => !i.isOwnFirm).length, pinned: items.filter((i) => i.pinned).length },
  ...over,
});

beforeEach(() => {
  h.inputs.length = 0;
  h.pages = {};
  h.setPinned.mockClear();
  h.leave.mockClear();
  h.invalidate.mockClear();
  n = 0;
});
afterEach(() => vi.useRealTimers());

const sectionTitles = () => screen.getAllByRole("group").map((g) => g.getAttribute("aria-label")).filter((l) => ["Pinned", "Recent", "My firm", "Clients"].includes(l ?? ""));

describe("ClientSwitcher", () => {
  it("groups into Pinned, Recent, My firm and Clients with role badges and a CA tag", () => {
    h.pages.default = page([
      item("Pinned Co", { pinned: true, lastOpenedAt: "2026-09-01T00:00:00Z" }),
      item("Recent Co", { lastOpenedAt: "2026-09-20T00:00:00Z", role: "ca_filing", roleLabel: "Accountant (filing)" }),
      firm("Shah & Associates"),
      item("Plain Co"),
    ]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    expect(sectionTitles()).toEqual(["Pinned", "Recent", "My firm", "Clients"]);
    expect(screen.getByText("Accountant (filing)")).toBeTruthy();
    expect(screen.getAllByText("Accountant (read-only)").length).toBe(2);
    expect(screen.getAllByText("CA")).toHaveLength(3);
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText(/3 clients/)).toBeTruthy();
    expect(screen.getByText("Select Organization")).toBeTruthy();
  });

  it("focuses the search box and debounces the query by 200ms", () => {
    vi.useFakeTimers();
    h.pages.default = page([item("Acme")]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    const box = screen.getByLabelText("Search organizations");
    expect(document.activeElement).toBe(box);
    h.inputs.length = 0;
    fireEvent.change(box, { target: { value: "ac" } });
    act(() => { vi.advanceTimersByTime(150); });
    expect(h.inputs.some((i) => i.search === "ac")).toBe(false);
    act(() => { vi.advanceTimersByTime(60); });
    expect(h.inputs.some((i) => i.search === "ac" && i.scope === "all" && !i.cursor)).toBe(true);
  });

  it("shows the matches for a search, without a Recent section, and a no-results message", async () => {
    vi.useFakeTimers();
    h.pages["acme|all|"] = page([item("Acme Traders", { lastOpenedAt: "2026-09-01T00:00:00Z" })]);
    h.pages["zzz|all|"] = page([], { counts: { all: 3, mine: 1, clients: 2, pinned: 0 } });
    h.pages.default = page([item("Acme Traders", { lastOpenedAt: "2026-09-01T00:00:00Z" }), item("Other")]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search organizations"), { target: { value: "acme" } });
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText("Acme Traders")).toBeTruthy();
    expect(sectionTitles()).toEqual(["Clients"]);
    fireEvent.change(screen.getByLabelText("Search organizations"), { target: { value: "zzz" } });
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText(/No organizations match/)).toBeTruthy();
  });

  it("arrow keys move, Enter opens, Escape closes", async () => {
    const user = userEvent.setup();
    h.pages.default = page([item("Alpha"), item("Beta"), item("Gamma")]);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ClientSwitcher onSelect={onSelect} onClose={onClose} />);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("t2");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    const opts = screen.getAllByRole("option");
    expect(opts[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("clicking a row opens it; the current one is marked", async () => {
    const user = userEvent.setup();
    h.pages.default = page([item("Alpha"), item("Beta")]);
    const onSelect = vi.fn();
    render(<ClientSwitcher onSelect={onSelect} currentTenantId="t2" />);
    expect(screen.getByText("Current")).toBeTruthy();
    await user.click(screen.getByText("Beta"));
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("the star pins and unpins through tenant.setPinned", async () => {
    const user = userEvent.setup();
    h.pages.default = page([item("Alpha"), item("Beta", { pinned: true })]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    await user.click(screen.getByLabelText("Pin Alpha"));
    expect(h.setPinned).toHaveBeenCalledWith({ tenantId: "t1", pinned: true });
    await user.click(screen.getByLabelText("Unpin Beta"));
    expect(h.setPinned).toHaveBeenCalledWith({ tenantId: "t2", pinned: false });
    act(() => h.pinOpts.current.onSuccess());
    expect(h.invalidate).toHaveBeenCalled();
  });

  it("Leave this client: overflow menu, then a confirm that warns, then tenant.leave; own firm has no menu", async () => {
    const user = userEvent.setup();
    h.pages.default = page([item("Acme"), firm("My Firm")]);
    const onLeft = vi.fn();
    render(<ClientSwitcher onSelect={vi.fn()} onLeft={onLeft} />);
    expect(screen.queryByLabelText("More actions for My Firm")).toBeNull();
    await user.click(screen.getByLabelText("More actions for Acme"));
    await user.click(screen.getByRole("menuitem", { name: "Leave this client" }));
    expect(h.leave).not.toHaveBeenCalled();
    expect(screen.getByText("Leave Acme?")).toBeTruthy();
    expect(screen.getByText(/ends immediately/)).toBeTruthy();
    expect(screen.getByText(/owner is notified/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Leave this client" }));
    expect(h.leave).toHaveBeenCalledWith({ tenantId: "t1" });
    act(() => h.leaveOpts.current.onSuccess({ success: true }, { tenantId: "t1" }));
    expect(onLeft).toHaveBeenCalledWith("t1");
  });

  it("cancelling the confirm leaves nothing called", async () => {
    const user = userEvent.setup();
    h.pages.default = page([item("Acme")]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    await user.click(screen.getByLabelText("More actions for Acme"));
    await user.click(screen.getByRole("menuitem", { name: "Leave this client" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.leave).not.toHaveBeenCalled();
  });

  it("Load more asks for the next page with the cursor and appends it", async () => {
    const user = userEvent.setup();
    h.pages.default = page([item("Alpha")], { nextCursor: "c1", total: 2 });
    h.pages["|all|c1"] = page([item("Beta")], { total: 2 });
    render(<ClientSwitcher onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(h.inputs.some((i) => i.cursor === "c1")).toBe(true);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("scope tabs appear only with both a firm and clients and change the query", async () => {
    const user = userEvent.setup();
    h.pages.default = page([firm("My Firm"), item("Acme")]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Clients" }));
    expect(h.inputs.some((i) => i.scope === "clients")).toBe(true);
  });

  it("no scope tabs for a person with only clients", () => {
    h.pages.default = page([item("Acme")]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
  });

  it("empty state, loading state, and the create-new button", async () => {
    const user = userEvent.setup();
    render(<ClientSwitcher onSelect={vi.fn()} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    h.pages.default = page([]);
    const onCreateNew = vi.fn();
    const { unmount } = render(<ClientSwitcher onSelect={vi.fn()} onCreateNew={onCreateNew} />);
    expect(screen.getByText(/not a member of any organization/)).toBeTruthy();
    await user.click(screen.getByText("Create new organization"));
    expect(onCreateNew).toHaveBeenCalled();
    unmount();
  });

  it("the list scrolls inside a capped height", () => {
    h.pages.default = page([item("Alpha")]);
    render(<ClientSwitcher onSelect={vi.fn()} />);
    const list = screen.getByRole("listbox");
    expect(list.className).toContain("overflow-y-auto");
    expect(within(screen.getByTestId("client-switcher")).getByRole("listbox")).toBe(list);
    expect(screen.getByTestId("client-switcher").className).toContain("max-h-");
  });
});
