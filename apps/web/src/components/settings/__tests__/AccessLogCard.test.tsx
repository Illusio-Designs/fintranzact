/** Access log card: sentences, filter, Load more paging, and "Last opened" on CA rows in the Team tab. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  calls: [] as any[],
  pages: {} as Record<string, any>,
  members: { current: [] as any[] },
  role: { current: "owner" as string },
}));

vi.mock("@/lib/trpc", () => {
  const inv = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({ tenant: { current: inv, members: inv, pendingInvitations: inv } }),
      auth: { me: { useQuery: () => ({ data: { tenantId: "t1", role: h.role.current, user: { id: "owner-1", email: "me@firm.in" }, twoFactor: { enabled: true } } }) } },
      tenant: {
        accessLog: {
          useQuery: (input: any) => {
            h.calls.push(input);
            const data = h.pages[input.cursor ?? "first"] ?? { items: [], nextCursor: null };
            return { data, isLoading: false, isError: false, isFetching: false };
          },
        },
        members: { useQuery: () => ({ data: h.members.current, isLoading: false }) },
        pendingInvitations: { useQuery: () => ({ data: [] }) },
        current: { useQuery: () => ({ data: { twoFactorPolicy: "off", twoFactorGraceDays: 7 } }) },
        removeMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        updateMemberRole: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        revokeInvitation: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        inviteMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setSecurityPolicy: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});
vi.mock("@/hooks/useToast", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { AccessLogCard } from "../AccessLogCard";
import { TeamTab } from "../TeamTab";

const ca = { id: "ca-1", name: "Anita Shah", email: "anita@firm.in" };
const owner = { id: "owner-1", name: "Rohit", email: "me@firm.in" };
const ev = (id: string, type: string, over: object = {}) => ({
  id, type, label: type, createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(), actor: owner, subject: null, metadata: {}, ...over,
});

beforeEach(() => {
  h.calls.length = 0;
  h.pages = {};
  h.role.current = "owner";
});

describe("AccessLogCard", () => {
  it("shows a sentence per event with the viewer as 'You'", () => {
    h.pages.first = {
      nextCursor: null,
      items: [
        ev("1", "access.invited", { subject: ca, metadata: { role: "auditor", email: ca.email } }),
        ev("2", "access.accepted", { actor: ca, subject: ca, metadata: { role: "auditor" } }),
        ev("3", "access.removed", { subject: ca, metadata: { role: "auditor" } }),
        ev("4", "access.org_opened", { actor: ca, metadata: { role: "auditor" } }),
        ev("5", "access.export", { actor: ca, metadata: { role: "ca_filing", procedure: "gst.gstr1Json" } }),
      ],
    };
    render(<AccessLogCard viewerId="owner-1" />);
    const rows = screen.getAllByTestId("access-log-row");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Anita Shah (CA) was invited as Accountant (read-only) by You");
    expect(rows[1]).toHaveTextContent("Anita Shah accepted the invitation as Accountant (read-only)");
    expect(rows[2]).toHaveTextContent("Access removed for Anita Shah (CA) by You");
    expect(rows[3]).toHaveTextContent("Anita Shah (CA) opened this organisation");
    expect(rows[4]).toHaveTextContent("Anita Shah (CA) downloaded GSTR-1 JSON");
    expect(rows[0]).toHaveTextContent("3h ago");
  });

  it("shows an empty state", () => {
    render(<AccessLogCard viewerId="owner-1" />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("filters by type group and starts again from the first page", async () => {
    const user = userEvent.setup();
    render(<AccessLogCard viewerId="owner-1" />);
    expect(h.calls.at(-1)).toEqual({ cursor: undefined, limit: 25 });
    await user.click(screen.getByRole("button", { name: "Downloads" }));
    expect(h.calls.at(-1)).toEqual({ cursor: undefined, limit: 25, type: ["access.export"] });
    await user.click(screen.getByRole("button", { name: "Invites" }));
    expect(h.calls.at(-1)).toEqual({ cursor: undefined, limit: 25, type: ["access.invited", "access.invite_revoked", "access.accepted", "access.partner_attributed"] });
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(h.calls.at(-1)).toEqual({ cursor: undefined, limit: 25 });
  });

  it("Load more fetches the next page with the cursor and appends it", async () => {
    const user = userEvent.setup();
    h.pages.first = { nextCursor: "111_cursor", items: [ev("1", "access.org_opened", { actor: ca, metadata: { role: "auditor" } })] };
    h.pages["111_cursor"] = { nextCursor: null, items: [ev("2", "access.invited", { subject: ca, metadata: { role: "auditor" } })] };
    render(<AccessLogCard viewerId="owner-1" />);
    expect(screen.getAllByTestId("access-log-row")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(h.calls.some((c) => c.cursor === "111_cursor")).toBe(true);
    expect(screen.getAllByTestId("access-log-row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("Team tab", () => {
  const member = (over: object) => ({ id: Math.random().toString(), userId: Math.random().toString(), role: "seller", acceptedAt: new Date(), createdAt: new Date(), userName: "N", userEmail: "x@firm.in", lastOpenedAt: null, ...over });

  beforeEach(() => {
    h.members.current = [
      member({ userEmail: "me@firm.in", role: "owner" }),
      member({ userEmail: "s@firm.in", role: "seller", userName: "Sam" }),
      member({ userEmail: "ca@firm.in", role: "auditor", userName: "Anita", lastOpenedAt: new Date(Date.now() - 2 * 3600_000) }),
      member({ userEmail: "cf@firm.in", role: "ca_filing", userName: "Vikram" }),
    ];
  });

  it("shows 'Last opened' and 'Never opened' on CA rows only, and the log for the owner", () => {
    render(<TeamTab />);
    const labels = screen.getAllByTestId("last-opened").map((n) => n.textContent);
    expect(labels).toEqual(["Last opened 2h ago", "Never opened"]);
    expect(screen.getByTestId("access-log")).toBeInTheDocument();
  });

  it("admins see the log too; others do not", () => {
    h.role.current = "admin";
    h.members.current[0] = member({ userEmail: "me@firm.in", role: "admin" });
    const { unmount } = render(<TeamTab />);
    expect(screen.getByTestId("access-log")).toBeInTheDocument();
    unmount();
    h.members.current[0] = member({ userEmail: "me@firm.in", role: "seller" });
    render(<TeamTab />);
    expect(screen.queryByTestId("access-log")).toBeNull();
    expect(screen.queryAllByTestId("last-opened")).toHaveLength(0);
    expect(within(document.body).queryByText("Never opened")).toBeNull();
  });
});
